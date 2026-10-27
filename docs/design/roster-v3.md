# Roster v3: champions seven to nine

Status: in progress; Durnhal's section is written and his model is built,
Wrenna's and Ysmeer's come in their own series
Source of truth for numbers: [roster v3 design
spec](../superpowers/specs/2026-10-24-blc-feel-roster-v3-design.md), sections
4.1 and 5, and [rules](rules.md), sections 4.1 and 5

This document defines champions seven to nine of the roster: a guardian tank,
a bow archer and a star caster. The [design
spec](../superpowers/specs/2026-10-24-blc-feel-roster-v3-design.md) proposes
the names, the ids and the archetypes, and gives every number as a draft. Each
champion's design package fixes its numbers here, against the catalog, the
same way [roster v2](roster-v2.md) fixed Ondrel's and Brimwick's. The six
champions of [roster v1](roster-v1.md) and [roster v2](roster-v2.md) are
unchanged.

## 0. How to read the numbers

- Numbers marked `[draft]` are the spec's proposals and are not final. A
  number marked `[tuned]` is a first value that the balance pass may move.
  Both markers are kept exactly as the spec has them until a design package
  fixes the number and says so.
- [Roster v1](roster-v1.md), section 0, and [roster v2](roster-v2.md),
  section 0, hold except where spec section 8 amends them, and are not
  copied here: the spec values, the tuning values, the energy table, the
  toolkit, the windup rules, the EX rules, the move speed and radius, the kit
  data rules and the model rules.
- The names are the spec's proposal. The "-like" tags are the mechanical
  inspiration only; every name, look and colour is original (ADR-005).
