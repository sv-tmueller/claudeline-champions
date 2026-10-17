# Roster v1: four champions

Status: v1 roster. All four kits are implemented as data in `data/kits/`.
Source of truth for numbers: [design spec](../superpowers/specs/2026-10-01-claudeline-champions-design.md), sections 4.5, 4.6, 6 and 10

This document defines the four champions of roster v1, one per archetype: melee bruiser, ranged skillshot, healer and support, mobile assassin. The sim, the client and the bots implement these kits. Arena layouts and match rules are covered elsewhere.

## 0. How to read the numbers

- Values from the spec are copied, not changed here: base move speed 5.5 m/s, champion radius 0.5 m, max health 120 (ranged, support) to 160 (melee), damage 8 to 30 per hit (ultimates up to 60), projectile speed 12 to 25 m/s, projectile radius 0.2 to 0.6 m, EX cost 25 energy, ultimate cost 100 energy.
- The spec gives the 8 to 30 range (ultimates up to 60) for damage only. Using the same range for heals is a roster choice.
- Everything else (cooldowns, windups, ranges, status strengths and durations) is a tuning value chosen inside those ranges. These values may move in balance passes.
- Status durations and strengths follow the status catalog and stacking rules of the rules document (`docs/design/rules.md`). Stun is 0.5 to 2.0 s, root 1.0 to 2.5 s, silence 1.0 to 3.0 s, slow 20 to 60 percent for 1.0 to 3.0 s, haste 20 to 50 percent for 1.0 to 4.0 s, shield 20 to 60 absorb for 3 to 6 s, damage over time 1.0 to 4.0 s, heal over time 2.0 to 5.0 s, knockback 1 to 4 m over 6 to 15 ticks, invulnerable 0.5 to 2.0 s. Damage over time and heal over time tick every 0.5 s, and the total of one application stays inside 8 to 30.
- Energy gains use the rules document values. An M1 hit gives 5. A skill or EX hit gives 10. An ultimate hit gives 15 per enemy hit. Healing an ally gives 5 (M1), 10 (skill or EX) or 15 per ally healed (ultimate). Only support kits earn energy from healing. A shield or a status alone gives nothing. The sim applies this table on its own, so the kit tables do not list `energyGain` for standard hits. A kit lists `energyGain` only where it grants extra energy on top of the table. No v1 kit does.
- Every ability is built only from the toolkit primitives `projectile`, `dash`, `meleeArc`, `area`, `applyStatus`, `heal`, `shield`, `teleport`, `knockback` and `energyGain`. No kit has a passive. Any speed change comes from a haste or slow status.
- Windup rules are `free` (move at normal speed), `slowed` (move at 50 percent of current speed) or `locked` (no walking). A windup of 0 is instant. The effects fire when the windup ends.
- An EX variant costs 25 energy, uses the same cooldown as its base ability and lists only what changes. Each kit has exactly two EX variants. The ultimate costs 100 energy and has no EX variant.
- The ultimate cooldown is 10 s for every champion. Energy is the real limit.
- All four champions have move speed 5.5 m/s and collision radius 0.5 m. No kit changes base speed.
- **Kit data.** All four champions are implemented as `data/kits/hargrim.json`, `data/kits/quillon.json`, `data/kits/skerrow.json` and `data/kits/lumeth.json`: one file per champion, named after its id, holding exactly the `KitDef` fields. Display names stay in this document and in the client. A table row becomes data by these rules. Ticks are seconds times 60. "One hit" means `durationTicks` 1 and `intervalTicks` 1, and an `area` row that gives no duration is one hit. "Around caster" is the placement `self`, and "N m ahead" is `ahead` N. "On self" is a top-level `applyStatus` or `shield`, and "on allies" is `targets` `allies`, which includes the caster. An `area` has one `targets` filter, so a circle that treats allies and enemies differently is two `area` effects on the same circle, listed in the order the table names them (Dawnbloom: the allies first, then the enemies). "At the dash end" is the `then` list of the dash. A hit lists `damage` first, then the statuses and pushes in the order the table names them. A projectile's `lifetimeTicks` is its range times 60 divided by its speed, rounded to a whole tick, a tie half up as `Math.round`, and its reach is its speed times its lifetime divided by 60, so Quillon's M1, M2 and Lance reach 13.93, 11.9 and 17.92 m, where 14, 12 and 18 m would need 38.18, 51.43 and 43.2 ticks, while Skerrow's Throwing Knife and Quiet Dart reach exactly 10 and 11 m in 25 and 33 ticks. Lumeth's Soothing Surge is the one tie: 10 m at 16 m/s is 37.5 ticks, which becomes 38 ticks and a reach of 10.13 m. An arc of A degrees is a `cosHalfAngle` of cos(A/2), written as a 10-decimal literal: 0.6427876097 for Hargrim's 100 degrees and 0.7071067812 for Skerrow's 90 degrees, and -1 for a full circle. Every top-level effect reads the caster's position again, so an arc listed after a `teleport` swings where the teleport lands. An EX variant in the data is a complete ability, while the tables list only what differs from the base ability, and a test checks that nothing else differs. An area or an arc reaches a champion whose centre is within its radius plus 0.5 m. Changing a number means changing `data/kits/<id>.json`, this document and that kit's scripted fixture (`scripted-roster-<id>-arena01-2v2.json`) in the same change.
- **Models.** Each champion has `assets/models/champions/<id>.glb`, built by
  `tools/blender`: the shared body in the champion's body colour, one cue
  (shoulder blocks, staff, halo, blade), the shared six-bone rig and the six
  clips `Idle`, `Run`, `Attack`, `Cast`, `Hit` and `Death`, each keying only the
  channels it moves. The client plays no clip yet. The bones, clips and
  channels are in [assets](../architecture/assets.md).
