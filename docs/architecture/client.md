# Client

`packages/client`. Source: spec section 5. The client imports `sim` and `bots`
and owns all rendering, input, audio and UI. See [packages](packages.md).

## Loop

Fixed-step accumulator. The sim steps at 60 Hz, rendering runs at the display
rate and interpolates positions between the last two ticks. Rendering never
steps the sim.

`createFixedStepClock(scale)` takes an integer time scale, 1 by default, which
multiplies the elapsed time and the step cap (5 steps per frame, times the
scale). Only the dev-only launch sets it, from `?timescale=<n>` (1 to 200, see
Launch and match), so the e2e specs can play a whole match in a few dozen
frames. A production page always runs at scale 1.

## Input

Keyboard and mouse map to a `PlayerInput` each tick. Mouse aim is a ray from
the camera to the ground plane, quantized to centimeters. The record is
defined in [simulation](simulation.md). `toPlayerInput` fills one shared
object per input core and returns it, so a frame allocates nothing; a caller
that keeps inputs (a replay, a bot) must copy them. `step` copies it through
`resolveInput`.

Keys match on `event.code`, and the nine movement and slot actions can be rebound:
`bindings.ts` (pure) holds `Action` (up, left, down, right, SPACE, Q, E, R, F),
`DEFAULT_BINDINGS` (the table of rules.md section 6), `rebind` (refuses a code
another action holds, `duplicate`, and a reserved code, `reserved`: Escape, Tab,
F3, F4, both Shift keys, Control, Alt and Meta) and `keyLabel`. The mouse buttons
and Shift stay fixed: Shift modifies any slot and is two physical keys for one
bit. `InputCore` has a `bindings` getter and `setBindings`, and translates the
physical code of an event into the default code of its action before it joins
`held`, so `toPlayerInput` and its tables are the same whatever the bindings. A
key held across a rebinding is cleared by the `releaseAll` the menu runs on close.
Escape opens the menu (see Menu and keybinding).

Two keys are not game input. F3 toggles the debug overlay. F4 fires a debug
shot from the local champion towards the aim point; it is a dev-only key.
`main.ts` imports `debug-shot.ts` behind `import.meta.env.DEV`, so a
production build contains neither the key nor the module. No CI step checks
that; it is a review step: run `npm run build`, then
`grep -rE 'debugShots|"F4"|fireDebugShot|spawnProjectile|runProbeFrames|performance\.now|timescale' packages/client/dist`,
which must print nothing. The same guard hides the dev-only probe hook,
`window.__runProbeFrames`, which `combat.spec.ts` uses to run its heap-probe
windows (see [testing](testing.md)), and the time scale of `dev-launch.ts`
(`timescale` is the string that survives minification: the function names do
not).

## Launch and match

`main.ts` starts one page, one match. `parseLaunch(location.search, kitIds, arenaIds, import.meta.env.DEV)`
in `launch.ts` is the only reader of the address, and it takes the string, so a
later platform layer can pass its own arguments instead.

- `?champion=<id>`: the champion the human plays. It must be an id with a loaded
  kit; anything else reads as the first kit in roster order (Hargrim).
- `?difficulty=easy|normal|hard`: the tier of all three bots. Anything else
  reads as normal.
- `?arena=<id>`: the arena of the match, an id with a loaded definition (arena01
  and arena02); anything else reads as arena01, or as the first loaded id when
  arena01 is missing. The sandbox ignores it and always plays arena01, since the
  walk spec and the heap probe stand on its coordinates.
- `?scene=sandbox`: the dev-only scene of the heap probe and the walk spec,
  honoured only when `import.meta.env.DEV` is true. A production build has one
  scene. The sandbox roster and its read of the address are still in the
  production bundle, as unreachable code: `parseLaunch` takes the dev flag as an
  argument instead of the build dropping the branch. The sandbox keeps its
  place in `match-setup.ts` for now and moving it behind `import.meta.env.DEV`
  stays open (the dist grep finds the string `sandbox` for that reason).
- `?timescale=<n>`: dev-only, read by `dev-launch.ts` (`readDevLaunch`), which
  `main.ts` calls only as `import.meta.env.DEV ? readDevLaunch(location.search) :
  undefined`, so a build drops the module. An integer from 1 to 200 is the time
  scale of the loop clock; anything else reads as 1.

