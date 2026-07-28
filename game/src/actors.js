// Characters.
//
// Every actor is a real rigged, animated body (Kenney CC0 `characterMedium`)
// rather than a billboard. Readability against a near-black club comes from a
// fresnel rim injected into the standard material — the same hot-pink edge glow
// the concept art uses — plus glowing eyes and a floor ring.

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { ASSETS, CLIP_NAMES, ACTOR, PALETTE, PHYSICS } from './config.js';

// Tight, high-contrast edge: a broad rim turns the whole body into a glowing
// blob and loses the silhouette that makes them read as men in torn suits.
const _v = new THREE.Vector3();

const RIM_POWER = { model: 3.4, rusher: 3.2, elite: 3.4, brute: 3.0, civilian: 3.2 };
const RIM_STRENGTH = { hostile: 1.35, civilian: 1.0 };

const SUIT_COLORS = [0x14101c, 0x181020, 0x0f1420, 0x1a1018];
const SKIN_COLORS = [0xd8b9b0, 0xc9a08f, 0xe4c8bd, 0xb98f7d];

function pick(list, seed) { return list[Math.floor(seed * list.length) % list.length]; }

/** Adds a view-dependent rim glow to a standard material. */
function applyRim(material, color, power, strength) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = { value: new THREE.Color(color) };
    shader.uniforms.uRimPower = { value: power };
    shader.uniforms.uRimStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform vec3 uRimColor;
         uniform float uRimPower;
         uniform float uRimStrength;
         void main() {`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           vec3 vd = normalize( vViewPosition );
           float rim = 1.0 - clamp( abs( dot( normal, vd ) ), 0.0, 1.0 );
           totalEmissiveRadiance += uRimColor * pow( rim, uRimPower ) * uRimStrength;
         }`
      );
    material.userData.shader = shader;
  };
  // Distinguishes program caches so variants do not share a compiled shader.
  material.customProgramCacheKey = () => `rim-${color}-${power}-${strength}`;
  return material;
}

export class ActorFactory {
  constructor() {
    this.template = null;
    this.clips = {};
    this.ready = false;
    this.report = {};
    this.pending = [];
  }

  async load() {
    // Preferred: the re-proportioned character built by tools/build_infected.py —
    // one GLB carrying mesh, skeleton and both clips, with separate skin/suit/
    // shirt material slots. Falls back to the original Kenney FBX set.
    const glb = await new Promise((resolve) => {
      new GLTFLoader().load(ASSETS.character, resolve, undefined, () => resolve(null));
    });

    if (glb?.scene) {
      const root = glb.scene;
      // Must update world matrices first: Box3.setFromObject on a freshly
      // parsed glTF otherwise misses the armature node's scale and under-reports
      // the height, which scaled every actor to double size.
      root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(root);
      const height = box.getSize(new THREE.Vector3()).y || 1;
      root.scale.setScalar(1 / height);
      this.template = root;
      this.source = 'glb';
      this.report.rig = `glb ${(height).toFixed(2)}u`;
      this.clips.run = glb.animations.find((c) => /run/i.test(c.name)) || null;
      this.clips.idle = glb.animations.find((c) => /idle/i.test(c.name)) || null;
    } else {
      const loader = new FBXLoader();
      const loadFbx = (url) => new Promise((resolve) => loader.load(url, resolve, undefined, () => resolve(null)));
      const [rig, runFile, idleFile] = await Promise.all([
        loadFbx(ASSETS.rig), loadFbx(ASSETS.clipRun), loadFbx(ASSETS.clipIdle)
      ]);
      if (rig) {
        const box = new THREE.Box3().setFromObject(rig);
        const height = box.getSize(new THREE.Vector3()).y || 1;
        rig.scale.setScalar(1 / height);
        rig.rotation.y = Math.PI; // face +Z, i.e. toward the player
        this.template = rig;
        this.source = 'fbx';
        this.report.rig = 'fbx fallback';
      } else {
        this.report.rig = 'failed · procedural bodies';
      }
      // The run FBX also contains a 0.04s "Targeting Pose"; picking animations[0]
      // blindly is what left the old build with no walk cycle at all.
      this.clips.run = pickClip(runFile, CLIP_NAMES.run);
      this.clips.idle = pickClip(idleFile, CLIP_NAMES.idle);
    }

    this.report.run = this.clips.run ? `"${this.clips.run.name}" ${this.clips.run.duration.toFixed(2)}s` : 'failed';
    this.report.idle = this.clips.idle ? `"${this.clips.idle.name}" ${this.clips.idle.duration.toFixed(2)}s` : 'failed';
    this.ready = true;
    return this.report;
  }

