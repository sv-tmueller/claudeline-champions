# Roster v2: champions five and six

Status: on paper; no kit, model or bot profile yet (batches 12 and 13)
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
  `packages/sim/test/roster-kits.test.ts`) will run on both kits, so these
  are not tuning values: move speed 5.5 m/s, F cooldown 600 ticks, max health
  120 to 160 in steps of 10, and every `damage` 8 to 30 and up to 60 on F.
  The damage range holds for every effect, so every area pulse counts on its
  own. Statuses follow rules 4.1: ticks and percents inside the catalog, a
  shield of 20 to 60 absorb for 180 to 360 ticks, a knockback of 1 to 4 m
  over 6 to 15 ticks, a projectile speed of 12 to 25 m/s and a projectile
  radius of 0.2 to 0.6 m. No kit lists `energyGain`.
- Lingering areas. Three rules, which are roster choices like the heal range
  of roster-v1 section 0:
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
  ticks is 10 m, 16 m/s for 30 ticks is 8 m, 20 m/s for 33 ticks is 11 m, 18
  m/s for 30 ticks is 9 m, 12 m/s for 50 ticks is 10 m and 20 m/s for 36
  ticks is 12 m. Neither kit has an arc, and any arc written later is a
  `cosHalfAngle` of cos(A/2) as a 10-decimal literal. Batch 12 then converts
  every number without moving it.
- Table rows become data as in roster-v1 section 0, with these additions. "N
  pulses of I s over D s" is an `area` with `durationTicks` D times 60 and
  `intervalTicks` I times 60, which gives N = D / I pulses here. "Placed at
  the aim up to N m" is the `aim` placement with `range` N. "Pull toward
  caster" is a `knockback` with the direction `toward`, and "outward" is
  `away`. A circle that does two things is two `area` effects on the same
  circle, listed in the order the table names them. Effects listed after a
  `dash` act at the start point, because the dash only starts to move the
  caster.
- **Kit data (not built).** `data/kits/ondrel.json` and
  `data/kits/brimwick.json`, one file per champion named after its id, built
  by batch 12 under roster-v1 section 0. Until then this document alone holds
  the numbers. From then on a number changes in the file, here and in the
  scripted fixture in the same change.
