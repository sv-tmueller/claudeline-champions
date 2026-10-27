# Balance: the bands, the baseline, the tuning passes and the six-kit report

## 1. Status and sources

Status: the harness and the baseline of batch #105 (issue #109), its first
tuning pass (issue #121), the Hargrim and Quillon pass (issue #124) and the
six-kit report of batch 15 (issue #189, section 5.9). The
first pass moved two numbers, one of Skerrow's and one of Lumeth's (section 6),
and the second moved none: each of its 20 candidates was dropped, by a
pre-check or by its full run (section 6.2). Sections 5 and 6 record the report
after the two numbers of #121, with 3 of 24 cells in band, where the baseline
had 1, which is also the report of #124's head, since no kit changed. Every
cell is in band or accepted with its reason there. The report in section 4 was
regenerated after the bots began to dodge (issue #137): 5 of 24 cells in band
(the note of section 4). The six-kit report added Ondrel and Brimwick to the
harness: the block of section 4 is now its 60 cells, 8 of them in band, and
section 5.9 reads it. Sections 5.1 to 5.8 and 6 stay the record of the four-kit
report at 9a9c653 and of the passes made on it.

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
- Decision 3 of batch #147 put Ondrel and Brimwick in the harness at the
  six-kit report, and decision 3 of batch #193 set how it is played: about 200
  matches a cell, one job a mode on the runner (section 3). The report is #189
  (the tools half is #195), and the question of Brimwick's counter web, which
  #188 filed against [roster-v2.md](roster-v2.md) section 3, is read in section
  5.9.
- [roster-v2.md](roster-v2.md) holds the two kits of #148 and their counter web
  (section 1), the intended counters of the six-kit report; its section 6
  forecasts how the bots will bias it.
- [roster-v1.md](roster-v1.md) holds the kits and the intended counters (the
  "Intended counters" lists); its section 6, "Balance notes", reads the
  baseline against them.
- [bots.md](../architecture/bots.md) holds the bots whose play is measured.

## 2. The bands

- A cell is one mode (2v2 or 3v3), one arena and one pairing, so there are
  60 cells with the six kits of the harness roster and two arenas, 15 pairings
  a mode and arena (the 24 of the four v1 kits are among them).
- The band is 40 to 60 percent inclusive on X's win rate in the cell. The test
  is on the exact rate (wins times 100 against 40 and 60 times the decided
  matches), not on the rounded figure in the table.
- X is the first kit of the pairing in the order of the kit files of the
  harness roster (`brimwick`, `hargrim`, `lumeth`, `ondrel`, `quillon`,
  `skerrow`). A rate under 50 means Y is ahead.
- A roster counter (an intended counter in roster-v1.md, or in the web of
  roster-v2.md section 1) is read as the favoured side inside the band: the
  favourite at 50 to 60 percent and the other side at 40 to 50. A favourite
  above 60 is too strong, and an underdog above 60 percent is an inverted
  counter.

## 3. The method

- **Pairing.** An unordered pair X v Y of different kits of the harness
  roster, so 15 pairings with six kits. The roster is the fixed list
  `HARNESS_KITS` in `tools/balance/inputs.ts`, the six kits of `data/kits` in
  file order, and a listed kit with no file is an error. Ondrel and Brimwick
  (#148) joined the four v1 kits in the six-kit report (#189; [decision 3 of
  batch #147](https://github.com/sv-tmueller/claudeline-champions/issues/147#issuecomment-6273786667)),
  so the 60 cells, the 11 760 matches and the block of section 4 are those of
  six kits. "Pairing" is read as the matchup of two champions, as decision 6
  words it, and not as the duo of roster-v1.md section 5.
- **Fills.** Both teams get the same fill, so the pair is the only difference.
  In 2v2 the teams are [X, Z] v [Y, Z] for each Z outside the pair: four fills
  with six kits (two with four), pooled in the cell and each shown in the Fills
  column. In 3v3 they are [X, Z, W] v [Y, Z, W] for each ordered pair of two
  kits outside the pair: twelve fills with six kits (two with four), both
  orders of each two, pooled and each shown, because the order sets the spawn
  slots (see Noise). X takes the first spawn slot of its team.
- **Sides.** Odd seeds put X on team A and even seeds on team B, so each side
  gets half of the matches. The table shows X's wins as A and as B.
- **Seeds.** Each cell plays about 200 matches, whatever its fills: the seeds of
  a config are 1 to the largest even number at or under 200 divided by the
  cell's fills, worked out per mode (`seedSchedule` in
  `tools/balance/harness.ts`). With four kits a cell has 2 fills in either mode,
  so it is seeds 1 to 100 for each config: 24 configs, 200 matches in every cell
  and 4800 in all. With six kits it is 50 seeds for each of the 4 fills of a
  2v2 cell (200 matches) and 16 for each of the 12 fills of a 3v3 cell (192
  matches): 60 cells and 11 760 matches in all (6000 in 2v2 and 5760 in 3v3).
  The count is even so that X plays each side equally often. When the
  two modes get the same count the head of the block says "Seeds 1 to N for each
  config"; when they differ it names each mode's count, and the Seeds / matches
  column states them in any case. Decision 3 of batch #193 set this: it amends
  decision 21 of batch #105 ("seeds 1 to 100") and reads decision 6 of batch #12
  as "about 200 matches a cell", because 100 seeds on every fill is 48 000
  matches at six kits. The noise below and the keep threshold of decision 32
  stand. The match seed is the seed and the bot of champion id `i` gets
  `seed * 100 + i`, the rule of the client's `bot-driver.ts`. The sim never
  draws from its own random state, so the bot seeds are the only source of
  variation.
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
  Gone since #137 (#123, 2026-10-26): the stall was a Hargrim at rest one ulp
  inside the centre pillar's inflated circle, from which the bots of 9a9c653
  found no plan, and it began at tick 480, not 7521. The tolerance of #137
  reads that as touching, and main's bots end this match at tick 5096 (bots.md,
  Testing).
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
  about 7 points at n = 200 (every cell, 192 in a six-kit 3v3 cell) around 50
  percent, and about 10 at n = 100 (one fill alone, as the four-kit report
  had it). A six-kit fill has fewer matches, 50 in 2v2 (about 14 points) and
  16 in 3v3 (about 24), so one fill of a six-kit cell is read with that
  distance. A cell within the 7 points of 40 or 60 cannot be told from the
  band by one run. Two things were measured once with scratch
  code that is not part of the tool (X's rate over 100 matches, in the
  four-kit report). First, the
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
line names the commit the sources were read at. It is the six-kit report
(#189, batch 15): 60 cells and 11 760 matches, 8 cells in band (5 of the 36
cells with Ondrel or Brimwick and 3 of the 24 four-kit cells), the summed
distance of the 60 cells to the band 1561.3 points (883.9 in the 36 new cells
and 677.4 in the 24 four-kit cells, 666.5 in the four-kit report), and no
budget hit. Per champion over all of its cells: Brimwick 52.3, Hargrim 11.4,
Lumeth 89.1, Ondrel 60.1, Quillon 73.3 and Skerrow 13.7. No kit, sim or bots
rule changed since the four-kit report: its 24 cells moved because Ondrel and
Brimwick are new fills (section 5.9).

What follows, up to the block, is the history of the four-kit report that this
one replaces. That report was the one after the tuning pass of #121, and of
#124, which changed no kit, regenerated after the dodge of #137 (the note
below), and "the block" in that history is the four-kit block. The baseline,
before any number moved, had 1
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
at 9a9c653 and are for the second tuning pass (batch 12) to read again. The
four stalls of 6.2 that turned the no-stall clause red for four candidates are
gone with the tolerance of #137 and pinned (#129, bots.md, Testing); their four
rows are annotated in 6.2, and the four-kit block was as generated.

Note (2026-10-26, #123): the premise above that the rule behind the stall of
#123 is unchanged was wrong. The stall is the same state as those four, a
champion one ulp inside an inflated obstacle, so it is gone with the tolerance
of #137 as well and pinned (#123, bots.md, Testing). No bots rule was missing
and the four-kit block was as generated: no source it reads changed.

<!-- balance:report -->
Generated by `npm run balance` from the sources at `3704221`.

Seeds 1 to 50 for each 2v2 config and 1 to 16 for each 3v3 config, every bot at the normal tier. X's rate
is the share of the decided matches X won, in percent; the band is 40 to 60
inclusive, on the exact rate.
Cells in band: 8 of 60.

### Cells

| Mode | Arena | X v Y | Fills (X's rate) | Seeds / matches | X rate % | X wins as A | X wins as B | Verdict | Round mean | Round longest | Sudden-death rounds | First hit mean | Drawn rounds | Budget hits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2v2 | arena01 | brimwick v hargrim | lumeth 72.0, ondrel 100.0, quillon 100.0, skerrow 82.0 | 50 / 200 | 88.5 | 84/100 | 93/100 | outside | 992 | 3415 | 0 of 715 | 128 | 1 | 0 |
| 2v2 | arena01 | brimwick v lumeth | hargrim 2.0, ondrel 14.0, quillon 2.0, skerrow 8.0 | 50 / 200 | 6.5 | 9/100 | 4/100 | outside | 1153 | 3606 | 4 of 756 | 131 | 0 | 0 |
| 2v2 | arena01 | brimwick v ondrel | hargrim 78.0, lumeth 12.0, quillon 52.0, skerrow 54.0 | 50 / 200 | 49.0 | 52/100 | 46/100 | in band | 1058 | 5087 | 2 of 783 | 123 | 1 | 0 |
| 2v2 | arena01 | brimwick v quillon | hargrim 28.0, lumeth 10.0, ondrel 16.0, skerrow 14.0 | 50 / 200 | 17.0 | 18/100 | 16/100 | outside | 1017 | 3439 | 0 of 772 | 131 | 1 | 0 |
| 2v2 | arena01 | brimwick v skerrow | hargrim 100.0, lumeth 74.0, ondrel 100.0, quillon 100.0 | 50 / 200 | 93.5 | 93/100 | 94/100 | outside | 917 | 2266 | 1 of 678 | 122 | 0 | 0 |
| 2v2 | arena01 | hargrim v lumeth | brimwick 0.0, ondrel 0.0, quillon 0.0, skerrow 0.0 | 50 / 200 | 0.0 | 0/100 | 0/100 | outside | 956 | 1780 | 1 of 629 | 121 | 1 | 0 |
| 2v2 | arena01 | hargrim v ondrel | brimwick 0.0, lumeth 2.0, quillon 0.0, skerrow 0.0 | 50 / 200 | 0.5 | 0/100 | 1/100 | outside | 954 | 2843 | 0 of 649 | 119 | 0 | 0 |
| 2v2 | arena01 | hargrim v quillon | brimwick 0.0, lumeth 0.0, ondrel 0.0, skerrow 0.0 | 50 / 200 | 0.0 | 0/100 | 0/100 | outside | 884 | 2906 | 0 of 631 | 125 | 0 | 0 |
| 2v2 | arena01 | hargrim v skerrow | brimwick 64.0, lumeth 18.0, ondrel 54.0, quillon 74.0 | 50 / 200 | 52.5 | 44/100 | 61/100 | in band | 1235 | 4901 | 0 of 820 | 119 | 12 | 0 |
| 2v2 | arena01 | lumeth v ondrel | brimwick 66.0, hargrim 84.0, quillon 82.0, skerrow 84.0 | 50 / 200 | 79.0 | 81/100 | 77/100 | outside | 1116 | 2325 | 1 of 806 | 127 | 2 | 0 |
| 2v2 | arena01 | lumeth v quillon | brimwick 46.0, hargrim 90.0, ondrel 52.0, skerrow 92.0 | 50 / 200 | 70.0 | 68/100 | 72/100 | outside | 1132 | 4504 | 0 of 779 | 129 | 1 | 0 |
| 2v2 | arena01 | lumeth v skerrow | brimwick 100.0, hargrim 98.0, ondrel 100.0, quillon 100.0 | 50 / 200 | 99.5 | 100/100 | 99/100 | outside | 862 | 1372 | 0 of 628 | 123 | 1 | 0 |
| 2v2 | arena01 | ondrel v quillon | brimwick 18.0, hargrim 10.0, lumeth 42.0, skerrow 16.0 | 50 / 200 | 21.5 | 23/100 | 20/100 | outside | 1052 | 4213 | 1 of 789 | 131 | 1 | 0 |
| 2v2 | arena01 | ondrel v skerrow | brimwick 100.0, hargrim 100.0, lumeth 100.0, quillon 100.0 | 50 / 200 | 100.0 | 100/100 | 100/100 | outside | 866 | 2437 | 0 of 643 | 121 | 0 | 0 |
| 2v2 | arena01 | quillon v skerrow | brimwick 100.0, hargrim 100.0, lumeth 98.0, ondrel 100.0 | 50 / 200 | 99.5 | 99/100 | 100/100 | outside | 829 | 1840 | 1 of 638 | 132 | 1 | 0 |
| 2v2 | arena02 | brimwick v hargrim | lumeth 98.0, ondrel 100.0, quillon 100.0, skerrow 98.0 | 50 / 200 | 99.0 | 99/100 | 99/100 | outside | 1002 | 2833 | 0 of 680 | 107 | 1 | 0 |
| 2v2 | arena02 | brimwick v lumeth | hargrim 0.0, ondrel 22.0, quillon 16.0, skerrow 2.0 | 50 / 200 | 10.0 | 8/100 | 12/100 | outside | 1086 | 2494 | 0 of 736 | 111 | 0 | 0 |
| 2v2 | arena02 | brimwick v ondrel | hargrim 66.0, lumeth 52.0, quillon 68.0, skerrow 38.0 | 50 / 200 | 56.0 | 54/100 | 58/100 | in band | 1053 | 5185 | 0 of 837 | 107 | 1 | 0 |
| 2v2 | arena02 | brimwick v quillon | hargrim 8.0, lumeth 24.0, ondrel 12.0, skerrow 8.0 | 50 / 200 | 13.0 | 19/100 | 7/100 | outside | 935 | 3864 | 1 of 785 | 113 | 2 | 0 |
| 2v2 | arena02 | brimwick v skerrow | hargrim 100.0, lumeth 96.0, ondrel 100.0, quillon 82.0 | 50 / 200 | 94.5 | 95/100 | 94/100 | outside | 915 | 2497 | 0 of 684 | 107 | 2 | 0 |
| 2v2 | arena02 | hargrim v lumeth | brimwick 0.0, ondrel 2.0, quillon 0.0, skerrow 2.0 | 50 / 200 | 1.0 | 1/100 | 1/100 | outside | 1018 | 2248 | 0 of 650 | 107 | 0 | 0 |
| 2v2 | arena02 | hargrim v ondrel | brimwick 0.0, lumeth 0.0, quillon 2.0, skerrow 0.0 | 50 / 200 | 0.5 | 0/100 | 1/100 | outside | 975 | 2632 | 0 of 651 | 109 | 1 | 0 |
| 2v2 | arena02 | hargrim v quillon | brimwick 0.0, lumeth 0.0, ondrel 0.0, skerrow 0.0 | 50 / 200 | 0.0 | 0/100 | 0/100 | outside | 914 | 2014 | 0 of 636 | 113 | 2 | 0 |
| 2v2 | arena02 | hargrim v skerrow | brimwick 42.0, lumeth 14.0, ondrel 30.0, quillon 44.0 | 50 / 200 | 32.5 | 28/100 | 37/100 | outside | 1130 | 3882 | 0 of 837 | 107 | 6 | 0 |
| 2v2 | arena02 | lumeth v ondrel | brimwick 78.0, hargrim 82.0, quillon 76.0, skerrow 96.0 | 50 / 200 | 83.0 | 78/100 | 88/100 | outside | 1051 | 2475 | 0 of 782 | 110 | 1 | 0 |
| 2v2 | arena02 | lumeth v quillon | brimwick 78.0, hargrim 56.0, ondrel 76.0, skerrow 62.0 | 50 / 200 | 68.0 | 74/100 | 62/100 | outside | 1078 | 2281 | 0 of 796 | 111 | 3 | 0 |
| 2v2 | arena02 | lumeth v skerrow | brimwick 100.0, hargrim 100.0, ondrel 100.0, quillon 100.0 | 50 / 200 | 100.0 | 100/100 | 100/100 | outside | 890 | 1960 | 0 of 645 | 107 | 0 | 0 |
| 2v2 | arena02 | ondrel v quillon | brimwick 40.0, hargrim 8.0, lumeth 62.0, skerrow 4.0 | 50 / 200 | 28.5 | 33/100 | 24/100 | outside | 953 | 3517 | 2 of 808 | 112 | 2 | 0 |
| 2v2 | arena02 | ondrel v skerrow | brimwick 98.0, hargrim 100.0, lumeth 96.0, quillon 86.0 | 50 / 200 | 95.0 | 92/100 | 98/100 | outside | 921 | 2996 | 0 of 680 | 109 | 0 | 0 |
| 2v2 | arena02 | quillon v skerrow | brimwick 100.0, hargrim 100.0, lumeth 100.0, ondrel 100.0 | 50 / 200 | 100.0 | 100/100 | 100/100 | outside | 857 | 1992 | 0 of 646 | 113 | 1 | 0 |
| 3v3 | arena01 | brimwick v hargrim | lumeth+ondrel 100.0, lumeth+quillon 81.3, lumeth+skerrow 100.0, ondrel+lumeth 100.0, ondrel+quillon 93.8, ondrel+skerrow 100.0, quillon+lumeth 93.8, quillon+ondrel 93.8, quillon+skerrow 100.0, skerrow+lumeth 93.8, skerrow+ondrel 100.0, skerrow+quillon 100.0 | 16 / 192 | 96.4 | 94/96 | 91/96 | outside | 1254 | 4376 | 0 of 663 | 118 | 1 | 0 |
| 3v3 | arena01 | brimwick v lumeth | hargrim+ondrel 6.3, hargrim+quillon 12.5, hargrim+skerrow 6.3, ondrel+hargrim 0.0, ondrel+quillon 12.5, ondrel+skerrow 0.0, quillon+hargrim 12.5, quillon+ondrel 18.8, quillon+skerrow 6.3, skerrow+hargrim 0.0, skerrow+ondrel 0.0, skerrow+quillon 6.3 | 16 / 192 | 6.8 | 8/96 | 5/96 | outside | 1264 | 2589 | 0 of 704 | 122 | 0 | 0 |
| 3v3 | arena01 | brimwick v ondrel | hargrim+lumeth 25.0, hargrim+quillon 25.0, hargrim+skerrow 62.5, lumeth+hargrim 31.3, lumeth+quillon 0.0, lumeth+skerrow 43.8, quillon+hargrim 43.8, quillon+lumeth 18.8, quillon+skerrow 31.3, skerrow+hargrim 56.3, skerrow+lumeth 25.0, skerrow+quillon 31.3 | 16 / 192 | 32.8 | 32/96 | 31/96 | outside | 1405 | 5243 | 6 of 761 | 120 | 0 | 0 |
| 3v3 | arena01 | brimwick v quillon | hargrim+lumeth 31.3, hargrim+ondrel 6.3, hargrim+skerrow 12.5, lumeth+hargrim 12.5, lumeth+ondrel 50.0, lumeth+skerrow 31.3, ondrel+hargrim 6.3, ondrel+lumeth 37.5, ondrel+skerrow 31.3, skerrow+hargrim 18.8, skerrow+lumeth 18.8, skerrow+ondrel 25.0 | 16 / 192 | 23.4 | 26/96 | 19/96 | outside | 1374 | 4193 | 6 of 750 | 125 | 0 | 0 |
| 3v3 | arena01 | brimwick v skerrow | hargrim+lumeth 100.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, lumeth+hargrim 100.0, lumeth+ondrel 100.0, lumeth+quillon 75.0, ondrel+hargrim 100.0, ondrel+lumeth 87.5, ondrel+quillon 100.0, quillon+hargrim 100.0, quillon+lumeth 93.8, quillon+ondrel 100.0 | 16 / 192 | 96.4 | 93/96 | 92/96 | outside | 1268 | 4208 | 1 of 655 | 121 | 1 | 0 |
| 3v3 | arena01 | hargrim v lumeth | brimwick+ondrel 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, ondrel+brimwick 0.0, ondrel+quillon 0.0, ondrel+skerrow 0.0, quillon+brimwick 0.0, quillon+ondrel 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+ondrel 0.0, skerrow+quillon 0.0 | 16 / 192 | 0.0 | 0/96 | 0/96 | outside | 1063 | 2040 | 0 of 599 | 117 | 0 | 0 |
| 3v3 | arena01 | hargrim v ondrel | brimwick+lumeth 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, lumeth+brimwick 6.3, lumeth+quillon 12.5, lumeth+skerrow 0.0, quillon+brimwick 6.3, quillon+lumeth 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+lumeth 6.3, skerrow+quillon 0.0 | 16 / 192 | 2.6 | 1/96 | 4/96 | outside | 1202 | 4566 | 1 of 632 | 117 | 0 | 0 |
| 3v3 | arena01 | hargrim v quillon | brimwick+lumeth 0.0, brimwick+ondrel 0.0, brimwick+skerrow 0.0, lumeth+brimwick 6.3, lumeth+ondrel 18.8, lumeth+skerrow 12.5, ondrel+brimwick 0.0, ondrel+lumeth 0.0, ondrel+skerrow 0.0, skerrow+brimwick 0.0, skerrow+lumeth 0.0, skerrow+ondrel 0.0 | 16 / 192 | 3.1 | 3/96 | 3/96 | outside | 1210 | 4741 | 0 of 654 | 121 | 0 | 0 |
| 3v3 | arena01 | hargrim v skerrow | brimwick+lumeth 50.0, brimwick+ondrel 56.3, brimwick+quillon 68.8, lumeth+brimwick 56.3, lumeth+ondrel 50.0, lumeth+quillon 37.5, ondrel+brimwick 50.0, ondrel+lumeth 62.5, ondrel+quillon 56.3, quillon+brimwick 50.0, quillon+lumeth 50.0, quillon+ondrel 50.0 | 16 / 192 | 53.1 | 48/96 | 54/96 | in band | 1575 | 5169 | 9 of 785 | 116 | 5 | 0 |
| 3v3 | arena01 | lumeth v ondrel | brimwick+hargrim 93.8, brimwick+quillon 68.8, brimwick+skerrow 100.0, hargrim+brimwick 87.5, hargrim+quillon 87.5, hargrim+skerrow 93.8, quillon+brimwick 56.3, quillon+hargrim 93.8, quillon+skerrow 81.3, skerrow+brimwick 75.0, skerrow+hargrim 93.8, skerrow+quillon 81.3 | 16 / 192 | 84.4 | 82/96 | 80/96 | outside | 1233 | 2702 | 2 of 754 | 120 | 2 | 0 |
| 3v3 | arena01 | lumeth v quillon | brimwick+hargrim 81.3, brimwick+ondrel 50.0, brimwick+skerrow 75.0, hargrim+brimwick 87.5, hargrim+ondrel 87.5, hargrim+skerrow 68.8, ondrel+brimwick 81.3, ondrel+hargrim 87.5, ondrel+skerrow 68.8, skerrow+brimwick 81.3, skerrow+hargrim 81.3, skerrow+ondrel 87.5 | 16 / 192 | 78.1 | 74/96 | 76/96 | outside | 1231 | 2468 | 0 of 769 | 124 | 2 | 0 |
| 3v3 | arena01 | lumeth v skerrow | brimwick+hargrim 100.0, brimwick+ondrel 100.0, brimwick+quillon 100.0, hargrim+brimwick 100.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, ondrel+brimwick 100.0, ondrel+hargrim 100.0, ondrel+quillon 100.0, quillon+brimwick 100.0, quillon+hargrim 100.0, quillon+ondrel 93.8 | 16 / 192 | 99.5 | 95/96 | 96/96 | outside | 1051 | 2071 | 0 of 598 | 120 | 0 | 0 |
| 3v3 | arena01 | ondrel v quillon | brimwick+hargrim 31.3, brimwick+lumeth 43.8, brimwick+skerrow 18.8, hargrim+brimwick 43.8, hargrim+lumeth 56.3, hargrim+skerrow 25.0, lumeth+brimwick 62.5, lumeth+hargrim 50.0, lumeth+skerrow 56.3, skerrow+brimwick 37.5, skerrow+hargrim 37.5, skerrow+lumeth 75.0 | 16 / 192 | 44.8 | 45/96 | 41/96 | in band | 1394 | 5235 | 4 of 791 | 126 | 0 | 0 |
| 3v3 | arena01 | ondrel v skerrow | brimwick+hargrim 100.0, brimwick+lumeth 93.8, brimwick+quillon 100.0, hargrim+brimwick 100.0, hargrim+lumeth 93.8, hargrim+quillon 93.8, lumeth+brimwick 100.0, lumeth+hargrim 100.0, lumeth+quillon 100.0, quillon+brimwick 100.0, quillon+hargrim 100.0, quillon+lumeth 100.0 | 16 / 192 | 98.4 | 94/96 | 95/96 | outside | 1204 | 5172 | 0 of 635 | 119 | 0 | 0 |
| 3v3 | arena01 | quillon v skerrow | brimwick+hargrim 100.0, brimwick+lumeth 93.8, brimwick+ondrel 100.0, hargrim+brimwick 100.0, hargrim+lumeth 100.0, hargrim+ondrel 100.0, lumeth+brimwick 93.8, lumeth+hargrim 100.0, lumeth+ondrel 81.3, ondrel+brimwick 100.0, ondrel+hargrim 100.0, ondrel+lumeth 100.0 | 16 / 192 | 97.4 | 94/96 | 93/96 | outside | 1191 | 5230 | 0 of 642 | 127 | 0 | 0 |
| 3v3 | arena02 | brimwick v hargrim | lumeth+ondrel 62.5, lumeth+quillon 93.8, lumeth+skerrow 100.0, ondrel+lumeth 56.3, ondrel+quillon 100.0, ondrel+skerrow 100.0, quillon+lumeth 93.8, quillon+ondrel 93.8, quillon+skerrow 87.5, skerrow+lumeth 75.0, skerrow+ondrel 100.0, skerrow+quillon 100.0 | 16 / 192 | 88.5 | 85/96 | 85/96 | outside | 1339 | 5247 | 2 of 719 | 106 | 1 | 0 |
| 3v3 | arena02 | brimwick v lumeth | hargrim+ondrel 18.8, hargrim+quillon 12.5, hargrim+skerrow 6.3, ondrel+hargrim 6.3, ondrel+quillon 6.3, ondrel+skerrow 18.8, quillon+hargrim 18.8, quillon+ondrel 18.8, quillon+skerrow 12.5, skerrow+hargrim 6.3, skerrow+ondrel 25.0, skerrow+quillon 6.3 | 16 / 192 | 13.0 | 14/96 | 11/96 | outside | 1285 | 2623 | 0 of 709 | 110 | 0 | 0 |
| 3v3 | arena02 | brimwick v ondrel | hargrim+lumeth 31.3, hargrim+quillon 25.0, hargrim+skerrow 62.5, lumeth+hargrim 50.0, lumeth+quillon 31.3, lumeth+skerrow 31.3, quillon+hargrim 56.3, quillon+lumeth 25.0, quillon+skerrow 56.3, skerrow+hargrim 87.5, skerrow+lumeth 25.0, skerrow+quillon 6.3 | 16 / 192 | 40.6 | 42/96 | 36/96 | in band | 1417 | 5316 | 3 of 800 | 107 | 1 | 0 |
| 3v3 | arena02 | brimwick v quillon | hargrim+lumeth 75.0, hargrim+ondrel 12.5, hargrim+skerrow 0.0, lumeth+hargrim 12.5, lumeth+ondrel 31.3, lumeth+skerrow 31.3, ondrel+hargrim 25.0, ondrel+lumeth 93.8, ondrel+skerrow 12.5, skerrow+hargrim 12.5, skerrow+lumeth 68.8, skerrow+ondrel 18.8 | 16 / 192 | 32.8 | 33/96 | 30/96 | outside | 1331 | 5138 | 5 of 749 | 110 | 0 | 0 |
| 3v3 | arena02 | brimwick v skerrow | hargrim+lumeth 93.8, hargrim+ondrel 100.0, hargrim+quillon 100.0, lumeth+hargrim 100.0, lumeth+ondrel 62.5, lumeth+quillon 93.8, ondrel+hargrim 100.0, ondrel+lumeth 43.8, ondrel+quillon 93.8, quillon+hargrim 100.0, quillon+lumeth 100.0, quillon+ondrel 75.0 | 16 / 192 | 88.5 | 85/96 | 85/96 | outside | 1312 | 4164 | 1 of 698 | 106 | 0 | 0 |
| 3v3 | arena02 | hargrim v lumeth | brimwick+ondrel 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, ondrel+brimwick 0.0, ondrel+quillon 0.0, ondrel+skerrow 0.0, quillon+brimwick 6.3, quillon+ondrel 6.3, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+ondrel 0.0, skerrow+quillon 0.0 | 16 / 192 | 1.0 | 1/96 | 1/96 | outside | 1135 | 1943 | 0 of 648 | 105 | 0 | 0 |
| 3v3 | arena02 | hargrim v ondrel | brimwick+lumeth 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, lumeth+brimwick 18.8, lumeth+quillon 6.3, lumeth+skerrow 0.0, quillon+brimwick 12.5, quillon+lumeth 18.8, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+lumeth 6.3, skerrow+quillon 0.0 | 16 / 192 | 5.2 | 3/96 | 7/96 | outside | 1290 | 4414 | 3 of 688 | 108 | 0 | 0 |
| 3v3 | arena02 | hargrim v quillon | brimwick+lumeth 0.0, brimwick+ondrel 0.0, brimwick+skerrow 0.0, lumeth+brimwick 0.0, lumeth+ondrel 37.5, lumeth+skerrow 0.0, ondrel+brimwick 6.3, ondrel+lumeth 18.8, ondrel+skerrow 0.0, skerrow+brimwick 0.0, skerrow+lumeth 18.8, skerrow+ondrel 0.0 | 16 / 192 | 6.8 | 9/96 | 4/96 | outside | 1278 | 3423 | 0 of 674 | 109 | 2 | 0 |
| 3v3 | arena02 | hargrim v skerrow | brimwick+lumeth 43.8, brimwick+ondrel 43.8, brimwick+quillon 37.5, lumeth+brimwick 56.3, lumeth+ondrel 50.0, lumeth+quillon 31.3, ondrel+brimwick 18.8, ondrel+lumeth 50.0, ondrel+quillon 31.3, quillon+brimwick 62.5, quillon+lumeth 56.3, quillon+ondrel 31.3 | 16 / 192 | 42.7 | 37/96 | 45/96 | in band | 1444 | 5010 | 3 of 796 | 105 | 7 | 0 |
| 3v3 | arena02 | lumeth v ondrel | brimwick+hargrim 100.0, brimwick+quillon 68.8, brimwick+skerrow 93.8, hargrim+brimwick 56.3, hargrim+quillon 100.0, hargrim+skerrow 81.3, quillon+brimwick 93.8, quillon+hargrim 87.5, quillon+skerrow 81.3, skerrow+brimwick 75.0, skerrow+hargrim 87.5, skerrow+quillon 100.0 | 16 / 192 | 85.4 | 80/96 | 84/96 | outside | 1216 | 5376 | 1 of 745 | 109 | 2 | 0 |
| 3v3 | arena02 | lumeth v quillon | brimwick+hargrim 68.8, brimwick+ondrel 75.0, brimwick+skerrow 93.8, hargrim+brimwick 75.0, hargrim+ondrel 81.3, hargrim+skerrow 50.0, ondrel+brimwick 81.3, ondrel+hargrim 81.3, ondrel+skerrow 87.5, skerrow+brimwick 81.3, skerrow+hargrim 50.0, skerrow+ondrel 68.8 | 16 / 192 | 74.5 | 73/96 | 70/96 | outside | 1264 | 2575 | 0 of 779 | 109 | 1 | 0 |
| 3v3 | arena02 | lumeth v skerrow | brimwick+hargrim 100.0, brimwick+ondrel 100.0, brimwick+quillon 100.0, hargrim+brimwick 100.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, ondrel+brimwick 100.0, ondrel+hargrim 100.0, ondrel+quillon 100.0, quillon+brimwick 100.0, quillon+hargrim 100.0, quillon+ondrel 100.0 | 16 / 192 | 100.0 | 96/96 | 96/96 | outside | 1100 | 1937 | 0 of 609 | 106 | 0 | 0 |
| 3v3 | arena02 | ondrel v quillon | brimwick+hargrim 12.5, brimwick+lumeth 100.0, brimwick+skerrow 18.8, hargrim+brimwick 31.3, hargrim+lumeth 93.8, hargrim+skerrow 6.3, lumeth+brimwick 50.0, lumeth+hargrim 81.3, lumeth+skerrow 68.8, skerrow+brimwick 18.8, skerrow+hargrim 0.0, skerrow+lumeth 68.8 | 16 / 192 | 45.8 | 48/96 | 40/96 | in band | 1389 | 5387 | 6 of 765 | 110 | 1 | 0 |
| 3v3 | arena02 | ondrel v skerrow | brimwick+hargrim 87.5, brimwick+lumeth 100.0, brimwick+quillon 100.0, hargrim+brimwick 93.8, hargrim+lumeth 93.8, hargrim+quillon 100.0, lumeth+brimwick 68.8, lumeth+hargrim 100.0, lumeth+quillon 75.0, quillon+brimwick 81.3, quillon+hargrim 50.0, quillon+lumeth 100.0 | 16 / 192 | 87.5 | 81/96 | 87/96 | outside | 1302 | 5085 | 2 of 692 | 108 | 0 | 0 |
| 3v3 | arena02 | quillon v skerrow | brimwick+hargrim 100.0, brimwick+lumeth 93.8, brimwick+ondrel 100.0, hargrim+brimwick 100.0, hargrim+lumeth 100.0, hargrim+ondrel 100.0, lumeth+brimwick 93.8, lumeth+hargrim 100.0, lumeth+ondrel 100.0, ondrel+brimwick 93.8, ondrel+hargrim 100.0, ondrel+lumeth 62.5 | 16 / 192 | 95.3 | 90/96 | 93/96 | outside | 1243 | 4674 | 3 of 668 | 110 | 0 | 0 |

### Budget hits

No match hit the budget of 60000 ticks.

### Champions

Win rate in percent over the cells the champion is in, as X or as Y.

| Champion | 2v2 arena01 | 2v2 arena02 | 3v3 arena01 | 3v3 arena02 | All |
| --- | --- | --- | --- | --- | --- |
| brimwick | 50.9 | 54.5 | 51.1 | 52.7 | 52.3 |
| hargrim | 12.9 | 7.0 | 12.5 | 13.4 | 11.4 |
| lumeth | 88.4 | 88.0 | 91.0 | 89.2 | 89.1 |
| ondrel | 58.6 | 56.8 | 64.7 | 60.4 | 60.1 |
| quillon | 78.2 | 78.1 | 69.6 | 67.1 | 73.3 |
| skerrow | 11.0 | 15.6 | 11.0 | 17.2 | 13.7 |
<!-- /balance:report -->

## 5. The cells after the tuning passes

Sections 5.1 to 5.8 read the four-kit report at 9a9c653; the block of section 4
is the six-kit report, which 5.9 reads.

After the tuning passes of #121 and #124 three cells are in the band and 21 are
outside. Each is in band or accepted with its reason, with its reading. The
rates are X's, from the report at 9a9c653. A reading names the limits of the
bots (bots.md, "Not built yet" and "Never pressed") that may account for a cell;
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
another champion than Lumeth; nobody dodged in the report of 9a9c653 (the bots
dodge since #137), so her bolts may land; Rally Cry is never pressed.

In 40-seed screens only Mend Bolt's cooldown (36 to 50 and to 70 ticks) and
its damage on an enemy (10 to 8) moved the cell by more than a few points
(2v2 arena02 to 15, 28 and 10 percent). The cooldown took the Lumeth v Quillon
cells down by 20 to 60 points and failed the fixture coverage at 70 ticks, and
the damage change did not pass the rule (section 6). The Hargrim numbers that
could close the gap were #124's, and none passed (section 6.2). The hook's
cooldown, 540 to 360 ticks (aimed at 2v2 arena01), turned the no-stall clause
of lumeth.test.ts red by 3 ticks (a bot stalled 123 ticks against the 120
allowed, in the 3v3 on arena02; gone since #137, see 6.2). The hook's slow
duration, 60 to 120 ticks (aimed at 2v2 arena02), and the hook's speed, 20 to
25 m/s, failed the Hargrim fixture coverage. Maul Swing's damage, 12 to 16
(aimed at 3v3 arena01), left a Quillon stalled for 6003 ticks in the 2v2 of
lumeth.test.ts on arena02 (gone since #137, see 6.2). The one that got a full
run, the hook's damage, 14 to 20 (run H2, aimed at 3v3 arena02), left the
target at 1.0 and the sum at 675.5, with 14 cells moved by at most 3.5 points.
So no Hargrim number moved the cells within the rule, and the limits above may
account.

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
nobody dodged in the report of 9a9c653, so Hargrim may walk into bolts, and
Rally Cry, his haste, is never pressed.

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
escape ready; nobody dodged in the report of 9a9c653.

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
its damage; gone since #137, see 6.2). Limits that may account:
the target is the nearest enemy (or the current one within 1 m of it), so in a
replayed Quillon and Hargrim against Skerrow and Hargrim match (2v2, arena01,
seed 1, round 1) Skerrow hit the other Hargrim while Quillon's bolts hit her
Hargrim nine times (eight Rod Bolts, six of them for the full 11 damage and two
absorbed by Iron Hide, and one Snare Orb) and Skerrow three times; Skerrow's
Lunge opener waits at 6 to 8 m and she has no Lunge away; the bot presses Quiet
Dart only at a target with an escape ready; nobody dodged in the report of
9a9c653.

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
has it; Skerrow waits at 6 to 8 m and has no Lunge away; nobody dodged in the
report of 9a9c653. The 3v3 cells pool two fill orders that differ widely
(26.0 and 63.0 on arena02).
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
arena01; gone since #137, see 6.2), and the cooldown failed the fixture coverage
and the pinned 3v3 ultimate run. The Quillon numbers that did get a full run
moved both arenas.
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

Gone since #137 (#123, 2026-10-26). All nine stalls, seed 6 and the eight H3
seeds, are one state, found on the bots of 9a9c653 (the same sim and kits as
main's): a Hargrim rests one ulp inside the inflated circle of the centre
pillar, 1.9999999999999998 m from its centre in seed 6 and 1.9999999999999996 m
in seed 98, and the bots found no free cell from it, so neither Hargrim planned
a walk and both stood. The stand began at tick 480 in seed 6, not 7521, and the
end ring played no part in it. The tolerance of #137 reads that position as
touching, and touching.test.ts pins the states of seeds 6 and 98, red without
it. The architect's scratch scripts (the #123 sub-plan, not in the repository)
give the rest: main's bots take over each of the nine states at tick 20 000,
move on their first acting think and end round 1 within 321 to 843 ticks, and
the whole H3 cell on main (seeds 1 to 100, both fills, 200 matches) has no
budget hit. Seed 6 ends at tick 5096 on main's bots and the shipped kits; it
also ends with the tolerance removed (at 5769), so the full match is no pin of
the tolerance. No row of the report above moves (no source it reads changed),
so it is not regenerated.

### 5.9 The six-kit report (batch 15, #189 and #188)

The block of section 4 plays six kits: 60 cells, 11 760 matches, each cell
about 200 (section 3), with no kit, sim-rule or bots change since 9a9c653 that
moves a four-kit cell. Ondrel and Brimwick (#148, with the bot profiles of
#165) are in the harness for the first time. Of the 60 cells 8 are in band: 5 of
the 36 cells that have a new kit (table below) and 3 of the 24 four-kit cells
(5 in the four-kit report). No match hit the budget. The summed distance of the
60 cells to the band is 1561.3 points, 883.9 of them in the 36 new cells. X is
the first kit in file order (`brimwick`, `hargrim`, `lumeth`, `ondrel`,
`quillon`, `skerrow`), so Brimwick is X in her five pairings and Ondrel's rate
is 100 minus X's in her pairings with Brimwick, Hargrim and Lumeth.

**The 36 new cells.** Their standing against the band and the noise (the 7
points of section 3; 192 matches in a 3v3 cell put its interval at about 7.1):
5 are in band, none is outside within the 7 points, 2 sit 7.2 from the band (at
the edge of the noise) and 29 are further out, 11.5 to 40.0 points. Each is one
run, never repeated on other seeds.

| Mode | Arena | X v Y | X rate | Standing |
|------|-------|-------|--------|----------|
| 2v2 | arena01 | brimwick v hargrim | 88.5 | outside, 28.5 from the band |
| 2v2 | arena01 | brimwick v lumeth | 6.5 | outside, 33.5 from the band |
| 2v2 | arena01 | brimwick v ondrel | 49.0 | in band |
| 2v2 | arena01 | brimwick v quillon | 17.0 | outside, 23.0 from the band |
| 2v2 | arena01 | brimwick v skerrow | 93.5 | outside, 33.5 from the band |
| 2v2 | arena01 | hargrim v ondrel | 0.5 | outside, 39.5 from the band |
| 2v2 | arena01 | lumeth v ondrel | 79.0 | outside, 19.0 from the band |
| 2v2 | arena01 | ondrel v quillon | 21.5 | outside, 18.5 from the band |
| 2v2 | arena01 | ondrel v skerrow | 100.0 | outside, 40.0 from the band |
| 2v2 | arena02 | brimwick v hargrim | 99.0 | outside, 39.0 from the band |
| 2v2 | arena02 | brimwick v lumeth | 10.0 | outside, 30.0 from the band |
| 2v2 | arena02 | brimwick v ondrel | 56.0 | in band |
| 2v2 | arena02 | brimwick v quillon | 13.0 | outside, 27.0 from the band |
| 2v2 | arena02 | brimwick v skerrow | 94.5 | outside, 34.5 from the band |
| 2v2 | arena02 | hargrim v ondrel | 0.5 | outside, 39.5 from the band |
| 2v2 | arena02 | lumeth v ondrel | 83.0 | outside, 23.0 from the band |
| 2v2 | arena02 | ondrel v quillon | 28.5 | outside, 11.5 from the band |
| 2v2 | arena02 | ondrel v skerrow | 95.0 | outside, 35.0 from the band |
| 3v3 | arena01 | brimwick v hargrim | 96.4 | outside, 36.4 from the band |
| 3v3 | arena01 | brimwick v lumeth | 6.8 | outside, 33.2 from the band |
| 3v3 | arena01 | brimwick v ondrel | 32.8 | outside, 7.2 from the band (the edge of the noise) |
| 3v3 | arena01 | brimwick v quillon | 23.4 | outside, 16.6 from the band |
| 3v3 | arena01 | brimwick v skerrow | 96.4 | outside, 36.4 from the band |
| 3v3 | arena01 | hargrim v ondrel | 2.6 | outside, 37.4 from the band |
| 3v3 | arena01 | lumeth v ondrel | 84.4 | outside, 24.4 from the band |
| 3v3 | arena01 | ondrel v quillon | 44.8 | in band |
| 3v3 | arena01 | ondrel v skerrow | 98.4 | outside, 38.4 from the band |
| 3v3 | arena02 | brimwick v hargrim | 88.5 | outside, 28.5 from the band |
| 3v3 | arena02 | brimwick v lumeth | 13.0 | outside, 27.0 from the band |
| 3v3 | arena02 | brimwick v ondrel | 40.6 | in band |
| 3v3 | arena02 | brimwick v quillon | 32.8 | outside, 7.2 from the band (the edge of the noise) |
| 3v3 | arena02 | brimwick v skerrow | 88.5 | outside, 28.5 from the band |
| 3v3 | arena02 | hargrim v ondrel | 5.2 | outside, 34.8 from the band |
| 3v3 | arena02 | lumeth v ondrel | 85.4 | outside, 25.4 from the band |
| 3v3 | arena02 | ondrel v quillon | 45.8 | in band |
| 3v3 | arena02 | ondrel v skerrow | 87.5 | outside, 27.5 from the band |

**The 24 four-kit cells, old rate against new.** The kits and the rules did not
change, so the movement is the effect of the added fills: a cell now pools four
2v2 fills or twelve 3v3 fills instead of two, and the fills with Brimwick or
Ondrel are new, and the seeds are fewer. Decision 3 of batch #193 asks that the
old fills be read at their own sample size. The old report played seeds 1 to
100 on each of its two fills; the new one plays seeds 1 to 50 (2v2) or 1 to 16
(3v3) on the same fills, a subset of the same seeds, so a fill is read at 50
matches (about 14 points of interval) or 16 (about 24). A scratch check, not
part of the tool, played Hargrim v Skerrow on arena01 in 2v2 with the fill
Quillon: seeds 1 to 100 give 62.0, the old report's figure, and seeds 1 to 50
give 74.0, the new one's, so the sim reproduces the old fills and the
difference is the seeds alone. The table splits each move into the old fills on
the new seeds (their mean, against the old rate: the seed subset) and the
fills with Ondrel or Brimwick (the pooled new rate against that mean):

| Mode | Arena | X v Y | Old rate | Old fills, new seeds | New rate | Seed subset | Added fills |
|------|-------|-------|----------|----------------------|----------|-------------|-------------|
| 2v2 | arena01 | hargrim v lumeth | 0.0 | 0.0 | 0.0 | +0.0 | +0.0 |
| 2v2 | arena01 | hargrim v quillon | 1.0 | 0.0 | 0.0 | -1.0 | +0.0 |
| 2v2 | arena01 | hargrim v skerrow | 40.0 | 46.0 | 52.5 | +6.0 | +6.5 |
| 2v2 | arena01 | lumeth v quillon | 85.5 | 91.0 | 70.0 | +5.5 | -21.0 |
| 2v2 | arena01 | lumeth v skerrow | 99.5 | 99.0 | 99.5 | -0.5 | +0.5 |
| 2v2 | arena01 | quillon v skerrow | 98.0 | 99.0 | 99.5 | +1.0 | +0.5 |
| 2v2 | arena02 | hargrim v lumeth | 0.5 | 1.0 | 1.0 | +0.5 | +0.0 |
| 2v2 | arena02 | hargrim v quillon | 0.5 | 0.0 | 0.0 | -0.5 | +0.0 |
| 2v2 | arena02 | hargrim v skerrow | 33.5 | 29.0 | 32.5 | -4.5 | +3.5 |
| 2v2 | arena02 | lumeth v quillon | 57.0 | 59.0 | 68.0 | +2.0 | +9.0 |
| 2v2 | arena02 | lumeth v skerrow | 99.5 | 100.0 | 100.0 | +0.5 | +0.0 |
| 2v2 | arena02 | quillon v skerrow | 100.0 | 100.0 | 100.0 | +0.0 | +0.0 |
| 3v3 | arena01 | hargrim v lumeth | 0.0 | 0.0 | 0.0 | +0.0 | +0.0 |
| 3v3 | arena01 | hargrim v quillon | 5.0 | 6.2 | 3.1 | +1.2 | -3.1 |
| 3v3 | arena01 | hargrim v skerrow | 50.5 | 43.8 | 53.1 | -6.8 | +9.4 |
| 3v3 | arena01 | lumeth v quillon | 77.0 | 75.0 | 78.1 | -2.0 | +3.0 |
| 3v3 | arena01 | lumeth v skerrow | 100.0 | 100.0 | 99.5 | +0.0 | -0.5 |
| 3v3 | arena01 | quillon v skerrow | 98.0 | 100.0 | 97.4 | +2.0 | -2.6 |
| 3v3 | arena02 | hargrim v lumeth | 0.0 | 0.0 | 1.0 | +0.0 | +1.0 |
| 3v3 | arena02 | hargrim v quillon | 9.5 | 9.4 | 6.8 | -0.1 | -2.6 |
| 3v3 | arena02 | hargrim v skerrow | 53.0 | 43.8 | 42.7 | -9.2 | -1.1 |
| 3v3 | arena02 | lumeth v quillon | 52.0 | 50.0 | 74.5 | -2.0 | +24.5 |
| 3v3 | arena02 | lumeth v skerrow | 100.0 | 100.0 | 100.0 | +0.0 | +0.0 |
| 3v3 | arena02 | quillon v skerrow | 99.0 | 100.0 | 95.3 | +1.0 | -4.7 |

The old fills moved by at most 12.0 points in 2v2 (Quillon as the fill of
Hargrim v Skerrow on arena01, 62.0 to 74.0; 53.0 to 44.0 on arena02) and by
10.7 in 3v3 (the fill [lumeth, quillon] of Hargrim v Skerrow on arena02, 42.0 to
31.3), inside the intervals above: that movement is the smaller sample and no
kit effect is claimed from it. Five cells moved by more than 7 points of the
pooled rate. In three of them the added fills moved it: Lumeth v Quillon in 2v2
on arena01 (85.5 to 70.0, the fills with a new kit average 49.0 against 91.0 for
the old ones), in 2v2 on arena02 (57.0 to 68.0, 9.0 of the move) and in 3v3 on
arena02 (52.0 to 74.5, 24.5 of the move, the fills with a new kit average 79.4
against 50.0). In Hargrim v Skerrow in 2v2 on arena01 (40.0 to 52.5) the
seed subset and the added fills each account for about 6 points (+6.0 and +6.5),
neither over the 7 of one cell's noise. In Hargrim v Skerrow in 3v3 on arena02
(53.0 to 42.7) the move is the seed subset (-9.2 on 16 seeds of the old 100, at
about 17 points of interval for two fills of 16) and the added fills moved it
by -1.1. The cells in band went from 5 to 3: Lumeth v Quillon on arena02, in 2v2
and in 3v3, left it for Lumeth ahead beyond 60 (68.0 and 74.5), and the three
that stay are Hargrim v Skerrow in 2v2 on arena01 and in 3v3 on both arenas.
The summed distance of the 24 cells went from 666.5 to 677.4. The 16 cells at 0
to 10 or 90 to 100 percent stayed there. Two cells changed side of 50, both
Hargrim v Skerrow (2v2 on arena01, 40.0 to 52.5, where Hargrim is now ahead as
roster-v1 has it, and 3v3 on arena02, 53.0 to 42.7); sections 5.2 to 5.7 stay
the record of the four-kit report.

**The two kits against roster-v2 section 1.** The web of that section, with the
measured rate of each kit in its four cells (2v2 arena01, 2v2 arena02, 3v3
arena01 and 3v3 arena02), and how many of the four are in band:

| Kit | Against | Intended | Rate of the kit | In band |
|-----|---------|----------|-----------------|---------|
| brimwick | hargrim | loses | 88.5 / 99.0 / 96.4 / 88.5 | 0 |
| brimwick | skerrow | loses | 93.5 / 94.5 / 96.4 / 88.5 | 0 |
| brimwick | quillon | beats | 17.0 / 13.0 / 23.4 / 32.8 | 0 |
| brimwick | lumeth | beats | 6.5 / 10.0 / 6.8 / 13.0 | 0 |
| brimwick | ondrel | loses | 49.0 / 56.0 / 32.8 / 40.6 | 3 |
| ondrel | hargrim | beats | 99.5 / 99.5 / 97.4 / 94.8 | 0 |
| ondrel | skerrow | beats | 100.0 / 95.0 / 98.4 / 87.5 | 0 |
| ondrel | quillon | loses | 21.5 / 28.5 / 44.8 / 45.8 | 2 |
| ondrel | lumeth | loses | 21.0 / 17.0 / 15.6 / 14.6 | 0 |
| ondrel | brimwick | beats | 51.0 / 44.0 / 67.2 / 59.4 | 3 |

Ondrel is on the intended side of 50 in all 20 of her cells but one (2v2 on
arena02 against Brimwick, 44.0, in band): she beats Hargrim and Skerrow by 87.5
to 100.0 and loses to Lumeth (14.6 to 21.0 as her own rate) and to Quillon (21.5
and 28.5 in 2v2; 44.8 and 45.8 in 3v3, in band). So her web holds, and
strongly against the two lowest of the six over all their cells (Hargrim 11.4
and Skerrow 13.7). Her 60.1 over all her cells is third of the six, after Lumeth
(89.1) and Quillon (73.3).

Brimwick's 20 cells are the inverse of roster-v2 section 3 on four pairings of
five, 16 cells in all, as #188 filed from the 720 matches of #165: she beats
Hargrim (88.5 to 99.0) and Skerrow (88.5 to 96.4), where the web has both beat
her, and loses to Quillon (13.0 to 32.8) and Lumeth (6.5 to 13.0), where the
web has her beat both. None of the 16 is in band: the nearest is 7.2 from it, at
the edge of the noise, and the other 15 are 16.6 or more from it, so the
inversion holds in both modes and on both arenas. Against Ondrel, where the web
has her lose, she is on the right side in three of four cells (49.0, 32.8 and
40.6, against 56.0), and three of the four are in band. The 720 matches of
#165 (bots.md, Testing) read the same four pairings the same way, so the two
measurements agree and the harness adds the arenas, the modes and the fills.
Her 52.3 over all her cells is fourth of six.

What the inversion is made of. The measured order of the six over all their
cells is Lumeth (89.1), Quillon (73.3), Ondrel (60.1), Brimwick (52.3), Skerrow
(13.7) and Hargrim (11.4). The web has Brimwick beat the top two and lose to the
bottom two, the reverse of that order, and the four v1 kits stood in the same
order in the report of 9a9c653 (Lumeth, Quillon, Skerrow, Hargrim), where three
of the six roster-v1 counters measure inverted in every cell. So the inversion
of Brimwick's web is the same finding as the inversion of the v1 web, and not
a finding about her alone: Hargrim and Skerrow, the divers her web counts as her
counters, are the two kits with the lowest rate over all their cells. The limits
of the bots that roster-v2 section 6 forecast, as this report bears on them: the
forecast that Ondrel "will probably measure strong" holds in part (third of six,
and 87.5 to 100.0 against the two lowest), and the report cannot say how much of
that is the bots, which steer around no area; the forecast that a placed area's
lead may miss a bot did not show as Brimwick measuring high, since she is mid
table and the Firecracker is not the number to look at first; her projectiles
face the dodge of #137, which the forecast was written before. No share of any
cell is stated as a cause of it, and none of the shares of her losses to Lumeth
(heals through her damage) or Quillon (a range of 9 to 13 m against her 7 to
10) was measured.

**The decision on #188.** Accepted as measured (decision 7 of batch #193,
[the comment](https://github.com/sv-tmueller/claudeline-champions/issues/193#issuecomment-6437420482)).
No tuning package is filed. The reason: Hargrim and Skerrow are the two lowest
kits over all 60 cells (11.4 and 13.7, against Lumeth's 89.1 and Quillon's
73.3) and the roster-v1 web is already inverted the same way, so the inversion
is the bots' strength order across the melee kits and not a Brimwick fault, and
tuning her would need 16 cells moved 17 to 39 points, past what rule 6.3 lets a
tuning package claim without a bots reading first. The 720-match table of #165
agrees. The open question is that bots-side reading: it goes to the next bots
package (with the carries of #192), which decides whether the profiles or the
kits move before any roster-v2 rewrite. Sections 1 and 3 of roster-v2.md stay
as the design intent, and #188 closes with PR #200. This package changes no kit
and no bots rule.

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
- The report at 9a9c653 is the result: 3 cells in band of 24, and the summed
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
is measured against the report at 9a9c653, the sum 675.5. The cap is 4 kept
changes and 10 full runs per champion: Quillon used 2 runs and Hargrim 5, and
neither kept one.

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
| Quillon | Rod Bolt (M1) reach | lifetime 38 to 33 ticks, 13.93 to 12.1 m | L v Q 2v2 arena02 | lumeth.test.ts, no-stall clause: a bot stalled 3392 ticks in engage from tick 2650 (3v3, arena01). Gone since #137 (#129): a champion one ulp inside an obstacle reads as touching, and on the bots of f0e8781 the clause passes, with a worst stall over lumeth.test.ts's four matches (2v2 and 3v3 on both arenas) of 26 ticks. |
| Quillon | Rod Bolt (M1) damage | 11 to 9 | Q v S 2v2 arena02 | lumeth.test.ts, no-stall clause: a bot stalled 706 ticks in idle from tick 4635 (3v3, arena02). Gone since #137 (#129): a champion one ulp inside an obstacle reads as touching, and on the bots of f0e8781 the clause passes, with a worst stall over lumeth.test.ts's four matches (2v2 and 3v3 on both arenas) of 25 ticks. |
| Quillon | Snare Orb (Q) cooldown | 720 to 960 | H v Q 3v3 arena01 | Fixture coverage: no energyGained of Lance. |
| Quillon | Rod Bolt (M1) cooldown | 30 to 36 | L v Q 3v3 arena02 | Fixture coverage (Bind Shot EX, Lance, Lance EX), and the 3v3 ultimate run of headless-kits.test.ts (no F cast). |
| Quillon | Bind Shot (M2) slow duration | 90 to 60 ticks | H v Q 3v3 arena02 | Fixture coverage: no energyGained of Bind Shot EX. |
| Quillon | Lance (E) windup | 36 to 48 ticks | Q v S 3v3 arena01 | Fixture coverage: no energyGained of Bind Shot EX, Lance or Lance EX. |
| Hargrim | Chain Hook (E) cooldown | 540 to 360 | H v L 2v2 arena01 | lumeth.test.ts, no-stall clause: a bot stalled 123 ticks in retreat against the 120 allowed, from tick 7723 (3v3, arena02). Gone since #137 (#129): a champion one ulp inside an obstacle reads as touching, and on the bots of f0e8781 the clause passes, with a worst stall over lumeth.test.ts's four matches (2v2 and 3v3 on both arenas) of 27 ticks. |
| Hargrim | Chain Hook (E) slow duration | 60 to 120 ticks | H v L 2v2 arena02 | Fixture coverage: no energyGained of Rush EX. |
| Hargrim | Rush (SPACE) cooldown | 420 to 300 | H v Q 2v2 arena01 | Fixture coverage: no energyGained of Ground Slam EX. |
| Hargrim | Maul Swing (M1) damage | 12 to 16 | H v L 3v3 arena01 | lumeth.test.ts, no-stall clause: a bot stalled 6003 ticks in kite from tick 956 (2v2, arena02). Gone since #137 (#129): a champion one ulp inside an obstacle reads as touching, and on the bots of f0e8781 the clause passes, with a worst stall over lumeth.test.ts's four matches (2v2 and 3v3 on both arenas) of 24 ticks. |
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
attempt each committed fixture is the output of (decision 13 of batch #134), is
set out below. A red row after a kit change is not a failed pre-check: it says
that row's pin is out of date, and it is no ground to drop a candidate.

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

- `npm run balance` plays all 11 760 matches and writes the block of section 4.
  It needs Node 22.15 or later (the resolve hook is `module.registerHooks`) and
  stops with a message below that. A full run takes about 14 minutes on one
  core of an Apple silicon laptop (850.6 s for the block of section 4, Node
  22.23.2; the cells are about 52 ms a 2v2 match and 92 ms a 3v3 match, so 2v2
  is about 5.3 minutes of it and 3v3 about 8.9). On the runner of the manual
  workflow the four-kit run took 12 to 16 minutes in one job (runs 38990892639
  at 933 s, 38997052269 at 953 s and 39005677735 at 737 s) and 6 min 28 s (2v2)
  and 11 min 26 s (3v3) in the check steps of the split (run 40461329366), 2.9
  to 3.1 times the local time in 3v3. At six kits the same factor projects to
  about 16 minutes for 2v2 and about 27 for 3v3, one mode a job. The wall time
  goes to stdout and never into the file.
- It refuses to write when `data/`, `packages/sim/src`, `packages/bots/src` or
  `tools/balance` differ from HEAD, because the head line would then name a
  commit that does not hold the sources. Commit the change first.
- `npm run balance -- --out <file>` writes the block to a file and touches no
  document: the way to explore. `-- --seeds N` plays the seeds 1 to N in every
  mode played, instead of the schedule of section 3.
- `npm run balance -- --mode 2v2` (or `3v3`) plays the cells of one mode only.
  It needs `--out <file>` or `--check`: a single mode never writes the document.
  With `--check` it compares that mode's cell rows and budget-hit lines with the
  committed block and nothing else (not the other mode's rows, the cells-in-band
  count or the Champions table, which the full check covers).
- `npm run balance -- --check` regenerates the block in memory and compares it
  with the committed one except for the head line. It exits 1 on a difference.
  Run it after any change to a kit, the sim or the bots.
- The report was reproduced with `--check` on macOS (Apple silicon) with Node
  22.23.2 (`played 11760 matches in 842.7 s`, the check of the committed block)
  and, for the four-kit report, Node 26.7.0. The linux/amd64 reproduction is the
  manual workflow `.github/workflows/balance.yml` (`workflow_dispatch` only,
  never on pull requests or pushes): trigger it with
  `gh workflow run balance.yml --ref <branch>`. It runs `npm ci` and
  `npm run balance -- --check --mode <mode>` on ubuntu, as two jobs side by
  side, one for 2v2 and one for 3v3 (a matrix by mode, so each stays inside its
  `timeout-minutes`: 45 for 2v2 and 75 for 3v3, set from the projection of the
  runner above, twice the check time of the mode because the failure step plays
  the mode again, and a margin; the run below confirmed them). The seeds are
  never lowered to fit the runner: they set the noise of section 3, and a
  timeout is raised instead. On a difference a job prints the differing rows of
  its mode (its cell rows and budget-hit lines, from a fresh `--out` against the
  committed block). A newer run on the same ref cancels the older one
  (`concurrency`). The run on the branch of #189 is
  [40475468875](https://github.com/sv-tmueller/claudeline-champions/actions/runs/40475468875),
  conclusion success: the `--check --mode 2v2` job ran 08:43:16 to 08:58:56 (15
  min 40 s, timeout 45) and the `--check --mode 3v3` job 08:43:15 to 09:09:54
  (26 min 39 s, timeout 75). Against the local 315 s and 532 s of the default
  schedule that is a factor of 3.0 in both modes (the job times include setup),
  so a replayed 3v3 check is about 53 minutes, inside 75. Bot output across
  platforms is not promised (bots.md, "Determinism"), so the macOS table is the
  report, and a table that differs on another platform gets a platform note here
  with the differing cells.