  create(type, options = {}) {
    return new Actor(this, type, options);
  }
}

function pickClip(file, names) {
  if (!file?.animations?.length) return null;
  for (const name of names) {
    const found = file.animations.find((clip) => clip.name === name);
    if (found) return found;
  }
  // Fall back to the longest clip — never a one-frame pose.
  return file.animations.slice().sort((a, b) => b.duration - a.duration)[0] || null;
}

export class Actor {
  constructor(factory, type, options = {}) {
    this.type = type;
    this.hostile = type !== 'civilian';
    this.height = ACTOR.heightByType[type] ?? 1.85;
    this.radius = ACTOR.radiusByType[type] ?? 0.38;
    this.maxHp = ACTOR.hpByType[type] ?? 1;
    this.hp = this.maxHp;
    this.mass = ACTOR.massByType[type] ?? 1;
    this.speed = (ACTOR.speedByType[type] ?? 1.6) * (0.9 + Math.random() * 0.22);
    this.seed = Math.random();

    this.group = new THREE.Group();
    this.group.userData.actor = this;
    this.velocity = new THREE.Vector3();
    this.angularVelocity = 0;
    this.grounded = true;
    this.groundY = 0;        // raised while perched on low cover
    this.vaultTimer = 0;
    this.mounted = false;
    this.stuckTimer = 0;
    this.phaseTimer = 0;
    this.slideDir = 1;
    this.state = 'hidden';     // hidden | revealing | walking | stagger | knockdown | recovering | dead
    this.stateTimer = 0;
    this.age = 0;
    this.gait = Math.random() * Math.PI * 2;
    this.flinch = 0;
    this.impactSide = 1;
    this.revealStyle = options.style || 'popup';
    this.removeMe = false;
    this.scored = false;
    this.deathTimer = 0;
    this.tint = this.hostile
      ? (type === 'brute' ? PALETTE.infectedBrute : type === 'elite' ? PALETTE.infectedElite : PALETTE.infected)
      : PALETTE.civilian;

    this.#buildBody(factory);
    this.#buildDressing();
    this.setRevealProgress(0);
  }

  #buildBody(factory) {
    this.body = new THREE.Group();
    this.group.add(this.body);

    if (factory.template) {
      const rig = cloneSkeleton(factory.template);
      rig.scale.multiplyScalar(this.height);
      const suit = pick(SUIT_COLORS, this.seed);
      const skin = pick(SKIN_COLORS, this.seed * 7 % 1);
      const power = RIM_POWER[this.type] ?? 3.2;
      const strength = this.hostile ? RIM_STRENGTH.hostile : RIM_STRENGTH.civilian;
      this.materials = [];
      // Rim is per-slot: a thin limb is nearly all grazing angle, so a uniform
      // fresnel turns the trousers into solid neon. The suit carries the dark
      // mass and only wants an edge; skin and shirt carry the light.
      const slotFor = (name) => {
        const n = (name || '').toLowerCase();
        if (!this.hostile) {
          if (n.includes('skin')) return { color: 0xdcc3b6, rough: 0.62, metal: 0.0, rim: 0.55 };
          if (n.includes('shirt')) return { color: 0xeef2f7, rough: 0.7, metal: 0.0, rim: 0.5 };
          return { color: 0x6f93a8, rough: 0.75, metal: 0.02, rim: 0.9 };
        }
        if (n.includes('skin')) return { color: skin, rough: 0.52, metal: 0.0, rim: 0.55 };
        if (n.includes('shirt')) return { color: 0x9a94a2, rough: 0.68, metal: 0.0, rim: 0.45 };
        return { color: suit, rough: 0.44, metal: 0.18, rim: 1.0 };
      };
      rig.traverse((child) => {
        if (!child.isMesh && !child.isSkinnedMesh) return;
        const spec = slotFor(child.material?.name);
        const m = new THREE.MeshStandardMaterial({
          color: spec.color, roughness: spec.rough, metalness: spec.metal,
          emissive: new THREE.Color(this.tint).multiplyScalar(0.03)
        });
        applyRim(m, this.tint, power, strength * (spec.rim ?? 1));
        m.userData.rimScale = spec.rim ?? 1;
        child.material = m;
        this.materials.push(m);
        child.castShadow = true;
        child.receiveShadow = false;
        child.frustumCulled = false;
        child.userData.hitProxy = true;
      });
      // `material` stays the primary handle for flash/fade; the rest follow it.
      this.material = this.materials[0];
      this.rig = rig;
      this.body.add(rig);
      this.skinTone = skin;

      this.mixer = new THREE.AnimationMixer(rig);
      this.mixer.time = Math.random() * 1.4;
      if (factory.clips.run) {
        this.runAction = this.mixer.clipAction(factory.clips.run);
        this.runAction.play();
        this.runAction.setEffectiveWeight(0);
      }
      if (factory.clips.idle) {
        this.idleAction = this.mixer.clipAction(factory.clips.idle);
        this.idleAction.play();
        this.idleAction.setEffectiveWeight(1);
      }
      this.head = rig.getObjectByName('Head');
      this.spine = rig.getObjectByName('Spine');
      this.chestBone = rig.getObjectByName('UpperChest') || rig.getObjectByName('Chest') || this.spine;
    } else {
      this.#buildProceduralBody();
    }