- The names were checked by hand against the Bloodline Champions and Battlerite rosters. They are original.

## 1. Hargrim, the melee bruiser

**Fantasy.** Hargrim is a retired quarry foreman who fights with a stone-cutter's maul. He walks into the fight, drags people to him and breaks the ground under their feet. He cannot chase a fast target, so he makes sure the target has nowhere to go.

**Role and range.** Frontline bruiser. Intended range is 0 to 3 m, with a hook that reaches 9 m.

**Stats.**

| Stat | Value |
|------|-------|
| Max health | 160 |
| Move speed | 5.5 m/s, no kit modifier |
| Collision radius | 0.5 m |

**Abilities.**

| Slot | Ability and effects | Amount | Range | Speed / radius | Cooldown | Windup | Statuses applied |
|------|---------------------|--------|-------|----------------|----------|--------|------------------|
| M1 | Maul Swing: `meleeArc` (100 degree arc, `cosHalfAngle` 0.6427876097) | 12 damage | 2.5 m | n/a | 0.6 s | 0.15 s, slowed | none |
| M2 | Ground Slam: `area` (circle, radius 2.0 m, centred 2.5 m ahead, one hit), `applyStatus` | 18 damage | 2.5 m to centre | n/a | 6 s | 0.4 s, slowed | slow 30 percent for 1.5 s |
| SPACE | Rush: `dash` (5 m in 0.25 s), `applyStatus` | none | 5 m | n/a | 7 s | 0, free | haste 20 percent for 1.5 s on self |
| Q | Rally Cry: `area` (circle, radius 4 m around caster, one hit), `applyStatus` | none | 4 m radius | n/a | 14 s | 0.2 s, slowed | haste 30 percent for 2.0 s on allies in the area, including self |
| E | Chain Hook: `projectile`, `knockback` (pull toward caster, up to 4 m in 12 ticks, stops at contact), `applyStatus` | 14 damage | 9 m | 20 m/s / 0.4 m | 9 s | 0.3 s, locked | slow 30 percent for 1.0 s |
| R | Iron Hide: `shield` on self, `applyStatus` | 40 absorb for 4 s | self | n/a | 12 s | 0, free | haste 20 percent for 1.5 s on self |
| F | Quarry Break (ultimate): `dash` (6 m in 0.3 s), `area` (circle, radius 3.5 m, at the dash end), `applyStatus`, `knockback` (3 m outward in 10 ticks) | 40 damage | 6 m dash, 3.5 m radius | n/a | 10 s | 0.5 s, locked | stun 1.0 s |

