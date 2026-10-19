# Roster v2: champions five and six

Status: the kits (#148) and the two models (#149) are built; no bot profile
yet (batch 13)
Source of truth for numbers: [design spec](../superpowers/specs/2026-10-01-claudeline-champions-design.md), sections 4.5, 4.6, 6 and 10, and [rules](rules.md), sections 4.1 and 5

This document defines champions five and six of the roster: a zone controller
and a burst caster. [Decision 2 of batch #134](https://github.com/sv-tmueller/claudeline-champions/issues/134#issuecomment-6232042748) fixed the two archetypes, the names and the ids.
The kit data (batch 12), the models (batch 12) and the bot rules (batch 13)
are built from this document, and this document owns every number in them.
The four champions of [roster v1](roster-v1.md) are unchanged.

## 0. How to read the numbers

- [Roster v1](roster-v1.md), section 0, holds unchanged and is not copied
  here: the spec values, the tuning values, the status ranges, the energy
  table, the toolkit, the windup rules, the EX rules, the 10 s ultimate
  cooldown, the move speed and radius, the kit data rules and the model
  rules. "Per roster-v1 section 0" below means that section. Neither champion
  is a support kit (`support` is false), so neither earns energy by healing,
  and neither has a heal.
- Fixed values. The roster test of batch 12 (`catalogProblems` in
  `packages/sim/test/roster-kits.test.ts`) runs on both kits, so these
  are not tuning values: move speed 5.5 m/s, F cooldown 600 ticks, max health
  120 to 160 in steps of 10, and every `damage` 8 to 30 and up to 60 on F.
  The damage range holds for every effect, so every area pulse counts on its
  own. Statuses follow rules 4.1: ticks and percents inside the catalog, a
  shield of 20 to 60 absorb for 180 to 360 ticks and a knockback of 1 to 4 m
  over 6 to 15 ticks. A projectile has a speed of 12 to 25 m/s and a radius of
  0.2 to 0.6 m (spec 10). No kit lists `energyGain`.
- Lingering areas. Three rules, which are roster choices like the heal range
  of roster-v1 section 0 and are pinned by `catalogProblems`:
  - The total of the damage over the full duration of a lingering area stays
    inside 8 to 30, and inside 8 to 60 on F. The total is the damage of one
    pulse times the number of pulses, which is `ceil(durationTicks /
    intervalTicks)`. Rules 4.1 does the same for damage over time.
  - A pulsing area never carries stun, root or silence. They do not stack,
    the longest remaining time wins, so pulses would chain into a lock that
    never ends. A slow, a damage or a knockback on a pulse is allowed.
  - Each lingering duration is shorter than the cooldown of its slot, so a
    slot never has two of its own areas alive and the live entities stay few
    (step 7 of the tick is quadratic in them).
- Not in the toolkit, so not in any kit here: a delayed detonation, a
  projectile that spawns an area when it ends, a barrier or a wall, a cone or
  a rectangle (an area is one circle with one `targets` filter, and the arc is
  the only cone), a cleanse, an anti-heal, a passive, and any speed change
  other than slow and haste. An area reads the aim on the tick it fires, so a
  placed area follows its target through the windup. Areas ignore obstacles.
  `toward` pulls to the caster's position now and `away` pushes from the
  centre of the area or the contact point.
- Energy. A hit gives energy only if it carries a `damage` (rules 3.1): a
  slow, a shield, a stun or a push alone gives nothing, and one cast gives
  energy once per target however many pulses touch it. Each kit therefore has
  damage on M1, M2, Q, E and F, so it can earn energy at the rate of the
  rules 3.2 example (2 M1 hits and 1 skill hit per 10 s of combat give 20
  energy).
- Reach, as in roster-v1 section 0: a projectile's `lifetimeTicks` is its
  range times 60 divided by its speed, rounded to a whole tick, and its reach
  is its speed times its lifetime divided by 60. Every projectile here uses a
  pair that comes out exact, so the reach equals the range: 20 m/s for 30
  ticks is 10 m, 16 m/s for 30 ticks is 8 m, 20 m/s for 33 ticks is 11 m, 24
  m/s for 25 ticks is 10 m, 12 m/s for 50 ticks is 10 m and 20 m/s for 36
  ticks is 12 m. Neither kit has an arc, and any arc written later is a
  `cosHalfAngle` of cos(A/2) as a 10-decimal literal. Batch 12 then converts
  every number without moving it.
- Table rows become data as in roster-v1 section 0, with these additions. "N
  pulses of I s over D s" is an `area` with `durationTicks` D times 60 and
  `intervalTicks` I times 60, which gives N = D / I pulses here. "6 pulses
  every 20 ticks over 2.0 s" is `intervalTicks` 20 and `durationTicks` 120.
  "Placed at the aim up to N m" is the `aim` placement with `range` N. "Pull
  toward caster" is a `knockback` with the direction `toward`, and "outward"
  is `away`. A circle that does two things is two `area` effects on the same
  circle, listed in the order the table names them. Effects listed after a
  `dash` act at the start point, because the dash only starts to move the
  caster.
- **Kit data (built).** `data/kits/ondrel.json` and
  `data/kits/brimwick.json`, one file per champion named after its id, built
  by batch 12 (#148) under roster-v1 section 0, with a scripted fixture each
  (`scripted-roster-ondrel-arena01-2v2.json` and the Brimwick one). A number
  changes in the file, here and in the scripted fixture in the same change.
- **Models (built).** `assets/models/champions/ondrel.glb` and
  `assets/models/champions/brimwick.glb`, built by `tools/blender` (#149) as
  roster-v1 section 0 describes: the shared body in the champion's body
  colour, one cue, the shared rig and the six clips. Ondrel's colour is the
  one decision 2 of batch #134 reserved. Brimwick's moved, by decision 1 of
  batch #147, and her model paragraph says why. The committed
  `test_champion_models.py` checks both files, and the figures in the model
  subsections come from its functions. The client loads neither before
  batch 13.
- The names were checked by hand against the Bloodline Champions and
  Battlerite rosters. They are original (ADR-005).

## 1. The gaps the four leave

Roster v1 has one champion per archetype: melee bruiser, ranged skillshot,
healer and support, mobile assassin. Three gaps stay, and neither champion
below needs a new primitive to fill them.

- **No lingering area.** Every area in the four kit files is one hit
  (`durationTicks` 1). The toolkit has lingering areas and none of the four
  uses one. The zone controller is the champion built on them.
- **No range between 3 and 6 m.** The intended bands are these.

  | Champion | Intended range | Source |
  |----------|----------------|--------|
  | Hargrim | 0 to 3 m, hook 9 m | roster v1 |
  | Skerrow | 0 to 2.5 m, closing from 6 to 8 m | roster v1 |
  | Ondrel | 5 to 9 m | section 2 |
  | Lumeth | 6 to 10 m | roster v1 |
  | Brimwick | 7 to 10 m | section 3 |
  | Quillon | 9 to 13 m | roster v1 |

  The melee pair stop at 3 m and Lumeth starts at 6 m, so nothing intends
  3 to 6 m, and only Lumeth, a support, stands from 6 to 9 m. Ondrel takes
  5 to 9 m as a damage dealer. Brimwick shares Lumeth's band on purpose: her
  place in the roster is the burst, not the distance.
- **No burst through the heals.** Outside the ultimates no hit of roster v1 is
  above 30 (Quillon's Lance EX), which one Aegis Veil of Lumeth (30 absorb)
  takes whole, and her heals undo the rest. A burst caster is the champion
  whose damage comes in a few large hits, and the ultimate of this one is the
  first hit above 50.

The counter web below is design intent, five lines per new champion. Each
existing champion gets one win and one loss against the pair, so the web stays
closed, and the six counters of roster v1 stand unchanged.

| | Hargrim | Quillon | Lumeth | Skerrow | The other new champion |
|---|---|---|---|---|---|
| Ondrel | beats | loses | loses | beats | beats Brimwick |
| Brimwick | loses | beats | beats | loses | loses to Ondrel |

Over six champions the records are Hargrim 3 wins and 2 losses, Quillon 2 and
3, Lumeth 2 and 3, Skerrow 3 and 2, Ondrel 3 and 2, Brimwick 2 and 3. The
line "Ondrel beats Skerrow" is conditional on a Mire being down before Quiet
Dart lands (section 2).

The measured state of roster v1 is the reason to read the web with care. In
the report of [balance](balance.md) (section 6), over the cells each
champion is in, Hargrim wins 16.4 percent, Lumeth 79.1, Quillon 85.3 and
Skerrow 19.2, and three of the six v1 counters measure inverted in every
cell. The bots, which did not dodge in that report and never press some
abilities, may account for much of that, so this document states the web as
intent and adds no measured number.

## 2. Ondrel, the zone controller

**Fantasy.** Ondrel is a fen-reeve who keeps the dykes of a sinking marsh. She
cannot hold ground by force, so she turns dry ground into mire, fences it with
reeds and drags people into it. A fight against her is a fight over where
everybody is standing.

**Role and range.** Zone controller. Intended range is 5 to 9 m, with the
Mire and the Drowned Ground placed up to 8 m from her. Her ground stays down
for 2 to 5 s, so she plays the space between the fighters more than the
fighters.

**Stats.**

| Stat | Value |
|------|-------|
| Max health | 130 |
| Move speed | 5.5 m/s, no kit modifier |
| Collision radius | 0.5 m |

Max health 130 sits inside the spec range of 120 to 160. It is a mixed-role
value, in steps of 10 (rules 5), like Skerrow's.

**Abilities.**

| Slot | Ability and effects | Amount | Range | Speed / radius | Cooldown | Windup | Statuses applied |
|------|---------------------|--------|-------|----------------|----------|--------|------------------|
| M1 | Clod Toss: `projectile` | 9 damage | 10 m | 20 m/s / 0.3 m | 0.6 s | 0.15 s, free | none |
| M2 | Mire: `area` (circle, radius 2.0 m, placed at the aim up to 8 m, 3 pulses of 1.0 s over 3.0 s), `applyStatus` | 8 damage per pulse, 24 in total | 8 m to centre | n/a | 6 s | 0.4 s, slowed | slow 30 percent for 1.5 s on each pulse |
| SPACE | Reed Step: `dash` (4.5 m in 0.25 s), `area` (circle, radius 1.5 m around caster, at the start point, 2 pulses of 1.0 s over 2.0 s), `applyStatus` | none | 4.5 m | n/a | 8 s | 0, free | slow 40 percent for 1.0 s on each pulse |
| Q | Reed Fence: `area` (circle, radius 2.5 m around caster, one hit), then `area` (the same circle, 6 pulses every 20 ticks over 2.0 s), `knockback` (1 m outward in 6 ticks on each pulse) | 10 damage, once | 2.5 m radius | n/a | 12 s | 0.3 s, slowed | none |
| E | Undertow: `projectile`, `knockback` (pull toward caster, up to 3 m in 15 ticks, stops at contact), `applyStatus` | 10 damage | 8 m | 16 m/s / 0.5 m | 8 s | 0.4 s, slowed | slow 40 percent for 1.5 s |
| R | Reed Screen: `shield` on self, `area` (circle, radius 3.0 m around caster, 3 pulses of 1.0 s over 3.0 s), `applyStatus` | 40 absorb for 4 s | 3 m radius | n/a | 14 s | 0, free | slow 30 percent for 1.0 s on enemies in the area, on each pulse |
| F | Drowned Ground (ultimate): `area` (circle, radius 4.0 m, placed at the aim up to 8 m, 5 pulses of 1.0 s over 5.0 s), `applyStatus` | 10 damage per pulse, 50 in total | 8 m to centre | n/a | 10 s | 0.7 s, locked | slow 40 percent for 1.5 s on each pulse |

Reading the rows. Every lingering area targets enemies. The pulses of an area
are on its ticks 0, 1.0 s, 2.0 s and so on, so the first pulse lands when the
area is placed. The slow of a pulse is refreshed by the next one, so a target
that stays in the Mire stays slowed, and one that leaves it is still slowed for
1.5 s. Reed Step's patch is where she starts the dash, not where she ends.
Reed Fence is a one-hit area for the damage, which gives the energy, and a
lingering area for the push, which gives none. The push comes 6 times, one
every 20 ticks (0.33 s), so it is 3 m/s of repel while it lasts. Slows from
different slots add and stop at 70 percent in total (rules 4.1). No pulse
carries stun, root or silence. Each lingering duration (3.0, 2.0, 2.0, 3.0 and
5.0 s) is shorter than the cooldown of its slot.

**EX variants** (Shift plus slot, 25 energy).

| Slot | What changes against the base ability |
|------|----------------------------------------|
| M2 | Mire EX: radius 2.0 m becomes 2.5 m, damage per pulse 8 becomes 10 (30 in total), slow becomes 40 percent for 2.0 s. |
| E | Undertow EX: the projectile pierces every champion in its path (each is hit and pulled once), damage 10 becomes 12, slow becomes 50 percent for 2.0 s. |

**Intended counters.**

- Beats Hargrim. He must cross 5 to 9 m of her ground. Mire (30 percent) and
  Reed Screen's field (30 percent) add to 60 percent, which cuts his 5.5 m/s
  to 2.2 m/s. Reed Fence pushes him 1 m every 0.33 s, which is 3 m/s, so with
  no haste up he cannot close on Maul Swing's 3.0 m inside it. Any one haste
  beats the push (Rush 3.3 m/s, Rally Cry 3.85, Rush with Iron Hide 4.4), so
  the Fence holds Hargrim only while no haste is up. Rush is one 5 m hop
  every 7 s, and Chain Hook is one 14 damage pull every 9 s.
- Beats Skerrow, if a Mire is down before Quiet Dart lands, with Reed Screen
  and Reed Fence on top for the full hold. The dart puts the silence of 1.5 s
  on Ondrel: it stops every cast of hers, Reed Step, Reed Screen and Reed
  Fence included, but not a windup already running (rules 2.4) and not
  ground already down. Skerrow is not silenced, so she can press Lunge EX in
  those 1.5 s. From 9 m the dart lands 0.61 s after she presses it (a 0.2 s
  windup, then 8.2 m at 20 m/s). In the 1.5 s of silence she deals Rend 14,
  two pulses of its damage over time 8, Throwing Knife 12, three Twin Cuts 27
  and the dart's 8: 69, and at most 83 with Lunge EX and at most about 100
  with Lunge EX and Rend EX (50 energy), both upper bounds that need the
  energy and every hit. With ground down first, the Mire and Reed Screen's
  field slow her 60 percent and she walks 2.2 m/s against Reed Fence's 3 m/s
  push. With Reed Screen's 40 absorb up before the dart, Ondrel is left with
  130 + 40 - 69 = 101 after the plain burst, and with 87 against the 83 of
  Lunge EX. These sums replace the "above 90" of
  [decision 5 of batch #134](https://github.com/sv-tmueller/claudeline-champions/issues/134#issuecomment-6232419091),
  as package A of
  [batch #147](https://github.com/sv-tmueller/claudeline-champions/issues/147)
  says ("with its sum stated").
  Under the Screen's 30 percent alone she walks 3.85 m/s, faster than the
  push, so the Fence holds her only with the Mire's slow on top. An open race
  from the dart is roughly even, and Skerrow's with EX.
- Beats Brimwick. A caster in a locked windup stands in the mire: Starshell
  (0.7 s) and Grand Finale (1.0 s) cannot walk, so two of the Mire's three
  pulses land, 16 in all, the second while she is still inside its 2.5 m
  reach, and slowed 30 percent she needs 0.65 s after her lock to walk out.
  Undertow drags her 3 m closer, and Ondrel has 130 health to her 120.
- Loses to Quillon. Rod Bolt reaches 13.93 m and Lance 17.92 m, and the
  longest of Ondrel's ordinary tools reach 10 m (Clod Toss) and 10.5 m (the
  Mire). Skip, a 4 m teleport, and Hush Ward's 30 percent haste take Quillon
  out of every zone.
- Loses to Lumeth. Aegis Veil absorbs 30, which is more than all of the 24 of
  a Mire, and Soothing Surge heals 14 plus 12 over time, so the zone chip is
  outhealed. Binding Sigil roots Ondrel for 1.5 s, and a rooted champion
  cannot start Reed Step (rules 2.3).

**Bot profile sketch.**

| Field | Value | From the roster |
|-------|-------|-----------------|
| `rangeMin` | 5 | The roster's 5 m, in a `PROFILES` row (5 to 9) and a `KIT_RULES` row for `ondrel` (5), so she kites a target closer than 5 m (batch 13). |
| `rangeMax` | 9 | Comes from the M1 band: Clod Toss reaches 10 m, minus `RANGE_MARGIN` 1 m, through the `KIT_RULES` row. It equals the roster's 9 m. |
| `openers` | E (Undertow), `band` null (the kit band less the margin, 7 m), `motion` `'away'`, `when` null | A target that walks away is dragged back into her ground. M2 has no rule and is pressed on its band. |
| `escapes` | SPACE (Reed Step), then R (Reed Screen) | Dash away from the target and leave the patch, then shield. |
| `holdF` | false | Drowned Ground is pressed on its band with 100 energy. |
| `wait` | null | She does not wait for her opener. |
| `escapeWithin` | null | The common trigger: a retreat with the target inside 6 m, or a kite inside `rangeMin`. |
| `allies` | empty | No slot of hers acts on an ally. |
| Finisher (intent, not a profile field) | M2 (EX Mire with 25 energy, 30 in total) on a target at 30 health or less, or E on a fleeing one | The pattern of roster v1. The bots build no per-slot finisher. |

The bands (kit band less the margin) are M1 9 m, M2 9.5 m, E 7 m, R 2.5 m,
Q 2.0 m and F 11.5 m. An area press needs a clear shot of 0.5 m, so bots will
not use "behind cover". Reed Step has a band of 1.0 m from its own area, so the
usual walk presses it only at a target that touches her, and the escape rule
presses it otherwise. Every slot is pressed, so no slot is never pressed.

**Model.** Cue: a reed bundle strapped to her back, one thin box of 0.08 m
by 0.16 m by 0.52 m, built in the body material and carried by the `Spine`
bone like Hargrim's shoulder blocks. Its centre is at (-0.16, 0, 1.56), so it
spans x from -0.20 m to -0.12 m and 1.30 m to 1.82 m high. It stands 5 cm
proud of the torso's back face and 12 cm above the head, so the top is
1.82 m, at most 1.90 m, and the footprint stays inside 0.5 m. It is behind
the torso and clear of the visor (x from 0.11 m) and the chest plate (x from
0.14 m), so neither is hidden from the 55 degree camera. The bundle is
shorter and higher than the first draft (x from -0.25 m to -0.15 m, 1.00 m to
1.80 m high) because of the shared `Death` clip. At its key 30 the body lies
on its back (`Hips` turned -85 degrees and 0.64 m down), and the draft's
lowest corner would be 71.6 mm under the floor, where the tolerance is 0.1
mm. The clips are shared and the four existing models must not move, so the
cue moved. At key 30 the bundle's lowest point is 4.3 mm above the floor. The
clip tops with it are 1.8364 m (Idle), 1.8758 m (Run), 1.8339 m (Attack),
1.8359 m (Cast), 1.8200 m (Hit) and 1.8200 m (Death), all under 1.90 m.

Body colour: moss green, linear (0.03, 0.30, 0.03), about `#309530`. In 8-bit
sRGB b minus g is -101, so the overlay rule holds (`overlay None`). The
nearest colours are the dead grey `#5a6070` at 93.1, Skerrow at 101.0 and
Quillon at 101.1, so the minimum distance is 93.1, above the 80 the test
asks for. The model is 37 544 bytes and 264 triangles.

## 3. Brimwick, the burst caster

**Fantasy.** Brimwick is a festival pyrotechnist, and every cast of hers is a
lit fuse. She plants a firecracker, lights the long fuse and waits for the
bang, and the big ones come late and hit hard. She is a glass cannon: if the
fuse is cut short, a stun in the middle of a windup, she has nothing left.

**Role and range.** Burst caster. Intended range is 7 to 10 m, and her
longest shot reaches 12 m. Her damage comes in three beats: a Firecracker of
12, a Starshell of 26 and a Grand Finale of 55.

**Stats.**

| Stat | Value |
|------|-------|
| Max health | 120 |
| Move speed | 5.5 m/s, no kit modifier |
| Collision radius | 0.5 m |

**Abilities.**

| Slot | Ability and effects | Amount | Range | Speed / radius | Cooldown | Windup | Statuses applied |
|------|---------------------|--------|-------|----------------|----------|--------|------------------|
| M1 | Spark: `projectile` | 10 damage | 11 m | 20 m/s / 0.3 m | 0.6 s | 0.15 s, free | none |
| M2 | Firecracker: `area` (circle, radius 1.5 m, placed at the aim up to 9 m, one hit) | 12 damage | 9 m to centre | n/a | 5 s | 0.4 s, slowed | none |
| SPACE | Flare Step: `teleport` (up to 6 m toward the aim point, not fixed) | none | 6 m | n/a | 10 s | 0, free | none |
| Q | Flash Powder: `projectile`, `applyStatus` | 10 damage | 10 m | 24 m/s / 0.35 m | 11 s | 0.1 s, free | stun 0.75 s |
| E | Starshell: `projectile`, `knockback` (2 m outward in 10 ticks) | 26 damage | 10 m | 12 m/s / 0.6 m | 9 s | 0.7 s, locked | none |
| R | Smoke Pot: `area` (circle, radius 3.5 m around caster, one hit), `applyStatus` | none | 3.5 m radius | n/a | 13 s | 0, free | slow 40 percent for 1.5 s on enemies in the area, haste 40 percent for 1.5 s on self |
| F | Grand Finale (ultimate): `projectile`, `applyStatus` | 55 damage | 12 m | 20 m/s / 0.5 m | 10 s | 1.0 s, locked | stun 1.0 s |

Reading the rows. She has no lingering area, so every area of hers is one hit.
Her biggest hits are projectiles on purpose: a placed area reads the aim on
the tick it fires and follows its target through the windup, so the Firecracker
keeps a radius of 1.5 m and is the smallest of her three hits, while Starshell
(12 m/s, the slowest a projectile may be) and Grand Finale can be walked out
of. Starshell's knockback pushes from the shell's centre at contact to the
target, so a glancing hit pushes sideways. The stun of Flash Powder is 0.75 s
(45 ticks) and that of Grand Finale 1.0 s, and both interrupt a windup (rules
2.4). Flash Powder has a 0.1 s windup and a 24 m/s shell, so it reaches a
target 7 m away 0.36 s after the press (0.1 + (7 - 0.85) / 24, the 0.85 m
being the two radii) and one 9 m away after 0.44 s. Smoke Pot gives no
energy, since it has no damage.

**EX variants** (Shift plus slot, 25 energy).

| Slot | What changes against the base ability |
|------|----------------------------------------|
| M2 | Firecracker EX: radius 1.5 m becomes 2.0 m, damage 12 becomes 20, and the area also applies slow 30 percent for 1.5 s. |
| E | Starshell EX: windup 0.7 s becomes 0.4 s, damage 26 becomes 30, and knockback 2 m becomes 3 m. |

**Intended counters.**

- Beats Quillon. Flare Step (6 m, no windup) takes her from 13 m away to 7 m
  from Quillon, inside Flash Powder (10 m) and Firecracker (11 m, areas
  ignore cover). Flash Powder lands 0.36 s after the press at 7 m and 0.44 s
  at 9 m, so pressed as a Lance (0.6 s locked windup) or a Sunspear (0.8 s)
  starts, its 0.75 s stun cancels it (rules 2.4). Firecracker's 0.4 s windup
  also fits inside Lance's 0.6 s, and a locked Quillon cannot walk out of its
  1.5 m.
- Beats Lumeth. Flash Powder lands 0.36 s after the press at 7 m and 0.40 s at
  8 m, so pressed within 0.14 s of a Binding Sigil (0.5 s windup) starting, or
  0.2 s of a Dawnbloom (0.6 s), its 0.75 s stun cancels it with no refund of
  energy or cooldown. That is a throw as the windup starts, not a reaction to
  its end. Grand Finale's 55 goes 25 past the 30 absorb of Aegis Veil.
- Loses to Hargrim. Iron Hide's 40 absorb soaks Starshell's 26, he has 160
  health to her 120, and Chain Hook (14 damage, 9 m) pulls her 4 m into Maul
  Swing and Ground Slam. Smoke Pot's 40 percent slow (once every 13 s), Flare
  Step's 6 m, and a Flash Powder stun thrown as Quarry Break's 0.5 s locked
  windup starts, are her answers.
- Loses to Skerrow. Quiet Dart silences Flare Step and every other cast for
  1.5 s from 11 m, and Lunge closes 6 m inside the 0.7 s locked windup of
  Starshell. Rend does 14 plus 16 over time against 120 health.
- Loses to Ondrel. A caster in a locked windup stands in the mire: Starshell
  (0.7 s) and Grand Finale (1.0 s) cannot walk, so two of the Mire's three
  pulses of 8 land and its 30 percent slow holds, Undertow drags her 3 m
  closer, and Ondrel has 130 health to her 120.

**Bot profile sketch.**

| Field | Value | From the roster |
|-------|-------|-----------------|
| `rangeMin` | 7 | The roster's 7 m, in a `PROFILES` row (7 to 10) and a `KIT_RULES` row for `brimwick` (7), so she kites a target closer than 7 m (batch 13). |
| `rangeMax` | 10 | Comes from the M1 band: Spark reaches 11 m, minus `RANGE_MARGIN` 1 m, through the `KIT_RULES` row. It equals the roster's 10 m. |
| `openers` | Q (Flash Powder), `band` null (the kit band less the margin, 9 m), `motion` `'closing'`, `when` null | Stun the target that walks in on her. The rest of her slots have no rule and are pressed on their bands. |
| `escapes` | SPACE (Flare Step), then R (Smoke Pot) | Teleport away from the target (up to 6 m, `min(range, aim distance)` as it is not fixed), then slow and haste. |
| `holdF` | true | Grand Finale is held for a target at 55 health or less, the damage of F, or one that is cornered. |
| `wait` | null | She does not wait for her opener. |
| `escapeWithin` | null | The common trigger: a retreat with the target inside 6 m, or a kite inside `rangeMin`. |
| `allies` | empty | No slot of hers acts on an ally. |
| Finisher (intent, not a profile field) | F (Grand Finale) on a target at 55 health or less, E (EX Starshell with 25 energy, 30 damage) on one at 30 or less | The pattern of roster v1. The bots build no per-slot finisher. |

The bands (kit band less the margin) are M1 10 m, M2 10 m, Q 9 m, E 9 m, R
3 m and F 11 m, and the band top of Firecracker EX (11.5 m) stays below F's
(12 m), as the EX bands of Hargrim and Quillon do. An area press needs a clear
shot of 0.5 m, so bots will not use "behind cover". Flare Step has no band,
since a teleport reaches nobody, so only the escape rule presses it. Every
slot is pressed, so no slot is never pressed.

**Model.** Cue: a fuse cap, a box of 0.22 m by 0.22 m by 0.16 m on top of
the head, built in the body material and carried by the `Spine` bone like
Lumeth's halo. Its centre is at (-0.02, 0, 1.74), so it spans 1.66 m to 1.82 m
and the top is 1.82 m, at most 1.90 m, and the footprint stays
inside 0.5 m. It sits from x -0.13 m to 0.09 m, above the visor (which ends
at 1.61 m and starts at x 0.11 m) and well above the chest plate, so neither
is hidden from the 55 degree camera. At the shared `Death` clip's key 30 its
lowest point is 105 mm above the floor. The clip tops are 1.8340 m (Idle),
1.8636 m (Run), 1.8278 m (Attack), 1.8285 m (Cast), 1.8244 m (Hit) and
1.8327 m (Death), all under 1.90 m. The model is 37 524 bytes and 264
triangles.

Body colour: burnt orange, linear (0.74, 0.12, 0.00), about `#df6100`. In
8-bit sRGB b minus g is -97, so the overlay rule holds (`overlay None`). The
colour moved from the reserved value of decision 2 of batch #134, linear
(0.72, 0.19, 0.00), about `#dd7900`, by decision 1 of batch #147. The
reserved value passed the model test's colour set, but it is 64.7 from the
HUD's energy colour `#ffb000`, and the client's `hud-palette.test.ts` holds
every body 80 from the colours of the HUD, the result panel and the menu. The
body moved 24.1 from the reserved value, and the HUD and its screenshots
stayed. The nearest colours are Hargrim at 84.7, the HUD energy colour at
85.2 and the enemy health bar `#ff4d4f` at 87.5, then the enemy projectile
`#ff8a5c` at 105.7, so the minimum distance is 84.7, above the 80 the tests
ask for. It is 188.8 from Ondrel's body.

## 4. The range table

Every number of sections 2 and 3 that a range binds has one row. The rows are
the leaves that `catalogProblems` visits on the kit files. An EX variant
is a complete ability there, so its rows repeat the numbers it does not change.
Added to them are `maxHealth`, `moveSpeed`, the F cooldown, the costs of the EX
variants and of F, the count of EX variants, and a total row for each lingering
area. The areas of Ondrel that carry no damage have a total row of 0, which
the 8 to 30 rule does not bind. Brimwick has no lingering area, so she has no
total or duration row. The sources are the spec section 10, rules 4.1 and
5, roster-v1 section 0 and section 0 of this document.

| Champion | Where (slot / EX / effect) | Number | Value | Range | Source | In range |
|----------|----------------------------|--------|-------|-------|--------|----------|
| Ondrel | stats | `maxHealth` | 130 | 120 to 160, steps of 10 | spec 10, rules 5 | yes |
| Ondrel | stats | `moveSpeed` | 5.5 m/s | 5.5 m/s | spec 10 | yes |
| Ondrel | F | cooldown | 600 ticks (10 s) | 600 ticks | roster-v1 §0 | yes |
| Ondrel | M1 | projectile speed | 20 m/s | 12 to 25 m/s | spec 10 | yes |
| Ondrel | M1 | projectile radius | 0.3 m | 0.2 to 0.6 m | spec 10 | yes |
| Ondrel | M1 | damage | 9 | 8 to 30 | spec 10 | yes |
| Ondrel | M2, per pulse | damage | 8 | 8 to 30 | spec 10 | yes |
| Ondrel | M2 | total over 3 pulses | 24 (8 times 3) | 8 to 30 | roster-v2 §0 | yes |
| Ondrel | M2, each pulse | slow percent | 30 | 20 to 60 | rules 4.1 | yes |
| Ondrel | M2, each pulse | slow ticks | 90 (1.5 s) | 60 to 180 | rules 4.1 | yes |
| Ondrel | M2 | duration against cooldown | 180 ticks against 360 | below the cooldown | roster-v2 §0 | yes |
| Ondrel | M2 EX, per pulse | damage | 10 | 8 to 30 | spec 10 | yes |
| Ondrel | M2 EX | total over 3 pulses | 30 (10 times 3) | 8 to 30 | roster-v2 §0 | yes |
| Ondrel | M2 EX, each pulse | slow percent | 40 | 20 to 60 | rules 4.1 | yes |
| Ondrel | M2 EX, each pulse | slow ticks | 120 (2 s) | 60 to 180 | rules 4.1 | yes |
| Ondrel | M2 EX | duration against cooldown | 180 ticks against 360 | below the cooldown | roster-v2 §0 | yes |
| Ondrel | SPACE, area, each pulse | slow percent | 40 | 20 to 60 | rules 4.1 | yes |
| Ondrel | SPACE, area, each pulse | slow ticks | 60 (1 s) | 60 to 180 | rules 4.1 | yes |
| Ondrel | SPACE, area | total over 2 pulses | 0, no damage or heal | 8 to 30 where an area carries damage or heal | roster-v2 §0 | n/a, carries neither |
| Ondrel | SPACE | duration against cooldown | 120 ticks against 480 | below the cooldown | roster-v2 §0 | yes |
| Ondrel | Q, one-hit area | damage | 10 | 8 to 30 | spec 10 | yes |
| Ondrel | Q, lingering area, each pulse | knockback distance | 1 m | 1 to 4 m | rules 4.1 | yes |
| Ondrel | Q, lingering area, each pulse | knockback ticks | 6 | 6 to 15 | rules 4.1 | yes |
| Ondrel | Q, lingering area | total over 6 pulses | 0, no damage or heal | 8 to 30 where an area carries damage or heal | roster-v2 §0 | n/a, carries neither |
| Ondrel | Q | duration against cooldown | 120 ticks against 720 | below the cooldown | roster-v2 §0 | yes |
| Ondrel | E | projectile speed | 16 m/s | 12 to 25 m/s | spec 10 | yes |
| Ondrel | E | projectile radius | 0.5 m | 0.2 to 0.6 m | spec 10 | yes |
| Ondrel | E | damage | 10 | 8 to 30 | spec 10 | yes |
| Ondrel | E, pull | knockback distance | 3 m | 1 to 4 m | rules 4.1 | yes |
| Ondrel | E, pull | knockback ticks | 15 | 6 to 15 | rules 4.1 | yes |
| Ondrel | E | slow percent | 40 | 20 to 60 | rules 4.1 | yes |
| Ondrel | E | slow ticks | 90 (1.5 s) | 60 to 180 | rules 4.1 | yes |
| Ondrel | E EX | projectile speed | 16 m/s | 12 to 25 m/s | spec 10 | yes |
| Ondrel | E EX | projectile radius | 0.5 m | 0.2 to 0.6 m | spec 10 | yes |
| Ondrel | E EX | damage | 12 | 8 to 30 | spec 10 | yes |
| Ondrel | E EX, pull | knockback distance | 3 m | 1 to 4 m | rules 4.1 | yes |
| Ondrel | E EX, pull | knockback ticks | 15 | 6 to 15 | rules 4.1 | yes |
| Ondrel | E EX | slow percent | 50 | 20 to 60 | rules 4.1 | yes |
| Ondrel | E EX | slow ticks | 120 (2 s) | 60 to 180 | rules 4.1 | yes |
| Ondrel | R, shield | shield absorb | 40 | 20 to 60 | rules 4.1 | yes |
| Ondrel | R, shield | shield ticks | 240 (4 s) | 180 to 360 | rules 4.1 | yes |
| Ondrel | R, area, each pulse | slow percent | 30 | 20 to 60 | rules 4.1 | yes |
| Ondrel | R, area, each pulse | slow ticks | 60 (1 s) | 60 to 180 | rules 4.1 | yes |
| Ondrel | R, area | total over 3 pulses | 0, no damage or heal | 8 to 30 where an area carries damage or heal | roster-v2 §0 | n/a, carries neither |
| Ondrel | R | duration against cooldown | 180 ticks against 840 | below the cooldown | roster-v2 §0 | yes |
| Ondrel | F, per pulse | damage | 10 | 8 to 60 | spec 10 | yes |
| Ondrel | F | total over 5 pulses | 50 (10 times 5) | 8 to 60 | roster-v2 §0 | yes |
| Ondrel | F, each pulse | slow percent | 40 | 20 to 60 | rules 4.1 | yes |
| Ondrel | F, each pulse | slow ticks | 90 (1.5 s) | 60 to 180 | rules 4.1 | yes |
| Ondrel | F | duration against cooldown | 300 ticks against 600 | below the cooldown | roster-v2 §0 | yes |
| Ondrel | all lingering areas | stun, root or silence on a pulse | none | none on a pulsing area | roster-v2 §0 | yes |
| Ondrel | EX | EX variants | 2, on M2 and E | exactly 2, never F | spec 4.6, roster-v1 §0 | yes |
| Ondrel | EX | EX cost | 25 energy | 25 energy | spec 10 | yes |
| Ondrel | F | ultimate cost | 100 energy | 100 energy | spec 10 | yes |
| Ondrel | all | `energyGain` effects | none | none | roster-v2 §0 | yes |
| Brimwick | stats | `maxHealth` | 120 | 120 to 160, steps of 10 | spec 10, rules 5 | yes |
| Brimwick | stats | `moveSpeed` | 5.5 m/s | 5.5 m/s | spec 10 | yes |
| Brimwick | F | cooldown | 600 ticks (10 s) | 600 ticks | roster-v1 §0 | yes |
| Brimwick | M1 | projectile speed | 20 m/s | 12 to 25 m/s | spec 10 | yes |
| Brimwick | M1 | projectile radius | 0.3 m | 0.2 to 0.6 m | spec 10 | yes |
| Brimwick | M1 | damage | 10 | 8 to 30 | spec 10 | yes |
| Brimwick | M2 | damage | 12 | 8 to 30 | spec 10 | yes |
| Brimwick | M2 EX | damage | 20 | 8 to 30 | spec 10 | yes |
| Brimwick | M2 EX | slow percent | 30 | 20 to 60 | rules 4.1 | yes |
| Brimwick | M2 EX | slow ticks | 90 (1.5 s) | 60 to 180 | rules 4.1 | yes |
| Brimwick | Q | projectile speed | 24 m/s | 12 to 25 m/s | spec 10 | yes |
| Brimwick | Q | projectile radius | 0.35 m | 0.2 to 0.6 m | spec 10 | yes |
| Brimwick | Q | damage | 10 | 8 to 30 | spec 10 | yes |
| Brimwick | Q | stun ticks | 45 (0.75 s) | 30 to 120 | rules 4.1 | yes |
| Brimwick | E | projectile speed | 12 m/s | 12 to 25 m/s | spec 10 | yes |
| Brimwick | E | projectile radius | 0.6 m | 0.2 to 0.6 m | spec 10 | yes |
| Brimwick | E | damage | 26 | 8 to 30 | spec 10 | yes |
| Brimwick | E | knockback distance | 2 m | 1 to 4 m | rules 4.1 | yes |
| Brimwick | E | knockback ticks | 10 | 6 to 15 | rules 4.1 | yes |
| Brimwick | E EX | projectile speed | 12 m/s | 12 to 25 m/s | spec 10 | yes |
| Brimwick | E EX | projectile radius | 0.6 m | 0.2 to 0.6 m | spec 10 | yes |
| Brimwick | E EX | damage | 30 | 8 to 30 | spec 10 | yes |
| Brimwick | E EX | knockback distance | 3 m | 1 to 4 m | rules 4.1 | yes |
| Brimwick | E EX | knockback ticks | 10 | 6 to 15 | rules 4.1 | yes |
| Brimwick | R, area | slow percent | 40 | 20 to 60 | rules 4.1 | yes |
| Brimwick | R, area | slow ticks | 90 (1.5 s) | 60 to 180 | rules 4.1 | yes |
| Brimwick | R, on self | haste percent | 40 | 20 to 50 | rules 4.1 | yes |
| Brimwick | R, on self | haste ticks | 90 (1.5 s) | 60 to 240 | rules 4.1 | yes |
| Brimwick | F | projectile speed | 20 m/s | 12 to 25 m/s | spec 10 | yes |
| Brimwick | F | projectile radius | 0.5 m | 0.2 to 0.6 m | spec 10 | yes |
| Brimwick | F | damage | 55 | 8 to 60 | spec 10 | yes |
| Brimwick | F | stun ticks | 60 (1.0 s) | 30 to 120 | rules 4.1 | yes |
| Brimwick | all | lingering areas | none, every area is one hit | no total rows needed | roster-v2 §0 | yes |
| Brimwick | EX | EX variants | 2, on M2 and E | exactly 2, never F | spec 4.6, roster-v1 §0 | yes |
| Brimwick | EX | EX cost | 25 energy | 25 energy | spec 10 | yes |
| Brimwick | F | ultimate cost | 100 energy | 100 energy | spec 10 | yes |
| Brimwick | all | `energyGain` effects | none | none | roster-v2 §0 | yes |

The numbers with no range are tuning values per roster-v1 section 0: the
cooldowns, the windups, the reach and lifetime of a projectile, the radius of
an area, the distance of a dash or a teleport, and the duration and interval
of an area.

## 5. Every new 2v2 pairing works

Each pairing has a plan and a weakness, as in roster v1, and the six pairings
of roster v1 stand. These are the nine that include a new champion.

| Pairing | Why it works | Its weakness |
|---------|--------------|--------------|
| Ondrel and Hargrim | Hargrim holds the front with Iron Hide (40 absorb) and Rally Cry while Ondrel places the Mire (30 percent, up to 8 m away) on whoever pushes past him, and her Reed Fence and Reed Screen, centred on her own position, hold a diver at her. | Quillon kiting the pair from about 14 m, outside the 10.5 m of Ondrel's longest placement and the 9 m of the hook. |
| Ondrel and Quillon | The Mire (30 percent) and Bind Shot (40 percent) add to the 70 percent cap on a target that Quillon's bolts then pick off, and Ondrel's Reed Fence shoves a diver off Ondrel while Quillon stays at 9 to 13 m. | A dive past the zones: Lunge covers 6 m in 0.2 s, and neither has more than 130 health. |
| Ondrel and Lumeth | Aegis Veil (30 absorb, 5 m radius) covers Ondrel when she stands within 5 m of Lumeth, and Binding Sigil roots what the Mire slows on the same spot. | Brimwick's Flash Powder stun cancels the heal windups, and a Grand Finale of 55 goes 25 past an Aegis Veil. |
| Ondrel and Skerrow | The Mire and Undertow slow a target by 30 and 40 percent, Skerrow dives onto it, Quiet Dart silences it and Rend finishes. | No healing and at most 130 health each, so a long fight favours the other team. |
| Ondrel and Brimwick | The Mire (30 percent for 1.5 s) slows a target so that Starshell (12 m/s) can hit it, and while Brimwick stands beside Ondrel, Reed Fence (2.5 m) and Reed Screen (3.0 m) around Ondrel's position cover her long windups. | Both have locked windups (Drowned Ground 0.7 s, Starshell 0.7 s, Grand Finale 1.0 s), so one stun from a diver ends a cast. |
| Brimwick and Hargrim | Chain Hook pulls a target 4 m toward Hargrim and slows it, which gives Starshell (12 m/s) a target it can hit, and Iron Hide soaks while she lights Starshell. | Quillon kiting from beyond 11 m, past Spark and Firecracker and the 9 m hook. |
| Brimwick and Quillon | Bind Shot slows and Snare Orb roots a target in place for Starshell, and Lance follows. | A dive past both: three locked windups (Lance 0.6 s, Starshell 0.7 s, Sunspear 0.8 s) and 120 health each. |
| Brimwick and Lumeth | Binding Sigil's 1.5 s root holds a target for Starshell's 0.7 s windup, and Aegis Veil shields Brimwick while she casts. | Skerrow's Quiet Dart silences either of them, and both die to a dive on 120 health. |
| Brimwick and Skerrow | Flash Powder's 0.75 s stun holds a target for Lunge, Rend and Twin Cut, and Quiet Dart silences what could answer. | Both are fragile and neither has a shield, so focus fire ends the round. |

## 6. Balance notes

Status: on paper. Nothing in this document is measured. Every number of
sections 2 and 3 is a first value inside its range, and the web of section 1 is
design intent. Batch 13 measures it with the six-champion report, by the method
of [balance](balance.md): bot against bot at the normal tier over 100 seeds on
both arenas. Any number that moves after that moves in this document, in the
kit file and in the scripted fixture in the same change (roster-v1, section 0).

Two limits of the bots will bias that first report. They are forecasts, with
no numbers, and they are the reason not to move a number before the report is
in.

- The bots never avoid an area. They steer around no area, and bots.md lists
  local steering as not built. The Mire, Reed Fence, Reed Screen
  and Drowned Ground land every pulse on a bot, where a player walks out of
  them. Ondrel will probably measure strong, and some of it will be the bots.
- A placed area reads the aim on the tick it fires and follows its target
  through the windup, so a player who tracks his target hits a moving one
  with the Firecracker (12 every 5 s, 10 energy a hit, the most reliable
  damage she has, and the first number to look at if she measures high).
  Bots lead an area-only cast as if it flew at the nominal 20 m/s, which puts
  the aim about 2.5 m ahead of a strafing target at 9 m, past its 2.0 m
  reach, so how often it lands on a bot is not clear from the paper, and a
  change of that lead in batch 13 would move it. Her Starshell and Grand
  Finale are projectiles, and the dodge of #137 acts on projectiles. Brimwick
  may measure differently before the dodge exists and after it, and Ondrel's
  pulses are areas, so the dodge is not expected to move her.

A third limit points the other way. The bots press each slot on its own band
and never combine them on purpose: no Undertow into a placed Mire, no Reed
Step patch left behind on a retreat. If Ondrel measures weak, that is a limit
of the bots as well.
