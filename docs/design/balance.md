# Balance: the bands, the baseline and the first tuning pass

## 1. Status and sources

Status: the harness and the baseline of batch #105 (issue #109), and its first
tuning pass (issue #121). The pass moved two numbers, one of Skerrow's and one
of Lumeth's (section 6): the report below is the report after them, with 3 of
24 cells in band, where the baseline had 1. The Hargrim and Quillon numbers are
not moved yet; they are issue #124, which also takes the cells left to it in
section 5.

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
  underdog above 60 percent is an inverted counter.

## 3. The method

- **Pairing.** An unordered pair X v Y of different kits over the files in
  `data/kits`, so six pairings with four kits. "Pairing" is read as the
  matchup of two champions, as decision 6 words it, and not as the duo of
  roster-v1.md section 5.
- **Fills.** Both teams get the same fill, so the pair is the only difference.
  In 2v2 the teams are [X, Z] v [Y, Z] for each Z outside the pair: two fills,
  pooled in the cell and each shown in the Fills column. In 3v3 they are
  [X, Z, W] v [Y, Z, W] and [X, W, Z] v [Y, W, Z] for the two kits outside the
  pair: both orders, pooled and each shown, because the order sets the spawn
  slots (see Noise). X takes the first spawn slot of its team.
- **Sides.** Odd seeds put X on team A and even seeds on team B, so each side
  gets half of the matches. The table shows X's wins as A and as B.
- **Seeds.** Seeds 1 to 100 for each config: 24 configs, 200 matches in every
  cell and 4800 in all. The match seed is the seed and the bot of
  champion id `i` gets `seed * 100 + i`, the rule of the client's
  `bot-driver.ts`. The sim never draws from its own random state, so the bot
  seeds are the only source of variation.
- **Tier and rules.** Every bot is at the normal tier. The match is played to
  `DEFAULT_ROUNDS_TO_WIN` (3 rounds) with the kits read from the JSON as they
  are, and `createMatch` validates them.
- **Budget.** A match that has not ended after 60 000 ticks is a budget hit. It
  is left out of the rate, counted in the Budget hits column and listed under
  the table. One match of the baseline and of the report after the tuning hit it
  (Quillon v Skerrow, 3v3 on arena01, with the fill [lumeth, hargrim], seed 6);
  every other match ended before tick 26 000 (the longest took 25 954). That
  one is a bot stall, not a kit effect: from tick 7521 the two surviving
  Hargrims stand still 2.13 m apart inside the end ring with no button
  pressed, and round 1 never ends. It is issue #123, a bots fix; the tuning
  pass never chases it with kit numbers.
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
  about 7 points at n = 200 (every cell) around 50 percent, and about 10 at
  n = 100 (one fill alone). A cell within that distance of 40 or 60 cannot be
  told from the band by one run. Two things were measured once with scratch
  code that is not part of the tool (X's rate over 100 matches). First, the
  order of the 3v3 fill changes a rate by up to 37 points, because it changes
  the spawn slots. This is why 3v3 pools both orders. Hargrim v Skerrow on
  arena02 gave 11 percent with the fill [lumeth, quillon] and 46 with
  [quillon, lumeth] on seeds 1 to 100 (the report shows both), and 12 and 49
  on seeds 101 to 200. Second, seed sets alone move a one-fill rate by about 10
  points: Lumeth v Quillon on arena02 with [hargrim, skerrow] gave 29 and 18.
- **The tool.** `tools/balance` plays the matches with Node's own type
  stripping and a resolve hook (`register.ts`), with no dependency. The
  harness is `harness.ts`, the CLI is `run.ts`, and `harness.test.ts` pins the
  harness in the unit tests. The run is not part of `npm run check` or CI.

## 4. The report

The block below is generated by `npm run balance`; do not edit it. The head
line names the commit the sources were read at. It is the report after the
tuning pass of #121. The baseline, before any number moved, had 1 cell in band
(3v3 on arena01, Lumeth v Quillon, 56.5) and a summed distance of 695.5 points
from the band; per champion Hargrim 14.2, Lumeth 77.9, Quillon 86.4 and
Skerrow 21.5.

<!-- balance:report -->
Generated by `npm run balance` from the sources at `9a9c653`.

Seeds 1 to 100 for each config, every bot at the normal tier. X's rate
is the share of the decided matches X won, in percent; the band is 40 to 60
inclusive, on the exact rate.
Cells in band: 3 of 24.

### Cells

| Mode | Arena | X v Y | Fills (X's rate) | Seeds / matches | X rate % | X wins as A | X wins as B | Verdict | Round mean | Round longest | Sudden-death rounds | First hit mean | Drawn rounds | Budget hits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2v2 | arena01 | hargrim v lumeth | quillon 0.0, skerrow 1.0 | 100 / 200 | 0.5 | 1/100 | 0/100 | outside | 862 | 4984 | 6 of 651 | 118 | 0 | 0 |
| 2v2 | arena01 | hargrim v quillon | lumeth 0.0, skerrow 0.0 | 100 / 200 | 0.0 | 0/100 | 0/100 | outside | 825 | 2829 | 2 of 626 | 122 | 0 | 0 |
| 2v2 | arena01 | hargrim v skerrow | lumeth 14.0, quillon 68.0 | 100 / 200 | 41.0 | 39/100 | 43/100 | in band | 1256 | 5010 | 15 of 829 | 117 | 10 | 0 |
| 2v2 | arena01 | lumeth v quillon | hargrim 64.0, skerrow 67.0 | 100 / 200 | 65.5 | 56/100 | 75/100 | outside | 1145 | 4680 | 8 of 829 | 131 | 1 | 0 |
| 2v2 | arena01 | lumeth v skerrow | hargrim 100.0, quillon 98.0 | 100 / 200 | 99.0 | 98/100 | 100/100 | outside | 828 | 1762 | 7 of 657 | 121 | 0 | 0 |
| 2v2 | arena01 | quillon v skerrow | hargrim 100.0, lumeth 100.0 | 100 / 200 | 100.0 | 100/100 | 100/100 | outside | 820 | 1982 | 1 of 630 | 135 | 0 | 0 |
| 2v2 | arena02 | hargrim v lumeth | quillon 4.0, skerrow 0.0 | 100 / 200 | 2.0 | 2/100 | 2/100 | outside | 920 | 3617 | 17 of 679 | 104 | 0 | 0 |
| 2v2 | arena02 | hargrim v quillon | lumeth 0.0, skerrow 0.0 | 100 / 200 | 0.0 | 0/100 | 0/100 | outside | 902 | 4597 | 18 of 639 | 111 | 0 | 0 |
| 2v2 | arena02 | hargrim v skerrow | lumeth 24.0, quillon 44.0 | 100 / 200 | 34.0 | 38/100 | 30/100 | outside | 1264 | 4977 | 14 of 838 | 106 | 5 | 0 |
| 2v2 | arena02 | lumeth v quillon | hargrim 5.0, skerrow 25.0 | 100 / 200 | 15.0 | 18/100 | 12/100 | outside | 937 | 4457 | 6 of 730 | 110 | 0 | 0 |
| 2v2 | arena02 | lumeth v skerrow | hargrim 100.0, quillon 98.0 | 100 / 200 | 99.0 | 99/100 | 99/100 | outside | 838 | 2700 | 3 of 682 | 104 | 1 | 0 |
| 2v2 | arena02 | quillon v skerrow | hargrim 99.0, lumeth 100.0 | 100 / 200 | 99.5 | 100/100 | 99/100 | outside | 864 | 4808 | 4 of 659 | 112 | 0 | 0 |
| 3v3 | arena01 | hargrim v lumeth | quillon+skerrow 0.0, skerrow+quillon 0.0 | 100 / 200 | 0.0 | 0/100 | 0/100 | outside | 926 | 1900 | 8 of 623 | 114 | 1 | 0 |
| 3v3 | arena01 | hargrim v quillon | lumeth+skerrow 7.0, skerrow+lumeth 0.0 | 100 / 200 | 3.5 | 2/100 | 5/100 | outside | 1285 | 3348 | 18 of 677 | 117 | 0 | 0 |
| 3v3 | arena01 | hargrim v skerrow | lumeth+quillon 64.0, quillon+lumeth 63.0 | 100 / 200 | 63.5 | 66/100 | 61/100 | outside | 1638 | 5254 | 77 of 838 | 115 | 1 | 0 |
| 3v3 | arena01 | lumeth v quillon | hargrim+skerrow 50.0, skerrow+hargrim 67.0 | 100 / 200 | 58.5 | 66/100 | 51/100 | in band | 1184 | 3223 | 26 of 792 | 126 | 1 | 0 |
| 3v3 | arena01 | lumeth v skerrow | hargrim+quillon 100.0, quillon+hargrim 100.0 | 100 / 200 | 100.0 | 100/100 | 100/100 | outside | 1018 | 2896 | 5 of 647 | 119 | 0 | 0 |
| 3v3 | arena01 | quillon v skerrow | hargrim+lumeth 100.0, lumeth+hargrim 91.9 | 100 / 200 | 96.0 | 99/100 | 92/99 | outside | 1414 | 4125 | 9 of 694 | 128 | 0 | 1 |
| 3v3 | arena02 | hargrim v lumeth | quillon+skerrow 2.0, skerrow+quillon 0.0 | 100 / 200 | 1.0 | 1/100 | 1/100 | outside | 1000 | 3397 | 6 of 638 | 103 | 0 | 0 |
| 3v3 | arena02 | hargrim v quillon | lumeth+skerrow 0.0, skerrow+lumeth 13.0 | 100 / 200 | 6.5 | 11/100 | 2/100 | outside | 1389 | 4489 | 21 of 721 | 107 | 1 | 0 |
| 3v3 | arena02 | hargrim v skerrow | lumeth+quillon 26.0, quillon+lumeth 63.0 | 100 / 200 | 44.5 | 42/100 | 47/100 | in band | 1517 | 5298 | 19 of 808 | 104 | 3 | 0 |
| 3v3 | arena02 | lumeth v quillon | hargrim+skerrow 19.0, skerrow+hargrim 16.0 | 100 / 200 | 17.5 | 20/100 | 15/100 | outside | 1092 | 4431 | 34 of 777 | 108 | 1 | 0 |
| 3v3 | arena02 | lumeth v skerrow | hargrim+quillon 99.0, quillon+hargrim 97.0 | 100 / 200 | 98.0 | 100/100 | 96/100 | outside | 1088 | 3825 | 9 of 642 | 103 | 0 | 0 |
| 3v3 | arena02 | quillon v skerrow | hargrim+lumeth 90.0, lumeth+hargrim 100.0 | 100 / 200 | 95.0 | 96/100 | 94/100 | outside | 1415 | 4527 | 15 of 698 | 110 | 0 | 0 |

### Budget hits

Matches that did not end in 60000 ticks, left out of the rates:

- quillon v skerrow, 3v3, arena01, with lumeth+hargrim: seed 6

### Champions

Win rate in percent over the cells the champion is in, as X or as Y.

| Champion | 2v2 arena01 | 2v2 arena02 | 3v3 arena01 | 3v3 arena02 | All |
| --- | --- | --- | --- | --- | --- |
| hargrim | 13.8 | 12.0 | 22.3 | 17.3 | 16.4 |
| lumeth | 88.0 | 70.7 | 86.2 | 71.5 | 79.1 |
| quillon | 78.2 | 94.8 | 78.0 | 90.3 | 85.3 |
| skerrow | 20.0 | 22.5 | 13.5 | 20.8 | 19.2 |
<!-- /balance:report -->

## 5. The cells after the tuning pass

After the tuning pass of #121 three cells are in the band and 21 are outside.
Each is in band, accepted with its reason, or left to #124 (the Hargrim and
Quillon tuning pass), with its reading. The rates are X's, from the report
above. A reading names the limits of the bots (bots.md, "Not built yet" and
"Never pressed") that may account for a cell; none of their shares was
measured, so none is stated as the cause. "Within the noise" means within the
7 points of section 3 from the band at n = 200, so one run cannot tell the cell
from the band.

The pass could move only Skerrow and Lumeth numbers. The four Hargrim v
Quillon cells have neither champion in the pairing, and the eight Hargrim v
Lumeth and Lumeth v Quillon cells have only Lumeth in them to move. The
searches behind the readings are in section 6.

### 5.1 Each cell

| Mode | Arena | X v Y | X rate | Disposition | Reading |
|------|-------|-------|--------|-------------|---------|
| 2v2 | arena01 | hargrim v lumeth | 0.5 | left to #124 | Inverted: Lumeth wins. 5.2. |
| 2v2 | arena01 | hargrim v quillon | 0.0 | left to #124 | Too strong a counter. 5.3. |
| 2v2 | arena01 | hargrim v skerrow | 41.0 | in band | Moved in by Rend's damage. |
| 2v2 | arena01 | lumeth v quillon | 65.5 | accepted, within the noise | The right way, 5.5 over. 5.6. |
| 2v2 | arena01 | lumeth v skerrow | 99.0 | accepted, bots limit | Inverted. 5.4. |
| 2v2 | arena01 | quillon v skerrow | 100.0 | accepted, bots limit | Inverted. 5.4. |
| 2v2 | arena02 | hargrim v lumeth | 2.0 | left to #124 | Inverted: Lumeth wins. 5.2. |
| 2v2 | arena02 | hargrim v quillon | 0.0 | left to #124 | Too strong a counter. 5.3. |
| 2v2 | arena02 | hargrim v skerrow | 34.0 | accepted, within the noise | Inverted, 6.0 under the band. 5.5. |
| 2v2 | arena02 | lumeth v quillon | 15.0 | left to #124 | Inverted: Quillon wins. 5.6. |
| 2v2 | arena02 | lumeth v skerrow | 99.0 | accepted, bots limit | Inverted. 5.4. |
| 2v2 | arena02 | quillon v skerrow | 99.5 | accepted, bots limit | Inverted. 5.4. |
| 3v3 | arena01 | hargrim v lumeth | 0.0 | left to #124 | Inverted: Lumeth wins. 5.2. |
| 3v3 | arena01 | hargrim v quillon | 3.5 | left to #124 | Too strong a counter. 5.3. |
| 3v3 | arena01 | hargrim v skerrow | 63.5 | accepted, within the noise | The right way, 3.5 over. 5.5. |
| 3v3 | arena01 | lumeth v quillon | 58.5 | in band | Lumeth ahead as intended (50.0 and 67.0 by fill order). |
| 3v3 | arena01 | lumeth v skerrow | 100.0 | accepted, bots limit | Inverted. 5.4. |
| 3v3 | arena01 | quillon v skerrow | 96.0 | accepted, bots limit | Inverted. 5.4. One match hit the budget (5.7). |
| 3v3 | arena02 | hargrim v lumeth | 1.0 | left to #124 | Inverted: Lumeth wins. 5.2. |
| 3v3 | arena02 | hargrim v quillon | 6.5 | left to #124 | Too strong a counter. 5.3. |
| 3v3 | arena02 | hargrim v skerrow | 44.5 | in band | Moved in by Rend's damage (26.0 and 63.0 by fill order). |
| 3v3 | arena02 | lumeth v quillon | 17.5 | left to #124 | Inverted: Quillon wins. 5.6. |
| 3v3 | arena02 | lumeth v skerrow | 98.0 | accepted, bots limit | Inverted. 5.4. |
| 3v3 | arena02 | quillon v skerrow | 95.0 | accepted, bots limit | Inverted. 5.4. |

The three cells in band sit 1.0, 1.5 and 4.5 points from an edge, so a rerun
on other seeds may move any of them out, as the 3v3 fill order and the seed
set did in section 3.

### 5.2 Hargrim v Lumeth (four cells, left to #124)

Hargrim wins 0 to 2 percent in all four cells. The counter is Chain Hook,
which pulls Lumeth 4 m closer and slows her. In a replayed 2v2 match on
arena01 (Hargrim and Quillon against Lumeth and Quillon, seed 1, round 1)
Lumeth did 138 of the 160 damage Hargrim took, mostly with Mend Bolt from
range, and Hargrim cast the hook once. Limits that may account: the target is
the nearest enemy, so the hook may go at another champion than Lumeth; nobody
dodges, so her bolts may land; Rally Cry is never pressed.

In 40-seed screens only Mend Bolt's cooldown (36 to 50 and to 70 ticks) and
its damage on an enemy (10 to 8) moved the cell by more than a few points
(2v2 arena02 to 15, 28 and 10 percent). The cooldown took the Lumeth v Quillon
cells down by 20 to 60 points and failed the fixture coverage at 70 ticks, and
the damage change did not pass the rule (section 6). The numbers that could
close the gap are Hargrim's (the hook, M1 and Rush), which are #124's.

### 5.3 Hargrim v Quillon (four cells, left to #124)

Quillon wins 93.5 to 100 percent: the favourite is far above 60, and the
right way round. Neither champion of the pairing is Skerrow or Lumeth, so the
pass could not touch the cell; a Skerrow or Lumeth in the fill only moves it a
few points (the cell sat between 0 and 9.5 percent in the full runs of section
6). Limits that may account: nobody dodges, so Hargrim may walk into bolts, and
Rally Cry, his haste, is never pressed.

### 5.4 Lumeth v Skerrow and Quillon v Skerrow (eight cells, accepted)

Lumeth wins 98 to 100 percent and Quillon 95 to 100 against Skerrow, where the
roster has Skerrow ahead. The cells are accepted as a bots limit: no Skerrow
number the pass tried moved them toward the band without taking a cell out of
it. The nearest by far was Rend's cooldown, 420 to 240 ticks: Lumeth v
Skerrow on arena02 in 2v2 fell from 98.5 to 75.5, but three cells left the
band, among them two of the Hargrim v Skerrow cells it had just entered. Eight
Skerrow runs and nine Lumeth runs gave no other move of more than 10 points in
these eight cells (section 6).

Limits that may account: the target is the nearest enemy, so in a replayed
Quillon and Hargrim against Skerrow and Hargrim match (2v2, arena01, seed 1,
round 1) Skerrow hit the other Hargrim while Quillon's bolts hit her Hargrim
six times and Skerrow twice; Skerrow's Lunge opener waits
at 6 to 8 m for its opening and she has no Lunge away; Lumeth's Lantern Burst
is pressed as an escape when an acted enemy is within 3 m, which may push a
diving Skerrow 2 m back each time it is ready; the bot presses Quiet Dart only
at a target with an escape ready; nobody dodges.

### 5.5 Hargrim v Skerrow (accepted within the noise, two in band)

The two cells in band came from Rend's damage, 20 to 14. 2v2 on arena02 sits 6
points under the band and 3v3 on arena01 3.5 over: both inside the noise, on
opposite sides of the band (Throwing Knife's cooldown, 180 to 300 ticks, took
2v2 on arena02 into the band and raised the summed distance). Limits that may
account: Iron Hide is an escape slot for the bot, so it is not pressed against
an opener as the roster has it; Skerrow waits at 6 to 8 m and has no Lunge
away; nobody dodges. The 3v3 cells pool two fill orders that differ widely
(26.0 and 63.0 on arena02).

### 5.6 Lumeth v Quillon (one in band, one accepted, two left to #124)

Arena01 is the right way round (65.5 in 2v2, 5.5 over and inside the noise; 58.5
in 3v3, in band) and arena02 inverted (15.0 and 17.5), so the two arenas differ
by about 50 points and the layout counts as much as the kits. A Lumeth number
that moved arena02 up moved arena01 up with it: Mend Bolt's heal 10 to 14 took
the two arena02 cells to 34 on the screen and the arena01 cells to 92 and 79.
The kept change, Binding Sigil's radius, moved the arena02 cells by 1.5 and 2.0
points. The cells are left to #124: Quillon's numbers may move arena02 without
moving arena01 the same way. Limits that may account: her heals and shields
are pressed only at an ally that needs them and count the instant heal only,
the EX variants of Soothing Surge and Aegis Veil are never pressed, and she has
no 8 m leash.

### 5.7 The budget hit

One match of the 4800 did not end: quillon v skerrow, 3v3, arena01, with
[lumeth, hargrim], seed 6. Replayed through `playMatch` on the final kits it
is the stall of issue #123: from tick 7521 the two surviving Hargrims stand
about 2.1 m apart with no button pressed since tick 7465 and no cast, so round
1 never ends. It is a bot stall and not a kit effect, and no kit number was
chased for it. The longest match that did end took 25 954 ticks.

## 6. Changes made

Two numbers changed. The rates are X's, in percent, from full `--out` runs
(100 seeds on each of 24 configs); the summed distance is the sum over the 24
cells of the distance to the 40 to 60 band.

| Change | Number | Old | New | Target cell | Rate before | Rate after |
|--------|--------|-----|-----|-------------|-------------|------------|
| 1 | Skerrow E (Rend) direct damage, the base only | 20 | 14 | hargrim v skerrow, 2v2 arena01 | 31.0 | 45.0 |
| 1 | the same | 20 | 14 | hargrim v skerrow, 3v3 arena02 | 28.5 | 44.5 |
| 2 | Lumeth Q (Binding Sigil) radius | 1.5 m | 2.0 m | lumeth v quillon, 2v2 arena02 | 13.5 | 15.0 |
| 2 | the same | 1.5 m | 2.0 m | lumeth v quillon, 3v3 arena02 | 15.5 | 17.5 |

- Change 1 took the cells in band from 1 to 3 and the summed distance from
  695.5 to 679.0, and no cell left the band. Rend EX keeps its 28.
- Change 2 kept 3 cells in band and took the summed distance from 679.0 to
  675.5, and no cell left the band. It moves Binding Sigil's band from 11 m to
  11.5 m (the range 9 plus the radius plus 0.5).
- The report above is the result: 3 cells in band of 24, and the summed
  distance 675.5. By champion over its cells: Hargrim 16.4 (14.2 before),
  Lumeth 79.1 (77.9), Quillon 85.3 (86.4) and Skerrow 19.2 (21.5).

### 6.1 Candidates tried and dropped

The rule of decision 28: a change is kept when its target cell moves toward
the band, no cell in band leaves it and the summed distance falls; one that
turns a pinned run, the fixture coverage or allocation.test.ts red is dropped.
Skerrow had 8 full runs and 1 kept change, Lumeth 9 and 1; neither champion
reached its cap of 4 kept changes or 10 runs, since every candidate screened on
the way (at 40 seeds, with the fixture coverage and allocation.test.ts checked
first) either failed a check or moved nothing the rule could use.

| Champion | Number | Old to new | Run | Why dropped |
|----------|--------|------------|-----|-------------|
| Skerrow | M1 damage | 9 to 8 | 1 | Lumeth v Quillon 3v3 arena01 left the band (56.5 to 62.0). |
| Skerrow | E cooldown | 420 to 240 | 3 | Three cells left the band. |
| Skerrow | M1 damage | 9 to 8 | 4 | Target cell moved away (34.5 to 33.0); the sum fell by 1. |
| Skerrow | Q silence | 90 to 120 ticks | 5 | The sum rose to 703.0; two cells left the band. |
| Skerrow | M2 cooldown | 180 to 300 | 6 | The sum rose from 679.0 to 687.5. |
| Skerrow | M2 cooldown | 180 to 300 | 7 | The fixture coverage turned red, and the sum rose to 692.0. |
| Skerrow | max health | 130 to 120 | 8 | The sum rose from 675.5 to 686.0. |
| Lumeth | M1 damage on enemies | 10 to 8 | 1 | The sum did not fall (679.0 to 679.0). |
| Lumeth | M2 windup (EX too) | 18 to 30 | 2 | The Lumeth fixture lost the M2 energy coverage (the run itself: 679.0 to 676.5). |
| Lumeth | Q root | 90 to 60 ticks | 3 | The sum rose by 1.0. |
| Lumeth | R absorb | 30 to 40 | 4 | Hargrim v Skerrow 3v3 arena02 left the band. |
| Lumeth | M2 heal | 14 to 20 | 5 | Hargrim v Skerrow 2v2 arena01 left the band. |
| Lumeth | F slow | 30 percent for 2 s to 60 for 3 s | 6 | Hargrim v Skerrow 2v2 arena01 left the band. |
| Lumeth | R and R EX radius | 5 to 4 m | 8 | The sum rose by 3.5. |
| Lumeth | M1 heal | 10 to 12 | 9 | Three cells left the band; the sum rose to 692.5. |

Before any full run these failed the fixture coverage of
`roster-fixtures.test.ts` on a Lumeth or Skerrow change and were not run: for
Lumeth the M1 windup, M1 speed and radius, Q cooldown, windup and radius 1 m,
E cooldown and windup and knockback, Glide's cooldown and haste, M2's cooldown,
R's cooldown, F's windup and M1's cooldown to 70 ticks; for Skerrow the M1 and
E cooldowns, Lunge's and Quiet Dart's and Vanish Step's cooldowns, max health
140 and Throwing Knife's slow. The fixtures are the shipped scripts, and the
search that found them is not in the repository (roster-fixtures.test.ts,
header), so a coverage miss ends a candidate.

## 7. How to regenerate

- `npm run balance` plays all 4800 matches and writes the block of section 4.
  It needs Node 22.15 or later (the resolve hook is `module.registerHooks`) and
  stops with a message below that. A full run takes about 5 minutes on one core
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
  22.23.2 and Node 26.7.0. The linux/amd64 reproduction is the manual workflow
  `.github/workflows/balance.yml` (`workflow_dispatch` only, never on pull
  requests or pushes): trigger it with
  `gh workflow run balance.yml --ref <branch>`. It runs `npm ci` and
  `npm run balance -- --check` on ubuntu, and on a difference prints the
  differing lines. Bot output across platforms is not promised (bots.md,
  "Determinism"), so the macOS table is the report, and a table that differs
  on another platform gets a platform note here with the differing cells.