    this.#addDetails();

    // Invisible capsule so a shot that clips past a thin limb still counts.
    const hitbox = new THREE.Mesh(
      new THREE.CylinderGeometry(this.radius * 1.15, this.radius * 1.05, this.height * 0.94, 8, 1, true),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitbox.position.y = this.height * 0.5;
    hitbox.userData.hitProxy = true;
    this.hitbox = hitbox;
    this.body.add(hitbox);
  }

  /** Articulated stand-in if the FBX ever fails — still a body, never a cutout. */
  #buildProceduralBody() {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: this.hostile ? 0x15111d : 0x9fb6c8, roughness: 0.5, metalness: 0.1
    });
    applyRim(material, this.tint, 3.2, this.hostile ? RIM_STRENGTH.hostile : RIM_STRENGTH.civilian);
    this.material = material;
    const h = this.height;
    const add = (geo, x, y, z) => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.userData.hitProxy = true;
      group.add(mesh);
      return mesh;
    };
    add(new THREE.CapsuleGeometry(this.radius * 0.78, h * 0.32, 4, 10), 0, h * 0.66, 0);
    this.procHead = add(new THREE.SphereGeometry(h * 0.1, 12, 10), 0, h * 0.93, 0);
    this.procLegs = [
      add(new THREE.CapsuleGeometry(this.radius * 0.3, h * 0.36, 4, 8), -this.radius * 0.42, h * 0.24, 0),
      add(new THREE.CapsuleGeometry(this.radius * 0.3, h * 0.36, 4, 8), this.radius * 0.42, h * 0.24, 0)
    ];
    this.procArms = [
      add(new THREE.CapsuleGeometry(this.radius * 0.24, h * 0.34, 4, 8), -this.radius * 1.25, h * 0.63, 0.06),
      add(new THREE.CapsuleGeometry(this.radius * 0.24, h * 0.34, 4, 8), this.radius * 1.25, h * 0.63, 0.06)
    ];
    this.body.add(group);
    this.procRoot = group;
    this.head = this.procHead;
  }

  /**
   * Glowing eyes, hair and an open collar.
   *
   * These are *not* parented to the bones: FBX skeletons carry their own
   * arbitrary scale, so a child of the Head bone lands metres away at the wrong
   * size. Instead the sockets live in group space and are snapped to the bones'
   * world positions each frame, which is scale-agnostic.
   */
  #addDetails() {
    const head = new THREE.Group();
    const eyeMat = new THREE.MeshBasicMaterial({
      color: this.hostile ? 0xff6fc0 : 0xbfffe4, toneMapped: false
    });
    const r = this.height * 0.021;
    [-1, 1].forEach((side) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), eyeMat);
      eye.position.set(side * this.height * 0.055, this.height * 0.015, this.height * 0.115);
      eye.raycast = () => {};
      head.add(eye);
    });

    // Swept hair: reads as a silhouette even when the face is unlit.
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(this.height * 0.128, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
      new THREE.MeshStandardMaterial({
        color: this.hostile ? 0x0a070e : 0x33262e, roughness: 0.4, metalness: 0.12
      })
    );
    hair.scale.set(1.04, 1.0, 1.12);
    hair.position.set(0, this.height * 0.03, -this.height * 0.012);
    hair.rotation.x = -0.14;
    hair.raycast = () => {};
    head.add(hair);

    this.headSocket = head;
    this.eyeMaterial = eyeMat;
    this.group.add(head);

    // Open dress shirt over a bare chest — the one bright shape on the body.
    const chest = new THREE.Group();
    if (this.hostile) {
      const shirtMat = new THREE.MeshStandardMaterial({
        color: 0x6d6675, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide
      });
      [-1, 1].forEach((side) => {
        const lapel = new THREE.Mesh(
          new THREE.PlaneGeometry(this.height * 0.03, this.height * 0.15), shirtMat
        );
        lapel.position.set(side * this.height * 0.035, this.height * 0.03, this.height * 0.105);
        lapel.rotation.z = side * 0.3;
        lapel.raycast = () => {};
        chest.add(lapel);
      });
    }
    this.chestSocket = chest;
    this.group.add(chest);
  }

  /** Snaps the detail sockets onto their bones in world space. */
  #syncSockets() {
    if (!this.headSocket) return;
    const bone = this.head;
    if (bone) {
      bone.getWorldPosition(_v);
      this.group.worldToLocal(_v);
      this.headSocket.position.set(_v.x, _v.y + this.height * 0.133, _v.z);
    } else {
      this.headSocket.position.set(this.body.position.x, this.height * 0.93, this.body.position.z);
    }
    this.headSocket.rotation.set(this.body.rotation.x, this.body.rotation.y, this.body.rotation.z);

    if (!this.chestSocket) return;
    const spine = this.chestBone;
    if (spine) {
      spine.getWorldPosition(_v);
      this.group.worldToLocal(_v);
      this.chestSocket.position.copy(_v);
    } else {
      this.chestSocket.position.set(this.body.position.x, this.height * 0.66, this.body.position.z);
    }
    this.chestSocket.rotation.set(this.body.rotation.x, this.body.rotation.y, this.body.rotation.z);
  }

  #buildDressing() {
    // Floor ring: the single fastest friend-or-foe read at a glance.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.radius * 1.25, this.radius * 1.75, 28),
      new THREE.MeshBasicMaterial({
        color: this.tint, transparent: true, opacity: 0.75,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    ring.raycast = () => {};
    this.ring = ring;
    this.group.add(ring);

    // Cheap contact shadow.
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(this.radius * 1.5, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false })
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.012;
    blob.raycast = () => {};
    this.group.add(blob);
    this.shadowBlob = blob;
  }

  get position() { return this.group.position; }

  /** Eye-level point used for lock-on and marker projection. */
  aimPoint(out = new THREE.Vector3()) {
    return out.set(this.group.position.x, this.group.position.y + this.height * 0.62, this.group.position.z);
  }

  setRevealProgress(t) {
    this.revealProgress = t;
    const style = this.revealStyle;
    if (style === 'popup' || style === 'pod' || style === 'stage') {
      // Rises from behind cover.
      this.body.position.y = -this.height * (1 - t) * 0.92;
      this.body.rotation.x = (1 - t) * -0.32;
    } else if (style === 'stepout') {
      this.body.position.x = (this.side || 1) * -0.95 * (1 - t);
      this.body.position.y = 0;
    } else if (style === 'drop') {
      this.body.position.y = (1 - t) * 3.4;
    } else if (style === 'curtain') {
      this.body.position.z = -1.1 * (1 - t);
      this.body.position.y = 0;
    } else {
      this.body.position.set(0, 0, 0);
    }
    const clip = style === 'popup' || style === 'pod' || style === 'stage';
    this.ring.material.opacity = 0.75 * t;
    if (clip) this.shadowBlob.material.opacity = 0.45 * t;
  }

  setVisible(visible) {
    this.group.visible = visible;
  }

  hurt(damage, impulse, hitHeight, localX) {
    this.hp -= damage;
    this.flinch = 0.22;
    this.impactSide = localX >= 0 ? -1 : 1;
    this.velocity.addScaledVector(impulse, 1 / this.mass);
    this.velocity.y += (hitHeight > this.height * 0.72 ? 2.4 : 1.0) + impulse.length() * 0.1 / this.mass;
    this.angularVelocity += THREE.MathUtils.clamp(-localX * 2.6, -5, 5) / this.mass;
    this.grounded = false;

    const energy = impulse.length() / this.mass + Math.abs(localX) * 1.1;
    const knocked = this.hp <= 0 || energy >= PHYSICS.knockdownEnergy || hitHeight > this.height * 0.95;
    if (this.hp <= 0) {
      this.state = 'dead';
      this.stateTimer = 0;
      this.deathTimer = PHYSICS.deathFade;
      this.angularVelocity += this.impactSide * (3.2 / this.mass);
    } else if (knocked) {
      this.state = 'knockdown';
      this.stateTimer = 0.95 + this.mass * 0.16;
      this.angularVelocity += this.impactSide * (2.8 / this.mass);
    } else {
      this.state = 'stagger';
      this.stateTimer = 0.26 + Math.min(0.24, energy * 0.02);
    }
    return { knocked, killed: this.hp <= 0 };
  }

  updateAnimation(dt) {
    this.age += dt;
    this.mixer?.update(dt);

    const planar = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.state === 'walking' && planar > 0.15;
    const ratio = Math.min(1.5, planar / Math.max(0.3, this.speed));

    if (this.runAction && this.idleAction) {
      const target = moving ? 1 : 0;
      const w = THREE.MathUtils.damp(this.runAction.getEffectiveWeight(), target, 11, dt);
      this.runAction.setEffectiveWeight(w);
      this.idleAction.setEffectiveWeight(1 - w);
      this.runAction.timeScale = THREE.MathUtils.clamp(ratio * 0.85, 0.45, 1.7);
    } else if (this.procRoot) {
      this.gait += dt * (moving ? 6 + ratio * 4 : 1.6);
      const swing = Math.sin(this.gait);
      this.procLegs?.forEach((leg, i) => { leg.position.z = swing * (i ? -1 : 1) * 0.22 * (moving ? 1 : 0.1); });
      this.procArms?.forEach((arm, i) => { arm.position.z = 0.06 + swing * (i ? 1 : -1) * 0.18 * (moving ? 1 : 0.12); });
      this.procRoot.position.y = moving ? Math.abs(swing) * 0.045 : Math.sin(this.age * 2) * 0.012;
    }

    // Face the direction of travel.
    if (moving) {
      const yaw = Math.atan2(this.velocity.x, this.velocity.z);
      this.body.rotation.y = dampAngle(this.body.rotation.y, yaw, 9, dt);
    }

    // Procedural hit flinch and topple.
    this.flinch = Math.max(0, this.flinch - dt * 3.4);
    const knocked = this.state === 'knockdown' || this.state === 'dead';
    const targetRoll = knocked ? this.impactSide * 1.42 : this.state === 'stagger' ? this.impactSide * 0.3 : 0;
    this.body.rotation.z = THREE.MathUtils.damp(this.body.rotation.z, targetRoll, knocked ? 7 : 12, dt);
    if (this.spine) this.spine.rotation.x = -this.flinch * 0.5;

    // Hit flash + a pulse so a lurking body still reads as alive.
    const base = this.hostile ? RIM_STRENGTH.hostile : RIM_STRENGTH.civilian;
    const pulse = this.hostile ? Math.sin(this.age * 3.4 + this.seed * 6) * 0.18 : 0;
    const rim = base + pulse + this.flinch * 6;
    for (const m of (this.materials || [this.material])) {
      const shader = m?.userData?.shader;
      if (shader?.uniforms?.uRimStrength) {
        shader.uniforms.uRimStrength.value = rim * (m.userData.rimScale ?? 1);
      }
    }
    if (this.eyeMaterial) {
      const glow = 1 + this.flinch * 3 + (this.hostile ? Math.sin(this.age * 5 + this.seed * 4) * 0.2 : 0);
      this.eyeMaterial.color.setHex(this.hostile ? 0xff6fc0 : 0xbfffe4).multiplyScalar(glow);
    }
    this.#syncSockets();
    this.ring.rotation.z -= dt * 0.8;
    this.ring.material.opacity = (knocked ? 0.25 : 0.72) * (this.revealProgress ?? 1);

    if (this.state === 'dead') {
      this.deathTimer -= dt;
      const fade = THREE.MathUtils.clamp(this.deathTimer / PHYSICS.deathFade, 0, 1);
      this.group.scale.setScalar(0.6 + fade * 0.4);
      for (const m of (this.materials || [this.material])) {
        if (!m) continue;
        m.transparent = true;
        m.opacity = fade;
      }
      if (this.deathTimer <= 0) this.removeMe = true;
    }
  }

  dispose() {
    this.mixer?.stopAllAction();
    this.group.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        if (child.material && child.material !== this.material) child.material.dispose?.();
      }
    });
    (this.materials || [this.material]).forEach((m) => m?.dispose?.());
  }
}

function dampAngle(current, target, lambda, dt) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-lambda * dt));
}
