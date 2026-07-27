// Boot, visual-novel flow and the main loop.

import { ASSETS } from './config.js';
import { getLevel } from './levels.js';
import { AudioManager } from './audio.js';
import { InputManager } from './input.js';
import { UIManager } from './ui.js';
import { World } from './world.js';
import { ActorFactory } from './actors.js';
import { GameController } from './game.js';

const $ = (sel) => document.querySelector(sel);

const canvas = $('#canvas');
const shell = $('#shell');

const ui = new UIManager();
const audio = new AudioManager();
const world = new World(canvas);
const input = new InputManager(shell, canvas);
const factory = new ActorFactory();
const game = new GameController({ world, input, audio, ui, factory });

input.setBaseQuaternion(world.camera.quaternion);
input.bind();
input.onMotionStateChanged = (state, detail) => {
  ui.setMotionStatus(state, detail);
  if (state === 'active') ui.toast('MOTION AIMING ACTIVE');
};

// ---------------------------------------------------------------- story ---
const STORY = {
  prologue: [
    {
      speaker: 'Narrator',
      text: 'New York, 2035. Youth stopped being a phase and became an industry.',
      bg: ASSETS.clubOpening
    },
    {
      speaker: 'Narrator',
      text: 'Vanta Model Agency sold an anti-aging treatment that worked. It also removed the part of a person that knows how to stop.',
      bg: ASSETS.clubOpening, portrait: ASSETS.infectedPortrait
    },
    {
      speaker: 'Suki',
      text: 'I sing the midnight set at the Luna Lounge. The uniform is a costume. The handcuffs are a prop. The cat ears are, frankly, load-bearing.',
      bg: ASSETS.clubOpening, portrait: ASSETS.suki
    },
    {
      speaker: 'Narrator',
      text: 'At 11:52pm the wall between the club and the agency came down, and forty beautiful men came through it.',
      bg: ASSETS.clubOpening, portrait: ASSETS.infectedPortrait
    },
    {
      speaker: 'Eno',
      text: 'You there — officer! On me!',
      bg: ASSETS.clubOpening, portrait: ASSETS.eno
    },
    {
      speaker: 'Suki',
      text: 'This is a costume. A very expensive costume.',
      bg: ASSETS.clubOpening, portrait: ASSETS.suki
    },
    {
      speaker: 'Eno',
      text: 'You put three civilians behind the bar before I got through the door. Commander Eno, Lifted Wing Division. My squad is outnumbered nine to one and you are the only one still moving toward the noise.',
      bg: ASSETS.clubOpening, portrait: ASSETS.eno
    },
    {
      speaker: 'Eno',
      text: 'Stay on my frequency. I will be your wing tonight — and after tonight, if you will have me.',
      bg: ASSETS.clubOpening, portrait: ASSETS.eno,
      choices: [
        { text: '“Then try to keep up, Commander.”', flag: 'bold' },
        { text: '“Just do not let go of me.”', flag: 'tender' }
      ]
    },
    {
      speaker: 'Mission',
      text: 'Hold the Luna Lounge. They hide behind the furniture and come at you from the dark — red rings are infected, green rings are people. Drag to aim, hold to fire.',
      bg: ASSETS.clubOpening, portrait: ASSETS.suki,
      responses: {
        bold: 'Eno, in your ear: “Understood. I will simply have to be worth keeping up with.”',
        tender: 'Eno, in your ear: “I have not let go of anything that mattered yet.”'
      },
      final: true
    }
  ],
  interlude: [
    {
      speaker: 'Eno',
      text: 'The lounge is clear, but the source is next door. Vanta signed those men up for eternity and did not read past the first page.',
      bg: ASSETS.clubOpening, portrait: ASSETS.eno
    },
    {
      speaker: 'Suki',
      text: 'Then we go and close the account. Commander — my shift ended two hours ago and I am still in heels.',
      bg: ASSETS.clubOpening, portrait: ASSETS.suki
    },
    {
      speaker: 'Mission',
      text: 'Push through the service alley into the Vanta Model Agency and reach the treatment lab.',
      bg: ASSETS.clubOpening, portrait: ASSETS.eno,
      final: true
    }
  ]
};

let storyNodes = [];
let storyIndex = 0;
let storyDone = () => {};

