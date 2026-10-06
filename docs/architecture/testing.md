# Testing and quality gates

Source: spec section 9.

## Check suite

`npm run check` runs lint, typecheck, unit tests, the asset checks
(`assets:validate` and `assets:test`) and the Playwright e2e specs
(`e2e/*.spec.ts`). It is the check suite every package must pass.

CI is split by cost:

- Typecheck, lint, unit tests and the asset checks run on pull requests that
  touch code, drafts included, and on pushes to main.
- Build and the Playwright e2e specs (`e2e/*.spec.ts`) run on pull requests
  that are ready for review and on pushes to main. They skip draft pull
  requests. They start only after the typecheck, lint, unit test and asset
  check job passes.
- Changes that touch only `docs/` or Markdown files do not trigger CI.

## Test types

- Unit tests (Vitest): sim math, collision, statuses, abilities, match flow,
  replay fixtures with checksums. See [simulation](simulation.md).
- Integration tests: bot-versus-bot headless matches. See [bots](bots.md).
- E2e tests (Playwright, `e2e/*.spec.ts`): the client loads, renders the arena
  and responds to input; each spec writes its screenshots to the test output
  for human review (the live probe spec has no picture).
- Asset validation: `validate_glb.py` over `assets/models/`. See
  [assets](assets.md).
- Strict TypeScript, ESLint with the dependency-boundary rule. See
  [packages](packages.md).

## Playwright e2e

The specs are in `e2e/*.spec.ts`. They run against the Vite dev server on
port 5173, which Playwright starts itself.

- `arena.spec.ts`: the arena and the F3 overlay render (`arena.png`,
  `arena-overlay.png`), and `data-arena` is set only after the first draw.
- `scene.spec.ts`: the default match's HUD (`scene.png`): health, the round timer
  against the tick, the hidden result panel and its champion select, and the
  launch address `?champion=quillon`.
- `walk.spec.ts`: input and the camera (`walk.png`), on the dev-only sandbox
  scene `/?scene=sandbox`, after the round phase begins. The sandbox has one bot
  that never comes near, so the exact-position assertions do not depend on bots.
- `combat.spec.ts`: the F4 debug shot, flashes, rings and kills (`combat.png`),
  and the heap probe below, on the sandbox.
- `live-probe.spec.ts`: the heap probe's second scene, the default match at time
  scale 1, no picture (see the heap probe below).
- `match.spec.ts`: the first round of the default match against bots
  (`match.png`): input, a projectile and a hit within tick budgets, the timer and
  the hidden result panel. It asserts budgets only, never an exact tick, since bot
  output differs between platforms.
