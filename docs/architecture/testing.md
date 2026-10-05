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
  for human review.
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
- `match.spec.ts`: the first round of the default match against bots
  (`match.png`): input, a projectile and a hit within tick budgets, the timer and
  the hidden result panel. It asserts budgets only, never an exact tick, since bot
  output differs between platforms.

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
- `combat.spec.ts` has file-scoped retries of 2, as a net for a marginal probe
  regression near the limit (see below). A combat.spec that shows "flaky" in a CI
  log (passed on a retry) is a failed attempt: read its log line, and treat a
  failure anywhere but the probe assertion as real. A regression fails all three
  attempts; only a marginal one near the limit can pass on a retry.

### The heap probe

The last step of `combat.spec.ts` counts the allocations of the per-frame code
over a window of frames, with the sampling heap profiler and garbage included, so
a plain heap delta is not needed.

- The scene is the dev-only sandbox, `/?scene=sandbox`: Hargrim and Quillon
  against Lumeth and Skerrow with match flow and exactly the Hargrim and Quillon
  kits, where only champion 3 (Skerrow, no kit, so it deals no damage) is a bot.
  The default match cannot be probed: three bots fight, so hook and HUD values
  change in every window and their change writes allocate by design (see
  [client](client.md)). The spec runs the 180 warmup ticks at 320x180, switches to
  1280x720 for steps 2 to 7, and goes back to 320x180 for step 8, because on the
  runner a frame renders in 105 to 210 ms at 1280x720 and the probe never looks at
  pixels.
- The scene is in a steady state: eight shots in flight and nothing to hit, with
  M1 held from the first warm-up volley to the end of the measured windows. M1 is
  Hargrim's arc, a 36-tick cooldown with a reach of 3 m and nothing in reach, so
  the windows cover `startCast`, the windup, `castFired`, the arc, the cast record
  dropped, the HUD's cooldown and windup writes, the round phase and a live bot
  through the glue. No projectile or area spawns inside a measured window. The
  engine warms up on 4 volleys, one window settles, and 3 windows of 30 frames are
  measured. The end assertions prove the casting ran (the M1 icon is on cooldown)
  and that nothing else happened (the round, one death, the bot at 100, no flash).
- A window is one `page.evaluate` call of the client's dev-only hook,
  `window.__runProbeFrames(30)`, which runs `frameMany` in `main.ts`: 30 calls of
  `frame` with timestamps one tick apart (one sim tick each), with no
  `requestAnimationFrame` and no three animation loop. Steps 2 to 7 keep the
  paused Playwright clock and their tick-exact reads. The F4 volleys between
  windows go through the keyboard: a key press is dispatched in the page before
  its call returns, and `fireVolley` reads `debugShots` back and checks that all 8
  fired, so every shot is in the state before the next window. The hook is
  behind `import.meta.env.DEV`, like F4; see the dist grep in [client](client.md).
- The counted code is the `COMBAT_CODE` pattern: the combat render modules, the
  pose and overlay helpers, the loop clock, the input sampler, the HUD writer and
  its views, the kill feed, the champion names, the result screen's writer
  (`result-screen.ts`), the client's bot-driving glue (`bot-driver.ts`) and
  everything in `main.ts`, including the hook's `frameMany`. Three's
  `onAnimationFrame` is logged and not counted: no frame of a measured window runs
  through it. A new module on the frame path goes into the pattern. The bots
  package is not counted: it allocates on every think by its API. `summarise`
  gives its files the prefix `bots/`, as it gives the sim's `sim/`, so a bots file
  such as `bot.ts` never matches a client entry. Bytes of an inlined callee land
  on its caller: V8 inlines `frame` and its callees into `frameMany`, so their
  bytes show on it.
- The limit is 640 B per window. Every counted function reads 0 B except
  `frameMany`, which reads 276 to 540 B (9 to 18 B per frame, one boxed number per
  frame at the call into `frame`, which stays whatever the shape of the hook: the
  timestamp as an argument, as an integer, in a field of the loop clock, and with
  no argument at all, so no number crosses the call) and carries the bytes of
  whatever V8 inlines into it. The limit is about 100 B above the largest clean
  window of 35 attempts and below every mutation below (1048 B and up). It was
  read on a copy of the spec with the limit at 1 B and no retries; to read the
  per-function figures, run that copy and read the "combat code allocated" line
  of the failure message. Excluding `frameMany` from the pattern is not an option:
  with it excluded, the escaping array in `frame` and the `ResultScreen.update`
  template passed, because V8 inlines their code into `frameMany`.
- The sanity floor: the lowest window outside the sim's three sweep files
  (`projectile.ts`, `geometry.ts` and `area.ts`, whose garbage is large and moves
  with the sweep fix in #49) must exceed 80 KB, about a quarter of the lowest
  figure measured with the hook, 277 KB. The floor only proves that the profiler
  sees garbage.
- The mutation rule: a change to the probe, its pattern or the frame path is
  checked by applying each of these alone and seeing the spec fail on every
  attempt (all three, with the retries): an escaping array in `frame`, a template
  string written to the `p0` hook on every `writeHooks` call, a closure in
  `routeEvents`, an escaping `{x, y}` in the entity views' `draw`, the old
  `toPlayerInput` literal, a template string built on every `Hud.update` call, an
  escaping array built on every `BotDriver.think` call and a template string built
  on every `ResultScreen.update` call. The figures, bytes of the worst window per
  attempt, are 1324 to 1520, 2340 to 2736, 1996 to 2324, 10880 to 11172, 1776 to
  1820, 1432 to 1736, 1424 to 1480 and 1048 to 1120.
- Each attempt logs one line, `heap probe attempt N: bytes per window,
  total/onAnimationFrame/fake requestAnimationFrame/outside the sweep
  files/counted combat code`, with the five figures of its measured windows. The
  fake `requestAnimationFrame` figure reads 0 B now (no window runs a frame
  through the fake clock); a nonzero one means one did.
- The HUD writes state with `setAttribute`, not `dataset`. With `dataset`, the
  casting windows read 96 to 128 B in `hud.ts:updateSlots` in 5 of 5 attempts at
  limit 1, and `setAttribute` read 0 B.
- The history, which is why the windows use a hook: with the windows on the fake
  clock, `onAnimationFrame` had two modes. Playwright's fake clock hands out ids
  of 1e12 and up, so each `requestAnimationFrame` call boxes about three heap
  numbers (36 B per frame). In the clean mode (0 to 72 B in `onAnimationFrame`)
  the fake clock's own function holds them (about 1075 B per window); in the bad
  mode (about 1100 B per window) Maglev inlines it into `onAnimationFrame`. The
  runner entered the bad mode in every attempt once the sandbox had kits, match
  flow and a driven bot (run 37335049730, batch #53 decision 5), so retries could
  not cover it. Turning Maglev's inlining off removed the mode but made the
  counted functions allocate 6.6 to 7 KB per window (boxed doubles at the call
  boundaries that no longer inline), so the flag was dropped. Loop fields as
  doubles from creation, `draw` reading the clock itself, a timestamp as an
  integer and a hook that passes no timestamp changed nothing in the mode or in
  the hook's 9 to 18 B per frame.

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
