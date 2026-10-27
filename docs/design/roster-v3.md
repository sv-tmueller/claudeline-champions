# Roster v3: champions seven to nine

Status: in progress; Durnhal's section is written and his kit is data,
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
  The table gives 240 ticks for M1. The other applications are 240 ticks for
  M2, E and their EX variants, and 300 ticks for F `[tuned]` (#204, the kit as
  data). A holder has one wound timer, and each application sets it to the
  longer of what is left and the new duration. Below 240, a skill hit would
  never move a timer that M1 refreshes, so its duration would mean nothing
  whenever M1 is in play; above 240, the skill hits would own the timer. So
  the landed hits take the one value the table gives for a landed hit, and F
  takes the catalog maximum: its 3-stack cut outlasts its own slow (120
  ticks) and shield (240 ticks).

**Kit data (built).** `data/kits/durnhal.json`, one file named after his id,
built by #204 under roster-v1 section 0, with a scripted fixture
(`scripted-roster-durnhal-arena01-2v2.json`, seed 5561). The conversions are
ticks = seconds x 60, one hit = `durationTicks` 1 and `intervalTicks` 1, the
100 degree arc = `cosHalfAngle` 0.6427876097, and the 9 m throw = 30 ticks at
18 m/s. The table leaves these numbers open, each `[tuned]` and chosen by the
precedent of a kit that has the same shape:

- M1 windup 9 ticks, slowed (Hargrim's Maul Swing).
- SPACE windup 0, free, like every SPACE; the dash is 5 m in 15 ticks
  (Hargrim's Rush), and the end push is 2 m in 8 ticks, `away` (Lumeth's
  Lantern Burst).
- Q windup 18 ticks, slowed (Ondrel's Reed Fence, the same circle).
- E windup 18 ticks, slowed (Quillon's Bind Shot), projectile radius 0.4
  (Hargrim's Chain Hook), lifetime 30 ticks.
- R windup 0, free, like every R.
- The EX variants copy the windup and the movement of their base.

The effects are listed in the order the table names them: damage first, then
the statuses (wound, then slow). F lists the area first and then the shield on
him. A number changes in the file, here and in the scripted fixture in the same
change. Durnhal is not in the balance harness roster until step 1.3, and the
server fields a bot of his on the default range profile until then.