**EX variants** (Shift plus slot, 25 energy).

| Slot | What changes against the base ability |
|------|----------------------------------------|
| M2 | Ground Slam EX: radius 2.0 m becomes 2.75 m, damage 18 becomes 26, slow becomes 50 percent for 2.0 s. |
| SPACE | Rush EX: dash distance 5 m becomes 7 m. At the dash end an extra `area` (circle, radius 1.5 m) deals 12 damage and applies stun 0.5 s. Haste on self becomes 30 percent for 2.0 s. |

**Intended counters.**

- Beats Skerrow. Iron Hide absorbs the opening Rend, the slow from Ground Slam stops a dash-away, and 160 health outlasts her 130. Her Vanish Step is one 0.5 s window every 16 s.
- Beats Lumeth. Chain Hook pulls Lumeth 4 m closer and slows her, and she has only a short Glide (4 m) to answer it. Her heals cannot keep up with a bruiser she cannot escape.
- Loses to Quillon. Quillon outranges every Hargrim tool, the hook included. Bind Shot and Snare Orb keep Hargrim slow or rooted while bolts land from about 14 m.

**Bot profile sketch.**

| Field | Value |
|-------|-------|
| Preferred range | 0 to 3 m, closes distance |
| Opener | SPACE (Rush) from 4 to 5 m, or E (Chain Hook) from 4 to 7 m when the target is running |
| Escape | R (Iron Hide), then walk away under haste |
| Finisher | M2 (Ground Slam), or E on a fleeing target at low health |

## 2. Quillon, the ranged skillshot

**Fantasy.** Quillon is a surveyor from a drowned city who turned her measuring rods into long-range bolts. She reads the arena like a map. Every shot is placed where the target will be, not where it stands.

**Role and range.** Backline damage dealer. Intended range is 9 to 13 m, and her longest shot reaches 20 m.

**Stats.**

| Stat | Value |
|------|-------|
| Max health | 120 |
| Move speed | 5.5 m/s, no kit modifier |
| Collision radius | 0.5 m |

**Abilities.**

| Slot | Ability and effects | Amount | Range | Speed / radius | Cooldown | Windup | Statuses applied |
|------|---------------------|--------|-------|----------------|----------|--------|------------------|
| M1 | Rod Bolt: `projectile` | 11 damage | 13.93 m | 22 m/s / 0.25 m | 0.5 s | 0.1 s, free | none |
| M2 | Bind Shot: `projectile`, `applyStatus` | 14 damage | 11.9 m | 14 m/s / 0.4 m | 6 s | 0.3 s, slowed | slow 40 percent for 1.5 s |
| SPACE | Skip: `teleport` (exactly 4 m toward the aim point, fixed) | none | 4 m | n/a | 9 s | 0, free | none |
| Q | Snare Orb: `projectile`, `applyStatus` | 8 damage | 10 m | 12 m/s / 0.6 m | 12 s | 0.4 s, locked | root 1.0 s |
| E | Lance: `projectile` | 28 damage | 17.92 m | 25 m/s / 0.2 m | 8 s | 0.6 s, locked | none |
| R | Hush Ward: `shield` on self, `applyStatus` | 30 absorb for 3 s | self | n/a | 14 s | 0, free | haste 30 percent for 1.5 s on self |
| F | Sunspear (ultimate): `projectile` (pierces every champion in its path), `applyStatus` | 45 damage | 20 m | 25 m/s / 0.6 m | 10 s | 0.8 s, locked | slow 40 percent for 2.0 s |

**EX variants** (Shift plus slot, 25 energy).

| Slot | What changes against the base ability |
|------|----------------------------------------|
| M2 | Bind Shot EX: radius 0.4 m becomes 0.6 m, damage 14 becomes 20, slow becomes 60 percent for 2.0 s. |
| E | Lance EX: windup 0.6 s becomes 0.3 s, damage 28 becomes 30, and the bolt pierces every champion in its path. |

**Intended counters.**

