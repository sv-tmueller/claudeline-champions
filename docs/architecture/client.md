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

The aim sampling allocates nothing either, with a pointer present. `camera.ts`
copies the canvas's client rect into an object once per resize
(`refreshCanvasRect`, called by the resize handler in `main.ts` after
`setSize`), because `getBoundingClientRect` makes a new `DOMRect` on every
call, and `groundAimFromPointer` casts the pointer's ray through that copy and
writes the ground point into a scratch record (`aimHit`), returning only
whether the ray hit the plane. For the aim sampling, the entity drawing, the
champion placing, the overlay circles, the rings' `spawn` and position, the
animation state machine and the clip sampler the rule is that no raw double
crosses a call: objects go in and fields are read out, since a double passed to
a call that V8 does not inline is boxed.
`main.ts:draw` places each champion view through `placeChampion` in
`interpolate.ts` (the fields of the position, and the facing through
`rotation.fromArray` over a preallocated tuple of doubles), the overlay hands
its circles group back once from the build and `updateChampionCircles` writes
the fields of each position, and the loop clock's `alpha` is read by field in
`interpolatePoses` and in the `draw` of the entity views and the rings, which
take the clock record. `routeEvents` passes the sim's event records to `hit`
and `expire`. A hit is rare, so its code runs in V8's interpreter, where every
load of a double field allocates: `ImpactRings.spawn` only keeps the record,
and the rings' `draw` reads its coordinates. It is not a rule of the whole
frame path: `interpolatePoses` still passes three raw doubles to `lerpAngle`,
and the rings' `draw` passes two to `scale.set` per live ring, which read 0 B
once hot (the rings' `draw` logs 24 B in sandbox window 1, see
[testing](testing.md)) because V8 inlines them, and the probe's mutations catch
a regression there. The two animation modules hold their doubles in
`Float64Array`s and pass records and indices, see Animation. The hook's
`frameMany` boxes one timestamp per frame (9 to 18 B, see
[testing](testing.md)). The copy assumes the canvas fills `#app`, so
only a resize moves its rect; a layout change without a resize event would
leave it stale. The mapping itself is unchanged, and `camera.test.ts` keeps
the two functions it replaced as an oracle, compared to the new path with
`Object.is` over a grid of canvases and pointers.

Keys match on `event.code`, and the nine movement and slot actions can be
rebound: `bindings.ts` (pure) holds `Action` (up, left, down, right, SPACE, Q,
E, R, F), `DEFAULT_BINDINGS` (the table of rules.md section 6), `rebind`
(refuses a code another action holds, `duplicate`, and a reserved code,
`reserved`: Escape, Tab, F3, F4, both Shift keys, Control, Alt, Meta and the
empty code of a key the browser cannot identify) and `keyLabel`. The mouse
buttons and Shift stay fixed: Shift modifies any slot and is two physical keys
for one bit. `InputCore` has a `bindings` getter and `setBindings`, and
translates the physical code of an event into the default code of its action
before it joins `held`, so `toPlayerInput` and its tables are the same whatever
the bindings. A key held across a rebinding is cleared by the `releaseAll` the
menu runs on close. Escape opens the menu (see Menu and keybinding).

Tab is reserved and fixed (rules.md section 6) and is no `Action`: the input
core ignores it, since it is not in the translation. While it is held,
`bindScoreboard` (`scoreboard-dom.ts`) shows the scoreboard (see HUD,
Scoreboard). A keydown of Tab, repeats included and not with Ctrl, Alt or Meta
held, calls `preventDefault` and `show`; a keyup hides it, and so do a blur and
a visibility change, which can swallow the keyup. While the menu is open the
listener does nothing and leaves the default alone, so Tab keeps moving focus
in the menu. The listener is event code, not frame path.

Two keys are not game input. F3 toggles the debug overlay. F4 fires a debug
shot from the local champion towards the aim point; it is a dev-only key.
`main.ts` imports `debug-shot.ts` behind `import.meta.env.DEV`, so a
production build contains neither the key nor the module. No CI step checks
that; it is a review step: run `npm run build`, then
`grep -rE 'debugShots|spawnProjectile|runProbeFrames|performance\.now|timescale' packages/client/dist`,
which must print nothing. The pattern has no `"F4"` and no `fireDebugShot`: a
build minifies function names, and the key code `F4` also ships in the reserved
list of `bindings.ts`, so neither tells the debug shot from the rest. The terms
that survive minification in any quote style are the property names `debugShots`
and `spawnProjectile`. The same guard hides the dev-only probe hook,
`window.__runProbeFrames`, which `combat.spec.ts` and `live-probe.spec.ts` use
to run their heap-probe windows (see [testing](testing.md)), and the time scale
of `dev-launch.ts` (`timescale` is the string that survives minification: the
function names do not).

## Launch and match

`main.ts` starts one page, one match. Three functions read the address, and all
of them take the string, so a later platform layer can pass its own arguments
instead:

- `opensSelect(location.search, import.meta.env.DEV ? DEV_LAUNCH_KEYS : [])` in
  `launch.ts` decides whether the pre-match select comes first (see Pre-match
  select).
- `parseLaunch(location.search, kitIds, arenaIds, import.meta.env.DEV)` in
  `launch.ts` reads the setup of the match. After the select, it reads the
  address Start wrote, so a select launch and a parameter launch take the same
  path.
- `readDevLaunch(location.search)` in `dev-launch.ts` reads `?timescale`, in a
  dev build only.