The kits are the files under `data/kits/`, read with an eager `import.meta.glob`
in `main.ts`, so a later kit file joins the match and the champion select
without a client change. `createMatch` validates them, and a bad kit file shows
up as a page error. The arenas work the same way: every file under
`data/arenas/` goes through `parseArenaDef` (a bad file is a page error too),
sorted by id, and `arenaById` in `arenas.ts` hands the chosen one to
`createLocalMatch`. `arenaModelUrl(arena.id)` and `data-arena` follow the id, so
`arena02.glb` loads with no change in `models.ts`. Of the pure modules, `launch`
takes the kit ids and the arena ids, `match-setup` takes the kit list and the
arena, and `result-dom` and `menu-dom` take ids and `{ id, name }` pairs (`bot-driver`,
`models` and `roster` take none of them), so the unit tests load the files
statically instead: `tsconfig.tools.json` has `types: ["node"]` and rejects
`import.meta.glob`.

`match-setup.ts` builds the match with `roundsToWin: DEFAULT_ROUNDS_TO_WIN` (the
sim's constant, 3):

- Champion 0 is the human, the local pick, on team A. It stays champion 0, so
  the first team A spawn, (-12, 2) on arena01 and (-11, 2) on arena02, and the
  e2e coordinates hold.
- Champion 1 is the ally bot, the other of Quillon and Hargrim (Quillon, or
  Hargrim when the pick is Quillon).
- Champions 2 and 3 are the enemy bots, Hargrim and Quillon, on team B.
- All four have kits. The local team is always A, so the score reads local
  against enemy.
- The sandbox is the old roster (Hargrim and Quillon against Lumeth and Skerrow)
  with match flow and exactly the Hargrim and Quillon kits, named in the code, so
  a later kit file never changes it. Champions 0 to 2 stand and champion 3 is a
  bot without a kit, which deals no damage. The heap probe needs a steady state,
  and a match of three bots is never in one (see the frame path below).

The bots run in the main thread, through `bot-driver.ts`. `createBotDriver(ids,
difficulty, seed)` makes one bot per driven id with the seed `seed * 100 + id`
(the local seed is 1), and `think(state, inputs)` writes `inputs[id]` for each
before `step` in every tick. The human's entry is the shared input object and
is left alone. The glue is one indexed loop over a list built once. A bot's
`think` allocates nothing in the steady state and returns the bot's own
`PlayerInput`, which its next think overwrites; `step` copies it, so the driver
writes the bot's record into `inputs` as it is.

Each champion has its own model: `championModelUrl(id)` in `models.ts` gives
`models/champions/<id>.glb` for a roster id and the placeholder for any other
id. The fallback goes by the id list and not by a failed load, since a 404 is a
console error and the e2e specs treat that as a failure. `loadModels` loads each
distinct URL once and clones one view per champion in id order.

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
- `bot-driver.ts`, `match-setup.ts` and `launch.ts`: see Launch and match.
- Canvas data hooks: `data-tick`, `data-p0x` and `data-p0y` (the human's position
  in centimetres), `data-f0` (its facing in radians, three decimals),
  `data-projectiles`, `data-areas`, `data-hits`, `data-deaths`, `data-flashing`,
  `data-rings`, `data-bar0` to `data-bar3` (a champion's fill percent, "x" for a
  hidden bar), `data-overlay`, `data-debugShots`, `data-phase` (the sim's phase
  string: warmup, round, roundEnd or matchEnd), `data-round` and the readiness
  flags `data-rendered` and `data-arena`. The e2e specs read them and pace
  themselves by `data-tick`. A per-tick hook is written only when its value
  changes, with `setAttribute` and text from the tables of `hook-text.ts`
  (integers, signed centimetres, facing in milliradians, percents) and
  `flashTexts` in `feedback.ts`, all made once at startup, so a change write
  builds no string. A table falls back to the formatter past its range. A position
  is two hooks and a bar is one hook per champion because a combined "x,y" or
  "a,b,c,d" text cannot come from a table.

The frame path allocates nothing in steady state: views are pooled, text comes
from tables and is written only on a change, and the numbers a frame carries live
in object fields. The combat spec measures it with a heap probe, see
[testing](testing.md). A match of bots is never in a steady state: hook and HUD
values change in every window. The change writes come from tables and so build
no string, but the probe still runs in the sandbox, where a casting champion in a
stationary scene changes almost nothing. A probe scene on the live match, which
would count those table writes with real changes, is issue #77 (batch 8).
The HUD writes its state with `setAttribute` and not `dataset`: in the
probe a `dataset` write allocated about 100 B per window whenever a slot
changed, and `setAttribute` allocated none.

The colours that the world view draws are constants in these files. Champion
model colours must stay clear of them, and `tools/blender/test_champion_models.py`
copies all of them but `BAR_BACK_COLOUR`, so a change here changes that list in the
same commit.

| File | Constants |
|------|-----------|
| `health-bars.ts` | `ALLY_BAR_COLOUR`, `ENEMY_BAR_COLOUR`, `BAR_BACK_COLOUR`, with `BAR_Y`, `BAR_HEIGHT` and the border that fix where a model must end |
| `impact-rings.ts` | `RING_COLOUR` |
| `champion-look.ts` | `FLASH_COLOUR`, `DEAD_COLOUR` |
| `entity-views.ts` | `PROJECTILE_ALLY_COLOUR`, `PROJECTILE_ENEMY_COLOUR` |
| `debug-overlay.ts` | the magenta overlay `#ff00ff` |

## HUD

An HTML and CSS overlay under `#hud`, built once at startup by `hud-dom.ts`.
It has seven elements, named by `data-hud` after
[rules.md](../design/rules.md) section 8: `health-bar`, `energy-bar`,
`cooldown-icons`, `round-score`, `round-timer`, `ring-warning` and `kill-feed`.

- Health bar: the local champion's health as `ceil(health) / maxHealth` and a
  fill.
- Energy bar: a fill with marks at 25 (EX ready) and 100 (ultimate ready).
- Cooldown icons: seven, in `SLOTS` order and labelled M1, M2, SPACE, Q, E, R
  and F. `hud-views.ts` turns a champion into seven `SlotView`s: whole seconds
  of cooldown left, a windup flag and a blocked flag. Its source is the sim's
  own fields, `Pick<ChampionState, 'energy' | 'cooldowns' | 'cast'>`, so a rename
  in the sim breaks the build. A slot shows its seconds from the cooldown (up to
  99, then the number itself), the ultimate shows as blocked while energy is
  below 100, and every slot dims during a windup. The energy marks and the
  ultimate cost are the sim's `EX_ENERGY_COST`, `ULTIMATE_ENERGY_COST` and
  `MAX_ENERGY`.
- Round score and timer: a `RoundView` read from `state.match`. The score is
  `score.A : score.B` with "first to N" from `match.roundsToWin` at startup. In
  the warmup the timer shows 1:30, since the round clock has not started. In a
  round it shows `ceil((ROUND_TICKS - phaseTicks) / TICK_RATE)` and holds at
  0:00; once `match.ring` exists it shows "Sudden death" and the timer's
  `data-sudden` is true (rules.md section 8). After a round and after the match
  it keeps its last text. A state without `match` reads 0 : 0 and 1:30.
- Ring warning: a `RingView` read from `state.match` and the local champion by
  `readRingView` (`hud-views.ts`), visible only in the round phase. In the 600
  ticks before sudden death it counts down "Sudden death in 10" to 1 from
  `phaseTicks` (one tick before the ring is made it still reads 1, since the sim
  makes the ring in the step that starts at 5400 phase ticks). Once `match.ring`
  exists it shows "Ring 18.0 m", the ring's own radius, which falls to 3.0 m. While
  the local champion is alive and outside the ring (`dx² + dy² > r²`, the sim's
  own test: exactly on the radius is inside) `data-outside` is true: the distance
  past the edge shows ("1.3 m outside") and a red edge draws along the viewport.
  The element carries `data-visible`, `data-counting` and `data-outside`, and the
  spans `ring-countdown`, `ring-radius` and `ring-distance`. Lengths are
  decimetres from the table of `hook-text.ts` (`dmText`).
- Kill feed: up to 5 lines for 300 ticks each. `feedback.ts` pushes a death as
  killer and victim, and names come from `roster.ts`. `routeEvents` makes no ring
  for a `projectileExpired` with the reason `roundEnd`: that shot was cut off by
  the round, and nothing was hit. The deciding death still reaches the feed,
  since the sim emits the deaths before `roundEnded`.

Not built yet: the shield segment on the health bar, the silence state of a
slot and the scoreboard.

### Result screen and champion select

A second root, `#result`, sits next to `#hud` in `index.html` and is built once
by `result-dom.ts`. Its panel is hidden (`data-visible="false"`) until the phase
is `matchEnd`, and `ResultScreen.update` (`result-screen.ts`), called after
`hud.update`, then shows Victory or Defeat (the local team against the team that
reached `roundsToWin`) and the final score, local first, written once. The panel
holds the select, built by `buildSelect` in `result-dom.ts`, which the menu
builds again for its own select view. The champion row has one entry per roster id
in roster order. An id with a loaded kit is a link to
`?champion=<id>&difficulty=<current>&arena=<current>` (`data-available="true"`);
following it reloads the page, so the kill feed, the views and the bots start
fresh and the tick never goes back to 0 within a page. A roster champion without
a kit file is greyed (`data-available="false"`) until its file exists. The arena
row has one link per loaded arena in id order, labelled with `ArenaDef.name`, to
`?champion=<current>&difficulty=<current>&arena=<id>` (`data-arena-id`), and the
arena being played carries `data-current="true"`. There is no pre-match screen. Only
the visible panel takes pointer events; the HUD takes none.

`e2e/match-end.spec.ts` plays the default match to this screen in a browser, on
`/?timescale=100` (see Launch and match), once per arena (arena02 on
`/?arena=arena02&timescale=100`), with the human idle: a 16 ms frame runs 96 ticks,
so a match of 3000 to 5000 ticks is some 30 to 55 frames at 5 frames a read, where
without the scale it would be thousands of frames. It reads the panel hidden until
`data-phase` is `matchEnd`, then the title, the score (equal to the HUD's), the
select, takes `result.png` and follows the Quillon link, which keeps the arena. The
headless integration tests (`match-setup.test.ts`: one round to win and three on
arena01, three on arena02) give the tick budget of each arena, and the result
screen's unit tests the Victory and Defeat cases that the idle human cannot reach.

`Hud.update` runs once per stepping frame, after all of that frame's sim steps.
It compares integers and booleans held in cache fields with the new values and
writes the DOM only when one changed, so a steady frame writes and allocates
nothing. The texts come from tables made in the constructor: the health text and
fill per whole health up to the local champion's maximum, the energy fill per
whole energy, and the score per pair up to the rounds to win (`scoreTexts` in
`hud-views.ts`, shared with the result screen). A value past a table builds its
text, so nothing is wrong outside the range, only slower. The kill feed counts
its pushes and expiries, and the HUD skips its line loop while that count has
not moved. The e2e specs read the states from data attributes: `data-ready`,
`data-windup` and `data-blocked` on a slot, `data-ready` on an energy mark,
`data-visible` on a kill-feed line, `data-team` on its names and `data-sudden`
on the timer.

`hud.css` sizes everything from one viewport unit, `--hud-u` (`min(1vw,
1.78vh)`), so the HUD scales with the window, and sets `pointer-events: none` on
everything, so a right click reaches the canvas. `result.css` follows the same
rules with `--result-u` and `#result`, and one difference: the visible panel
takes pointer events. So does `menu.css`, with `--menu-u` and `#menu`. The colours are hex custom properties on `#hud`. Panels
are neutral black with alpha and every foreground element sits on one, with one
exception: the ring warning's red edge, an inset shadow in `var(--hud-enemy)`
along the viewport that shows while the local champion is outside the ring
(rules.md section 8 asks for an edge, which cannot sit on a panel). The
warning's text is on a panel. Text is off-white, below 250 in every channel.
Allies and enemies use the health-bar colours. No colour is blue, purple or
magenta, none falls in the pixel boxes the e2e specs count (white, the yellow
ring, the magenta overlay) and none is within 80 of a champion body colour.
`hud-palette.test.ts` checks all of this over the three style sheets.

A debug overlay draws collision circles, obstacles, projectiles and line of
sight. It draws as lines in the 3D scene, not in the HTML HUD, so its shapes
line up with world-space footprints under the perspective camera.

## Menu and keybinding

A third root, `#menu`, next to `#hud` and `#result`, built once at startup by
`menu-dom.ts` and hidden. Escape toggles it in every phase (rules.md section 6).
A pure `Menu` (`menu.ts`) holds the state and takes element handles (the tests
pass fakes, as for the HUD) and three actions from `main.ts`: `setPaused`,
`restart` and `releaseInput`. `bindMenu` connects the window keydown (Escape, and
the key of a capture) and a plain DOM click on each button.

- **Pause.** `setPaused(true)` is `renderer.setAnimationLoop(null)`: no frame runs,
  so the sim, the bot driver and the views all stop, and the canvas keeps its last
  picture. `setPaused(false)` calls `clock.reset()` (`loop.ts`) and starts the loop
  again. After a reset the next `advance` returns 0, so the paused time is never
  caught up (without it the first frame would run the full 5 steps of a stall). The
  input is released on open and on close. Pausing this way keeps `frame`, `stepSim`,
  `draw` and the hook writers as they are: nothing in the menu runs per frame, and
  its DOM is written only on events. The heap probes never open it.
- **Resume** is Escape again or the button. **Restart** is `location.reload()`: the
  address is the setup (champion, difficulty, arena and the dev time scale), and the
  tick still never goes back to 0 within a page. **Back to select** shows the
  menu's own select view, the champion and arena links of the result panel built by
  `buildSelect`, with the match still paused; a pick follows a link and reloads.
- **Views.** The panel carries `data-visible` and `data-view` (`main`, `select` or
  `keys`), the sections are `data-section`, and the buttons carry `data-action`
  (`resume`, `restart`, `select`, `keys`, `back`, `reset`). The panel always opens
  on the main view.
- **Keys view.** One row per action (`data-binding=<action>`, `data-part="key"`
  and a `data-rebind` button) built at startup and written only when its text
  changes. A click on a rebind button waits for the next key (`data-capturing` on
  the keys section and the row): a key that applies is saved once, Escape cancels
  the capture and leaves the menu open, and a duplicate or reserved key sets
  `data-error` and changes and saves nothing. Reset restores the defaults and
  saves them.
- **Pointer.** The menu reads no pointer position and calls no
  `getBoundingClientRect`. The window `mousemove` listener of the input core keeps
  setting `input.pointer`, so after a menu click `main.ts:sampleAim` allocates
  exactly as it does for any mouse (issue #87, not fixed here).

The menu pauses in local matches only. Pausing online is milestone 6.

## Platform interface

Steam readiness: `Platform { identity(), loadSettings(), saveSettings(),
unlockAchievement(id), openUrl(url) }`. `BrowserPlatform` is the only
implementation until milestone 8.

Only the two settings methods are built, in `platform.ts`; `identity`,
`unlockAchievement` and `openUrl` join with their first user. They return
Promises, so an Electron renderer reaches files over IPC with no change of
signature. `Settings` is `{ version: 1, bindings }`. `createBrowserPlatform`
takes an injected `getItem`/`setItem` pair (`main.ts` passes `window.localStorage`
from inside a try, since reading it can throw) and keeps one JSON text under the
key `claudeline-champions.settings`. The store is written only on a rebind or a
reset, and `main.ts` awaits `loadSettings` and applies the bindings before it
binds the input. `readSettings` reads the defaults, whole, when the stored text is
unusable, since a per-field merge could create a duplicate: no text, bad JSON, a
version other than the number 1, a missing action, or a code that is not a string,
is reserved or is shared. A throwing `getItem` reads the defaults, and a throwing
`setItem` resolves after a `console.warn`, because a console error fails every e2e.

## Steam readiness rules

- Game code only talks to the `Platform` interface.
- Assets load relative to the app base path, never from absolute URLs.
- Rendering scales from a browser tab to a fullscreen 4K desktop window:
  resolution-independent camera framing, device-pixel-ratio aware canvas.