- `match-end.spec.ts`: two tests on the dev-only time scale `?timescale=100`
  (client.md, Launch and match), on a paused clock in frames of 16 ms that run 96
  ticks each, read every 5 frames at 320x180. One plays the default match with an
  idle human to its result screen (`result.png`), within 15 000 ticks and 182 frames (`ceil(15000 / 96) + 25`; the match ends at tick 5184 in the e2e and 5117 in a headless run through the client's setup and driver, on 8d80073), and follows the Quillon link. The other plays the sandbox to
  the red edge: the ring warning hidden until 600 ticks before the ring, the
  countdown, the radius text equal to the sim's within 0.1 m and falling, and the
  red edge (`ring.png`, counted as red pixels against a picture without the edge).
  Both assert budgets and tick relations from the rules, and the frame budget
  makes a page without the scale fail at once, however fast the machine is.

- Run them with `CI=1`. Without it Playwright reuses whatever listens on 5173,
  which can be a sibling session's dev server serving other code. With `CI=1`
  it always starts its own, and fails with "already used" when something holds
  the port. `npm run check` does not set it (its last step is `npm run e2e`,
  which is plain `playwright test`), so run `CI=1 npm run check`. CI sets it
  itself.
- Check the port before every e2e command, for example
  `lsof -nP -iTCP:5173 -sTCP:LISTEN`, which must print nothing. When a parallel
  session takes the port, wait until it is free and run again. That failure says
  nothing about the code.
- Assertions are tick-based only. A spec paces itself by the canvas hook
  `data-tick` and by the other hooks and HUD attributes, and never by a
  wall-clock wait, so a slow machine cannot change what it sees. The combat
  spec installs a paused Playwright clock and runs it frame by frame.
- Global retries are 0 in `playwright.config.ts`. A flaky spec is a bug.
- No spec has retries. `combat.spec.ts` had two, because 1 runner attempt in 6
  on 791b232 (job 111860976393) failed the probe with a first-window spike of
  3636 B in `main.ts:writeCombatHooks`. The spike isolation of #77 (run
  37434090996 on 623b031: jobs 112172123856, 112172123943, 112172123885 and
  112172123841, six attempts per scene per job, 24 per scene, the limit at 1 B
  with `expect.soft`, no retries) found the sandbox's spikes in 5 of 24
  attempts, each in one window: `writeCombatHooks` 1780 and 1712 B,
  `hud.ts:updateRing` 1440 B, `loop.ts:advance` 864 B and `entity-views.ts:find`
  864 B. Each is a one-off (one window of the attempt, in a function that reads
  0 B in its other windows) in a window where nothing was written (the sandbox's
  state does not change), so they are JIT finalization, and no settle window
  removes them. Both scenes therefore assert the median of five measured windows
  and the retries are gone (decision 12 on #63): one spiked window does not move
  the median, and a per-call or per-tick regression raises all five. A local run
  of six attempts with `--js-flags=--trace-opt --trace-deopt` shows each of
  `writeCombatHooks`, `writeHooks`, `advance`, `updateRound` and `frameMany`
  marked "hot and stable" and compiled by Maglev once per attempt, with no
  deopt, so a tier-up happens during an attempt (those six attempts read no
  spike: the tracing slows the page). The live scene's spikes are one-offs too,
  but fall in windows with events (see the heap probe).

### The heap probe

Two specs count the allocations of the per-frame code over windows of frames,
with the sampling heap profiler and garbage included, so a plain heap delta is
not needed: `combat.spec.ts` on the dev-only sandbox and `live-probe.spec.ts` on
the default match. They share `e2e/heap-probe.ts`, which is not a spec (like
`support.ts`) and holds the counted-code pattern, the limits, `summarise`, the
window runner, `openProbe`, `measureWindows`, `probeLine` and the one function
that picks the asserted figure. Each spec keeps its scene, its driving and its
end assertions. `tests/heap-probe.test.ts` pins the pure part.

- The sandbox scene is `/?scene=sandbox`: Hargrim and Quillon against Lumeth and
  Skerrow with match flow and exactly the Hargrim and Quillon kits, where only
  champion 3 (Skerrow, no kit, so it deals no damage) is a bot. The spec runs
  the 180 warmup ticks at 320x180, switches to 1280x720 for steps 2 to 7, and
  goes back to 320x180 for step 8, because on the runner a frame renders in 105
  to 210 ms at 1280x720 and the probe never looks at pixels. It is in a steady
  state: eight shots in flight and nothing to hit, with M1 held from the first
  warm-up volley to the end of the measured windows. M1 is Hargrim's arc, a
  36-tick cooldown with a reach of 3 m and nothing in reach, so the windows
  cover `startCast`, the windup, `castFired`, the arc, the cast record dropped,
  the HUD's cooldown and windup writes, the round phase and a live bot through
  the glue. The engine warms up on 4 volleys and 5 windows of 30 frames are
  measured right after the fifth volley, with no settle window: 150 ticks,
  before the first shot ends at 162. The end assertions prove the casting ran
  (the M1 icon is on cooldown) and that nothing else happened (the round, one
  death, the bot at 100, no flash).
- The live scene is the default match, `/` at time scale 1, where the hooks and
  the HUD change in every window (the human's `data-p0x` and `data-f0` on every
  tick, projectiles, hits and bars as the bots fight). It is the scene that
  counts the table-driven change writes with real changes. The clock is paused
  before the page loads and never runs a frame, so the first read is tick 0 and
  every tick is the hook's. The warm-up is plain windows with no profiler from
  tick 0 to the first round that begins after tick 2100 (round 3, begun by tick
  2879 on 8d80073 on every run so far: the bots are deterministic), then 5 plain
  windows of the round (the lead, 150 ticks), then the next 5 windows are
  measured, ticks 3029 to 3179 on 8d80073. The lead is derived from a 17-window
  run of round 3 on 8d80073: the first projectile spawns in window 5 (ticks 3029
  to 3059), the first hit lands in window 6, and then 1 to 4 projectiles are
  live and 1 to 3 hits land per window to the end of the run (tick 3389), with
  the first death of the round read at tick 3509. The human walks W and D in the
  first window, then A and D in turn at y of about 3.9 m, west of the block at x
  = -8, with M1 held; Hargrim's M1 windup is `slowed`, so the walk goes on under
  the cast. The end assertions: phase round, the same round and the same death
  count at every read, the human's bar not "x", a projectile in flight at some
  read and a hit landed between the first read and the last (the counts per
  window are in the log), 29 to 31 ticks per window, `p0x` and `f0` different
  across every window, |sin f0| over 0.5 at every read, M1 on cooldown in at
  least one read, then the sanity floor and the limit. After them the windows
  run on to the first death of the round, which must come at least 60 ticks
  after the last measured window (it came 330 ticks after, at tick 3509, on
  every run). Logged, not asserted: per window, the projectiles, hits and bars
  that changed.
- Why the live scene is measured in round 3 and without a pointer. A live match
  gives the engine no time before its first death (tick 449 on the normal bots
  of f7e10f0, 719 on easy): from tick 0 the counted code read 16 to 81 KB per
  window, and 3 to 6 KB at ticks 570 to 720 (the heap numbers of code that has
  not reached the optimizing tier: `draw`, `loop.ts:advance`,
  `health-bars.ts:update`, `writeHooks`). It reads clean only after about 2100
  ticks, which rounds 1 and 2 supply. The pointer is never moved because
  `main.ts:sampleAim` allocates about 2.5 KB per window in every window whenever
  a pointer exists (about 85 B per frame, in the sampler's own call and the
  callees V8 inlines into it; the sandbox never sees it since it never moves the
  pointer). That is issue #87, for a client package. Without a pointer the aim
  stays at (-11, 2) m, so the walk leaves the line y = 2 to make the facing
  change. Open question, not resolved here: with the profiler on in every
  window, `writeHooks` read clean from tick 800 in one run, where the plain
  warm-up needs about 2100; the profiler may change when the engine tiers up,
  and the spec keeps the warm-up profiler-off.
- A window is one `page.evaluate` call of the client's dev-only hook,
  `window.__runProbeFrames(30)`, which runs `frameMany` in `main.ts`: 30 calls
  of `frame` with timestamps one tick apart (one sim tick each), with no
  `requestAnimationFrame` and no three animation loop. The sandbox's steps 2 to
  7 keep the paused Playwright clock and their tick-exact reads. Once the hook
  has run, the fake clock must never run a frame again: the hook's timestamps
  are ahead of it, and the loop clock returns no step for a timestamp behind its
  last. The F4 volleys between sandbox windows go through the keyboard: a key
  press is dispatched in the page before its call returns, and `fireVolley`
  reads `debugShots` back and checks that all 8 fired, so every shot is in the
  state before the next window. The live scene's keys go the same way between
  windows. The hook is behind `import.meta.env.DEV`, like F4; see the dist grep
  in [client](client.md).
- The counted code is the `COMBAT_CODE` pattern: the combat render modules, the
  pose and overlay helpers, the loop clock, the input sampler, the HUD writer
  and its views, the kill feed, the champion names, the result screen's writer
  (`result-screen.ts`), the text tables of the hooks and the HUD
  (`hook-text.ts`), the client's bot-driving glue (`bot-driver.ts`) and
  everything in `main.ts`, including the hook's `frameMany`. Three's
  `onAnimationFrame` is logged and not counted: no frame of a measured window
  runs through it. A new module on the frame path goes into the pattern. The
  live scene leaves one function out of its count, `entity-views.ts:draw` (see
  the limits). The bots package is not counted, and its bytes are logged as the
  sixth figure of the probe line. A live match leaves the bots' steady state in
  any window by design (a new plan, a fresh path follower after an intent
  change, the aim point boxed every 15 thinks), and bot output differs between
  platforms, so counting it would tie the browser limit to decisions the runner
  makes differently; the think has its own gate, the 128 B bound of
  `allocation.test.ts`. The bytes in a browser window were: 2.4 to 2.8 KB per
  window in the sandbox, 117 to 700 KB per window in the live scene's measured
  windows on the runner (in `bot.ts:aim`, `path.ts:searchCells`,
  `follow.ts:splitPath`, `sight.ts` and `casting.ts:updateRuns`), and megabytes
  in the first windows after a round starts (the plan of each bot). That is a
  carry for the bots package, not an assertion. `summarise` gives the bots'
  files the prefix `bots/`, as it gives the sim's `sim/`, so a bots file such as
  `bot.ts` never matches a client entry. Bytes of an inlined callee land on its
  caller: V8 inlines `frame` and its callees into `frameMany`, so their bytes
  show on it, and bots bytes inlined into the glue show in `bot-driver.ts` or
  `stepSim`.
- A blind mode, seen locally only. In some local attempts every counted function
  read 0 B, `frameMany` included (which otherwise reads 252 to 588 B per window,
  one boxed number per frame), and a mutation read no mutation-sized figure: 13
  and 15 attempts of the first two 35-attempt runs read 0 B, and in mutation
  runs two lines read 216 to 276 B (a blind `frame` array and a blind
  `BotDriver.think` array; the same lines read 1664 to 1764 B and 1448 to 1552 B
  when rerun), with the machine busy throughout. It came back on 8d80073 in a
  35-repeat run in a single browser process, from the sixth attempt on, and not
  in batches of 3 repeats (13 live and 10 sandbox attempts, and 15 live attempts
  in 5 batches, had none). So the practice is batches of 3 repeats per
  invocation, and the criterion for calling an attempt non-blind is that every
  one of its windows has counted bytes (a window with 0 B counted, or a mutation
  run whose medians sit at the `frameMany` figure, is blind): the 15 live
  attempts of the current shape all read at least 276 B in every window. The
  local figures below rest on such attempts only (the lowest median was 492 B
  live and 324 B in the sandbox). No runner attempt was blind (48 of 48 of the
  isolation read at least 228 B in the counted code), but 216 to 276 B, the
  figure of a blind mutation run, is above that, so a floor on the bytes does
  not separate blind from clean: a green local run proves nothing alone, a
  mutation check needs every attempt red and the mutated function in the log,
  and a clean read near 0 B is not a measurement of the code.
- The asserted figure is the median of the five measured windows, in both
  scenes, and a window's figure is its counted bytes (see the retries bullet
  above for why). Window 0 of the sandbox holds the first-frame acquire of the
  volley's eight views and reads 636 to 1068 B counted in every attempt (59
  attempts: the 24 runner lines of the isolation and 35 local; the acquire is
  336 to 660 B of it), which the median ignores; the live scene's windows hold
  the round's first projectiles, the first hit and the rings: the event paths
  (`entity-views.ts:acquire`, `feedback.ts:routeEvents`,
  `impact-rings.ts:spawn`) cost 24 to 330 B in a window, with one-off spikes of
  1.3 to 5 KB in `hud.ts`, `impact-rings.ts`, `main.ts` and `champion-look.ts`,
  each in one window.
