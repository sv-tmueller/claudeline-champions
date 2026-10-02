# Client

`packages/client`. Source: spec section 5. The client imports `sim` and `bots`
and owns all rendering, input, audio and UI. See [packages](packages.md).

## Loop

Fixed-step accumulator. The sim steps at 60 Hz, rendering runs at the display
rate and interpolates positions between the last two ticks. Rendering never
steps the sim.

## Input

Keyboard and mouse map to a `PlayerInput` each tick. Mouse aim is a ray from
the camera to the ground plane, quantized to centimeters. The record is
defined in [simulation](simulation.md). `toPlayerInput` fills one shared
object per input core and returns it, so a frame allocates nothing; a caller
that keeps inputs (a replay, a bot) must copy them. `step` copies it through
`resolveInput`.

Two keys are not game input. F3 toggles the debug overlay. F4 fires a debug
shot from the local champion towards the aim point; it is a dev-only key.
`main.ts` imports `debug-shot.ts` behind `import.meta.env.DEV`, so a
production build contains neither the key nor the module; the check for that
greps `dist` for them.

## Camera

Fixed, tilted about 55 degrees from horizontal, positioned so the whole arena
fits the viewport with margin. No rotation, no zoom in v1.

## Scene

Arena model and champion models loaded from glTF under `assets/models/`.
Projectiles and areas are simple meshes. Effects start as meshes and
billboards. Animations come from glTF clips once rigs exist. See
[assets](assets.md).

The combat view is made of small modules that `main.ts` wires together. The
sim steps first and the views read its state afterwards.

- `entity-views.ts`: pooled meshes for projectiles and areas, matched to sim
  entities by id and interpolated between ticks.
- `health-bars.ts`: a world-space bar above each champion, green for allies
  and red for enemies.
- `impact-rings.ts`: a fixed pool of rings that grow and fade where a
  projectile ended, aged in sim ticks.
- `feedback.ts` and `champion-look.ts`: `routeEvents` turns the step's events
  into the hit flash, the rings, the hit and death counters and the kill feed;
  `champion-look` swaps a champion's materials between its own, the white flash
  and the faded dead grey.
- `debug-shot.ts`: the dev-only F4 shot above.
- Canvas data hooks: `data-tick`, `data-p0`, `data-f0`, `data-projectiles`,
  `data-areas`, `data-hits`, `data-deaths`, `data-flashing`, `data-rings`,
  `data-bars`, `data-overlay`, `data-debugShots` and the readiness flags
  `data-rendered` and `data-arena`. The e2e specs read them and pace
  themselves by `data-tick`. A hook is written only when its value changes.

The frame path allocates nothing in steady state: views are pooled, text is
written only on a change, and the numbers a frame carries live in object
fields. The combat spec measures it with a heap probe, see
[testing](testing.md).

The colours that the world view draws are constants in these files. Champion
model colours must stay clear of them, and `tools/blender/test_champion_models.py`
copies them, so a change here changes that list in the same commit.

| File | Constants |
|------|-----------|
| `health-bars.ts` | `ALLY_BAR_COLOUR`, `ENEMY_BAR_COLOUR`, `BAR_BACK_COLOUR`, with `BAR_Y`, `BAR_HEIGHT` and the border that fix where a model must end |
| `impact-rings.ts` | `RING_COLOUR` |
| `champion-look.ts` | `FLASH_COLOUR`, `DEAD_COLOUR` |
| `entity-views.ts` | `PROJECTILE_ALLY_COLOUR`, `PROJECTILE_ENEMY_COLOUR` |
| `debug-overlay.ts` | the magenta overlay `#ff00ff` |

## HUD

An HTML and CSS overlay under `#hud`, built once at startup by `hud-dom.ts`.
It has six elements, named by `data-hud` after
[rules.md](../design/rules.md) section 8: `health-bar`, `energy-bar`,
`cooldown-icons`, `round-score`, `round-timer` and `kill-feed`.

- Health bar: the local champion's health as `ceil(health) / maxHealth` and a
  fill.
- Energy bar: a fill with marks at 25 (EX ready) and 100 (ultimate ready).
- Cooldown icons: seven, in `SLOTS` order and labelled M1, M2, SPACE, Q, E, R
  and F. `hud-views.ts` turns a champion into seven `SlotView`s: whole seconds
  of cooldown left, a windup flag and a blocked flag. Today's champion has no
  cooldowns, so every slot reads as ready; the ultimate shows as blocked while
  energy is below 100, and every slot dims during a windup. The adapter reads
  `cooldowns` and `cast` by shape, so it picks up the kit framework's fields
  without a change, and the batch that wires bots and kits makes them required.
- Round score and timer: a `RoundView` placeholder until match flow exists. The
  score reads 0 : 0 with "first to 3", and the timer counts down from 1:30 by
  `state.tick` and holds at 0:00. The sudden death text arrives with match flow.
- Kill feed: up to 5 lines for 300 ticks each. `feedback.ts` pushes a death as
  killer and victim, and names come from `roster.ts`.

Not built yet: the ring warning, the shield segment on the health bar and the
silence state of a slot.

`Hud.update` runs after every sim step. It compares integers and booleans held
in cache fields with the new values and writes the DOM only when one changed, so
a steady frame writes and allocates nothing. The e2e specs read the states from
data attributes: `data-ready`, `data-windup` and `data-blocked` on a slot,
`data-ready` on an energy mark, `data-visible` on a kill-feed line and
`data-team` on its names.

`hud.css` sizes everything from one viewport unit, `--hud-u`
(`min(1vw, 1.78vh)`), so the HUD scales with the window, and sets
`pointer-events: none` on everything, so a right click reaches the canvas. The
colours are hex custom properties on `#hud`. Panels are neutral black with
alpha and every foreground element sits on one. Text is off-white, below 250 in
every channel. Allies and enemies use the health-bar colours. No colour is blue,
purple or magenta, none falls in the pixel boxes the e2e specs count (white,
the yellow ring, the magenta overlay) and none is within 80 of a champion body
colour. `hud-palette.test.ts` checks all of this.

A debug overlay draws collision circles, obstacles, projectiles and line of
sight. It draws as lines in the 3D scene, not in the HTML HUD, so its shapes
line up with world-space footprints under the perspective camera.

## Platform interface

Steam readiness: `Platform { identity(), loadSettings(), saveSettings(),
unlockAchievement(id), openUrl(url) }`. `BrowserPlatform` is the only
implementation until milestone 8.

## Steam readiness rules

- Game code only talks to the `Platform` interface.
- Assets load relative to the app base path, never from absolute URLs.
- Rendering scales from a browser tab to a fullscreen 4K desktop window:
  resolution-independent camera framing, device-pixel-ratio aware canvas.
