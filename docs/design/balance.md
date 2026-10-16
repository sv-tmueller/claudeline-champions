# Balance: the bands and the baseline

## 1. Status and sources

Status: the harness and the baseline of batch #105 (issue #109). No kit number
has moved yet; the tuning pass is issue #121.

Sources:

- Decision 6 of batch #105 sets the band: 40 to 60 percent win rate per
  champion pairing, bot against bot at the normal tier over 100 seeds per
  pairing, on both arenas, in 2v2 and 3v3. A pairing outside the band gets a
  kit change inside the ranges of spec section 10 and
  [rules.md](rules.md) section 4.1, pinned by the roster tests with its fixture
  regenerated in the same change. A pairing left outside is named as accepted,
  with the reason.
- Decision 21 of batch #105 splits the work: #109 builds the harness, the
  baseline and this document; #121 changes numbers. It also fixes the fill, the
  sides, the seeds, and the runner described below.
- [roster-v1.md](roster-v1.md) holds the kits and the intended counters (the
  "Intended counters" lists); its section 6, "Balance notes", reads the
  baseline against them.
- [bots.md](../architecture/bots.md) holds the bots whose play is measured.

## 2. The bands

- A cell is one mode (2v2 or 3v3), one arena and one pairing, so there are
  24 cells with four kits and two arenas.
- The band is 40 to 60 percent inclusive on X's win rate in the cell. The test
  is on the exact rate (wins times 100 against 40 and 60 times the decided
  matches), not on the rounded figure in the table.
- X is the first kit of the pairing in the order of the kit files
  (`hargrim`, `lumeth`, `quillon`, `skerrow`). A rate under 50 means Y is
  ahead.
- A roster counter (an intended counter in roster-v1.md) is read as the
  favoured side inside the band: the favourite at 50 to 60 percent and the
  other side at 40 to 50. A favourite above 60 is too strong, and an
  underdog that is ahead by more than 60 is an inverted counter.

## 3. The method

- **Pairing.** An unordered pair X v Y of different kits over the files in
  `data/kits`, so six pairings with four kits. "Pairing" is read as the
  matchup of two champions, as decision 6 words it, and not as the duo of
  roster-v1.md section 5.
- **Fills.** Both teams get the same fill, so the pair is the only difference.
  In 2v2 the teams are [X, Z] v [Y, Z] for each Z outside the pair: two fills,
  pooled in the cell and each shown in the Fills column. In 3v3 they are
  [X, Z, W] v [Y, Z, W] for the two kits outside the pair, one fill, with Z and
  W in the order of the kit files. X takes the first spawn slot of its team.
- **Sides.** Odd seeds put X on team A and even seeds on team B, so each side
  gets half of the matches. The table shows X's wins as A and as B.
- **Seeds.** Seeds 1 to 100 for each config: 200 matches in a 2v2 cell and 100
  in a 3v3 cell, 3600 in all. The match seed is the seed and the bot of
  champion id `i` gets `seed * 100 + i`, the rule of the client's
  `bot-driver.ts`. The sim never draws from its own random state, so the bot
  seeds are the only source of variation.
- **Tier and rules.** Every bot is at the normal tier. The match is played to
  `DEFAULT_ROUNDS_TO_WIN` (3 rounds) with the kits read from the JSON as they
  are, and `createMatch` validates them.
- **Budget.** A match that has not ended after 60 000 ticks is a budget hit. It
  is left out of the rate, counted in the Budget hits column and listed under
  the table. The longest match of the baseline ended before tick 26 000.
- **Metrics.** Ticks count from the start of the round. Round mean and round
  longest are over the rounds that did not go to sudden death. Sudden-death
  rounds are shown as a count out of all rounds of the cell. First hit mean is
  the mean over the rounds that had one, where the first hit is the first
  `damage` of a champion to a champion of the other team (the ring does not
  count). A drawn round is one nobody won.