- Beats Hargrim. She holds him at range with Bind Shot and Snare Orb, and Skip answers his single hook. Every second he spends slowed is a free Rod Bolt.
- Loses to Skerrow. Skerrow closes 6 m with Lunge, and her Quiet Dart silences Skip. Quillon has 120 health and a locked windup on her heavy hits.
- Loses to Lumeth. Lumeth's Aegis Veil (30 absorb) soaks a full Lance (28), her heals outlast Rod Bolt pressure, and Binding Sigil roots Quillon where Skip lands.

**Bot profile sketch.**

| Field | Value |
|-------|-------|
| Preferred range | 9 to 13 m, backs away when an enemy is inside 6 m |
| Opener | Q (Snare Orb) on a target that walks toward her, otherwise M2 |
| Escape | SPACE (Skip) away from the nearest enemy, then R (Hush Ward) |
| Finisher | E (Lance, or EX Lance with 25 energy) on a target at 30 health or less |

## 3. Lumeth, the healer and support

**Fantasy.** Lumeth is a lamp-keeper from a mountain monastery who carries a lantern that heals what it lights and burns what it hates. She keeps allies standing and keeps enemies away from them. She is weak alone and strong beside a partner.

**Role and range.** Healer and support. Intended range is 6 to 10 m, staying within 8 m of an ally.

**Stats.**

| Stat | Value |
|------|-------|
| Max health | 120 |
| Move speed | 5.5 m/s, no kit modifier |
| Collision radius | 0.5 m |

**Abilities.**

| Slot | Ability and effects | Amount | Range | Speed / radius | Cooldown | Windup | Statuses applied |
|------|---------------------|--------|-------|----------------|----------|--------|------------------|
| M1 | Mend Bolt: `projectile`, `heal` on an ally hit, damage on an enemy hit | 10 heal or 10 damage | 12 m | 20 m/s / 0.35 m | 0.6 s | 0.1 s, free | none |
| M2 | Soothing Surge: `projectile` (hits allies only, passes through enemies), `heal`, `applyStatus` | 14 heal, plus 12 heal over time in total | 10.13 m | 16 m/s / 0.5 m | 5 s | 0.3 s, slowed | heal over time for 3.0 s (2 per tick) |
| SPACE | Glide: `dash` (4 m in 0.2 s), `applyStatus` | none | 4 m | n/a | 8 s | 0, free | haste 30 percent for 1.0 s on self |
| Q | Binding Sigil: `area` (circle, radius 1.5 m, placed up to 9 m away, one hit), `applyStatus` | 8 damage | 9 m | n/a | 13 s | 0.5 s, slowed | root 1.5 s |
| E | Lantern Burst: `area` (circle, radius 3 m around caster, one hit), `knockback` (2 m outward in 8 ticks) | 12 damage | 3 m radius | n/a | 9 s | 0.2 s, slowed | none |
| R | Aegis Veil: `area` (circle, radius 5 m around caster, one hit), `shield` on allies in the area, including self | 30 absorb for 4 s | 5 m radius | n/a | 12 s | 0, free | none |
| F | Dawnbloom (ultimate): `area` (circle, radius 5 m around caster, one hit), `heal` on allies, `applyStatus` | 30 heal, plus 30 heal over time in total | 5 m radius | n/a | 10 s | 0.6 s, slowed | heal over time for 3.0 s (5 per tick) on allies, slow 30 percent for 2.0 s on enemies |

**EX variants** (Shift plus slot, 25 energy).

| Slot | What changes against the base ability |
|------|----------------------------------------|
| M2 | Soothing Surge EX: heal 14 becomes 22, and heal over time becomes 24 in total over 4.0 s (3 per tick). |
| R | Aegis Veil EX: shield 30 becomes 45 for 5 s, and the area also applies haste 20 percent for 2.0 s to allies in it. |

**Intended counters.**

- Beats Quillon. Aegis Veil absorbs a full Lance, Soothing Surge outheals Rod Bolt, and Binding Sigil roots her where Skip lands. Lumeth's M1 reaches 12 m, close to Quillon's M1 range of about 14 m.
- Loses to Hargrim. Chain Hook pulls her 4 m closer and slows her, so Ground Slam lands next. Lantern Burst pushes him 2 m, and he walks it back in under half a second.
- Loses to Skerrow. Quiet Dart silences every Lumeth ability, shield included, and 120 health dies to Lunge, Rend and Twin Cut inside four seconds.