`relaunch(champion, difficulty, arena, teamSize)` in `launch.ts` is the writer:
the query of every select link and of Start, which writes all four keys. The
address is the whole setup (batch #91 decision 5).

The entry rule: the select opens exactly when the query string has none of
`champion`, `difficulty`, `arena` or `teamsize`, and in a dev build none of
`scene` or `timescale` either. "Has" is `URLSearchParams.has`: a key with any
value, an empty or unknown one included, skips the screen, so `?champion=`,
`?difficulty=brutal` and `?teamsize=4` play a match as they always did. A bare
`/`, `/?` and unrelated keys (`?utm_source=x`) open the select. Keys are
case-sensitive, as `parseLaunch` reads them. The dev keys sit in
`DEV_LAUNCH_KEYS` (`dev-launch.ts`), not in `launch.ts`: the name `timescale`
must not reach a production file (the dist grep).

`parseLaunch` reads these keys:

- `?champion=<id>`: the champion the human plays. It must be an id with a loaded
  kit; anything else reads as the first kit in roster order (Hargrim).
- `?difficulty=easy|normal|hard`: the tier of every bot. Anything else
  reads as normal. The select offers the three tiers and every link writes
  the one it keeps (see Result screen and champion select).
- `?arena=<id>`: the arena of the match, an id with a loaded definition (arena01
  and arena02); anything else reads as arena01, or as the first loaded id when
  arena01 is missing. The sandbox ignores it and always plays arena01, since the
  walk spec and the heap probe stand on its coordinates.
- `?teamsize=2|3`: the team size of the match, 2v2 or 3v3. Only the exact
  string `3` reads as 3; anything else (empty, `4`, `3v3`, `03`) reads as 2,
  and so does the sandbox, whose roster is four champions. The address asks and
  the arena decides: `playableTeamSize(asked, arena)` in `match-setup.ts` gives
  3 only when both teams of the arena list three spawns, and 2 otherwise, so an
  arena file with two spawns a team (legal, arenas.md section 3) plays 2v2 and
  the sim's missing spawn error never reaches the page. Both shipped arenas
  have three.
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
in `main.ts`. A later kit file joins the match without a client change, reached
by `?champion=<id>` on the placeholder model. The select shows the roster ids
the client registers with a name and a model (`ROSTER_IDS`), each available once
its kit file exists, so a kit without a roster entry is not on it until the
client registers it (batch #147 decision 3, part 3). `createMatch` validates the
kits, and a bad kit file shows up as a page error. The arenas work the same way:
every file under `data/arenas/` goes through `parseArenaDef` (a bad file is a
page error too), sorted by id, and `arenaById` in `arenas.ts` hands the chosen
one to `createLocalMatch`. `arenaModelUrl(arena.id)` and `data-arena` follow the
id, so `arena02.glb` loads with no change in `models.ts`. Of the pure modules,
`launch` takes the kit ids and the arena ids, `match-setup` takes the kit list
and the arena, and `result-dom` and `menu-dom` take ids and
`{ id, name, spawns }` records (`bot-driver`, `models` and `roster` take none of
them), so the unit tests load the files statically instead:
`tsconfig.tools.json` has `types: ["node"]` and rejects `import.meta.glob`.

`match-setup.ts` builds the match with `roundsToWin: DEFAULT_ROUNDS_TO_WIN` (the
sim's constant, 3):

- Champion 0 is the human, the local pick, on team A. It stays champion 0, so
  the first team A spawn, (-12, 2) on arena01 and (-11, 2) on arena02, and the
  e2e coordinates hold.
- Team B is one row of `ENEMY_ROSTER` by team size: Hargrim and Quillon in a
  2v2, Hargrim, Quillon and Lumeth in a 3v3. Team A is the pick plus that row
  without the pick's own entry, or without its first entry when the pick is not
  in the row. So the 2v2 ally is the other of Quillon and Hargrim (Quillon for
  Hargrim, Skerrow and Lumeth, Hargrim for Quillon), and in a 3v3 the Hargrim
  pick has a Quillon and a Lumeth ally, which is the bots package's headless
  `lumeth3v3` (`configLumeth3v3` in `packages/bots/test/helpers.ts`, mirrored
  as a literal in `match-setup.test.ts`, since the client cannot import a bots
  test). The 2v2 row has no healer, so the 2v2 matches and the live scene do
  not move. The 3v3 tests pass the Lumeth kit with the other two
  (`LUMETH_KIT` in `test-kits.ts`): `createMatch` accepts a champion with no
  kit, so a test that left it out would play a Lumeth with no abilities.
- Every champion has a kit. The bots are champions 1 to 2n-1 for n a side:
  three in a 2v2 and five in a 3v3. The local team is always A, so the score
  reads local against enemy.
- The sandbox is the old roster (Hargrim and Quillon against Lumeth and Skerrow)
  with match flow and exactly the Hargrim and Quillon kits, named in the code, so
  a later kit file never changes it. Champions 0 to 2 stand and champion 3 is a
  bot without a kit, which deals no damage. It is the heap probe's steady-state
  scene, since a match of bots is never in one (see the frame path below);
  the live match is the probe's second scene.

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
distinct URL once and clones one view per champion in id order, with
SkeletonUtils' `clone`: a plain `Object3D.clone` of a rigged model shares the
source skeleton, so every view would draw at the arena origin. It then binds the
six clips of the model to the view's bones (`createClipRig`, see Animation); a
model without one of the clips is a page error at load.

## Camera

Fixed, tilted about 55 degrees from horizontal, positioned so the whole arena
fits the viewport with margin. No rotation, no zoom in v1.

## Scene

Arena model and champion models loaded from glTF under `assets/models/`.
Projectiles and areas are simple meshes. Effects start as meshes and
billboards. The champion models are rigged with six clips (Idle, Run, Attack,
Cast, Hit, Death), which the client plays itself: see Animation and
[assets](assets.md).

The combat view is made of small modules that `main.ts` wires together. The
sim steps first and the views read its state afterwards.

- `entity-views.ts`: pooled meshes for projectiles and areas, matched to sim
  entities by id and interpolated between ticks.
- `health-bars.ts`: a world-space bar above each champion, green for allies
  and red for enemies.
- `impact-rings.ts`: a fixed pool of rings that grow and fade where a
  projectile ended, aged in sim ticks. A hit on the owner's own team (a heal
  bolt) draws its ring in the owner team's projectile colour.
- `feedback.ts` and `champion-look.ts`: `routeEvents` turns the step's events
  into the hit flash, the rings, the hit and death counters and the kill feed;
  `champion-look` swaps a champion's materials between its own, the white flash
  and the faded dead grey.
- `debug-shot.ts`: the dev-only F4 shot above.
- `champion-anim.ts` and `clip-sampler.ts`: which clip of each champion plays,
  and the sampler that poses its bones; see Animation.
- `bot-driver.ts`, `match-setup.ts` and `launch.ts`: see Launch and match.
- `audio.ts`: the first-pass sound, `routeSounds` over the step's events
  after `routeEvents`, and the unlock on the first gesture; see Audio.
- Canvas data hooks: `data-tick`, `data-p0x` and `data-p0y` (the human's position
  in centimetres), `data-f0` (its facing in radians, three decimals),
  `data-projectiles`, `data-areas`, `data-hits`, `data-deaths`, `data-flashing`,
  `data-rings`, `data-bar0` to `data-bar3`, or to `data-bar5` in a 3v3 (a
  champion's fill percent, "x" for a hidden bar), `data-anim0` to `data-anim3`,
  or to `data-anim5` in a 3v3 (what a champion's clips play, see Animation),
  `data-overlay`,
  `data-debugShots`, `data-phase` (the sim's phase string: warmup, round,
  roundEnd or matchEnd), `data-round` and the readiness flags `data-rendered`
  and `data-arena`. The e2e specs read them and pace themselves by `data-tick`.
  A per-tick hook is written only when its value changes, with `setAttribute`
  and text from the tables of `hook-text.ts` (integers, signed centimetres,
  facing in milliradians, percents), `flashTexts` in `feedback.ts` and
  `ANIM_TEXTS` in `champion-anim.ts`, all made once at startup, so a change
  write builds no string. A table falls back to the formatter past its range. A
  position is two hooks and a bar is one hook per champion because a combined
  "x,y" or "a,b,c,d" text cannot come from a table.

The frame path allocates nothing in steady state: views are pooled, text comes
from tables and is written only on a change, and the numbers a frame carries
live in object fields. The two heap-probe specs measure it, see
[testing](testing.md). A match of bots is never in a steady state: hook and HUD
values change in every window. The change writes come from tables and so build
no string. The probe has two scenes: the sandbox, where a casting champion in a
stationary scene changes almost nothing, and the live match, which counts those
table writes with real changes (`live-probe.spec.ts`, issue #77). The live scene
is measured in a round after about 2100 ticks of play, because the engine needs
that long to reach its optimized tier, and with a pointer that moves before
every window, so the aim sampling and the entity drawing are counted:
`sampleAim` used to allocate about 2.5 KB per window whenever a pointer existed
(issue #87) and `EntityViews.draw` boxed the three doubles of `position.set` on
the runner (issue #89), and both now read 0 B, as do the two animation modules
but for one-off windows (1 of 135 sandbox and 2 of 135 live windows, 144 to 468
B, in `blendChannel` or `slerpFlat`; no median moved). The HUD writes its state
with `setAttribute` and not `dataset`: in the probe a `dataset` write allocated
about 100 B per window whenever a slot changed, and `setAttribute` allocated
none. The two status reads of the HUD, the silence scan in `readSlotViews` and
`readShieldView`, read the human's `statuses`, an array of objects of five
shapes that is empty at first. In the live probe they first deopted on a shape
or an array map their loads had not seen (`--trace-deopt`: "wrong map" at
`statuses.length` and `.type`) and boxed numbers in the lower tier until the
next compile, 48 to 480 B a window, so `main.ts` runs both once at startup
(`primeStatusReads`) over empty and filled lists of six shapes. The shield sum
is an `Int32Array` slot of per-shield ceilings: the function is called once per
frame, so it stays in the lower tiers for its first thousand frames, where every
double boxes, and a `Float64Array` sum read 636 to 936 B a window in a scratch
run with the shield showing (testing.md).

The colours that the world view draws are constants in these files. Champion
model colours must stay clear of them, and `tools/blender/test_champion_models.py`
copies all of them but `BAR_BACK_COLOUR`, so a change here changes that list in the
same commit.

| File | Constants |
|------|-----------|
| `health-bars.ts` | `ALLY_BAR_COLOUR`, `ENEMY_BAR_COLOUR`, `BAR_BACK_COLOUR`, with `BAR_Y`, `BAR_HEIGHT` and the border that fix where a model must end |
| `impact-rings.ts` | `RING_COLOUR`; a heal bolt's ring reuses the projectile colours below |
| `champion-look.ts` | `FLASH_COLOUR`, `DEAD_COLOUR` |
| `entity-views.ts` | `PROJECTILE_ALLY_COLOUR`, `PROJECTILE_ENEMY_COLOUR` |
| `debug-overlay.ts` | the magenta overlay `#ff00ff` |

## Animation

The six clips of a champion model (Idle, Run, Attack, Cast, Hit, Death) play
through the client's own sampler on the clip data, not through three's
`AnimationMixer`: the mixer allocated 12 to 104 KB per heap-probe window, and it
averages the clips that play where an upper-body strike must replace the arms
and leave the legs alone
([batch #105 decision 11](https://github.com/sv-tmueller/claudeline-champions/issues/105#issuecomment-6221276811)).
The mixer is the test oracle: `clip-sampler.test.ts` compares the sampler to it
with `Object.is` per component, for every clip of all five models at 60 times
per clip, with `action.time` and `update(0)`. Two counted modules, both on the
frame path rules above:

- `champion-anim.ts` is pure, with no three. One record per champion holds the
  state as small integers (the run mode, the overlay that plays, the pending
  triggers) and every double in one `Float64Array` (clip times, weights, the
  scale of Run). `updateAnims(anims, state, clock)` takes the triggers and moves
  the clips on to the drawn time `(state.tick + clock.alpha) / 60`, read from
  those fields inside the module, so no `dt` or `t` crosses a call and a pause,
  `?timescale` and the probe hook all follow it. A frame longer than 0.2 s
  counts as 0.2 s, and a clock that goes back stands still.
- `clip-sampler.ts` binds the clips of a view at load and poses its bones.
  `createClipRig` looks the six clips up by name (`AnimationClip.findByName`:
  the glb exports them alphabetically, and a missing name throws), binds each
  track to its bone's `quaternion`, or to the `position` of `Hips`, with a key
  cursor, saves each bone's rest pose before any write and turns
  `frustumCulled` off on every `SkinnedMesh`. `poseChampion(rig, anim)` samples
  the clips that play (LINEAR: the slerp is `Quaternion.slerpFlat` ported
  operation for operation, and the translation a lerp), blends them and writes
  each bone once with `fromArray(buffer, 0)`. Nothing else poses a bone, and
  `placeChampion` stays the only writer of a view's root: the sampler never
  touches it.

The transitions are tuned constants in ticks at 60 Hz:

| Trigger | What plays | Blend |
|---|---|---|
| walk speed under 0.5 m/s | Idle, 2 s, loops | 9 to and from Run |
| 0.5 m/s or more, or a dash | Run, 20 frames, loops, entered at its first passing key (frame 5) at weight 0 | in 9 |
| the walk stops | Run plays on at its last scale to its next passing key (frame 5 or 15), holds there, then fades | out 9 |
| castStarted of M1, a champion or a bot | Attack from time 0; the next M1 restarts it | in 3, out over its last 6 of 24 |
| castStarted of any other slot | Cast, 30 ticks | in 3, out over its last 6 |
| castInterrupted | the Attack or Cast fades from its weight | 6 |
| a cast while an overlay plays | the new overlay, entered from the weight the last frame showed, with Spine and both arms crossfaded from the pose last drawn | 3 |
| damage with `sourceId >= 0`, when no Attack or Cast plays and no Hit runs | Hit, 18 ticks | in 2, out over its last 6 |
| death, the ring's included | Death, held on its last frame | in 6, from the pose of the moment |
| roundStarted | Idle at time 0 | snap |

Run's time scale is `speed * 2 / 5.5`, so it is 2 at 5.5 m/s: a step covers
1.83 m of ground against 0.92 m of foot travel in the clip, and the feet would
slide at scale 1. It is at most 3 (a haste at its cap) and a dash plays at that
cap. It is negative, so Run plays backward, when the velocity opposes the
facing (for a dash, the displacement of the frame does, and a frame with no step
keeps the sign of the last one that had a direction). A dash ends with the sim's
dashEnded, and with the round's end, which freezes a dash and emits none. The
facing is the direction to the aim point, which the sim turns it to every tick,
so the sign needs no trigonometry. There are no strafe clips.

The blend has no additive part anywhere:

- The base layer crossfades Idle and Run with weights that sum to 1. A channel
  only Run keys (the legs) blends from the rest pose, as three does.
- The upper overlay (Attack, Cast or Hit) replaces the channels its clip keys,
  Spine and both arms, with `slerp(base, overlay, w)`. At w = 1 the strike
  reads fully while the legs and Hips keep Run's. A cast that replaces an
  overlay that plays goes on from the weight the last frame showed (the clip's
  last 6 ticks cut it, so a held M1 restarts in 3 ticks and not in one), and
  Spine and both arms crossfade over 3 ticks from the pose last drawn to the
  new overlay's, since its first key is the rest pose: Quillon's Cast over an
  Attack at its 8th tick turned Arm_R 77 degrees in one tick before, and now
  turns it 27.6 degrees a tick at most. That figure is that pair's: at the
  worst replacement tick Cast then Attack turns 41.0 degrees, Attack then
  Attack 39.3 and Cast then Cast 27.3, so the pin bounds every Attack and Cast
  pair at 42.
- Death goes over everything. Its five channels (Hips rotation and translation,
  Spine and both arms) blend from the pose of the moment by its weight, and the
  legs, which it does not key, blend to rest. Its time stops at the clip's end
  and never wraps, so the corpse lies on its last frame until the round starts.

The passing-key rule is why Run is entered and left where it is. The floor
holds for one clip alone at weight 1 (assets.md). A crossfade between Run and
Idle or rest breaks it when Run is blended away from a pose with turned legs:
a Run at weight 0.07 on its split key puts the feet 0.67 mm under the floor,
and 0.44 mm on the frame next to a split. So Run is entered at frame 5, whose
legs and Hips are at rest, and when the walk stops it plays on at its last scale
to its next passing key, holds there while the weight fades, and the feet stay
at or above the floor. `clip-sampler.test.ts` samples every transition (every
stop phase of Run at four speeds and both directions, every overlay at every
offset over Idle and Run, interrupts, Death from every state, a dash, the snap)
for all five models, and the lowest skinned vertex stays at or above -1e-4 m
(the lowest figure is -9e-15 m). The highest stays under 1.91 m: every
transition reaches 1.735 m on the three plain models and 1.8695 m on Lumeth,
but an overlay over Run adds the bounce of Run's Hips (up to 35 mm) to
Quillon's staff at the strike, 1.9051 m in the sweep and 1.9078 m at the worst
phase, 6 cm under the health bar at 1.97 m. Entering Run at its split, leaving
it with no hold and an additive Arm_R are the mutation rows of these pins.

`frustumCulled` is false on every skinned mesh because three computes a skinned
mesh's bounding sphere from the bind pose, once. The Death corpse lies along the
aim axis, from -1.03 to +0.81 m in x and from -0.78 to +1.31 m in z in model
space (the +1.31 m is Quillon's staff), outside that sphere, so a culled corpse
would vanish near the edge of the screen. `death.png` of `combat.spec.ts` shows
the corpse drawn.

Where it runs. The triggers ride `routeEvents`' existing pass: `CombatFeedback`
takes the animation records and its handlers write pending integers per
champion in the step loop (`cast` and `interrupt` take the sim's event record
and read the champion id and the slot only, `damage` and `death` forward their
ids, `dash` follows `dashStarted` and `dashEnded`, `roundStarted` snaps), and
`stepSim` has no line of its own for it. The handlers run cold, a few times a
window, in V8's interpreter, where every double a function loads or computes
allocates a heap number, so they store integers. The dash is an event and not a
read of `champion.dash`: that object is a load V8 has no type feedback for until
the first dash, and the first dash of a live match deoptimized the frame path
and cost 25 KB per window for four windows. `draw` runs `updateAnims` and then
`poseChampion` for each view, and writes the hooks. Run and its hold are decided
in the frame that is hot, so a stop flips two integers.
`createClipRig` also primes both modules at load: a scripted match through a
throwaway record (`scriptAnims`) poses every state once, a crossfade included,
and the bones go back to rest, so V8 has seen every branch before the first
frame, which makes such a deopt in a measured window rare, not impossible.

One rule came out of the probe for every function of these modules. V8's Maglev
gives a double that is the result of a branch merge with an integer constant
on one side (`x = cond ? 1 : w`, or a `let` assigned in an `if`) a tagged
representation, and boxes it: 12 to 16 B per call, 150 KB in a bench of 12 000
calls. So no double in the frame path of these modules is a merge of a branch
with an integer: a branch stores into the `Float64Array`, and a choice between
two values is arithmetic on a 0 or 1. The probe counts it: a regression reads
over 1 KB a window.

The hooks `data-anim0` to `data-animN` hold one of nine texts, in this order:
`Idle`, `Run`, `Idle+Attack`, `Run+Attack`, `Idle+Cast`, `Run+Cast`,
`Idle+Hit`, `Run+Hit` and `Death`. They say what each champion is heading for
(Run is shown while the walk or a dash lasts, not while Run is still playing out
a stop) and are written only on a change.

## HUD

An HTML and CSS overlay under `#hud`, built once at startup by `hud-dom.ts`.
It has eight elements, named by `data-hud` after
[rules.md](../design/rules.md) sections 6 and 8: `health-bar`, `energy-bar`,
`cooldown-icons`, `round-score`, `round-timer`, `ring-warning`, `kill-feed` and
`scoreboard`. `hud-dom.ts` builds the first seven and `scoreboard-dom.ts` the
eighth, under the same root.

- Health bar: the local champion's health as `ceil(health) / maxHealth` and a
  fill. The shield segment sits in the same track (`data-part="shield"`, with a
  `shield-fill` child). The sim has no total absorb: shields are `statuses`
  entries `{ type: 'shield', absorb }` that add, so `readShieldView` sums the
  rounded-up absorb of each into a `ShieldView`. The segment is `min(absorb,
  max)` wide and starts at `max(0, min(health, max - width))`: just past the
  health, sliding back over its end when health plus shield pass the maximum.
  At full health 40 absorb on 160 covers the last quarter. Its colour is
  `var(--hud-text)`, so no colour is new. It is hidden at 0 absorb and keeps
  its last transforms; `data-visible` and `data-absorb` say what it shows.
- Energy bar: a fill with marks at 25 (EX ready) and 100 (ultimate ready).
- Cooldown icons: seven, in `SLOTS` order and labelled M1, M2, SPACE, Q, E, R
  and F. `hud-views.ts` turns a champion into seven `SlotView`s: whole seconds
  of cooldown left, a windup flag, a blocked flag and a silenced flag. Its
  source is the sim's own fields, `Pick<ChampionState, 'energy' | 'cooldowns' |
  'cast' | 'statuses'>`, so a rename in the sim breaks the build. A slot shows
  its seconds from the cooldown (up to 99, then the number itself), the
  ultimate shows as blocked while energy is below 100, and every slot dims
  during a windup. While the champion has a
  `silence` status (an indexed scan of `statuses`) all seven slots read
  silenced and carry `data-silenced="true"`, drawn dim with an enemy-colour
  border by the last of the slot rules in `hud.css`; `data-blocked` stays the
  energy gate alone. The energy marks and the ultimate cost are the sim's
  `EX_ENERGY_COST`, `ULTIMATE_ENERGY_COST` and `MAX_ENERGY`.
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

### Scoreboard

The eighth element, `data-hud="scoreboard"` (rules.md section 6, Tab), shows
every champion with its state, kills and deaths while Tab is held.
`buildScoreboard` (`scoreboard-dom.ts`) builds it hidden (`data-visible`): a
header row (`data-row="header"`, Champion, K, D) and one row per champion, the
local team first and each team in id order. A row is `data-row=<id>` with
`data-team` (`ally` or `enemy`, coloured by the HUD's team rules) and
`data-alive`, and its cells are `data-part` `team` (Ally or Enemy), `name`,
`state` (Alive or Dead), `kills` and `deaths`. The local team is a parameter
of `buildScoreboard`, not the human's id.

The counts come from the sim's events. `CombatFeedback` keeps `killCounts`
and `deathCounts`, an `Int32Array` per champion, and `tallyChanges`, which
its `death` handler writes: a death counts for its victim, and a kill for the
source only when that is another champion of the match, so a death by the
ring (`RING_SOURCE_ID`) counts a death and no kill. They are match totals and
never reset: a page is one match, and Restart reloads it. The constructor of
`CombatFeedback` is unchanged.

`Scoreboard.update` (`scoreboard.ts`, in the heap probe's counted code) runs
once per stepping frame after `Hud.update`, and once at startup. It writes
only on a change: `data-alive` and the state text when a champion's `alive`
flipped, and the kills and deaths cells that changed while `tallyChanges`
moved (the count loop is skipped otherwise). It writes while hidden too, so
showing the board needs no catch-up, and the DOM is built with the start
values, so the first update writes nothing. `show` and `hide` write
`data-visible` once per change.

The scoreboard works in every phase, `matchEnd` included, because the final
tally is the useful one there. It draws above the result panel: its rule has
`z-index: 1`, since `#hud` has no stacking context and `#result` comes later
in the page. It takes no pointer events, so the result links under it still
click; Tab's focus movement over those links is given up while it is held.
Opening the menu hides it: the menu's `releaseInput` action also calls
`scoreboard.hide()`.

### Pre-match select

A fourth root, `#select`, follows `#menu` in `index.html`. `main.ts` gates on
`opensSelect` right after the kit ids are read and before `parseLaunch`, so
before any renderer, match, HUD or model exists. On a bare address it awaits
`runSelect` (`select-dom.ts`), which builds the panel
(`data-select="panel"`, `data-visible="true"`): a title, the select of the
result panel and the menu (`buildSelect` in `result-dom.ts`, so there is no
third copy of the rows, with the label "Play as") and a Start link
(`data-action="start"`). The first choice is `parseLaunch('', ...)`: Hargrim,
normal, arena01, 2v2. The champion row is `selectEntries`, that is the roster
ids in roster order, each available once its kit file loads; with six kit files
it still lists four.

A pick is a plain click on a row entry, handled by one listener on the panel. An
entry's href already is the next whole setup, so the click reads it back with
`parseLaunch`, rebuilds the rows from the new choice, puts the keyboard focus on
the same place of the same row and sets the Start href to `relaunch(choice)`. A
greyed entry is a span with no href, so availability comes for free. The page
address does not change on a pick. A click with a modifier key is left to the
browser and opens that setup in a new tab, straight into a match. Start calls
`preventDefault`, writes the Start href with `history.replaceState`, empties
`#select` and resolves; `main.ts` then builds the match from the address with
the one reader, and the page looks like a parameter launch: the Restart of the
menu and a reload play the same setup, and the result and menu links reload with
full addresses, which skip the screen. The cost of Start not reloading is that
Back from the match leaves the site, as `/` always did. A reload Start would
need a top-level await that never settles in `main.ts`, and moving the match out
of `main.ts` would move the heap probe's `^main\.ts:` key.

The last choice is not stored: the settings stay
`{ version: 2, bindings, muted }` and the select opens on the defaults on every
visit. A stored choice added later may only pre-fill the select, never skip it
or override the address, and needs version 3 with a migration. The online
design's lobby follows this screen (section 9), which is why it is built in the
page from the shared row builder and not as reload-only links.

`select-dom.ts`, `launch.ts` and `result-dom.ts` are outside the counted heap
code: they never run in a frame, and `select-dom.ts` never runs in either probe,
whose addresses carry a key (testing.md). `select.css` is the palette of
`result.css` with `--select-u` and `#select`, and `buildSelect` writes
`data-current` on the champion entries, which only `select.css` draws, so the
result and menu pictures do not move. `e2e/select.spec.ts` covers the screen.

### Result screen and champion select

A second root, `#result`, sits next to `#hud` in `index.html` and is built once
by `result-dom.ts`. Its panel is hidden (`data-visible="false"`) until the phase
is `matchEnd`, and `ResultScreen.update` (`result-screen.ts`), called after
`hud.update`, then shows Victory or Defeat (the local team against the team that
reached `roundsToWin`) and the final score, local first, written once. The panel
holds the select, built by `buildSelect` in `result-dom.ts`, which the menu
builds again for its own select view. The champion row has one entry per roster id
in roster order. An id with a loaded kit is a link to
`?champion=<id>&difficulty=<current>&arena=<current>&teamsize=<asked>`
(`data-available="true"`);
following it reloads the page, so the kill feed, the views and the bots start
fresh and the tick never goes back to 0 within a page. A roster champion without
a kit file is greyed (`data-available="false"`) until its file exists. The arena
row has one link per loaded arena in id order, labelled with `ArenaDef.name`, to
`?champion=<current>&difficulty=<current>&arena=<id>&teamsize=<asked>`
(`data-arena-id`), and the arena being played carries `data-current="true"`.
The team row (`data-part="team-select"`, label "Teams") has a 2v2 and a 3v3
entry (`data-team-size`, from `teamEntries`) linking to the same address with
their own size, and the size being played carries `data-current="true"`. Every
link writes `teamsize`, 2 included, so the address stays the whole setup; the
champion and arena links keep the size the address asked for, which on an arena
that cannot play 3v3 is not the size played. That arena's 3v3 entry is greyed
(`data-available="false"`, no link, as for a champion without a kit) and 2v2 is
the current one. The difficulty row follows (`data-part="difficulty-select"`,
label "Difficulty"): an Easy, a Normal and a Hard entry (`data-difficulty`, from
`difficultyEntries`, in `DIFFICULTIES` order), each linking to the whole setup
with its own tier and the champion, arena and asked size kept. The launch's
tier carries `data-current="true"`. A tier needs no file, so an entry is always
a link and has no `data-available`. The tier reaches the bots through
`createBotDriver` as before; the row only writes the address. The champion
entries carry `data-current` too, the launch's champion, for the pre-match
select (above), which builds the same rows. Only the visible panel takes
pointer events; the HUD takes none.

`e2e/match-end.spec.ts` plays the default match to this screen in a browser, on
`/?timescale=100` (see Launch and match), once per arena and team size (arena02
on `/?arena=arena02&timescale=100`, a 3v3 with `teamsize=3` in the address),
with the human idle: a 16 ms frame runs 96 ticks, so a match of 4936 to 15 773
ticks is some 52 to 165 frames at 5 frames a read, where without the scale it
would be thousands of frames. The range is the end ticks the headless matches of
`packages/client/src/match-setup.test.ts` give: 4936 for the 2v2 on arena01 (the
test's console line, no constant; its budget is 14 000) to 15 773
(`ARENA02_3V3_END_TICK`, the 3v3 on arena02), with 12 191 for the 2v2 on arena02
(`ARENA02_END_TICK`) and 5774 for the 3v3 on arena01 (`ARENA01_3V3_END_TICK`);
the dodge of the bots moved them all (5053, 4198, 5349 and 11 095 before). It
reads the panel hidden until `data-phase` is `matchEnd`, then the title, the
score (equal to the HUD's), the select, takes `result.png` and follows the
Quillon link, which keeps the arena and the team size (a 3v3 has `data-bar5`
after the reload). The headless integration tests (`match-setup.test.ts`: one
round to win and three on arena01, three on arena02, and a 3v3 on each) give the
tick budget of each row, and the result screen's unit tests the Victory and
Defeat cases that the idle human cannot reach.

`Hud.update` runs once per stepping frame, after all of that frame's sim steps,
and `Scoreboard.update` right after it.
It compares integers and booleans held in cache fields with the new values and
writes the DOM only when one changed, so a steady frame writes and allocates
nothing. The texts come from tables made in the constructor: the health text and
fill per whole health up to the local champion's maximum, the energy fill per
whole energy, the shield's start (`translateX`) per whole health, and the score
per pair up to the rounds to win (`scoreTexts` in `hud-views.ts`, shared with
the result screen). The shield's width is the health fill's text for that
width. A value past a table builds its text, so nothing is wrong outside the
range, only slower. The kill feed counts
its pushes and expiries, and the HUD skips its line loop while that count has
not moved. The e2e specs read the states from data attributes: `data-ready`,
`data-windup`, `data-blocked` and `data-silenced` on a slot, `data-ready` on an
energy mark, `data-visible` and `data-absorb` on the shield segment,
`data-visible` on a kill-feed line, `data-team` on its names, `data-sudden` on
the timer, and on the scoreboard `data-visible`, and `data-alive` and
`data-team` on a row.

`hud.css` sizes everything from one viewport unit, `--hud-u`
(`min(1vw, 1.78vh)`), so the HUD scales with the window, and sets
`pointer-events: none` on everything, so a right click reaches the canvas.
`result.css` follows the same rules with `--result-u` and `#result`, and one
difference: the visible panel takes pointer events. So do `menu.css`, with
`--menu-u` and `#menu`, and `select.css`, with `--select-u` and `#select`. The
colours are hex custom properties on `#hud`. Panels are neutral black with alpha
and every foreground element sits on one, with one exception: the ring warning's
red edge, an inset shadow in `var(--hud-enemy)` along the viewport that shows
while the local champion is outside the ring (rules.md section 8 asks for an
edge, which cannot sit on a panel). The warning's text is on a panel. Text is
off-white, below 250 in every channel. Allies and enemies use the health-bar
colours. No colour is blue, purple or magenta, none falls in the pixel boxes the
e2e specs count (white, the yellow ring, the magenta overlay) and none is within
80 of a champion body colour. `hud-palette.test.ts` checks all of this over the
four style sheets.

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
  input is released on open and on close, and the scoreboard is hidden on
  open. Pausing this way keeps `frame`, `stepSim`, `draw` and the hook writers
  as they are: nothing in the menu runs per frame, and
  its DOM is written only on events. The heap probes never open it.
- **Resume** is Escape again or the button. **Restart** is `location.reload()`: the
  address is the setup (champion, difficulty, arena, team size and the dev time
  scale), and the tick still never goes back to 0 within a page. **Back to
  select** (the button reads "Champion, arena, teams and difficulty") shows the
  menu's own select view, the champion, arena, team and difficulty links of the
  result panel built by `buildSelect`, with the match still paused; a pick
  follows a link and reloads.
- **Views.** The panel carries `data-visible` and `data-view` (`main`, `select` or
  `keys`), the sections are `data-section`, and the buttons carry `data-action`
  (`resume`, `restart`, `select`, `keys`, `mute`, `back`, `reset`). The panel
  always opens on the main view.
- **Sound.** The main view has a button, `data-action="mute"`, whose
  `data-muted` and text ("Sound: on" or "Sound: off") the `Menu` constructor
  writes from the stored mute, since the DOM is built before the settings load.
  `toggleMute()` works only while the menu is open: it flips the mute, calls
  `platform.sound.setMuted`, rewrites the button and saves once, with the
  current bindings. Every save carries both `bindings` and `muted`, so a rebind
  after a mute keeps it.
- **Keys view.** One row per action (`data-binding=<action>`, `data-part="key"`
  and a `data-rebind` button) built at startup and written only when its text
  changes. A click on a rebind button waits for the next key (`data-capturing` on
  the keys section and the row): a key that applies is saved once, Escape cancels
  the capture and leaves the menu open, and a duplicate or reserved key sets
  `data-error` and changes and saves nothing. Reset restores the defaults and
  saves them.
- **Pointer.** The menu reads no pointer position and calls no
  `getBoundingClientRect`. The window `mousemove` listener of the input core
  keeps setting `input.pointer`, so after a menu click `main.ts:sampleAim`
  samples it exactly as it does for any mouse, and allocates nothing (issue
  #87).

The menu pauses in local matches only. Online play never pauses: Escape opens
the menu over the running match, and the menu offers Leave in place of Restart
([batch #134 decision 1](https://github.com/sv-tmueller/claudeline-champions/issues/134#issuecomment-6232034441), designed in the
[online design](../superpowers/specs/2026-10-17-online-design.md#9-client-rendering);
not built yet).

## Platform interface

Steam readiness: `Platform { identity(), loadSettings(), saveSettings(),
unlockAchievement(id), openUrl(url), sound }`. `BrowserPlatform` is the only
implementation until milestone 8.

Only the two settings methods and `sound` are built, in `platform.ts`;
`identity`, `unlockAchievement` and `openUrl` join with their first user. The
settings methods return Promises, so an Electron renderer reaches files over IPC
with no change of signature. `sound` is a sub-object, `SoundOutput` (see Audio),
so a desktop build can swap it; it is an amendment under spec section 5, and
`createBrowserPlatform(storage, makeContext = browserAudioContext)` builds the
browser one. `Settings` is `{ version: 2, bindings, muted }`.
`createBrowserPlatform` takes an injected `getItem`/`setItem` pair (`main.ts`
passes `window.localStorage` from inside a try, since reading it can throw) and
keeps one JSON text under the key `claudeline-champions.settings`. The store is
written only on a rebind, a reset or a mute toggle, and `main.ts` awaits
`loadSettings` and applies the bindings and the mute before it binds the input.
`readSettings` reads the defaults, whole (`muted: false`), when the stored text
is unusable, since a per-field merge could create a duplicate: no text, bad
JSON, a version other than the numbers 1 and 2, a version 2 text whose `muted`
is not a boolean (`"true"` and `1` are refused), a missing action, or a code
that is not a string, is reserved or is shared. A version 1 text, which has
bindings only, migrates: its bindings stay and `muted` is false. Loading never
writes, so a version 1 store becomes version 2 on its first change. A throwing
`getItem` reads the defaults, and a throwing `setItem` resolves after a
`console.warn`, because a console error fails every e2e.

## Audio

The first-pass sound is generated in code, with Web Audio oscillators and no
sound files, so there is no license question. It lives in `audio.ts`, behind the
`SoundOutput { unlock(), setMuted(on), play(sound) }` of `Platform.sound`.
What plays (tuned values, rules.md section 6; no music, and nothing on
`matchEnded`, which follows the last `roundEnded`):

| Event | Sound (`SOUNDS`) | Voice, decay |
|-------|------------------|--------------|
| `projectileHit`, and a `meleeArc` with at least one target | hit, 0 | square 220 Hz, 30 ms |
| `castStarted` of the local champion only | cast, 1 | triangle 520 Hz, 50 ms |
| every `death` | death, 2 | sawtooth 110 Hz, 120 ms |
| `roundStarted` | round start, 3 | sine 660 Hz, 80 ms |
| `roundEnded` | round end, 4 | sine 330 Hz, 140 ms |

The cast is the local champion's only, which keeps a 3v3 from turning into
noise. The master gain is 0.2 and a voice peaks at 0.6.

- **The second event pass.** `routeSounds(state, sound, localId)` is an indexed
  loop over `state.events` with a switch, called by `stepSim` right after
  `routeEvents`, in the step loop, so it sees the same events in the same step.
  `feedback.ts` is not touched. Unlocking and muting are checked inside `play`.
- **No allocation per play.** `unlock()` builds one persistent voice per sound,
  an oscillator into an envelope gain into a master gain into the destination,
  and starts each oscillator once. A `play` is then `cancelScheduledValues(0)`,
  a set to the peak and a `setTargetAtTime(0, 0, decay)` on that voice's gain.
  It creates no node and reads no `currentTime` (a time of 0 is now), and every
  argument is a literal or a module constant, since a computed double or a
  double field crossing a call that V8 does not inline is boxed (the rule of
  the aim sampling above). `SOUNDS` are small integers for the same reason.
- **The unlock.** A context made at load would start suspended, and Chrome
  refuses to resume it without a gesture, so nothing is built until one.
  `bindSoundUnlock(window, sound)` listens for `keydown` and `pointerdown`;
  each calls `unlock()`, which makes the context on first use and resumes it
  while it is suspended, and the listeners go once the context is running.
  Chrome does not count Escape as a gesture, so a first Escape press alone
  leaves it suspended and the next key or click unlocks it.
- **Failures are warnings.** The factory is lazy (`browserAudioContext` reads
  `globalThis.AudioContext` at the first unlock, never at load). A factory or a
  node that throws becomes one `console.warn` and the sound stays off, and a
  rejected `resume()` is caught: a console error fails every e2e, and a browser
  with no audio device must still play.
- **The probe counts it.** `audio.ts` is frame-path code and is in the heap
  probe's `COMBAT_CODE` (see [testing](testing.md)), so the limits of 600 B
  and 780 B apply to it. Both probe specs unlock the audio with a real
  gesture before their measured windows (`live-probe.spec.ts` presses the
  mouse, and the sandbox spec's F4 presses are key gestures), so the counted
  `play` calls reach real Web Audio nodes. The nodes are native, so a
  `createGain` per play stays off the JS heap and the probe does not see it;
  the unit test of `audio.test.ts` (a fake context that counts nodes) is that
  mutation's gate.
- **The e2e fake.** `menu.spec.ts` replaces `window.AudioContext` with a
  counting fake through `page.addInitScript`: a play is one
  `cancelScheduledValues` on a voice, in `SOUNDS` order, and its `currentTime`
  throws. The fake lives in the spec, so a build contains no `__fakeAudio`;
  `grep -r __fakeAudio packages/client/dist` must print nothing, next to the
  dist grep above.

## Steam readiness rules

- Game code only talks to the `Platform` interface.
- Assets load relative to the app base path, never from absolute URLs.
- Rendering scales from a browser tab to a fullscreen 4K desktop window:
  resolution-independent camera framing, device-pixel-ratio aware canvas.
