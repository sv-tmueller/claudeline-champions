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

- Run them with `CI=1`. Without it Playwright reuses whatever listens on 5173,
  which can be a sibling session's dev server serving other code. With `CI=1`
  it always starts its own, and fails with "already used" when something holds
  the port. `npm run check` and CI set it.
- Check the port before every e2e command, for example
  `lsof -nP -iTCP:5173 -sTCP:LISTEN`, which must print nothing. When a parallel
  session takes the port, wait until it is free and run again. That failure says
  nothing about the code.
- Assertions are tick-based only. A spec paces itself by the canvas hook
  `data-tick` and by the other hooks and HUD attributes, and never by a
  wall-clock wait, so a slow machine cannot change what it sees. The combat
  spec installs a paused Playwright clock and runs it frame by frame.
- Global retries are 0 in `playwright.config.ts`. A flaky spec is a bug.
- `combat.spec.ts` has file-scoped retries of 2, for the heap probe's bad mode
  described below. A "flaky" combat.spec in a CI log (passed on a retry) means the
  first attempt hit the bad mode; the log line of each attempt shows it. A
  regression fails all three attempts.

### The heap probe

The last step of `combat.spec.ts` counts the allocations of the per-frame code
over a window of frames, with the sampling heap profiler and garbage included, so
a plain heap delta is not needed.

- The scene is in a steady state: eight shots in flight and nothing to hit. The
  engine warms up on 4 volleys, one window settles, and 3 windows of 30 frames
  are measured. The viewport shrinks to 320x180 first, because on the runner a
  frame renders in 105 to 210 ms at 1280x720 and the probe never looks at pixels.
- The counted code is the `COMBAT_CODE` pattern: the combat render modules, the
  pose and overlay helpers, the loop clock, the input sampler, the HUD writer and
  its views, the kill feed, the champion names, everything in `main.ts`, and
  three's `onAnimationFrame`, which holds the bytes of the `frame` function
  that V8 inlines into it. A new module on the frame path goes into the pattern.
- The limit is 256 B per window. The clean figure is 24 to 48 B, in
  `onAnimationFrame` only, and every other counted function reads 0 B.
- The mutation rule: a change to the probe, its pattern or the frame path is
  checked by applying each of these alone and seeing the spec fail on every
  attempt: an escaping array in `frame`, a template string in `writeHooks`, a
  closure in `routeEvents`, an escaping `{x, y}` in the entity views' `draw`, the
  old `toPlayerInput` literal, and a template string built on every `Hud.update`
  call. The figures are 1248 to 1344, 1096 to 1104, 1548 to 1644, 10540 to
  10936, 960 to 992 and 1684 to 1724 B per window. The clean figure is read the
  same way on a copy of the spec with the limit at 1 B.
- Each attempt logs one line, `heap probe attempt N: bytes per window,
  total/onAnimationFrame/fake requestAnimationFrame`, with the three figures of
  its measured windows.
- The bad mode: in about 3 runs in 10 on the runner, and in about 3 attempts in 5
  locally when step 8 runs in a fresh browser under four parallel workers,
  `onAnimationFrame` reads 970 to 1200 B in every window. The bytes move, they do
  not grow. Playwright's fake clock hands out ids of 1e12 and up, so each
  `requestAnimationFrame` call boxes about three heap numbers (36 B). In the
  clean mode the fake clock's `requestAnimationFrame` holds them (about 1075 B
  per window, 0 B in the bad mode); in the bad mode Maglev inlines it into
  `onAnimationFrame`. The windows' totals are equal in both modes (about 790 KB),
  and turning Maglev's inlining off removes the mode (0 of 16 attempts). Changes
  to the client did not (loop fields as doubles from creation, 10 of 20 bad;
  `draw` reading the clock itself, 9 of 20; baseline 12 of 20). The real spec on
  one page read 0 of 20 bad locally, so only the runner shows it.

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