**Bot profile sketch.**

| Field | Value |
|-------|-------|
| Preferred range | 6 to 10 m from enemies, within 8 m of the nearest ally |
| Opener | Q (Binding Sigil) on an enemy near an ally, otherwise M1 on the lowest-health ally |
| Escape | E (Lantern Burst) when an enemy is inside 3 m, then SPACE (Glide) |
| Finisher | M1 (Mend Bolt) on an enemy at 10 health or less, with Q to hold the target |

## 4. Skerrow, the mobile assassin

**Fantasy.** Skerrow is a rooftop courier who learned that a short blade and a long jump pay better than any cargo. She appears behind the weakest target, takes a bite and is gone before the room reacts.

**Role and range.** Dive assassin. Intended range is 0 to 2.5 m for the kill, closing from 6 to 8 m.

**Stats.**

| Stat | Value |
|------|-------|
| Max health | 130 |
| Move speed | 5.5 m/s, no kit modifier |
| Collision radius | 0.5 m |

Max health 130 sits inside the spec range of 120 to 160. It is a mixed-role value, in steps of 10.

**Abilities.**

| Slot | Ability and effects | Amount | Range | Speed / radius | Cooldown | Windup | Statuses applied |
|------|---------------------|--------|-------|----------------|----------|--------|------------------|
| M1 | Twin Cut: `meleeArc` (90 degree arc, `cosHalfAngle` 0.7071067812) | 9 damage | 2.0 m | n/a | 0.4 s | 0.1 s, free | none |
| M2 | Throwing Knife: `projectile`, `applyStatus` | 12 damage | 10 m | 24 m/s / 0.2 m | 3 s | 0.1 s, free | slow 20 percent for 1.0 s |
| SPACE | Lunge: `dash` (6 m in 0.2 s), `applyStatus` | none | 6 m | n/a | 6 s | 0, free | haste 20 percent for 1.5 s on self |
| Q | Quiet Dart: `projectile`, `applyStatus` | 8 damage | 11 m | 20 m/s / 0.3 m | 12 s | 0.2 s, free | silence 1.5 s |
| E | Rend: `meleeArc` (90 degree arc, `cosHalfAngle` 0.7071067812), `applyStatus` | 20 damage, plus 16 damage over time in total | 2.5 m | n/a | 7 s | 0.25 s, slowed | damage over time for 2.0 s (4 per tick) |
| R | Vanish Step: `teleport` (up to 5 m toward the aim point), `applyStatus` | none | 5 m | n/a | 16 s | 0, free | invulnerable 0.5 s on self |
| F | Reaper's Dance (ultimate): `teleport` (up to 8 m toward the aim point), `meleeArc` (360 degrees, `cosHalfAngle` -1, swung where the teleport lands), `applyStatus` | 40 damage | 8 m teleport, 2.5 m arc | n/a | 10 s | 0.3 s, locked | stun 0.5 s and silence 2.0 s, both applied on hit, so the silence outlasts the stun |

**EX variants** (Shift plus slot, 25 energy).

| Slot | What changes against the base ability |
|------|----------------------------------------|
| SPACE | Lunge EX: dash distance 6 m becomes 8 m. At the dash end an extra `meleeArc` (90 degrees, `cosHalfAngle` 0.7071067812, 2.0 m) deals 14 damage. Haste on self becomes 30 percent for 2.0 s. |
| E | Rend EX: direct damage 20 becomes 28, and damage over time becomes 24 in total over 2.0 s (6 per tick). |

**Intended counters.**

- Beats Quillon. Lunge closes 6 m, Quiet Dart silences Skip so she cannot blink away, and Quillon's heavy hits all have a locked windup.
- Beats Lumeth. Quiet Dart silences her whole kit, and she has 120 health against a 20 damage Rend with a damage over time on top.
- Loses to Hargrim. Iron Hide soaks the first burst, Ground Slam slows the retreat, and 160 health outlasts her. Vanish Step gives only 0.5 s every 16 s.

