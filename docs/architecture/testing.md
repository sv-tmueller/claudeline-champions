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
- The balance workflow (`.github/workflows/balance.yml`) is not part of CI.
  It runs only by hand (see [Balance reproduction](#balance-reproduction)).

Vitest's default test timeout is 5 s, and the GitHub runner is slower and less
steady than a development machine: the same code read 2.9, 3.9 and 5.9 s for
one test on three runs in a day. A unit test whose runner time passes 2.5 s
therefore gets its own timeout, as an options object
(`it(name, { timeout: N }, fn)`, and the same position for `it.each`), and a
comment above it with its runner times, its local time and the rule. There is
no project-level `testTimeout`, which would hide the next slow test. The rule:
the timeout is the smallest of 10, 15 or 20 s that is at least twice the
slowest runner time seen in the logs. When a test passes half of its timeout,
apply the rule again.

A synchronous test's timeout is checked when its body returns, so no value
stops a hang. The unit job's `timeout-minutes: 10` does that. What the value
bounds is a slowdown.

To rescan, read the unit job's times from a CI run. Vitest prints a time
from 300 ms (its default `slowTestThreshold`), in colour, and the
`[0-9]{4}ms` filter keeps the times of 1 s and up:

```bash
gh api --allow-escape-sequences repos/OWNER/REPO/actions/jobs/JOB_ID/logs \
  | perl -pe 's/\e\[[0-9;]*m//g' | grep -aE '[0-9]{4}ms$'
```

The tests with their own timeout for this reason. Local times are from one
full `npm run test` on an Apple M5 Pro with Node 22.23.2; runner times are
ubuntu-latest, Node 22, over the five logs of 5e0bf3d, #127 and 5820f16 (two
green, three red attempts of identical code); green is the first range, red
the second.

- `packages/bots/test/allocation.test.ts`, "allocates under the limit per
  think in every scene": 1.6 s locally, 2.9 to 3.9 s green, 5.7 to 5.9 s red,
  timeout 15 s.
- `packages/client/src/clip-sampler.test.ts`, "entering and leaving Run at
  every phase" (five models, lumeth slowest): 1.1 to 1.8 s locally, 2.3 to
  4.1 s green, 3.3 to 8.0 s red, timeout 20 s.
- `packages/sim/test/toolkit-stress.test.ts`, "gives the same checksum when
  run twice": 1.05 s locally, 2.0 to 2.5 s green, 3.6 to 3.8 s red, timeout
  10 s.
- `packages/sim/test/rounds.test.ts`, "passes the match, collision, status,
  ability, -0, JSON and checksum oracles at every step": 1.1 s locally, 2.0
  to 2.4 s green, 2.5 to 3.6 s red, timeout 10 s.
- `packages/bots/test/bot.test.ts`, "matches the reference chain on random
  frozen states, to the centimetre": 1.0 s locally, 1.4 to 1.7 s green, 2.6
  to 3.0 s red, timeout 10 s.
- `packages/bots/test/allocation.test.ts`, "allocates only the path it plans,
  across arena01: the follower's whole plan step": 0.75 s locally, 1.6 to
  1.7 s green, 2.3 to 2.7 s red, timeout 10 s.
- `packages/client/src/clip-sampler.test.ts`, "with Attack, Cast and Hit over
  Idle and over Run" (five models): 0.34 to 0.47 s locally, up to 1.3 s
  green, 1.1 to 2.6 s red, timeout 10 s.
- `packages/client/src/clip-sampler.test.ts`, "through Death from every
  state, and the snap back" (five models): 0.41 to 0.54 s locally, up to 1.5
  s green, 1.1 to 3.0 s red, timeout 10 s.

`tools/balance/harness.test.ts` "plays 24 cells over the shipped data" keeps
its 120 s timeout, and it is the thinnest margin in the suite: 18.6 s locally,
47.3 to 59.6 s on the runner. By the rule, twice the slowest runner time is
119.2 s, which is 0.8 s under the timeout. It sits at half its timeout, and
raising it is a one-line change.

## Test types

- Unit tests (Vitest): sim math, collision, statuses, abilities, match flow,
  replay fixtures with checksums. See [simulation](simulation.md).
- Integration tests: bot-versus-bot headless matches. See [bots](bots.md).
- Balance harness tests (the `tools` Vitest project, `tools/**/*.test.ts`):
  the pairings, fills and seeds, `playMatch` against a reference loop, the
  aggregation and the report text, and the CLI's flags. They run in
  `npm run test` with the other projects and play 1 or 2 seeds, not the full
  report.
- E2e tests (Playwright, `e2e/*.spec.ts`): the client loads, renders the arena
  and responds to input; each spec writes its screenshots to the test output
  for human review (the live probe spec has no picture).
- Asset validation: `validate_glb.py` over `assets/models/`. See
  [assets](assets.md).
- Strict TypeScript, ESLint with the dependency-boundary rule. See
  [packages](packages.md).

## Balance reproduction

`npm run balance` plays all 4800 matches of the report in
[balance.md](../design/balance.md) and writes its block; `-- --check`
regenerates the block in memory and exits 1 when it differs from the committed
one (the head line is not compared), `-- --out <file>` writes the block to a
file and `-- --seeds N` plays the seeds 1 to N. It needs Node 22.15 or later,
for `module.registerHooks` (see `tools/balance/register.ts`), which is why the
`engines` field of `package.json` reads `^22.15.0 || >=24`. It is not in
`npm run check`: a full run took about 5.5 minutes on Apple silicon.

`.github/workflows/balance.yml` runs `npm run balance -- --check` on a runner
(`workflow_dispatch` only, so it never runs on a pull request or a push). It
can be dispatched with `gh workflow run balance.yml --ref <branch>` once the
file is on the default branch. Budget 12 to 16 minutes; the runs on record
are in [balance.md](../design/balance.md#7-how-to-regenerate).

## Playwright e2e

The specs are in `e2e/*.spec.ts`. They run against the Vite dev server on
port 5173, which Playwright starts itself.

- `arena.spec.ts`: the arena and the F3 overlay render (`arena.png`,
  `arena-overlay.png`), and `data-arena` is set only after the first draw.
- `scene.spec.ts`: the default match's HUD (`scene.png`): health, the round
  timer against the tick, the hidden result panel with its champion, arena and
  team select (every href writes `teamsize`, with 2v2 current), and the launch
  address `?champion=quillon`. A row on `/?arena=arena02` (`scene-arena02.png`)
  checks `data-arena` and the human's position, (-1100, 200), which proves the
  sim got arena02 and not only the hook, and the arena links. A row on
  `/?teamsize=3` reads `data-bar0` to `data-bar5` at 100 and no `data-bar6`, the
  human at (-1200, 200), 3v3 current and the links carrying `teamsize=3`. The
  default test also reads the difficulty row (easy, normal and hard, normal
  current, the three hrefs written out). A row on
  `/?champion=quillon&difficulty=hard&arena=arena02&teamsize=3` has hard current
  and every link of the other three rows carrying `difficulty=hard`, and
  `/?difficulty=brutal` reads normal as current.
- `walk.spec.ts`: input and the camera (`walk.png`), on the dev-only sandbox
  scene `/?scene=sandbox`, after the round phase begins. The sandbox has one bot
  that never comes near, so the exact-position assertions do not depend on bots.
- `combat.spec.ts`: the F4 debug shot, flashes, rings and kills (`combat.png`),
  the clips (`data-anim0` to `data-anim3`, see client.md, Animation) and the
  heap probe below, on the sandbox. Before the probe hook runs, on the fake
  clock: M1 once reads `data-anim0` Idle+Attack within 3 ticks of the press and
  Idle again within 30 (the button goes up after one tick, so the cooldown
  allows no second cast), the first hit reads `data-anim2` Idle+Hit, the death
  reads Death, `death.png` is taken once the corpse has lain for its 60 ticks
  (it shows the corpse drawn, which is the unculled mesh), and the last read,
  300 ticks on, still reads Death. `data-anim1` reads Idle at every check
  (champion 3 is a bot and walks).
- `live-probe.spec.ts`: the heap probe's second scene, the default match at time
  scale 1 with a pointer that moves before every window, no picture (see the
  heap probe below). It also reads the clips of the match: `data-anim0` starts
  with Run at every measured read (the human walks, with M1 held), a bot reads
  Cast and a champion reads Hit in some read, and the victim of round 3's first
  death reads Death. The reads are the same on every attempt, since the bots are
  deterministic and the hook paces the windows: a bot reads Cast from the first
  read (tick 2729), Attack from 2789, and Hit comes at 2879 (Run+Hit).
- `match.spec.ts`: the first round of the default match against bots, once per
  arena and team size (`match.png`, and `match-arena02.png` for
  `/?arena=arena02`; `match-3v3.png` and `match-3v3-arena02.png` for the same
  addresses with `teamsize=3`): input, one bar hook per champion (four, or six
  in a 3v3), a projectile and a hit within tick budgets, the timer and the
  hidden result panel. It asserts budgets only, never an exact tick, because
  any bots change can move the ticks: the 3v3 rows log the headless ticks next
  to the ones they read (projectile 267 and 271, hit 290 and 319, with a Lumeth
  on each team; 267 and 275, 301 and 307 with two Quillons a side) and assert
  the budgets of the 2v2 rows.
- `match-end.spec.ts`: tests on the dev-only time scale `?timescale=100`
  (client.md, Launch and match), on a paused clock in frames of 16 ms that run
  96 ticks each, read every 5 frames at 320x180. One plays the default match
  with an idle human to its result screen (`result.png`), once per arena
  (`/?arena=arena02&timescale=100` for arena02) and team size (`teamsize=3` for
  the 3v3 rows), within a budget of ticks and frames per row: 15 000 and 182 on
  arena01 (`ceil(15000 / 96) + 25`; it ends at tick 5184 in the e2e and 5053 in
  a headless run, on 57dd52f), 14 000 and 171 on arena02 (tick 4198 headless and
  4224 in the e2e, a Defeat 0 : 3), and 17 000 and 203 on the 3v3 of arena01 (it
  ends at tick 5349 headless and 5664 in the e2e, a Defeat 0 : 3) and 23 000
  and 265 on the 3v3 of arena02 (tick 11 095 headless and 11 424 in the e2e, a
  Defeat 0 : 3). A headless run through the client's setup and driver gives each
  row's tick, in `match-setup.test.ts`. The budget is that tick plus two rounds
  of about 1000 and one round to sudden death of about 7000, rounded up to 1000,
  and the frames are ceil(ticks / 96) + 25. The 3v3 rounds run longer, so their
  rows use 2000 for a round (the longest measured is 1954, with a Lumeth on each
  team; it was 1557 with two Quillons a side). Each row logs its wall time, and
  a row over 40 s gets its own timeout. The test follows the Quillon link of the
  result panel, which keeps the arena and the team size. The other plays the
  sandbox to the red edge: the ring warning hidden until 600 ticks before the
  ring, the countdown, the radius text equal to the sim's within 0.1 m and
  falling, and the red edge (`ring.png`, counted as red pixels against a picture
  without the edge). These assert budgets and tick relations from the rules, and
  the frame budget makes a page without the scale fail at once, however fast the
  machine is.
- `menu.spec.ts`: the Escape menu on a paused clock in frames of 16 ms
  (`menu.png`). The pause: 60 frames under the open menu leave the tick as it
  was, and the 10 frames after Resume run at most 10 ticks (8 with the clock
  reset of the resume, 13 without it, which catches up the paused 960 ms to the
  5 step cap). Restart reloads the page on the same champion and arena, back to
  select relaunches on arena02 (its team row is read there), the select's 3v3
  link reloads to six bars with the menu hidden and Restart keeps it, and a
  rebinding of right to KeyL is refused on a second action as a duplicate,
  survives `page.reload()`, moves the champion east on KeyL and not on KeyD, and
  is reset. The menu is clicked at 1280x720 and the frames run at 320x180. The
  menu's select reads the difficulty row (normal current, the three hrefs), its
  hard link reloads to
  `?champion=hargrim&difficulty=hard&arena=arena01&teamsize=2` with hard current
  in the menu, and Restart keeps it. A sound test replaces
  `window.AudioContext` with a counting fake through `page.addInitScript`
  (a play is one `cancelScheduledValues` on a voice, voices in `SOUNDS` order,
  and the fake's `currentTime` throws) and runs on `/?timescale=100` in 96-tick
  frames: a key press in the warmup is the gesture, the mouse is held for one
  frame of the round, and at the end of round 1 the round-start plays equal
  `data-round`, the round-end plays are 1, the death plays equal `data-deaths`,
  the hit plays are at least `data-hits` and more than 0, and the cast plays at
  least 1. Mute from the menu: the button reads "Sound: off" and no count moves
  through the next round start. After `page.reload()` the settings hold
  version 2 and a true `muted`, the button reads muted and the round start is
  silent; unmuting plays the next round start once and the round end before it.

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
  tick, projectiles, hits and bars as the bots fight) and a pointer moves before
  every window. It is the scene that counts the table-driven change writes and
  the pointer aim with real changes. The clock is paused before the page loads
  and never runs a frame, so the first read is tick 0 and every tick is the
  hook's. The warm-up is plain windows with no profiler from tick 0 to the first
  round that begins after tick 2100 (round 3, begun by tick 2609 on 57dd52f on
  every run so far: the bots are deterministic), then 4 plain windows of the
  round (the lead, 120 ticks), then the next 5 windows are measured, ticks 2729
  to 2879. The lead is derived from three 17-window runs of round 3 with the
  pointer on 57dd52f, all three identical: the first projectile spawns in window
  4 (ticks 2729 to 2759), the first hits land in window 6 (five at once), and
  then 1 to 2 hits land per window and 0 to 3 projectiles are live at the reads
  to the end of the run (tick 3119), with the first death of the round read at
  tick 3419. Before the dash hold of #98 the round began by tick 2879, the first
  projectile spawned in window 5 (lead 5, windows 3029 to 3179) and the first
  death was read at 3539. The margin after the last measured window is 540 ticks
  (the floor is 60). The human walks W and D in the first window, then A and D
  in turn at y of about 3.9 m, west of the block at x = -8, with M1 held;
  Hargrim's M1 windup is `slowed`, so the walk goes on under the cast.
- The live scene's pointer. Before every window of the run, from the first read
  (the warm-up, the lead, the measured windows and the run-on), a synthetic
  `mousemove` is dispatched on `window` through `page.evaluate`. The page runs
  the client's listener before the call returns, as it does for the keys, so the
  window that follows samples it. Two pixels of the 320x180 viewport alternate
  by window, (63, 39) and (45, 97). They are derived like the ground points of
  `walk.spec.ts`, 'faces the mouse cursor', with the client's own raycast (the
  fitted camera of arena01 at 320x180, project the ground point, round the
  pixel, cast it back), and the derivation is a comment in the spec: the first
  reads as (-14.05, 9.02) m, north-west, and the second as (-13.98, -1.04) m,
  south-west. Both lie west of the walk, 4 to 6 m to the side of the human, so
  the facing stays over 0.5 in |sin| and Hargrim's M1 arc points away from the
  enemies, which come from the east. The real mouse is the walk spec's: the
  probe only needs the listener's path (`pointerMove`, then `sampleAim` and
  `groundAimFromPointer` on every frame). The end assertions: phase round, the
  same round and the same death count at every read, the human's bar not "x", a
  projectile in flight at some read and a hit landed between the first read and
  the last (the counts per window are in the log), 29 to 31 ticks per window,
  `p0x` and `f0` different across every window, |sin f0| over 0.5 at every read
  after a measured window, and the sign of sin f0 at each of those reads equal
  to the side of the pointer point that window started with (that proves the aim
  followed the pointer through `sampleAim` in every window), M1 on cooldown in
  at least one read, then the sanity floor, the limit and the bots bound. After
  them the windows run on to the first death of the round, which must come at
  least 60 ticks after the last measured window. Logged, not asserted: per
  window, the projectiles, hits and bars that changed. `combat.spec.ts` has no
  pointer: F4 fires at the default aim.