- **The bots.** The cells measure the kits as the bots play them, and the
  bots have limits (bots.md, "Not built yet" and "Never pressed"): no dodging;
  the nearest enemy is always the target; no Rally Cry; no EX variant of
  Lumeth's M2 and R; no 8 m leash and no M1 finisher for Lumeth; her heals
  count the instant part only; no Lunge away for Skerrow. A kit that is
  balanced for players may not be for these bots, and the reverse.
- **Noise.** A rate over `n` decided matches has a 95 percent interval of
  about 10 points at n = 100 (a 3v3 cell) and 7 points at n = 200 (a 2v2
  cell) around 50 percent. A cell within that distance of 40 or 60 cannot be
  told from the band by one run. Two measurements made once with scratch code
  that is not part of the tool (X's rate over 100 matches) show more than
  noise: the order of the fill in 3v3 changes the rate by up to 37 points,
  because it changes the spawn slots. Hargrim v Skerrow on arena02 with the
  fill [lumeth, quillon] gave 11 percent (seeds 1 to 100) and 12 (seeds 101
  to 200), and with [quillon, lumeth] 46 and 49. Seed sets alone move a cell
  by about 10 points: Lumeth v Quillon on arena02 with [hargrim, skerrow] gave
  29 and 18. The 3v3 verdicts are therefore for this order of the fill.
- **The tool.** `tools/balance` plays the matches with Node's own type
  stripping and a resolve hook (`register.ts`), with no dependency. The
  harness is `harness.ts`, the CLI is `run.ts`, and `harness.test.ts` pins the
  harness in the unit tests. The run is not part of `npm run check` or CI.

## 4. The baseline report

The block below is generated by `npm run balance`; do not edit it. The head
line names the commit the sources were read at.

<!-- balance:report -->
Generated by `npm run balance` from the sources at `d7847f1`.

Seeds 1 to 100 for each config, every bot at the normal tier. X's rate
is the share of the decided matches X won, in percent; the band is 40 to 60
inclusive, on the exact rate.
Cells in band: 1 of 24.

### Cells

| Mode | Arena | X v Y | Fills (X's rate) | Seeds / matches | X rate % | X wins as A | X wins as B | Verdict | Round mean | Round longest | Sudden-death rounds | First hit mean | Drawn rounds | Budget hits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2v2 | arena01 | hargrim v lumeth | quillon 0.0, skerrow 1.0 | 100 / 200 | 0.5 | 1/100 | 0/100 | outside | 858 | 4984 | 6 of 642 | 118 | 0 | 0 |
| 2v2 | arena01 | hargrim v quillon | lumeth 0.0, skerrow 0.0 | 100 / 200 | 0.0 | 0/100 | 0/100 | outside | 831 | 2829 | 0 of 627 | 122 | 0 | 0 |
| 2v2 | arena01 | hargrim v skerrow | lumeth 12.0, quillon 50.0 | 100 / 200 | 31.0 | 28/100 | 34/100 | outside | 1319 | 4826 | 12 of 831 | 117 | 9 | 0 |
| 2v2 | arena01 | lumeth v quillon | hargrim 61.0, skerrow 64.0 | 100 / 200 | 62.5 | 61/100 | 64/100 | outside | 1158 | 5271 | 7 of 817 | 131 | 1 | 0 |
| 2v2 | arena01 | lumeth v skerrow | hargrim 100.0, quillon 100.0 | 100 / 200 | 100.0 | 100/100 | 100/100 | outside | 840 | 1542 | 20 of 678 | 121 | 1 | 0 |
| 2v2 | arena01 | quillon v skerrow | hargrim 100.0, lumeth 100.0 | 100 / 200 | 100.0 | 100/100 | 100/100 | outside | 789 | 1934 | 1 of 684 | 135 | 0 | 0 |
| 2v2 | arena02 | hargrim v lumeth | quillon 4.0, skerrow 2.0 | 100 / 200 | 3.0 | 4/100 | 2/100 | outside | 919 | 3617 | 5 of 679 | 104 | 0 | 0 |
| 2v2 | arena02 | hargrim v quillon | lumeth 2.0, skerrow 0.0 | 100 / 200 | 1.0 | 0/100 | 2/100 | outside | 889 | 4372 | 9 of 654 | 111 | 1 | 0 |
| 2v2 | arena02 | hargrim v skerrow | lumeth 45.0, quillon 26.0 | 100 / 200 | 35.5 | 40/100 | 31/100 | outside | 1242 | 5375 | 14 of 801 | 106 | 4 | 0 |
| 2v2 | arena02 | lumeth v quillon | hargrim 4.0, skerrow 8.0 | 100 / 200 | 6.0 | 8/100 | 4/100 | outside | 878 | 4468 | 1 of 692 | 109 | 0 | 0 |
| 2v2 | arena02 | lumeth v skerrow | hargrim 98.0, quillon 93.0 | 100 / 200 | 95.5 | 98/100 | 93/100 | outside | 846 | 3647 | 3 of 688 | 104 | 4 | 0 |
| 2v2 | arena02 | quillon v skerrow | hargrim 100.0, lumeth 100.0 | 100 / 200 | 100.0 | 100/100 | 100/100 | outside | 805 | 5349 | 5 of 623 | 112 | 0 | 0 |
| 3v3 | arena01 | hargrim v lumeth | quillon+skerrow 0.0 | 100 / 100 | 0.0 | 0/50 | 0/50 | outside | 863 | 1555 | 0 of 301 | 116 | 0 | 0 |
| 3v3 | arena01 | hargrim v quillon | lumeth+skerrow 2.0 | 100 / 100 | 2.0 | 0/50 | 2/50 | outside | 1216 | 3486 | 2 of 370 | 116 | 0 | 0 |
| 3v3 | arena01 | hargrim v skerrow | lumeth+quillon 65.0 | 100 / 100 | 65.0 | 33/50 | 32/50 | outside | 1419 | 4458 | 9 of 419 | 116 | 0 | 0 |
| 3v3 | arena01 | lumeth v quillon | hargrim+skerrow 46.0 | 100 / 100 | 46.0 | 28/50 | 18/50 | in band | 1144 | 5184 | 25 of 388 | 136 | 0 | 0 |
| 3v3 | arena01 | lumeth v skerrow | hargrim+quillon 100.0 | 100 / 100 | 100.0 | 50/50 | 50/50 | outside | 1043 | 2563 | 2 of 316 | 121 | 0 | 0 |
| 3v3 | arena01 | quillon v skerrow | hargrim+lumeth 99.0 | 100 / 100 | 99.0 | 49/50 | 50/50 | outside | 1438 | 3901 | 9 of 319 | 140 | 0 | 0 |
| 3v3 | arena02 | hargrim v lumeth | quillon+skerrow 0.0 | 100 / 100 | 0.0 | 0/50 | 0/50 | outside | 949 | 2811 | 1 of 311 | 104 | 0 | 0 |
| 3v3 | arena02 | hargrim v quillon | lumeth+skerrow 0.0 | 100 / 100 | 0.0 | 0/50 | 0/50 | outside | 1233 | 4694 | 2 of 327 | 109 | 0 | 0 |
| 3v3 | arena02 | hargrim v skerrow | lumeth+quillon 11.0 | 100 / 100 | 11.0 | 4/50 | 7/50 | outside | 1360 | 3979 | 2 of 392 | 103 | 0 | 0 |
| 3v3 | arena02 | lumeth v quillon | hargrim+skerrow 29.0 | 100 / 100 | 29.0 | 17/50 | 12/50 | outside | 1121 | 5382 | 16 of 384 | 111 | 0 | 0 |
| 3v3 | arena02 | lumeth v skerrow | hargrim+quillon 98.0 | 100 / 100 | 98.0 | 50/50 | 48/50 | outside | 1030 | 2230 | 3 of 335 | 103 | 1 | 0 |
| 3v3 | arena02 | quillon v skerrow | hargrim+lumeth 89.0 | 100 / 100 | 89.0 | 47/50 | 42/50 | outside | 1527 | 3264 | 7 of 384 | 110 | 0 | 0 |

### Budget hits

No match hit the budget of 60000 ticks.

### Champions

Win rate in percent over the cells the champion is in, as X or as Y.

| Champion | 2v2 arena01 | 2v2 arena02 | 3v3 arena01 | 3v3 arena02 | All |
| --- | --- | --- | --- | --- | --- |
| hargrim | 10.5 | 13.2 | 22.3 | 3.7 | 12.2 |
| lumeth | 87.3 | 66.2 | 82.0 | 75.7 | 77.4 |
| quillon | 79.2 | 97.7 | 83.7 | 86.7 | 87.3 |
| skerrow | 23.0 | 23.0 | 12.0 | 34.0 | 23.0 |
<!-- /balance:report -->

## 5. The outside cells

The baseline has 23 cells outside the band and one inside. None is accepted
yet: #109 moves no number, so every outside cell stays as it is until the
tuning pass (#121), which changes a number inside the ranges of spec section
10 and rules.md section 4.1, or names the cell accepted with its reason. The
rates are X's, from the report above. "Intended" is the favourite of the
roster-v1.md counters. The reasons name the bots' limits that may account for
a reading; C1 did not measure how much each one counts.

Hargrim v Skerrow is within 9 points of the band in three of its four cells,
and Lumeth v Quillon has the one cell in band and one 2.5 points over. The
other four pairings are far outside in every cell: Hargrim v Lumeth and
Hargrim v Quillon at 3 percent or less for Hargrim, Lumeth v Skerrow and
Quillon v Skerrow at 89 percent or more for X.

### 5.1 Three counters point the wrong way

| Pairing | Intended | 2v2 arena01 | 2v2 arena02 | 3v3 arena01 | 3v3 arena02 | Reading |
|---------|----------|-------------|-------------|-------------|-------------|---------|
| Hargrim v Lumeth | Hargrim | 0.5 | 3.0 | 0.0 | 0.0 | Inverted in all four cells: Lumeth wins 97 to 100 percent. |
| Lumeth v Skerrow | Skerrow | 100.0 | 95.5 | 100.0 | 98.0 | Inverted in all four cells: Lumeth wins 95 to 100 percent. |
| Quillon v Skerrow | Skerrow | 100.0 | 100.0 | 99.0 | 89.0 | Inverted in all four cells: Quillon wins 89 to 100 percent. |

- **Hargrim v Lumeth.** The counter is Chain Hook, which pulls Lumeth 4 m
  closer and slows her. Limits that bear on it: nobody dodges, so Lumeth's
  bolts and heals always land; the target is the nearest enemy, so the hook
  goes where the targeting points and not always at Lumeth; Rally Cry is never
  pressed. A gap of 0 to 3 percent in all four cells is wide, and several
  numbers may be needed to close it.
- **Lumeth v Skerrow.** The counter is Quiet Dart, which silences every Lumeth
  ability, and a dive onto 120 health. Limits that bear on it: Skerrow's Lunge
  opener waits at 6 to 8 m for its opening and she has no Lunge away; Lumeth's
  Lantern Burst is pressed as an escape when an acted enemy is within 3 m,
  which pushes a diving Skerrow 2 m back whenever it is ready; nobody dodges.
- **Quillon v Skerrow.** The counter is Lunge, with the Quiet Dart silence on
  Skip. Limits that bear on it: nobody dodges, so Quillon's bolts hit an
  approaching Skerrow; the bot presses Quiet Dart only at a target with an
  escape ready; and Skerrow has no Lunge away.

### 5.2 A counter that points the right way and is too strong

| Pairing | Intended | 2v2 arena01 | 2v2 arena02 | 3v3 arena01 | 3v3 arena02 | Reading |
|---------|----------|-------------|-------------|-------------|-------------|---------|
| Hargrim v Quillon | Quillon | 0.0 | 1.0 | 2.0 | 0.0 | Quillon wins 98 to 100 percent: the favourite is far above 60. |

- **Hargrim v Quillon.** The counter is range: she holds him with Bind Shot
  and Snare Orb, and Skip answers his hook. Limits that bear on it: nobody
  dodges, so Hargrim walks into every bolt, and Rally Cry, his haste, is never
  pressed. Hargrim won 0 of 100 matches in two of the four cells.

### 5.3 Pairings with mixed readings

| Pairing | Intended | 2v2 arena01 | 2v2 arena02 | 3v3 arena01 | 3v3 arena02 | Reading |
|---------|----------|-------------|-------------|-------------|-------------|---------|
| Hargrim v Skerrow | Hargrim | 31.0 | 35.5 | 65.0 | 11.0 | Both 2v2 cells inverted, within 9 points of the band; 3v3 arena01 the right way, 5 over; 3v3 arena02 inverted, and 46 to 49 with the other fill order. |
| Lumeth v Quillon | Lumeth | 62.5 | 6.0 | 46.0 | 29.0 | 2v2 arena01 the right way, 2.5 over; 2v2 arena02 inverted (Quillon wins 94); 3v3 arena01 is the one cell in band, with Lumeth slightly behind; 3v3 arena02 inverted. |

- **Hargrim v Skerrow.** The counter is Iron Hide absorbing the opening Rend,
  the Ground Slam slow, and 160 health against 130. Limits that bear on it:
  Iron Hide is an escape slot for the bot, so it is not pressed against an
  opener as the roster has it; Skerrow waits at 6 to 8 m and has no Lunge
  away; nobody dodges. The 2v2 arena02 cell (35.5 over 200 matches) is inside
  the noise of the band, and the 3v3 cells move with the order of the fill.
- **Lumeth v Quillon.** The counter is Aegis Veil soaking a Lance and Soothing
  Surge outhealing Rod Bolt. Limits that bear on it: her heals and shields are
  pressed only at an ally that needs them and count the instant heal only, the
  EX variants of Soothing Surge and Aegis Veil are never pressed, and she has
  no 8 m leash. The two arenas differ by 56 points in 2v2, so the layout
  counts as much as the kits here.

## 6. Changes made

None yet. The tuning pass (#121) adds one row per change: the number, its old
and new value, the target cell, and X's rate in that cell before and after.

| Change | Number | Old | New | Target cell | Rate before | Rate after |
|--------|--------|-----|-----|-------------|-------------|------------|

## 7. How to regenerate

- `npm run balance` plays all 3600 matches and writes the block of section 4.
  It needs Node 22.15 or later (the resolve hook is `module.registerHooks`) and
  stops with a message below that. A full run takes about 4 minutes on one core
  of an Apple silicon laptop; the wall time goes to stdout and never into the
  file.
- It refuses to write when `data/`, `packages/sim/src`, `packages/bots/src` or
  `tools/balance` differ from HEAD, because the head line would then name a
  commit that does not hold the sources. Commit the change first.
- `npm run balance -- --out <file>` writes the block to a file and touches no
  document: the way to explore. `-- --seeds N` plays the seeds 1 to N.
- `npm run balance -- --check` regenerates the block in memory and compares it
  with the committed one except for the head line. It exits 1 on a difference.
  Run it after any change to a kit, the sim or the bots.
- The report was reproduced with `--check` on macOS (Apple silicon) with Node
  22.23.2 and Node 26.7.0. The Linux x86_64 container run (`node:22`, an
  emulated `linux/amd64` image) had not finished after 60 minutes, so its
  result is not recorded here. Bot output across platforms is not promised
  (bots.md, "Determinism"), so the macOS table is the report, and a table that
  differs on another platform gets a platform note here with the differing
  cells.
