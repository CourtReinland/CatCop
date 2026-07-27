// Aiming.
//
// The old build aimed by physically rotating the phone while holding a separate
// FIRE button — accurate in a spec, miserable in a hand. A light-gun game on a
// touchscreen wants the reticle *under your finger*: drag to aim, hold to fire.
// Gyro remains available as an opt-in "headset" mode.

import * as THREE from 'three';
import { AIM, CAMERA } from './config.js';

export const AimMode = { TOUCH: 'touch', POINTER: 'pointer', GYRO: 'gyro' };

export class InputManager {
  constructor(shell, canvas) {
    this.shell = shell;
    this.canvas = canvas;
    this.mode = matchMedia('(pointer: coarse)').matches ? AimMode.TOUCH : AimMode.POINTER;
    this.firing = false;
    this.firePressedAt = 0;
    this.keys = new Set();
    this.enabled = false;

    // Screen-space reticle (CSS pixels) and its damped target.
    this.aim = new THREE.Vector2(window.innerWidth / 2, window.innerHeight * 0.42);
    this.aimTarget = this.aim.clone();
    this.ndc = new THREE.Vector2();

    // Camera lead — the view drifts slightly toward where you are aiming.
    this.lead = new THREE.Vector2();
    this.leadTarget = new THREE.Vector2();

    // Gyro state.
    this.motionState = 'idle';
    this.motionDetail = 'Motion off · drag to aim';
    this.baseQ = new THREE.Quaternion();
    this.targetViewQ = new THREE.Quaternion();
    this.viewQ = new THREE.Quaternion();
    this.rawDeviceQ = new THREE.Quaternion();
    this.sensorReferenceQ = new THREE.Quaternion();
    this.viewAnchorQ = new THREE.Quaternion();
    this.sensorDeltaQ = new THREE.Quaternion();
    this.deviceEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.screenQ = new THREE.Quaternion();
    this.cameraCorrectionQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    this.zAxis = new THREE.Vector3(0, 0, 1);
    this.pendingRebase = true;
    this.orientationBound = false;
    this.lastSensorAt = 0;
    this.noDataTimer = null;

    this.onMotionStateChanged = () => {};
    this.onFireDown = () => {};
    this.boundOrientation = (event) => this.#handleOrientation(event);
  }

  get usingGyro() { return this.mode === AimMode.GYRO && this.motionState === 'active'; }

  bind() {
    const isUiTarget = (target) => !!target?.closest?.('button, a, input, .overlay, .dialogue, .hud, .panel, .no-aim');

    const setAimFromEvent = (event) => {
      const offset = this.mode === AimMode.TOUCH ? AIM.touchOffsetY : 0;
      this.aimTarget.set(
        event.clientX,
        Math.max(24, Math.min(window.innerHeight - 24, event.clientY + offset))
      );
    };

    this.shell.addEventListener('pointerdown', (event) => {
      if (!this.enabled || isUiTarget(event.target)) return;
      if (event.pointerType === 'touch') this.mode = this.mode === AimMode.GYRO ? AimMode.GYRO : AimMode.TOUCH;
      if (!this.usingGyro) {
        setAimFromEvent(event);
        // First contact snaps rather than sliding in from wherever it was.
        this.aim.copy(this.aimTarget);
      }
      this.firing = true;
      this.firePressedAt = performance.now();
      this.onFireDown();
      try { this.shell.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      event.preventDefault();
    }, { passive: false });

    this.shell.addEventListener('pointermove', (event) => {
      if (!this.enabled || this.usingGyro) return;
      if (event.pointerType === 'mouse' && !isUiTarget(event.target)) {
        this.mode = AimMode.POINTER;
        setAimFromEvent(event);
        return;
      }
      if (this.firing) setAimFromEvent(event);
    }, { passive: true });

    const release = () => { this.firing = false; };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', () => { this.firing = false; this.keys.clear(); });

    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (event.code === 'Space') { event.preventDefault(); this.firing = true; }
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
      if (event.code === 'Space') this.firing = false;
    });

