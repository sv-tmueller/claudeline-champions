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