- One section per champion. Durnhal's is section 1. Wrenna's and Ysmeer's
  sections are added by their own series (roadmap issue
  [#176](https://github.com/sv-tmueller/claudeline-champions/issues/176),
  steps 3.1 and 4.1), and the counter web over all nine and the range table
  come when the three are in (spec section 5.4).
- Statuses and mechanics a kit needs that the catalog does not have yet are
  named in the champion's section. Each is built in its own package with a
  rules entry before the kit that uses it.

## 1. Durnhal, the guardian tank

Durnhal is Sentinel-like and brings the `wound` status (#158).

**Fantasy.** A heavy shield-and-hammer warden who walks into the enemy healer
and makes every heal worth less. His own name, look and colours.

**Role and range.** Frontline tank and healer-breaker. Intended range 0 to
3.5 m, with a thrown hammer that reaches 9 m. Max health 160.

**Abilities.**

| Slot | Name | What it does `[draft]` |
|---|---|---|
| M1 | Warhammer | Melee arc 100 degrees, 3.5 m: 10 damage and 1 `wound` stack (240 ticks). Cooldown 0.6 s. |
| M2 | Sundering Blow | Area 2 m ahead, radius 2 m, one hit: 16 damage and 1 `wound` stack. Windup 0.4 s, slowed. Cooldown 5 s. **EX:** 22 damage and 2 stacks. |
| SPACE | Bulwark Charge | Dash 5 m; at the end a one-hit self area, radius 1.5 m: knockback 2 m away. Cooldown 8 s. |
| Q | Grounding Slam | Self area, radius 2.5 m, one hit: 10 damage and root 1 s. Cooldown 10 s. |
| E | Breaker Throw | Projectile, speed 18, range 9 m: 16 damage, 1 `wound` stack and slow 30 percent for 1.5 s. Cooldown 7 s. **EX:** 22 damage and 2 stacks. |
| R | Aegis Line | Self area, radius 4 m, targets allies (him included): shield 25 for 4 s. Cooldown 14 s. |
| F | Last Bastion | Self area, radius 4.5 m, one hit: 30 damage, 3 `wound` stacks and slow 50 percent for 2 s; he gains a 50 shield for 4 s. Windup 0.5 s, locked. |

**Counter web (intent).** Beats Lumeth (`wound` on her targets), Skerrow
(roots and shields stop the dive), Hargrim (outlasts the bruiser). Loses to
Quillon (kited from 13 m) and Brimwick (her burst ignores shields' timing).

**Statuses the kit needs.** One, `wound`, an anti-heal (#158). Durnhal is the
champion that brings it, and every other effect in his table is in the
toolkit. The status is defined in the spec, section 4.1, and in
[rules](rules.md), section 4.1, which hold its rules and its catalog row;
nothing is copied here but the two catalog numbers the kit leans on.

- **Strength:** 10 percent less healing per stack `[tuned]`.
- **Duration:** 120 to 300 ticks per application in the catalog `[tuned]`.
  The table gives 240 ticks for M1; the tank series of roadmap
  [#176](https://github.com/sv-tmueller/claudeline-champions/issues/176)
  fixes the other applications, at the latest in step 1.2, the kit as data.

**Model.** Cue: a shield and a hammer, three boxes in the body material, so
the accent still marks only the front. The shield is a plate of 0.30 m by
0.04 m by 0.60 m on `Arm_L`, centred at (0, 0.44, 1.04): 1 cm off the arm and
from 0.74 m to 1.34 m, below the shoulder, so it does not read as Hargrim's
shoulder blocks. The hammer hangs from the right fist on `Arm_R`: a haft of
0.05 m by 0.05 m by 0.40 m centred at (0, -0.41, 0.60) and a head of 0.22 m
by 0.14 m by 0.14 m centred at (0, -0.41, 0.33). Two numbers are fixed, by the
shared `Death` clip and the overhead view, and are not to be changed. The head is 0.22 m long: at 0.28 m it
reaches x -0.14 m and the `Death` clip's key 30 (on the back, `Hips` at -85
degrees and -0.64 m) puts it 3.3 mm under the floor. The hammer sits at y
-0.41 m: at -0.34 m its y span equals the arm's, so from above it adds only
4 cm strips in front of and behind the arm, and at -0.41 m it sticks out 7 cm
to the side. The pose tables stay
shared, with no per-champion pose: `Cast` raises the shield forward, `Attack`
swings the hammer, and `Hit`, `Death` and `Run` throw or swing both arms
outward without either part touching a leg. The whole cue is below the
shoulders and reads from the 55 degree camera, not from straight above, and
anything bulkier breaks the 0.5 m radius. The model's top is the head's 1.70 m
at rest, and the clip tops are 1.7095 m (Idle), 1.7228 m (Run), 1.7000 m
(Attack), 1.7000 m (Cast), 1.7000 m (Hit) and 1.7026 m (Death), all under
1.90 m, with every clip's low at 0.0000 m. At key 30 of `Death` the lowest
point of the shield is 23.3 mm above the floor and of the hammer 26.6 mm. The
ground radius is 0.4924 m. The model is 600 vertices, 288 triangles and
39 780 bytes, and four builds are byte-identical.

Body colour: olive brass, linear (0.19, 0.18, 0.00), about `#797600`
(decision 2 of batch #203). In 8-bit sRGB b minus g is -118, so the overlay
rule holds (`overlay None`). The distances to the bodies are Hargrim 91.9,
Ondrel 92.7, Lumeth 95.0, Brimwick 104.1, Skerrow 112.0, Quillon 185.4 and the
placeholder 207.3; to the client colours the dead grey 118.3, enemy bar 160.9,
enemy projectile 163.8, impact ring 174.3, ally bar 177.3, ally projectile
274.0, the overlay magenta 311.3 and the hit flash 319.0; to the arena floor
168.1, the trim 174.4 and the accent 181.5. The HUD colours are at least 146.0
away (the energy colour). No existing margin is tightened: the roster's
tightest pairs stay Skerrow against the black panels at 83.1 and Brimwick
against Hargrim at 84.7. Bronze, 88.4 from the floor, and verdigris cyan, in
the ally projectile and ally bar hue family, were measured and set aside.
