# Balance: the bands, the baseline and the first tuning pass

## 1. Status and sources

Status: the harness and the baseline of batch #105 (issue #109), its first
tuning pass (issue #121) and the Hargrim and Quillon pass (issue #124). The
first pass moved two numbers, one of Skerrow's and one of Lumeth's (section 6),
and the second moved none: each of its 20 candidates was dropped, by a
pre-check or by its full run (section 6.2). Sections 5 and 6 record the report
after the two numbers of #121, with 3 of 24 cells in band, where the baseline
had 1, which is also the report of #124's head, since no kit changed. Every
cell is in band or accepted with its reason there. The report in section 4 was
regenerated after the bots began to dodge (issue #137): 5 of 24 cells in band
(the note of section 4).

Sources:

- Decision 6 of batch #105 sets the band: 40 to 60 percent win rate per
  champion pairing, bot against bot at the normal tier over 100 seeds per
  pairing, on both arenas, in 2v2 and 3v3. A pairing outside the band gets a
  kit change inside the ranges of spec section 10 and
  [rules.md](rules.md) section 4.1, pinned by the roster tests with its fixture
  regenerated in the same change (rebuilt with the search tool when its
  coverage turns red, section 6.3). A pairing left outside is named as
  accepted, with the reason.
- Decision 21 of batch #105 splits the work: #109 builds the harness, the
  baseline and this document; #121 and #124 change numbers (decision 28 gives
  Skerrow and Lumeth to #121 and Hargrim and Quillon to #124). It also fixes the
  fill, the sides, the seeds, and the runner described below.
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
  Hargrims stand still 2.14 m apart (the same on the baseline's kits and the
  final ones) inside the end ring with no button pressed by either (their last
  presses are at ticks 448 and 420), and round 1 never ends. It is issue #123, a
  bots fix; the tuning pass never chases it with kit numbers.
- **Metrics.** Ticks count from the start of the round. Round mean and round
  longest are over the rounds that did not go to sudden death. Sudden-death
  rounds are shown as a count out of all rounds of the cell. First hit mean is
  the mean over the rounds that had one, where the first hit is the first
  `damage` of a champion to a champion of the other team (the ring does not
  count). A drawn round is one nobody won.
- **The bots.** The cells measure the kits as the bots play them, and the
  bots have limits (bots.md, "Not built yet" and "Never pressed"): the dodge
  is one coin a projectile (0.5 at the normal tier, no dodging at all until
  #137) and there is no local avoidance of champions; the target is the
  nearest enemy, except that a bot keeps its current target unless another
  enemy is more than 1 m nearer (`TARGET_SWITCH_MARGIN` in
  `packages/bots/src/bot.ts`), and that a bot that would retreat targets a
  finisher instead, the nearest enemy in reach with a clear shot whose health
  fraction is at or below its own (bots.md, "Finisher"); no Rally Cry; no EX
  variant of Lumeth's M2 and R; no 8 m leash and no M1 finisher for Lumeth; her
  heals count the instant part only; no Lunge away for Skerrow. A kit that is
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
tuning pass of #121, and of #124, which changed no kit, regenerated after the
dodge of #137 (the note below). The baseline, before any number moved, had 1
cell in band (3v3 on arena01, Lumeth v Quillon, 56.5) and a summed distance of
695.5 points from the band; per champion Hargrim 14.2, Lumeth 77.9, Quillon
86.4 and Skerrow 21.5.

The dodge of #137 (bots.md, Dodge): the bots now sidestep a predicted
projectile, one coin per projectile at the normal tier's 0.5, so the 4800
matches were played again. 22 of the 24 cells moved and 6 of them by more than
the 7 points of one cell's noise (section 3): Lumeth v Quillon in 2v2 on
arena01 (65.5 to 85.5) and arena02 (15.0 to 57.0) and in 3v3 on arena01 (58.5
to 77.0) and arena02 (17.5 to 52.0), and Hargrim v Skerrow in 3v3 on arena01
(63.5 to 50.5) and arena02 (44.5 to 53.0). The cells in band went from 3 to 5:
Hargrim v Skerrow in 2v2 on arena01 (40.0) and in 3v3 on both arenas, and
Lumeth v Quillon in 2v2 and 3v3 on arena02 (57.0 and 52.0); Lumeth v Quillon
in 3v3 on arena01 left it (77.0). The summed distance of the 24 cells to the
band went from 675.5 to 666.5 points. Per champion Hargrim 16.1, Lumeth 89.2,
Quillon 75.6 and Skerrow 19.1. No match hit the budget: the stall of #123 does
not occur in this run, but the rule behind it is unchanged and the issue stays
open. The keep rule of decisions 28 and 32 of batch #105 (a change is kept
when its target cell moves toward the band, no in-band cell leaves it and the
summed distance falls by at least 7.0 points) governs kit candidates and does
not apply to a bot change, which is measured whole, as the dash hold of #98
was (decision 3 of batch #134). Sections 5 and 6 stay the record of the report
at 9a9c653 and are for the second tuning pass (batch 12) to read again.

<!-- balance:report -->
Generated by `npm run balance` from the sources at `af235b5`.

Seeds 1 to 100 for each config, every bot at the normal tier. X's rate
is the share of the decided matches X won, in percent; the band is 40 to 60
inclusive, on the exact rate.
Cells in band: 5 of 24.

### Cells

| Mode | Arena | X v Y | Fills (X's rate) | Seeds / matches | X rate % | X wins as A | X wins as B | Verdict | Round mean | Round longest | Sudden-death rounds | First hit mean | Drawn rounds | Budget hits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2v2 | arena01 | hargrim v lumeth | quillon 0.0, skerrow 0.0 | 100 / 200 | 0.0 | 0/100 | 0/100 | outside | 918 | 1780 | 1 of 645 | 121 | 1 | 0 |
| 2v2 | arena01 | hargrim v quillon | lumeth 2.0, skerrow 0.0 | 100 / 200 | 1.0 | 0/100 | 2/100 | outside | 944 | 2906 | 0 of 647 | 124 | 0 | 0 |
| 2v2 | arena01 | hargrim v skerrow | lumeth 18.0, quillon 62.0 | 100 / 200 | 40.0 | 38/100 | 42/100 | in band | 1438 | 4958 | 1 of 841 | 119 | 3 | 0 |
| 2v2 | arena01 | lumeth v quillon | hargrim 84.0, skerrow 87.0 | 100 / 200 | 85.5 | 89/100 | 82/100 | outside | 1267 | 2310 | 0 of 752 | 132 | 2 | 0 |
| 2v2 | arena01 | lumeth v skerrow | hargrim 99.0, quillon 100.0 | 100 / 200 | 99.5 | 100/100 | 99/100 | outside | 832 | 1544 | 0 of 621 | 127 | 0 | 0 |
| 2v2 | arena01 | quillon v skerrow | hargrim 100.0, lumeth 96.0 | 100 / 200 | 98.0 | 97/100 | 99/100 | outside | 888 | 2119 | 0 of 652 | 136 | 0 | 0 |
| 2v2 | arena02 | hargrim v lumeth | quillon 0.0, skerrow 1.0 | 100 / 200 | 0.5 | 1/100 | 0/100 | outside | 989 | 2069 | 1 of 657 | 107 | 0 | 0 |
| 2v2 | arena02 | hargrim v quillon | lumeth 0.0, skerrow 1.0 | 100 / 200 | 0.5 | 1/100 | 0/100 | outside | 956 | 2341 | 0 of 647 | 114 | 0 | 0 |
| 2v2 | arena02 | hargrim v skerrow | lumeth 14.0, quillon 53.0 | 100 / 200 | 33.5 | 32/100 | 35/100 | outside | 1342 | 4812 | 0 of 833 | 108 | 5 | 0 |
| 2v2 | arena02 | lumeth v quillon | hargrim 56.0, skerrow 58.0 | 100 / 200 | 57.0 | 65/100 | 49/100 | in band | 1196 | 2508 | 0 of 841 | 112 | 1 | 0 |
| 2v2 | arena02 | lumeth v skerrow | hargrim 100.0, quillon 99.0 | 100 / 200 | 99.5 | 100/100 | 99/100 | outside | 872 | 1960 | 0 of 638 | 108 | 0 | 0 |
| 2v2 | arena02 | quillon v skerrow | hargrim 100.0, lumeth 100.0 | 100 / 200 | 100.0 | 100/100 | 100/100 | outside | 936 | 2971 | 0 of 676 | 115 | 0 | 0 |
| 3v3 | arena01 | hargrim v lumeth | quillon+skerrow 0.0, skerrow+quillon 0.0 | 100 / 200 | 0.0 | 0/100 | 0/100 | outside | 1078 | 1979 | 1 of 624 | 118 | 0 | 0 |
| 3v3 | arena01 | hargrim v quillon | lumeth+skerrow 10.0, skerrow+lumeth 0.0 | 100 / 200 | 5.0 | 5/100 | 5/100 | outside | 1462 | 3191 | 0 of 712 | 120 | 0 | 0 |
| 3v3 | arena01 | hargrim v skerrow | lumeth+quillon 45.0, quillon+lumeth 56.0 | 100 / 200 | 50.5 | 52/100 | 49/100 | in band | 2030 | 5197 | 11 of 826 | 117 | 0 | 0 |
| 3v3 | arena01 | lumeth v quillon | hargrim+skerrow 69.0, skerrow+hargrim 85.0 | 100 / 200 | 77.0 | 81/100 | 73/100 | outside | 1289 | 2747 | 0 of 779 | 127 | 1 | 0 |
| 3v3 | arena01 | lumeth v skerrow | hargrim+quillon 100.0, quillon+hargrim 100.0 | 100 / 200 | 100.0 | 100/100 | 100/100 | outside | 1095 | 2042 | 0 of 616 | 122 | 1 | 0 |
| 3v3 | arena01 | quillon v skerrow | hargrim+lumeth 100.0, lumeth+hargrim 96.0 | 100 / 200 | 98.0 | 98/100 | 98/100 | outside | 1535 | 3511 | 1 of 677 | 131 | 0 | 0 |
| 3v3 | arena02 | hargrim v lumeth | quillon+skerrow 0.0, skerrow+quillon 0.0 | 100 / 200 | 0.0 | 0/100 | 0/100 | outside | 1130 | 2661 | 0 of 631 | 106 | 0 | 0 |
| 3v3 | arena02 | hargrim v quillon | lumeth+skerrow 0.0, skerrow+lumeth 19.0 | 100 / 200 | 9.5 | 13/100 | 6/100 | outside | 1499 | 4714 | 2 of 731 | 110 | 0 | 0 |
| 3v3 | arena02 | hargrim v skerrow | lumeth+quillon 42.0, quillon+lumeth 64.0 | 100 / 200 | 53.0 | 54/100 | 52/100 | in band | 1763 | 4760 | 4 of 833 | 106 | 0 | 0 |
| 3v3 | arena02 | lumeth v quillon | hargrim+skerrow 50.0, skerrow+hargrim 54.0 | 100 / 200 | 52.0 | 58/100 | 46/100 | in band | 1272 | 2872 | 1 of 799 | 109 | 0 | 0 |
| 3v3 | arena02 | lumeth v skerrow | hargrim+quillon 100.0, quillon+hargrim 100.0 | 100 / 200 | 100.0 | 100/100 | 100/100 | outside | 1163 | 2277 | 0 of 633 | 107 | 0 | 0 |
| 3v3 | arena02 | quillon v skerrow | hargrim+lumeth 98.0, lumeth+hargrim 100.0 | 100 / 200 | 99.0 | 98/100 | 100/100 | outside | 1526 | 3204 | 0 of 688 | 112 | 0 | 0 |

### Budget hits

No match hit the budget of 60000 ticks.

### Champions

Win rate in percent over the cells the champion is in, as X or as Y.

| Champion | 2v2 arena01 | 2v2 arena02 | 3v3 arena01 | 3v3 arena02 | All |
| --- | --- | --- | --- | --- | --- |
| hargrim | 13.7 | 11.5 | 18.5 | 20.8 | 16.1 |
| lumeth | 95.0 | 85.3 | 92.3 | 84.0 | 89.2 |
| quillon | 70.5 | 80.8 | 72.0 | 79.2 | 75.6 |
| skerrow | 20.8 | 22.3 | 17.2 | 16.0 | 19.1 |
<!-- /balance:report -->

## 5. The cells after the tuning passes

After the tuning passes of #121 and #124 three cells are in the band and 21 are
outside. Each is in band or accepted with its reason, with its reading. The
rates are X's, from the report above. A reading names the limits of the bots
(bots.md, "Not built yet" and "Never pressed") that may account for a cell;
none of their shares was measured, so none is stated as the cause. "Within the
noise" means within the 7 points of section 3 from the band at n = 200, so one
run cannot tell the cell from the band. "No number moved it" means that every
candidate aimed at the cell, or at its pairing, was dropped by the rule of
section 6 (a red pre-check, or a full run that did not meet the rule), so the
kits stay as they are and the limits of the bots may account.

The passes could move the numbers of all four champions and kept two (section
6). #121 tried Skerrow's and Lumeth's. #124 tried Hargrim's and Quillon's, ten
candidates each, and kept none: 13 of the 20 failed a pre-check (9 the fixture
coverage, one of them also the pinned 3v3 ultimate run, and 4 the no-stall
clause of lumeth.test.ts), and the 7 that got a full run did not meet the rule.
The searches behind the readings are in section 6.

### 5.1 Each cell

| Mode | Arena | X v Y | X rate | Disposition | Reading |
|------|-------|-------|--------|-------------|---------|
| 2v2 | arena01 | hargrim v lumeth | 0.5 | accepted, no number moved it | Inverted: Lumeth wins. 5.2. |
| 2v2 | arena01 | hargrim v quillon | 0.0 | accepted, no number moved it | Too strong a counter. 5.3. |
| 2v2 | arena01 | hargrim v skerrow | 41.0 | in band | Moved in by Rend's damage; Skerrow is still ahead (the counter is inverted inside the band). 5.6. |
| 2v2 | arena01 | lumeth v quillon | 65.5 | accepted, within the noise | The right way, 5.5 over. 5.7. |
| 2v2 | arena01 | lumeth v skerrow | 99.0 | accepted, no number moved it | Inverted. 5.4. |
| 2v2 | arena01 | quillon v skerrow | 100.0 | accepted, no number moved it | Inverted: Quillon wins. 5.5. |
| 2v2 | arena02 | hargrim v lumeth | 2.0 | accepted, no number moved it | Inverted: Lumeth wins. 5.2. |
| 2v2 | arena02 | hargrim v quillon | 0.0 | accepted, no number moved it | Too strong a counter. 5.3. |
| 2v2 | arena02 | hargrim v skerrow | 34.0 | accepted, within the noise | Skerrow is still ahead, 6.0 under the band. 5.6. |
| 2v2 | arena02 | lumeth v quillon | 15.0 | accepted, no number moved it | Inverted: Quillon wins. 5.7. |
| 2v2 | arena02 | lumeth v skerrow | 99.0 | accepted, no number moved it | Inverted. 5.4. |
| 2v2 | arena02 | quillon v skerrow | 99.5 | accepted, no number moved it | Inverted: Quillon wins. 5.5. |
| 3v3 | arena01 | hargrim v lumeth | 0.0 | accepted, no number moved it | Inverted: Lumeth wins. 5.2. |
| 3v3 | arena01 | hargrim v quillon | 3.5 | accepted, no number moved it | Too strong a counter. 5.3. |
| 3v3 | arena01 | hargrim v skerrow | 63.5 | accepted, within the noise | The right way, 3.5 over: the one cell where Hargrim is ahead. 5.6. |
| 3v3 | arena01 | lumeth v quillon | 58.5 | in band | Lumeth ahead as intended (50.0 and 67.0 by fill order). 5.7. |
| 3v3 | arena01 | lumeth v skerrow | 100.0 | accepted, no number moved it | Inverted. 5.4. |
| 3v3 | arena01 | quillon v skerrow | 96.0 | accepted, no number moved it | Inverted: Quillon wins. 5.5. One match hit the budget (5.8). |
| 3v3 | arena02 | hargrim v lumeth | 1.0 | accepted, no number moved it | Inverted: Lumeth wins. 5.2. |
| 3v3 | arena02 | hargrim v quillon | 6.5 | accepted, no number moved it | Too strong a counter. 5.3. |
| 3v3 | arena02 | hargrim v skerrow | 44.5 | in band | Moved in by Rend's damage; Skerrow is still ahead (26.0 and 63.0 by fill order). 5.6. |
| 3v3 | arena02 | lumeth v quillon | 17.5 | accepted, no number moved it | Inverted: Quillon wins. 5.7. |
| 3v3 | arena02 | lumeth v skerrow | 98.0 | accepted, no number moved it | Inverted. 5.4. |
| 3v3 | arena02 | quillon v skerrow | 95.0 | accepted, no number moved it | Inverted: Quillon wins. 5.5. |

The three cells in band sit 1.0, 1.5 and 4.5 points from an edge, so a rerun
on other seeds may move any of them out, as the 3v3 fill order and the seed
set did in section 3.

### 5.2 Hargrim v Lumeth (four cells, accepted)

Hargrim wins 0 to 2 percent in all four cells. The counter is Chain Hook,
which pulls Lumeth 4 m closer and slows her. In a replayed 2v2 match on
arena01 (Hargrim and Quillon against Lumeth and Quillon, seed 1, round 1)
Lumeth did 138 of the 160 damage Hargrim took, mostly with Mend Bolt from
range, and Hargrim cast the hook once. Limits that may account: the target is
the nearest enemy (or the current one within 1 m of it), so the hook may go at
another champion than Lumeth; nobody dodges, so her bolts may land; Rally Cry
is never pressed.

In 40-seed screens only Mend Bolt's cooldown (36 to 50 and to 70 ticks) and
its damage on an enemy (10 to 8) moved the cell by more than a few points
(2v2 arena02 to 15, 28 and 10 percent). The cooldown took the Lumeth v Quillon
cells down by 20 to 60 points and failed the fixture coverage at 70 ticks, and
the damage change did not pass the rule (section 6). The Hargrim numbers that
could close the gap were #124's, and none passed (section 6.2). The hook's
cooldown, 540 to 360 ticks (aimed at 2v2 arena01), turned the no-stall clause
of lumeth.test.ts red by 3 ticks (a bot stalled 123 ticks against the 120
allowed, in the 3v3 on arena02). The hook's slow duration, 60 to 120 ticks
(aimed at 2v2 arena02), and the hook's speed, 20 to 25 m/s, failed the Hargrim
fixture coverage. Maul Swing's damage, 12 to 16
(aimed at 3v3 arena01), left a Quillon stalled for 6003 ticks in the 2v2 of
lumeth.test.ts on arena02. The one that got a full run, the hook's damage, 14
to 20 (run H2, aimed at 3v3 arena02), left the target at 1.0 and the sum at
675.5, with 14 cells moved by at most 3.5 points. So no Hargrim number moved
the cells within the rule, and the limits above may account.

### 5.3 Hargrim v Quillon (four cells, accepted)

Quillon wins 93.5 to 100 percent: the favourite is far above 60, and the
right way round. Neither champion of the pairing is Skerrow or Lumeth, so #121
could not touch the cell; a Skerrow or Lumeth in the fill only moves it a few
points (the cell sat between 0 and 9.5 percent in the full runs of section 6).
#124 could, and its full runs did not move the cells where they were aimed
(section 6.2). Iron Hide's absorb, 40 to 60 (H1), took 2v2 arena02 from 0.0 to
1.0, and its cooldown, 720 to 540 (H5), left 2v2 arena01 at 0.0. Chain Hook's
windup, 18 to 12 ticks (H3), took 3v3 arena01 from 3.5 to 2.5, and Ground
Slam's slow, 30 to 40 percent (H4), took 3v3 arena02 from 6.5 to 4.5. Quillon's
Hush Ward absorb, 30 to 20 (Q1), left 2v2 arena01 at 0.0. Each raised the
summed distance, by 9.5 to 27.0 points, and three of the five took cells out of
the band. Rush's cooldown, 420 to 300 ticks (aimed at 2v2 arena01), failed the
Hargrim fixture coverage, and Bind Shot's slow (40 to 30 percent, and 90 to 60
ticks) and Snare Orb's cooldown (720 to 960 ticks), the other candidates aimed
at these cells, failed the Quillon fixture coverage. Limits that may account:
nobody dodges, so Hargrim may walk into bolts, and Rally Cry, his haste, is
never pressed.

### 5.4 Lumeth v Skerrow (four cells, accepted)

Lumeth wins 98 to 100 percent against Skerrow, where the roster has Skerrow
ahead. No Skerrow or Lumeth number moved the cells within the rule, and the
limits of the bots may account for them. The nearest any number came was
Rend's cooldown, 420 to 240 ticks: Lumeth v Skerrow on arena02 in 2v2 fell from
98.5 to 75.5, but three cells left the band, among them two of the Hargrim v
Skerrow cells it had just entered (and the Skerrow fixture lost its coverage).
That is a trade-off between kit numbers, so a bots limit is not the whole
reading. Eight Skerrow runs and nine Lumeth runs gave no other move of more
than 10 points in the eight Lumeth v Skerrow and Quillon v Skerrow cells
(section 6).

Limits that may account: Skerrow's Lunge opener waits at 6 to 8 m for its
opening and she has no Lunge away; Lumeth's Lantern Burst is pressed as an
escape when an acted enemy is within 3 m, which may push a diving Skerrow 2 m
back each time it is ready; the bot presses Quiet Dart only at a target with an
escape ready; nobody dodges.

### 5.5 Quillon v Skerrow (four cells, accepted)

Quillon wins 95 to 100 percent against Skerrow, where the roster has Skerrow
ahead. #121 moved Skerrow's numbers only and none moved the cells within the
rule. #124 tried Quillon's (section 6.2) and none did either. Two got a full
run: Hush Ward's absorb, 30 to 20 (Q1), and Lance's damage, 28 to 22 (Q2, aimed
at 3v3 arena02, 95.0 to 95.5); neither moved a Quillon v Skerrow cell by 5
points. Eight failed before a full run: six on the fixture coverage (Skip's
cooldown, Bind Shot's slow and its duration, Snare Orb's cooldown, Rod Bolt's
cooldown and Lance's windup; the committed Quillon fixture is attempt 23 of its
search, and the search is not in the repository (at the time; #128 added the
tool)) and two on the no-stall clause of lumeth.test.ts (Rod Bolt's reach and
its damage). Limits that may account:
the target is the nearest enemy (or the current one within 1 m of it), so in a
replayed Quillon and Hargrim against Skerrow and Hargrim match (2v2, arena01,
seed 1, round 1) Skerrow hit the other Hargrim while Quillon's bolts hit her
Hargrim nine times (eight Rod Bolts, six of them for the full 11 damage and two
absorbed by Iron Hide, and one Snare Orb) and Skerrow three times; Skerrow's
Lunge opener waits at 6 to 8 m and she has no Lunge away; the bot presses Quiet
Dart only at a target with an escape ready; nobody dodges.

### 5.6 Hargrim v Skerrow (two in band, two accepted within the noise)

The roster has Hargrim ahead. By the reading of section 2 he is ahead only in
3v3 on arena01 (63.5, 3.5 over); in the other three cells (41.0, 34.0 and 44.5)
he is under 50 percent, so Skerrow is still ahead, in two of them inside the
band. The two cells in band came from Rend's damage, 20 to 14. 2v2 on arena02
sits 6 points under the band and 3v3 on arena01 3.5 over: both inside the
noise, on opposite sides of the band (Throwing Knife's cooldown, 180 to 300
ticks, took 2v2 on arena02 into the band and raised the summed distance, and it
fails the Skerrow fixture coverage). Limits that may account: Iron Hide is an
escape slot for the bot, so it is not pressed against an opener as the roster
has it; Skerrow waits at 6 to 8 m and has no Lunge away; nobody dodges. The 3v3
cells pool two fill orders that differ widely (26.0 and 63.0 on arena02).
#124's runs moved these cells too, on the way to other targets. Iron Hide's
absorb, 40 to 60 (run H1), took the two cells in band to 53.5 and 59.5, Hargrim
ahead as the roster has it, but took 3v3 arena01 from 63.5 to 70.0 and raised
the sum by 15.5; Ground Slam's slow, 30 to 40 percent (H4), took 2v2 arena01
out of the band (41.0 to 35.5). Both are in section 6.2.

### 5.7 Lumeth v Quillon (one in band, one within the noise, two accepted)

Arena01 is the right way round (65.5 in 2v2, 5.5 over and inside the noise; 58.5
in 3v3, in band) and arena02 inverted (15.0 and 17.5), so the two arenas differ
by about 50 points and the layout counts as much as the kits. A Lumeth number
that moved arena02 up moved arena01 up with it: Mend Bolt's heal 10 to 14 took
the two arena02 cells to 34 on the screen and the arena01 cells to 92 and 79.
The kept change, Binding Sigil's radius, moved the arena02 cells by 1.5 and 2.0
points. #124 tried the Quillon numbers aimed at arena02: Rod Bolt's reach, 13.93
to 12.1 m (aimed at 2v2), which the bot kites to, and its cooldown, 30 to 36
ticks (aimed at 3v3). Neither got a full run: the reach turned the no-stall
clause of lumeth.test.ts red (a bot stalled 3392 ticks in engage in the 3v3 on
arena01), and the cooldown failed the fixture coverage and the pinned 3v3
ultimate run. The Quillon numbers that did get a full run moved both arenas.
Hush Ward's absorb (Q1) took 3v3 arena01 from 58.5 to 61.5, out of the band, and
the arena02 cells from 15.0 to 13.0 (2v2) and from 17.5 to 18.0 (3v3). Lance's
damage (Q2) took 3v3 arena01 to 65.0 and 2v2 arena01 from 65.5 to 71.0, and the
arena02 cells from 15.0 to 15.5 (2v2) and from 17.5 to 21.5 (3v3), a move of
4.0 toward the band that is inside the noise and left the cell 18.5 under it.
The two arena02 cells are accepted: no number moved them within the rule, and
the layout and the limits of the bots may account. Limits that may account: her
heals and shields are pressed only at an ally that needs them and count the
instant heal only, the EX variants of Soothing Surge and Aegis Veil are never
pressed, and she has no 8 m leash.

### 5.8 The budget hit

One match of the 4800 did not end: quillon v skerrow, 3v3, arena01, with
[lumeth, hargrim], seed 6. Replayed through `playMatch` on the final kits (the
same on #124's head, which changed no kit) it is the stall of issue #123: from
tick 7521 the two surviving Hargrims stand 2.14 m apart. Counted over all six
champions, no button was pressed after tick 7465 (the last press was a
Quillon's); counted over the two Hargrims, their last presses are at ticks 448
and 420. No cast follows, so round 1 never ends.
It is a bot stall and not a kit effect, and no kit number was chased for it.
The longest match that did end took 25 954 ticks.

One dropped run of #124 had more: Chain Hook's windup, 18 to 12 ticks (run H3),
gave 8 budget hits in the same cell (seeds 34, 42, 72, 80, 82, 88, 90 and 98).
Each replayed to tick 20 000 is the same stall, counted over the two Hargrims:
both are alive in round 1, 1.0 to 2.1 m apart, and their last presses fall at
ticks 406 to 838 (the Lumeth on Skerrow's side presses until 7888 to 8080, so
counted over all six champions the last press is later than in seed 6). The
candidate was dropped by the rule, so the report has the one hit.

## 6. Changes made

Two numbers changed, both in #121; #124 changed none. The rates are X's, in
percent, from full `--out` runs (100 seeds on each of 24 configs); the summed
distance is the sum over the 24 cells of the distance to the 40 to 60 band.

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
  11.5 m (the range 9 plus the radius plus 0.5). Its measured effect is inside
  the noise of one run (section 3): the targets moved by 1.5 and 2.0 points (3
  and 4 more wins out of 200), and the fall of 3.5 in the sum is the net of 14
  moves of 0.5 to 4 points. The keep rests on the rule of decision 28 and not on
  a measured gain. Two side effects went the wrong way: Hargrim v Skerrow 2v2
  arena01, in band, fell from 45.0 to 41.0, and Lumeth v Quillon 2v2 arena01
  rose from 63.5 to 65.5, further out of the band.
- The report above is the result: 3 cells in band of 24, and the summed
  distance 675.5. By champion over its cells: Hargrim 16.4 (14.2 before),
  Lumeth 79.1 (77.9), Quillon 85.3 (86.4) and Skerrow 19.2 (21.5).
- #124 kept none of its 20 candidates (section 6.2), so that report is also its
  result: `npm run balance -- --check` on its head reproduces it.

### 6.1 Candidates tried and dropped

The rule of decision 28: a change is kept when its target cell moves toward
the band, no cell in band leaves it and the summed distance falls; one that
turns a pinned run, the fixture coverage or allocation.test.ts red is dropped.
Skerrow had 8 full runs and 1 kept change, Lumeth 9 and 1; neither champion
reached its cap of 4 kept changes or 10 runs, since every candidate screened on
the way (at 40 seeds) either failed a check or moved nothing the rule could
use. The fixture coverage and allocation.test.ts were run on a candidate before
its full run only from some point on: Skerrow runs 3 and 6 and Lumeth run 2 were
checked after theirs, and each of the three fails the coverage. Run 7 was
checked first and fails as well; every remaining candidate with a full run
passes both.

| Champion | Number | Old to new | Run | Why dropped |
|----------|--------|------------|-----|-------------|
| Skerrow | M1 damage | 9 to 8 | 1 | Lumeth v Quillon 3v3 arena01 left the band (56.5 to 62.0). |
| Skerrow | E cooldown | 420 to 240 | 3 | Three cells left the band; the fixture coverage is red too. |
| Skerrow | M1 damage | 9 to 8 | 4 | Target cell moved away (34.5 to 33.0); the sum fell by 1. |
| Skerrow | Q silence | 90 to 120 ticks | 5 | The sum rose to 703.0; two cells left the band. |
| Skerrow | M2 cooldown | 180 to 300 | 6 | The sum rose from 679.0 to 687.5; the fixture coverage is red too (the fixture is a Skerrow mirror, so on any base). |
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
header), so a coverage miss ends a candidate (at the time; #128 added the
tool, and section 6.3 gives the rule for the next pass).

### 6.2 Candidates of #124, all dropped

The rule is decision 28's with the threshold of decision 32: a change is kept
when its target cell moves toward the band, no cell in band leaves it, and the
summed distance falls by at least 7.0 points (the 95 percent half-width of one
cell at n = 200, section 3). A candidate that turns a pinned run, the fixture
coverage or allocation.test.ts red is dropped with no full run. The lists are
the architect's, Quillon's ten and then Hargrim's ten, one number each (with
any field its EX shares); a 40-seed screen could only have ordered them and
none was run. Nothing was kept, so every full run (100 seeds on 24 configs)
is measured against the report above, the sum 675.5. The cap is 4 kept changes
and 10 full runs per champion: Quillon used 2 runs and Hargrim 5, and neither
kept one.

Before a full run each candidate met these pre-checks: the fixture coverage
and oracle of the changed kit (roster-fixtures.test.ts), allocation.test.ts
(green for all 20), the pinned runs of headless-kits.test.ts and
deadlock.test.ts, the qualitative clauses of lumeth.test.ts (its end ticks,
terms and budgets, and the four end ticks of harness.test.ts, are figures a
kept change would update, so they are not drops) and the two-seed run of
harness.test.ts with no budget hit (green for all 20).

The seven candidates that got a full run (the cell is X's rate before and
after):

| Champion | Run | Number | Old to new | Target cell | Sum before to after | Result |
|----------|-----|--------|------------|-------------|---------------------|--------|
| Quillon | Q1 | Hush Ward (R) absorb | 30 to 20 | hargrim v quillon, 2v2 arena01, 0.0 to 0.0 | 675.5 to 692.0 | dropped: the target did not move; lumeth v quillon 3v3 arena01 (58.5 to 61.5) and hargrim v skerrow 3v3 arena02 (44.5 to 38.5) left the band |
| Quillon | Q2 | Lance (E) damage | 28 to 22 | quillon v skerrow, 3v3 arena02, 95.0 to 95.5 | 675.5 to 690.0 | dropped: the target moved away; lumeth v quillon 3v3 arena01 left the band (58.5 to 65.0) |
| Hargrim | H1 | Iron Hide (R) absorb | 40 to 60 | hargrim v quillon, 2v2 arena02, 0.0 to 1.0 | 675.5 to 691.0 | dropped: the sum rose by 15.5 (no cell left the band; hargrim v skerrow 3v3 arena01 63.5 to 70.0 and lumeth v quillon 2v2 arena01 65.5 to 72.5) |
| Hargrim | H2 | Chain Hook (E) damage | 14 to 20 | hargrim v lumeth, 3v3 arena02, 1.0 to 1.0 | 675.5 to 675.5 | dropped: the target did not move and the sum did not fall |
| Hargrim | H3 | Chain Hook (E) windup | 18 to 12 ticks | hargrim v quillon, 3v3 arena01, 3.5 to 2.5 | 675.5 to 699.4 | dropped: the target moved away and three cells left the band (no cell in band); 8 budget hits (5.8) |
| Hargrim | H4 | Ground Slam (M2) slow | 30 to 40 percent | hargrim v quillon, 3v3 arena02, 6.5 to 4.5 | 675.5 to 702.5 | dropped: the target moved away; hargrim v skerrow 2v2 arena01 left the band (41.0 to 35.5) |
| Hargrim | H5 | Iron Hide (R) cooldown | 720 to 540 | hargrim v quillon, 2v2 arena01, 0.0 to 0.0 | 675.5 to 685.0 | dropped: the target did not move and the sum rose by 9.5 |

The thirteen that failed a pre-check and got no run (the fixture coverage
names what the changed kit's replay no longer shows, as in
roster-fixtures.test.ts; the search that found the committed fixtures is not in
the repository, so a miss ends a candidate (at the time; #128 added the tool,
section 6.3)):

| Champion | Number | Old to new | Target cell | The red pre-check |
|----------|--------|------------|-------------|-------------------|
| Quillon | Skip (SPACE) cooldown | 540 to 720 | Q v S 2v2 arena01 | Fixture coverage: no energyGained of Bind Shot EX or of Lance EX. |
| Quillon | Bind Shot (M2) slow | 40 to 30 percent | H v Q 2v2 arena02 | Fixture coverage: no energyGained of Lance or of Lance EX. |
| Quillon | Rod Bolt (M1) reach | lifetime 38 to 33 ticks, 13.93 to 12.1 m | L v Q 2v2 arena02 | lumeth.test.ts, no-stall clause: a bot stalled 3392 ticks in engage from tick 2650 (3v3, arena01). |
| Quillon | Rod Bolt (M1) damage | 11 to 9 | Q v S 2v2 arena02 | lumeth.test.ts, no-stall clause: a bot stalled 706 ticks in idle from tick 4635 (3v3, arena02). |
| Quillon | Snare Orb (Q) cooldown | 720 to 960 | H v Q 3v3 arena01 | Fixture coverage: no energyGained of Lance. |
| Quillon | Rod Bolt (M1) cooldown | 30 to 36 | L v Q 3v3 arena02 | Fixture coverage (Bind Shot EX, Lance, Lance EX), and the 3v3 ultimate run of headless-kits.test.ts (no F cast). |
| Quillon | Bind Shot (M2) slow duration | 90 to 60 ticks | H v Q 3v3 arena02 | Fixture coverage: no energyGained of Bind Shot EX. |
| Quillon | Lance (E) windup | 36 to 48 ticks | Q v S 3v3 arena01 | Fixture coverage: no energyGained of Bind Shot EX, Lance or Lance EX. |
| Hargrim | Chain Hook (E) cooldown | 540 to 360 | H v L 2v2 arena01 | lumeth.test.ts, no-stall clause: a bot stalled 123 ticks in retreat against the 120 allowed, from tick 7723 (3v3, arena02). |
| Hargrim | Chain Hook (E) slow duration | 60 to 120 ticks | H v L 2v2 arena02 | Fixture coverage: no energyGained of Rush EX. |
| Hargrim | Rush (SPACE) cooldown | 420 to 300 | H v Q 2v2 arena01 | Fixture coverage: no energyGained of Ground Slam EX. |
| Hargrim | Maul Swing (M1) damage | 12 to 16 | H v L 3v3 arena01 | lumeth.test.ts, no-stall clause: a bot stalled 6003 ticks in kite from tick 956 (2v2, arena02). |
| Hargrim | Chain Hook (E) speed and lifetime | 20 to 25 m/s, 27 to 22 ticks | H v L 2v2 arena01 | Fixture coverage: no energyGained of Ground Slam or of Rush EX. |

### 6.3 The rule for the next pass: the fixture search

#128 put the search in the repository: `npm run fixtures:search -- <kit>`
(testing.md, "Fixture search"). The clause of decisions 28 and 32 that dropped
a candidate on a red fixture coverage rested on there being no search, so it
changes for the next pass; the records of 6.1 and 6.2 stand as they were
tried.

- A candidate whose fixture coverage turns red gets its fixture rebuilt with
  `npm run fixtures:search -- <kit>` in the same commit as the kit change, with
  the roster-v1 text and the roster-kits.test.ts literals, and the pre-checks
  continue.
- The candidate is still dropped when the tool exits 1: the first attempt that
  covers everything has an oracle problem, or no attempt within the limit
  covers. The tool stops on the oracle problem instead of skipping that
  attempt, so the oracle check stays a drop.
- A dropped candidate takes its rebuilt fixture with it: the file goes back to
  the committed one with the kit change.
- A change whose coverage stays green regenerates only the checksums, by the
  method in the header of roster-fixtures.test.ts. No fixture is rebuilt for
  it.
- A rebuilt fixture is a new script, so every one of its checkpoints moves and
  its replay checksums are new: the pull request replays it in the
  linux/amd64 container (testing.md, "Fixture search").

What either change does to `tools/fixtures/reproduce.test.ts`, which pins the
attempt each committed fixture is the output of (decision 13 of batch #134). A
red row after a kit change is not a failed pre-check: it says that row's pin is
out of date, and it is no ground to drop a candidate.

- After a rebuild, the row takes the new attempt the tool printed, its kit is
  the current one, and the header of roster-fixtures.test.ts records the new
  attempt.
- After a green change, the row is pinned on the kit as searched: the number
  the committed script was searched on goes back in memory, as the Skerrow and
  Lumeth rows are pinned today, with the change that moved it named in a
  comment, and the checkpoints written are those of the current kit. A search
  on the current kit may settle on another attempt without any rebuild (#125
  moved Skerrow from attempt 6 to 2 and Lumeth from 2 to 5). The header
  records which kit numbers each search ran on.

## 7. How to regenerate

- `npm run balance` plays all 4800 matches and writes the block of section 4.
  It needs Node 22.15 or later (the resolve hook is `module.registerHooks`) and
  stops with a message below that. A full run takes about 5.5 minutes on one
  core of an Apple silicon laptop and 12 to 16 minutes on the runner of the
  manual workflow (runs 38990892639 at 933 s, 38997052269 at 953 s and
  39005677735 at 737 s); the wall time goes to stdout and never into the file.
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
