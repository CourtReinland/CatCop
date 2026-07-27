// Mission controller: stand progression, wave spawning, enemy behaviour,
// hitscan combat with lock assist, scoring and fail states.

import * as THREE from 'three';
import {
  ACTOR, AIM, PALETTE, PHYSICS, PLAYER, SCORE_TUNING, WEAPONS, WEAPON_ORDER
} from './config.js';
import { getLevel, LEVELS } from './levels.js';

const PICKUP_STYLE = {
  health: { color: 0x7effd4, label: 'MED' },
  ammo: { color: 0x76dfff, label: 'AMMO' },
  weapon: { color: 0xff65bd, label: 'ARMS' }
};

export class GameController {
  constructor({ world, input, audio, ui, factory }) {
    this.world = world;
    this.input = input;
    this.audio = audio;
    this.ui = ui;
    this.factory = factory;

    this.state = 'idle';
    this.actors = [];
    this.pickups = [];
    this.levelIndex = 0;
    this.romanceFlag = 'bold';

    this.tmpDir = new THREE.Vector3();
    this.tmpPoint = new THREE.Vector3();
    this.tmpImpulse = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();
    this.muzzle = new THREE.Vector3();

    this.onMissionEnd = () => {};
    this.#resetRun();
  }

  #resetRun() {
    this.score = 0;
    this.combo = 1;
    this.streak = 0;
    this.bestStreak = 0;
    this.kills = 0;
    this.shotsFired = 0;
    this.shotsHit = 0;
    this.sukiHealth = PLAYER.maxHealth;
    this.enoHealth = PLAYER.enoMaxHealth;
    this.friendlyVictims = 0;
    this.currentWeapon = 'sidearm';
    this.unlocked = new Set(['sidearm']);
    this.mag = {};
    this.reserve = {};
    WEAPON_ORDER.forEach((id) => {
      this.mag[id] = id === 'sidearm' ? WEAPONS[id].mag : 0;
      this.reserve[id] = WEAPONS[id].reserve;
    });
    this.reloadTimer = 0;
  }

  // --- Lifecycle ------------------------------------------------------------
  startLevel(index, { freshRun = false } = {}) {
    if (freshRun) this.#resetRun();
    this.levelIndex = index;
    this.level = getLevel(index);
    this.world.buildLevel(this.level);
    this.#clearActors();

    this.standIndex = 0;
    this.standTime = 0;
    this.spawnCursor = 0;
    this.advancing = false;
    this.advanceHold = 0;
    this.standStuckTimer = 0;
    this.fireTimer = 0;
    this.comboTimer = 0;
    this.lockTarget = null;
    this.lastLockTarget = null;
    this.lastLockBeep = -Infinity;
    this.physicsAccumulator = 0;
    this.milestones = new Set();
    this.emptyToastAt = 0;

    this.world.setWeapon(this.currentWeapon);
    this.#enterStand(0, true);
    this.state = 'playing';
    this.input.enabled = true;
    this.input.centerAim();
    this.ui.setScreen('playing');
    this.ui.showBanner(this.level.name, this.level.subtitle, 2600);
    this.audio.riser(1.6, 0.2);
  }

  #clearActors() {
    this.actors.forEach((actor) => {
      this.world.actorGroup.remove(actor.group);
      actor.dispose();
    });
    this.actors = [];
    this.pickups.forEach((p) => this.world.actorGroup.remove(p.mesh));
    this.pickups = [];
    this.ui.clearMarkers();
    this.lockTarget = null;
  }

  get stand() { return this.level.stands[this.standIndex]; }

  #enterStand(index, immediate = false) {
    this.standIndex = index;
    this.standTime = 0;
    this.spawnCursor = 0;
    this.standStuckTimer = 0;
    const stand = this.stand;
    this.world.setStand(stand, immediate);
    if (!immediate) {
      this.advancing = true;
      this.advanceHold = 1.0;
      this.ui.showBanner(`ADVANCING · ${stand.title.toUpperCase()}`, stand.brief ? '' : '', 2000);
      this.audio.riser(1.3, 0.16);
      this.audio.pulse([14, 30, 14]);
    }
    if (stand.brief) setTimeout(() => {
      if (this.state === 'playing') {
        const [speaker, ...rest] = stand.brief.split(':');
        this.ui.showComms(speaker.trim(), rest.join(':').trim());
      }
    }, immediate ? 1200 : 900);
  }

  // --- Frame ----------------------------------------------------------------
  update(dt) {
    this.lastDt = dt;
    this.input.update(dt);
    this.#handleWeaponKeys();

    if (this.state === 'playing') {
      this.#updateStand(dt);
      this.#stepPhysics(dt);
      this.#updateActors(dt);
      this.#updatePickups(dt);
    }

    // Menus and the result screen get a slow attract-mode drift.
    this.attractTime = (this.attractTime || 0) + dt;
    const lead = this.state === 'playing'
      ? this.input.getLeadAngles()
      : { yaw: Math.sin(this.attractTime * 0.16) * 0.3, pitch: Math.sin(this.attractTime * 0.1) * 0.05 };
    this.world.updateCamera(dt, lead);
    this.#updateAimRay();

    if (this.state === 'playing') {
      this.#updateLock();
      this.#updateFiring(dt);
      this.#updateTension();
      this.#checkFailStates();
      this.ui.updateMarkers(this.actors, this.world, this.world.cameraRig.position);
      this.ui.update(this.snapshot());
    }

    this.world.updateAccentLights(this.actors);
    this.world.updateProps(dt);
    this.world.updateFx(dt);
    this.audio.update(dt);
    this.world.render();
  }

  // --- Stand + waves --------------------------------------------------------
  #updateStand(dt) {
    if (this.advancing) {
      this.advanceHold -= dt;
      if (!this.world.advancing && this.advanceHold <= 0) this.advancing = false;
      return;
    }
    this.standTime += dt;
    const waves = this.stand.waves;
    while (this.spawnCursor < waves.length && waves[this.spawnCursor].at <= this.standTime) {
      this.#spawn(waves[this.spawnCursor]);
      this.spawnCursor += 1;
    }

    const hostilesLeft = this.actors.some((a) => a.hostile && a.state !== 'dead');
    if (this.spawnCursor >= waves.length && !hostilesLeft) {
      this.#completeStand();
      return;
    }

    // Safety valve: if a body ends up wedged, make it charge rather than stall.
    if (this.spawnCursor >= waves.length && hostilesLeft) {
      this.standStuckTimer += dt;
      if (this.standStuckTimer > 14) {
        this.actors.forEach((a) => { if (a.hostile && a.state === 'walking') a.speed = Math.max(a.speed, 3.4); });
      }
    }
  }

  #completeStand() {
    const next = this.standIndex + 1;
    this.actors.filter((a) => !a.hostile).forEach((a) => { a.removeMe = true; });
    if (next >= this.level.stands.length) {
      this.#finish(true);
      return;
    }
    this.score += 400;
    this.ui.toast('AREA CLEAR', 1400);
    this.audio.play('warning', 0.32, 0.2);
    this.#enterStand(next);
  }

  #spawn(entry) {
    const origin = this.stand.worldOrigin;
    const x = origin.x + entry.x;
    const z = origin.z + entry.z;

    if (entry.type === 'pickup') {
      this.#spawnPickup(entry.pickup, x, z);
      return;
    }

    const actor = this.factory.create(entry.type, { style: entry.style });
    actor.side = entry.side ?? (entry.x < 0 ? -1 : 1);
    actor.group.position.set(x, 0, z);
    // Authored ambush points sit on their cover. Nudge the body to the far side
    // of it so the reveal genuinely rises from behind the bar/table/pod.
    if (entry.style !== 'charge') this.#tuckBehindCover(actor);
    actor.body.rotation.y = 0;
    actor.setRevealProgress(0);
    actor.setVisible(false);
    actor.state = 'hidden';
    actor.revealTimer = 0;
    this.world.actorGroup.add(actor.group);
    this.actors.push(actor);

    // 'charge' walks in already visible from the back of the room; everything
    // else erupts from cover.
    if (entry.style === 'charge') {
      actor.setVisible(true);
      actor.setRevealProgress(1);
      actor.state = 'walking';
      if (actor.hostile) this.audio.play('scareSting', 0.24, 0.4, 1.2);
    } else {
      this.#reveal(actor);
    }
  }

  /**
   * Stages a spawn against the cover it was authored on.
   *
   * Low cover (bar, table, crate) is *mounted*: the body rises out of it and
   * ends up standing on top, fully visible, before leaping down at the party.
   * Tall cover (lockers, screens, pods) is hidden behind and stepped out of,
   * since rising behind a 2.4m panel would show nothing but a scalp.
   */
  #tuckBehindCover(actor) {
    const pad = PHYSICS.obstaclePadding + actor.radius;
    const p = actor.position;
    for (const box of this.world.obstacles) {
      if (p.x <= box.minX - pad || p.x >= box.maxX + pad) continue;
      if (p.z <= box.minZ - pad || p.z >= box.maxZ + pad) continue;

      if (box.top <= 1.5) {
        actor.groundY = box.top;
        actor.position.y = box.top;
        p.z = (box.minZ + box.maxZ) / 2;
        actor.mounted = true;
      } else {
        p.z = box.minZ - pad - 0.05; // -Z is further from the party
        if (actor.revealStyle === 'popup') actor.revealStyle = 'stepout';
      }
      actor.tuckedBehindCover = true;
      return;
    }
  }

  #reveal(actor) {
    actor.setVisible(true);
    actor.state = 'revealing';
    actor.stateTimer = actor.revealStyle === 'drop' ? 0.5 : 0.42;
    actor.revealDuration = actor.stateTimer;
    const burstAt = actor.position.clone().setY(actor.height * 0.6);
    this.world.revealBurst(burstAt, actor.tint);
    if (actor.hostile) {
      this.audio.play('scareSting', 0.55, 0.18, 0.9 + Math.random() * 0.25);
      this.audio.stab(0.26);
      this.audio.scarePulse();
      this.world.addShake(0.28);
      this.ui.flashDamage(0.22);
    } else {
      this.audio.play('warning', 0.2, 0.3, 1.6);
    }
  }

  #spawnPickup(kind, x, z) {
    const style = PICKUP_STYLE[kind] || PICKUP_STYLE.ammo;
    const group = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.3),
      new THREE.MeshStandardMaterial({
        color: 0x0d1020, emissive: style.color, emissiveIntensity: 1.6,
        roughness: 0.2, metalness: 0.6
      })
    );
    core.userData.hitProxy = true;
    group.add(core);
    const cage = new THREE.Mesh(
      new THREE.BoxGeometry(0.62, 0.62, 0.62),
      new THREE.MeshBasicMaterial({ color: style.color, wireframe: true, transparent: true, opacity: 0.7 })
    );
    cage.raycast = () => {};
    group.add(cage);
    const beam = new THREE.PointLight(style.color, 7, 5, 2);
    group.add(beam);
    group.position.set(x, 1.05, z);
    this.world.actorGroup.add(group);
    this.pickups.push({ mesh: group, cage, kind, age: 0, life: 22 });
  }

  #updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];
      pickup.age += dt;
      pickup.life -= dt;
      pickup.mesh.rotation.y += dt * 1.6;
      pickup.cage.rotation.x += dt * 0.9;
      pickup.mesh.position.y = 1.05 + Math.sin(pickup.age * 2.6) * 0.12;
      if (pickup.life <= 0) {
        this.world.actorGroup.remove(pickup.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  // --- Physics + behaviour --------------------------------------------------
  #stepPhysics(dt) {
    this.physicsAccumulator = Math.min(
      this.physicsAccumulator + dt, PHYSICS.fixedStep * PHYSICS.maxSubsteps
    );
    let steps = 0;
    while (this.physicsAccumulator >= PHYSICS.fixedStep && steps < PHYSICS.maxSubsteps) {
      this.#physicsStep(PHYSICS.fixedStep);
      this.physicsAccumulator -= PHYSICS.fixedStep;
      steps += 1;
    }
  }

  #physicsStep(step) {
    const eye = this.world.cameraRig.position;
    this.actors.forEach((actor) => {
      const walking = actor.state === 'walking';
      let desiredX = 0;
      let desiredZ = 0;

      if (walking) {
        this.tmpDir.set(eye.x - actor.position.x, 0, eye.z - actor.position.z);
        const distance = this.tmpDir.length() || 1;
        this.tmpDir.multiplyScalar(1 / distance);
        // Weave so a group does not march in a straight line.
        let weave = Math.sin(actor.age * (actor.type === 'rusher' ? 2.4 : 1.15) + actor.gait)
          * (actor.type === 'rusher' ? 0.5 : 0.28);
        // Wedged against geometry: commit to sliding one way instead of
        // grinding straight into it.
        if (actor.stuckTimer > 1.2) weave = actor.slideDir * actor.speed * 1.1;
        desiredX = this.tmpDir.x * actor.speed - this.tmpDir.z * weave;
        desiredZ = this.tmpDir.z * actor.speed + this.tmpDir.x * weave;
        if (!actor.hostile) {
          // Civilians run past the party, not into it.
          desiredX += this.tmpDir.z * 1.4 * actor.side;
        }
      }

      const drive = walking ? 8.5 : 2.6;
      const k = Math.min(1, drive * step);
      actor.velocity.x += (desiredX - actor.velocity.x) * k;
      actor.velocity.z += (desiredZ - actor.velocity.z) * k;

      if (!actor.grounded) {
        actor.velocity.y -= PHYSICS.gravity * step;
        actor.velocity.multiplyScalar(Math.exp(-PHYSICS.airDrag * step));
      } else if (!walking) {
        const damp = actor.state === 'knockdown' || actor.state === 'dead' ? 0.4 : 1;
        actor.velocity.x *= Math.exp(-PHYSICS.groundDrag * damp * step);
        actor.velocity.z *= Math.exp(-PHYSICS.groundDrag * damp * step);
      }

      actor.position.addScaledVector(actor.velocity, step);
      actor.angularVelocity *= Math.exp(-(actor.grounded ? 5.0 : 1.6) * step);

      const floor = actor.groundY || 0;
      if (actor.position.y <= floor) {
        if (!actor.grounded && actor.velocity.y < -2.2) {
          actor.velocity.x *= 0.55;
          actor.velocity.z *= 0.6;
          actor.angularVelocity *= 0.4;
          this.world.addShake(0.06);
        }
        actor.position.y = floor;
        actor.velocity.y = 0;
        actor.grounded = true;
      }
      if (actor.vaultTimer > 0) actor.vaultTimer -= step;
      const settled = actor.state !== 'revealing' && actor.state !== 'menace' && !(actor.vaultTimer > 0);
      if (actor.grounded && settled) this.#resolveObstacles(actor);
    });
  }

  #resolveObstacles(actor) {
    if (actor.phaseTimer > 0) return;
    const pad = PHYSICS.obstaclePadding + actor.radius;
    const p = actor.position;
    for (const box of this.world.obstacles) {
      const minX = box.minX - pad;
      const maxX = box.maxX + pad;
      const minZ = box.minZ - pad;
      const maxZ = box.maxZ + pad;
      if (p.x <= minX || p.x >= maxX || p.z <= minZ || p.z >= maxZ) continue;

      // Low furniture gets vaulted, not walked around. The Long Bar spans the
      // whole room; without this, anything behind it can never reach the party
      // and the area never clears.
      const top = box.top ?? 1;
      if (actor.state === 'walking' && actor.grounded && top <= 1.5) {
        actor.velocity.y = Math.sqrt(2 * PHYSICS.gravity * (top + 0.45));
        actor.grounded = false;
        actor.vaultTimer = 1.5;
        actor.stuckTimer = 0;
        return;
      }

      const options = [
        { axis: 'x', depth: p.x - minX, value: minX },
        { axis: 'x', depth: maxX - p.x, value: maxX },
        { axis: 'z', depth: p.z - minZ, value: minZ },
        { axis: 'z', depth: maxZ - p.z, value: maxZ }
      ];
      let best = options[0];
      for (const option of options) if (option.depth < best.depth) best = option;
      p[best.axis] = best.value;
      actor.velocity[best.axis] *= -0.15;
    }
  }

  #updateActors(dt) {
    const eye = this.world.cameraRig.position;
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const actor = this.actors[i];
      actor.stateTimer = Math.max(0, actor.stateTimer - dt);

      if (actor.state === 'revealing') {
        const t = 1 - actor.stateTimer / (actor.revealDuration || 0.42);
        actor.setRevealProgress(easeOutBack(THREE.MathUtils.clamp(t, 0, 1)));
        if (actor.stateTimer <= 0) {
          actor.setRevealProgress(1);
          actor.state = 'menace';
          actor.stateTimer = (ACTOR.menaceTime[actor.type] ?? 0.9) * (0.85 + Math.random() * 0.3);
          // Turn to face the party during the hold.
          actor.body.rotation.y = Math.atan2(eye.x - actor.position.x, eye.z - actor.position.z);
        }
      } else if (actor.state === 'menace' && actor.stateTimer <= 0) {
        actor.state = 'walking';
        // Ambushers came over the furniture, not around it.
        if (actor.tuckedBehindCover) {
          actor.vaultTimer = 1.7;
          actor.velocity.y = actor.mounted ? 2.2 : 6.6;
          actor.groundY = 0;
          actor.grounded = false;
          actor.mounted = false;
          actor.tuckedBehindCover = false;
          this.audio.play('impact', 0.22, 0.1, 1.5);
        }
      } else if (actor.state === 'stagger' && actor.stateTimer <= 0 && actor.grounded) {
        actor.state = 'walking';
      } else if (actor.state === 'knockdown' && actor.stateTimer <= 0 && actor.grounded && actor.hp > 0) {
        actor.state = 'recovering';
        actor.stateTimer = 0.55;
      } else if (actor.state === 'recovering' && actor.stateTimer <= 0) {
        actor.state = 'walking';
      }

      actor.updateAnimation(dt);
      this.#updateStuck(actor, dt);

      const distance = Math.hypot(actor.position.x - eye.x, actor.position.z - eye.z);
      if (actor.state !== 'dead') {
        if (actor.hostile && distance <= ACTOR.breachDistance) {
          this.#breach(actor);
          continue;
        }
        // Civilians escape past the party.
        if (!actor.hostile && actor.position.z > eye.z + 1.5) {
          this.score += 60;
          actor.removeMe = true;
        }
      }
      if (actor.removeMe) this.#removeActor(i);
    }
  }

  /**
   * Nothing may hard-lock an area. A body that stops making progress first
   * commits to sliding around the obstruction, then — as a last resort — walks
   * straight through it rather than stalling the mission forever.
   */
  #updateStuck(actor, dt) {
    if (actor.phaseTimer > 0) actor.phaseTimer -= dt;
    if (actor.state !== 'walking') { actor.stuckTimer = 0; return; }
    const planar = Math.hypot(actor.velocity.x, actor.velocity.z);
    if (planar > actor.speed * 0.28) { actor.stuckTimer = 0; return; }
    if (actor.stuckTimer === 0) actor.slideDir = Math.random() < 0.5 ? -1 : 1;
    actor.stuckTimer += dt;
    if (actor.stuckTimer > 3.5) {
      actor.phaseTimer = 2.5;
      actor.stuckTimer = 0;
    }
  }

  #removeActor(index) {
    const actor = this.actors[index];
    if (this.lockTarget === actor) this.lockTarget = null;
    this.world.actorGroup.remove(actor.group);
    actor.dispose();
    this.actors.splice(index, 1);
  }

  #breach(actor) {
    const damage = ACTOR.breachDamage[actor.type] ?? 14;
    const hitEno = Math.random() < 0.4;
    if (hitEno) this.enoHealth = clamp(this.enoHealth - damage, 0, PLAYER.enoMaxHealth);
    else this.sukiHealth = clamp(this.sukiHealth - damage, 0, PLAYER.maxHealth);

    this.world.petals(actor.position.clone().setY(1.3), actor.tint, 20, 1.3);
    this.world.addShake(0.9);
    this.audio.play('playerHurt', 0.6, 0.12);
    this.audio.stab(0.22);
    this.audio.hurtPulse(true);
    this.ui.flashDamage(1);
    this.ui.toast(hitEno ? 'ENO TOOK THE HIT' : 'SUKI HIT', 1200);
    this.streak = 0;
    this.combo = 1;
    const index = this.actors.indexOf(actor);
    if (index >= 0) this.#removeActor(index);
  }

  // --- Aiming, lock and firing ---------------------------------------------
  #updateAimRay() {

    this.shotDirection = this.world.setRayFromNdc(this.input.getNdc()).clone();
    this.shotOrigin = this.world.rayOrigin.clone();
    this.world.updateAimLight(this.shotOrigin, this.shotDirection, !!this.lockTarget);
    this.world.updateWeaponRig(this.lastDt || 1 / 60, this.shotOrigin, this.shotDirection);
  }

  #updateLock() {
    const acquire = Math.cos(THREE.MathUtils.degToRad(AIM.lockAcquireDeg));
    const retain = Math.cos(THREE.MathUtils.degToRad(AIM.lockRetainDeg));
    const candidates = this.actors.filter((a) =>
      a.hostile && a.hp > 0 && a.state !== 'hidden' && a.state !== 'dead' && a.state !== 'knockdown');

    const alignmentOf = (actor) => {
      actor.aimPoint(this.aimPoint);
      this.tmpDir.copy(this.aimPoint).sub(this.shotOrigin).normalize();
      return this.shotDirection.dot(this.tmpDir);
    };

    if (this.lockTarget) {
      const stillValid = candidates.includes(this.lockTarget)
        && alignmentOf(this.lockTarget) >= retain
        && this.world.hasLineOfSight(this.shotOrigin, this.lockTarget.aimPoint(this.aimPoint));
      if (!stillValid) this.lockTarget = null;
    }

    if (!this.lockTarget) {
      let best = null;
      let bestScore = -Infinity;
      for (const actor of candidates) {
        const alignment = alignmentOf(actor);
        if (alignment < acquire) continue;
        if (!this.world.hasLineOfSight(this.shotOrigin, actor.aimPoint(this.aimPoint))) continue;
        const distance = this.shotOrigin.distanceTo(actor.position);
        // Prefer well-aligned and imminent threats.
        const score = alignment * 3 - distance * 0.02;
        if (score > bestScore) { bestScore = score; best = actor; }
      }
      this.lockTarget = best;
    }

    if (this.lockTarget && this.lockTarget !== this.lastLockTarget) {
      const now = performance.now() / 1000;
      if (now - this.lastLockBeep > AIM.lockBeepGap) {
        this.audio.play('lockBeep', 0.42, 0.05, 1.35);
        this.audio.pulse(12);
        this.lastLockBeep = now;
      }
    }
    this.lastLockTarget = this.lockTarget;
  }

  #shotDirectionFor(spread) {
    this.tmpDir.copy(this.shotDirection);
    if (this.lockTarget) {
      this.lockTarget.aimPoint(this.aimPoint);
      const toTarget = this.tmpPoint.copy(this.aimPoint).sub(this.shotOrigin).normalize();
      const assist = AIM.assistStrength * (this.currentWeapon === 'scatter' ? 0.6 : 1);
      this.tmpDir.lerp(toTarget, assist).normalize();
    }
    if (spread) {
      this.tmpDir.x += (Math.random() - 0.5) * spread;
      this.tmpDir.y += (Math.random() - 0.5) * spread;
      this.tmpDir.z += (Math.random() - 0.5) * spread * 0.3;
      this.tmpDir.normalize();
    }
    return this.tmpDir;
  }

  #beginReload() {
    const id = this.currentWeapon;
    if (this.reloadTimer > 0 || this.mag[id] >= WEAPONS[id].mag || this.reserve[id] <= 0) return;
    this.reloadTimer = WEAPONS[id].reload;
    this.audio.beep(320, 0.07, 0.18, 'square');
    this.audio.pulse(10);
    this.ui.toast('RELOADING', 800);
  }

  #updateReload(dt) {
    if (this.reloadTimer <= 0) return;
    this.reloadTimer -= dt;
    if (this.reloadTimer > 0) return;
    this.reloadTimer = 0;
    const id = this.currentWeapon;
    const need = WEAPONS[id].mag - this.mag[id];
    const taken = Math.min(need, this.reserve[id]);
    this.mag[id] += taken;
    if (Number.isFinite(this.reserve[id])) this.reserve[id] -= taken;
    this.audio.beep(660, 0.06, 0.2, 'triangle');
  }

  #updateFiring(dt) {
    this.fireTimer -= dt;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0 && this.combo > 1) {
      this.combo = Math.max(1, this.combo - dt * SCORE_TUNING.comboDecay);
    }

    const id = this.currentWeapon;
    const weapon = WEAPONS[id];
    this.#updateReload(dt);
    const dry = this.mag[id] <= 0 && this.reserve[id] <= 0;

    this.ui.updateReticle(this.input.aim.x, this.input.aim.y, {
      locked: !!this.lockTarget,
      cooldown: this.reloadTimer > 0
        ? 1 - this.reloadTimer / weapon.reload
        : THREE.MathUtils.clamp(1 - this.fireTimer / weapon.fireRate, 0, 1),
      empty: dry || this.reloadTimer > 0
    });

    if (!this.input.firing || this.fireTimer > 0 || this.advancing || this.reloadTimer > 0) return;

    if (this.mag[id] <= 0) {
      if (this.reserve[id] > 0) { this.#beginReload(); return; }
      this.fireTimer = 0.24;
      // Out of this weapon entirely: fall back to the sidearm, which never runs
      // out, so the run can always continue.
      if (!this.#tryCollectPickup(this.shotDirection)) {
        const now = performance.now();
        if (now - this.emptyToastAt > 900) {
          this.emptyToastAt = now;
          this.switchWeapon('sidearm');
          this.ui.toast('DRY · SWITCHING TO SIDEARM', 1400);
          this.audio.beep(220, 0.09, 0.18, 'square');
        }
      }
      return;
    }

    this.mag[id] -= 1;
    this.fireTimer = weapon.fireRate;
    this.shotsFired += 1;
    this.audio.play('shot', this.currentWeapon === 'scatter' ? 0.55 : 0.38, 0.01,
      0.92 + Math.random() * 0.16);
    this.audio.pulse(this.currentWeapon === 'scatter' ? [18, 10, 18] : 9);
    this.world.addShake(weapon.shake * 0.35);
    this.ui.kickReticle();

    this.world.fireRecoil(weapon.shake + 0.4);
    this.world.muzzlePoint(this.muzzle);

    let anyHit = false;
    const hitThisTrigger = new Set();
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const direction = this.#shotDirectionFor(weapon.spread);
      const hit = this.world.castShot(this.actors, direction, this.shotOrigin);
      const end = hit ? hit.point : this.tmpPoint.copy(this.shotOrigin).addScaledVector(direction, 60).clone();
      if (pellet === 0 || weapon.pellets <= 2) this.world.tracer(this.muzzle.clone(), end.clone(), weapon.color);
      if (!hit) continue;
      if (!hit.actor) {
        this.world.petals(hit.point, 0x9aa6c8, 4, 0.5);
        continue;
      }
      anyHit = true;
      this.#resolveHit(hit.actor, hit.point, weapon, direction, hitThisTrigger);
    }

    if (this.#tryCollectPickup(this.shotDirection)) anyHit = true;
    if (anyHit) this.shotsHit += 1;
    else this.streak = 0;
  }

  #resolveHit(actor, point, weapon, direction, hitThisTrigger) {
    if (!actor.hostile) {
      // A shotgun spread must not count as several separate civilian victims.
      if (hitThisTrigger.has(actor)) return;
      hitThisTrigger.add(actor);
      this.#hitCivilian(actor, point);
      return;
    }
    if (actor.state === 'dead') return;

    const localX = point.x - actor.position.x;
    const hitHeight = point.y - actor.position.y;
    this.tmpImpulse.copy(direction).setY(0).normalize().multiplyScalar(weapon.knockback);
    const { knocked, killed } = actor.hurt(weapon.damage, this.tmpImpulse, hitHeight, localX);

    this.world.petals(point, actor.tint, killed ? 26 : 9, killed ? 1.4 : 0.8);
    this.audio.playVariation(['grunt1', 'grunt2', 'grunt3'], killed ? 0.5 : 0.34, 0.05);
    this.audio.hitPulse(knocked || killed);
    if (killed) {
      this.audio.play('impact', 0.4, 0.06);
      this.#registerKill(actor);
    } else {
      this.ui.toast(`${knocked ? 'KNOCKDOWN · ' : ''}${actor.type.toUpperCase()} ${actor.hp}/${actor.maxHp}`, 900);
    }
    if (this.lockTarget === actor && (killed || knocked)) this.lockTarget = null;
  }

  #registerKill(actor) {
    if (actor.scored) return;
    actor.scored = true;
    this.kills += 1;
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.combo = clamp(this.combo + SCORE_TUNING.comboStep, 1, SCORE_TUNING.comboMax);
    this.comboTimer = 2.6;
    this.score += Math.round((ACTOR.score[actor.type] ?? 120) * this.combo);
    this.world.addShake(0.18);
    this.#checkMilestones();
  }

  #hitCivilian(actor, point) {
    this.friendlyVictims += 1;
    this.combo = 1;
    this.streak = 0;
    this.score = Math.max(0, this.score - 600);
    this.world.petals(point, PALETTE.civilian, 24, 1.1);
    this.audio.play('warning', 0.6, 0.1);
    this.audio.pulse(120);
    this.ui.flashDamage(0.6);
    actor.hp = 0;
    actor.state = 'dead';
    actor.deathTimer = 0.5;
    this.ui.showComms('Eno',
      `That was a civilian — ${this.friendlyVictims} of ${PLAYER.friendlyLimit}. Green rings, Suki. Green rings.`);
  }

  #tryCollectPickup(direction) {
    if (!this.pickups.length) return false;
    this.world.raycaster.set(this.shotOrigin, direction);
    this.world.raycaster.near = 0;
    this.world.raycaster.far = 90;
    const meshes = this.pickups.map((p) => p.mesh);
    const hits = this.world.raycaster.intersectObjects(meshes, true);
    if (!hits.length) return false;
    let node = hits[0].object;
    while (node && !meshes.includes(node)) node = node.parent;
    const index = meshes.indexOf(node);
    if (index < 0) return false;
    this.#collect(this.pickups[index], index);
    return true;
  }

  #collect(pickup, index) {
    const style = PICKUP_STYLE[pickup.kind];
    if (pickup.kind === 'health') {
      this.sukiHealth = clamp(this.sukiHealth + 30, 0, PLAYER.maxHealth);
      this.enoHealth = clamp(this.enoHealth + 22, 0, PLAYER.enoMaxHealth);
      this.ui.toast('NANOGEL · Suki +30 · Eno +22', 1500);
    } else if (pickup.kind === 'ammo') {
      this.unlocked.forEach((id) => {
        if (!Number.isFinite(this.reserve[id])) return;
        this.reserve[id] = clamp(this.reserve[id] + WEAPONS[id].ammoGrant, 0, WEAPONS[id].maxReserve);
      });
      this.ui.toast('AMMO RESUPPLY', 1200);
    } else {
      const id = this.unlocked.has('carbine') ? 'scatter' : 'carbine';
      this.unlocked.add(id);
      this.mag[id] = WEAPONS[id].mag;
      this.reserve[id] = Math.max(this.reserve[id], WEAPONS[id].ammoGrant);
      this.switchWeapon(id);
      this.ui.showComms('Eno', `${WEAPONS[id].name} unlocked. Tap the weapon card or press 1–3 to switch.`);
    }
    this.score += 90;
    this.world.petals(pickup.mesh.position.clone(), style.color, 20, 0.9);
    this.audio.beep(880, 0.09, 0.25);
    this.audio.beep(1320, 0.12, 0.2);
    this.audio.pulse(20);
    this.world.actorGroup.remove(pickup.mesh);
    this.pickups.splice(index, 1);
  }

  // --- Weapons --------------------------------------------------------------
  #handleWeaponKeys() {
    WEAPON_ORDER.forEach((id, i) => {
      const code = `Digit${i + 1}`;
      if (this.input.keys.has(code)) {
        this.switchWeapon(id);
        this.input.keys.delete(code);
      }
    });
  }

  switchWeapon(id) {
    if (!this.unlocked.has(id) || this.currentWeapon === id) return;
    this.currentWeapon = id;
    this.world.setWeapon(id);
    this.ui.toast(`${WEAPONS[id].name.toUpperCase()} EQUIPPED`, 1200);
    this.audio.beep(660, 0.07, 0.2, 'triangle');
  }

  cycleWeapon() {
    const start = WEAPON_ORDER.indexOf(this.currentWeapon);
    for (let i = 1; i <= WEAPON_ORDER.length; i++) {
      const id = WEAPON_ORDER[(start + i) % WEAPON_ORDER.length];
      if (this.unlocked.has(id)) return this.switchWeapon(id);
    }
  }

  // --- Tension, milestones, end states --------------------------------------
  #updateTension() {
    const eye = this.world.cameraRig.position;
    let nearest = Infinity;
    let alive = 0;
    this.actors.forEach((a) => {
      if (!a.hostile || a.state === 'dead' || a.state === 'hidden') return;
      alive += 1;
      nearest = Math.min(nearest, a.position.distanceTo(eye));
    });
    const proximity = Number.isFinite(nearest) ? clamp(1 - (nearest - 2) / 12, 0, 1) : 0;
    const pressure = clamp(alive / 5, 0, 1);
    const health = 1 - Math.min(this.sukiHealth, this.enoHealth) / 100;
    this.audio.setTension(clamp(proximity * 0.55 + pressure * 0.25 + health * 0.35, 0, 1));
  }

  #checkMilestones() {
    const lines = [
      [5, 'Eno', 'Clean. Keep your ring on the red ones and nothing else.'],
      [15, 'Suki', 'They keep looking at me like I am the last drink at the bar.'],
      [30, 'Eno', 'Half the floor is down. Stay with me, Suki.'],
      [50, 'Suki', 'Commander, when this is over you owe me a quiet room and a bad idea.']
    ];
    lines.forEach(([count, speaker, text]) => {
      if (this.kills >= count && !this.milestones.has(count)) {
        this.milestones.add(count);
        this.ui.showComms(speaker, text);
      }
    });
  }

  #checkFailStates() {
    if (this.sukiHealth <= 0) this.#finish(false, 'suki');
    else if (this.enoHealth <= 0) this.#finish(false, 'eno');
    else if (this.friendlyVictims >= PLAYER.friendlyLimit) this.#finish(false, 'friendly');
  }

  #finish(won, reason = '') {
    if (this.state !== 'playing') return;
    this.state = won ? 'win' : 'loss';
    this.input.enabled = false;
    this.input.firing = false;
    this.lockTarget = null;
    this.audio.setTension(won ? 0.1 : 0.6);
    this.ui.clearMarkers();

    const hasNext = this.levelIndex + 1 < LEVELS.length;
    const summary = won
      ? (this.level.outro
        ? `<strong>${this.level.outro.speaker}:</strong> ${this.level.outro.text}`
        : 'Area secured.')
      : reason === 'friendly'
        ? '<strong>Eno:</strong> Three civilians. Command is pulling your badge before you ever had one.'
        : reason === 'eno'
          ? '<strong>Suki:</strong> Eno — <em>Eno</em>. Do not you dare. Not on my floor.'
          : '<strong>Eno:</strong> Suki is down. Falling back. This is not how tonight ends.';

    this.ui.showResult(won, {
      ...this.snapshot(),
      resultTitle: hasNext ? `${this.level.name} Secured` : 'Desire Protocol Complete',
      resultSummary: summary,
      hasNextLevel: hasNext
    });
    this.ui.setScreen('result');
    this.audio.play(won ? 'warning' : 'impact', won ? 0.4 : 0.6, 0.2);
    this.onMissionEnd(won, hasNext);
  }

  restartLevel() { this.startLevel(this.levelIndex, { freshRun: true }); }

  nextLevel() {
    if (this.levelIndex + 1 >= LEVELS.length) return false;
    this.startLevel(this.levelIndex + 1);
    return true;
  }

  snapshot() {
    const weapon = WEAPONS[this.currentWeapon];
    const stand = this.level?.stands?.[this.standIndex];
    const totalWaves = stand?.waves?.length || 1;
    return {
      score: this.score,
      combo: this.combo,
      streak: this.streak,
      bestStreak: this.bestStreak,
      kills: this.kills,
      sukiHealth: this.sukiHealth,
      enoHealth: this.enoHealth,
      friendlyVictims: this.friendlyVictims,
      friendlyLimit: PLAYER.friendlyLimit,
      weaponName: weapon.name,
      ammo: this.mag[this.currentWeapon],
      magSize: weapon.mag,
      reserve: this.reserve[this.currentWeapon],
      reloading: this.reloadTimer > 0,
      standTitle: stand ? stand.title : '',
      standProgress: this.level
        ? (this.standIndex + Math.min(1, this.spawnCursor / totalWaves)) / this.level.stands.length
        : 0,
      accuracy: this.shotsFired ? this.shotsHit / this.shotsFired : 0
    };
  }
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