- Why the live scene is measured in round 3. A live match gives the engine no
  time before its first death (tick 449 on the normal bots of f7e10f0, 719 on
  easy): from tick 0 the counted code read 16 to 81 KB per window, and 3 to 6 KB
  at ticks 570 to 720 (the heap numbers of code that has not reached the
  optimizing tier: `draw`, `loop.ts:advance`, `health-bars.ts:update`,
  `writeHooks`). Rounds 1 and 2 supply the time. The profiler and the tier-up,
  answered by a bounded local test on 1670d1b (a scratch spec, not committed): 3
  attempts with the profiler on in every window from tick 0, against 3 first
  profiled at tick 800, 1200 and 1600, one attempt each. The profiler does not
  move the tier-up of the per-frame functions. `writeHooks`, `advance`,
  `health-bars.ts:update`, `main.ts:draw` and the interpolation read bytes up to
  tick 689 in all three fully profiled attempts (2.4 to 4.1 KB of counted code
  per window at ticks 689, 659 and 629), and none of them reads a byte in the
  first profiled window of the attempts that start at 809, 1229 and 1619, so the
  engine had tiered them up with the profiler off just as it did with it on. The
  bytes that remain after tick 800 are the event paths and one-offs, in both
  groups alike. The counted code was last at or over 780 B at tick 1469, 1829
  and 2069 in the fully profiled attempts and at 1739 (first profiled at 800),
  1829 (1200) and 2219 (1600), and every one of those windows is an event window
  of a fight at 780 to 868 B (`entity-views.ts:acquire`,
  `feedback.ts:routeEvents` and `impact-rings.ts:spawn` over a `frameMany` of
  336 to 612 B) or a one-off (`champion-look.ts:set` 1296 and 1936 B,
  `hud.ts:updateRing` 1296 B, `main.ts:writeCombatHooks` 864 B), plus one fight
  window at tick 3419 of 792 and 804 B in the attempts that start at 1200 and
  1600. So the first tick from which the counted code stays under the limit is
  not a sharp figure, and 2100 stays as the warm-up with the profiler off: it is
  not shorter with the profiler on, and no attempt shows the profiler delaying
  the clean state. Counting tier-up in ticks rather than time
  (`--no-concurrent-recompilation`) does not clean the bots' figures either: it
  moves which functions box ([bots](bots.md#in-the-browser)).
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
- The counted code is the `COMBAT_CODE` pattern: the combat render modules,
  the pose and overlay helpers, the loop clock, the input sampler, the pointer
  aim (`camera.ts`), the HUD writer and its views, the kill feed, the champion
  names, the result screen's writer (`result-screen.ts`), the text tables of
  the hooks and the HUD (`hook-text.ts`), the client's bot-driving glue
  (`bot-driver.ts`), the sound (`audio.ts`: `routeSounds` and `play` run on
  every step's events, and both probe specs unlock the audio with a real
  gesture before the first measured window, so the counted calls reach real
  Web Audio), the champions' clips (`champion-anim.ts`, the state machine, and
  `clip-sampler.ts`, which poses the bones: both run for every champion in every
  frame) and everything in `main.ts`, including the hook's `frameMany`.
  Three's `onAnimationFrame` is logged and not counted: no frame
  of a measured window runs through it. A new module on the frame path goes
  into the pattern. The bots package is not counted, and its bytes are the
  sixth figure of the probe line; the live scene bounds them apart: the median
  of the five measured windows' bots figures (not the bots figure of the
  window that is the median by counted bytes) must be at most
  `LIVE_BOTS_LIMIT_BYTES`, 12 000 B (`heap-probe.ts` has the figures, and
  bots.md, Allocation, In the browser, the causes). The bytes in a browser
  window were: 0.7 to 1.2 KB per window in the sandbox (`bot.ts:move` and
  `rng.ts:next` of its one bot, not asserted), and in the live scene's
  measured windows on bc1d6f1 25 to 131 KB per window on the runner, a median
  window of 52 and 40 KB in two jobs (39 to 44 KB over 15 local attempts): the
  garbage of the plan search, about 53 KB a plan, and the calls V8's Maglev
  tier boxes, `Number.isFinite` and `hypot2` among them (bots.md). After the
  fixes of #93 the median window read 3.2 to 4.0 KB locally (windows of about
  6.1, 10.8, 2.6, 3.7 and 1.6 KB) and 3588, 3912 and 3756 B in the three
  runner jobs on 04be0f9, on windows 5 to 9 of round 3. The dash hold of #98
  moved the measured windows to windows 4 to 8 of a round 3 that begins at tick
  2609, and there the median window reads 6404 to 7996 B over 15 local attempts,
  6952, 7348 and 7200 B in three runner jobs on 4ea802d and up to 7568 B in the
  tester's twelve attempts (main's bots read 5744 to 6416 B there). The limit
  is 50 percent above the largest clean median of the three, 7996 B, a local
  one (11 994, rounded up to 100), and it is also under a quarter of the
  smallest median with the fixes reverted (61.9 KB on these windows, 38.9 KB on
  the old ones), which fails the bound in every attempt (3 of 3 local, 9 of 9
  before). It does not catch one reverted fix alone (`aim`'s 1.2 KB leaves the
  median under 12 KB). The windows after a round starts are not asserted:
  megabytes before the fixes, 0.04 to 0.72 MB in the first window of a round
  after them, locally (bots.md). `summarise` gives the bots' files the prefix
  `bots/`, as it gives the sim's `sim/`, so a bots file such as `bot.ts` never
  matches a client entry. Bytes of an inlined callee land on its caller: V8
  inlines `frame` and its callees into `frameMany`, so their bytes show on it,
  and bots bytes inlined into the glue show in `bot-driver.ts` or `stepSim`.
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
  attempts of 1670d1b all read at least 276 B in every window and the 15 sandbox
  ones at least 204 B (5 batches of 3 each). The local figures below rest on
  such attempts only (the lowest median was 528 B live and 324 B in the
  sandbox). Two live mutation runs of that head read blind, passed and had to be
  rerun: the `data-p0x` template at 24 B in 3 of 3 attempts and the
  `BotDriver.think` array at 0 to 24 B; they read 2428 to 2628 B and 1536 to
  1568 B when rerun. No runner attempt was blind (48 of 48 of the isolation read
  at least 228 B in the counted code), but 216 to 276 B, the figure of a blind
  mutation run, is above that, so a floor on the bytes does not separate blind
  from clean: a green local run proves nothing alone, a mutation check needs
  every attempt red and the mutated function in the log, and a clean read near 0
  B is not a measurement of the code.
