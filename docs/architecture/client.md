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
production build contains neither the key nor the module. No CI step checks
that; it is a review step: run `npm run build`, then
`grep -rE 'debugShots|"F4"|fireDebugShot|spawnProjectile|runProbeFrames|performance\.now' packages/client/dist`,
which must print nothing. The same guard hides the dev-only probe hook,
`window.__runProbeFrames`, which `combat.spec.ts` uses to run its heap-probe
windows (see [testing](testing.md)).

## Launch and match

`main.ts` starts one page, one match. `parseLaunch(location.search, kitIds, import.meta.env.DEV)`
in `launch.ts` is the only reader of the address, and it takes the string, so a
later platform layer can pass its own arguments instead.

- `?champion=<id>`: the champion the human plays. It must be an id with a loaded
  kit; anything else reads as the first kit in roster order (Hargrim).
- `?difficulty=easy|normal|hard`: the tier of all three bots. Anything else
  reads as normal.
- `?scene=sandbox`: the dev-only scene of the heap probe and the walk spec,
  honoured only when `import.meta.env.DEV` is true. A production build has one
  scene.

The kits are the files under `data/kits/`, read with an eager `import.meta.glob`
in `main.ts`, so a later kit file joins the match and the champion select
without a client change. `createMatch` validates them, and a bad kit file shows
up as a page error. The pure modules (`launch`, `match-setup`, `bot-driver`,
`models`, `roster`) take the kit list as an argument, so the unit tests load the
two files statically instead: `tsconfig.tools.json` has `types: ["node"]` and
rejects `import.meta.glob`.

`match-setup.ts` builds the match with `roundsToWin: DEFAULT_ROUNDS_TO_WIN` (the
sim's constant, 3):

- Champion 0 is the human, the local pick, on team A. It stays champion 0, so
  the spawn at (-12, 2) and the e2e coordinates hold.
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
- Canvas data hooks: `data-tick`, `data-p0`, `data-f0`, `data-projectiles`,
  `data-areas`, `data-hits`, `data-deaths`, `data-flashing`, `data-rings`,
  `data-bars`, `data-overlay`, `data-debugShots`, `data-phase` (the sim's phase
  string: warmup, round, roundEnd or matchEnd), `data-round` and the readiness
  flags `data-rendered` and `data-arena`. The e2e specs read them and pace
  themselves by `data-tick`. A hook is written only when its value changes.

The frame path allocates nothing in steady state: views are pooled, text is
written only on a change, and the numbers a frame carries live in object
fields. The combat spec measures it with a heap probe, see
[testing](testing.md). A match of bots is never in a steady state: hook and HUD
values change in every window, and a change write that builds a string
(`flashText`, `hookText`, the `p0` and `f0` hooks, the health and energy
templates, the score) allocates by design. So the probe runs in the sandbox,
where a casting champion in a stationary scene keeps the writes to a table of
constants. The HUD writes its state with `setAttribute` and not `dataset`: in the
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
It has six elements, named by `data-hud` after
[rules.md](../design/rules.md) section 8: `health-bar`, `energy-bar`,
`cooldown-icons`, `round-score`, `round-timer` and `kill-feed`.

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
- Kill feed: up to 5 lines for 300 ticks each. `feedback.ts` pushes a death as
  killer and victim, and names come from `roster.ts`. `routeEvents` makes no ring
  for a `projectileExpired` with the reason `roundEnd`: that shot was cut off by
  the round, and nothing was hit. The deciding death still reaches the feed,
  since the sim emits the deaths before `roundEnded`.

Not built yet: the ring warning, the shield segment on the health bar, the
silence state of a slot, the scoreboard and the menu.

### Result screen and champion select

A second root, `#result`, sits next to `#hud` in `index.html` and is built once
by `result-dom.ts`. Its panel is hidden (`data-visible="false"`) until the phase
is `matchEnd`, and `ResultScreen.update` (`result-screen.ts`), called after
`hud.update`, then shows Victory or Defeat (the local team against the team that
reached `roundsToWin`) and the final score, local first, written once. The panel
holds the select: one entry per roster id in roster order. An id with a loaded
kit is a link to `?champion=<id>&difficulty=<current>` (`data-available="true"`);
following it reloads the page, so the kill feed, the views and the bots start
fresh and the tick never goes back to 0 within a page. Lumeth and Skerrow are
greyed (`data-available="false"`) until their kit files exist. There is no
pre-match screen. Only the visible panel takes pointer events; the HUD takes
none.

No e2e plays a match to the end: a full match of bots is thousands of ticks, and
a tick is one 17 to 24 ms frame at the probe viewport on the runner. The
evidence is a headless integration test through the client's own setup and
driver (`match-setup.test.ts`, one round to win), the result screen's unit tests
and the e2e check that the hidden panel and its select exist.

`Hud.update` runs once per stepping frame, after all of that frame's sim steps.
It compares integers and booleans held in cache fields with the new values and
writes the DOM only when one changed, so a steady frame writes and allocates
nothing. The kill feed counts its pushes and expiries, and the HUD skips its
line loop while that count has not moved. The e2e specs read the states from
data attributes: `data-ready`, `data-windup` and `data-blocked` on a slot,
`data-ready` on an energy mark, `data-visible` on a kill-feed line,
`data-team` on its names and `data-sudden` on the timer.

`hud.css` sizes everything from one viewport unit, `--hud-u`
(`min(1vw, 1.78vh)`), so the HUD scales with the window, and sets
`pointer-events: none` on everything, so a right click reaches the canvas.
`result.css` follows the same rules with `--result-u` and `#result`, and one
difference: the visible panel takes pointer events. The
colours are hex custom properties on `#hud`. Panels are neutral black with
alpha and every foreground element sits on one. Text is off-white, below 250 in
every channel. Allies and enemies use the health-bar colours. No colour is blue,
purple or magenta, none falls in the pixel boxes the e2e specs count (white,
the yellow ring, the magenta overlay) and none is within 80 of a champion body
colour. `hud-palette.test.ts` checks all of this over both style sheets.

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
