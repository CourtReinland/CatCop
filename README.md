# CatCop — *Lifted Wing: Desire Protocol*

A mobile-first, light-gun **otome action shooter** in the spirit of the old Virtua Cop
cabinets. Built with Three.js, runs in the browser, designed for iOS Safari in portrait.

> New York, 2035. Suki sings the midnight set at the Luna Lounge in a police costume.
> The modelling agency next door has been running an anti-aging treatment that works —
> and removes the part of a person that knows how to stop. At 11:52pm the wall comes
> down. Commander Eno of the Lifted Wing Division sees the uniform, not the costume.

**Play:** open `game/index.html` from any static host (see *Running* below).

---

## How it plays

| | |
|---|---|
| **Aim** | Drag anywhere. The sight sits above your thumb so your hand never covers the target. |
| **Fire** | Hold. The sight turns red and beeps the moment it locks on. |
| **Hold fire** | Anything ringed in **green** is a civilian. Three of them ends the mission. |
| **Supplies** | Shoot the glowing cases for health, ammo and new weapons. |
| **Advance** | Clear an area and the party walks up through the club on its own. |
| **Gyro** | Optional — the menu can switch aiming to phone attitude instead of touch. |

Two chapters, ten hand-authored areas:

- **Chapter 1 · Luna Lounge** — Coat Check → Main Floor → The Long Bar → VIP Booths →
  Backstage Corridor → Main Stage
- **Chapter 2 · Vanta Model Agency** — Service Alley → Reception Atrium → Runway Studio →
  Treatment Lab

## Design notes

A few decisions that are load-bearing, recorded so they don't get "fixed" later:

- **Touch aiming, not gyro-plus-fire-button.** A reticle you steer by rotating the phone
  while holding a separate FIRE button is accurate on paper and miserable in a hand. The
  reticle lives under your finger; gyro stays available as an opt-in.
- **The aim beam is the lighting.** A spotlight is bound to the shot ray, so the club can
  stay genuinely dark while remaining playable — the player is the thing that reveals
  what is standing in the room.
- **Ambushers mount their cover.** Low furniture (bar, tables, pods) is *mounted*: the
  body rises out of it and stands on top, fully visible, before leaping down at you.
  Rising *behind* a counter shows nothing but a scalp.
- **The menace beat.** After the reveal they hold and stare for ~1s before closing. That
  is both the horror beat and the player's reaction window; without it a 6m ambush is a
  2.5-second death sentence.
- **Rim light, not floodlight.** Bodies are near-black with a tight fresnel rim in their
  faction colour (hot pink = infected, green = civilian), matching the key art. Accent
  lights sit *behind* them — in front they wash the silhouette flat.
- **The sidearm never runs out.** Magazine plus auto-reload, with an infinite reserve on
  the Luna Sidearm. A light-gun game must never reach a state where you cannot shoot your
  way out.
- **No ranged enemies in these chapters.** They walk, they lunge, they scare you. Damage
  happens on contact only.
- **Stylised hits.** Rose petals and light rather than gore.

## Running

Any static file server works — it is plain ES modules with no build step.

```bash
python3 devserver.py 5310 game
```

Then open <http://localhost:5310>. `devserver.py` only differs from `python3 -m http.server`
in that it disables caching, which matters when iterating on `game/src/*.js`.

Motion aiming needs a secure context, so gyro is only offered over HTTPS (or on
`localhost`). Touch and mouse aiming work anywhere.

## Layout

```
game/
  index.html          screens, HUD, reticle, markers
  src/
    config.js         all tuning constants + the asset table
    levels.js         hand-authored areas, props and ambush waves
    world.js          scene, procedural rooms, lighting, FX, raycasting
    actors.js         rigged characters, rim material, animation, hit reactions
    game.js           mission controller: waves, AI, hitscan, scoring
    input.js          touch / mouse / gyro aiming
    audio.js          sampled SFX + synthesised eerie score + haptics
    ui.js             HUD, world markers, visual-novel overlays
    styles.css
  assets/             audio, character rig, weapon models, key art
devserver.py          no-cache static server for development
```

`window.catcop` is exposed in the browser for debugging (`catcop.game`, `catcop.world`,
`catcop.step(frames)` to advance frames manually).

## Credits

Characters, world, story, level design and code are original to this project.

Third-party assets, all CC0:

- Rigged character (`characterMedium`) and run/idle clips, weapon models — [Kenney](https://kenney.nl)
- Sample SFX — CC0 sources, bundled under `game/assets/audio/`

Key art for Suki, Eno and the infected was generated for this project and is bundled
under `game/assets/art/`. The in-game score is synthesised at runtime with WebAudio.