function playStory(nodes, onDone) {
  storyNodes = nodes;
  storyIndex = 0;
  storyDone = onDone;
  ui.setScreen('cinematic');
  showNode();
}

function showNode() {
  const node = storyNodes[storyIndex];
  $('#vn-bg').style.backgroundImage = `url("${node.bg}")`;
  const portrait = $('#vn-portrait');
  if (node.portrait) { portrait.src = node.portrait; portrait.classList.remove('hidden'); }
  else { portrait.removeAttribute('src'); portrait.classList.add('hidden'); }
  $('#vn-speaker').textContent = node.speaker;
  const body = node.responses?.[game.romanceFlag]
    ? `${node.text}\n\n${node.responses[game.romanceFlag]}`
    : node.text;
  $('#vn-text').textContent = body;
  $('#vn-next').textContent = node.final ? 'Deploy' : 'Continue';
  $('#vn-next').classList.toggle('hidden', !!node.choices);

  const choices = $('#vn-choices');
  choices.replaceChildren();
  choices.classList.toggle('hidden', !node.choices);
  node.choices?.forEach((choice) => {
    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = choice.text;
    button.addEventListener('click', () => {
      game.romanceFlag = choice.flag;
      advanceStory();
    });
    choices.append(button);
  });
}

function advanceStory() {
  if (storyNodes[storyIndex]?.final) return storyDone();
  storyIndex += 1;
  if (storyIndex >= storyNodes.length) return storyDone();
  showNode();
}

$('#vn-next').addEventListener('click', advanceStory);
$('#vn-skip').addEventListener('click', () => storyDone());

// ------------------------------------------------------------------ menu ---
$('#play-button').addEventListener('click', async () => {
  const button = $('#play-button');
  button.disabled = true;
  await audio.unlock();
  playStory(STORY.prologue, () => game.startLevel(0, { freshRun: true }));
  button.disabled = false;
});

$('#motion-button').addEventListener('click', () => {
  const button = $('#motion-button');
  if (input.mode === 'gyro') {
    input.disableMotion();
    button.textContent = 'Use phone motion aiming';
    return;
  }
  // Must be issued synchronously inside the gesture on iOS.
  input.requestMotion().then((ok) => {
    button.textContent = ok ? 'Switch back to touch aiming' : 'Use phone motion aiming';
  });
});

$('#weapon-card').addEventListener('click', () => game.cycleWeapon());
$('#result-retry').addEventListener('click', () => game.restartLevel());
$('#result-next').addEventListener('click', () => {
  playStory(STORY.interlude, () => {
    if (!game.nextLevel()) game.startLevel(0, { freshRun: true });
  });
});
$('#result-menu').addEventListener('click', () => {
  game.state = 'idle';
  input.enabled = false;
  ui.setScreen('menu');
});

// ------------------------------------------------------------------ boot ---
async function boot() {
  const bar = $('#boot-bar');
  const status = $('#boot-status');
  const step = (pct, label) => { bar.style.width = `${pct}%`; status.textContent = label; };

  step(18, 'Loading the cast…');
  const report = await factory.load();
  console.log('[catcop] actor assets', report);

  step(64, 'Dressing the Luna Lounge…');
  world.buildLevel(getLevel(0));

  step(92, 'Cueing the midnight set…');
  // rAF never fires in a background tab, so never let the loader hang on it.
  await Promise.race([
    new Promise((resolve) => requestAnimationFrame(resolve)),
    new Promise((resolve) => setTimeout(resolve, 400))
  ]);
  step(100, 'Ready.');
  $('#boot').classList.remove('show');
  ui.setScreen('menu');
}

// Exposed for debugging and automated smoke checks.
window.catcop = {
  game, world, input, ui, audio, factory, playStory, STORY,
  // Drives frames when rAF is throttled (headless QA, background tabs).
  step(frames = 1, dt = 1 / 60) { for (let i = 0; i < frames; i++) game.update(dt); },
  run(seconds, dt = 1 / 60) { this.step(Math.round(seconds / dt), dt); }
};

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    game.update(dt);
  } catch (error) {
    console.error('[catcop] frame error', error);
  }
  requestAnimationFrame(loop);
}

boot().then(() => requestAnimationFrame(loop)).catch((error) => {
  console.error('[catcop] boot failed', error);
  $('#boot-status').textContent = `Boot failed: ${error.message}`;
});
