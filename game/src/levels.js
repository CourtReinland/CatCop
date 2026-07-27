// Hand-authored course content.
//
// A level is an ordered list of *stands*: the spot the party holds while a wave
// plays out. When the stand is cleared the party physically walks to the next
// one, so the player moves up through the club instead of holding one spawn
// point for 75 seconds.
//
// Props and spawns are authored in STAND-LOCAL coordinates: +x right, -z ahead
// of the camera. The world places them at (stand.origin + local), so a spawn at
// { x: -2, z: -6 } is six metres in front of you and two to the left.

const P = (kind, x, z, opts = {}) => ({ kind, x, z, ...opts });

// at      – seconds after the stand begins
// type    – model | rusher | elite | brute | civilian
// style   – popup (rises from behind cover) | stepout (slides out from a side)
//           | charge (already running) | drop (falls in) | crawl (low, from under)
const E = (at, type, x, z, style = 'popup', opts = {}) => ({ at, type, x, z, style, ...opts });
const PICKUP = (at, kind, x, z) => ({ at, type: 'pickup', pickup: kind, x, z, style: 'static' });

// ---------------------------------------------------------------------------
// LEVEL 1 — Luna Lounge
// ---------------------------------------------------------------------------
const LOUNGE = {
  id: 'luna-lounge',
  name: 'Luna Lounge',
  subtitle: 'Chapter 1 · The Night Desire Broke Free',
  fog: { color: 0x0b0616, density: 0.026 },
  ambient: { sky: 0x4a3868, ground: 0x0d0614, intensity: 0.95 },
  score: { key: 'lounge' },
  stands: [
    {
      id: 'coat-check',
      title: 'Coat Check',
      brief: 'Eno: Something moved behind the counter. Close range — do not blink.',
      origin: [0, 0, 0],
      room: { width: 11, depth: 17, ceiling: 4.4, floor: 'marble' },
      props: [
        P('counter', 0, -6.4, { w: 6.4, d: 0.9, h: 1.15, neon: 0x67f4ff }),
        P('rack', -4.2, -8.6, { w: 2.4, d: 0.7, h: 2.0 }),
        P('rack', 4.2, -8.6, { w: 2.4, d: 0.7, h: 2.0 }),
        P('rope', -3.0, -3.2, { w: 2.2 }),
        P('rope', 3.0, -3.2, { w: 2.2 }),
        P('sign', 0, -10.4, { text: 'LUNA LOUNGE', w: 6, h: 1.1, color: 0xff5fae })
      ],
      waves: [
        E(1.2, 'model', -1.9, -6.1, 'popup'),
        E(4.6, 'model', 2.2, -6.1, 'popup'),
        E(8.0, 'model', -4.2, -8.2, 'stepout', { side: -1 }),
        E(8.6, 'model', 4.2, -8.2, 'stepout', { side: 1 })
      ]
    },
    {
      id: 'main-floor',
      title: 'Main Floor',
      brief: 'Suki: That is my dance floor. They are standing on my dance floor.',
      origin: [0, 0, -15],
      room: { width: 16, depth: 20, ceiling: 6.0, floor: 'dance' },
      props: [
        P('table', -3.4, -5.0), P('table', 3.4, -5.2),
        P('table', -5.6, -9.0), P('table', 5.6, -9.2),
        P('sofa', -6.6, -6.2, { yaw: Math.PI / 2 }),
        P('sofa', 6.6, -6.2, { yaw: -Math.PI / 2 }),
        P('column', -6.2, -12.0), P('column', 6.2, -12.0),
        P('speaker', -7.0, -14.0), P('speaker', 7.0, -14.0),
        P('discoball', 0, -8.0, { h: 5.0 })
      ],
      waves: [
        E(0.9, 'model', -3.4, -4.9, 'popup'),
        E(3.4, 'model', 3.4, -5.1, 'popup'),
        E(6.2, 'rusher', 0, -12.5, 'charge'),
        PICKUP(7.0, 'ammo', -5.6, -8.9),
        E(9.4, 'model', -5.6, -8.9, 'popup'),
        E(9.9, 'model', 5.6, -9.1, 'popup'),
        E(13.0, 'civilian', -2.0, -11.0, 'charge'),
        E(14.2, 'rusher', 4.5, -11.5, 'charge')
      ]
    },
    {
      id: 'the-bar',
      title: 'The Long Bar',
      brief: 'Eno: They vault the bar. Watch the top of the counter, not the floor.',
      origin: [0, 0, -30],
      room: { width: 14, depth: 18, ceiling: 5.2, floor: 'marble' },
      props: [
        P('bar', 0, -7.0, { w: 11.0, d: 1.1, h: 1.2, neon: 0xff5fae }),
        P('bottles', 0, -8.6, { w: 10.0, h: 2.6 }),
        P('stool', -3.6, -5.4), P('stool', -1.2, -5.4),
        P('stool', 1.2, -5.4), P('stool', 3.6, -5.4),
        P('screen', -5.4, -3.2, { yaw: 0.3, broken: true }),
        P('screen', 5.4, -3.2, { yaw: -0.3, broken: true }),
        P('column', -5.8, -11.0), P('column', 5.8, -11.0)
      ],
      waves: [
        E(1.0, 'model', -2.4, -6.9, 'popup'),
        E(1.5, 'model', 2.4, -6.9, 'popup'),
        E(5.0, 'model', -5.3, -3.1, 'stepout', { side: -1 }),
        E(5.4, 'rusher', 5.3, -3.1, 'stepout', { side: 1 }),
        PICKUP(6.0, 'weapon', 0, -8.0),
        E(9.0, 'model', 0, -6.9, 'popup'),
        E(9.4, 'elite', -4.6, -6.9, 'popup'),
        E(13.0, 'civilian', 3.0, -10.0, 'charge'),
        E(14.0, 'rusher', -1.0, -11.5, 'charge'),
        E(14.5, 'rusher', 1.0, -11.5, 'charge')
      ]
    },
    {
      id: 'vip-booths',
      title: 'VIP Booths',
      brief: 'Suki: The private rooms. Of course this is where they nest.',
      origin: [0, 0, -45],
      room: { width: 15, depth: 18, ceiling: 4.2, floor: 'carpet' },
      props: [
        P('booth', -4.6, -5.4, { yaw: 0.25 }),
        P('booth', 4.6, -5.4, { yaw: -0.25 }),
        P('booth', -4.6, -10.4, { yaw: 0.25 }),
        P('booth', 4.6, -10.4, { yaw: -0.25 }),
        P('curtain', 0, -7.6, { w: 4.6, h: 3.2 }),
        P('table', -1.8, -3.4), P('table', 1.8, -3.4),
        P('screen', -6.8, -8.0, { yaw: 0.9 }),
        P('screen', 6.8, -8.0, { yaw: -0.9 })
      ],
      waves: [
        E(1.0, 'model', -4.6, -5.2, 'popup'),
        E(1.4, 'model', 4.6, -5.2, 'popup'),
        E(4.8, 'elite', 0, -7.4, 'curtain'),
        E(8.2, 'model', -4.6, -10.2, 'popup'),
        E(8.6, 'model', 4.6, -10.2, 'popup'),
        PICKUP(9.0, 'health', 0, -4.0),
        E(12.0, 'civilian', -3.4, -11.0, 'charge'),
        E(12.6, 'civilian', 3.4, -11.2, 'charge'),
        E(13.4, 'rusher', 0, -12.0, 'charge'),
        E(14.0, 'elite', -2.4, -12.4, 'charge')
      ]
    },
    {
      id: 'backstage',
      title: 'Backstage Corridor',
      brief: 'Eno: Tight corridor. Whatever comes, it comes close. Stay behind me.',
      origin: [0, 0, -60],
      room: { width: 5.4, depth: 20, ceiling: 3.2, floor: 'concrete', corridor: true },
      props: [
        P('locker', -2.3, -4.0, { yaw: Math.PI / 2 }),
        P('locker', 2.3, -4.0, { yaw: -Math.PI / 2 }),
        P('locker', -2.3, -9.0, { yaw: Math.PI / 2 }),
        P('locker', 2.3, -9.0, { yaw: -Math.PI / 2 }),
        P('crate', -1.7, -6.4), P('crate', 1.6, -12.0),
        P('pipe', 0, -7.0, { h: 3.0 }),
        P('flicker', 0, -5.0, { h: 3.0, color: 0xfff0d0 }),
        P('flicker', 0, -11.0, { h: 3.0, color: 0xff6ea8 })
      ],
      waves: [
        E(1.6, 'model', -1.7, -4.4, 'stepout', { side: -1 }),
        E(4.4, 'rusher', 1.9, -8.8, 'stepout', { side: 1 }),
        E(7.0, 'model', 0, -3.4, 'drop'),
        E(9.6, 'model', -1.9, -9.2, 'stepout', { side: -1 }),
        E(10.0, 'model', 1.9, -9.2, 'stepout', { side: 1 }),
        PICKUP(10.5, 'ammo', 0, -6.5),
        E(13.4, 'rusher', -1.0, -13.0, 'charge'),
        E(13.8, 'rusher', 1.0, -13.0, 'charge'),
        E(15.2, 'elite', 0, -14.0, 'charge')
      ]
    },
    {
      id: 'main-stage',
      title: 'Main Stage',
      brief: 'Eno: Extraction is above the stage. Hold this floor and I will call it in.',
      origin: [0, 0, -76],
      room: { width: 18, depth: 22, ceiling: 8.0, floor: 'dance', stage: true },
      props: [
        P('stage', 0, -11.0, { w: 13, d: 5, h: 1.1 }),
        P('speaker', -6.2, -9.4, { h: 3.4 }), P('speaker', 6.2, -9.4, { h: 3.4 }),
        P('truss', 0, -10.0, { w: 14, h: 6.4 }),
        P('table', -5.4, -4.6), P('table', 5.4, -4.6),
        P('sofa', -7.4, -6.6, { yaw: Math.PI / 2 }),
        P('sofa', 7.4, -6.6, { yaw: -Math.PI / 2 }),
        P('column', -7.6, -14.0), P('column', 7.6, -14.0),
        P('sign', 0, -15.4, { text: 'SUKI · MIDNIGHT SET', w: 8, h: 1.2, color: 0x67f4ff })
      ],
      waves: [
        E(1.0, 'model', -5.4, -4.5, 'popup'),
        E(1.4, 'model', 5.4, -4.5, 'popup'),
        E(4.4, 'rusher', -2.0, -12.0, 'stage'),
        E(4.8, 'rusher', 2.0, -12.0, 'stage'),
        PICKUP(6.0, 'health', -3.0, -7.0),
        PICKUP(6.2, 'ammo', 3.0, -7.0),
        E(8.0, 'elite', -6.0, -8.0, 'charge'),
        E(8.6, 'elite', 6.0, -8.0, 'charge'),
        E(11.0, 'civilian', 0, -13.0, 'charge'),
        E(13.0, 'brute', 0, -12.4, 'stage'),
        E(16.0, 'rusher', -4.0, -14.0, 'charge'),
        E(16.4, 'rusher', 4.0, -14.0, 'charge')
      ]
    }
  ],
  outro: {
    speaker: 'Eno',
    text: 'Lounge is clear. Extraction inbound. Suki — you held a line most of my squad could not.'
  }
};