**Bot profile sketch.**

| Field | Value |
|-------|-------|
| Preferred range | 0 to 2.5 m on the target, waits at 6 to 8 m for the opening |
| Opener | SPACE (Lunge) onto the lowest-health enemy, or Q (Quiet Dart) first if the target has an escape ready |
| Escape | R (Vanish Step) when health drops below 50 percent |
| Finisher | E (Rend, or EX Rend with 25 energy) on a target at 28 health or less |

## 5. Every 2v2 pairing works

Each pairing has a plan and a weakness. No pairing is a flat loss against another, and every champion in a pairing contributes.

| Pairing | Why it works | Its weakness |
|---------|--------------|--------------|
| Hargrim and Quillon | Hargrim holds the front with Iron Hide and Rally Cry while Quillon pokes from behind with slows and roots. | A fast dive on Quillon past Hargrim. |
| Hargrim and Lumeth | Hargrim pulls and slams, Lumeth heals him with Soothing Surge and shields both with Aegis Veil. | Quillon kiting the pair from about 14 m. |
| Hargrim and Skerrow | Chain Hook and Ground Slam pin a target, Quiet Dart silences it and Rend finishes. | No healing, so a long fight favours the other team. |
| Quillon and Lumeth | Binding Sigil and Snare Orb chain roots, and Aegis Veil protects Quillon from a dive. | Hargrim pulling Lumeth out of position. |
| Quillon and Skerrow | Bind Shot slows the target and Skerrow dives onto it, with Lance as the follow-up. | Two low-health champions with no shield beyond Hush Ward. |
| Lumeth and Skerrow | Skerrow dives behind the shield and haste of Aegis Veil EX, and Lumeth keeps her up with Soothing Surge. | Both are fragile, so focus fire ends the round. |

## 6. Balance notes

Status: the baseline of batch #105 (issue #109). No row of this document has
changed. The method, the band (40 to 60 percent per cell) and the full report
are in [balance](balance.md); the tuning pass is issue #121.

The six intended counters above, measured as bot against bot at the normal tier
over 100 seeds on both arenas, with the same fill on both teams (2v2: each
other champion in turn; 3v3: the other two, in both orders). The rates are
the favoured champion's win rate in percent, 2v2 on arena01 and arena02, then
3v3 on arena01 and arena02, from the report in balance.md.

| Counter | Favoured | 2v2 arena01 | 2v2 arena02 | 3v3 arena01 | 3v3 arena02 | Reading |
|---------|----------|-------------|-------------|-------------|-------------|---------|
| Hargrim beats Skerrow | Hargrim | 31.0 | 35.5 | 62.5 | 28.5 | Inverted in three cells, 2.5 over in one. |
| Hargrim beats Lumeth | Hargrim | 0.5 | 3.0 | 0.0 | 0.0 | Inverted: Lumeth wins. |
| Quillon beats Hargrim | Quillon | 100.0 | 99.0 | 99.0 | 92.5 | Right way, too strong. |
| Skerrow beats Quillon | Skerrow | 0.0 | 0.0 | 3.5 | 5.5 | Inverted: Quillon wins. |
| Lumeth beats Quillon | Lumeth | 62.5 | 6.0 | 56.5 | 20.0 | Right way in one cell, 2.5 over; in band in one; inverted in two. |
| Skerrow beats Lumeth | Skerrow | 0.0 | 4.5 | 0.0 | 2.0 | Inverted: Lumeth wins. |

- One cell of 24 is in the band. Three counters are inverted outright
  (Hargrim over Lumeth, Skerrow over Quillon, Skerrow over Lumeth), one is too
  strong (Quillon over Hargrim), and two are mixed.
- By champion, over all the cells it is in: Hargrim 14.2 percent, Skerrow
  21.5, Lumeth 77.9 and Quillon 86.4.
- The 3v3 rates pool both orders of the fill, because the order sets the spawn
  slots and moves a cell by tens of points (balance.md, section 3).
- Every number above is for these bots, which do not dodge, always target the
  nearest enemy and never press some abilities (bots.md). A kit change in #121
  is checked against this table before this document's rows change.