- **Models (not built).** `assets/models/champions/ondrel.glb` and
  `assets/models/champions/brimwick.glb`, built by `tools/blender` as
  roster-v1 section 0 describes: the shared body in the champion's body
  colour, one cue, the shared rig and the six clips. The two body colours are
  reserved by decision 2 of batch #134. A scratch run of the colour functions
  of `tools/blender/test_champion_models.py` at commit `ae41fed` checked
  both, and its figures are in the model subsections. The pull request
  changes no file that run reads. Whichever of this change and the second
  arena floor material (#139) merges second runs the check again against the
  other's colours.
- The names were checked by hand against the Bloodline Champions and
  Battlerite rosters. They are original (ADR-005).

## 1. The gaps the four leave

Roster v1 has one champion per archetype: melee bruiser, ranged skillshot,
healer and support, mobile assassin. Three gaps stay, and neither champion
below needs a new primitive to fill them.

- **No lingering area.** Every area in the four kit files is one hit
  (`durationTicks` 1). The toolkit has lingering areas and no kit uses one.
  The zone controller is the champion built on them.
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
- **No burst through the heals.** The largest hit that is not an ultimate in
  roster v1 is Quillon's Lance at 28, and Lumeth's Aegis Veil absorbs 30. A
  burst caster is the champion whose one hit goes past that.

The counter web below is design intent, five lines per new champion. Each
existing champion gets one win and one loss against the pair, so the web stays
closed, and the six counters of roster v1 stand unchanged.

| | Hargrim | Quillon | Lumeth | Skerrow | The other new champion |
|---|---|---|---|---|---|
| Ondrel | beats | loses | loses | beats | beats Brimwick |
| Brimwick | loses | beats | beats | loses | loses to Ondrel |

Over six champions the records are Hargrim 3 wins and 2 losses, Quillon 2 and
3, Lumeth 2 and 3, Skerrow 3 and 2, Ondrel 3 and 2, Brimwick 2 and 3.

The measured state of roster v1 is the reason to read the web with care. In
the report of [balance](balance.md) (sections 4 and 5), over the cells each
champion is in, Hargrim wins 16.4 percent, Lumeth 79.1, Quillon 85.3 and
Skerrow 19.2, and three of the six v1 counters measure inverted in every
cell. The bots, which do not dodge and never press some abilities, decide
much of that, so this document states the web as intent and adds no measured
number.

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
| Q | Reed Fence: `area` (circle, radius 2.5 m around caster, one hit), then `area` (the same circle, 4 pulses of 0.5 s over 2.0 s), `knockback` (1 m outward in 6 ticks on each pulse) | 10 damage, once | 2.5 m radius | n/a | 12 s | 0.3 s, slowed | none |
| E | Undertow: `projectile`, `knockback` (pull toward caster, up to 3 m in 15 ticks, stops at contact), `applyStatus` | 10 damage | 8 m | 16 m/s / 0.5 m | 8 s | 0.4 s, slowed | slow 40 percent for 1.5 s |
| R | Reed Screen: `shield` on self, `area` (circle, radius 3.0 m around caster, 3 pulses of 1.0 s over 3.0 s), `applyStatus` | 30 absorb for 4 s | 3 m radius | n/a | 14 s | 0, free | slow 30 percent for 1.0 s on enemies in the area, on each pulse |
| F | Drowned Ground (ultimate): `area` (circle, radius 4.0 m, placed at the aim up to 8 m, 5 pulses of 1.0 s over 5.0 s), `applyStatus` | 10 damage per pulse, 50 in total | 8 m to centre | n/a | 10 s | 0.7 s, locked | slow 40 percent for 1.5 s on each pulse |

Reading the rows. Every lingering area targets enemies. The pulses of an area
are on its ticks 0, 1.0 s, 2.0 s and so on, so the first pulse lands when the
area is placed. The slow of a pulse is refreshed by the next one, so a target
that stays in the Mire stays slowed, and one that leaves it is still slowed for
1.5 s. Reed Step's patch is where she starts the dash, not where she ends.
Reed Fence is a one-hit area for the damage, which gives the energy, and a
lingering area for the push, which gives none. Slows from different slots add
and stop at 70 percent in total (rules 4.1). No pulse carries stun, root or
silence. Each lingering duration (3.0, 2.0, 2.0, 3.0 and 5.0 s) is shorter
than the cooldown of its slot.

**EX variants** (Shift plus slot, 25 energy).

| Slot | What changes against the base ability |
|------|----------------------------------------|
| M2 | Mire EX: radius 2.0 m becomes 2.5 m, damage per pulse 8 becomes 10 (30 in total), slow becomes 40 percent for 2.0 s. |
| E | Undertow EX: damage 10 becomes 14, pull 3 m becomes 4 m, slow becomes 60 percent for 2.0 s. |

**Intended counters.**

- Beats Hargrim. He must cross 5 to 9 m of her ground. Mire (30 percent) and
  Reed Screen's field (30 percent) add to 60 percent, which cuts his 5.5 m/s
  to 2.2 m/s, and Reed Fence pushes him back 1 m a pulse inside 3.0 m. Rush is
  one 5 m hop every 7 s, and Chain Hook is one 14 damage pull every 9 s.
- Beats Skerrow. Reed Screen has no windup, so its 30 absorb is up before
  Lunge lands. Its 3.0 m field slows her 30 percent, and Reed Fence pushes her
  1 m out of the 2.0 m of Twin Cut and the 2.5 m of Rend.
- Beats Brimwick. A caster in a locked windup stands in the mire: Starshell
  (0.7 s) and Grand Finale (1.0 s) cannot walk, so Mire lands its 24 in total
  and Undertow drags her 3 m closer, and Ondrel has 130 health to her 120.
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
| `rangeMin` | 5 | The roster's 5 m. A `KIT_RULES` row for `ondrel` with 5, so she kites a target closer than 5 m (batch 13). |
| `rangeMax` | 9 | Comes from the M1 band: Clod Toss reaches 10 m, minus `RANGE_MARGIN` 1 m, through the `KIT_RULES` row. It equals the roster's 9 m. |
| `openers` | E (Undertow), `band` null (the kit band less the margin, 7 m), `motion` `'away'`, `when` null | A target that walks away is dragged back into her ground. M2 has no rule and is pressed on its band. |
| `escapes` | SPACE (Reed Step), then R (Reed Screen) | Dash away from the target and leave the patch, then shield. |
| `holdF` | false | Drowned Ground is pressed on its band with 100 energy. |
| `wait` | null | She has no opener to wait for. |
| `escapeWithin` | null | The common trigger: a retreat with the target inside 6 m, or a kite inside `rangeMin`. |
| `allies` | empty | No slot of hers acts on an ally. |
| Finisher (intent, not a profile field) | M2 (EX Mire with 25 energy, 30 in total) on a target at 30 health or less, or E on a fleeing one | The pattern of roster v1. The bots build no per-slot finisher. |

The bands (kit band less the margin) are M1 9 m, M2 9.5 m, E 7 m, R 2.5 m,
Q 2.0 m and F 11.5 m. An area press needs a clear shot of 0.5 m, so bots will
not use "behind cover". Reed Step has a band of 1.0 m from its own area, so the
usual walk presses it only at a target that touches her, and the escape rule
presses it otherwise. Every slot is pressed, so no slot is never pressed.

**Model.** Cue: a reed bundle strapped to her back, one thin box of about
0.10 m by 0.16 m by 0.80 m, built in the body material and carried by the
`Spine` bone like Hargrim's shoulder blocks. It sits against the back of the
torso (x from -0.25 m to -0.15 m, 1.00 m to 1.80 m high), so the estimated top
is 1.80 m, at most 1.90 m, and the footprint stays inside 0.5 m. It is behind
the torso and clear of the visor (x from 0.11 m) and the chest plate (x from
0.14 m), so neither is hidden from the 55 degree camera. Body colour: moss
green, linear (0.03, 0.30, 0.03), about `#309530`. In 8-bit sRGB b minus g is
-101, so the overlay rule holds (`overlay None`). The nearest colours from
the scratch run at `ae41fed` are the dead grey `#5a6070` at 93.1, Skerrow at
101.0 and Quillon at 101.1, so the minimum distance is 93.1, above the 80 the
test asks for.

## 3. Brimwick, the burst caster

**Fantasy.** Brimwick is a festival pyrotechnist, and every cast of hers is a
lit fuse. She plants a firecracker, lights the long fuse and waits for the
bang, and the big ones come late and hit hard. She is a glass cannon: if the
fuse is cut short, a stun in the middle of a windup, she has nothing left.

**Role and range.** Burst caster. Intended range is 7 to 10 m, and her
longest shot reaches 12 m. Her damage comes in three beats: a Firecracker of
16, a Starshell of 26 and a Grand Finale of 55.

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
| M2 | Firecracker: `area` (circle, radius 1.5 m, placed at the aim up to 9 m, one hit) | 16 damage | 9 m to centre | n/a | 5 s | 0.4 s, slowed | none |
| SPACE | Flare Step: `teleport` (up to 6 m toward the aim point, not fixed) | none | 6 m | n/a | 10 s | 0, free | none |
| Q | Flash Powder: `projectile`, `applyStatus` | 8 damage | 9 m | 18 m/s / 0.35 m | 12 s | 0.3 s, slowed | stun 0.75 s |
| E | Starshell: `projectile`, `knockback` (2 m outward in 10 ticks) | 26 damage | 10 m | 12 m/s / 0.6 m | 9 s | 0.7 s, locked | none |
| R | Smoke Pot: `area` (circle, radius 3.5 m around caster, one hit), `applyStatus` | none | 3.5 m radius | n/a | 14 s | 0, free | slow 40 percent for 1.5 s on enemies in the area, haste 30 percent for 1.5 s on self |
| F | Grand Finale (ultimate): `projectile`, `applyStatus` | 55 damage | 12 m | 20 m/s / 0.5 m | 10 s | 1.0 s, locked | stun 1.0 s |

Reading the rows. She has no lingering area, so every area of hers is one hit.
Her biggest hits are projectiles on purpose: a placed area reads the aim on
the tick it fires and follows its target through the windup, so the Firecracker
keeps a radius of 1.5 m and is the smallest of her three hits, while Starshell
(12 m/s, the slowest a projectile may be) and Grand Finale can be walked out
of. Starshell's knockback pushes along the shell's path from the contact point.
The stun of Flash Powder is 0.75 s (45 ticks) and that of Grand Finale 1.0 s,
and both interrupt a windup (rules 2.4). Smoke Pot gives no energy, since it
has no damage.

**EX variants** (Shift plus slot, 25 energy).

| Slot | What changes against the base ability |
|------|----------------------------------------|
| M2 | Firecracker EX: radius 1.5 m becomes 2.0 m, damage 16 becomes 24, and the area also applies slow 30 percent for 1.5 s. |
| E | Starshell EX: windup 0.7 s becomes 0.4 s, damage 26 becomes 30, and knockback 2 m becomes 3 m. |

**Intended counters.**

- Beats Quillon. Firecracker (16 damage, placed up to 9 m, and areas ignore
  cover) has a 0.4 s windup, which fits inside Lance's 0.6 s locked windup and
  inside Sunspear's 0.8 s, and Flash Powder's 0.75 s stun cancels either one
  (rules 2.4).
- Beats Lumeth. Flash Powder's 0.75 s stun cancels Dawnbloom (0.6 s windup) or
  Binding Sigil (0.5 s) with no refund of energy or cooldown, and Grand
  Finale's 55 goes 25 past the 30 absorb of Aegis Veil.
- Loses to Hargrim. Iron Hide's 40 absorb soaks Starshell's 26, he has 160
  health to her 120, and Chain Hook (14 damage, 9 m) pulls her 4 m into Maul
  Swing and Ground Slam. Smoke Pot's 40 percent slow, once every 14 s, is her
  one answer.
- Loses to Skerrow. Quiet Dart silences Flare Step and every other cast for
  1.5 s from 11 m, and Lunge closes 6 m inside the 0.7 s locked windup of
  Starshell. Rend does 14 plus 16 over time against 120 health.
- Loses to Ondrel. A caster in a locked windup stands in the mire: Starshell
  (0.7 s) and Grand Finale (1.0 s) cannot walk, so Mire's pulses of 8 land
  and its 30 percent slow holds, Undertow drags her 3 m closer, and Ondrel
  has 130 health to her 120.

**Bot profile sketch.**

| Field | Value | From the roster |
|-------|-------|-----------------|
| `rangeMin` | 7 | The roster's 7 m. A `KIT_RULES` row for `brimwick` with 7, so she kites a target closer than 7 m (batch 13). |
| `rangeMax` | 10 | Comes from the M1 band: Spark reaches 11 m, minus `RANGE_MARGIN` 1 m, through the `KIT_RULES` row. It equals the roster's 10 m. |
| `openers` | Q (Flash Powder), `band` null (the kit band less the margin, 8 m), `motion` `'closing'`, `when` null | Stun the target that walks in on her. The rest of her slots have no rule and are pressed on their bands. |
| `escapes` | SPACE (Flare Step), then R (Smoke Pot) | Teleport away from the target (up to 6 m, `min(range, aim distance)` as it is not fixed), then slow and haste. |
| `holdF` | true | Grand Finale is held for a target at 55 health or less, the damage of F, or one that is cornered. |
| `wait` | null | She has no opener to wait for. |
| `escapeWithin` | null | The common trigger: a retreat with the target inside 6 m, or a kite inside `rangeMin`. |
| `allies` | empty | No slot of hers acts on an ally. |
| Finisher (intent, not a profile field) | F (Grand Finale) on a target at 55 health or less, E (EX Starshell with 25 energy, 30 damage) on one at 30 or less | The pattern of roster v1. The bots build no per-slot finisher. |

The bands (kit band less the margin) are M1 10 m, M2 10 m, Q 8 m, E 9 m, R
3 m and F 11 m, and the band top of Firecracker EX (11.5 m) stays below F's
(12 m), as the EX bands of Hargrim and Quillon do. An area
press needs a clear shot of 0.5 m, so bots will not use "behind cover". Flare
Step has no band, since a teleport reaches nobody, so only the escape rule
presses it. Every slot is pressed, so no slot is never pressed.

**Model.** Cue: a fuse cap, a box of about 0.22 m by 0.22 m by 0.16 m on top
of the head, built in the body material and carried by the `Spine` bone like
Lumeth's halo. It spans 1.66 m to 1.82 m, so the estimated top is 1.82 m, at
most 1.90 m, and the footprint stays inside 0.5 m. It sits from x -0.13 m to
0.09 m, above the visor (which ends at 1.61 m and starts at x 0.11 m) and
well above the chest plate, so neither is hidden from the 55 degree camera.
Body colour: burnt orange, linear (0.72, 0.19, 0.00), about `#dd7900`. In
8-bit sRGB b minus g is -121, so the overlay rule holds (`overlay None`). The nearest colours from the scratch run at `ae41fed` are
the enemy health bar `#ff4d4f` at 96.6, Hargrim at 99.4 and the enemy
projectile `#ff8a5c` at 99.5, so the minimum distance is 96.6, above the 80
the test asks for. It is 181.7 from Ondrel's body.