    const reorient = () => {
      this.pendingRebase = true;
      this.#resize();
    };
    window.addEventListener('resize', reorient);
    screen.orientation?.addEventListener?.('change', reorient);
    window.addEventListener('orientationchange', reorient);
  }

  #resize() {
    this.aim.x = Math.min(this.aim.x, window.innerWidth - 8);
    this.aim.y = Math.min(this.aim.y, window.innerHeight - 8);
  }

  setBaseQuaternion(q) {
    this.baseQ.copy(q);
    this.targetViewQ.copy(q);
    this.viewQ.copy(q);
    this.viewAnchorQ.copy(q);
  }

  centerAim() {
    this.aimTarget.set(window.innerWidth / 2, window.innerHeight * 0.42);
    this.aim.copy(this.aimTarget);
  }

  // --- Gyro -----------------------------------------------------------------
  /** Must be called synchronously from a user gesture on iOS. */
  requestMotion() {
    if (!window.isSecureContext && location.hostname !== 'localhost') {
      this.#setMotionState('insecure', 'Motion needs an HTTPS link');
      return Promise.resolve(false);
    }
    if (!('DeviceOrientationEvent' in window)) {
      this.#setMotionState('unsupported', 'No motion sensors on this device');
      return Promise.resolve(false);
    }
    this.#setMotionState('requesting', 'Requesting motion access…');
    let request;
    try {
      request = typeof DeviceOrientationEvent.requestPermission === 'function'
        ? DeviceOrientationEvent.requestPermission()
        : Promise.resolve('granted');
    } catch {
      this.#setMotionState('error', 'Motion request failed');
      return Promise.resolve(false);
    }
    return Promise.resolve(request).then((permission) => {
      if (permission !== 'granted') {
        this.#setMotionState('denied', 'Motion denied · touch aiming still works');
        return false;
      }
      if (!this.orientationBound) {
        window.addEventListener('deviceorientation', this.boundOrientation, true);
        this.orientationBound = true;
      }
      this.pendingRebase = true;
      this.mode = AimMode.GYRO;
      this.centerAim();
      this.#setMotionState('waiting-data', 'Granted · waiting for sensors…');
      clearTimeout(this.noDataTimer);
      this.noDataTimer = setTimeout(() => {
        if (this.motionState === 'waiting-data') this.#setMotionState('no-data', 'No sensor data · tap to retry');
      }, 2400);
      return true;
    }).catch(() => {
      this.#setMotionState('error', 'Motion blocked · check Safari settings');
      return false;
    });
  }

  disableMotion() {
    this.mode = matchMedia('(pointer: coarse)').matches ? AimMode.TOUCH : AimMode.POINTER;
    this.#setMotionState('idle', 'Motion off · drag to aim');
  }

  recalibrate() {
    if (this.usingGyro || this.motionState === 'waiting-data') {
      this.pendingRebase = true;
    } else {
      this.centerAim();
    }
  }

  #handleOrientation(event) {
    if (![event.alpha, event.beta, event.gamma].every(Number.isFinite)) return;
    this.lastSensorAt = performance.now();
    const alpha = THREE.MathUtils.degToRad(event.alpha);
    const beta = THREE.MathUtils.degToRad(event.beta);
    const gamma = THREE.MathUtils.degToRad(event.gamma);
    const screenDeg = screen.orientation?.angle ?? (typeof window.orientation === 'number' ? window.orientation : 0);

    this.deviceEuler.set(beta, alpha, -gamma, 'YXZ');
    this.rawDeviceQ.setFromEuler(this.deviceEuler);
    this.rawDeviceQ.multiply(this.cameraCorrectionQ);
    this.screenQ.setFromAxisAngle(this.zAxis, -THREE.MathUtils.degToRad(screenDeg));
    this.rawDeviceQ.multiply(this.screenQ).normalize();

    if (this.pendingRebase) {
      this.sensorReferenceQ.copy(this.rawDeviceQ);
      this.viewAnchorQ.copy(this.baseQ);
      this.pendingRebase = false;
    }
    this.sensorDeltaQ.copy(this.sensorReferenceQ).invert().multiply(this.rawDeviceQ);
    this.targetViewQ.copy(this.viewAnchorQ).multiply(this.sensorDeltaQ).normalize();
    clearTimeout(this.noDataTimer);
    if (this.motionState !== 'active') this.#setMotionState('active', 'Motion active · phone plane is line of sight');
  }

  #setMotionState(state, detail) {
    this.motionState = state;
    this.motionDetail = detail;
    this.onMotionStateChanged(state, detail);
  }

  // --- Per-frame ------------------------------------------------------------
  update(dt) {
    if (this.mode === AimMode.GYRO && this.motionState === 'active'
      && performance.now() - this.lastSensorAt > 2600) {
      this.#setMotionState('no-data', 'Sensor feed paused · tap to retry');
    }

    if (this.usingGyro) {
      this.centerAim();
      this.viewQ.slerp(this.targetViewQ, 1 - Math.exp(-dt / AIM.gyroSlerpTau));
      this.leadTarget.set(0, 0);
    } else {
      // Keyboard nudge for desktop players without a mouse.
      const step = 620 * dt;
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) this.aimTarget.x -= step;
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) this.aimTarget.x += step;
      if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) this.aimTarget.y -= step;
      if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) this.aimTarget.y += step;
      this.aimTarget.x = THREE.MathUtils.clamp(this.aimTarget.x, 8, window.innerWidth - 8);
      this.aimTarget.y = THREE.MathUtils.clamp(this.aimTarget.y, 8, window.innerHeight - 8);

      const k = 1 - Math.exp(-AIM.followLambda * dt);
      this.aim.lerp(this.aimTarget, k);
      this.viewQ.copy(this.baseQ);

      // Aiming near an edge leans the camera that way — cheap, readable parallax.
      this.leadTarget.set(
        (this.aim.x / window.innerWidth) * 2 - 1,
        (this.aim.y / window.innerHeight) * 2 - 1
      );
    }
    this.lead.lerp(this.leadTarget, 1 - Math.exp(-6 * dt));
  }

  /** Normalised device coords for the current reticle position. */
  getNdc() {
    return this.ndc.set(
      (this.aim.x / window.innerWidth) * 2 - 1,
      -(this.aim.y / window.innerHeight) * 2 + 1
    );
  }

  /** Extra camera yaw/pitch (radians) from aim lead. */
  getLeadAngles() {
    return {
      yaw: -this.lead.x * THREE.MathUtils.degToRad(CAMERA.leadYawDeg),
      pitch: -this.lead.y * THREE.MathUtils.degToRad(CAMERA.leadPitchDeg)
    };
  }
}