- The asserted figure is the median of the five measured windows, in both
  scenes, and a window's figure is its counted bytes (see the retries bullet
  above for why). Window 0 of the sandbox holds the first-frame acquire of the
  volley's eight views and reads 636 to 1092 B counted in every attempt (80
  attempts: the 24 runner lines of the isolation, 35 local, the 15 of 1670d1b
  and the 6 runner attempts of 3def3bc, which reached 1092; the acquire is 336
  to 660 B of it), which the median ignores; the live scene's windows hold the
  round's first projectiles, the first hit and the rings: the event paths
  (`entity-views.ts:acquire`, `feedback.ts:routeEvents`,
  `impact-rings.ts:spawn`) cost 24 to 330 B in a window, with one-off spikes of
  1.3 to 5 KB in `hud.ts`, `impact-rings.ts`, `main.ts` and `champion-look.ts`,
  each in one window.
- The limits are literals in `e2e/heap-probe.ts`, one per scene, with their
  figures in the comment beside them. Both follow the limit rule: about 100 B
  above the largest clean median, local and runner, and below the smallest
  mutation the scene gates. They were read on a copy of the spec with the limit
  at 1 B and `expect.soft`, 15 attempts per scene on 1670d1b in 5 batches of 3
  repeats, none blind. Sandbox: 600 B. In a steady state every counted function
  reads 0 B except `frameMany`, which reads 300 to 588 B (9 to 18 B per frame,
  one boxed number per frame at the call into `frame`, which stays whatever the
  shape of the hook: the timestamp as an argument, as an integer, in a field of
  the loop clock, and with no argument at all, where no number crosses the call)
  and carries the bytes of whatever V8 inlines into it. The largest clean median
  of five is 504 B, from the 24 runner attempts of the isolation (before the
  fixes of #87 and #89) and, with the fixes in, once locally on b7df9fb (2
  attempts: 336 and 504 B). The other figures with the fixes in: at most 456 B
  over the 15 local attempts, 480 B over the tester's 3 local attempts on
  3def3bc (360, 480 and 480 B) and 456 B over the 6 runner attempts on 3def3bc
  (384, 360, 432, 432, 456 and 408 B, run 37456539110). The limit is 96 B above
  504 B (about 100 B, to a round 600 B) and 292 B under the smallest
  sandbox-gated mutation (892 B). It was 640 B, 136 B above the largest figure,
  which is outside the margins the rule has accepted (96 to 120 B). Against 600
  B the eight per-call mutations of the table were rerun on the sandbox and all
  failed 3 of 3 (medians 940 to 3132 B). The worst window is not a stable
  figure: window 0 read 744 to 1032 B clean in the 15 attempts, 792 to 1092 B in
  the 6 runner attempts (636 to 1068 B in the 74 attempts before those) and 1224
  to 2140 B with a spike. Live: 780 B, its own literal, because the event
  windows raise the base and a moving pointer is present in every window: on
  1670d1b the median of five was at most 684 B over the 15 local attempts (a
  worst clean window of 780 B, and 3 spikes in 75 windows: `feedback.ts:hit`
  1548 B, `hud.ts:updateRound` 1944 B and `health-bars.ts:update` 1944 B), above
  the sandbox's 600 B. The runner medians of the earlier shape (7b80afd, no
  pointer, `draw` excluded: jobs 112201476995, 112203346352 and 112205063119)
  were 588, 540 and 660 B, at 1.0 to 1.1 min per live attempt; the six runner
  attempts on 3def3bc read 660, 552, 636, 516, 576 and 528 B, with `sampleAim`,
  `camera.ts` and `draw` at 0 B in every window, 41 s to 1.1 min per live
  attempt (1.1 min, 50.8 s, 40.9 s, 51.3 s, 1.1 min and 47.4 s, about 2.7x
  margin against the 180 s timeout) and 2.7 to 4.2 min for the whole Playwright
  run of 19 tests. The live limit is 96 B above the largest clean local median
  (684 B), 120 B above the largest of those runner medians (660 B) and 228 B
  under the smallest live-gated mutation, the per-change `data-p0x` write (1008
  to 1176 B). A runner live median above 780 B reopens the limit under the limit
  rule (about 100 B above the largest clean median, below the smallest
  live-gated mutation; if none fits, stop and report). The figures of the PR's
  runner proof are in its body.
