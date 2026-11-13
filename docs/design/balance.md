# Balance: the bands, the baseline, the tuning passes and the seven-kit report

## 1. Status and sources

Status: the harness and the baseline of batch #105 (issue #109), its first
tuning pass (issue #121), the Hargrim and Quillon pass (issue #124), the six-kit
report of batch 15 (issue #189, section 5.9), the melee presses of batch 16
(issue #186, section 5.10) and the melee stand of batch 17 (issue #213, section
5.11). The first pass moved two numbers, one of Skerrow's and one of Lumeth's
(section 6), and the second moved none: each of its 20 candidates was dropped,
by a pre-check or by its full run (section 6.2). Sections 5 and 6 record the
report after the two numbers of #121, with 3 of 24 cells in band, where the
baseline had 1, which is also the report of #124's head, since no kit changed.
Every cell is in band or accepted with its reason there. The report in section 4
was regenerated after the bots began to dodge (issue #137): 5 of 24 cells in
band (the note of section 4). The six-kit report added Ondrel and Brimwick to
the harness, and section 5.9 reads the block it generated at 3704221 (60 cells,
8 of them in band). The block was regenerated after the bots stopped refusing a
melee press the sim lands (issue #186): 7 of 60 in band, read in section 5.10.
Arena03 (#238) then extended that block into the three-arena six-kit block of
#189 (section 5.11 reads it): 90 cells and 11 in band. The deadlock reach of
#222 (batch 18) regenerated that six-kit block on its branch (at 094b42e): 90
cells and 12 in band, read in section 5.13. The seven-kit report (issue #244),
on main and without the reach, added Durnhal and turned the energy orb on in
every cell, regenerating the block on the committed head: 126 cells and 15 in
band, read in section 5.12, which reads Durnhal's 36 cells against roster-v3.md
section 1 and lists what the orb moved. The block was regenerated after #187
capped the lead of a one-hit aim-placed area (at 4407c96): still 126 cells and
15 in band, read in the same section. It was regenerated once more on the merge
of #222 with main (at 0246028): still 126 cells and 15 in band, read against the
4407c96 block in section 5.13. Sections 5.1 to 5.8 and 6 stay the record of the
four-kit report at 9a9c653 and of the passes made on it.

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
- Batch #251 takes up Durnhal: #244 adds him to the harness at step 1.3 of
  roadmap #176 and turns the energy orb on in every cell (spec section 6), so
  section 4 is the seven-kit block and section 5.12 reads his 36 cells and the
  orb's effect on the 90 six-kit ones.
- [roster-v2.md](roster-v2.md) holds the two kits of #148 and their counter web
  (section 1), the intended counters of the six-kit report; its section 6
  forecasts how the bots will bias it.
- [roster-v3.md](roster-v3.md) holds Durnhal (section 1) and his counter web,
  the intent section 5.12 reads against the measured seven-kit cells; his bot
  profile is in [bots.md](../architecture/bots.md).
- [roster-v1.md](roster-v1.md) holds the kits and the intended counters (the
  "Intended counters" lists); its section 6, "Balance notes", reads the
  baseline against them.
- [bots.md](../architecture/bots.md) holds the bots whose play is measured.

## 2. The bands

- A cell is one mode (2v2 or 3v3), one arena and one pairing, so there are
  126 cells with the seven kits of the harness roster and three arenas, 21
  pairings a mode and arena (the 24 of the four v1 kits on the first two arenas
  and the 90 of the six-kit report are among them).
- The band is 40 to 60 percent inclusive on X's win rate in the cell. The test
  is on the exact rate (wins times 100 against 40 and 60 times the decided
  matches), not on the rounded figure in the table.
- X is the first kit of the pairing in the order of the kit files of the
  harness roster (`brimwick`, `durnhal`, `hargrim`, `lumeth`, `ondrel`,
  `quillon`, `skerrow`). A rate under 50 means Y is ahead.
- A roster counter (an intended counter in roster-v1.md, or in the web of
  roster-v2.md section 1) is read as the favoured side inside the band: the
  favourite at 50 to 60 percent and the other side at 40 to 50. A favourite
  above 60 is too strong, and an underdog above 60 percent is an inverted
  counter.

## 3. The method

- **Pairing.** An unordered pair X v Y of different kits of the harness
  roster, so 21 pairings with seven kits. The roster is the fixed list
  `HARNESS_KITS` in `tools/balance/inputs.ts`, the listed kits of `data/kits`
  in file order, and a listed kit with no file is an error. A kit file the list
  leaves out is not played: Wrenna's (#270) joins at step 3.4 of roadmap #176,
  and the block of section 4 is not regenerated before it. Ondrel and Brimwick
  (#148) joined the four v1 kits in the six-kit report (#189; [decision 3 of batch
  #147](https://github.com/sv-tmueller/claudeline-champions/issues/147#issuecomment-6273786667))
  and Durnhal (#204, his kit as data) joined them at step 1.3 of roadmap #176
  (#244), so the 126 cells, the 25 200 matches and the block of section 4 are
  those of seven kits on three arenas (arena03 of #238). The harness plays the
  standard match, so every cell sets the arena's orb point (`data/orbs.json`,
  spec section 6): the block of section 4 is the seven-kit one with the orb on
  and section 5.12 reads what the orb moved.
  "Pairing" is read as the matchup of two champions, as decision 6
  words it, and not as the duo of roster-v1.md section 5.
- **Fills.** Both teams get the same fill, so the pair is the only difference.
  In 2v2 the teams are [X, Z] v [Y, Z] for each Z outside the pair: five fills
  with seven kits (four with six, two with four), pooled in the cell and each
  shown in the Fills column. In 3v3 they are [X, Z, W] v [Y, Z, W] for each
  ordered pair of two kits outside the pair: twenty fills with seven kits
  (twelve with six, two with four), both orders of each two, pooled and each
  shown, because the order sets the spawn slots (see Noise). X takes the first
  spawn slot of its team.
- **Sides.** Odd seeds put X on team A and even seeds on team B, so each side
  gets half of the matches. The table shows X's wins as A and as B.
- **Seeds.** Each cell plays about 200 matches, whatever its fills: the seeds of
  a config are 1 to the largest even number at or under 200 divided by the
  cell's fills, worked out per mode (`seedSchedule` in
  `tools/balance/harness.ts`). With four kits a cell has 2 fills in either mode,
  so it is seeds 1 to 100 for each config: 24 configs, 200 matches in every cell
  and 4800 in all. With six kits it was 50 seeds for each of the 4 fills of a
  2v2 cell (200 matches) and 16 for each of the 12 fills of a 3v3 cell (192
  matches). With seven kits it is 40 seeds for each of the 5 fills of a 2v2
  cell and 10 for each of the 20 fills of a 3v3 cell, 200 matches in every cell:
  with three arenas, 126 cells and 25 200 matches in all (12 600 in each mode).
  The count is even so that X plays each side equally often. When the
  two modes get the same count the head of the block says "Seeds 1 to N for each
  config"; when they differ it names each mode's count, and the Seeds / matches
  column states them in any case. Decision 3 of batch #193 set this: it amends
  decision 21 of batch #105 ("seeds 1 to 100") and reads decision 6 of batch #12
  as "about 200 matches a cell", because 100 seeds on every fill is 48 000
  matches at six kits on two arenas (72 000 on three) and 157 500 at seven kits
  on three arenas. The noise below and the keep threshold of decision 32
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
  about 7 points at n = 200 (every cell, 200 in every seven-kit cell) around 50
  percent, and about 10 at n = 100 (one fill alone, as the four-kit report
  had it). A seven-kit fill has fewer matches, 40 in 2v2 (about 16 points) and
  10 in 3v3 (about 31), so one fill of a seven-kit cell is read with that
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

The block below is generated by `npm run balance`; do not edit it. The head line
names the commit the sources were read at, `0246028`. It is the seven-kit report
(#244, the tools half of batch #251) with the capped lead of #187 and the
deadlock reach of #222 (batch 18): 126 cells and 25 200 matches, 15 cells in
band (11 of the 90 cells the six kits share and 4 of Durnhal's 36), the summed
distance of the 126 cells to the band 3227.5 points (2266.5 in the 90 six-kit
cells, 961.0 in Durnhal's 36), and no budget hit. Per champion over all of its
cells: Brimwick 60.6, Durnhal 21.5, Hargrim 13.8, Lumeth 88.5, Ondrel 66.6,
Quillon 78.1 and Skerrow 20.9. It was regenerated on the merge of #222 with
main, with Durnhal in the harness roster, the energy orb on in every cell (spec
section 6), #187's cap on the one-hit area lead and #222's reach; section 5.13
reads it against the block of #187 (generated at `4407c96`), and section 5.12
reads that block: Durnhal's cells and what the orb, his fill and the cap moved
in the other 90. The block this one replaced, the block of #187's cap at
`4407c96` (before the reach of #222), read 15 in band (11 of the 90 and 4 of
Durnhal's 36), 3204.5 points (2254.5 and 950.0) and Brimwick 60.3, Durnhal 21.4,
Hargrim 14.7, Lumeth 89.0, Ondrel 66.1, Quillon 77.3 and Skerrow 21.1. The block
that one replaced, the seven-kit block of #244 (generated at `ac23e84`, before
the cap), read 15 in band (10 of the 90 and 5 of his 36), 3249.5 points (2296.5
and 953.0) and Brimwick 58.9, Durnhal 21.1, Hargrim 14.7, Lumeth 89.2, Ondrel
66.6, Quillon 78.3 and Skerrow 21.3. The block that one replaced (the six-kit
report, #189 with batch 15) had 90 cells and 17 640 matches on three arenas
(arena03 of #238), 11 of them in band (4 of the 36 cells with Ondrel or Brimwick
on the first two arenas, 3 of the 24 four-kit cells there, and 4 of the 30 new
arena03 cells), 2205.9 points (847.2, 644.8 and 713.9) and Brimwick 50.3,
Hargrim 13.6, Lumeth 87.2, Ondrel 62.2, Quillon 71.9 and Skerrow 14.8; the orb,
Durnhal as a fill and the cap moved 78 of its 90 cells, 12 of them by more than
the 7 points of one cell's noise (section 3). The block of #213 (the 60 cells of
the first two arenas) had 7 in band and 1492.0 points (847.2 and 644.8) with
Brimwick 50.6, Hargrim 12.6, Lumeth 89.0, Ondrel 59.2, Quillon 72.0 and Skerrow
16.6; every one of its 60 cells is unchanged in the #238 block, because arena03
adds cells and moves none. The block of #186 (generated at e5c29a4, see 5.10)
had 7 in band, 1552.9 points (882.7 and 670.2) and Brimwick 51.9, Hargrim 11.7,
Lumeth 89.3, Ondrel 60.2, Quillon 73.0 and Skerrow 13.9; the block of #189
(generated at 3704221) had 8 in band, 1561.3 points (883.9 and 677.4) and
Brimwick 52.3, Hargrim 11.4, Lumeth 89.1, Ondrel 60.1, Quillon 73.3 and Skerrow
13.7; what moved is read in sections 5.10, 5.11 and 5.12. The four-kit report
that the six-kit report replaced is the block regenerated after the dodge of
#137, and nothing between it and #189 moved a four-kit cell: #155, #165, #191
and #158 landed after it, and PR #185 and PR #196 each reproduced that block
with `--check` on main (PR #196 after #191, #158 and #162). Its 24 cells moved
because Ondrel and Brimwick are new fills (section 5.9).

What follows, up to the block, is the history of the four-kit report that the
six-kit report replaced. That report was the one after the tuning pass of #121, and of
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
Generated by `npm run balance` from the sources at `0246028`.

Seeds 1 to 40 for each 2v2 config and 1 to 10 for each 3v3 config, every bot at the normal tier. X's rate
is the share of the decided matches X won, in percent; the band is 40 to 60
inclusive, on the exact rate.
Cells in band: 15 of 126.

### Cells

| Mode | Arena | X v Y | Fills (X's rate) | Seeds / matches | X rate % | X wins as A | X wins as B | Verdict | Round mean | Round longest | Sudden-death rounds | First hit mean | Drawn rounds | Budget hits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2v2 | arena01 | brimwick v durnhal | hargrim 90.0, lumeth 90.0, ondrel 100.0, quillon 100.0, skerrow 85.0 | 40 / 200 | 93.0 | 91/100 | 95/100 | outside | 1063 | 3285 | 1 of 720 | 126 | 0 | 0 |
| 2v2 | arena01 | brimwick v hargrim | durnhal 100.0, lumeth 40.0, ondrel 100.0, quillon 100.0, skerrow 87.5 | 40 / 200 | 85.5 | 85/100 | 86/100 | outside | 971 | 3136 | 0 of 712 | 126 | 0 | 0 |
| 2v2 | arena01 | brimwick v lumeth | durnhal 5.0, hargrim 0.0, ondrel 15.0, quillon 7.5, skerrow 5.0 | 40 / 200 | 6.5 | 7/100 | 6/100 | outside | 1233 | 2612 | 1 of 749 | 132 | 2 | 0 |
| 2v2 | arena01 | brimwick v ondrel | durnhal 80.0, hargrim 70.0, lumeth 22.5, quillon 60.0, skerrow 52.5 | 40 / 200 | 57.0 | 58/100 | 56/100 | in band | 1066 | 3114 | 0 of 770 | 122 | 2 | 0 |
| 2v2 | arena01 | brimwick v quillon | durnhal 17.5, hargrim 32.5, lumeth 15.0, ondrel 22.5, skerrow 15.0 | 40 / 200 | 20.5 | 23/100 | 18/100 | outside | 1002 | 3731 | 0 of 753 | 134 | 2 | 0 |
| 2v2 | arena01 | brimwick v skerrow | durnhal 100.0, hargrim 90.0, lumeth 52.5, ondrel 100.0, quillon 100.0 | 40 / 200 | 88.5 | 86/100 | 91/100 | outside | 872 | 2626 | 0 of 693 | 122 | 1 | 0 |
| 2v2 | arena01 | durnhal v hargrim | brimwick 55.0, lumeth 100.0, ondrel 82.5, quillon 27.5, skerrow 57.5 | 40 / 200 | 64.5 | 66/100 | 63/100 | outside | 1315 | 5382 | 15 of 748 | 129 | 7 | 0 |
| 2v2 | arena01 | durnhal v lumeth | brimwick 0.0, hargrim 0.0, ondrel 0.0, quillon 0.0, skerrow 2.5 | 40 / 200 | 0.5 | 0/100 | 1/100 | outside | 998 | 1976 | 0 of 620 | 124 | 0 | 0 |
| 2v2 | arena01 | durnhal v ondrel | brimwick 0.0, hargrim 10.0, lumeth 0.0, quillon 0.0, skerrow 0.0 | 40 / 200 | 2.0 | 0/100 | 4/100 | outside | 1013 | 3118 | 0 of 675 | 123 | 0 | 0 |
| 2v2 | arena01 | durnhal v quillon | brimwick 0.0, hargrim 0.0, lumeth 0.0, ondrel 0.0, skerrow 0.0 | 40 / 200 | 0.0 | 0/100 | 0/100 | outside | 866 | 2302 | 1 of 624 | 129 | 0 | 0 |
| 2v2 | arena01 | durnhal v skerrow | brimwick 45.0, hargrim 2.5, lumeth 55.0, ondrel 55.0, quillon 60.0 | 40 / 200 | 43.5 | 42/100 | 45/100 | in band | 1146 | 5025 | 1 of 788 | 120 | 6 | 0 |
| 2v2 | arena01 | hargrim v lumeth | brimwick 0.0, durnhal 0.0, ondrel 0.0, quillon 0.0, skerrow 0.0 | 40 / 200 | 0.0 | 0/100 | 0/100 | outside | 948 | 1900 | 0 of 636 | 124 | 0 | 0 |
| 2v2 | arena01 | hargrim v ondrel | brimwick 0.0, durnhal 0.0, lumeth 2.5, quillon 0.0, skerrow 5.0 | 40 / 200 | 1.5 | 0/100 | 3/100 | outside | 946 | 2993 | 0 of 648 | 120 | 0 | 0 |
| 2v2 | arena01 | hargrim v quillon | brimwick 0.0, durnhal 0.0, lumeth 7.5, ondrel 0.0, skerrow 5.0 | 40 / 200 | 2.5 | 1/100 | 4/100 | outside | 853 | 2420 | 0 of 661 | 130 | 0 | 0 |
| 2v2 | arena01 | hargrim v skerrow | brimwick 52.5, durnhal 0.0, lumeth 12.5, ondrel 27.5, quillon 60.0 | 40 / 200 | 30.5 | 31/100 | 30/100 | outside | 1005 | 3693 | 0 of 815 | 119 | 8 | 0 |
| 2v2 | arena01 | lumeth v ondrel | brimwick 65.0, durnhal 90.0, hargrim 97.5, quillon 82.5, skerrow 97.5 | 40 / 200 | 86.5 | 86/100 | 87/100 | outside | 1200 | 2655 | 2 of 765 | 128 | 1 | 0 |
| 2v2 | arena01 | lumeth v quillon | brimwick 42.5, durnhal 72.5, hargrim 85.0, ondrel 47.5, skerrow 85.0 | 40 / 200 | 66.5 | 69/100 | 64/100 | outside | 1192 | 3213 | 0 of 798 | 133 | 3 | 0 |
| 2v2 | arena01 | lumeth v skerrow | brimwick 100.0, durnhal 100.0, hargrim 100.0, ondrel 100.0, quillon 100.0 | 40 / 200 | 100.0 | 100/100 | 100/100 | outside | 871 | 2225 | 1 of 650 | 124 | 0 | 0 |
| 2v2 | arena01 | ondrel v quillon | brimwick 22.5, durnhal 12.5, hargrim 25.0, lumeth 50.0, skerrow 22.5 | 40 / 200 | 26.5 | 29/100 | 24/100 | outside | 1067 | 4120 | 0 of 799 | 134 | 1 | 0 |
| 2v2 | arena01 | ondrel v skerrow | brimwick 100.0, durnhal 100.0, hargrim 100.0, lumeth 97.5, quillon 100.0 | 40 / 200 | 99.5 | 99/100 | 100/100 | outside | 849 | 2481 | 0 of 643 | 121 | 2 | 0 |
| 2v2 | arena01 | quillon v skerrow | brimwick 100.0, durnhal 100.0, hargrim 100.0, lumeth 85.0, ondrel 100.0 | 40 / 200 | 97.0 | 96/100 | 98/100 | outside | 827 | 2327 | 0 of 648 | 133 | 0 | 0 |
| 2v2 | arena02 | brimwick v durnhal | hargrim 100.0, lumeth 92.5, ondrel 100.0, quillon 92.5, skerrow 87.5 | 40 / 200 | 94.5 | 97/100 | 92/100 | outside | 1095 | 3123 | 0 of 712 | 107 | 0 | 0 |
| 2v2 | arena02 | brimwick v hargrim | durnhal 100.0, lumeth 87.5, ondrel 100.0, quillon 97.5, skerrow 95.0 | 40 / 200 | 96.0 | 97/100 | 95/100 | outside | 971 | 2873 | 0 of 676 | 107 | 0 | 0 |
| 2v2 | arena02 | brimwick v lumeth | durnhal 22.5, hargrim 7.5, ondrel 27.5, quillon 10.0, skerrow 5.0 | 40 / 200 | 14.5 | 12/100 | 17/100 | outside | 1148 | 4944 | 0 of 739 | 111 | 0 | 0 |
| 2v2 | arena02 | brimwick v ondrel | durnhal 72.5, hargrim 62.5, lumeth 45.0, quillon 70.0, skerrow 45.0 | 40 / 200 | 59.0 | 56/100 | 62/100 | in band | 1029 | 2917 | 0 of 843 | 108 | 1 | 0 |
| 2v2 | arena02 | brimwick v quillon | durnhal 7.5, hargrim 40.0, lumeth 27.5, ondrel 10.0, skerrow 7.5 | 40 / 200 | 18.5 | 15/100 | 22/100 | outside | 937 | 2806 | 0 of 774 | 113 | 1 | 0 |
| 2v2 | arena02 | brimwick v skerrow | durnhal 100.0, hargrim 100.0, lumeth 95.0, ondrel 100.0, quillon 92.5 | 40 / 200 | 97.5 | 97/100 | 98/100 | outside | 877 | 2211 | 0 of 701 | 107 | 1 | 0 |
| 2v2 | arena02 | durnhal v hargrim | brimwick 72.5, lumeth 100.0, ondrel 70.0, quillon 60.0, skerrow 75.0 | 40 / 200 | 75.5 | 81/100 | 70/100 | outside | 1182 | 4677 | 3 of 765 | 118 | 4 | 0 |
| 2v2 | arena02 | durnhal v lumeth | brimwick 0.0, hargrim 0.0, ondrel 0.0, quillon 0.0, skerrow 0.0 | 40 / 200 | 0.0 | 0/100 | 0/100 | outside | 1049 | 2056 | 0 of 640 | 108 | 0 | 0 |
| 2v2 | arena02 | durnhal v ondrel | brimwick 0.0, hargrim 0.0, lumeth 0.0, quillon 2.5, skerrow 2.5 | 40 / 200 | 1.0 | 0/100 | 2/100 | outside | 1104 | 4780 | 0 of 652 | 109 | 0 | 0 |
| 2v2 | arena02 | durnhal v quillon | brimwick 0.0, hargrim 0.0, lumeth 0.0, ondrel 0.0, skerrow 2.5 | 40 / 200 | 0.5 | 1/100 | 0/100 | outside | 913 | 3255 | 0 of 624 | 116 | 0 | 0 |
| 2v2 | arena02 | durnhal v skerrow | brimwick 42.5, hargrim 5.0, lumeth 7.5, ondrel 12.5, quillon 65.0 | 40 / 200 | 26.5 | 28/100 | 25/100 | outside | 1034 | 5297 | 1 of 760 | 108 | 3 | 0 |
| 2v2 | arena02 | hargrim v lumeth | brimwick 0.0, durnhal 0.0, ondrel 0.0, quillon 0.0, skerrow 0.0 | 40 / 200 | 0.0 | 0/100 | 0/100 | outside | 995 | 2225 | 0 of 651 | 107 | 0 | 0 |
| 2v2 | arena02 | hargrim v ondrel | brimwick 0.0, durnhal 0.0, lumeth 0.0, quillon 2.5, skerrow 0.0 | 40 / 200 | 0.5 | 0/100 | 1/100 | outside | 957 | 2616 | 0 of 635 | 109 | 0 | 0 |
| 2v2 | arena02 | hargrim v quillon | brimwick 0.0, durnhal 0.0, lumeth 2.5, ondrel 0.0, skerrow 0.0 | 40 / 200 | 0.5 | 0/100 | 1/100 | outside | 852 | 2482 | 0 of 645 | 116 | 0 | 0 |
| 2v2 | arena02 | hargrim v skerrow | brimwick 37.5, durnhal 0.0, lumeth 12.5, ondrel 17.5, quillon 45.0 | 40 / 200 | 22.5 | 28/100 | 17/100 | outside | 983 | 3048 | 0 of 791 | 107 | 5 | 0 |
| 2v2 | arena02 | lumeth v ondrel | brimwick 82.5, durnhal 80.0, hargrim 85.0, quillon 70.0, skerrow 92.5 | 40 / 200 | 82.0 | 75/100 | 89/100 | outside | 1115 | 2731 | 0 of 777 | 110 | 2 | 0 |
| 2v2 | arena02 | lumeth v quillon | brimwick 80.0, durnhal 65.0, hargrim 60.0, ondrel 70.0, skerrow 55.0 | 40 / 200 | 66.0 | 70/100 | 62/100 | outside | 1150 | 2934 | 0 of 803 | 112 | 1 | 0 |
| 2v2 | arena02 | lumeth v skerrow | brimwick 100.0, durnhal 95.0, hargrim 97.5, ondrel 100.0, quillon 97.5 | 40 / 200 | 98.0 | 97/100 | 99/100 | outside | 885 | 1623 | 0 of 657 | 108 | 1 | 0 |
| 2v2 | arena02 | ondrel v quillon | brimwick 52.5, durnhal 2.5, hargrim 2.5, lumeth 72.5, skerrow 2.5 | 40 / 200 | 26.5 | 22/100 | 31/100 | outside | 954 | 5013 | 0 of 794 | 111 | 2 | 0 |
| 2v2 | arena02 | ondrel v skerrow | brimwick 95.0, durnhal 95.0, hargrim 100.0, lumeth 85.0, quillon 92.5 | 40 / 200 | 93.5 | 93/100 | 94/100 | outside | 919 | 2868 | 0 of 704 | 109 | 1 | 0 |
| 2v2 | arena02 | quillon v skerrow | brimwick 100.0, durnhal 100.0, hargrim 95.0, lumeth 95.0, ondrel 100.0 | 40 / 200 | 98.0 | 97/100 | 99/100 | outside | 864 | 2535 | 0 of 673 | 113 | 1 | 0 |
| 2v2 | arena03 | brimwick v durnhal | hargrim 87.5, lumeth 92.5, ondrel 100.0, quillon 100.0, skerrow 87.5 | 40 / 200 | 93.5 | 91/100 | 96/100 | outside | 1020 | 3496 | 1 of 709 | 147 | 0 | 0 |
| 2v2 | arena03 | brimwick v hargrim | durnhal 100.0, lumeth 75.0, ondrel 100.0, quillon 100.0, skerrow 82.5 | 40 / 200 | 91.5 | 85/100 | 98/100 | outside | 944 | 2872 | 0 of 707 | 144 | 0 | 0 |
| 2v2 | arena03 | brimwick v lumeth | durnhal 7.5, hargrim 2.5, ondrel 30.0, quillon 22.5, skerrow 0.0 | 40 / 200 | 12.5 | 16/100 | 9/100 | outside | 1201 | 3819 | 0 of 757 | 148 | 1 | 0 |
| 2v2 | arena03 | brimwick v ondrel | durnhal 87.5, hargrim 65.0, lumeth 10.0, quillon 52.5, skerrow 30.0 | 40 / 200 | 49.0 | 47/100 | 51/100 | in band | 1042 | 4410 | 4 of 780 | 143 | 2 | 0 |
| 2v2 | arena03 | brimwick v quillon | durnhal 15.0, hargrim 27.5, lumeth 20.0, ondrel 52.5, skerrow 10.0 | 40 / 200 | 25.0 | 27/100 | 23/100 | outside | 1027 | 4172 | 0 of 790 | 135 | 0 | 0 |
| 2v2 | arena03 | brimwick v skerrow | durnhal 100.0, hargrim 72.5, lumeth 85.0, ondrel 100.0, quillon 100.0 | 40 / 200 | 91.5 | 88/100 | 95/100 | outside | 916 | 2465 | 1 of 733 | 131 | 0 | 0 |
| 2v2 | arena03 | durnhal v hargrim | brimwick 77.5, lumeth 100.0, ondrel 65.0, quillon 100.0, skerrow 50.0 | 40 / 200 | 78.5 | 88/100 | 69/100 | outside | 1275 | 4991 | 7 of 711 | 127 | 3 | 0 |
| 2v2 | arena03 | durnhal v lumeth | brimwick 0.0, hargrim 0.0, ondrel 0.0, quillon 0.0, skerrow 0.0 | 40 / 200 | 0.0 | 0/100 | 0/100 | outside | 916 | 2052 | 0 of 603 | 128 | 0 | 0 |
| 2v2 | arena03 | durnhal v ondrel | brimwick 0.0, hargrim 0.0, lumeth 0.0, quillon 0.0, skerrow 2.5 | 40 / 200 | 0.5 | 0/100 | 1/100 | outside | 1024 | 3937 | 0 of 637 | 130 | 0 | 0 |
| 2v2 | arena03 | durnhal v quillon | brimwick 0.0, hargrim 0.0, lumeth 0.0, ondrel 0.0, skerrow 0.0 | 40 / 200 | 0.0 | 0/100 | 0/100 | outside | 885 | 2465 | 0 of 622 | 130 | 0 | 0 |
| 2v2 | arena03 | durnhal v skerrow | brimwick 72.5, hargrim 15.0, lumeth 97.5, ondrel 37.5, quillon 72.5 | 40 / 200 | 59.0 | 52/100 | 66/100 | in band | 1132 | 4850 | 1 of 786 | 113 | 2 | 0 |
| 2v2 | arena03 | hargrim v lumeth | brimwick 0.0, durnhal 0.0, ondrel 0.0, quillon 0.0, skerrow 0.0 | 40 / 200 | 0.0 | 0/100 | 0/100 | outside | 937 | 1693 | 0 of 636 | 128 | 0 | 0 |
| 2v2 | arena03 | hargrim v ondrel | brimwick 0.0, durnhal 0.0, lumeth 2.5, quillon 0.0, skerrow 5.0 | 40 / 200 | 1.5 | 2/100 | 1/100 | outside | 980 | 4209 | 0 of 675 | 129 | 0 | 0 |
| 2v2 | arena03 | hargrim v quillon | brimwick 0.0, durnhal 0.0, lumeth 12.5, ondrel 0.0, skerrow 0.0 | 40 / 200 | 2.5 | 0/100 | 5/100 | outside | 874 | 2478 | 0 of 651 | 127 | 0 | 0 |
| 2v2 | arena03 | hargrim v skerrow | brimwick 62.5, durnhal 2.5, lumeth 20.0, ondrel 25.0, quillon 67.5 | 40 / 200 | 35.5 | 36/100 | 35/100 | outside | 1025 | 3811 | 0 of 807 | 112 | 10 | 0 |
| 2v2 | arena03 | lumeth v ondrel | brimwick 47.5, durnhal 47.5, hargrim 45.0, quillon 65.0, skerrow 100.0 | 40 / 200 | 61.0 | 59/100 | 63/100 | outside | 1050 | 2229 | 0 of 817 | 136 | 1 | 0 |
| 2v2 | arena03 | lumeth v quillon | brimwick 37.5, durnhal 22.5, hargrim 42.5, ondrel 67.5, skerrow 72.5 | 40 / 200 | 48.5 | 49/100 | 48/100 | in band | 1100 | 2407 | 0 of 845 | 133 | 1 | 0 |
| 2v2 | arena03 | lumeth v skerrow | brimwick 100.0, durnhal 97.5, hargrim 95.0, ondrel 100.0, quillon 100.0 | 40 / 200 | 98.5 | 99/100 | 98/100 | outside | 880 | 1975 | 0 of 645 | 115 | 0 | 0 |
| 2v2 | arena03 | ondrel v quillon | brimwick 20.0, durnhal 2.5, hargrim 15.0, lumeth 67.5, skerrow 10.0 | 40 / 200 | 23.0 | 21/100 | 25/100 | outside | 968 | 3374 | 2 of 751 | 129 | 1 | 0 |
| 2v2 | arena03 | ondrel v skerrow | brimwick 100.0, durnhal 97.5, hargrim 100.0, lumeth 97.5, quillon 100.0 | 40 / 200 | 99.0 | 99/100 | 99/100 | outside | 897 | 2971 | 0 of 666 | 116 | 0 | 0 |
| 2v2 | arena03 | quillon v skerrow | brimwick 100.0, durnhal 100.0, hargrim 100.0, lumeth 95.0, ondrel 100.0 | 40 / 200 | 99.0 | 100/100 | 98/100 | outside | 803 | 2643 | 0 of 642 | 128 | 1 | 0 |
| 3v3 | arena01 | brimwick v durnhal | hargrim+lumeth 50.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, hargrim+skerrow 90.0, lumeth+hargrim 90.0, lumeth+ondrel 80.0, lumeth+quillon 70.0, lumeth+skerrow 100.0, ondrel+hargrim 100.0, ondrel+lumeth 80.0, ondrel+quillon 100.0, ondrel+skerrow 100.0, quillon+hargrim 100.0, quillon+lumeth 90.0, quillon+ondrel 100.0, quillon+skerrow 100.0, skerrow+hargrim 100.0, skerrow+lumeth 80.0, skerrow+ondrel 100.0, skerrow+quillon 100.0 | 10 / 200 | 91.5 | 89/100 | 94/100 | outside | 1211 | 3577 | 0 of 685 | 120 | 0 | 0 |
| 3v3 | arena01 | brimwick v hargrim | durnhal+lumeth 100.0, durnhal+ondrel 100.0, durnhal+quillon 100.0, durnhal+skerrow 100.0, lumeth+durnhal 100.0, lumeth+ondrel 80.0, lumeth+quillon 50.0, lumeth+skerrow 100.0, ondrel+durnhal 100.0, ondrel+lumeth 60.0, ondrel+quillon 100.0, ondrel+skerrow 100.0, quillon+durnhal 100.0, quillon+lumeth 100.0, quillon+ondrel 100.0, quillon+skerrow 100.0, skerrow+durnhal 90.0, skerrow+lumeth 90.0, skerrow+ondrel 100.0, skerrow+quillon 100.0 | 10 / 200 | 93.5 | 93/100 | 94/100 | outside | 1186 | 4136 | 1 of 669 | 120 | 1 | 0 |
| 3v3 | arena01 | brimwick v lumeth | durnhal+hargrim 0.0, durnhal+ondrel 30.0, durnhal+quillon 10.0, durnhal+skerrow 0.0, hargrim+durnhal 20.0, hargrim+ondrel 0.0, hargrim+quillon 10.0, hargrim+skerrow 0.0, ondrel+durnhal 0.0, ondrel+hargrim 0.0, ondrel+quillon 0.0, ondrel+skerrow 0.0, quillon+durnhal 0.0, quillon+hargrim 10.0, quillon+ondrel 10.0, quillon+skerrow 0.0, skerrow+durnhal 0.0, skerrow+hargrim 0.0, skerrow+ondrel 0.0, skerrow+quillon 30.0 | 10 / 200 | 6.0 | 7/100 | 5/100 | outside | 1325 | 2942 | 0 of 751 | 123 | 0 | 0 |
| 3v3 | arena01 | brimwick v ondrel | durnhal+hargrim 90.0, durnhal+lumeth 40.0, durnhal+quillon 40.0, durnhal+skerrow 40.0, hargrim+durnhal 50.0, hargrim+lumeth 50.0, hargrim+quillon 60.0, hargrim+skerrow 80.0, lumeth+durnhal 20.0, lumeth+hargrim 40.0, lumeth+quillon 40.0, lumeth+skerrow 30.0, quillon+durnhal 20.0, quillon+hargrim 40.0, quillon+lumeth 10.0, quillon+skerrow 40.0, skerrow+durnhal 70.0, skerrow+hargrim 70.0, skerrow+lumeth 10.0, skerrow+quillon 60.0 | 10 / 200 | 45.0 | 45/100 | 45/100 | in band | 1383 | 5372 | 3 of 788 | 120 | 0 | 0 |
| 3v3 | arena01 | brimwick v quillon | durnhal+hargrim 30.0, durnhal+lumeth 20.0, durnhal+ondrel 40.0, durnhal+skerrow 30.0, hargrim+durnhal 30.0, hargrim+lumeth 10.0, hargrim+ondrel 40.0, hargrim+skerrow 30.0, lumeth+durnhal 20.0, lumeth+hargrim 30.0, lumeth+ondrel 60.0, lumeth+skerrow 10.0, ondrel+durnhal 40.0, ondrel+hargrim 10.0, ondrel+lumeth 30.0, ondrel+skerrow 10.0, skerrow+durnhal 20.0, skerrow+hargrim 10.0, skerrow+lumeth 40.0, skerrow+ondrel 30.0 | 10 / 200 | 27.0 | 29/100 | 25/100 | outside | 1385 | 4712 | 1 of 786 | 128 | 1 | 0 |
| 3v3 | arena01 | brimwick v skerrow | durnhal+hargrim 100.0, durnhal+lumeth 100.0, durnhal+ondrel 100.0, durnhal+quillon 100.0, hargrim+durnhal 100.0, hargrim+lumeth 70.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, lumeth+durnhal 100.0, lumeth+hargrim 100.0, lumeth+ondrel 100.0, lumeth+quillon 70.0, ondrel+durnhal 100.0, ondrel+hargrim 100.0, ondrel+lumeth 100.0, ondrel+quillon 100.0, quillon+durnhal 100.0, quillon+hargrim 100.0, quillon+lumeth 100.0, quillon+ondrel 100.0 | 10 / 200 | 97.0 | 98/100 | 96/100 | outside | 1167 | 3477 | 1 of 665 | 121 | 0 | 0 |
| 3v3 | arena01 | durnhal v hargrim | brimwick+lumeth 100.0, brimwick+ondrel 40.0, brimwick+quillon 50.0, brimwick+skerrow 40.0, lumeth+brimwick 80.0, lumeth+ondrel 80.0, lumeth+quillon 70.0, lumeth+skerrow 80.0, ondrel+brimwick 60.0, ondrel+lumeth 80.0, ondrel+quillon 50.0, ondrel+skerrow 50.0, quillon+brimwick 60.0, quillon+lumeth 100.0, quillon+ondrel 40.0, quillon+skerrow 20.0, skerrow+brimwick 20.0, skerrow+lumeth 60.0, skerrow+ondrel 40.0, skerrow+quillon 60.0 | 10 / 200 | 59.0 | 59/100 | 59/100 | in band | 1514 | 5157 | 8 of 795 | 123 | 6 | 0 |
| 3v3 | arena01 | durnhal v lumeth | brimwick+hargrim 0.0, brimwick+ondrel 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, hargrim+brimwick 0.0, hargrim+ondrel 0.0, hargrim+quillon 0.0, hargrim+skerrow 10.0, ondrel+brimwick 0.0, ondrel+hargrim 0.0, ondrel+quillon 0.0, ondrel+skerrow 0.0, quillon+brimwick 0.0, quillon+hargrim 0.0, quillon+ondrel 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+hargrim 0.0, skerrow+ondrel 0.0, skerrow+quillon 0.0 | 10 / 200 | 0.5 | 1/100 | 0/100 | outside | 1090 | 2346 | 0 of 628 | 120 | 1 | 0 |
| 3v3 | arena01 | durnhal v ondrel | brimwick+hargrim 0.0, brimwick+lumeth 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, hargrim+brimwick 10.0, hargrim+lumeth 10.0, hargrim+quillon 0.0, hargrim+skerrow 0.0, lumeth+brimwick 0.0, lumeth+hargrim 0.0, lumeth+quillon 0.0, lumeth+skerrow 0.0, quillon+brimwick 0.0, quillon+hargrim 0.0, quillon+lumeth 10.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+hargrim 0.0, skerrow+lumeth 20.0, skerrow+quillon 0.0 | 10 / 200 | 2.5 | 1/100 | 4/100 | outside | 1192 | 4765 | 3 of 667 | 119 | 0 | 0 |
| 3v3 | arena01 | durnhal v quillon | brimwick+hargrim 0.0, brimwick+lumeth 0.0, brimwick+ondrel 0.0, brimwick+skerrow 0.0, hargrim+brimwick 0.0, hargrim+lumeth 0.0, hargrim+ondrel 0.0, hargrim+skerrow 10.0, lumeth+brimwick 10.0, lumeth+hargrim 0.0, lumeth+ondrel 30.0, lumeth+skerrow 30.0, ondrel+brimwick 0.0, ondrel+hargrim 0.0, ondrel+lumeth 0.0, ondrel+skerrow 0.0, skerrow+brimwick 0.0, skerrow+hargrim 10.0, skerrow+lumeth 0.0, skerrow+ondrel 0.0 | 10 / 200 | 4.5 | 4/100 | 5/100 | outside | 1172 | 3400 | 0 of 675 | 124 | 1 | 0 |
| 3v3 | arena01 | durnhal v skerrow | brimwick+hargrim 50.0, brimwick+lumeth 70.0, brimwick+ondrel 80.0, brimwick+quillon 70.0, hargrim+brimwick 30.0, hargrim+lumeth 70.0, hargrim+ondrel 40.0, hargrim+quillon 60.0, lumeth+brimwick 80.0, lumeth+hargrim 60.0, lumeth+ondrel 70.0, lumeth+quillon 50.0, ondrel+brimwick 80.0, ondrel+hargrim 60.0, ondrel+lumeth 70.0, ondrel+quillon 50.0, quillon+brimwick 50.0, quillon+hargrim 60.0, quillon+lumeth 70.0, quillon+ondrel 80.0 | 10 / 200 | 62.5 | 61/100 | 64/100 | outside | 1447 | 5148 | 13 of 829 | 117 | 2 | 0 |
| 3v3 | arena01 | hargrim v lumeth | brimwick+durnhal 0.0, brimwick+ondrel 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, durnhal+brimwick 0.0, durnhal+ondrel 0.0, durnhal+quillon 0.0, durnhal+skerrow 0.0, ondrel+brimwick 0.0, ondrel+durnhal 0.0, ondrel+quillon 0.0, ondrel+skerrow 0.0, quillon+brimwick 0.0, quillon+durnhal 0.0, quillon+ondrel 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+durnhal 0.0, skerrow+ondrel 0.0, skerrow+quillon 0.0 | 10 / 200 | 0.0 | 0/100 | 0/100 | outside | 1069 | 2353 | 0 of 625 | 119 | 0 | 0 |
| 3v3 | arena01 | hargrim v ondrel | brimwick+durnhal 0.0, brimwick+lumeth 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, durnhal+brimwick 0.0, durnhal+lumeth 0.0, durnhal+quillon 10.0, durnhal+skerrow 0.0, lumeth+brimwick 20.0, lumeth+durnhal 0.0, lumeth+quillon 0.0, lumeth+skerrow 0.0, quillon+brimwick 0.0, quillon+durnhal 0.0, quillon+lumeth 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+durnhal 0.0, skerrow+lumeth 20.0, skerrow+quillon 0.0 | 10 / 200 | 2.5 | 4/100 | 1/100 | outside | 1157 | 5184 | 3 of 670 | 119 | 0 | 0 |
| 3v3 | arena01 | hargrim v quillon | brimwick+durnhal 0.0, brimwick+lumeth 0.0, brimwick+ondrel 0.0, brimwick+skerrow 0.0, durnhal+brimwick 0.0, durnhal+lumeth 0.0, durnhal+ondrel 0.0, durnhal+skerrow 0.0, lumeth+brimwick 0.0, lumeth+durnhal 0.0, lumeth+ondrel 20.0, lumeth+skerrow 20.0, ondrel+brimwick 10.0, ondrel+durnhal 0.0, ondrel+lumeth 0.0, ondrel+skerrow 0.0, skerrow+brimwick 0.0, skerrow+durnhal 0.0, skerrow+lumeth 0.0, skerrow+ondrel 0.0 | 10 / 200 | 2.5 | 3/100 | 2/100 | outside | 1149 | 3359 | 0 of 665 | 124 | 2 | 0 |
| 3v3 | arena01 | hargrim v skerrow | brimwick+durnhal 40.0, brimwick+lumeth 70.0, brimwick+ondrel 40.0, brimwick+quillon 50.0, durnhal+brimwick 60.0, durnhal+lumeth 40.0, durnhal+ondrel 30.0, durnhal+quillon 50.0, lumeth+brimwick 60.0, lumeth+durnhal 0.0, lumeth+ondrel 40.0, lumeth+quillon 70.0, ondrel+brimwick 80.0, ondrel+durnhal 0.0, ondrel+lumeth 60.0, ondrel+quillon 40.0, quillon+brimwick 80.0, quillon+durnhal 60.0, quillon+lumeth 40.0, quillon+ondrel 60.0 | 10 / 200 | 48.5 | 44/100 | 53/100 | in band | 1456 | 5383 | 13 of 818 | 117 | 2 | 0 |
| 3v3 | arena01 | lumeth v ondrel | brimwick+durnhal 90.0, brimwick+hargrim 100.0, brimwick+quillon 90.0, brimwick+skerrow 100.0, durnhal+brimwick 70.0, durnhal+hargrim 90.0, durnhal+quillon 60.0, durnhal+skerrow 100.0, hargrim+brimwick 80.0, hargrim+durnhal 100.0, hargrim+quillon 80.0, hargrim+skerrow 60.0, quillon+brimwick 70.0, quillon+durnhal 80.0, quillon+hargrim 100.0, quillon+skerrow 80.0, skerrow+brimwick 100.0, skerrow+durnhal 100.0, skerrow+hargrim 100.0, skerrow+quillon 90.0 | 10 / 200 | 87.0 | 86/100 | 88/100 | outside | 1313 | 2921 | 1 of 761 | 123 | 1 | 0 |
| 3v3 | arena01 | lumeth v quillon | brimwick+durnhal 80.0, brimwick+hargrim 50.0, brimwick+ondrel 40.0, brimwick+skerrow 60.0, durnhal+brimwick 90.0, durnhal+hargrim 50.0, durnhal+ondrel 80.0, durnhal+skerrow 70.0, hargrim+brimwick 100.0, hargrim+durnhal 50.0, hargrim+ondrel 80.0, hargrim+skerrow 80.0, ondrel+brimwick 70.0, ondrel+durnhal 80.0, ondrel+hargrim 80.0, ondrel+skerrow 70.0, skerrow+brimwick 70.0, skerrow+durnhal 80.0, skerrow+hargrim 80.0, skerrow+ondrel 80.0 | 10 / 200 | 72.0 | 77/100 | 67/100 | outside | 1316 | 2917 | 0 of 789 | 128 | 0 | 0 |
| 3v3 | arena01 | lumeth v skerrow | brimwick+durnhal 100.0, brimwick+hargrim 100.0, brimwick+ondrel 100.0, brimwick+quillon 100.0, durnhal+brimwick 100.0, durnhal+hargrim 100.0, durnhal+ondrel 100.0, durnhal+quillon 100.0, hargrim+brimwick 100.0, hargrim+durnhal 100.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, ondrel+brimwick 100.0, ondrel+durnhal 100.0, ondrel+hargrim 100.0, ondrel+quillon 100.0, quillon+brimwick 100.0, quillon+durnhal 100.0, quillon+hargrim 100.0, quillon+ondrel 100.0 | 10 / 200 | 100.0 | 100/100 | 100/100 | outside | 1044 | 2314 | 0 of 618 | 122 | 1 | 0 |
| 3v3 | arena01 | ondrel v quillon | brimwick+durnhal 30.0, brimwick+hargrim 30.0, brimwick+lumeth 50.0, brimwick+skerrow 20.0, durnhal+brimwick 20.0, durnhal+hargrim 20.0, durnhal+lumeth 70.0, durnhal+skerrow 10.0, hargrim+brimwick 60.0, hargrim+durnhal 30.0, hargrim+lumeth 60.0, hargrim+skerrow 40.0, lumeth+brimwick 80.0, lumeth+durnhal 40.0, lumeth+hargrim 30.0, lumeth+skerrow 90.0, skerrow+brimwick 20.0, skerrow+durnhal 20.0, skerrow+hargrim 70.0, skerrow+lumeth 70.0 | 10 / 200 | 43.0 | 48/100 | 38/100 | in band | 1335 | 4779 | 5 of 814 | 128 | 4 | 0 |
| 3v3 | arena01 | ondrel v skerrow | brimwick+durnhal 100.0, brimwick+hargrim 100.0, brimwick+lumeth 100.0, brimwick+quillon 100.0, durnhal+brimwick 100.0, durnhal+hargrim 90.0, durnhal+lumeth 90.0, durnhal+quillon 90.0, hargrim+brimwick 100.0, hargrim+durnhal 100.0, hargrim+lumeth 80.0, hargrim+quillon 100.0, lumeth+brimwick 90.0, lumeth+durnhal 100.0, lumeth+hargrim 100.0, lumeth+quillon 80.0, quillon+brimwick 100.0, quillon+durnhal 100.0, quillon+hargrim 100.0, quillon+lumeth 100.0 | 10 / 200 | 96.0 | 94/100 | 98/100 | outside | 1176 | 4776 | 1 of 668 | 120 | 0 | 0 |
| 3v3 | arena01 | quillon v skerrow | brimwick+durnhal 100.0, brimwick+hargrim 100.0, brimwick+lumeth 90.0, brimwick+ondrel 100.0, durnhal+brimwick 100.0, durnhal+hargrim 100.0, durnhal+lumeth 100.0, durnhal+ondrel 100.0, hargrim+brimwick 100.0, hargrim+durnhal 100.0, hargrim+lumeth 100.0, hargrim+ondrel 100.0, lumeth+brimwick 90.0, lumeth+durnhal 100.0, lumeth+hargrim 100.0, lumeth+ondrel 70.0, ondrel+brimwick 100.0, ondrel+durnhal 100.0, ondrel+hargrim 100.0, ondrel+lumeth 100.0 | 10 / 200 | 97.5 | 98/100 | 97/100 | outside | 1140 | 3144 | 1 of 657 | 129 | 0 | 0 |
| 3v3 | arena02 | brimwick v durnhal | hargrim+lumeth 100.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, hargrim+skerrow 100.0, lumeth+hargrim 100.0, lumeth+ondrel 40.0, lumeth+quillon 70.0, lumeth+skerrow 90.0, ondrel+hargrim 100.0, ondrel+lumeth 40.0, ondrel+quillon 90.0, ondrel+skerrow 100.0, quillon+hargrim 100.0, quillon+lumeth 70.0, quillon+ondrel 100.0, quillon+skerrow 100.0, skerrow+hargrim 100.0, skerrow+lumeth 80.0, skerrow+ondrel 100.0, skerrow+quillon 100.0 | 10 / 200 | 89.0 | 89/100 | 89/100 | outside | 1330 | 4481 | 1 of 718 | 106 | 0 | 0 |
| 3v3 | arena02 | brimwick v hargrim | durnhal+lumeth 100.0, durnhal+ondrel 100.0, durnhal+quillon 100.0, durnhal+skerrow 100.0, lumeth+durnhal 100.0, lumeth+ondrel 50.0, lumeth+quillon 80.0, lumeth+skerrow 100.0, ondrel+durnhal 100.0, ondrel+lumeth 70.0, ondrel+quillon 100.0, ondrel+skerrow 100.0, quillon+durnhal 100.0, quillon+lumeth 100.0, quillon+ondrel 100.0, quillon+skerrow 90.0, skerrow+durnhal 100.0, skerrow+lumeth 80.0, skerrow+ondrel 100.0, skerrow+quillon 100.0 | 10 / 200 | 93.5 | 94/100 | 93/100 | outside | 1250 | 4037 | 1 of 693 | 106 | 0 | 0 |
| 3v3 | arena02 | brimwick v lumeth | durnhal+hargrim 10.0, durnhal+ondrel 30.0, durnhal+quillon 10.0, durnhal+skerrow 10.0, hargrim+durnhal 0.0, hargrim+ondrel 70.0, hargrim+quillon 10.0, hargrim+skerrow 0.0, ondrel+durnhal 10.0, ondrel+hargrim 10.0, ondrel+quillon 10.0, ondrel+skerrow 0.0, quillon+durnhal 0.0, quillon+hargrim 0.0, quillon+ondrel 30.0, quillon+skerrow 20.0, skerrow+durnhal 20.0, skerrow+hargrim 0.0, skerrow+ondrel 40.0, skerrow+quillon 20.0 | 10 / 200 | 15.0 | 14/100 | 16/100 | outside | 1373 | 3573 | 0 of 752 | 110 | 0 | 0 |
| 3v3 | arena02 | brimwick v ondrel | durnhal+hargrim 80.0, durnhal+lumeth 0.0, durnhal+quillon 20.0, durnhal+skerrow 80.0, hargrim+durnhal 80.0, hargrim+lumeth 20.0, hargrim+quillon 30.0, hargrim+skerrow 70.0, lumeth+durnhal 20.0, lumeth+hargrim 70.0, lumeth+quillon 30.0, lumeth+skerrow 20.0, quillon+durnhal 40.0, quillon+hargrim 60.0, quillon+lumeth 20.0, quillon+skerrow 40.0, skerrow+durnhal 60.0, skerrow+hargrim 70.0, skerrow+lumeth 40.0, skerrow+quillon 0.0 | 10 / 200 | 42.5 | 45/100 | 40/100 | in band | 1380 | 4837 | 2 of 824 | 107 | 2 | 0 |
| 3v3 | arena02 | brimwick v quillon | durnhal+hargrim 10.0, durnhal+lumeth 10.0, durnhal+ondrel 0.0, durnhal+skerrow 0.0, hargrim+durnhal 0.0, hargrim+lumeth 50.0, hargrim+ondrel 30.0, hargrim+skerrow 0.0, lumeth+durnhal 10.0, lumeth+hargrim 30.0, lumeth+ondrel 30.0, lumeth+skerrow 40.0, ondrel+durnhal 10.0, ondrel+hargrim 10.0, ondrel+lumeth 90.0, ondrel+skerrow 10.0, skerrow+durnhal 0.0, skerrow+hargrim 10.0, skerrow+lumeth 80.0, skerrow+ondrel 30.0 | 10 / 200 | 22.5 | 24/100 | 21/100 | outside | 1343 | 4701 | 5 of 791 | 110 | 0 | 0 |
| 3v3 | arena02 | brimwick v skerrow | durnhal+hargrim 100.0, durnhal+lumeth 100.0, durnhal+ondrel 100.0, durnhal+quillon 100.0, hargrim+durnhal 100.0, hargrim+lumeth 100.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, lumeth+durnhal 100.0, lumeth+hargrim 100.0, lumeth+ondrel 60.0, lumeth+quillon 80.0, ondrel+durnhal 100.0, ondrel+hargrim 100.0, ondrel+lumeth 50.0, ondrel+quillon 100.0, quillon+durnhal 80.0, quillon+hargrim 100.0, quillon+lumeth 100.0, quillon+ondrel 100.0 | 10 / 200 | 93.5 | 94/100 | 93/100 | outside | 1212 | 4465 | 1 of 687 | 106 | 0 | 0 |
| 3v3 | arena02 | durnhal v hargrim | brimwick+lumeth 90.0, brimwick+ondrel 70.0, brimwick+quillon 60.0, brimwick+skerrow 60.0, lumeth+brimwick 100.0, lumeth+ondrel 80.0, lumeth+quillon 70.0, lumeth+skerrow 100.0, ondrel+brimwick 50.0, ondrel+lumeth 80.0, ondrel+quillon 20.0, ondrel+skerrow 30.0, quillon+brimwick 70.0, quillon+lumeth 90.0, quillon+ondrel 40.0, quillon+skerrow 50.0, skerrow+brimwick 30.0, skerrow+lumeth 90.0, skerrow+ondrel 30.0, skerrow+quillon 30.0 | 10 / 200 | 62.0 | 62/100 | 62/100 | outside | 1388 | 4917 | 1 of 803 | 114 | 4 | 0 |
| 3v3 | arena02 | durnhal v lumeth | brimwick+hargrim 0.0, brimwick+ondrel 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, hargrim+brimwick 0.0, hargrim+ondrel 0.0, hargrim+quillon 0.0, hargrim+skerrow 0.0, ondrel+brimwick 0.0, ondrel+hargrim 0.0, ondrel+quillon 0.0, ondrel+skerrow 0.0, quillon+brimwick 0.0, quillon+hargrim 0.0, quillon+ondrel 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+hargrim 0.0, skerrow+ondrel 0.0, skerrow+quillon 0.0 | 10 / 200 | 0.0 | 0/100 | 0/100 | outside | 1194 | 2393 | 0 of 656 | 106 | 2 | 0 |
| 3v3 | arena02 | durnhal v ondrel | brimwick+hargrim 0.0, brimwick+lumeth 0.0, brimwick+quillon 0.0, brimwick+skerrow 10.0, hargrim+brimwick 0.0, hargrim+lumeth 30.0, hargrim+quillon 0.0, hargrim+skerrow 0.0, lumeth+brimwick 10.0, lumeth+hargrim 0.0, lumeth+quillon 0.0, lumeth+skerrow 10.0, quillon+brimwick 10.0, quillon+hargrim 20.0, quillon+lumeth 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+hargrim 0.0, skerrow+lumeth 10.0, skerrow+quillon 0.0 | 10 / 200 | 5.0 | 5/100 | 5/100 | outside | 1286 | 4459 | 3 of 692 | 108 | 0 | 0 |
| 3v3 | arena02 | durnhal v quillon | brimwick+hargrim 0.0, brimwick+lumeth 0.0, brimwick+ondrel 0.0, brimwick+skerrow 0.0, hargrim+brimwick 0.0, hargrim+lumeth 10.0, hargrim+ondrel 0.0, hargrim+skerrow 0.0, lumeth+brimwick 20.0, lumeth+hargrim 0.0, lumeth+ondrel 30.0, lumeth+skerrow 0.0, ondrel+brimwick 0.0, ondrel+hargrim 0.0, ondrel+lumeth 30.0, ondrel+skerrow 0.0, skerrow+brimwick 0.0, skerrow+hargrim 0.0, skerrow+lumeth 10.0, skerrow+ondrel 0.0 | 10 / 200 | 5.0 | 4/100 | 6/100 | outside | 1271 | 4342 | 0 of 692 | 112 | 1 | 0 |
| 3v3 | arena02 | durnhal v skerrow | brimwick+hargrim 20.0, brimwick+lumeth 30.0, brimwick+ondrel 50.0, brimwick+quillon 50.0, hargrim+brimwick 20.0, hargrim+lumeth 20.0, hargrim+ondrel 30.0, hargrim+quillon 40.0, lumeth+brimwick 50.0, lumeth+hargrim 60.0, lumeth+ondrel 80.0, lumeth+quillon 30.0, ondrel+brimwick 40.0, ondrel+hargrim 40.0, ondrel+lumeth 60.0, ondrel+quillon 50.0, quillon+brimwick 40.0, quillon+hargrim 30.0, quillon+lumeth 50.0, quillon+ondrel 20.0 | 10 / 200 | 40.5 | 37/100 | 44/100 | in band | 1375 | 4593 | 1 of 803 | 106 | 4 | 0 |
| 3v3 | arena02 | hargrim v lumeth | brimwick+durnhal 0.0, brimwick+ondrel 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, durnhal+brimwick 0.0, durnhal+ondrel 0.0, durnhal+quillon 0.0, durnhal+skerrow 20.0, ondrel+brimwick 20.0, ondrel+durnhal 0.0, ondrel+quillon 10.0, ondrel+skerrow 0.0, quillon+brimwick 0.0, quillon+durnhal 0.0, quillon+ondrel 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+durnhal 0.0, skerrow+ondrel 0.0, skerrow+quillon 0.0 | 10 / 200 | 2.5 | 4/100 | 1/100 | outside | 1150 | 2331 | 0 of 651 | 106 | 0 | 0 |
| 3v3 | arena02 | hargrim v ondrel | brimwick+durnhal 0.0, brimwick+lumeth 20.0, brimwick+quillon 10.0, brimwick+skerrow 0.0, durnhal+brimwick 0.0, durnhal+lumeth 0.0, durnhal+quillon 0.0, durnhal+skerrow 0.0, lumeth+brimwick 10.0, lumeth+durnhal 0.0, lumeth+quillon 10.0, lumeth+skerrow 0.0, quillon+brimwick 20.0, quillon+durnhal 10.0, quillon+lumeth 0.0, quillon+skerrow 10.0, skerrow+brimwick 0.0, skerrow+durnhal 0.0, skerrow+lumeth 20.0, skerrow+quillon 0.0 | 10 / 200 | 5.5 | 6/100 | 5/100 | outside | 1226 | 4921 | 2 of 686 | 108 | 1 | 0 |
| 3v3 | arena02 | hargrim v quillon | brimwick+durnhal 0.0, brimwick+lumeth 20.0, brimwick+ondrel 0.0, brimwick+skerrow 0.0, durnhal+brimwick 0.0, durnhal+lumeth 0.0, durnhal+ondrel 0.0, durnhal+skerrow 0.0, lumeth+brimwick 20.0, lumeth+durnhal 0.0, lumeth+ondrel 20.0, lumeth+skerrow 0.0, ondrel+brimwick 0.0, ondrel+durnhal 0.0, ondrel+lumeth 30.0, ondrel+skerrow 0.0, skerrow+brimwick 0.0, skerrow+durnhal 0.0, skerrow+lumeth 20.0, skerrow+ondrel 0.0 | 10 / 200 | 5.5 | 7/100 | 4/100 | outside | 1210 | 3849 | 0 of 693 | 111 | 0 | 0 |
| 3v3 | arena02 | hargrim v skerrow | brimwick+durnhal 0.0, brimwick+lumeth 40.0, brimwick+ondrel 40.0, brimwick+quillon 50.0, durnhal+brimwick 30.0, durnhal+lumeth 10.0, durnhal+ondrel 40.0, durnhal+quillon 20.0, lumeth+brimwick 60.0, lumeth+durnhal 20.0, lumeth+ondrel 10.0, lumeth+quillon 30.0, ondrel+brimwick 20.0, ondrel+durnhal 0.0, ondrel+lumeth 60.0, ondrel+quillon 50.0, quillon+brimwick 70.0, quillon+durnhal 20.0, quillon+lumeth 80.0, quillon+ondrel 20.0 | 10 / 200 | 33.5 | 35/100 | 32/100 | outside | 1364 | 4842 | 2 of 803 | 105 | 7 | 0 |
| 3v3 | arena02 | lumeth v ondrel | brimwick+durnhal 90.0, brimwick+hargrim 100.0, brimwick+quillon 80.0, brimwick+skerrow 90.0, durnhal+brimwick 60.0, durnhal+hargrim 90.0, durnhal+quillon 80.0, durnhal+skerrow 90.0, hargrim+brimwick 60.0, hargrim+durnhal 90.0, hargrim+quillon 60.0, hargrim+skerrow 80.0, quillon+brimwick 100.0, quillon+durnhal 70.0, quillon+hargrim 90.0, quillon+skerrow 80.0, skerrow+brimwick 90.0, skerrow+durnhal 90.0, skerrow+hargrim 90.0, skerrow+quillon 70.0 | 10 / 200 | 82.5 | 85/100 | 80/100 | outside | 1279 | 2762 | 0 of 771 | 109 | 1 | 0 |
| 3v3 | arena02 | lumeth v quillon | brimwick+durnhal 90.0, brimwick+hargrim 80.0, brimwick+ondrel 80.0, brimwick+skerrow 70.0, durnhal+brimwick 90.0, durnhal+hargrim 60.0, durnhal+ondrel 70.0, durnhal+skerrow 40.0, hargrim+brimwick 70.0, hargrim+durnhal 50.0, hargrim+ondrel 80.0, hargrim+skerrow 40.0, ondrel+brimwick 80.0, ondrel+durnhal 90.0, ondrel+hargrim 50.0, ondrel+skerrow 100.0, skerrow+brimwick 50.0, skerrow+durnhal 50.0, skerrow+hargrim 50.0, skerrow+ondrel 80.0 | 10 / 200 | 68.5 | 74/100 | 63/100 | outside | 1281 | 3307 | 1 of 808 | 110 | 0 | 0 |
| 3v3 | arena02 | lumeth v skerrow | brimwick+durnhal 100.0, brimwick+hargrim 100.0, brimwick+ondrel 100.0, brimwick+quillon 100.0, durnhal+brimwick 100.0, durnhal+hargrim 90.0, durnhal+ondrel 100.0, durnhal+quillon 100.0, hargrim+brimwick 100.0, hargrim+durnhal 100.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, ondrel+brimwick 100.0, ondrel+durnhal 100.0, ondrel+hargrim 100.0, ondrel+quillon 100.0, quillon+brimwick 100.0, quillon+durnhal 100.0, quillon+hargrim 100.0, quillon+ondrel 100.0 | 10 / 200 | 99.5 | 100/100 | 99/100 | outside | 1096 | 2032 | 1 of 628 | 107 | 0 | 0 |
| 3v3 | arena02 | ondrel v quillon | brimwick+durnhal 20.0, brimwick+hargrim 30.0, brimwick+lumeth 100.0, brimwick+skerrow 30.0, durnhal+brimwick 20.0, durnhal+hargrim 10.0, durnhal+lumeth 90.0, durnhal+skerrow 20.0, hargrim+brimwick 30.0, hargrim+durnhal 0.0, hargrim+lumeth 100.0, hargrim+skerrow 20.0, lumeth+brimwick 70.0, lumeth+durnhal 60.0, lumeth+hargrim 50.0, lumeth+skerrow 90.0, skerrow+brimwick 20.0, skerrow+durnhal 20.0, skerrow+hargrim 10.0, skerrow+lumeth 80.0 | 10 / 200 | 43.5 | 51/100 | 36/100 | in band | 1343 | 5106 | 2 of 805 | 110 | 2 | 0 |
| 3v3 | arena02 | ondrel v skerrow | brimwick+durnhal 80.0, brimwick+hargrim 80.0, brimwick+lumeth 100.0, brimwick+quillon 90.0, durnhal+brimwick 100.0, durnhal+hargrim 90.0, durnhal+lumeth 100.0, durnhal+quillon 100.0, hargrim+brimwick 100.0, hargrim+durnhal 100.0, hargrim+lumeth 90.0, hargrim+quillon 100.0, lumeth+brimwick 70.0, lumeth+durnhal 100.0, lumeth+hargrim 100.0, lumeth+quillon 90.0, quillon+brimwick 70.0, quillon+durnhal 70.0, quillon+hargrim 80.0, quillon+lumeth 100.0 | 10 / 200 | 90.5 | 85/100 | 96/100 | outside | 1237 | 4642 | 1 of 717 | 108 | 1 | 0 |
| 3v3 | arena02 | quillon v skerrow | brimwick+durnhal 100.0, brimwick+hargrim 100.0, brimwick+lumeth 100.0, brimwick+ondrel 100.0, durnhal+brimwick 100.0, durnhal+hargrim 100.0, durnhal+lumeth 100.0, durnhal+ondrel 100.0, hargrim+brimwick 100.0, hargrim+durnhal 100.0, hargrim+lumeth 60.0, hargrim+ondrel 100.0, lumeth+brimwick 90.0, lumeth+durnhal 100.0, lumeth+hargrim 100.0, lumeth+ondrel 60.0, ondrel+brimwick 90.0, ondrel+durnhal 100.0, ondrel+hargrim 100.0, ondrel+lumeth 60.0 | 10 / 200 | 93.0 | 94/100 | 92/100 | outside | 1198 | 4731 | 0 of 686 | 110 | 0 | 0 |
| 3v3 | arena03 | brimwick v durnhal | hargrim+lumeth 90.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, hargrim+skerrow 100.0, lumeth+hargrim 100.0, lumeth+ondrel 90.0, lumeth+quillon 90.0, lumeth+skerrow 100.0, ondrel+hargrim 100.0, ondrel+lumeth 90.0, ondrel+quillon 100.0, ondrel+skerrow 100.0, quillon+hargrim 100.0, quillon+lumeth 100.0, quillon+ondrel 100.0, quillon+skerrow 100.0, skerrow+hargrim 100.0, skerrow+lumeth 60.0, skerrow+ondrel 100.0, skerrow+quillon 100.0 | 10 / 200 | 96.0 | 96/100 | 96/100 | outside | 1261 | 5007 | 1 of 667 | 136 | 1 | 0 |
| 3v3 | arena03 | brimwick v hargrim | durnhal+lumeth 100.0, durnhal+ondrel 100.0, durnhal+quillon 100.0, durnhal+skerrow 100.0, lumeth+durnhal 100.0, lumeth+ondrel 60.0, lumeth+quillon 90.0, lumeth+skerrow 100.0, ondrel+durnhal 100.0, ondrel+lumeth 80.0, ondrel+quillon 100.0, ondrel+skerrow 100.0, quillon+durnhal 100.0, quillon+lumeth 100.0, quillon+ondrel 100.0, quillon+skerrow 100.0, skerrow+durnhal 100.0, skerrow+lumeth 60.0, skerrow+ondrel 100.0, skerrow+quillon 100.0 | 10 / 200 | 94.5 | 96/100 | 93/100 | outside | 1193 | 4368 | 4 of 658 | 135 | 0 | 0 |
| 3v3 | arena03 | brimwick v lumeth | durnhal+hargrim 0.0, durnhal+ondrel 20.0, durnhal+quillon 80.0, durnhal+skerrow 10.0, hargrim+durnhal 20.0, hargrim+ondrel 0.0, hargrim+quillon 20.0, hargrim+skerrow 30.0, ondrel+durnhal 10.0, ondrel+hargrim 0.0, ondrel+quillon 30.0, ondrel+skerrow 0.0, quillon+durnhal 0.0, quillon+hargrim 0.0, quillon+ondrel 30.0, quillon+skerrow 0.0, skerrow+durnhal 0.0, skerrow+hargrim 0.0, skerrow+ondrel 10.0, skerrow+quillon 0.0 | 10 / 200 | 13.0 | 11/100 | 15/100 | outside | 1342 | 3514 | 0 of 727 | 140 | 0 | 0 |
| 3v3 | arena03 | brimwick v ondrel | durnhal+hargrim 80.0, durnhal+lumeth 10.0, durnhal+quillon 80.0, durnhal+skerrow 60.0, hargrim+durnhal 60.0, hargrim+lumeth 30.0, hargrim+quillon 30.0, hargrim+skerrow 90.0, lumeth+durnhal 10.0, lumeth+hargrim 30.0, lumeth+quillon 30.0, lumeth+skerrow 0.0, quillon+durnhal 50.0, quillon+hargrim 40.0, quillon+lumeth 0.0, quillon+skerrow 30.0, skerrow+durnhal 70.0, skerrow+hargrim 30.0, skerrow+lumeth 0.0, skerrow+quillon 10.0 | 10 / 200 | 37.0 | 41/100 | 33/100 | outside | 1361 | 5170 | 5 of 794 | 136 | 2 | 0 |
| 3v3 | arena03 | brimwick v quillon | durnhal+hargrim 20.0, durnhal+lumeth 50.0, durnhal+ondrel 20.0, durnhal+skerrow 40.0, hargrim+durnhal 10.0, hargrim+lumeth 30.0, hargrim+ondrel 20.0, hargrim+skerrow 40.0, lumeth+durnhal 80.0, lumeth+hargrim 40.0, lumeth+ondrel 60.0, lumeth+skerrow 30.0, ondrel+durnhal 40.0, ondrel+hargrim 40.0, ondrel+lumeth 30.0, ondrel+skerrow 20.0, skerrow+durnhal 0.0, skerrow+hargrim 30.0, skerrow+lumeth 60.0, skerrow+ondrel 50.0 | 10 / 200 | 35.5 | 30/100 | 41/100 | outside | 1397 | 5233 | 9 of 810 | 130 | 0 | 0 |
| 3v3 | arena03 | brimwick v skerrow | durnhal+hargrim 100.0, durnhal+lumeth 100.0, durnhal+ondrel 100.0, durnhal+quillon 100.0, hargrim+durnhal 100.0, hargrim+lumeth 100.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, lumeth+durnhal 100.0, lumeth+hargrim 100.0, lumeth+ondrel 80.0, lumeth+quillon 60.0, ondrel+durnhal 100.0, ondrel+hargrim 100.0, ondrel+lumeth 100.0, ondrel+quillon 90.0, quillon+durnhal 100.0, quillon+hargrim 100.0, quillon+lumeth 100.0, quillon+ondrel 100.0 | 10 / 200 | 96.5 | 95/100 | 98/100 | outside | 1196 | 3096 | 1 of 664 | 120 | 0 | 0 |
| 3v3 | arena03 | durnhal v hargrim | brimwick+lumeth 100.0, brimwick+ondrel 90.0, brimwick+quillon 40.0, brimwick+skerrow 40.0, lumeth+brimwick 100.0, lumeth+ondrel 90.0, lumeth+quillon 70.0, lumeth+skerrow 80.0, ondrel+brimwick 60.0, ondrel+lumeth 90.0, ondrel+quillon 70.0, ondrel+skerrow 20.0, quillon+brimwick 70.0, quillon+lumeth 100.0, quillon+ondrel 50.0, quillon+skerrow 60.0, skerrow+brimwick 40.0, skerrow+lumeth 90.0, skerrow+ondrel 90.0, skerrow+quillon 10.0 | 10 / 200 | 68.0 | 66/100 | 70/100 | outside | 1439 | 4904 | 8 of 773 | 126 | 1 | 0 |
| 3v3 | arena03 | durnhal v lumeth | brimwick+hargrim 0.0, brimwick+ondrel 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, hargrim+brimwick 0.0, hargrim+ondrel 0.0, hargrim+quillon 0.0, hargrim+skerrow 0.0, ondrel+brimwick 0.0, ondrel+hargrim 0.0, ondrel+quillon 0.0, ondrel+skerrow 0.0, quillon+brimwick 0.0, quillon+hargrim 0.0, quillon+ondrel 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+hargrim 0.0, skerrow+ondrel 0.0, skerrow+quillon 0.0 | 10 / 200 | 0.0 | 0/100 | 0/100 | outside | 1033 | 2014 | 0 of 612 | 128 | 0 | 0 |
| 3v3 | arena03 | durnhal v ondrel | brimwick+hargrim 0.0, brimwick+lumeth 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, hargrim+brimwick 10.0, hargrim+lumeth 0.0, hargrim+quillon 0.0, hargrim+skerrow 0.0, lumeth+brimwick 0.0, lumeth+hargrim 0.0, lumeth+quillon 0.0, lumeth+skerrow 10.0, quillon+brimwick 0.0, quillon+hargrim 0.0, quillon+lumeth 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+hargrim 0.0, skerrow+lumeth 10.0, skerrow+quillon 0.0 | 10 / 200 | 1.5 | 1/100 | 2/100 | outside | 1203 | 4470 | 2 of 657 | 127 | 2 | 0 |
| 3v3 | arena03 | durnhal v quillon | brimwick+hargrim 0.0, brimwick+lumeth 0.0, brimwick+ondrel 0.0, brimwick+skerrow 0.0, hargrim+brimwick 0.0, hargrim+lumeth 0.0, hargrim+ondrel 0.0, hargrim+skerrow 0.0, lumeth+brimwick 0.0, lumeth+hargrim 10.0, lumeth+ondrel 30.0, lumeth+skerrow 20.0, ondrel+brimwick 0.0, ondrel+hargrim 0.0, ondrel+lumeth 0.0, ondrel+skerrow 0.0, skerrow+brimwick 0.0, skerrow+hargrim 0.0, skerrow+lumeth 0.0, skerrow+ondrel 0.0 | 10 / 200 | 3.0 | 0/100 | 6/100 | outside | 1216 | 3902 | 3 of 675 | 126 | 0 | 0 |
| 3v3 | arena03 | durnhal v skerrow | brimwick+hargrim 40.0, brimwick+lumeth 100.0, brimwick+ondrel 90.0, brimwick+quillon 60.0, hargrim+brimwick 70.0, hargrim+lumeth 40.0, hargrim+ondrel 60.0, hargrim+quillon 50.0, lumeth+brimwick 70.0, lumeth+hargrim 80.0, lumeth+ondrel 70.0, lumeth+quillon 90.0, ondrel+brimwick 80.0, ondrel+hargrim 30.0, ondrel+lumeth 80.0, ondrel+quillon 50.0, quillon+brimwick 60.0, quillon+hargrim 60.0, quillon+lumeth 70.0, quillon+ondrel 60.0 | 10 / 200 | 65.5 | 66/100 | 65/100 | outside | 1408 | 5023 | 15 of 806 | 110 | 1 | 0 |
| 3v3 | arena03 | hargrim v lumeth | brimwick+durnhal 0.0, brimwick+ondrel 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, durnhal+brimwick 0.0, durnhal+ondrel 0.0, durnhal+quillon 0.0, durnhal+skerrow 0.0, ondrel+brimwick 0.0, ondrel+durnhal 0.0, ondrel+quillon 0.0, ondrel+skerrow 0.0, quillon+brimwick 0.0, quillon+durnhal 0.0, quillon+ondrel 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+durnhal 0.0, skerrow+ondrel 0.0, skerrow+quillon 0.0 | 10 / 200 | 0.0 | 0/100 | 0/100 | outside | 1060 | 2082 | 0 of 619 | 127 | 0 | 0 |
| 3v3 | arena03 | hargrim v ondrel | brimwick+durnhal 0.0, brimwick+lumeth 0.0, brimwick+quillon 0.0, brimwick+skerrow 0.0, durnhal+brimwick 0.0, durnhal+lumeth 10.0, durnhal+quillon 10.0, durnhal+skerrow 0.0, lumeth+brimwick 0.0, lumeth+durnhal 0.0, lumeth+quillon 0.0, lumeth+skerrow 0.0, quillon+brimwick 0.0, quillon+durnhal 0.0, quillon+lumeth 0.0, quillon+skerrow 0.0, skerrow+brimwick 0.0, skerrow+durnhal 0.0, skerrow+lumeth 0.0, skerrow+quillon 0.0 | 10 / 200 | 1.0 | 1/100 | 1/100 | outside | 1219 | 5326 | 1 of 667 | 127 | 0 | 0 |
| 3v3 | arena03 | hargrim v quillon | brimwick+durnhal 0.0, brimwick+lumeth 0.0, brimwick+ondrel 0.0, brimwick+skerrow 0.0, durnhal+brimwick 0.0, durnhal+lumeth 0.0, durnhal+ondrel 0.0, durnhal+skerrow 0.0, lumeth+brimwick 10.0, lumeth+durnhal 0.0, lumeth+ondrel 10.0, lumeth+skerrow 10.0, ondrel+brimwick 0.0, ondrel+durnhal 0.0, ondrel+lumeth 0.0, ondrel+skerrow 0.0, skerrow+brimwick 0.0, skerrow+durnhal 0.0, skerrow+lumeth 20.0, skerrow+ondrel 0.0 | 10 / 200 | 2.5 | 3/100 | 2/100 | outside | 1163 | 5172 | 1 of 663 | 123 | 1 | 0 |
| 3v3 | arena03 | hargrim v skerrow | brimwick+durnhal 30.0, brimwick+lumeth 70.0, brimwick+ondrel 50.0, brimwick+quillon 90.0, durnhal+brimwick 70.0, durnhal+lumeth 20.0, durnhal+ondrel 50.0, durnhal+quillon 70.0, lumeth+brimwick 70.0, lumeth+durnhal 20.0, lumeth+ondrel 70.0, lumeth+quillon 70.0, ondrel+brimwick 80.0, ondrel+durnhal 10.0, ondrel+lumeth 80.0, ondrel+quillon 70.0, quillon+brimwick 80.0, quillon+durnhal 20.0, quillon+lumeth 50.0, quillon+ondrel 80.0 | 10 / 200 | 57.5 | 62/100 | 53/100 | in band | 1491 | 5262 | 13 of 781 | 111 | 4 | 0 |
| 3v3 | arena03 | lumeth v ondrel | brimwick+durnhal 100.0, brimwick+hargrim 100.0, brimwick+quillon 0.0, brimwick+skerrow 90.0, durnhal+brimwick 20.0, durnhal+hargrim 100.0, durnhal+quillon 50.0, durnhal+skerrow 90.0, hargrim+brimwick 40.0, hargrim+durnhal 100.0, hargrim+quillon 70.0, hargrim+skerrow 80.0, quillon+brimwick 50.0, quillon+durnhal 90.0, quillon+hargrim 100.0, quillon+skerrow 90.0, skerrow+brimwick 60.0, skerrow+durnhal 60.0, skerrow+hargrim 100.0, skerrow+quillon 60.0 | 10 / 200 | 72.5 | 77/100 | 68/100 | outside | 1257 | 2510 | 1 of 752 | 134 | 0 | 0 |
| 3v3 | arena03 | lumeth v quillon | brimwick+durnhal 80.0, brimwick+hargrim 90.0, brimwick+ondrel 90.0, brimwick+skerrow 100.0, durnhal+brimwick 40.0, durnhal+hargrim 50.0, durnhal+ondrel 70.0, durnhal+skerrow 30.0, hargrim+brimwick 50.0, hargrim+durnhal 50.0, hargrim+ondrel 80.0, hargrim+skerrow 40.0, ondrel+brimwick 50.0, ondrel+durnhal 70.0, ondrel+hargrim 100.0, ondrel+skerrow 100.0, skerrow+brimwick 40.0, skerrow+durnhal 80.0, skerrow+hargrim 60.0, skerrow+ondrel 80.0 | 10 / 200 | 67.5 | 65/100 | 70/100 | outside | 1272 | 2429 | 0 of 793 | 130 | 3 | 0 |
| 3v3 | arena03 | lumeth v skerrow | brimwick+durnhal 100.0, brimwick+hargrim 100.0, brimwick+ondrel 100.0, brimwick+quillon 100.0, durnhal+brimwick 100.0, durnhal+hargrim 100.0, durnhal+ondrel 100.0, durnhal+quillon 100.0, hargrim+brimwick 100.0, hargrim+durnhal 100.0, hargrim+ondrel 100.0, hargrim+quillon 100.0, ondrel+brimwick 100.0, ondrel+durnhal 100.0, ondrel+hargrim 100.0, ondrel+quillon 100.0, quillon+brimwick 100.0, quillon+durnhal 100.0, quillon+hargrim 100.0, quillon+ondrel 100.0 | 10 / 200 | 100.0 | 100/100 | 100/100 | outside | 1058 | 2335 | 0 of 607 | 114 | 0 | 0 |
| 3v3 | arena03 | ondrel v quillon | brimwick+durnhal 60.0, brimwick+hargrim 40.0, brimwick+lumeth 80.0, brimwick+skerrow 20.0, durnhal+brimwick 10.0, durnhal+hargrim 0.0, durnhal+lumeth 80.0, durnhal+skerrow 0.0, hargrim+brimwick 30.0, hargrim+durnhal 20.0, hargrim+lumeth 70.0, hargrim+skerrow 0.0, lumeth+brimwick 80.0, lumeth+durnhal 90.0, lumeth+hargrim 90.0, lumeth+skerrow 50.0, skerrow+brimwick 20.0, skerrow+durnhal 20.0, skerrow+hargrim 20.0, skerrow+lumeth 70.0 | 10 / 200 | 42.5 | 38/100 | 47/100 | in band | 1338 | 5121 | 7 of 761 | 127 | 0 | 0 |
| 3v3 | arena03 | ondrel v skerrow | brimwick+durnhal 100.0, brimwick+hargrim 100.0, brimwick+lumeth 100.0, brimwick+quillon 100.0, durnhal+brimwick 100.0, durnhal+hargrim 100.0, durnhal+lumeth 100.0, durnhal+quillon 100.0, hargrim+brimwick 100.0, hargrim+durnhal 100.0, hargrim+lumeth 100.0, hargrim+quillon 100.0, lumeth+brimwick 100.0, lumeth+durnhal 100.0, lumeth+hargrim 100.0, lumeth+quillon 100.0, quillon+brimwick 100.0, quillon+durnhal 100.0, quillon+hargrim 100.0, quillon+lumeth 100.0 | 10 / 200 | 100.0 | 100/100 | 100/100 | outside | 1174 | 4095 | 1 of 629 | 113 | 0 | 0 |
| 3v3 | arena03 | quillon v skerrow | brimwick+durnhal 100.0, brimwick+hargrim 100.0, brimwick+lumeth 100.0, brimwick+ondrel 100.0, durnhal+brimwick 100.0, durnhal+hargrim 100.0, durnhal+lumeth 100.0, durnhal+ondrel 100.0, hargrim+brimwick 100.0, hargrim+durnhal 100.0, hargrim+lumeth 100.0, hargrim+ondrel 100.0, lumeth+brimwick 100.0, lumeth+durnhal 100.0, lumeth+hargrim 100.0, lumeth+ondrel 80.0, ondrel+brimwick 100.0, ondrel+durnhal 100.0, ondrel+hargrim 100.0, ondrel+lumeth 100.0 | 10 / 200 | 99.0 | 98/100 | 100/100 | outside | 1134 | 3231 | 0 of 631 | 127 | 0 | 0 |

### Budget hits

No match hit the budget of 60000 ticks.

### Champions

Win rate in percent over the cells the champion is in, as X or as Y.

| Champion | 2v2 arena01 | 2v2 arena02 | 2v2 arena03 | 3v3 arena01 | 3v3 arena02 | 3v3 arena03 | All |
| --- | --- | --- | --- | --- | --- | --- | --- |
| brimwick | 58.5 | 63.3 | 60.5 | 60.0 | 59.3 | 62.1 | 60.6 |
| durnhal | 19.6 | 18.2 | 24.1 | 22.9 | 20.6 | 23.7 | 21.5 |
| hargrim | 14.1 | 8.7 | 11.6 | 16.8 | 15.3 | 16.4 | 13.8 |
| lumeth | 91.0 | 88.6 | 82.6 | 92.1 | 88.8 | 87.8 | 88.5 |
| ondrel | 63.2 | 62.9 | 68.3 | 67.0 | 66.4 | 71.8 | 66.6 |
| quillon | 80.2 | 81.0 | 83.3 | 74.8 | 74.7 | 74.7 | 78.1 |
| skerrow | 23.5 | 27.3 | 19.6 | 16.4 | 24.9 | 13.6 | 20.9 |
<!-- /balance:report -->

## 5. The cells after the tuning passes

Sections 5.1 to 5.8 read the four-kit report at 9a9c653; 5.9 reads the six-kit
block of #189 (generated at 3704221), 5.10 the block of #186, and 5.11 the
block of #213, which #238 then extended with arena03 into the 90-cell
three-arena block; 5.12 reads the seven-kit block (Durnhal in the harness
roster, the energy orb on, #244; regenerated again for #187's capped one-hit
area lead, at 4407c96); 5.13 reads what the deadlock reach of #222 (batch 18)
did to the 90-cell three-arena block of 5.11 (at 094b42e) and to the seven-kit
block (the block of section 4, at 0246028).

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

The block read here plays six kits: 60 cells, 11 760 matches, each cell about
200 (section 3). The old rates below are those of the four-kit block after the
dodge of #137 (section 4), which no later change moved. Ondrel and Brimwick
(#148, with the bot profiles of #165) are in the harness for the first time. Of
the 60 cells 8 are in band: 5 of the 36 cells that have a new kit (table below)
and 3 of the 24 four-kit cells (5 in the four-kit report). No match hit the
budget. The summed distance of the 60 cells to the band is 1561.3 points, 883.9
of them in the 36 new cells. X is the first kit in file order (`brimwick`,
`hargrim`, `lumeth`, `ondrel`, `quillon`, `skerrow`), so Brimwick is X in her
five pairings and Ondrel's rate is 100 minus X's in her pairings with Brimwick,
Hargrim and Lumeth.

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
Hargrim v Skerrow on arena01, 62.0 to 74.0, and 9.0 on arena02, 53.0 to 44.0)
and by 10.7 in 3v3 (the fill [lumeth, quillon] of Hargrim v Skerrow on arena02,
42.0 to 31.3), inside the intervals above: that movement is the smaller sample
and no kit effect is claimed from it. Five cells moved by more than 7 points of
the pooled rate. In three of them the added fills moved it: Lumeth v Quillon in
2v2 on arena01 (85.5 to 70.0, the fills with a new kit average 49.0 against 91.0
for the old ones), in 2v2 on arena02 (57.0 to 68.0, 9.0 of the move) and in 3v3
on arena02 (52.0 to 74.5, 24.5 of the move, the fills with a new kit average
79.4 against 50.0). In Hargrim v Skerrow in 2v2 on arena01 (40.0 to 52.5) the
seed subset and the added fills each account for about 6 points (+6.0 and +6.5).
The first is the mean of two old fills of 50 matches each, 100 matches and about
10 points of interval, so neither is over its noise. In Hargrim v Skerrow in 3v3
on arena02 (53.0 to 42.7) the move is the seed subset (-9.2 on 16 seeds of the
old 100, at about 17 points of interval for two fills of 16) and the added fills
moved it by -1.1. The cells in band went from 5 to 3: Lumeth v Quillon on
arena02, in 2v2 and in 3v3, left it for Lumeth ahead beyond 60 (68.0 and 74.5),
and the three that stay are Hargrim v Skerrow in 2v2 on arena01 and in 3v3 on
both arenas. The summed distance of the 24 cells went from 666.5 to 677.4. The
16 cells at 0 to 10 or 90 to 100 percent stayed there. Two cells changed side of
50, both Hargrim v Skerrow (2v2 on arena01, 40.0 to 52.5, where Hargrim is now
ahead as roster-v1 has it, and 3v3 on arena02, 53.0 to 42.7); sections 5.2 to
5.7 stay the record of the four-kit report.

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
order in the four-kit block after the dodge of #137 (Lumeth 89.2, Quillon 75.6,
Skerrow 19.1, Hargrim 16.1), where three of the six roster-v1 counters measure
inverted in every cell. So the inversion
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

**The decision on #188.** Accepted as measured (batch #193,
[decision 7](https://github.com/sv-tmueller/claudeline-champions/issues/193#issuecomment-6437420482),
as corrected by
[its correction](https://github.com/sv-tmueller/claudeline-champions/issues/193#issuecomment-6438331837)).
No tuning package is filed. The reason: Hargrim and Skerrow are the two lowest
kits over all 60 cells (11.4 and 13.7, against Lumeth's 89.1 and Quillon's 73.3)
and the roster-v1 web is already inverted the same way, so the inversion is the
bots' strength order across the melee kits and not a Brimwick fault. Tuning her
web would need her 16 inverted cells moved 7 to 39 points to reach the band (17
to 49 to cross 50), and the limit that makes a tuning package the wrong
instrument is the keep rule and the per-champion cap of section 6 (6.2: a summed
distance that falls by at least 7.0 points, and at most 4 kept changes and 10
full runs a champion), not rule 6.3, which is the fixture-search rule. The
720-match table of #165 agrees. The open question is that bots-side reading: it
goes to the next bots package (with the carries of #192), which decides whether
the profiles or the kits move before any roster-v2 rewrite. Sections 1 and 3 of
roster-v2.md stay as the design intent, and #188 closes with PR #200. This
package changes no kit and no bots rule.

Note (2026-10-27, #186): the open question above, whether the profiles or the
kits move first, is read in section 5.10 on a measurement. The figures of this
section stay those of the block of #189, which the #186 block replaced; section
5.10 lists what moved, and #238 extended that block with arena03 into the
three-arena six-kit block of #189, which section 5.11 reads.

### 5.10 The melee presses of #186 (batch 16)

[bots.md](../architecture/bots.md), Testing, "The rule of #186", holds the rule,
its pins and the measurement; this section holds what it did to the block. The
bots' clear-shot test refused a melee press the sim's arc lands (the sim's melee
arc ignores obstacles). #186 exempts a press whose ability's first top-level
effect is a `meleeArc` (Hargrim M1, Skerrow M1, Rend and its EX variant); an arc
after a dash or a teleport, every area, and the stand, the finisher and the
deadlock checks keep the 0.5 m test. It changes no kit and no sim rule. No
identity row of the bots tests moves (all 16 hashes are the same on main and on
the branch), but the change acts only near obstacles, in long matches, and moves
18 of the 36 cells of Hargrim and Skerrow, so the block was regenerated (`npm
run balance` on Node 22.23.2: 11 760 matches, 991.8 s, with two other runs on
the machine).

**The block against the block of #189.** Cells in band: 7 of 60 (8). One cell
leaves the band: 3v3 on arena02, Brimwick v Ondrel, 40.6 to 38.5, 1.5 points
outside it, within the noise of section 3 (Hargrim and Skerrow are among its
fills and it has no Hargrim or Skerrow as X or Y). The 36 new cells have 4 in
band (5) and the 24 four-kit cells 3 (3). The summed distance falls from 1561.3
to 1552.9 points (883.9 to 882.7 in the new cells, 677.4 to 670.2 in the
four-kit cells). 33 of the 60 rates move: 18 of the 36 cells where Hargrim or
Skerrow is X or Y and 15 of the other 24, where the two are fill. Two cells move
more than 4 points, both 3v3 on arena02 with Skerrow: Brimwick v Skerrow 88.5 to
82.8 and Quillon v Skerrow 95.3 to 90.6; the other 31 move by 2.6 points or
less, and no cell moves past the 7 points of the noise. No match hit the budget.
Per champion over all of its cells: Brimwick 52.3 to 51.9, Hargrim 11.4 to 11.7,
Lumeth 89.1 to 89.3, Ondrel 60.1 to 60.2, Quillon 73.3 to 73.0 and Skerrow 13.7
to 13.9.

**The answer to the open question of 5.9.** Do the refused melee presses
explain the low standing of Hargrim (11.4) and Skerrow (13.7)? No. Over the 36
cells (7 056 matches a side, the block's schedule, before and after the change)
the refused presses are 928 episodes of Hargrim M1 against 104 284 presses
(0.9 percent), 728 of Skerrow M1 against 82 758 (0.9) and 933 of Rend against
25 457 (3.7); lifting them adds about 200, 110 and 70 presses and moves the two
kits by 0.3 and 0.2 points over all their cells. The before side of the
measurement reproduces the committed rates of all 36 cells.

**The next step.** The diagnostic (60 cells, seeds 1 to 8 in 2v2 and 1 to 2 in
3v3, after the change) puts the melee kits apart from the other four on three
numbers: Hargrim and Skerrow have the target within their reach on 33.5 and 21.9
percent of their acting thinks (80 to 90 percent for the ranged kits), take 16.1
and 15.3 damage per alive second (5.3 to 8.6), and are retreating for 34.0 and
31.1 percent of their alive thinks (10 to 13); their damage dealt per alive
second (8.6 and 10.3) is that of the ranged damage kits (9.5 to 10.5). So the
two kits are exposed while they close and while they retreat, and not blind at
the press. The next bots step moves the approach and the retreat of the
rangeMin-0 profiles, before any kit change and before a roster-v2 rewrite; a
kit change is the step after, if the standing stays. That is one scratch
diagnostic, no share of any cell is stated as the cause, and the decision stays
with the lead.

### 5.11 The melee stand of #213 (batch 17)

[bots.md](../architecture/bots.md), Testing, "The approach and retreat of #213",
holds the measurement, the rule, its pins and the cascade; this section holds
what it did to the block. A new profile field, `standReach`, makes the two
rangeMin-0 profiles (Hargrim and Skerrow, with a kit and without) stand to engage
once the target is within 0.8 of `rangeMax` (1.6 m and 1.2 m with the shipped
kits), where they stood on the edge of it: the walk-in no longer restarts each
time a target steps back a little. The finisher and the sight logic keep
`rangeMax`; the deadlock check reads `latchReach` since #222 (section 5.13). The
latch of the deadlock rule was left to #222, and no kit or sim rule changes. 14
of the 16 identity rows of the bots tests move
(the first diff ticks are 58 to 320), the Lumeth runs and match-end budgets
re-record, and the rule moves 33 of the 36 cells of Hargrim and Skerrow, so the
block was regenerated on the committed head (decision 1 on #213: a bot change is
measured whole, as in 5.10; `npm run balance` on Node 22.23.2: 11 760 matches,
1348.2 s, with other runs on the machine). Its 36 melee rows equal the 36 rows
of the scratch after side of the measurement (7 056 matches, the block's
schedule, the same schedule and bot seeds).

**The block against the block of 5.10.** Cells in band: 7 of 60 (7), the same
seven, and no verdict changes. The summed distance falls from 1552.9 to 1492.0
points (882.7 to 847.2 in the 36 new cells, 670.2 to 644.8 in the 24 four-kit
cells). 55 of the 60 rates move: 33 of the 36 cells where Hargrim or Skerrow is X
or Y and 22 of the other 24, where the two are fills. Five cells move by more than
the 7 points of the noise of section 3: 2v2 on arena01 Brimwick v Hargrim 90.0 to
78.0, Hargrim v Skerrow 52.5 to 43.0 (still in band) and Brimwick v Skerrow 94.0 to
85.0, 2v2 on arena02 Hargrim v Skerrow 33.5 to 24.0 (outside, 16.0 under the band),
and 3v3 on arena02 Quillon v Skerrow 90.6 to 83.3; 3v3 on arena02 Ondrel v Skerrow
(90.1 to 83.3) moves by 6.8; 42 of the 55 move by less than 4 points. No match hit
the budget. Per champion over all of its cells: Brimwick 51.9 to 50.6, Hargrim 11.7
to 12.6, Lumeth 89.3 to 89.0, Ondrel 60.2 to 59.2, Quillon 73.0 to 72.0 and
Skerrow 13.9 to 16.6.

**What it did.** Over their 20 cells the mean rate of Hargrim goes from 11.77 to
12.64 and Skerrow's from 13.89 to 16.55; their closing damage per alive second
falls (6.07 to 5.71 and 7.00 to 6.32) and so does the share of closing runs that
are re-closes (80.9 to 57.7 percent and 79.9 to 53.2). The stand moves the two kits
by 0.9 and 2.7 points over all their cells and leaves them 23 to 27 points under the
band, so the approach is not what holds them down. What is left of the diagnostic is
the exchange in reach, which is about even, and the latch, which carries half of
their deaths (bots.md, #222). A kit change stays the step after, if the standing
stays; no share of any cell is stated as the cause, and the decision stays with the
lead.

### 5.12 The seven-kit report (batch #251, #244)

Durnhal joins the harness roster and the harness plays the standard match: the
energy orb on, at the arena's point of `data/orbs.json`, in every cell (spec
section 6; rules.md 3.3). His kit is data (#204) and his bot profile is #211, so
nothing about him is new here but his 36 cells: the six pairings against the six
shipped kits, on the three arenas and in both modes. The block was regenerated
on the merged head, on the committed sources, after #187 capped the lead of a
one-hit aim-placed area (at 4407c96): 126 cells, 25 200 matches, 15 in band and
no budget hit; every figure of this section is of that block (section 4 now
holds its regeneration with the deadlock reach of #222, at 0246028, read against
it in section 5.13). Three things move at once and the reading keeps them apart
— the orb, which rides on every cell of the seven kits, Durnhal himself, a new
X, Y and fill of the six, and the cap, whose reach is wide because the capped
areas are the Firecracker of Brimwick and the Binding Sigil of Lumeth and a
Brimwick or Lumeth bot is in all 90 shared cells, as X, Y or one of the fills
(against the #244 block, which holds the orb and the fill already, the cap alone
moves 68 of the 90 and 24 of Durnhal's 36). Per champion over all of its cells
that block reads Brimwick 60.3, Durnhal 21.4, Hargrim 14.7, Lumeth 89.0, Ondrel
66.1, Quillon 77.3 and Skerrow 21.1. The seven-kit block of #244, before the
cap, is the reference the section compares against (its head line and
figures are in the section 4 intro, the `ac23e84` entry).

**Durnhal's 36 cells.** 4 are in band and 32 are out, the summed distance 950.0
points, 26.4 a cell, second only to Lumeth's 29.3. Against the web of roster-v3.md
section 1, which has him beat Lumeth, Skerrow and Hargrim and lose to Quillon
and Brimwick, four of the five hold in direction and one is inverted. The mean
over his six cells (the two modes on the three arenas), Durnhal's own rate:
Brimwick 8.3, Hargrim 65.1, Lumeth 0.1, Ondrel 1.9, Quillon 2.4 and Skerrow
50.8.

| Mode | Arena | X v Y | Durnhal's rate | Standing |
|------|-------|-------|----------------|----------|
| 2v2 | arena01 | durnhal v brimwick | 10.0 | outside, 30.0 from the band |
| 2v2 | arena01 | durnhal v hargrim | 63.0 | outside, 3.0 from the band |
| 2v2 | arena01 | durnhal v lumeth | 0.0 | outside, 40.0 from the band |
| 2v2 | arena01 | durnhal v ondrel | 0.5 | outside, 39.5 from the band |
| 2v2 | arena01 | durnhal v quillon | 0.0 | outside, 40.0 from the band |
| 2v2 | arena01 | durnhal v skerrow | 51.5 | in band |
| 2v2 | arena02 | durnhal v brimwick | 9.0 | outside, 31.0 from the band |
| 2v2 | arena02 | durnhal v hargrim | 64.0 | outside, 4.0 from the band |
| 2v2 | arena02 | durnhal v lumeth | 0.0 | outside, 40.0 from the band |
| 2v2 | arena02 | durnhal v ondrel | 1.5 | outside, 38.5 from the band |
| 2v2 | arena02 | durnhal v quillon | 0.5 | outside, 39.5 from the band |
| 2v2 | arena02 | durnhal v skerrow | 25.5 | outside, 14.5 from the band |
| 2v2 | arena03 | durnhal v brimwick | 9.0 | outside, 31.0 from the band |
| 2v2 | arena03 | durnhal v hargrim | 82.5 | outside, 22.5 from the band |
| 2v2 | arena03 | durnhal v lumeth | 0.0 | outside, 40.0 from the band |
| 2v2 | arena03 | durnhal v ondrel | 0.5 | outside, 39.5 from the band |
| 2v2 | arena03 | durnhal v quillon | 0.0 | outside, 40.0 from the band |
| 2v2 | arena03 | durnhal v skerrow | 55.5 | in band |
| 3v3 | arena01 | durnhal v brimwick | 6.5 | outside, 33.5 from the band |
| 3v3 | arena01 | durnhal v hargrim | 64.0 | outside, 4.0 from the band |
| 3v3 | arena01 | durnhal v lumeth | 0.0 | outside, 40.0 from the band |
| 3v3 | arena01 | durnhal v ondrel | 4.0 | outside, 36.0 from the band |
| 3v3 | arena01 | durnhal v quillon | 2.0 | outside, 38.0 from the band |
| 3v3 | arena01 | durnhal v skerrow | 63.0 | outside, 3.0 from the band |
| 3v3 | arena02 | durnhal v brimwick | 12.0 | outside, 28.0 from the band |
| 3v3 | arena02 | durnhal v hargrim | 50.0 | in band |
| 3v3 | arena02 | durnhal v lumeth | 0.5 | outside, 39.5 from the band |
| 3v3 | arena02 | durnhal v ondrel | 4.0 | outside, 36.0 from the band |
| 3v3 | arena02 | durnhal v quillon | 7.5 | outside, 32.5 from the band |
| 3v3 | arena02 | durnhal v skerrow | 41.0 | in band |
| 3v3 | arena03 | durnhal v brimwick | 3.0 | outside, 37.0 from the band |
| 3v3 | arena03 | durnhal v hargrim | 67.0 | outside, 7.0 from the band |
| 3v3 | arena03 | durnhal v lumeth | 0.0 | outside, 40.0 from the band |
| 3v3 | arena03 | durnhal v ondrel | 1.0 | outside, 39.0 from the band |
| 3v3 | arena03 | durnhal v quillon | 4.5 | outside, 35.5 from the band |
| 3v3 | arena03 | durnhal v skerrow | 68.0 | outside, 8.0 from the band |

The one pairing left open by the web is Skerrow (roots and shields stop the
dive): the cell is in band on two of the three arenas in 2v2 (arena01 and
arena03; 3v3 keeps only arena02, and its arena01 cell left the band under the
cap, 58.5 to 63.0), and the
pairing is a near-even split (Durnhal 50.8), where the web expects him ahead.
Against Lumeth the web expects the `wound` anti-heal (#158) to press her healing
down; instead she takes all six of their cells (Durnhal's rate 0.0, 0.0, 0.0,
0.0, 0.5 and 0.0), five of them without a loss, the widest of his six results
and the one line of the web that is reversed. Against
Quillon the web expects him to be kited from 13 m, and he is: 2.4 means Durnhal
takes none of their six cells, and Quillon's own overall rate is 77.3. Against
Brimwick the web expects her burst to ignore his shields; she takes all six of
their cells (Durnhal 8.3 to her 91.8, 31.8 points over the band), so that is
right in direction. Against Ondrel (1.9) the web has no line at all, because
roster-v3.md section 1 fixes his counter web against the seven existing kits and
his own row against Ysmeer waits for her series; the measured cell is a rout for
Ondrel. Hargrim (65.1) is the one the web gives Durnhal, and he takes it, the
most positive of his six. What every line shares is that the measured cell sits
further from the band than the intent: the pattern is what the bots play. Durnhal
stands at 2.4 m (`rangeMin` 0, his profile of #211) and throws Breaker Throw at a
target walking away, so a melee tank of 160 health walks into the range of the
kits that out-reach him, and his two fixed numbers (`wound` at 10 percent a
stack, 240 ticks) are the ones a later pass would move. The reading is a
candidate for such a package (decision 7 of #193: no tuning here), with the
table above as its first evidence; the four cells in band are the ones such a
candidate would have to hold.

**What the orb, the Durnhal fill and the cap moved.** Of the 90 cells the six
shipped kits shared with the six-kit block, 78 move at all and 12 move by more
than the 7 points of one cell's noise (section 3); 62 move by less than 4. Three
changes are confounded here: the orb and Durnhal, which the #244 block
(`ac23e84`, now in the section 4 intro's history) already held (the orb on every
cell of every kit, Durnhal a new fill of every six-kit cell, so its fills go
from 4 to 5 in 2v2 and from 12 to 20 in 3v3), and #187's cap, which this block
adds on every cell with a Brimwick or Lumeth bot. The seeds are per fill, so the
old fills of a 2v2 cell now play seeds 1 to 40 instead of 1 to 50 (160 of the
cell's 200 matches) and the new fill takes the other 40; in 3v3 the old fills
play 1 to 10 instead of 1 to 16 (120 of 200). The move against the six-kit block
is all three together, as the fill change of #189 was read (5.9); the move
against the #244 block is the cap alone (68 of the 90 cells move, none by more
than 6.5 points, and 24 of Durnhal's 36). No reading separates the orb from the
fill; the cap is separated by the #244 block (`ac23e84`).

Cells in band held in the shared 90, at 11, five left it while five entered. Left
against the six-kit block: Hargrim v Skerrow in 2v2 on arena01 (43.0 to 32.5),
2v2 on arena03 (45.0 to 32.5) and 3v3 on arena02 (40.6 to 34.5), Lumeth v Ondrel
in 2v2 on arena03 (60.0 to 62.0), and Brimwick v Ondrel in 2v2 on arena01 (50.5
to 61.0). Entered: Lumeth v Quillon in 2v2 on arena02 (65.5 to 56.5), Brimwick v
Ondrel in 2v2 on arena03 (37.5 to 47.0) and 3v3 on arena02 (37.0 to 45.0) and
arena01 (34.9 to 45.0), and Hargrim v Skerrow in 3v3 on arena03 (68.8 to 53.0).
The summed distance of the shared 90 rises from 2205.9 to 2254.5 points, and the
per-champion cell count is unchanged at 30. Per champion over its 30
cells within the shared 90: Brimwick 50.3 to 54.0 (+3.7), Hargrim 13.7 to 10.7
(-3.0), Lumeth 87.2 to 86.8 (-0.4), Ondrel 62.2 to 59.7 (-2.5), Quillon 71.8 to
73.3 (+1.4) and Skerrow 14.7 to 15.5 (+0.7): the two kits that were nearest the
band, Hargrim and Skerrow, move apart, the melee one down and the other up, while
the ranged kits move the other way except Quillon. Every
out-of-band cell of the six-kit block that was already accepted stays accepted as
it was; the five that left the band are named above, and their reasons are those
of 5.9 and 5.11 (the melee kits' standing on the approach, the ranged kits'
reach), read here with the orb in. No cell is a tuning candidate on this reading
alone except Durnhal's, and no kit change is made (decision 7 of #193).

**Lumeth's orb contest.** bots.md, "The energy orb", records the flip mechanism:
a ranged kit's reach is 9 to 13 m, so a champion that kites in and out of an
enemy's reach flips the threat test that starts and stops the contest, and
Lumeth's cells read 0 to 46 flips an orb round, the widest of the six. Here her
30 shared cells move by 0.4 point on the mean (87.2 to 86.8), the smallest move
of the six, and 21 of the 30 move by less than 3 points; the nine that move by
3 points or more are 2v2 on arena02 Lumeth v Quillon (65.5 to 56.5, her cell
that entered the band), 3v3 on arena03 Lumeth v Ondrel (69.8 to 76.0), 3v3 on
arena03 Brimwick v Lumeth (6.8 to 12.0), 3v3 on arena01 Brimwick v Lumeth (4.7
to 9.0), 3v3 on arena02 Lumeth v Ondrel (82.8 to 86.5), 2v2 on arena01 Lumeth v
Ondrel (84.0 to 87.5), 2v2 on arena01 Lumeth v Quillon (69.5 to 66.0), 2v2 on
arena03 Lumeth v Quillon (55.0 to 52.0) and 3v3 on arena02 Lumeth v Quillon
(74.0 to 71.0). This move is not the orb alone: it is read against the six-kit
block, so the Durnhal fill and #187's cap (Binding Sigil is a one-hit aim-placed
area) ride on it too, as they do on the whole shared 90. So the
flips, which the single-cell measurement is large enough to see, average out
over her 30 cells: the three changes together move her standing by 0.4 of a
point, and one of her
cells swaps band membership (Lumeth v Quillon in 2v2 on arena02 enters it and
Lumeth v Ondrel in 2v2 on arena03 leaves it), so her count is two either way. The
effect is recorded, not fixed. No bots rule
changes: the contest, the threat range (`rangeMax`, `enemyInReach`) and the
delay ring stay as #225 built them, and no hysteresis is added for the flips
(bots.md, "Not built yet").

No match hit the budget of 60 000 ticks in any of the 126 cells, and the stall
of #123 stays pinned and absent. The reproduction on the linux/amd64 runner
(the manual workflow, `--check --mode`, one job a mode) is the acceptance check
of the issue; the job ids are in the PR of batch #251.

### 5.13 The deadlock reach of #222 (batch 18)

[bots.md](../architecture/bots.md), Testing, "The rule of #222", holds the
measurement, the rule, its pins and the cascade; this section holds what it did to
the block. A new profile field, `latchReach`, replaces `rangeMax` in both the
deadlock rule's entry test and the latched stand of the advance (the rule the
issue names, the lead's rule (a) on #222): it is `rangeMax` for every champion
that keeps its range and 1.25 of it (`LATCH_FRACTION`, `profile.ts`) for the
champions with rangeMin 0, Hargrim, Skerrow and Durnhal, with their kit and
without (2.5 m, 1.875 m and 3.75 m with the shipped kits, 3.75 m, 3.125 m and
4.375 m from the table). `enemyInReach` itself is untouched, so the orb threat
test and the finisher keep `rangeMax`, and no kit or sim rule changes. The 1.25
was screened on seeds 1 to 8 (2v2) and 1 to 2 (3v3) of the 36 cells of #213 and
confirmed on the full cap (the tables are in bots.md); the value is the smallest
reach above 1.0 that lowers both melee kits' latch deaths and `retreatAdvance`
damage taken, and it stays inside the raw M1 arc so the latched bot keeps casting.
11 of the 16 identity rows of the bots tests move (the first diff ticks are 140 to
1 965; five rows never latch within their length), the seeded runs re-record,
and the six-kit block was regenerated on the branch's committed head (at
094b42e; decision 1 on #213: a bot change is measured whole; `npm run balance`
on Node 22.23.2: 17 640 matches, 1264.4 s), and the seven-kit block again on the
merge with main (at 0246028; 25 200 matches, 1797.6 s).

**The six-kit block (094b42e) against the block of 5.11 and #238.** Cells in
band: 12 of 90 (11), a net of one. The summed distance rises from 2205.9 to
2228.5 points, the first regeneration of the six-kit block under which it rises:
847.2 to 856.3 in the 36 new-kit cells of the first two arenas, 644.8 to 654.2
in their 24 four-kit cells, 389.0 to 389.7 in the 18 new-kit arena03 cells and
324.9 to 328.3 in the 12 four-kit arena03 cells. 77 of the 90 rates move, none
by more than the 6.0 points of 2v2 arena01 Brimwick v Ondrel (50.5 to 44.5,
after the #213 stand had already taken it from 52.5 to 43.0 and back; the next
largest are 3v3 arena03 Hargrim v Skerrow, 68.8 to 66.1, and 2v2 arena03
Brimwick v Ondrel, 37.5 to 41.5). Three verdicts change, all in arena03: 2v2
Brimwick v Ondrel in (37.5 to 41.5), 2v2 Lumeth v Ondrel out (60.0 to 61.5, 1.5
points over) and 3v3 Brimwick v Quillon in (37.5 to 41.1), so two cells come in
and one goes out. No match hit the budget. Per champion over all of its cells:
Brimwick 50.3 to 51.5, Hargrim 13.6 to 12.7, Lumeth 87.2 to 87.3, Ondrel 62.2 to
62.6, Quillon 71.9 to 71.8 and Skerrow 14.8 to 14.1.

**What it did.** Over the 20 cells Hargrim and Skerrow are in on the first two
arenas (the cells of 5.11, so the two blocks are comparable) the mean rate of
Hargrim goes from 12.65 to 11.82 and Skerrow's from 16.55 to 15.47: the reach
costs each of the two melee kits about one point, against the 0.9 and 2.7 the
#213 stand had just given them, and leaves them 28 and 25 points under the band.
The latch shrinks a little in time and price (Hargrim 15.5 to 14.9 percent of
alive thinks and 1.42 to 1.37 damage taken per alive second in the advance,
Skerrow 16.8 to 16.3 and 1.48 to 1.42) and the two kits' latch deaths fall
(13 135 to 12 931 and 13 647 to 13 590), still about 70 percent of each kit's
deaths (bots.md, #222). The latch is not the whole of what holds the melee kits
down, and the reach does not close the band: the step after stays a kit change,
if the standing stays. No share of any cell is stated as the cause, and the
decision stays with the lead.

**The seven-kit block on the merge with main.** Section 4 is the block
regenerated on the merge of #222 with main (0246028: seven kits, the orb on,
#187's cap; #160's endArea and #254's spend verbs are in no shipped kit), so
against the block 5.12 reads (4407c96) the move is the reach alone. Cells in
band: 15 of 126 (15), still 4 of Durnhal's 36 and 11 of the shared 90. 110 of
the 126 rates move (81 of the shared 90, 29 of Durnhal's 36), 5 by more than the
7 points of one cell's noise, the largest 3v3 arena02 Durnhal v Hargrim (50.0 to
62.0) and 2v2 arena02 Durnhal v Hargrim (64.0 to 75.5). Four verdicts change:
2v2 arena01 Brimwick v Ondrel in (61.0 to 57.0), 3v3 arena01 Durnhal v Hargrim
in (64.0 to 59.0), 2v2 arena02 Lumeth v Quillon out (56.5 to 66.0) and 3v3
arena02 Durnhal v Hargrim out (50.0 to 62.0). The summed distance rises from
3204.5 to 3227.5 points (2254.5 to 2266.5 in the shared 90, 950.0 to 961.0 in
Durnhal's 36). No match hit the budget. Per champion over all of its cells:
Brimwick 60.3 to 60.6, Durnhal 21.4 to 21.5, Hargrim 14.7 to 13.8, Lumeth 89.0
to 88.5, Ondrel 66.1 to 66.6, Quillon 77.3 to 78.1 and Skerrow 21.1 to 20.9.

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

- `npm run balance` plays all 25 200 matches and writes the block of section 4.
  It needs Node 22.15 or later (the resolve hook is `module.registerHooks`) and
  stops with a message below that. A full run takes about 31 minutes on one
  core of an Apple silicon laptop (the seven-kit block of #244 with the orb; the
  cells are about 52 ms a 2v2 match and 92 ms a 3v3 match before the orb, and the
  seven-kit block scales the six-kit three-arena 8.0 and 13.4 minutes by the
  match counts, so 2v2 is about 11.2 minutes of it and 3v3 about 19.5).
  On the runner of the manual
  workflow the four-kit run took 12 to 16 minutes in one job (runs 38990892639
  at 933 s, 38997052269 at 953 s and 39005677735 at 737 s) and 6 min 28 s (2v2)
  and 11 min 26 s (3v3) in the check steps of the split (run 40461329366), 2.9
  to 3.1 times the local time in 3v3. At seven kits with the orb and three arenas
  the same factor projects to about 34 minutes for 2v2 and about 59 for 3v3, one
  mode a job. The wall time
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
- The report was reproduced with `--check` on the manual workflow of the
  linux/amd64 runner (the seven-kit block of #244, the job ids in the PR); the
  six-kit three-arena block was reproduced with `--check` on macOS (Apple
  silicon) with Node 22.23.2 (`played 17640 matches in 1230.1 s`, the generating
  run before it 1246.0 s, and the two-arena block 11760 matches in 842.7 s)
  and, for the four-kit report, Node 26.7.0. The linux/amd64 reproduction is the
  manual workflow `.github/workflows/balance.yml` (`workflow_dispatch` only,
  never on pull requests or pushes): trigger it with
  `gh workflow run balance.yml --ref <branch>`. It runs `npm ci` and
  `npm run balance -- --check --mode <mode>` on ubuntu, as two jobs side by
  side, one for 2v2 and one for 3v3 (a matrix by mode, so each stays inside its
  `timeout-minutes`: 90 for 2v2 and 150 for 3v3, set from the projection of the
  runner above, twice the check time of the mode because the failure step plays
  the mode again, and a margin; the run below confirmed the two-arena four-kit
  pair at 45 and 75, arena03 raised both by a third, and the seven-kit orb block
  raises them again by about the half). The seeds are
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
  so a replayed 3v3 check was about 53 minutes on two arenas, inside 75; on three
  it is about 80 minutes, inside 105. Bot output across
  platforms is not promised (bots.md, "Determinism"), so the macOS table is the
  report, and a table that differs on another platform gets a platform note here
  with the differing cells.
