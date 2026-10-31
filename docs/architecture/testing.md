# Testing and quality gates

Source: spec section 9.

## Check suite

`npm run check` runs lint, typecheck, unit tests, the asset checks
(`assets:validate` and `assets:test`) and the Playwright e2e specs
(`e2e/*.spec.ts`). It is the check suite every package must pass.

CI is split by cost:

- Typecheck, lint, unit tests and the asset checks run on pull requests that
  touch code, drafts included, and on pushes to main.
- The bots' heap check (`packages/bots/test/allocation.test.ts`) runs in its
  own job on the Node majors the unit job does not run, through
  `vitest.heap.config.ts`: Node 26.7.0 (pinned; V8 14.6) in the default tiers
  and in Maglev alone, the tier a browser match runs the bots in (`--maglev
  --no-turbofan --no-concurrent-recompilation --no-use-osr`; the last two
  switch off background compilation and OSR, which the browser keeps on, so
  that the figures do not depend on compile timing), and Node 24 in the
  default tiers. The unit job runs it on Node 22. The job has no `needs:`,
  runs on drafts in parallel with the unit job and takes about half a minute.
  See [bots](bots.md), Testing.
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
the second. The three clip-sampler green ranges are over the seven-model unit
jobs of the three green runs of PR #179 (40334583804, 40336071398,
40336850393); their red ranges are still from 5820f16.

- `packages/bots/test/allocation.test.ts`, "allocates under the limit per
  think in every scene": 1.6 s locally, 2.9 to 3.9 s green, 5.7 to 5.9 s red,
  timeout 15 s. With the settle of #133 (one window a scene on the runner): 4.8
  to 6.9 s over the three attempts of PR #184, the heap jobs 3.6 to 5.3 s, the
  timeout stays 15 s (twice 6.9 s is 13.8 s).
- `packages/client/src/clip-sampler.test.ts`, "entering and leaving Run at
  every phase" (seven models, lumeth slowest): 1.1 to 1.8 s locally, 3.6 to
  8.3 s green, 3.3 to 8.0 s red, timeout 20 s.
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
  Idle and over Run" (seven models): 0.34 to 0.47 s locally, 1.0 to 2.4 s
  green, 1.1 to 2.6 s red, timeout 10 s.
- `packages/client/src/clip-sampler.test.ts`, "through Death from every
  state, and the snap back" (seven models): 0.41 to 0.54 s locally, 1.2 to 2.5
  s green, 1.1 to 3.0 s red, timeout 10 s.
- `packages/server/test/room.test.ts`, "keeps the settings and the choices,
  and lets the room play again": 1.8 s locally, 3.7 s on the runner (job
  121633905207, 779e504), timeout 10 s.
- `packages/server/test/room.test.ts`, "frees the seats of humans who were
  disconnected, moves the host, and calls empty() at the end": 1.6 s locally,
  3.7 s on the runner (job 121633905207, 779e504), 2.1 s on main before #204
  (job 122125510999), then 4.2, 5.05 (5049 ms) and 4.3 s with Durnhal's file
  (jobs 122175440820, 122182006132 and 122189679246); twice 5.05 s is 10.1 s,
  so the timeout is 15 s.