- `main.ts:sampleAim`, `camera.ts` and `entity-views.ts:draw` read 0 B. On
  1670d1b the three read 0 B in all 75 windows of the 15 live attempts (the
  pointer present and moving), and `draw` and the camera module in all 75
  windows of the sandbox. Both were once the live scene's allocations: the aim
  sampling made a DOMRect, an NDC object and a hit object per frame (about 85 B,
  2.3 to 2.7 KB per window, issue #87), and `draw` called `mesh.position.set(x,
  y, z)` per live slot, three raw doubles that V8 boxes where the optimizing
  tier does not inline `Vector3.set` (a cold branch with few live views: on the
  runner `draw` read 228 to 912 B per window, and 1.1 to 1.5 KB in the window of
  the first hit, in 19 of 24 attempts, and the live scene had to leave it out of
  its count, issue #89). The reproduction is a run with
  `--js-flags="--no-turbofan --no-maglev-inlining"` on a scratch Playwright
  config (never committed): before the fix `entity-views.ts:draw` read 156 to
  1164 B per window in 15 of 15 live windows, and 0 B in 15 of 15 after it. The
  rule for both: no raw double crosses a call on the frame path, so the code
  passes objects in and reads fields out (the canvas rect is copied into an
  object once per resize, the ground point is written into a scratch record, and
  `draw` writes the fields of the mesh's position).
- Five more frame-path functions read 0 B (#117). On 13dab62 plus the carries,
  `main.ts:draw`, `entity-views.ts:draw`,
  `debug-overlay.ts:updateChampionCircles`, `feedback.ts:routeEvents` and
  `impact-rings.ts:spawn` read 0 B in all 60 windows of the 12 local attempts of
  each scene (4 batches of 3 repeats, none blind). `draw` places the champion
  views through `placeChampion` (position fields, the facing through
  `rotation.fromArray`), the overlay's circles group is handed back once from
  the build, the draw calls take the clock record and `routeEvents` passes the
  event records. One lesson came from the rings: a hit is rare, so its code runs
  in V8's interpreter, where every load of a double field allocates a heap
  number. With the record passed on, `spawn` still read 24 to 252 B in the
  windows that hold a hit, because it loaded `x` and `y`; it now keeps the
  record and the rings' `draw` (hot) reads the coordinates, and the colour is
  copied only when a ring's tint changes. Before the carries `routeEvents` read
  24 to 132 B and `spawn` 24 to 108 B in those windows. The counted medians
  stayed in the old range: 336 to 456 B on the sandbox and 408 to 552 B live.
  Logged, not asserted: `impact-rings.ts:draw` reads 24 B in window 1 of the
  sandbox in 5 of 12 attempts (the first ring it draws), and one-off spikes of
  `interpolate.ts:placeChampion` (4332 B, once, sandbox) and
  `audio.ts:routeSounds` (1944 B, once, live) fell in one window each.
- The animation modules read 0 B (#111). On 415ba94 (the code of the package
  after its fix round), `champion-anim.ts` and `clip-sampler.ts` read 0 B in all
  75 sandbox windows and in 74 of 75 live windows of the 15 local attempts of
  each scene (5 batches of 3 repeats, none blind), the exception being one
  window of 468 B in `clip-sampler.ts:blendChannel`. Across the 27 attempts per
  scene of the round's reruns the modules read 0 B but for one-off windows: 1 of
  135 sandbox and 2 of 135 live windows, 144 to 468 B each, in `blendChannel` or
  `slerpFlat`, with no median moved. The counted medians stayed in the old
  range: 336 to 432 B on the sandbox and 432 to 588 B live, against 600 B and
  780 B, so no limit moves. The bots' medians were 6608 to 7728 B. Logged, not
  asserted: `impact-rings.ts:draw` read 24 B in window 1 of the sandbox in 11 of
  15 attempts, and one-off spikes of `main.ts:draw` (6672 B, sandbox, once) and
  `main.ts:writeCombatHooks` (1944 B, live, once) fell in one window each. The
  fix round added a 3-tick crossfade when a cast replaces an overlay, and
  without a priming script the live scene read one-off 2 to 10 KB spikes in
  `slerpFlat` and `writePose` in 5 of 12 attempts (0 of 6 without the
  crossfade): the first replacement of a playing overlay was a branch V8 had no
  feedback for. `createClipRig` now poses a scripted match (`scriptAnims`, every
  state of the machine, a crossfade included) through the new rig at load and
  puts the bones back at rest, which cut it to the one window above. The package
  found three things on the way, each the kind of bytes that is easy to ship:
  - A double that comes out of a branch merge with an integer constant on one
    side (`x = cond ? 1 : w`, a `let` assigned in an `if`, a negation under an
    `if`) is boxed by V8's Maglev: one heap number, 12 to 16 B, on every call.
    The first state machine read 24 to 768 B per window in `stepRun`, 150 KB in
    a bench of 12 000 calls (a scratch spec that imports the module in the page
    and runs it under the sampling profiler, never committed), and 0 B in all of
    them once every such merge became a store in a branch or arithmetic on a 0
    or 1.
  - A branch V8 has no feedback for deoptimizes the function that holds it, and
    the function then runs in the interpreter for hundreds of calls, where every
    double allocates. The first state machine read `champion.dash` and its
    `dirX` and `dirY`, and the first dash of the live match (a bot's Glide) cost
    25 to 29 KB per window in `stepRun` for the four windows after it and 7.8 KB
    in `stepOverlay`, which is inlined into the same caller. The dash is now the
    sim's `dashStarted` and `dashEnded` events, which the cold handler turns
    into an integer, and the direction of a dash is the displacement of the
    frame.
  - A closure that captures a parameter makes its function allocate a context on
    every call, not once per closure: the row below with `() => anim.mode` read
    2.0 to 2.5 KB a window in `stepRun`, where `() => RUN_SETTLE` (nothing
    captured) is one function object per transition.
- To read the per-function figures, read the "combat code allocated" line of a
  failure message, or the per-window lines `heap probe <scene> attempt N window
  W: counted ...` that every attempt logs. Excluding `frameMany` from the
  pattern is not an option: with it excluded, the escaping array in `frame` and
  the `ResultScreen.update` template passed, because V8 inlines their code into
  `frameMany`.
- The sanity floor: the lowest window outside the sim's three sweep files
  (`projectile.ts`, `geometry.ts` and `area.ts`, whose garbage was about 790 KB
  per window until #62 and is 5.7 to 18 KB now, total minus outside the sweep
  files in 9 windows of a local run on 66f4828) must exceed 80 KB, about a third
  of the lowest figure measured with the hook on a head that contains #62,
  264,652 B. The floor only proves that the profiler sees garbage.
- The mutation rule: a change to the probe, its pattern or the frame path is
  checked by applying each of these alone, on each scene, and seeing the spec
  fail on every attempt of the scene or scenes the table gives it (all three
  attempts, with no retries): an escaping array in `frame`, a template string
  written to `data-p0x` on every `writeHooks` call, a closure in `routeEvents`,
  an escaping `{x, y}` in the entity views' `draw`, the old `toPlayerInput`
  literal, a template string built on every `Hud.update` call, an escaping array
  built on every `BotDriver.think` call, a template string built on every
  `ResultScreen.update` call and the canvas rect asked from the DOM on every
  `sampleAim` call. The first seven fail every attempt on both scenes, `draw`
  among them since the exclusion is gone. Each line keeps its object reachable
  through `globalThis` (the compiler removes an unused one: the lesson of #72).
  The median of five, as bytes per attempt over 3 attempts, plus the line, both
  columns on 1670d1b with the measured windows after the lead. Two kinds of line
  are gated by one scene, as decision 2 on #91 reads the criterion: the
  `ResultScreen.update` template is the sandbox's (on the live scene it read red
  in 3 of 3 attempts here, but only 56 B over the limit, and 704 B and 752 B
  passed under 780 B in the 12 attempts before; the sandbox reads 892 to 944 B
  against 600 B), and the per-change pair and the rect row are the live scene's
  (the sandbox never changes the position or the facing in a window and never
  moves the pointer). The limit is 600 B on the sandbox and 780 B on the live
  scene. Places are given by function, since line numbers go stale:

  | Mutation | Function and place | The line as applied | Sandbox, B | Live, B |
  |---|---|---|---|---|
  | array in `frame` | `main.ts:frame`, after `const steps = clock.advance(now);` | `(globalThis as unknown as { __j?: unknown }).__j = [steps, now];` | 1600 to 1728 | 1720 to 1876 |
  | template to `data-p0x` per call | `main.ts:writeHooks`, after `const x = Math.round(champion.x * 100);` | `` canvas.setAttribute('data-p0x', `${x},${Math.round(champion.y * 100)}`); `` | 2844 to 3068 | 2428 to 2628 |
  | closure in `routeEvents` | `feedback.ts:routeEvents`, first line | `(globalThis as unknown as { __f?: unknown }).__f = () => state.tick;` | 1884 to 2020 | 1800 to 1988 |
  | object in `draw` | `entity-views.ts:draw`, after `const y = this.options.y;` | `(globalThis as unknown as { __o?: unknown }).__o = { x: alpha, y };` | 3024 to 3144 | 3068 to 3348 |
  | `toPlayerInput` literal | `input.ts:toPlayerInput`, replacing `return out;` | `return { moveX: out.moveX, moveY: out.moveY, aimX, aimY, buttons };` | 2016 to 2088 | 2216 to 2320 |
  | template per `Hud.update` | `hud.ts:update`, first line | `` (globalThis as unknown as { __t?: unknown }).__t = `t${state.tick}`; `` | 1612 to 1776 | 1352 to 1468 |
  | array per `BotDriver.think` | `bot-driver.ts:think`, first line | `(globalThis as unknown as { __b?: unknown }).__b = [state.tick, inputs.length];` | 1320 to 1996 | 1536 to 1568 |
  | template per `ResultScreen.update` | `result-screen.ts:update`, first line | `` (globalThis as unknown as { __r?: unknown }).__r = `r${state.match?.round}`; `` | 892 to 944 | 836 to 860 (sandbox-gated: red here, 56 B over the limit) |
  | rect per frame in `sampleAim` | `main.ts:sampleAim`, the rect argument of `groundAimFromPointer` | `renderer.domElement.getBoundingClientRect()` in place of `canvasRect` | 336 to 504 (passes: no pointer) | 1020 to 1148 (live-gated) |
  | object per view update | `clip-sampler.ts:poseChampion`, first line | `(globalThis as unknown as { __m?: unknown }).__m = { t: rig.time[0] };` | 3728 to 3820 | 3584 to 3740 |
  | binding table per frame | `clip-sampler.ts:poseChampion`, first line | `(globalThis as unknown as { __m?: unknown }).__m = rig.bones.map((bone) => bone.quaternion);` | 3604 to 3740 | 3588 to 3848 |
  | clip time as an argument | `champion-anim.ts:updateAnims` and `updateAnim` | `updateAnim(anim, champion, now)` and the `now` parameter in place of the `D_NOW` write and read | 1548 to 1692 | 1596 to 1764 |
  | closure per transition | `champion-anim.ts:stepRun`, after `anim.mode = RUN_SETTLE;` | `(globalThis as unknown as { __m?: unknown }).__m = () => RUN_SETTLE;` | 384 to 408 (passes) | 460 to 544 (passes) |

  The four rows of #111, each applied alone on 415ba94 with 3 attempts per
  scene: the first three fail 6 of 6 (the object and the table name
  `clip-sampler.ts:poseChampion` at 3.1 to 3.5 KB a window, and the argument
  names `main.ts:draw` or `champion-anim.ts:updateAnims`, by where V8 inlines
  it, at 1.0 to 1.2 KB), and the closure passes 6 of 6, which is the expected
  reading: it is one function object per transition, a few per window, so
  `stepRun` reads 28 to 140 B in the windows of the live scene and nothing in
  the sandbox, where no walk stops in a window. It is recorded like the
  `createGain` row of the audio (client.md, Audio). The existing rows rerun on
  f67a490, all red 6 of 6: the array in `frame` (sandbox 1512 to 1664 B,
  live 1628 to 1804 B), the closure in `routeEvents` (1620 to 1744 B and 1712 to
  1768 B) and the object in the entity views' `draw` (3072 to 3120 B and 3000 to
  3100 B), against clean medians of 324 to 456 B and 432 to 576 B.

  A mutation in the bots' think or the HUD lands on the caller V8 inlines it
  into (`stepSim`, `frameMany`), so read the function names of the failure
  message with that in mind. The rect row names `main.ts:stepSim` and
  `frameMany` in the log, since `sampleAim` is inlined into the sim step.
- The per-change writes, live scene only. The sandbox never changes the position
  or the facing in a window, so only the live scene can see them. Applied alone,
  inside the existing guards of `writeHooks`: the `data-p0x` write as
  `canvas.setAttribute('data-p0x', x.toFixed(0));` and the `data-f0` write as
  `canvas.setAttribute('data-f0', (facing / 1000).toFixed(3));`. Not a bare
  `${x}`: V8's number-to-string cache returns a cached string for an integer it
  has seen, and the walk revisits the same centimetres every second window, so
  that form could read 0 B. Run once per scene, 3 attempts each: both pass on
  the sandbox (medians 336 to 384 B and 360 to 408 B, under 600 B), which is the
  gap, and both fail on the live scene, every attempt (1008 to 1176 B and 1300
  to 1388 B on 1670d1b; 948 to 1028 B and 1220 to 1276 B on 8d80073, before the
  pointer joined the scene). The per-event writes (the flash, the bars, the
  counts) are not mutated: they are on review only. The rect row of the table is
  live-only for the same reason: the sandbox's pointer never moves.
- Each attempt logs one line, `heap probe <scene> attempt N: bytes per window,
  total/onAnimationFrame/fake requestAnimationFrame/outside the sweep
  files/counted code/bots`, with the six figures of each measured window (N is
  the repeat index, 0 without `--repeat-each`), and for every window with
  counted bytes a line with its functions, counted and bots, so every runner log
  names the function of any spike, whether the attempt passed or failed. The
  fake `requestAnimationFrame` figure reads 0 B now (no window runs a frame
  through the fake clock); a nonzero one means one did.
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
