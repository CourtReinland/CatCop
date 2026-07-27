// Scene, environment and effects.
//
// Rooms are built procedurally from the level data so the club can have many
// distinct areas with no asset cost. The single most important lighting choice
// here is the aim beam: a spotlight bound to the reticle ray, so the club stays
// pitch dark and *you* are the thing that reveals what is standing in it.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ASSETS, CAMERA, PALETTE, WEAPONS } from './config.js';

const shared = {};
function mat(key, make) {
  if (!shared[key]) shared[key] = make();
  return shared[key];
}

const surface = (color, opts = {}) => new THREE.MeshStandardMaterial({
  color, roughness: 0.62, metalness: 0.12, ...opts
});
// Neon trim is set dressing, not a light source — full-brightness unlit strips
// read as blown-out bars across a phone screen.
const neonMat = (color) => new THREE.MeshBasicMaterial({
  color: new THREE.Color(color).multiplyScalar(0.62), toneMapped: true
});

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x03020a);

    this.camera = new THREE.PerspectiveCamera(70, 1, CAMERA.near, CAMERA.far);
    this.cameraRig = new THREE.Group();
    this.cameraRig.add(this.camera);
    this.scene.add(this.cameraRig);
    this.baseQuaternion = new THREE.Quaternion();

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: false, powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.levelGroup = new THREE.Group();
    this.actorGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.scene.add(this.levelGroup, this.actorGroup, this.fxGroup);

    this.occluders = [];          // block shots and line of sight
    this.obstacles = [];          // AABBs that push bodies out
    this.flickerLights = [];
    this.animatedProps = [];
    this.standLights = [];        // per-stand lights, gated so mobile survives
    this.pendingStandLights = [];

    this.raycaster = new THREE.Raycaster();
    this.rayOrigin = new THREE.Vector3();
    this.rayDirection = new THREE.Vector3();
    this.tmpA = new THREE.Vector3();
    this.tmpB = new THREE.Vector3();
    this.tmpQ = new THREE.Quaternion();
    this.tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');

    this.shakeAmount = 0;
    this.shakeTime = 0;
    this.time = 0;
    this.standOrigin = new THREE.Vector3();
    this.standTarget = new THREE.Vector3();

    this.#createRigLights();
    this.#createWeaponRig();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // --- First-person weapon --------------------------------------------------
  #createWeaponRig() {
    // Held low-right and swung to follow the reticle, House-of-the-Dead style.
    this.weaponRig = new THREE.Group();
    this.weaponRig.position.set(0.26, -0.27, -0.7);
    this.camera.add(this.weaponRig);
    this.weaponModels = new Map();
    this.activeWeapon = 'sidearm';
    this.recoil = 0;
    this.weaponAimPoint = new THREE.Vector3();

    this.muzzleFlash = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshBasicMaterial({
        color: 0xfff0c4, transparent: true, opacity: 0, toneMapped: false
      })
    );
    this.muzzleFlash.position.set(0, 0, -0.34);
    this.muzzleFlash.raycast = () => {};
    this.weaponRig.add(this.muzzleFlash);

    const loader = new GLTFLoader();
    Object.values(WEAPONS).forEach((weapon) => {
      loader.load(ASSETS[weapon.asset], (gltf) => {
        const model = gltf.scene;
        const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
        model.scale.setScalar(0.34 / (Math.max(size.x, size.y, size.z) || 1));
        model.rotation.set(0, Math.PI, 0);
        model.visible = weapon.id === this.activeWeapon;
        model.traverse((child) => {
          if (!child.isMesh) return;
          child.material = child.material.clone();
          child.material.metalness = 0.78;
          child.material.roughness = 0.3;
          // Kit models ship bright; darken so the gun frames the shot instead
          // of glowing in the corner of a near-black club.
          child.material.color?.multiplyScalar(0.42);
          child.material.emissive?.setHex(0x0a0812);
          child.castShadow = false;
          child.raycast = () => {};
        });
        this.weaponRig.add(model);
        this.weaponModels.set(weapon.id, model);
      }, undefined, () => { /* the game plays fine with no visible gun */ });
    });
  }

  setWeapon(id) {
    this.activeWeapon = id;
    this.weaponModels?.forEach((model, key) => { model.visible = key === id; });
  }

  /** Swings the held weapon toward the shot ray and decays recoil. */
  updateWeaponRig(dt, origin, direction) {
    if (!this.weaponRig) return;
    this.weaponAimPoint.copy(origin).addScaledVector(direction, 14);
    this.camera.worldToLocal(this.weaponAimPoint);
    this.weaponRig.lookAt(this.weaponAimPoint);

    this.recoil = Math.max(0, this.recoil - dt * 6);
    const kick = this.recoil * this.recoil;
    this.weaponRig.position.set(0.26, -0.27 - kick * 0.03, -0.7 + kick * 0.15);
    this.weaponRig.rotateX(kick * 0.45);
    this.muzzleFlash.material.opacity = Math.min(1, this.recoil * 2.2);
    this.muzzleFlash.scale.setScalar(0.7 + this.recoil * 1.6);
  }

  /** World position of the barrel tip, so tracers start at the gun. */
  muzzlePoint(out = new THREE.Vector3()) {
    if (!this.muzzleFlash) return out.copy(this.cameraRig.position);
    return this.muzzleFlash.getWorldPosition(out);
  }

  fireRecoil(strength = 1) {
    this.recoil = Math.min(1.4, this.recoil + 0.55 * strength);
  }

  #createRigLights() {
    this.hemi = new THREE.HemisphereLight(0x3a2b52, 0x0a0410, 0.5);
    this.scene.add(this.hemi);

    // Dim overhead key so bodies and props keep some form even outside the beam.
    this.key = new THREE.DirectionalLight(0x9ab4e0, 1.45);
    this.key.position.set(-4, 12, 6);
    this.scene.add(this.key, this.key.target);

    // The aim beam. Re-aimed at the reticle ray every frame — this is Suki's
    // torch as much as her sight, and it is what makes the dark club playable.
    this.aimLight = new THREE.SpotLight(0xd8ecff, 90, 30, THREE.MathUtils.degToRad(30), 0.6, 1.3);
    this.aimLight.castShadow = true;
    this.aimLight.shadow.mapSize.set(1024, 1024);
    this.aimLight.shadow.camera.near = 0.4;
    this.aimLight.shadow.camera.far = 28;
    this.aimLight.shadow.bias = -0.0012;
    this.aimTarget = new THREE.Object3D();
    this.scene.add(this.aimLight, this.aimTarget);
    this.aimLight.target = this.aimTarget;

    // Soft fill from behind the player so silhouettes never go fully black.
    this.fill = new THREE.PointLight(0x7f8cff, 9, 20, 2);
    this.scene.add(this.fill);

    // A pool of accent lights assigned to the nearest revealed hostiles.
    this.accentPool = Array.from({ length: 4 }, () => {
      const light = new THREE.PointLight(PALETTE.infected, 0, 7.5, 2);
      this.scene.add(light);
      return light;
    });
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const aspect = w / Math.max(1, h);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = aspect;
    // Solve vertical FOV from the desired horizontal FOV so portrait phones do
    // not get a straw-width view of the room.
    const halfH = THREE.MathUtils.degToRad(CAMERA.horizontalFovDeg) / 2;
    const vFov = 2 * Math.atan(Math.tan(halfH) / aspect);
    this.camera.fov = THREE.MathUtils.clamp(
      THREE.MathUtils.radToDeg(vFov), CAMERA.minVerticalFovDeg, CAMERA.maxVerticalFovDeg
    );
    this.camera.updateProjectionMatrix();
  }

  // --- Level construction ---------------------------------------------------
  buildLevel(level) {
    this.clearLevel();
    this.scene.fog = new THREE.FogExp2(level.fog.color, level.fog.density);
    this.scene.background = new THREE.Color(level.fog.color).multiplyScalar(0.35);
    this.hemi.color.setHex(level.ambient.sky);
    this.hemi.groundColor.setHex(level.ambient.ground);
    this.hemi.intensity = level.ambient.intensity;

    level.stands.forEach((stand, index) => this.#buildStand(stand, index, level));
    this.setStand(level.stands[0], true);
  }

  clearLevel() {
    this.levelGroup.clear();
    this.occluders.length = 0;
    this.obstacles.length = 0;
    this.flickerLights.length = 0;
    this.animatedProps.length = 0;
    this.standLights.length = 0;
  }

  /**
   * Only the current area (and its neighbours) keeps live lights. A six-room
   * level otherwise stacks 20+ point lights into one forward-rendered pass.
   */
  #gateStandLights(index) {
    this.standLights.forEach((entry) => {
      const near = Math.abs(entry.stand - index) <= 1;
      entry.lights.forEach((light) => { light.visible = near; });
    });
  }

  #buildStand(stand, index, level) {
    const [ox, , oz] = stand.origin;
    const group = new THREE.Group();
    group.position.set(ox, 0, oz);
    this.levelGroup.add(group);
    stand.worldOrigin = new THREE.Vector3(ox, 0, oz);
    stand.index = index;

    const room = stand.room;
    const halfW = room.width / 2;

    // Rooms tile along -Z rather than each being a closed box. A per-room back
    // wall lands on top of the *next* stand, walling the player in and blocking
    // every shot from that point on, so only the final area is closed off.
    const origins = level.stands.map((s) => s.origin[2]);
    const isLast = index === origins.length - 1;
    const nearZ = index === 0 ? oz + 4.5 : oz + 3;               // behind the player
    const farZ = isLast ? oz - room.depth : origins[index + 1] + 3;
    const span = Math.max(4, nearZ - farZ);
    const midZ = (nearZ + farZ) / 2 - oz;                         // stand-local

    const floorMat = this.#floorMaterial(room.floor);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(room.width, span), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, midZ);
    floor.receiveShadow = true;
    group.add(floor);

    const wallMat = room.exterior
      ? mat('brick', () => surface(0x120e18, { roughness: 0.95 }))
      : mat('wall', () => surface(0x16101f, { roughness: 0.85, metalness: 0.05 }));

    [-1, 1].forEach((side) => {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(span, room.ceiling), wallMat);
      wall.rotation.y = -side * Math.PI / 2;
      wall.position.set(side * halfW, room.ceiling / 2, midZ);
      wall.receiveShadow = true;
      group.add(wall);
      this.occluders.push(wall);
    });

    if (!room.exterior) {
      const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(room.width, span), wallMat);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.set(0, room.ceiling, midZ);
      group.add(ceiling);
    }

    // Close off the entrance behind the player, and the far end of the level.
    if (index === 0) {
      const entrance = new THREE.Mesh(new THREE.PlaneGeometry(room.width, room.ceiling), wallMat);
      entrance.position.set(0, room.ceiling / 2, nearZ - oz);
      entrance.rotation.y = Math.PI;
      group.add(entrance);
    }
    if (isLast) {
      const back = new THREE.Mesh(new THREE.PlaneGeometry(room.width, room.ceiling), wallMat);
      back.position.set(0, room.ceiling / 2, farZ - oz);
      back.receiveShadow = true;
      group.add(back);
      this.occluders.push(back);
      this.obstacles.push({
        minX: ox - halfW, maxX: ox + halfW,
        minZ: farZ - 2, maxZ: farZ, top: room.ceiling
      });
    }

    // Side walls block movement over this segment's span.
    this.obstacles.push(
      { minX: ox - halfW - 2, maxX: ox - halfW, minZ: farZ, maxZ: nearZ, top: room.ceiling },
      { minX: ox + halfW, maxX: ox + halfW + 2, minZ: farZ, maxZ: nearZ, top: room.ceiling }
    );
    stand.segment = { nearZ, farZ, span };

    this.standLightIndex = index;
    stand.props.forEach((prop) => this.#buildProp(prop, group, stand, room));

    // Practicals down the length of the room so the far end is not a void and
    // props read as shapes even before the aim beam sweeps over them.
    const lights = [];
    const tints = index % 2
      ? [PALETTE.rose, PALETTE.infectedElite, PALETTE.cyan]
      : [PALETTE.cyan, PALETTE.rose, PALETTE.gold];
    const lit = stand.segment ? stand.segment.span : room.depth;
    [0.28, 0.6, 0.88].forEach((depthRatio, i) => {
      const base = 14 - i * 3;
      const practical = new THREE.PointLight(tints[i], base, room.width * 2.2, 1.8);
      practical.position.set(
        (i % 2 ? 1 : -1) * room.width * 0.26,
        room.ceiling * 0.74,
        -lit * depthRatio
      );
      group.add(practical);
      lights.push(practical);
      this.animatedProps.push({ kind: 'practical', object: practical, base, seed: index * 3 + i });

      // Visible fixture so the light has a source on screen.
      const fixture = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 10, 8),
        new THREE.MeshBasicMaterial({ color: tints[i], toneMapped: false })
      );
      fixture.position.copy(practical.position);
      fixture.raycast = () => {};
      group.add(fixture);
    });
    this.standLights.push({ stand: index, lights: [...lights, ...(this.pendingStandLights || [])] });
    this.pendingStandLights = [];
  }

  #floorMaterial(kind) {
    switch (kind) {
      case 'dance': return mat('floor-dance', () => surface(0x0d0b18, { roughness: 0.18, metalness: 0.85 }));
      case 'marble': return mat('floor-marble', () => surface(0x1a1622, { roughness: 0.24, metalness: 0.4 }));
      case 'carpet': return mat('floor-carpet', () => surface(0x24101e, { roughness: 0.95, metalness: 0.0 }));
      case 'concrete': return mat('floor-concrete', () => surface(0x14141a, { roughness: 0.92, metalness: 0.02 }));
      case 'runway': return mat('floor-runway', () => surface(0x0a0d14, { roughness: 0.3, metalness: 0.6 }));
      case 'lab': return mat('floor-lab', () => surface(0x0e1a1a, { roughness: 0.35, metalness: 0.5 }));
      default: return mat('floor-default', () => surface(0x121019, { roughness: 0.6, metalness: 0.2 }));
    }
  }

  #registerStandLight(light) {
    this.pendingStandLights.push(light);
  }

  /** Registers a solid box as both a shot occluder and a movement obstacle. */
  #solid(group, stand, mesh, halfX, halfZ, { blocks = true, occludes = true } = {}) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (occludes) this.occluders.push(mesh);
    if (blocks) {
      const wx = stand.worldOrigin.x + mesh.position.x;
      const wz = stand.worldOrigin.z + mesh.position.z;
      // `top` lets ambushers mount low cover instead of hiding behind it.
      mesh.updateMatrixWorld(true);
      const top = new THREE.Box3().setFromObject(mesh).max.y;
      this.obstacles.push({
        minX: wx - halfX, maxX: wx + halfX,
        minZ: wz - halfZ, maxZ: wz + halfZ,
        top: Number.isFinite(top) ? top : 1
      });
    }
    return mesh;
  }

  #neonStrip(group, x, y, z, w, color, vertical = false) {
    const geo = vertical
      ? new THREE.BoxGeometry(0.05, w, 0.05)
      : new THREE.BoxGeometry(w, 0.05, 0.05);
    const strip = new THREE.Mesh(geo, neonMat(color));
    strip.position.set(x, y, z);
    strip.raycast = () => {};
    group.add(strip);
    return strip;
  }

  #buildProp(prop, group, stand, room) {
    const { kind, x, z } = prop;
    const yaw = prop.yaw || 0;
    const box = (w, h, d, color, opts) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), surface(color, opts));
      mesh.position.set(x, h / 2, z);
      mesh.rotation.y = yaw;
      return mesh;
    };

    switch (kind) {
      case 'counter':
      case 'bar': {
        const w = prop.w ?? 6, d = prop.d ?? 1, h = prop.h ?? 1.15;
        const body = box(w, h, d, 0x1c1426, { roughness: 0.35, metalness: 0.5 });
        this.#solid(group, stand, body, w / 2, d / 2);
        const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.09, d + 0.25),
          surface(0x2a2036, { roughness: 0.15, metalness: 0.8 }));
        top.position.set(x, h + 0.045, z);
        top.rotation.y = yaw;
        group.add(top);
        this.#neonStrip(group, x, h * 0.42, z + d / 2 + 0.03, w * 0.96, prop.neon ?? PALETTE.cyan);
        break;
      }
      case 'bottles': {
        const w = prop.w ?? 8, h = prop.h ?? 2.4;
        const shelf = box(w, 0.08, 0.4, 0x100c16);
        shelf.position.y = h * 0.55;
        group.add(shelf);
        const colors = [0x67f4ff, 0xff5fae, 0xffd58a, 0x9dffc4];
        for (let i = 0; i < Math.floor(w * 2.2); i++) {
          const bh = 0.28 + Math.random() * 0.22;
          const bottle = new THREE.Mesh(
            new THREE.CylinderGeometry(0.045, 0.06, bh, 6),
            new THREE.MeshStandardMaterial({
              color: colors[i % colors.length], emissive: colors[i % colors.length],
              emissiveIntensity: 0.7, roughness: 0.2, metalness: 0.1,
              transparent: true, opacity: 0.85
            })
          );
          bottle.position.set(x - w / 2 + 0.25 + i * (w - 0.5) / (w * 2.2), h * 0.55 + bh / 2 + 0.04, z);
          bottle.raycast = () => {};
          group.add(bottle);
        }
        this.#neonStrip(group, x, h * 0.55 - 0.08, z + 0.2, w * 0.9, 0xff5fae);
        break;
      }
      case 'table': {
        const r = prop.r ?? 0.62;
        const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.09, 16),
          surface(0x241a2e, { roughness: 0.3, metalness: 0.5 }));
        top.position.set(x, 1.02, z);
        this.#solid(group, stand, top, r, r);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.16, 1.0, 10), surface(0x1a1422));
        stem.position.set(x, 0.5, z);
        group.add(stem);
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, 0.02, 14), neonMat(PALETTE.rose));
        glow.position.set(x, 1.08, z);
        glow.raycast = () => {};
        group.add(glow);
        break;
      }
      case 'sofa':
      case 'booth': {
        const w = kind === 'booth' ? 2.6 : 2.2;
        const seat = box(w, 0.5, 1.0, kind === 'booth' ? 0x2a1226 : 0x1d1426, { roughness: 0.9 });
        seat.position.y = 0.25;
        this.#solid(group, stand, seat, w / 2, 0.5);
        const backRest = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, 0.28), surface(0x2a1226, { roughness: 0.9 }));
        backRest.position.set(x - Math.sin(yaw) * 0.4, 0.85, z - Math.cos(yaw) * 0.4);
        backRest.rotation.y = yaw;
        backRest.castShadow = true;
        group.add(backRest);
        this.occluders.push(backRest);
        this.#neonStrip(group, x, 0.06, z, w * 0.9, kind === 'booth' ? PALETTE.rose : PALETTE.cyan);
        break;
      }
      case 'seatrow': {
        for (let i = -1; i <= 1; i++) {
          const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.55), surface(0x191322, { roughness: 0.8 }));
          seat.position.set(x + Math.cos(yaw) * i * 0.7, 0.35, z + Math.sin(yaw) * i * 0.7);
          seat.castShadow = true;
          group.add(seat);
          if (i === 0) this.#solid(group, stand, seat, 1.1, 0.5, { occludes: false });
        }
        break;
      }
      case 'stool': {
        const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 12), surface(0x2c1830));
        seat.position.set(x, 0.78, z);
        this.#solid(group, stand, seat, 0.3, 0.3, { occludes: false });
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.76, 8), surface(0x1b1524, { metalness: 0.7, roughness: 0.3 }));
        leg.position.set(x, 0.38, z);
        group.add(leg);
        break;
      }
      case 'rack': {
        const w = prop.w ?? 2.2, h = prop.h ?? 2.0;
        const frame = box(0.06, h, 0.06, 0x2a2432, { metalness: 0.8, roughness: 0.3 });
        frame.position.set(x - w / 2, h / 2, z);
        group.add(frame);
        const frame2 = frame.clone();
        frame2.position.x = x + w / 2;
        group.add(frame2);
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, w, 8), surface(0x3a3446, { metalness: 0.9, roughness: 0.2 }));
        rail.rotation.z = Math.PI / 2;
        rail.position.set(x, h - 0.2, z);
        group.add(rail);
        for (let i = 0; i < 7; i++) {
          const coat = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.16),
            surface([0x1a1020, 0x241626, 0x101822][i % 3], { roughness: 0.9 }));
          coat.position.set(x - w / 2 + 0.25 + i * (w - 0.5) / 6, h - 0.78, z);
          coat.castShadow = true;
          group.add(coat);
        }
        const blocker = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5),
          new THREE.MeshBasicMaterial({ visible: false }));
        blocker.position.set(x, h / 2, z);
        this.#solid(group, stand, blocker, w / 2, 0.3);
        break;
      }
      case 'rope': {
        const w = prop.w ?? 2;
        [-1, 1].forEach((side) => {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.95, 10),
            surface(0x3d2f18, { metalness: 0.9, roughness: 0.25, emissive: 0x2a1c06, emissiveIntensity: 0.4 }));
          post.position.set(x + side * w / 2, 0.48, z);
          post.castShadow = true;
          group.add(post);
        });
        const rope = new THREE.Mesh(new THREE.TorusGeometry(w / 2, 0.035, 6, 20, Math.PI),
          surface(0x6a1330, { roughness: 0.9, emissive: 0x40060f, emissiveIntensity: 0.4 }));
        rope.rotation.set(0, 0, Math.PI);
        rope.position.set(x, 0.86, z);
        rope.raycast = () => {};
        group.add(rope);
        break;
      }
      case 'column': {
        const h = prop.h ?? room.ceiling;
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, h, 10),
          surface(0x18121f, { roughness: 0.4, metalness: 0.5 }));
        col.position.set(x, h / 2, z);
        this.#solid(group, stand, col, 0.45, 0.45);
        for (let i = 1; i <= 3; i++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.035, 6, 20), neonMat(i % 2 ? PALETTE.cyan : PALETTE.rose));
          ring.rotation.x = Math.PI / 2;
          ring.position.set(x, h * (i / 4), z);
          ring.raycast = () => {};
          group.add(ring);
        }
        break;
      }
      case 'screen': {
        const w = prop.w ?? 1.5, h = prop.h ?? 2.4;
        const panel = box(w, h, 0.12, 0x0a0810, {
          roughness: 0.4, metalness: 0.3,
          emissive: prop.broken ? 0x3a0620 : 0x1a0a2a, emissiveIntensity: 0.5
        });
        panel.position.y = h / 2;
        this.#solid(group, stand, panel, w / 2, 0.3);
        this.animatedProps.push({ kind: 'screen', object: panel, seed: x + z, broken: !!prop.broken });
        this.#neonStrip(group, x, h * 0.5, z + 0.08, h * 0.9, prop.broken ? 0xff2d78 : PALETTE.infectedElite, true);
        break;
      }
      case 'curtain': {
        const w = prop.w ?? 4, h = prop.h ?? 3.2;
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(w, h, 12, 1),
          new THREE.MeshStandardMaterial({ color: 0x3a0a24, roughness: 0.95, side: THREE.DoubleSide }));
        cloth.position.set(x, h / 2, z);
        cloth.rotation.y = yaw;
        cloth.receiveShadow = true;
        const pos = cloth.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 2.4) * 0.14);
        pos.needsUpdate = true;
        cloth.geometry.computeVertexNormals();
        group.add(cloth);
        this.occluders.push(cloth);
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, w + 0.4, 8), surface(0x2a2436, { metalness: 0.9 }));
        rod.rotation.z = Math.PI / 2;
        rod.position.set(x, h, z);
        group.add(rod);
        break;
      }
      case 'locker': {
        const w = 1.0, h = 2.0;
        const bank = box(w, h, 0.5, 0x141a20, { roughness: 0.55, metalness: 0.55 });
        bank.position.y = h / 2;
        this.#solid(group, stand, bank, w / 2, 0.35);
        [-0.24, 0.24].forEach((off) => {
          const seam = new THREE.Mesh(new THREE.BoxGeometry(0.02, h * 0.9, 0.02), surface(0x0a0c10));
          seam.position.set(x + Math.cos(yaw) * off, h / 2, z - Math.sin(yaw) * off + 0.26);
          seam.raycast = () => {};
          group.add(seam);
        });
        break;
      }
      case 'crate': {
        const s = prop.h ?? 0.9;
        const crate = box(s, s, s, 0x2a2216, { roughness: 0.9 });
        crate.position.y = s / 2;
        crate.rotation.y = yaw || Math.random() * 0.6;
        this.#solid(group, stand, crate, s / 2, s / 2);
        break;
      }
      case 'dumpster': {
        const body = box(2.2, 1.3, 1.1, 0x14301e, { roughness: 0.85, metalness: 0.3 });
        body.position.y = 0.65;
        this.#solid(group, stand, body, 1.2, 0.65);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 1.2), surface(0x0f2418, { roughness: 0.8 }));
        lid.position.set(x, 1.34, z);
        lid.rotation.y = yaw;
        group.add(lid);
        break;
      }
      case 'planter': {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.32, 0.7, 12), surface(0x241f2c, { roughness: 0.5 }));
        pot.position.set(x, 0.35, z);
        this.#solid(group, stand, pot, 0.5, 0.5, { occludes: false });
        for (let i = 0; i < 7; i++) {
          const blade = new THREE.Mesh(new THREE.ConeGeometry(0.07, 1.1 + Math.random() * 0.5, 4),
            surface(0x123423, { roughness: 0.9, emissive: 0x03140a, emissiveIntensity: 0.5 }));
          blade.position.set(x + (Math.random() - 0.5) * 0.4, 1.1, z + (Math.random() - 0.5) * 0.4);
          blade.rotation.z = (Math.random() - 0.5) * 0.6;
          blade.castShadow = true;
          group.add(blade);
        }
        break;
      }
      case 'speaker': {
        const h = prop.h ?? 2.6;
        const cab = box(1.0, h, 0.9, 0x0c0c12, { roughness: 0.85 });
        cab.position.y = h / 2;
        this.#solid(group, stand, cab, 0.55, 0.5);
        [0.32, 0.68].forEach((f) => {
          const cone = new THREE.Mesh(new THREE.CircleGeometry(0.28, 16), surface(0x191922, { roughness: 0.6 }));
          cone.position.set(x, h * f, z + 0.46);
          cone.rotation.y = yaw;
          cone.raycast = () => {};
          group.add(cone);
        });
        this.animatedProps.push({ kind: 'speaker', object: cab, seed: x, baseY: h / 2 });
        break;
      }
      case 'stage': {
        const w = prop.w ?? 12, d = prop.d ?? 5, h = prop.h ?? 1.1;
        const deck = box(w, h, d, 0x1d1224, { roughness: 0.4, metalness: 0.4 });
        deck.position.y = h / 2;
        this.#solid(group, stand, deck, w / 2, d / 2);
        this.#neonStrip(group, x, h + 0.03, z + d / 2, w * 0.98, PALETTE.rose);
        break;
      }
      case 'runway': {
        const w = prop.w ?? 3, d = prop.d ?? 14, h = prop.h ?? 0.35;
        const deck = box(w, h, d, 0x14161f, { roughness: 0.2, metalness: 0.7 });
        deck.position.y = h / 2;
        this.#solid(group, stand, deck, w / 2, d / 2, { occludes: false });
        [-1, 1].forEach((side) => this.#neonStrip(group, x + side * w / 2, h + 0.02, z, d, PALETTE.cyan));
        break;
      }
      case 'truss': {
        const w = prop.w ?? 12, h = prop.h ?? 6;
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 0.16), surface(0x2c2c38, { metalness: 0.9, roughness: 0.3 }));
        bar.position.set(x, h, z);
        group.add(bar);
        for (let i = -2; i <= 2; i++) {
          const canColor = i % 2 ? PALETTE.rose : PALETTE.cyan;
          const can = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.34, 10), surface(0x14141c));
          can.position.set(x + i * (w / 5), h - 0.24, z);
          group.add(can);
          const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 12), neonMat(canColor));
          lens.rotation.x = -Math.PI / 2;
          lens.position.set(can.position.x, h - 0.42, z);
          lens.raycast = () => {};
          group.add(lens);
          if (Math.abs(i) === 1) {
            const beam = new THREE.SpotLight(canColor, 12, 18, THREE.MathUtils.degToRad(22), 0.7, 1.6);
            beam.position.set(can.position.x, h - 0.4, z);
            const target = new THREE.Object3D();
            target.position.set(can.position.x + i * 1.6, 0, z - 3);
            group.add(beam, target);
            beam.target = target;
            this.#registerStandLight(beam);
            this.animatedProps.push({ kind: 'beam', object: beam, target, seed: i, baseX: can.position.x, z });
          }
        }
        break;
      }
      case 'discoball': {
        const h = prop.h ?? 4.6;
        const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1),
          surface(0xb9c6d6, { metalness: 1.0, roughness: 0.08, flatShading: true }));
        ball.position.set(x, h, z);
        ball.raycast = () => {};
        group.add(ball);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, room.ceiling - h, 6), surface(0x333340));
        cord.position.set(x, h + (room.ceiling - h) / 2, z);
        group.add(cord);
        this.animatedProps.push({ kind: 'disco', object: ball });
        break;
      }
      case 'pipe': {
        const h = prop.h ?? 3;
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, room.depth * 0.8, 8),
          surface(0x2a2a34, { metalness: 0.8, roughness: 0.4 }));
        pipe.rotation.x = Math.PI / 2;
        pipe.position.set(x, h, z);
        pipe.raycast = () => {};
        group.add(pipe);
        break;
      }
      case 'flicker': {
        const h = prop.h ?? 3;
        const color = prop.color ?? 0xfff0d0;
        const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.24), neonMat(color));
        fixture.position.set(x, h, z);
        fixture.raycast = () => {};
        group.add(fixture);
        const light = new THREE.PointLight(color, 9, 9, 2);
        light.position.set(x, h - 0.2, z);
        group.add(light);
        this.#registerStandLight(light);
        this.flickerLights.push({ light, fixture, seed: Math.random() * 10, base: 9 });
        break;
      }
      case 'door': {
        const w = prop.w ?? 2.4, h = prop.h ?? 2.8;
        const frame = box(w, h, 0.2, 0x0a0a0e, { roughness: 0.8 });
        frame.position.y = h / 2;
        group.add(frame);
        this.#neonStrip(group, x, h + 0.12, z, w, prop.color ?? PALETTE.cyan);
        const glow = new THREE.PointLight(prop.color ?? PALETTE.cyan, 8, 8, 2);
        glow.position.set(x, h * 0.7, z + 0.6);
        group.add(glow);
        this.#registerStandLight(glow);
        break;
      }
      case 'podbank': {
        for (let i = -1; i <= 1; i++) {
          const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.2, 6, 12),
            new THREE.MeshStandardMaterial({
              color: 0x0d1a1c, roughness: 0.12, metalness: 0.2,
              transparent: true, opacity: 0.55,
              emissive: 0x0b3a34, emissiveIntensity: 0.8
            }));
          pod.position.set(x + Math.cos(yaw) * i * 1.25, 1.05, z + Math.sin(yaw) * i * 1.25);
          pod.castShadow = true;
          group.add(pod);
          this.occluders.push(pod);
          if (i === 0) {
            const wx = stand.worldOrigin.x + x;
            const wz = stand.worldOrigin.z + z;
            this.obstacles.push({ minX: wx - 0.6, maxX: wx + 0.6, minZ: wz - 1.7, maxZ: wz + 1.7 });
          }
        }
        break;
      }
      case 'vat': {
        const h = prop.h ?? 3.4;
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, h, 20, 1, true),
          new THREE.MeshStandardMaterial({
            color: 0x0f2a26, roughness: 0.1, metalness: 0.3, transparent: true,
            opacity: 0.4, side: THREE.DoubleSide, emissive: 0x0d5a4a, emissiveIntensity: 1.1
          }));
        tank.position.set(x, h / 2, z);
        this.#solid(group, stand, tank, 1.1, 1.1, { occludes: false });
        const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.94, 0.94, h * 0.7, 18), neonMat(0x2affc0));
        fluid.material.transparent = true;
        fluid.material.opacity = 0.3;
        fluid.position.set(x, h * 0.36, z);
        fluid.raycast = () => {};
        group.add(fluid);
        const glow = new THREE.PointLight(0x2affc0, 14, 12, 2);
        glow.position.set(x, h * 0.5, z);
        group.add(glow);
        this.#registerStandLight(glow);
        this.animatedProps.push({ kind: 'vat', object: fluid, light: glow });
        break;
      }
      case 'sign': {
        const w = prop.w ?? 6, h = prop.h ?? 1.2;
        const canvasEl = document.createElement('canvas');
        canvasEl.width = 1024;
        canvasEl.height = Math.round(1024 * h / w);
        const ctx = canvasEl.getContext('2d');
        ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        ctx.fillStyle = '#' + (prop.color ?? 0xffffff).toString(16).padStart(6, '0');
        ctx.font = `900 ${Math.round(canvasEl.height * 0.62)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(prop.text || '', canvasEl.width / 2, canvasEl.height / 2);
        const texture = new THREE.CanvasTexture(canvasEl);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true, toneMapped: false }));
        sign.position.set(x, Math.min(room.ceiling * 0.8, 3.4), z);
        sign.raycast = () => {};
        group.add(sign);
        this.animatedProps.push({ kind: 'sign', object: sign, seed: x });
        break;
      }
      default:
        break;
    }
  }

  // --- Camera ---------------------------------------------------------------
  setStand(stand, immediate = false) {
    if (Number.isInteger(stand.index)) this.#gateStandLights(stand.index);
    this.standTarget.set(stand.worldOrigin.x, CAMERA.eyeHeight, stand.worldOrigin.z);
    if (immediate) {
      this.standOrigin.copy(this.standTarget);
      this.cameraRig.position.copy(this.standTarget);
    }
    this.currentRoomCeiling = stand.room.ceiling;
  }

  get advancing() {
    return this.cameraRig.position.distanceTo(this.standTarget) > 0.12;
  }

  updateCamera(dt, lead) {
    const p = this.cameraRig.position;
    p.x = THREE.MathUtils.damp(p.x, this.standTarget.x, CAMERA.advanceLambda, dt);
    p.z = THREE.MathUtils.damp(p.z, this.standTarget.z, CAMERA.advanceLambda, dt);
    p.y = THREE.MathUtils.damp(p.y, this.standTarget.y, 4, dt);

    // Walking bob while the party relocates.
    const moving = this.advancing;
    this.bobPhase = (this.bobPhase || 0) + dt * (moving ? 7.5 : 1.1);
    const bob = moving ? Math.sin(this.bobPhase) * 0.045 : Math.sin(this.bobPhase) * 0.006;
    const sway = moving ? Math.sin(this.bobPhase * 0.5) * 0.02 : 0;

    this.shakeTime += dt;
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 2.6);
    const shake = this.shakeAmount;
    const sx = (Math.sin(this.shakeTime * 61) + Math.sin(this.shakeTime * 37)) * 0.5 * shake * 0.06;
    const sy = (Math.sin(this.shakeTime * 53) + Math.sin(this.shakeTime * 29)) * 0.5 * shake * 0.05;

    this.camera.position.set(sway + sx, bob + sy, 0);
    this.tmpEuler.set(
      (lead?.pitch ?? 0) + sy * 0.4,
      (lead?.yaw ?? 0) + sx * 0.4,
      shake * 0.02 * Math.sin(this.shakeTime * 44)
    );
    this.camera.quaternion.setFromEuler(this.tmpEuler);
    this.camera.updateMatrixWorld(true);

    this.fill.position.copy(this.cameraRig.position).add(this.tmpA.set(0, 1.6, 2.4));
  }

  addShake(amount) {
    this.shakeAmount = Math.min(1.6, this.shakeAmount + amount);
  }

  /** Points the aim beam down the current shot ray. */
  updateAimLight(origin, direction, locked) {
    this.aimLight.position.copy(origin).addScaledVector(direction, 0.15);
    this.aimTarget.position.copy(origin).addScaledVector(direction, 14);
    this.aimLight.color.setHex(locked ? 0xffd7e6 : 0xd8ecff);
    this.aimLight.intensity = locked ? 115 : 90;
    this.key.position.copy(origin).add(this.tmpA.set(-3.5, 9, 5));
    this.key.target.position.copy(origin).addScaledVector(direction, 8);
  }

  /**
   * Accent lights sit *behind* the nearest hostiles so they read as a coloured
   * back-rim on a dark silhouette. In front they just wash the body flat pink.
   */
  updateAccentLights(actors) {
    const hostiles = actors
      .filter((a) => a.hostile && a.state !== 'hidden' && a.state !== 'dead')
      .map((a) => ({ a, d: a.position.distanceTo(this.cameraRig.position) }))
      .sort((x, y) => x.d - y.d);
    this.accentPool.forEach((light, i) => {
      const entry = hostiles[i];
      if (!entry) { light.intensity = 0; return; }
      const { a } = entry;
      this.tmpA.set(a.position.x - this.cameraRig.position.x, 0, a.position.z - this.cameraRig.position.z)
        .normalize().multiplyScalar(0.9);
      light.color.setHex(a.tint);
      light.position.set(
        a.position.x + this.tmpA.x,
        a.position.y + a.height * 0.85,
        a.position.z + this.tmpA.z
      );
      light.intensity = (3.4 + Math.sin(this.time * 5 + i) * 0.8) * (a.revealProgress ?? 1);
    });
  }

  // --- Raycasting -----------------------------------------------------------
  setRayFromNdc(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.near = 0;
    this.raycaster.far = 90;
    this.rayOrigin.copy(this.raycaster.ray.origin);
    this.rayDirection.copy(this.raycaster.ray.direction);
    return this.rayDirection;
  }

  castShot(actors, direction = this.rayDirection, origin = this.rayOrigin) {
    this.scene.updateMatrixWorld(true);
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0;
    this.raycaster.far = 90;
    const roots = new Map(actors.map((a) => [a.group, a]));
    const targets = [...roots.keys(), ...this.occluders];
    const hits = this.raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && !roots.has(node)) node = node.parent;
      if (node) return { actor: roots.get(node), point: hit.point.clone(), distance: hit.distance };
      return { actor: null, point: hit.point.clone(), distance: hit.distance };
    }
    return null;
  }

  hasLineOfSight(from, to) {
    this.scene.updateMatrixWorld(true);
    this.tmpB.copy(to).sub(from);
    const distance = this.tmpB.length();
    if (distance < 0.02) return true;
    this.tmpB.multiplyScalar(1 / distance);
    this.raycaster.set(from, this.tmpB);
    this.raycaster.near = 0.05;
    this.raycaster.far = Math.max(0.06, distance - 0.25);
    return this.raycaster.intersectObjects(this.occluders, true).length === 0;
  }

  /**
   * Projects a world point to CSS pixels. Points behind or beyond the frustum
   * still resolve to a direction so the HUD can pin an edge indicator — on a
   * portrait phone a lot of the room lives outside the view cone.
   */
  projectToScreen(worldPoint, out) {
    this.tmpB.copy(worldPoint).applyMatrix4(this.camera.matrixWorldInverse);
    const behind = this.tmpB.z > -0.05;
    this.tmpA.copy(worldPoint).project(this.camera);
    let x = this.tmpA.x;
    let y = this.tmpA.y;
    if (behind) { x = -x; y = -y; }
    out.offscreen = behind || Math.abs(x) > 1 || Math.abs(y) > 1;
    if (out.offscreen) {
      const scale = Math.max(Math.abs(x), Math.abs(y), 0.0001);
      x /= scale;
      y /= scale;
    }
    out.x = (x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-y * 0.5 + 0.5) * window.innerHeight;
    return true;
  }

  // --- Effects --------------------------------------------------------------
  tracer(from, to, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color, transparent: true, opacity: 0.95, toneMapped: false
    }));
    line.userData.life = 0.05;
    line.userData.maxLife = 0.05;
    line.raycast = () => {};
    this.fxGroup.add(line);

    const flash = new THREE.PointLight(color, 30, 6, 2);
    flash.position.copy(from);
    flash.userData.life = 0.05;
    flash.userData.maxLife = 0.05;
    this.fxGroup.add(flash);
  }

  /** Stylised hit spray — rose petals and light, never gore. */
  petals(position, color, count = 14, power = 1) {
    for (let i = 0; i < count; i++) {
      const petal = new THREE.Mesh(
        new THREE.PlaneGeometry(0.075 + Math.random() * 0.07, 0.11 + Math.random() * 0.09),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 1, side: THREE.DoubleSide, toneMapped: false
        })
      );
      petal.position.copy(position);
      petal.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      petal.userData = {
        life: 0.5 + Math.random() * 0.6,
        maxLife: 1.1,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 3.4 * power,
          Math.random() * 2.6 * power + 0.6,
          (Math.random() - 0.5) * 3.4 * power
        ),
        spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
        gravity: 4.2
      };
      petal.raycast = () => {};
      this.fxGroup.add(petal);
    }
    const glow = new THREE.PointLight(color, 16 * power, 5, 2);
    glow.position.copy(position);
    glow.userData.life = 0.18;
    glow.userData.maxLife = 0.18;
    this.fxGroup.add(glow);
  }

  revealBurst(position, color) {
    this.petals(position, color, 10, 0.8);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.36, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false })
    );
    ring.position.copy(position);
    ring.userData = { life: 0.5, maxLife: 0.5, expand: 7 };
    ring.raycast = () => {};
    this.fxGroup.add(ring);
  }

  updateFx(dt) {
    for (let i = this.fxGroup.children.length - 1; i >= 0; i--) {
      const fx = this.fxGroup.children[i];
      const data = fx.userData;
      data.life -= dt;
      if (data.velocity) {
        data.velocity.y -= (data.gravity || 0) * dt;
        fx.position.addScaledVector(data.velocity, dt);
        if (fx.position.y < 0.02) { fx.position.y = 0.02; data.velocity.multiplyScalar(0.4); data.velocity.y = 0; }
      }
      if (data.spin) {
        fx.rotation.x += data.spin.x * dt;
        fx.rotation.y += data.spin.y * dt;
        fx.rotation.z += data.spin.z * dt;
      }
      if (data.expand) fx.scale.addScalar(data.expand * dt);
      const ratio = Math.max(0, data.life / (data.maxLife || 1));
      if (fx.isPointLight) fx.intensity *= Math.pow(0.02, dt);
      else if (fx.material?.transparent) fx.material.opacity = ratio;
      if (data.life <= 0) {
        fx.geometry?.dispose?.();
        fx.material?.dispose?.();
        this.fxGroup.remove(fx);
      }
    }
  }

  updateProps(dt) {
    this.time += dt;
    const t = this.time;
    this.flickerLights.forEach((entry) => {
      const n = Math.sin(t * 13.1 + entry.seed) * Math.sin(t * 4.7 + entry.seed * 2);
      const on = n > -0.55 ? 1 : Math.random() * 0.35;
      entry.light.intensity = entry.base * on;
      entry.fixture.material.opacity = on;
      entry.fixture.material.transparent = true;
    });
    this.animatedProps.forEach((entry) => {
      switch (entry.kind) {
        case 'disco':
          entry.object.rotation.y += dt * 0.9;
          break;
        case 'screen': {
          const flicker = entry.broken
            ? (Math.sin(t * 9 + entry.seed) > 0.4 ? 1.4 : 0.15)
            : 0.4 + (Math.sin(t * 2.1 + entry.seed) + 1) * 0.3;
          entry.object.material.emissiveIntensity = flicker;
          break;
        }
        case 'speaker':
          entry.object.position.y = entry.baseY + Math.sin(t * 8 + entry.seed) * 0.012;
          break;
        case 'beam':
          entry.target.position.x = entry.baseX + Math.sin(t * 0.7 + entry.seed) * 5;
          entry.target.position.z = entry.z - 4 + Math.cos(t * 0.5 + entry.seed) * 2;
          entry.object.intensity = 10 + Math.sin(t * 3 + entry.seed) * 4;
          break;
        case 'vat':
          entry.object.scale.y = 1 + Math.sin(t * 1.4) * 0.03;
          entry.light.intensity = 12 + Math.sin(t * 2.6) * 4;
          break;
        case 'sign':
          entry.object.material.opacity = Math.sin(t * 17 + entry.seed) > -0.8 ? 1 : 0.25;
          entry.object.material.transparent = true;
          break;
        case 'practical':
          entry.object.intensity = entry.base + Math.sin(t * 1.3 + entry.seed) * 1.6;
          break;
        default: break;
      }
    });
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