// ---------------------------------------------------------------------------
// LEVEL 2 — Vanta Model Agency (the building next door, where it started)
// ---------------------------------------------------------------------------
const AGENCY = {
  id: 'vanta-agency',
  name: 'Vanta Model Agency',
  subtitle: 'Chapter 2 · Where the Treatment Was Signed',
  fog: { color: 0x07101a, density: 0.03 },
  ambient: { sky: 0x2c5170, ground: 0x060b12, intensity: 0.85 },
  score: { key: 'agency' },
  stands: [
    {
      id: 'service-alley',
      title: 'Service Alley',
      brief: 'Eno: Their fire door is open. That was not a good sign an hour ago either.',
      origin: [0, 0, 0],
      room: { width: 6.4, depth: 18, ceiling: 9.0, floor: 'concrete', corridor: true, exterior: true },
      props: [
        P('dumpster', -2.2, -5.0, { yaw: 0.1 }),
        P('crate', 2.1, -6.4), P('crate', 2.1, -7.6, { h: 1.4 }),
        P('pipe', -2.8, -9.0, { h: 6.0 }),
        P('flicker', 0, -8.0, { h: 4.0, color: 0x9fd8ff }),
        P('door', 0, -13.0, { w: 3.0, h: 3.0, color: 0x67f4ff })
      ],
      waves: [
        E(1.4, 'model', -2.2, -5.0, 'popup'),
        E(4.2, 'model', 2.1, -6.6, 'popup'),
        E(7.0, 'rusher', 0, -11.0, 'charge'),
        PICKUP(7.5, 'ammo', 0, -6.0),
        E(10.0, 'model', -2.0, -9.6, 'stepout', { side: -1 }),
        E(10.4, 'model', 2.0, -9.6, 'stepout', { side: 1 })
      ]
    },
    {
      id: 'atrium',
      title: 'Reception Atrium',
      brief: 'Suki: Marble, orchids, and a wall of men who used to be beautiful.',
      origin: [0, 0, -16],
      room: { width: 18, depth: 20, ceiling: 9.5, floor: 'marble' },
      props: [
        P('counter', 0, -7.2, { w: 7.0, d: 1.1, h: 1.2, neon: 0x67f4ff }),
        P('planter', -5.2, -4.6), P('planter', 5.2, -4.6),
        P('planter', -6.4, -9.6), P('planter', 6.4, -9.6),
        P('column', -6.8, -12.4), P('column', 6.8, -12.4),
        P('sofa', -4.0, -3.0, { yaw: 0.4 }), P('sofa', 4.0, -3.0, { yaw: -0.4 }),
        P('sign', 0, -14.0, { text: 'VANTA', w: 5, h: 1.6, color: 0xffffff })
      ],
      waves: [
        E(1.0, 'model', -2.6, -7.1, 'popup'),
        E(1.5, 'model', 2.6, -7.1, 'popup'),
        E(4.6, 'model', -5.2, -4.6, 'popup'),
        E(5.0, 'model', 5.2, -4.6, 'popup'),
        E(8.0, 'elite', 0, -12.0, 'charge'),
        E(11.0, 'civilian', -3.0, -12.0, 'charge'),
        E(12.0, 'rusher', 3.0, -12.5, 'charge'),
        PICKUP(12.5, 'health', 0, -5.0),
        E(14.0, 'rusher', -5.0, -13.0, 'charge'),
        E(14.4, 'elite', 5.0, -13.0, 'charge')
      ]
    },
    {
      id: 'runway',
      title: 'Runway Studio',
      brief: 'Eno: Keep off the runway lights. They will silhouette you.',
      origin: [0, 0, -32],
      room: { width: 16, depth: 22, ceiling: 7.0, floor: 'runway' },
      props: [
        P('runway', 0, -10.0, { w: 3.2, d: 16, h: 0.35 }),
        P('seatrow', -4.6, -6.0, { yaw: Math.PI / 2 }),
        P('seatrow', 4.6, -6.0, { yaw: -Math.PI / 2 }),
        P('seatrow', -4.6, -11.0, { yaw: Math.PI / 2 }),
        P('seatrow', 4.6, -11.0, { yaw: -Math.PI / 2 }),
        P('curtain', 0, -16.0, { w: 6.0, h: 4.4 }),
        P('truss', 0, -9.0, { w: 12, h: 5.6 })
      ],
      waves: [
        E(1.2, 'model', -4.6, -6.0, 'popup'),
        E(1.7, 'model', 4.6, -6.0, 'popup'),
        E(4.6, 'model', 0, -15.6, 'curtain'),
        E(7.4, 'rusher', -4.6, -11.0, 'popup'),
        E(7.8, 'rusher', 4.6, -11.0, 'popup'),
        PICKUP(8.4, 'weapon', 0, -6.0),
        E(11.0, 'civilian', 0, -13.0, 'charge'),
        E(12.4, 'elite', -2.4, -14.0, 'charge'),
        E(12.8, 'elite', 2.4, -14.0, 'charge'),
        E(15.6, 'brute', 0, -15.6, 'curtain')
      ]
    },
    {
      id: 'treatment-lab',
      title: 'Treatment Lab',
      brief: 'Suki: This is where they signed away every year they had left.',
      origin: [0, 0, -50],
      room: { width: 14, depth: 20, ceiling: 4.6, floor: 'lab' },
      props: [
        P('podbank', -4.4, -6.0, { yaw: Math.PI / 2 }),
        P('podbank', 4.4, -6.0, { yaw: -Math.PI / 2 }),
        P('podbank', -4.4, -11.0, { yaw: Math.PI / 2 }),
        P('podbank', 4.4, -11.0, { yaw: -Math.PI / 2 }),
        P('vat', 0, -14.0, { h: 3.6 }),
        P('counter', 0, -4.4, { w: 5.0, d: 0.8, h: 1.05, neon: 0x3dffa8 }),
        P('flicker', 0, -8.0, { h: 3.6, color: 0x8affd8 })
      ],
      waves: [
        E(1.0, 'model', -4.4, -6.0, 'pod'),
        E(1.4, 'model', 4.4, -6.0, 'pod'),
        E(4.2, 'model', -4.4, -11.0, 'pod'),
        E(4.6, 'rusher', 4.4, -11.0, 'pod'),
        E(7.4, 'elite', 0, -4.3, 'popup'),
        PICKUP(8.0, 'health', -2.4, -7.0),
        PICKUP(8.2, 'ammo', 2.4, -7.0),
        E(10.6, 'rusher', -3.0, -13.0, 'charge'),
        E(11.0, 'rusher', 3.0, -13.0, 'charge'),
        E(13.4, 'brute', 0, -13.6, 'charge'),
        E(17.0, 'elite', -4.0, -14.0, 'charge'),
        E(17.4, 'elite', 4.0, -14.0, 'charge'),
        E(20.0, 'brute', 0, -14.4, 'charge')
      ]
    }
  ],
  outro: {
    speaker: 'Eno',
    text: 'Lab is contained. Command wants a debrief. I want ten minutes where nobody is shooting at you.'
  }
};

// A phone in portrait can only show ~48° horizontally, which makes everything
// read as further away than it is. Rather than re-author every encounter, pull
// the whole dressed layout toward the player by a single factor — relative
// composition is preserved, apparent size goes up.
const DEPTH_SCALE = 0.85;

for (const level of [LOUNGE, AGENCY]) {
  for (const stand of level.stands) {
    stand.props.forEach((prop) => { prop.z *= DEPTH_SCALE; });
    stand.waves.forEach((wave) => { wave.z *= DEPTH_SCALE; });
  }
}

export const LEVELS = [LOUNGE, AGENCY];

export function getLevel(index) {
  return LEVELS[Math.max(0, Math.min(index, LEVELS.length - 1))];
}