- The limits are literals in `e2e/heap-probe.ts`, one per scene, with their
  figures in the comment beside them. Sandbox: 640 B. In a steady state every
  counted function reads 0 B except `frameMany`, which reads 300 to 588 B (9 to
  18 B per frame, one boxed number per frame at the call into `frame`, which
  stays whatever the shape of the hook: the timestamp as an argument, as an
  integer, in a field of the loop clock, and with no argument at all, where no
  number crosses the call) and carries the bytes of whatever V8 inlines into it.
  The median of five was at most 528 B over 35 local attempts at limit 1 B (all
  non-blind) and 504 B over the 24 runner attempts of the isolation, so 640 B
  stays, about 100 B above the largest clean median and below every mutation
  below. The worst window is not a stable figure: it read up to 1068 B clean and
  1224 to 2140 B with a spike. Live: 750 B, its own literal, because the event
  windows raise the base: on 8d80073 (the bots of #86) the median of five was at
  most 684 B over 21 local attempts (15 at limit 1 B in 5 batches of 3 repeats,
  3 in the check run, 3 of the light tester's, which read 612, 468 and 612 B;
  none blind; a worst window of 924 B clean, and 3 spikes in 105 windows:
  `main.ts:writeCombatHooks` 1944 B and 4148 B, `hud.ts:updateRound` 1944 B),
  which is above the sandbox's 640 B. The measured windows of the earlier shape
  (the first 5 windows of round 3, no events, on f7e10f0) read at most 504 B
  over 35 local attempts and 540 B over the 24 runner attempts of the isolation;
  the runner jobs of the new shape (7b80afd, jobs 112201476995, 112203346352 and
  112205063119) read medians of 588 B, 540 B and 660 B, with `draw` at 0 B in
  the first and third and 228 to 1116 B in the second, 1.0 to 1.1 min per live
  attempt, and the same projectiles and hits per window as locally (0>1 and 0,
  1>1 and 2, 1>4 and 0, 4>2 and 3, 2>2 and 2). One function is left out of the
  live count, `entity-views.ts:draw`: the runner read two modes of it,
  allocating 228 to 912 B in every window (and 1.1 to 1.5 KB in the window of
  the first hit) in 19 of 24 attempts and 0 B in the other 5, so the median of
  five with it counted was 336 to 504 B in 6 attempts and 864 to 1176 B in the
  18 others, which overlaps the smaller live mutations and no limit could
  separate. It is probably a cold path of `draw` (few active views, so the
  engine reaches optimized code for the active-slot branch late; the sandbox's 8
  shots keep it hot and read 0 B there), so the live scene logs its bytes apart
  (`LIVE_EXCLUDED` in `heap-probe.ts`, the `excluded` figures of the per-window
  lines) and does not count them. The sandbox counts `draw`, and the mutation of
  `draw` below fails there. The mode itself is a client defect,
  https://github.com/sv-tmueller/claudeline-champions/issues/89, whose fix
  removes `LIVE_EXCLUDED` (the carve-out ends there). The live limit is about 66
  B above the largest clean local median (684 B) and 90 B above the runner's
  (660 B) and below the median of every mutation the live scene gates: the
  per-change `data-p0x` write (948 to 1028 B, 198 B over the limit) is the
  smallest. Two mutations are gated by the sandbox and not by this limit: `draw`
  (528 to 588 B live, the excluded function) and the `ResultScreen.update`
  template (704 to 896 B live over 12 attempts, 704 B once passing under 750 B,
  so it sits at the limit; 968 to 1040 B against 640 B on the sandbox). A runner
  live median above 750 B reopens the limit under the limit rule (about 100 B
  above the largest clean median, below the smallest live-gated mutation; if
  none fits, stop and report). Both limits were read on a copy of the spec with
  the limit at 1 B and `expect.soft`; to read the per-function figures, read the
  "combat code allocated" line of a failure message, or the per-window lines
  `heap probe <scene> attempt N window W: counted ...` that every attempt logs.
  Excluding `frameMany` from the pattern is not an option: with it excluded, the
  escaping array in `frame` and the `ResultScreen.update` template passed,
  because V8 inlines their code into `frameMany`.
- The sanity floor: the lowest window outside the sim's three sweep files
  (`projectile.ts`, `geometry.ts` and `area.ts`, whose garbage was about 790 KB
  per window until #62 and is 5.7 to 18 KB now, total minus outside the sweep
  files in 9 windows of a local run on 66f4828) must exceed 80 KB, about a third
  of the lowest figure measured with the hook on a head that contains #62,
  264,652 B. The floor only proves that the profiler sees garbage.
- The mutation rule: a change to the probe, its pattern or the frame path is
  checked by applying each of these alone, on each scene, and seeing the spec
  fail on every attempt (all three, with no retries): an escaping array in
  `frame`, a template string written to `data-p0x` on every `writeHooks` call, a
  closure in `routeEvents`, an escaping `{x, y}` in the entity views' `draw`,
  the old `toPlayerInput` literal, a template string built on every `Hud.update`
  call, an escaping array built on every `BotDriver.think` call and a template
  string built on every `ResultScreen.update` call. Each line keeps its object
  reachable through `globalThis` (the compiler removes an unused one: the lesson
  of #72). The median of five, as bytes per attempt over 3 attempts, plus the
  line (the sandbox column on 458f458, the live column on 8d80073, which has the
  bots of #86, with the measured windows after the lead). Two mutations are
  gated by the sandbox and not by the live limit: `draw`, since the live scene
  does not count `entity-views.ts:draw` (528 to 588 B there), and the
  `ResultScreen.update` template (704 to 896 B there over 12 attempts, at the
  limit). The limit is 640 B on the sandbox and 750 B on the live scene:

  | Mutation | Function and place | The line as applied | Sandbox, B | Live, B |
  |---|---|---|---|---|
  | array in `frame` | `main.ts:frame`, after `const steps = clock.advance(now);` | `(globalThis as unknown as { __j?: unknown }).__j = [steps, now];` | 1600 to 1648 | 1664 to 1764 |
  | template to `data-p0x` per call | `main.ts:writeHooks`, after `const x = Math.round(champion.x * 100);` | `` canvas.setAttribute('data-p0x', `${x},${Math.round(champion.y * 100)}`); `` | 3052 to 3128 | 2516 to 2600 |
  | closure in `routeEvents` | `feedback.ts:routeEvents`, first line | `(globalThis as unknown as { __f?: unknown }).__f = () => state.tick;` | 1956 to 2064 | 1736 to 1996 |
  | object in `draw` | `entity-views.ts:draw`, after `const y = this.options.y;` | `(globalThis as unknown as { __o?: unknown }).__o = { x: alpha, y };` | 3052 to 3180 | 528 to 588 (passes: the excluded function) |
  | `toPlayerInput` literal | `input.ts:toPlayerInput`, replacing `return out;` | `return { moveX: out.moveX, moveY: out.moveY, aimX, aimY, buttons };` | 2064 to 2168 | 2216 to 2260 |
  | template per `Hud.update` | `hud.ts:update`, first line | `` (globalThis as unknown as { __t?: unknown }).__t = `t${state.tick}`; `` | 784 to 1572 | 1412 to 1480 |
  | array per `BotDriver.think` | `bot-driver.ts:think`, first line | `(globalThis as unknown as { __b?: unknown }).__b = [state.tick, inputs.length];` | 1408 to 1448 | 1448 to 1552 |
  | template per `ResultScreen.update` | `result-screen.ts:update`, first line | `` (globalThis as unknown as { __r?: unknown }).__r = `r${state.match?.round}`; `` | 968 to 1040 | 704 to 896 (sandbox-gated: at the live limit, 704 B passed once) |

  A mutation in the bots' think or the HUD lands on the caller V8 inlines it
  into (`stepSim`, `frameMany`), so read the function names of the failure
  message with that in mind.
- The per-change writes, live scene only. The sandbox never changes the position
  or the facing in a window, so only the live scene can see them. Applied alone,
  inside the existing guards: `main.ts:188` as `canvas.setAttribute('data-p0x',
  x.toFixed(0));` and `main.ts:198` as `canvas.setAttribute('data-f0', (facing /
  1000).toFixed(3));`. Not a bare `${x}`: V8's number-to-string cache returns a
  cached string for an integer it has seen, and the walk revisits the same
  centimetres every second window, so that form could read 0 B. Run once per
  scene, 3 attempts each: both pass on the sandbox (medians 336 to 408 B and 360
  to 432 B, under 640 B), which is the gap, and both fail on the live scene,
  every attempt (948 to 1028 B and 1220 to 1276 B on 8d80073 with the measured
  windows after the lead; 688 to 816 B and 948 to 1004 B with the windows before
  it). The per-event writes (the flash, the bars, the counts) are not mutated:
  they are on review only.
- Each attempt logs one line, `heap probe <scene> attempt N: bytes per window,
  total/onAnimationFrame/fake requestAnimationFrame/outside the sweep
  files/counted code/bots/excluded`, with the seven figures of each measured
  window (the last is the live scene's `draw` bytes, 0 for the sandbox; N is the
  repeat index, 0 without `--repeat-each`), and for every window with counted or
  excluded bytes a line with its functions, counted, excluded and bots, so every
  runner log names the function of any spike, whether the attempt passed or
  failed. The fake `requestAnimationFrame` figure reads 0 B now (no window runs
  a frame through the fake clock); a nonzero one means one did.
- The HUD writes state with `setAttribute`, not `dataset`. With `dataset`, the
  casting windows read 96 to 128 B in `hud.ts:updateSlots` in 5 of 5 attempts at
  limit 1 when it was first measured, and 3 of 10 attempts on a rerun (128, 80
  and 32 B in the worst window, 0 B in the other 7). `setAttribute` read 0 B in
  every attempt of every clean run.
- The history, which is why the windows use a hook: with the windows on the fake
  clock, `onAnimationFrame` had two modes. Playwright's fake clock hands out ids
  of 1e12 and up, so each `requestAnimationFrame` call boxes about three heap
  numbers (36 B per frame). In the clean mode (0 to 72 B in `onAnimationFrame`)
  the fake clock's own function holds them (about 1075 B per window); in the bad
  mode (about 1100 B per window) Maglev inlines it into `onAnimationFrame`. The
  runner entered the bad mode in every attempt once the sandbox had kits, match
  flow and a driven bot (run 37335049730, batch #53 decisions 5 and 13), so
  retries could not cover it. Turning Maglev's inlining off removed the mode but
  made the counted functions allocate 6.6 to 7 KB per window (boxed doubles at
  the call boundaries that no longer inline), so the flag was dropped. Loop
  fields as doubles from creation, `draw` reading the clock itself, a timestamp
  as an integer and a hook that passes no timestamp changed nothing in the mode
  or in the hook's 9 to 18 B per frame.

## Cross-platform determinism

The sim gives the same bits on every platform (spec section 4.8, rule 4).

- Every port in `packages/sim/src/dmath.ts` has a committed bit-pattern fixture
  over 2000 seeded inputs. The fixtures are authored on ARM macOS and checked
  by CI on Linux x86.
- Fixture inputs use exact operations only, so every CPU builds the same inputs.
- V8's transcendental functions may appear in sim tests as accuracy
  references within an ulp tolerance. They are never the source of an exact
  expected value.
- A change that moves a dmath fixture or a replay checksum is also run in a
  `linux/amd64` container before its pull request goes ready.
