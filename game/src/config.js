// CatCop — Lifted Wing: Desire Protocol
// Central tuning + asset table. Everything ships from ./assets so the build has
// no third-party runtime dependency other than the three.js module itself.

export const ASSETS = {
  // Audio
  shot: './assets/audio/shot.mp3',
  impact: './assets/audio/impact.mp3',
  warning: './assets/audio/warning.mp3',
  lockBeep: './assets/audio/lock_beep.mp3',
  playerHurt: './assets/audio/player_hurt.mp3',
  scareSting: './assets/audio/scare_sting.mp3',
  grunt1: './assets/audio/enemy_grunt_1.wav',
  grunt2: './assets/audio/enemy_grunt_2.wav',
  grunt3: './assets/audio/enemy_grunt_3.wav',

  // Visual novel art
  suki: './assets/art/suki.png',
  eno: './assets/art/eno.png',
  infectedPortrait: './assets/art/infected_portrait.png',
  clubOpening: './assets/art/club_opening.jpg',

  // Re-proportioned character built by tools/build_infected.py (mesh + skeleton
  // + Run/Idle in one file). The Kenney FBX set below is the fallback.
  character: './assets/characters/infected.glb',
  rig: './assets/characters/infected.fbx',
  clipRun: './assets/characters/run.fbx',
  clipIdle: './assets/characters/idle.fbx',

  // Weapons (pickups and all set dressing are built procedurally)
  sidearm: './assets/luna_sidearm.glb',
  carbine: './assets/luna_burst.glb',
  scatter: './assets/luna_scatter.glb'
};

// The clips we actually want out of the FBX files. The run FBX also contains a
// 0.04s "Targeting Pose" that must not be mistaken for the run cycle.
export const CLIP_NAMES = {
  run: ['Root|Run', 'Run'],
  idle: ['Root|Idle', 'Idle']
};

export const PALETTE = {
  infected: 0xff2d78,
  infectedBrute: 0xff8a3d,
  infectedElite: 0xb45cff,
  civilian: 0x3dffa8,
  cyan: 0x67f4ff,
  gold: 0xffd58a,
  rose: 0xff5fae
};

// --- Camera -----------------------------------------------------------------
// Three's `fov` is vertical. On a portrait phone a fixed vertical FOV collapses
// the horizontal view to a straw, so we solve for vertical FOV from a desired
// horizontal FOV and clamp it.
export const CAMERA = {
  eyeHeight: 1.62,
  horizontalFovDeg: 70,
  minVerticalFovDeg: 58,
  maxVerticalFovDeg: 88,
  near: 0.05,
  far: 160,
  advanceLambda: 1.9, // damping when the party walks to the next stand
  // A portrait phone can only ever show ~58° horizontally. Letting the view
  // lean toward the reticle buys back the rest of the room.
  leadYawDeg: 15,
  leadPitchDeg: 7
};

export const PLAYER = {
  maxHealth: 100,
  enoMaxHealth: 100,
  friendlyLimit: 3
};

// Human scale. The old build rendered ~5.5m-tall enemies; realistic height plus
// close ambush distance is what actually makes them read.
export const ACTOR = {
  heightByType: { model: 1.88, rusher: 1.82, elite: 1.95, brute: 2.24, civilian: 1.74 },
  radiusByType: { model: 0.38, rusher: 0.35, elite: 0.42, brute: 0.55, civilian: 0.36 },
  hpByType: { model: 1, rusher: 2, elite: 3, brute: 5, civilian: 1 },
  massByType: { model: 1, rusher: 0.8, elite: 1.4, brute: 2.5, civilian: 1 },
  speedByType: { model: 1.55, rusher: 2.85, elite: 1.75, brute: 1.15, civilian: 1.5 },
  // After erupting from cover they hold and stare before closing. This is the
  // horror beat *and* the player's reaction window — without it a 6m ambush is
  // a 2.5s death sentence.
  menaceTime: { model: 1.0, rusher: 0.45, elite: 1.15, brute: 1.5, civilian: 0.2 },
  // Damage dealt when an infected reaches the party.
  breachDamage: { model: 13, rusher: 17, elite: 20, brute: 27 },
  breachDistance: 2.15,
  score: { model: 120, rusher: 160, elite: 240, brute: 380 }
};

// Magazine + auto-reload rather than a single draining pool. The sidearm's
// reserve is infinite: a light-gun game must never reach a state where the
// player cannot shoot their way out.
export const WEAPONS = {
  sidearm: {
    id: 'sidearm', name: 'Luna Sidearm', asset: 'sidearm',
    damage: 1, fireRate: 0.2, mag: 12, reload: 0.85,
    reserve: Infinity, ammoGrant: 0,
    knockback: 5.2, pellets: 1, spread: 0, color: 0x91fbff, shake: 0.35
  },
  carbine: {
    id: 'carbine', name: 'Wing Carbine', asset: 'carbine',
    damage: 1, fireRate: 0.1, mag: 30, reload: 1.15,
    reserve: 0, ammoGrant: 60, maxReserve: 180,
    knockback: 3.0, pellets: 1, spread: 0.011, color: 0xffe29b, shake: 0.22
  },
  scatter: {
    id: 'scatter', name: 'Rose Scattergun', asset: 'scatter',
    damage: 1, fireRate: 0.62, mag: 6, reload: 1.35,
    reserve: 0, ammoGrant: 18, maxReserve: 48,
    knockback: 10.5, pellets: 6, spread: 0.075, color: 0xff69bd, shake: 0.8
  }
};

export const WEAPON_ORDER = ['sidearm', 'carbine', 'scatter'];

// --- Aiming -----------------------------------------------------------------
export const AIM = {
  // Touch aiming: the reticle tracks the finger, offset upward so the thumb
  // does not cover the target.
  touchOffsetY: -86,
  followLambda: 26,
  // Lock assist. Acquisition is generous on a phone; it never fires for you.
  lockAcquireDeg: 7.5,
  lockRetainDeg: 12,
  assistStrength: 0.55,
  lockBeepGap: 0.22,
  // Gyro
  gyroSlerpTau: 0.02,
  sightTau: 0.085,
  sightMaxLagDeg: 5
};

export const PHYSICS = {
  fixedStep: 1 / 60,
  maxSubsteps: 4,
  gravity: 22,
  groundDrag: 6.5,
  airDrag: 1.1,
  obstaclePadding: 0.3,
  knockdownEnergy: 6.4,
  deathFade: 1.6
};

// Ambient dread ramps with how many infected are alive and close.
export const SCORE_TUNING = {
  comboDecay: 1.5,
  comboStep: 0.3,
  comboMax: 8
};