Durnhal's file (#204) makes the server field a Durnhal bot on the default range
profile in these matches and in both loopback specs, until step 1.3 of roadmap
#176 gives him a profile. The loopback `beforeAll` is the row that moved. Timed
around its body on one machine, the 2v2 hook went from 1.1 s to 1.5 to 1.7 s
and the 3v3 hook from 2.5 to 3.1 s to 4.8 to 5.1 s, so the runner-to-local
ratio of the header of `loopback.test.ts` (4.5 s over 2.7 s) gave about 8.3 s
for the 3v3 hook. The runner was slower: the file took 17.0 s in job
122173425469 (rows about 4.1 s); on f07e9df the 3v3 hook failed with "Hook
timed out in 15000ms" (job 122175440820, the file 28.7 s with the 3v3 rows
skipped); and with a 20 s timeout on 0d986a7 the file took 24.3 s and its two
rows 5.9 s (job 122182006132), so the two hooks took 18.4 s and, by the local
split of 1.6 s to 5.0 s, the 3v3 hook about 14 s; on 1019df2 the file took
32.6 s (job 122189679246), so the hooks took about 24 s and the 3v3 hook about
18 s. The log has no time for a `beforeAll`. Twice that is above the 20 s top
of the rule, so the hook takes the 60 s of the long-match precedent below and
its work is not cut (decision 4 on issue #203). The same job read 5.74 s for
the 3v3 row "matches a local sim of the same seed, kits and inputs at every
tick" (2.19 s for the 2v2 one; main read 3.2 s and 1.5 s), past half of its
10 s, so the loopback rows take 15 s, set on the `describe.each` for both
specs. The room row "frees the seats" is the other one that moved, in the list
above; "keeps the settings and the choices" took 0.44 s locally and 0.95 to
1.4 s on those runners, inside its mark.

`tools/balance/harness.test.ts` "plays 24 cells over the shipped data" (the four
v1 kits) has a 150 s timeout (120 s before the dodge of #137), and it is the
thinnest margin in the suite: 22.4 s locally (18.6 s before), 47.3 to 59.6 s on
the runner before the dodge and 62.4 s after it (job 117369238607). By the rule,
twice the slowest runner time is 124.8 s, so the timeout is 150 s, which is 25 s
over it; the test sits at 42 percent of its timeout.

The seeded matches of `packages/bots/test/ondrel.test.ts` (ten cells) and
`brimwick.test.ts` (eight) play each cell to matchEnd under the press oracle and
have their own timeouts too: 60 s a cell and 30 s for each of the three long
start-edit runs (the long-match precedent of `lumeth.test.ts`, which has 120 s;
the two Reed Screen runs of 120 ticks take 0.5 s on the runner and have none). A
cell takes 2 to 5 s locally (Apple M5 Pro, Node 22.23.2; a file alone 27 to 40
s) and 7.0 to 25.4 s (Ondrel) and 7.2 to 22.2 s (Brimwick) on the runner,
ubuntu-latest, Node 22 (job 121726022078 of 056def8, with the other long files
running beside them); twice the slowest is 50.8 s, so 60 s. The long start edits
read 7.1 s (Drowned Ground) and 10.0 and 10.4 s (Grand Finale) there, and 11.5,
9.4 and 8.5 s in job 122125510999; twice the slowest is 23 s, above the 20 s top
of the rule, so they keep the 30 s of the long-match precedent. The two files
take 161 s and 120 s of job 121726022078, beside `lumeth.test.ts` (117 s) and
`headless-kits.test.ts` (95 s), and the unit job went from 2 min 24 s on main
(4cfe695) to 5 min 49 s (305 s of Vitest). On main it reads 6 min 4 s at bce9662
(job 122194680307, 320 s of Vitest: `ondrel.test.ts` 154 s, `lumeth.test.ts` 125
s, `brimwick.test.ts` 120 s, `tools/balance/harness.test.ts` 90 s,
`headless-kits.test.ts` 90 s), 61 percent of `timeout-minutes: 10`. One test's
runner time has spread 2x in a day (2.9 to 5.9 s, see Check suite), and a day
that slow for the whole job would pass the 10 minutes from 5 minutes on, so the
job keeps less than that margin. The trigger: once a unit job on main passes
about 8 minutes, cut the cell count of these two files.

## Test types

- Unit tests (Vitest): sim math, collision, statuses, abilities, match flow,
  replay fixtures with checksums. See [simulation](simulation.md).
- Integration tests: bot-versus-bot headless matches. See [bots](bots.md).
- Balance harness tests (the `tools` Vitest project, `tools/**/*.test.ts`): the
  pairings, fills and the seed schedule, the cell plan (a six-name kit list
  gives 15 pairings and 60 cells with 4 and 12 fills, played by nothing),
  `playMatch` against a reference loop, the aggregation and the report text, the
  one-mode `--check` on synthetic blocks, and the CLI's flags. They run in
  `npm run test` with the other projects and play 1 or 2 seeds, not the full
  report; only the CLI row plays six-kit cells (120 matches, one seed of the 2v2
  mode, 6.6 s locally and 23.6 s on the runner, timeout 60 s, unit job
  122091170207), the 3v3 success path is a 24-match row on the four v1 kits
  (3.3 s locally and 8.2 s on the runner, timeout 20 s; the CLI's 3v3 row at six
  kits is 360 matches, 34 s locally and projected at about 75 s on a runner, so
  it was replaced, not given a longer timeout). The CLI's error rows pin the
  message of each rule, so a parser that rejects `--mode 3v3` fails them. Two
  smoke rows play Brimwick v Ondrel at seed 1, one match a mode, to a decision.
  One `playMatch` row plays the match of #123 (Quillon v Skerrow, 3v3, arena01,
  seed 6) and asserts that it ends in a decision, with no end tick. The same
  project holds the fixture search's tests (`tools/fixtures/*.test.ts`): the
  format against the committed bytes, the pure search cases, the reproduction of
  the seven roster fixtures and the CLI (see [Fixture search](#fixture-search)).
- Protocol tests (the `protocol` Vitest project, `packages/protocol/test`): the
  round trips and one golden text of all sixteen messages, the key-order and
  stray-field tests, a reject table with the edge pair of every bound, and a
  3v3 on arena02 whose snapshots, spliced and decoded, rebuild to the live
  `checksum` (with checks that it saw a projectile, an area, a status, and
  snapshot ticks with and without events). See [online](online.md).
- Server tests (the `server` Vitest project, `packages/server/test`): the
  input queue, the step clock and the data loader, the lobby rules as pure
  functions, the Room's lobby and loop rows, the bad-message counter, the
  two-way `Difficulty` check (its compile-time rows are checked by
  `tsc -p tsconfig.tools.json`, since Vitest does not typecheck) and the
  loopback test: a 2v2 on arena01 and a 3v3 on arena02 through the codec, with a
  checksum match at every snapshot, complete event batches, a local run of the
  same seed and inputs that reaches the server's checksum at every tick (and a
  run at another tier that does not), and a sha256 over every text in both
  directions that is the same across two runs. It pins no end tick, winner or
  champion list. It plays to two rounds won, not three, and took about 5.5 s
  locally and 11.5 s on the runner (job 121656797139, de0ef18) before
  Durnhal's file; with it the file takes 8.8 to 9.1 s locally (5.1 to 5.6 s on
  the same machine without it) and 17.0 to 32.6 s on the runner (jobs
  122173425469, 122175440820, 122182006132 and 122189679246, see the timeouts
  above); at
  three rounds it took 14 s locally and 29 s on the runner (job 121633905207).
  See [online](online.md).
- E2e tests (Playwright, `e2e/*.spec.ts`): the client loads, renders the arena
  and responds to input; each spec writes its screenshots to the test output
  for human review (the live probe spec has no picture).
- Asset validation: `validate_glb.py` over `assets/models/`. See
  [assets](assets.md).
- Strict TypeScript, ESLint with the dependency-boundary rule. See
  [packages](packages.md).

## Balance reproduction

`npm run balance` plays all 11 760 matches of the report in
[balance.md](../design/balance.md) and writes its block; `-- --check`
regenerates the block in memory and exits 1 when it differs from the committed
one (the head line is not compared), `-- --out <file>` writes the block to a
file and `-- --seeds N` plays the seeds 1 to N in every mode played, instead of
the schedule (about 200 matches a cell: seeds 1 to the largest even number at or
under 200 over the cell's fills, per mode). `-- --mode 2v2|3v3` plays one mode;
it needs `--out` or `--check`, and with `--check` compares that mode's cell rows
and budget-hit lines only. It needs Node 22.15 or later, for
`module.registerHooks` (see `tools/balance/register.ts`), which is why the
`engines` field of `package.json` reads `^22.15.0 || >=24`. It is not in
`npm run check`: a full run plays 11 760 matches and takes about 14 minutes on
Apple silicon. It plays the six kits of `HARNESS_KITS` in
`tools/balance/inputs.ts` (six of the seven files of `data/kits`, so a kit added
to the directory joins the report by being listed there; Durnhal's file is not
until step 1.3).

`.github/workflows/balance.yml` runs `npm run balance -- --check --mode <mode>`
on a runner, one job per mode (`workflow_dispatch` only, so it never runs on a
pull request or a push). It can be dispatched with
`gh workflow run balance.yml --ref <branch>` once the file is on the default
branch. The whole run was 12 to 16 minutes at four kits; at six kits it is about
14 minutes locally (2v2 5.3, 3v3 8.9) and projects to about 16 (2v2) and 27
(3v3) on a runner, so the jobs have `timeout-minutes` of 45 and 75, twice the
projected check time (the failure step plays the mode again) and a margin. The
seeds are never lowered to fit the runner. The runs on record are in
[balance.md](../design/balance.md#7-how-to-regenerate).

## Fixture search

`npm run fixtures:search -- <kit> [--out <file>] [--max-attempts N]` searches
the scripted roster fixture of `data/kits/<kit>.json` and writes it to
`packages/sim/test/fixtures/scripted-roster-<kit>-arena01-2v2.json` (or to
`--out`), byte for byte in the layout of the committed files. It needs Node
22.15 or later, like `npm run balance`, and takes well under a second for a
short search (about 10 to 20 ms per attempt and 0.3 s for the replay; the
default limit of 1000 attempts is 10 to 20 s). The code is `tools/fixtures/`;
the format, the replay loop, the coverage items and the oracle wiring are
`packages/sim/test/roster-fixture.ts`, shared with
`roster-fixtures.test.ts`, so the search and the test have one definition of
each (see [packages](packages.md)).

What it does:

- It plays attempts 1, 2, 3 and so on of the seeded random player the header of
  `roster-fixtures.test.ts` records (mulberry32 seeded with the attempt number,
  2400 ticks on arena01 in the 2v2 mirror of the kit, the match seed of
  `SEEDS`), and stops at the first attempt that misses nothing of `EXPECTED`.
- It replays that attempt with the shared loop, under the ability oracle, for
  the checkpoints at every 100 ticks and the final checksum, which are the
  values the test compares, and writes the file.
- It exits 1 and writes nothing when that attempt has an oracle problem (it is
  named, and no later attempt is tried: a drop, not a skip), when no attempt
  within `--max-attempts` covers everything (the message names the attempt that
  missed the fewest items and those items), when the kit has no
  `data/kits/<kit>.json`, no `EXPECTED` entry or no `SEEDS` entry, and on bad
  arguments. The wall time goes to stdout only.
- Its player uses exact operations only, as the fixtures must be the same on
  every platform: no `Math.hypot` and no transcendental function. The tools lint
  does not ban them, so review enforces it.

`tools/fixtures/reproduce.test.ts` runs the search on the seven committed
fixtures and compares the bytes: Hargrim's attempt 1, Quillon's attempt 23,
Ondrel's attempt 2, Brimwick's attempt 10 and Durnhal's attempt 2 on the current
kits, and Skerrow's attempt 6 and Lumeth's attempt 2 on the kits they were
searched on (the Rend damage 20 and the Binding Sigil radius 1.5 put back in
memory, as #125 changed those numbers and regenerated only the checkpoints),
with the checkpoints of the current kits. Each row of the test names the kit
numbers it is pinned on, with the change that moved them. It runs on the CI
unit job, on Linux x86, which is the cross-platform proof of the tool. The
record is in the header of `roster-fixtures.test.ts`.

A change to a kit file that turns the coverage red is met by rebuilding its
fixture with the tool in the same commit ([balance.md](../design/balance.md),
section 6.3); a change that keeps the coverage green regenerates only the
checksums, by the method of the test's header. A rebuilt fixture is a new
script, so its replay checksums are new: its pull request replays
`roster-fixtures.test.ts` in a `linux/amd64` container (see
[Cross-platform determinism](#cross-platform-determinism)) before it goes
ready.

A kit change also touches the kit's row in `reproduce.test.ts` and its attempt
record in the header of `roster-fixtures.test.ts`, and a red row is not a
failed pre-check (decision 13 of batch #134):

- After a rebuild, the row's attempt is the one the tool printed, its kit is the
  current one (no pins), and the header records the attempt.
- After a coverage-green change, the committed script stays the one searched on
  the kit before the change, so the row is pinned on the kit as searched: add a
  pin that puts the old number back in memory, with a comment naming the change,
  and let the header say which kit numbers the search ran on. The search on the
  current kit may settle on another attempt without any rebuild (after #125,
  Skerrow on 2 and Lumeth on 5, and Lumeth on 6 after #191, whose self-cast
  rule moved only her checkpoints and checksum).

A new kit, the recipe (batch 12 followed it for Ondrel and Brimwick, #148, and
batch 16 for Durnhal, #204):

1. Add `data/kits/<id>.json`.
2. Add its entries to `EXPECTED` (what its fixture must show: the casts, the
   energy gains, the dash `then`s and the statuses) and to `SEEDS` (the next
   match seed, 5562 and up) in `packages/sim/test/roster-fixture.ts`. The tool
   stops with a message that names the file when either is missing.
3. Run `npm run fixtures:search -- <id>`. When no attempt within the limit
   covers, the kit's `EXPECTED` asks for something a mirror may never show:
   read the items the message names.
4. Add the fixture's JSON import, the kit's JSON import and a `SUBJECTS` row to
   `roster-fixtures.test.ts`, and the kit's attempt and match seed to its
   header; add the kit to `tools/fixtures/reproduce.test.ts` and to the
   `KITS` of `tools/fixtures/format.test.ts`.
5. Replay `roster-fixtures.test.ts` and `roster-kits.test.ts` and then
   `reproduce.test.ts` and `format.test.ts` in a `linux/amd64` container, as
   above, and apply the timeout rule of the check suite to a reproduce row whose
   runner time passes 2.5 s. The rows of Ondrel (attempt 2), Brimwick (attempt
   10) and Durnhal (attempt 2) took 1.23, 0.84 and 0.68 s on the runner (0.36,
   0.32 and 0.28 s locally), so they have no timeout of their own.

## Playwright e2e

The specs are in `e2e/*.spec.ts`. They run against the Vite dev server, which
Playwright starts itself, on port 5173 or on `CLAUDELINE_PORT` when it is set.

A bare `/` opens the pre-match select, not a match (see
[client](client.md#pre-match-select)). A spec that wants the default match
enters on `DEFAULT_MATCH` of `e2e/support.ts`,
`/?champion=hargrim&difficulty=normal&arena=arena01&teamsize=2`, the address
Start writes for the defaults. Its launch is the one of the old bare `/`, so the
match, the bots, the seeds and the ticks are the same. Only `select.spec.ts`
enters on a bare `/`, through a constant, so a grep for `goto('/')` finds no
other spec.

- `select.spec.ts`: the pre-match select (`select.png`, at 1280x720). On `/` the
  panel shows and no canvas exists; the champion row is the six roster ids in
  order, all available, with Hargrim, arena01, 2v2 and normal current and the
  Start href the default setup. Picking Quillon, arena02, 3v3 and Hard updates
  each `data-current`, leaves the address search empty and makes the Start href
  `?champion=quillon&difficulty=hard&arena=arena02&teamsize=3`. Start plays it:
  `canvas[data-arena="arena02"][data-tick]` appears, the search equals the href,
  health reads 120 / 120, `data-bar5` exists, `#select` is empty, and the
  result panel's and the menu's rows read hard, arena02 and 3v3 as current with
  links that carry them. `page.reload()` goes straight into the same match, and
  `/?champion=quillon` and `/?difficulty=brutal` show no panel and a canvas
  while `/?foo=1` shows the panel. A keyboard pick (focus an entry, press
  Enter), on Quillon and then on Hard, leaves the focus on the rebuilt entry,
  now current, and the address search stays empty.
- `arena.spec.ts`: the arena and the F3 overlay render (`arena.png`,
  `arena-overlay.png`), and `data-arena` is set only after the first draw.
- `scene.spec.ts`: the default match's HUD (`scene.png`): health, the round
  timer against the tick, the hidden result panel with its champion, arena and
  team select (every href writes `teamsize`, with 2v2 current), and the launch
  address `?champion=quillon`. Two rows next to it, `?champion=ondrel` and
  `?champion=brimwick`, read health 130 / 130 and 120 / 120, the scoreboard's
  row 0 name (built hidden at startup, so readable without Tab) as Ondrel and
  Brimwick, and the champion glbs the page requests (collected with
  `page.on('request')` before `goto`) as the pick's own, Quillon's and
  Hargrim's, with no `placeholder.glb`; they are red when the roster has no
  such id, and a missing clip is a page error at load. A row on `/?arena=arena02` (`scene-arena02.png`)
  checks `data-arena` and the human's position, (-1100, 200), which proves the
  sim got arena02 and not only the hook, and the arena links. A row on
  `/?teamsize=3` reads `data-bar0` to `data-bar5` at 100 and no `data-bar6`, the
  human at (-1200, 200), 3v3 current and the links carrying `teamsize=3`. The
  default test also reads the difficulty row (easy, normal and hard, normal
  current, the three hrefs written out). A row on
  `/?champion=quillon&difficulty=hard&arena=arena02&teamsize=3` has hard current
  and every link of the other three rows carrying `difficulty=hard` (ten links:
  six champions, two arenas, two team sizes), and `/?difficulty=brutal` reads
  normal as current. The default test lists eight `data-hud` elements (the
  eighth is `scoreboard`, hidden and not displayed) and reads
  `data-silenced="false"` on all seven slots, while only F reads
  `data-blocked="true"`: the silence flag is not the energy gate.
- `hud.spec.ts`: the shield, the scoreboard and the silence flag, on the
  sandbox (`/?scene=sandbox`) with a paused clock and tick budgets, like
  `combat.spec.ts` (`scoreboard.png`, at 1280x720). At the start the
  scoreboard is hidden and not displayed, with the header (Champion, K, D) and
  four rows in id order (Hargrim, Quillon ally; Lumeth, Skerrow enemy), all
  alive at 0 and 0; the shield is hidden at 0 absorb and every slot reads
  `data-silenced="false"`. F4 shots kill Lumeth; KeyR shows the shield with
  `data-absorb="40"`, and the bounding boxes read its fill at 0.25 of the
  health track's width and its left edge at 0.75 of it. Holding Tab shows the
  scoreboard with Hargrim at 1 and 0, Lumeth dead at 0 and 1 and the others
  alive at 0 and 0, and takes the picture; releasing it hides it. After the
  shield's 240 ticks it is hidden at 0 again. There are no pixel counts, so a
  change of the arena or the palette cannot move it. The silence is read false
  only: no champion of the sandbox silences the human (Skerrow, the only
  silencer, has no kit there), and the flag is shown in the headless scripted
  scene of `hud-scene.test.ts` on the real sim (a client unit test: R shows 40
  absorb, Skerrow's Quiet Dart takes 8 of it and silences all seven slots for
  its 90 ticks, a scripted kill counts on the scoreboard), decision 6 of batch
  #134. The test makes 18 hook reads and runs the flights and waits as batches
  of one `runFor`, and sets a 60 s timeout. It takes 5.1 s locally. On the
  runner a frame is 17 to 24 ms at the probe viewport (about 560 of them: the
  warmup, the 130 ticks of a shot's flight, the 240 of the shield and about 11
  read one by one) and 105 to 210 ms at 1280x720 (about 6), and a read costs 32
  to 75 ms, so the body takes about 17 s and the page load and the screenshot
  make it about 22 s. The timeout is more than twice that, as the rule asks.
- `lingering.spec.ts`: the first lingering area a match draws
  (`lingering.png`, at 1280x720), on `?champion=ondrel&difficulty=normal&arena=arena01&teamsize=2`
  with a paused clock and tick budgets, like `hud.spec.ts`. After the warmup,
  KeyQ (Reed Fence, an 18 tick windup, a keyboard cast so no pointer is
  derived) reads `data-anim0` Idle+Cast within 3 ticks of the press and
  `data-areas` 1, not 2 (the one-hit circle of the same cast lasts a tick and
  never reaches a view), at a read inside the 120 ticks and ten ticks before
  their end, and 0 within 20 ticks of it. The picture is one frame at 1280x720
  while the fence is down; no pixel counts. The units behind it are
  `entity-views-lingering.test.ts`, which plays each of Ondrel's lingering
  paths on the real sim. The test runs about 360 frames at 17 to 24 ms
  (320x180) and 2 at 105 to 210 ms, about 50 reads at 32 to 75 ms, so the body
  takes about 9 to 13 s and the test about 15 s with the load; the 45 s
  timeout is more than twice that. It does not use `__runProbeFrames`.
- `self-cast.spec.ts`: the held C key (no screenshot), on
  `?champion=lumeth&difficulty=normal&arena=arena01&teamsize=2` with a paused
  clock and tick budgets, like `lingering.spec.ts`. With the cursor at the
  canvas centre (about 12 m from her), C and M1 read the `data-windup` of the
  slot true and then false (the cast fired) with `data-projectiles` 0 at the
  fire tick and four ticks after, and the slot not ready; the same for M2
  (Soothing Surge, an 18 tick windup); C and R show the shield at absorb 30;
  after C is released M1 reads ready again and the next cast reads
  `data-projectiles` 1 or more, which shows that the aim returned to the
  cursor. The page exposes no sim events, so the landing itself (no
  `projectileSpawned`, the heals of 6, 8.4 and 13.2, the hot, the shield, and
  the EX with its 25 energy, which only hits on bots earn) is asserted by
  `packages/client/src/self-cast-scene.test.ts` on the real sim; the e2e leaves
  the EX out so that it does not depend on bot behaviour. Bot projectiles also
  count in `data-projectiles`: the first one of this match is 79 ticks into the
  round with an idle human (measured), and the spec fails with that reason if a
  read of 0 comes within 20 ticks of it (the last one is 35 ticks in). The
  test runs about 250 frames at 17 to 24 ms (320x180) and about 70 reads at 32
  to 75 ms, so the body takes about 6 to 11 s and the test about 15 s with the
  load on the runner (2.0 to 2.7 s locally); the 45 s timeout is more than
  twice that. The once-per-step mapping of `main.ts` is not pinned here (see
  client.md, Input).
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
- `live-probe.spec.ts`: the heap probe's second scene, the default match
  (`DEFAULT_MATCH`) at time scale 1 with a pointer that moves before every
  window, no picture (see the heap probe below). It also reads the clips of the
  match: `data-anim0` starts with Run at every measured read (the human walks,
  with M1 held), a bot reads Cast and a champion reads Hit in some read, and the
  victim of the measured round's first death reads Death. The reads are the same on
  every attempt, since the bots are deterministic and the hook paces the windows
  (on the bots of #213, round 4 at ticks 9089 to 9239): a bot reads Attack from the
  first read (tick 9089), Cast from 9119, and Hit comes at 9239 (Idle+Hit); on the
  bots of #137, round 3 at 4349 to 4499: Cast from the first read, Attack from
  4439 and Hit at 4469.
- `match.spec.ts`: the first round of the default match against bots, once per
  arena and team size (`match.png`, and `match-arena02.png` for
  `/?arena=arena02`; `match-3v3.png` and `match-3v3-arena02.png` for the same
  addresses with `teamsize=3`): input, one bar hook per champion (four, or six
  in a 3v3), a projectile and a hit within tick budgets, the timer and the
  hidden result panel. It asserts budgets only, never an exact tick, because
  any bots change can move the ticks: the 3v3 rows log the headless ticks next
  to the ones they read (projectile 267 and 271, hit 290 and 319, with a Lumeth
  on each team, as before the dodge; 267 and 275, 301 and 307 with two
  Quillons a side) and assert
  the budgets of the 2v2 rows.
- `match-end.spec.ts`: tests on the dev-only time scale `?timescale=100`
  (client.md, Launch and match), on a paused clock in frames of 16 ms that run
  96 ticks each, read every 5 frames at 320x180. One plays the default match
  with an idle human to its result screen (`result.png`), once per arena
  (`/?arena=arena02&timescale=100` for arena02) and team size (`teamsize=3` for
  the 3v3 rows), within a budget of ticks and frames per row: 15 000 and 182 on
  arena01 (`ceil(15000 / 96) + 25`; it ends at tick 5664 in the e2e and 5476 in
  a headless run, a Defeat 1 : 3, on the bots of #213), 15 000 and 182 on arena02
  (tick 5381 headless and 5664 in the e2e, a Defeat 1 : 3), and 24 000 and 275 on the
  3v3 of arena01 (it ends at tick 10 470 headless and 10 944 in the e2e, a Victory
  3 : 2) and 25 000 and 286 on the 3v3 of arena02 (tick 11 903 headless and
  11 904 in the e2e, a Defeat 2 : 3). On the bots of #137 the rows were 14 000 and
  171 (5184 in the e2e, 4936 headless), 22 000 and 255 (12 384 and 12 191), 19 000
  and 223 (6144 and 5774, a Defeat 0 : 3) and 29 000 and 328 (16 224 and 15 773). A headless run through the client's setup
  and driver gives each row's tick, in `match-setup.test.ts`. The budget is
  that tick plus two rounds of about 1000 and one round to sudden death of about
  7000, rounded up to 1000, and the frames are ceil(ticks / 96) + 25. The 3v3
  rounds run longer, so their rows use 2900 for a round (the longest measured is
  2801, with a Lumeth on each team and the dodge, not measured again at #213; it was
  1954 before the dodge and 1557 with two Quillons a side). Each row logs its wall time, and a row
  over 40 s gets its own timeout. The test follows the Quillon link of the
  result panel, which keeps the arena and the team size. The arena01 2v2 row
  also holds Tab at the match end: the scoreboard shows over the result panel,
  its deaths column sums to `data-deaths` (every death counts for its victim),
  its kills column is at most that (a ring death credits no kill), and
  releasing Tab hides it. The other plays the
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

- Run them with `CI=1`. Without it Playwright reuses whatever listens on the
  port, which can be a sibling session's dev server serving other code. With
  `CI=1` it always starts its own, and fails with "already used" when something
  holds the port. `npm run check` does not set it (its last step is
  `npm run e2e`, which is plain `playwright test`), so run `CI=1 npm run check`.
  CI sets it itself.
- The port is `CLAUDELINE_PORT`, default 5173. It sets Vite's port, `baseURL`
  and `webServer.url` together, read and validated by `e2e/port.ts`: a plain
  decimal from 1024 to 65535, and any other value, an empty one included, stops
  with an error that names it. A session that runs beside others picks a port
  no other session uses. The lanes plan's convention is 6 followed by the issue
  number, so 6172 for #172, and it runs `CLAUDELINE_PORT=6172 CI=1 npm run check`.
  Two checkouts on two ports run the suite at once. CI never sets the variable,
  so it runs on 5173. The heap probe keys scripts by path, not by origin, so its
  figures do not depend on the port.
- A port already in use says nothing about the code. When the holder serves
  the page, Playwright fails at once with "already used". When a holder on
  127.0.0.1 answers anything else or drops the connection, Vite's strictPort
  error ("Port <port> is already in use") fails the run at once. A holder that
  accepts the connection and never answers stalls the run before any spec
  starts, with no error. In each case `lsof -nP -iTCP:<port> -sTCP:LISTEN`
  names the holder; pick another port.
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
- The live scene is the default match, entered on `DEFAULT_MATCH` (a bare `/`
  opens the select), at time scale 1, where the hooks and the HUD change in
  every window (the human's `data-p0x` and `data-f0` on every tick, projectiles,
  hits and bars as the bots fight) and a pointer moves before every window. It
  is the scene that counts the table-driven change writes and the pointer aim
  with real changes. The clock is paused before the page loads and never runs a
  frame, so the first read is tick 0 and every tick is the hook's. The warm-up
  is plain windows with no profiler from tick 0 to the first round that begins
  after tick 8000 (round 4, begun by tick 8969 on the bots of #213 on every run
  so far: the bots are deterministic; it was tick 2100 and round 3, begun by tick
  4289, on the bots of #137), then 4 plain windows of the round (the lead, 120
  ticks), then the next 5 windows are measured, ticks 9089 to 9239. The figures
  that follow are those of round 3 on the bots of #137 (the warm-up and the
  lead of 2 windows, ticks 4349 to 4499), kept as the derivation of the lead; the
  #213 paragraph below says what moved them. The
  lead is derived from three 17-window runs of round 3 with the pointer on the
  bots of #137, all three identical: the first projectile spawns in window 2
  (ticks 4349 to 4379), the first hits land in window 4 (three at once), and
  then 0 to 2 hits land per window (window 6 reads none) and 0 to 2 projectiles
  are live at the reads to the end of the run (tick 4799), with the first death
  of the round read at tick 4859. The lead is 2, the first-projectile window, as
  #97 derived it (decision 9 of batch #134); it was 4 with the first projectile
  in window 4 before the dodge (round 3 begun by tick 2609, windows 2729 to
  2879, first death at 3419) and 5 before the dash hold of #98 (round 3 by tick
  2879, first death at 3539). The margin after the last measured window is 360
  ticks (the floor is 60; 300 on the bots of #213). The human walks W and D in the first window, then A
  and D in turn at y of about 3.9 m, west of the block at x = -8, with M1 held;
  Hargrim's M1 windup is `slowed`, so the walk goes on under the cast.
- The live scene on the bots of #213 (a melee champion stands inside its reach).
  The first two rounds now run until tick 7529, not 4289, so round 3 is no longer
  the measured round: on the old constants (warm-up 2100, lead 2, windows 2 to 6
  of round 3) the counted code of the windows reads 3252 to 3456 B (`writeHooks`
  about 2.5 KB, `hud.ts:updateHealth` 0.3 KB), over the limit of 780 B, in two
  runs; main's bots on the same machine read a median of 456 B in round 3 at tick
  4289. Moving the lead inside round 3 does not help: leads 2 and 3 read a median of
  2448 to 3456 B of counted code (the windows read 2.4 to 3.8 KB each), leads 4, 5 and 6 read a bots median of 42 284, 45 920
  and 46 152 B (the follower's `splitPath`, over the limit of 18 000 B), and with
  lead 10 no projectile is live. Round 4 (begun by tick 8969, after a warm-up to
  tick 8000, budget 15 000) is clean from its first window: lead 4, windows 4 to
  8, ticks 9089 to 9239, counted code 276 to 660 B in every window and the bots
  2.5 to 10.5 KB (the same in 3 of 3 attempts to within a few bytes), a projectile live in every window, the first death
  read at tick 9539 (margin 300). Leads 1, 2 and 3 pass the byte limits but fail
  the assertion that a champion is staggered by a hit in a measured read, so the
  lead is 4. A live attempt is about 9600 frames, so the test timeout went from
  180 s to 360 s (it was about 2x the runner's time at 4900 frames; it would be
  about 1.05x at 9600). Scratch measurements on 3 runs of the final constants
  with `--repeat-each=3` (2.2 min locally with other jobs running), and the
  variants above in a scratch copy of the tree; the match-end rows moved with
  the rest of the cascade (see match-end.spec.ts above).
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
  aim (`camera.ts`), the HUD writer and its views, the scoreboard writer
  (`scoreboard.ts`; its DOM module `scoreboard-dom.ts`, with the Tab listener,
  is event code and is not counted), the kill feed, the champion names, the
  result screen's writer (`result-screen.ts`), the text tables of the hooks and
  the HUD (`hook-text.ts`), the client's bot-driving glue
  (`bot-driver.ts`), the sound (`audio.ts`: `routeSounds` and `play` run on
  every step's events, and both probe specs unlock the audio with a real
  gesture before the first measured window, so the counted calls reach real
  Web Audio), the champions' clips (`champion-anim.ts`, the state machine, and
  `clip-sampler.ts`, which poses the bones: both run for every champion in every
  frame) and everything in `main.ts`, including the hook's `frameMany` and the
  one `opensSelect` call of its module evaluation. The pre-match select
  (`select-dom.ts`, with `launch.ts` and `result-dom.ts`, uncounted builders
  like `hud-dom.ts`) never runs in a frame and never runs in either probe, since
  both addresses carry a key, so `COMBAT_CODE` has no entry for it.
  Three's `onAnimationFrame` is logged and not counted: no frame
  of a measured window runs through it. A new module on the frame path goes
  into the pattern. The bots package is not counted, and its bytes are the
  sixth figure of the probe line; the live scene bounds them apart: the median
  of the five measured windows' bots figures (not the bots figure of the
  window that is the median by counted bytes) must be at most
  `LIVE_BOTS_LIMIT_BYTES`, 18 000 B (`heap-probe.ts` has the figures, and
  bots.md, Allocation, In the browser, the causes). The bytes in a browser
  window were: 0.6 to 0.9 KB per window in the sandbox (`bot.ts:move` of its
  one bot, not asserted; `rng.ts:next` is gone since #108), and in the live
  scene's measured windows on bc1d6f1 25 to 131 KB per window on the runner, a
  median window of 52 and 40 KB in two jobs (39 to 44 KB over 15 local
  attempts): the garbage of the plan search, about 53 KB a plan, and the calls
  V8's Maglev tier boxes, `Number.isFinite` and `hypot2` among them (bots.md).
  After the fixes of #93 the median window read 3.2 to 4.0 KB locally (windows
  of about 6.1, 10.8, 2.6, 3.7 and 1.6 KB) and 3588, 3912 and 3756 B in the
  three runner jobs on 04be0f9, on windows 5 to 9 of round 3. The dash hold of
  #98 moved the measured windows to windows 4 to 8 of a round 3 that begins at
  tick 2609, and there the median window reads 6404 to 7996 B over 15 local
  attempts, 6952, 7348 and 7200 B in three runner jobs on 4ea802d and up to
  7568 B in the tester's twelve attempts (main's bots read 5744 to 6416 B
  there). The dodge of #137 moved the round to begin at tick 4289, and the lead
  of 2 puts the measured windows at windows 2 to 6 (ticks 4349 to 4499), the
  first plans of the chase: the median window reads 8908 to 11 980 B over 15
  local attempts, the top three (11 720 to 11 980 B) with one interpreted call
  of 2.5 to 2.9 KB in window 3 (the windows 17.5 to 20.6 KB, 8.9 to 11.9 KB, 1.0
  to 1.4 KB, 12.6 to 13.3 KB and 3.7 to 4.0 KB). Windows 2 and 3 are the
  follower's plans by function (`splitPath` 13.3 to 13.9 KB and 6.4 to 6.7 KB),
  mostly the cold plans of the chase: with the dodge off (a different match,
  round 3 by tick 2609) they read 14.5 and 14.6 KB against 17.5 to 20.6 KB and
  8.9 to 11.9 KB here, and a replan after a sidestep lands in `follow.ts` too.
  The limit is now 18 000 B: 50 percent above the largest clean median, 11 980
  B (17 970, rounded up to 100; it was 12 000 B, 50 percent above #98's
  7996 B), the same rule, with the three attempts that have one interpreted
  call counted clean (decision 12 of #91). The 15 medians are 8908, 9012, 9056,
  9056, 9200, 9296, 9296, 9368, 9388, 9416, 9480, 9484, 11 720, 11 844 and
  11 980 B. At the merge the rule is applied again over every source (the
  decision 18 addendum of #91). It is under
  a quarter of the smallest median with the fixes reverted (208.2 KB on these
  windows, 61.9 KB on #98's, 38.9 KB on the old ones), which fails the bound in
  every attempt (3 of 3 local on these windows). It does not catch one reverted
  fix alone (`aim`'s 1.2 KB leaves the median under the bound). A runner median
  above the limit reopens it. The windows after a round starts are
  not asserted: megabytes before the fixes, 0.04 to 0.72 MB in the first window
  of a round after them, locally (bots.md). `summarise` gives the bots' files
  the prefix `bots/`, as it gives the sim's `sim/`, so a bots file such as
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
  | template per `Scoreboard.update` | `scoreboard.ts:update`, first line | `` (globalThis as unknown as { __s?: unknown }).__s = `s${(state as unknown as { tick: number }).tick}`; `` | 1124 to 1320 | 1260 to 1368 |

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

  The row of #138 and two reruns, each applied alone on b44efbd (the PR
  rebased onto the bots dodge of #137, d3c0902) with 3 attempts per scene: the
  template per `Scoreboard.update` fails 6 of 6 (`scoreboard.ts:update` at 684
  to 896 B a window), the template per `Hud.update` reruns red 6 of 6 (sandbox
  1096 to 1284 B, live 1276 to 1488 B; `hud.ts:update` at 764 to 984 B) and so
  does the closure in `routeEvents` (1680 to 1720 B and 1752 to 1768 B;
  `feedback.ts:routeEvents` at 1256 to 1372 B). The clean medians of the same
  code are 300 to 564 B on the sandbox (the 564 B is explained below, at
  the medians of the local runs) and 408 to 564 B on the live scene (bots
  8992 to 11 776 B; the ranges widened to main's spread, measured in the #150
  runs on 97a12af and e036f5a, named below).

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
- The lingering-area path runs in neither scene: the sandbox is Hargrim and
  Quillon against Lumeth and Skerrow with only the Hargrim and Quillon kits,
  and the live probe is `DEFAULT_MATCH` on `ENEMY_ROSTER`, so neither plays an
  Ondrel and no area outlives its tick in a measured window. Neither scene
  changed with the roster at six (batch #177, package C): the live round 3 still
  begins by tick 4289 and the windows stay at 4349 to 4499 (until #213: the measured round
  is round 4, windows 9089 to 9239, see the live scene on the bots of #213 above). A live area slot
  runs the capture, sync, find and draw code the projectile views run in both
  scenes (`entity-views.ts:draw` and `find` read 0 B there), and the pool grows
  only past 16 slots, which Ondrel's at most five areas never reach. `roster.ts`
  runs only when the HUD and the scoreboard are built. Scratch check, nothing
  committed, `combat.spec.ts` and `live-probe.spec.ts` with `--repeat-each=3`
  in three separate runs: the counted medians are 360 to 432 B on the sandbox
  (limit 600) and 408 to 552 B on the live scene (limit 780), the live bots
  8984 to 11 788 B (limit 18 000), and neither `roster.ts` nor
  `entity-views.ts:draw` or `find` appears among the per-window functions.
- The shield branch and the silence branch run in neither scene (the human of
  both casts no R, and no champion there silences it), and neither is added to
  `combat.spec` or `live-probe.spec`, which would move the documented scenes.
  The scan of the statuses runs in every frame of both. The shield is checked
  once by hand, with a copy of `combat.spec.ts` that holds KeyR in the first
  warm-up volley and again before the measured volley, so the shield
  (`data-absorb="40"`) shows at the start and at the end of the five windows.
  The copy is never committed. In 3 attempts a `Float64Array` sum in
  `readShieldView` read 636 to 936 B a window in `hud-views.ts:readShieldView`:
  the function is called once per frame, so it is still in the lower tiers,
  where a loaded or added double boxes. With an `Int32Array` sum of per-shield
  ceilings the shield readers (`readShieldView` and `readSlotViews`) read 0 B in
  all 15 windows (counted medians 408 to 504 B); `hud.ts` as a whole does not
  always, since one-off blips in `updateRound` and `updateEnergy` also occur on
  the unmodified spec. The live scene showed `readSlotViews` and
  `readShieldView` at 48 to 480 B a window before `primeStatusReads` (client.md,
  the frame path); with it they read 0 B in 3 attempts. The change writes (the
  shield's start and width, the silenced flag) are on review, like the other
  per-change writes. The medians of the local `--repeat-each=3` runs on b44efbd
  (the rebased head) are 300 to 564 B on the sandbox (limit 600; 348 to 480 B in
  a further six) and 456 to 468 B on the live scene (limit 780), the live bots
  11 344 to 11 776 B (limit 18 000, at the lead of 2 of #137). The 564 B is
  not #138 code: the windows of that attempt read 768 B (the window-0
  acquire), 456, 564, 324 and 1248 B, the 1248 B window holding a one-off
  `loop.ts:advance` read of 864 B, so the median lands on a window that has
  only `frameMany` bytes, and 564 B is inside that function's range of 252 to
  588 B per window (the blind-mode bullet above). The live and bots ranges are
  widened from b44efbd's 456 to 468 B and 11 344 to 11 776 B to main's
  measured spread, live 408 to 564 B and bots 8992 to 11 776 B, the local
  medians of the #150 runs on 97a12af (live 468 to 528 B, bots 9208 to
  11 676 B) and on e036f5a (live 408 to 564 B, bots 8992 to 11 672 B).
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
