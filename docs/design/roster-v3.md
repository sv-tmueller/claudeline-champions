# Roster v3: champions seven to nine

Status: in progress; Durnhal's section is written, his kit is data and his
model is built, and Wrenna's section is written, her kit is data (#270) and her
model is built, her bot profile and client entry are built and she is in the
balance harness roster (#281, step 3.4; the committed block is still the
seven-kit report); Ysmeer's section is written, her kit is data (#271, roadmap
step 4.2, the first kit with a fuse and an end area) and her model is built
(#273), but she has no bot profile, no select entry and no place in the balance
harness yet (roadmap step 4.3)
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
- One section per champion. Durnhal's is section 1, Wrenna's section 2 and
  Ysmeer's section 3 (roadmap issue
  [#176](https://github.com/sv-tmueller/claudeline-champions/issues/176),
  step 4.1). Section 3 closes the counter web over all nine (spec section
  5.4), with Wrenna's cell against Ysmeer, and adds the range table over all
  nine. Durnhal's line against Ondrel closes in section 1, where his web is.
  Each section keeps the web line it wrote against the champions that
  existed when it was written.
- Statuses and mechanics a kit needs that the catalog does not have yet are
  named in the champion's section. Each is built in its own package with a
  rules entry before the kit that uses it.
- The `endArea` of a projectile (v3 spec section 4.3, [rules](rules.md)
  section 2.8) is in the toolkit since #160, so the roster-v2 section 0 list of
  what is not in the toolkit no longer holds for it. Ysmeer's kit (section 3,
  #271) is the first to use it, on her Gravity Well and Comet EX; Wrenna's
  section 2 names where hers would and why her Heartseeker EX carries none.

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
Quillon (kited from 13 m), Brimwick (her burst ignores shields' timing) and
Ondrel (section 3, the closing cell: her ground outslows and outranges him).

The Ondrel line closes the one Durnhal cell the #226 report left open.
Ondrel's Mire (30 percent), Reed Screen's field (30 percent) and Undertow's
slow (40 percent) add past the 70 percent cap and cut his 5.5 m/s walk to
1.65 m/s, against Reed Fence's 3 m/s push, so walking in is closed and his
Bulwark Charge is 5 m every 8 s against a fence that keeps shoving him back.
Her ground places at 8 m and Drowned Ground reaches 12.5 m, further than his
9 m Breaker Throw, so the fight happens at a range he cannot answer. His
shields survive the chip but not the hold.

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
change. Durnhal is not in the balance harness roster until step 1.3. His bot
profile is built (#211): the server fields a bot of his that stands at 2.4 m,
throws Breaker Throw at a target walking away and has Bulwark Charge, then
Aegis Line, as escapes (see [bots](../architecture/bots.md)).

**Model.** Cue: a shield and a hammer, three boxes in the body material, so the
accent still marks only the front. The shield is a plate of 0.30 m by 0.04 m by
0.60 m on `Arm_L`, centred at (0, 0.44, 1.04): 1 cm off the arm and from 0.74 m
to 1.34 m, below the shoulder, so it does not read as Hargrim's shoulder blocks.
The hammer hangs from the right fist on `Arm_R`: a haft of 0.05 m by 0.05 m by
0.40 m centred at (0, -0.41, 0.60) and a head of 0.22 m by 0.14 m by 0.14 m
centred at (0, -0.41, 0.33). Two numbers are fixed, by the shared `Death` clip
and the overhead view, and are not to be changed. The head is 0.22 m long: at
0.28 m it reaches x -0.14 m and the `Death` clip's key 30 (on the back, `Hips`
at -85 degrees and -0.64 m) puts it 3.3 mm under the floor. The hammer sits at y
-0.41 m: at -0.34 m its y span equals the arm's, so from above it adds only 4 cm
strips in front of and behind the arm, and at -0.41 m it sticks out 7 cm to the
side. The pose tables stay shared, with no per-champion pose: `Cast` raises the
shield forward, `Attack` swings the hammer, and `Hit`, `Death` and `Run` throw
or swing both arms outward without either part touching a leg. The whole cue is
below the shoulders and reads from the 55 degree camera, not from straight
above, and anything bulkier breaks the 0.5 m radius. With the head piece below,
the model's top is the helm's 1.8200 m at rest, and the clip tops are 1.8357 m
(Idle), 1.8723 m (Run), 1.8322 m (Attack), 1.8338 m (Cast), 1.8374 m (Hit) and
1.8512 m (Death), all under 1.90 m, with every clip's low at 0.0000 m. At key 30
of `Death` the lowest point of the shield is 23.3 mm above the floor and of the
hammer 26.6 mm. The ground radius is 0.4924 m. The model is 648 vertices, 312
triangles and 42 036 bytes, and four builds are byte-identical.

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

The head piece (issue #239) is a visored helm: a crown box 0.36 m by 0.36 m by
0.15 m on `Spine` centred at (0, 0, 1.745) and a nose ridge 0.06 m by 0.10 m by
0.16 m centred at (0.19, 0, 1.70), both in the body material. The ridge's
bottom is 1.62 m, above the accent visor (which ends at 1.61 m), so the visor
stays the front mark. The top is 1.8200 m, under the 1.85 m rest bound (`Run`
lifts `Hips` 0.035 m, so 1.8550 m posed, under 1.90 m). Treated alone, the crown
has a ground radius of 0.2546 m and the ridge 0.2256 m, both inside 0.5 m, so
the model's 0.4924 m footprint does not move.

## 2. Wrenna, the bow archer

Wrenna is Seeker-like and brings the on-hit counter (#161, split into the
counter, step 3.1, and the spend verbs, step 3.2, of the roadmap
[#176](https://github.com/sv-tmueller/claudeline-champions/issues/176)). In
the tables below "v3 spec" is the [roster v3 design
spec](../superpowers/specs/2026-10-24-blc-feel-roster-v3-design.md) and
"approved spec" is the [design
spec](../superpowers/specs/2026-10-01-claudeline-champions-design.md) of
2026-10-01.

**Fantasy.** A patient marksman whose steady bow fire builds Focus, which she
spends on a heavy shot or on getting away. Her own name, look and colours.

**Role and range.** Sustained ranged damage. Intended range 10 to 14 m, with a
Heartseeker that reaches 15.83 m. Max health 120. Kit counter: `{ from: M1,
cap: 3, windowTicks: 360 }` (three Focus stacks, a 6 s window).

**Abilities.** This package fixes the numbers of v3 spec section 5.2, so the
`[draft]` marker is dropped from the column. The numbers marked `[tuned]` in
the kit data below are the ones the table leaves open.

| Slot | Name | What it does |
|---|---|---|
| M1 | Longbow | Projectile, speed 24, range 14 m: 11 damage. Builds 1 Focus on an enemy hit. Cooldown 0.7 s. |
| M2 | Barbed Arrow | Projectile, speed 22, range 12.83 m: 12 damage and a damage over time of 12 over 3 s. Cooldown 6 s. **EX:** also slow 30 percent for 2 s. |
| SPACE | Tumble | Dash 5 m and haste 25 percent for 1.5 s. Cooldown 9 s. |
| Q | Pinning Shot | Projectile, speed 20, range 12 m: 9 damage and root 1 s. Cooldown 11 s. |
| E | Heartseeker | Projectile, speed 25, range 15.83 m, windup 0.5 s slowed: 16 damage; spends all Focus for +4 damage per stack (up to 28). Cooldown 8 s. **EX:** pierces, 20 damage, no Focus spend. |
| R | Fade Step | Spends all Focus to cut Tumble's cooldown by 2 s per stack; gains a 25 shield for 3 s. Cooldown 13 s. |
| F | Arrow Storm | Placed area at aim (range 13 m), radius 3 m, 4 pulses of 12 every 0.5 s (48 total) and slow 30 percent. Windup 0.6 s, locked. |

**Deviations from the draft.** Two values of v3 spec section 5.2 move: the
reach of two projectiles, which the abilities table above gives as 12.83 m
and 15.83 m in its range column, as roster-v1 gives Quillon's 13.93 m, and
not as the draft's 13 m and 16 m. A projectile's lifetime is a whole tick
(roster-v1 section 0, "reach"), and 13 m at 22 m/s is 35.45 ticks while 16 m
at 25 m/s is 38.4, so both round down, to 35 and 38 ticks. The speeds stay as
the draft has them, as Quillon's Rod Bolt, Bind Shot and Lance do in roster
v1. Longbow (35 ticks, exactly 14 m) and Pinning Shot (36 ticks, exactly 12
m) have no rounding. Every other number sits inside its catalog range (the
range table at the end of this section checks each), so there is no other
value to change. What this package adds to the draft is two things:

- Two web lines the spec does not state, Quillon and Lumeth. The spec names
  five of the seven opponents, and its section 5.4 asks that each existing
  champion get at least one win and one loss against the three new ones. The
  counter web below gives the reasons.
- The draft's one-line ability text is expanded into the kit data below,
  where the choices it leaves open (windups, radii, ticks) each have their
  precedent.

**The Heartseeker EX.** It pierces every champion in its path, so by v3 spec
section 4.3 it carries no `endArea`, and it spends nothing: the EX variant has
no `consumeCounter`, and Wrenna's Focus stays for Fade Step. The two spend
verbs sit on the two non-EX casts, Heartseeker (`bonusDamagePerStack`) and
Fade Step (`cooldownTicksPerStack`). The EX hits for 20 whatever her Focus is,
so it ties the base shot at 1 Focus (16 + 4 = 20), beats it at 0, and is worth
less than it at 2 or 3 Focus (24 or 28). It costs 25 energy and buys the
line, not the damage.

**Counter web (intent).** Beats Hargrim, Quillon, Brimwick, Durnhal and
Ysmeer. Loses to Skerrow, Ondrel and Lumeth. Her record over the eight other
champions is 5 wins and 3 losses; section 3 records the Ysmeer cell below.

| | Hargrim | Quillon | Lumeth | Skerrow | Ondrel | Brimwick | Durnhal | Ysmeer |
|---|---|---|---|---|---|---|---|---|
| Wrenna | beats | beats | loses | loses | loses | beats | beats | beats |

- Beats Hargrim (spec). His hook reaches 9 m and Rush closes 5 m, and her
  band begins at 10 m. Barbed Arrow EX and Pinning Shot slow and root what
  closes, and Tumble opens the gap again, so every second he spends walking
  is a free Longbow shot. Longbow reaches 14 m, five more than the hook.
- Beats Durnhal (spec). The same kiting against 3.5 m of reach and a thrown
  hammer of 9 m. He has 160 health and an Aegis Line shield of 25, so the
  fight is longer, which is what sustained damage is for. His `wound` is worth
  nothing against her: she has no heal and no heal over time, and a shield is
  not healing.
- Beats Brimwick (spec). Brimwick's longest shot is Grand Finale at 12 m,
  Spark reaches 11 m, Starshell and Flash Powder 10 m and Firecracker lands up
  to 9 m out, so a Wrenna at 12 to 14 m is outside nearly all of them. Flare
  Step (a 6 m teleport) is her answer: it brings Brimwick to 6 to 8 m, where
  Tumble and Pinning Shot have to answer, and a Flash Powder stun cancels a
  Heartseeker windup of 0.5 s.
- Beats Quillon (this package, not the spec). Both have 120 health and nearly
  the same reach on the basic shot, Rod Bolt 13.93 m and Longbow 14.00 m, and
  both lead their targets. Wrenna's edge is Focus: steady Longbow hits build a
  Heartseeker of 28 with a 0.5 s slowed windup against Lance's 28 with a 0.6 s
  locked one, Tumble steps out of Lance's line, and Barbed Arrow's damage over
  time keeps ticking through a retreat. Skip is a teleport and stays open
  under root, so Pinning Shot does not pin her, and the edge is small. It is
  written as a win so that Quillon has a loss against the three: Durnhal loses
  to Quillon.
- Loses to Skerrow (spec). Lunge closes 6 m in 0.2 s and Quiet Dart (11 m)
  silences Tumble and Fade Step. A rooted champion cannot start a dash cast,
  so a Pinning Shot that lands before the Lunge holds her, which is the whole
  counterplay, and a Heartseeker with a 0.5 s windup is slow against a 0.2 s
  dive.
- Loses to Ondrel (spec). Wrenna holds range by walking backwards. The Mire
  (30 percent), Reed Screen's field (30 percent) and Undertow's slow (40
  percent) add up past the 70 percent cap and take that speed away, while
  Drowned Ground and Reed Fence take the room. Her ordinary tools reach 8 to
  10.5 m (Undertow 8 m, Clod Toss 10 m, the Mire 10.5 m), and only the Mire EX
  (11 m) and Drowned Ground (12.5 m) reach further, so she wins by shaping
  where Wrenna can stand, not by outranging her.
- Loses to Lumeth (this package, not the spec). Mend Bolt heals an ally 10
  every 0.6 s (16.7 a second, and 10 a second when she aims it at herself, at
  60 percent by rules 2.5) against Longbow's 11 every 0.7 s (15.7 a second),
  Aegis Veil (30 absorb) takes a Heartseeker of 28 whole, and Binding Sigil
  (placed up to 9 m, radius 2.0 m, so 11.5 m of reach) roots a Wrenna at 10 to
  11.5 m, and a rooted champion cannot start Tumble. It is written as a loss
  so that Lumeth has a win against the three: Durnhal and Ysmeer both beat
  her. Her M1 reaches 12 m, 2 m less than Wrenna's.

The web stays intent, and balance measures the truth.

**Statuses the kit needs.** None. The one mechanic her kit needs that the
catalog does not have yet is the on-hit counter, which she brings. It is
defined in the v3 spec, section 4.4, and nothing is copied here but the
numbers her kit gives it. Every effect of her table is in the toolkit, except
the two spend verbs, which belong to the counter.

- **Declaration (data):** `counter: { from: 'M1', cap: 3, windowTicks: 360 }`
  on `data/kits/wrenna.json`. The slot is her Longbow, the cap is 3 Focus and
  the window is 360 ticks (6 s), inside the spec's ranges (1 to 5 and 60 to
  600). One timer covers the whole counter, not one per stack: 6 s after her
  last qualifying hit, all of it is gone. At the Longbow's cadence of 42 ticks
  the third hit lands 84 ticks after the first, so the window is generous and
  a gap of 6 s with no Longbow hit is what loses it.
- **Build:** the on-hit counter (#227) adds the declaration to the kit schema
  and builds, decays and resets the count. Only M1 builds it, on a hit on an
  enemy that is not invulnerable. Her other projectiles, Barbed Arrow,
  Pinning Shot and Heartseeker, build nothing, and neither does Arrow Storm.
- **Spend:** the two verbs are part 4.4b (v3 spec section 4.4b, #245), and rules.md section 2.6 gives the rule. `consumeCounter` is a top-level effect with `{ bonusDamagePerStack: 4 }` on Heartseeker and with `{ cooldownTicksPerStack: 120, slot: 'SPACE' }` on Fade Step. It spends the whole counter on the tick the cast fires and does nothing at 0, so Fade Step with no Focus is a plain shield of 25. 120 ticks per stack is 2 s, so 3 stacks cut 360 of Tumble's 540 ticks, and a cooldown never goes below 0. The damage range applies to the total: 16 + 4 times 3 is 28, under 30.

**Kit data (built, #270).** `data/kits/wrenna.json` is step 3.3 of the build
order, after the on-hit counter (step 3.1, #227) and the spend verbs (step
3.2). This section fixes the numbers it uses. The conversions are ticks =
seconds x 60, a damage over time of T over S s is `perPulse` T times 0.5 over
S, with `ticks` S times 60 (one tick every 30 ticks, as Skerrow's Rend), and
"N pulses of I s" is an `area` with `intervalTicks` I times 60 and
`durationTicks` N times that. The table leaves these numbers open, each
`[tuned]` and chosen by the precedent of a kit that has the same shape:

- M1 windup 6 ticks, free, and projectile radius 0.25 m (Quillon's Rod Bolt).
- M2 windup 18 ticks, slowed, and radius 0.35 m, a status-carrying shot like
  Bind Shot (windup 18, slowed) and the radius of Mend Bolt and Flash Powder.
  The damage over time is 2 per tick over 180 ticks: 6 ticks, 12 in total. The
  EX copies the windup and the movement, and adds a slow of 30 percent for 120
  ticks.
- SPACE windup 0, free, like every SPACE: the dash is 5 m in 15 ticks, as
  Hargrim's Rush, and the haste is 25 percent for 90 ticks on self.
- Q windup 18 ticks, slowed, and radius 0.4 m (Bind Shot and Chain Hook); the
  root is 60 ticks, the catalog minimum.
- E windup 30 ticks, slowed (the table's 0.5 s), radius 0.25 m (Rod Bolt, the
  same projectile as M1). The EX copies the windup, the movement, the
  lifetime and the radius, with `pierce` true and no `consumeCounter` and no
  `endArea`.
- R windup 0, free, like every R, and the shield 180 ticks.
- F windup 36 ticks, locked (the table's 0.6 s). The area is placed at the aim
  up to 13 m, radius 3 m, `durationTicks` 120 and `intervalTicks` 30: 4 pulses
  at 0, 30, 60 and 90 ticks, each with 12 damage and a slow of 30 percent for
  60 ticks, so the next pulse refreshes it. No pulse carries stun, root or
  silence, and the area lingers for 120 ticks, less than the 600 of F.
- Cooldowns in ticks: M1 42, M2 360, SPACE 540, Q 660, E 480, R 780, F 600.
  The lifetimes are 35, 35, 36 and 38 ticks for M1, M2, Q and E, which reach
  14.00, 12.83, 12.00 and 15.83 m.

The effects are listed in the order the table names them: damage first, then
the damage over time, the slow or the root. Every damaging slot (M1, M2, Q, E
and F) carries a `damage`, so each earns energy by rules 3.1; SPACE and R carry
none and earn none. EX variants sit on M2 and E, never on F, at 25 energy, and
F costs 100. A number changes in the file, here and in the scripted fixture in
the same change. Wrenna joined the balance harness in the last step of her
series (v3 spec section 9.3), step 3.4 (#281): `HARNESS_KITS` in
`tools/balance/inputs.ts` lists her, and the balance block of
[balance](balance.md) is not regenerated for her, so it is still the seven-kit
report and `npm run balance -- --check` fails on purpose until the nine-kit
report of batch 21.

**Bot profile (#281).** Roster-v3 has no bot sketch for her, so her profile
follows roster-v2's recipe (see [bots](../architecture/bots.md)): she keeps 10
to 13 m (the low end of her intended 10 to 14 m, and Longbow's 14 m less the
margin), throws Pinning Shot at a target walking toward her, builds her counter
with Longbow on its band, and escapes by Tumble, then Fade Step (which cuts
Tumble by 120 ticks a stack, so it goes second). She spends the counter with the
base Heartseeker while she holds stacks (the new `spendBase` field of her rule),
since the EX ties the base shot at 1 stack, loses from 2 and costs 25 energy.

As built (#270), where the sections above leave a choice open:

- The key order is the one of `hargrim.json` (`id`, `maxHealth`, `moveSpeed`,
  `support`, `ex`), then `counter`, then `slots`.
- The `consumeCounter` marker sits where the table names the effect: after the
  projectile on Heartseeker (`[projectile, consumeCounter]`, so the EX differs
  from it at `effects[0].pierce`, `effects[0].effects[0].amount` and
  `effects[1]`) and before the shield on Fade Step (`[consumeCounter, shield]`).
  Where it sits changes nothing, since `fire` scans the list before any effect
  runs.
- Tumble is `dash` of 5 m in 15 ticks with an empty `then`, then a haste on
  self, the shape of Hargrim's Rush. Tumble and Fade Step carry no damage, so
  neither earns energy.
- The roster test walks the damage total after the spend bonus: Heartseeker is
  16 + 4 x 3 = 28, under 30, and a kit that puts the marker on a pulsing area
  adds the bonus to every damage of every pulse. The ability oracle of the sim
  tests knows the cooldown verb (it lowers the named slot by the verb per stack
  held, never below 0).
- Her scripted fixture, `scripted-roster-wrenna-arena01-2v2.json`, is match seed
  5562, built by `npm run fixtures:search -- wrenna`.

**Range table.** The intended range of this section, in the shape of
[roster v2](roster-v2.md) section 1. The table over all nine is in section 3.

| Champion | Intended range | Source |
|----------|----------------|--------|
| Wrenna | 10 to 14 m, Heartseeker 15.83 m | section 2 |

Her band sits above Quillon's 9 to 13 m on purpose, and her M1 reaches 14.00 m
against Rod Bolt's 13.93 m, the longest basic shot of the roster. Its start at
10 m clears Hargrim's 9 m hook, Durnhal's 9 m throw, every melee swing from
where it stands and the end of Ondrel's Clod Toss (10 m). It does not clear
everything. Still reaching into the band, among others, are Ondrel's Mire (10.5
m), Mire EX (11 m) and Drowned Ground (12.5 m), Brimwick's Spark (11 m),
Firecracker (11 m, 11.5 m as the EX) and Grand Finale (12 m), and Skerrow's
Lunge EX (10.5 m) and Reaper's Dance (11 m), which close before they swing; the
web lines above weigh each against her.

Every number of this section that a catalog range binds has one row. The
sources are the approved spec section 10 and section 4.6, rules sections 4.1
and 5, roster-v1 section 0, roster-v2 section 0 and the v3 spec sections 4.3
and 4.4.

| Where (slot / EX / effect) | Number | Value | Range | Source | In range |
|----------------------------|--------|-------|-------|--------|----------|
| stats | `maxHealth` | 120 | 120 to 160, steps of 10 | approved spec 10, rules 5 | yes |
| stats | `moveSpeed` | 5.5 m/s | 5.5 m/s | approved spec 10 | yes |
| F | cooldown | 600 ticks (10 s) | 600 ticks | roster-v1 §0 | yes |
| M1 | projectile speed | 24 m/s | 12 to 25 m/s | approved spec 10 | yes |
| M1 | projectile radius | 0.25 m | 0.2 to 0.6 m | approved spec 10 | yes |
| M1 | damage | 11 | 8 to 30 | approved spec 10 | yes |
| M2 | projectile speed | 22 m/s | 12 to 25 m/s | approved spec 10 | yes |
| M2 | projectile radius | 0.35 m | 0.2 to 0.6 m | approved spec 10 | yes |
| M2 | damage | 12 | 8 to 30 | approved spec 10 | yes |
| M2 | damage over time, total | 12 (2 times 6 ticks) | 8 to 30 | rules 4.1 | yes |
| M2 | damage over time, duration | 180 ticks (3 s) | 60 to 240 | rules 4.1 | yes |
| M2 EX | projectile speed, radius, damage | 22 m/s, 0.35 m, 12 | 12 to 25, 0.2 to 0.6, 8 to 30 | approved spec 10 | yes |
| M2 EX | damage over time, total | 12 | 8 to 30 | rules 4.1 | yes |
| M2 EX | damage over time, duration | 180 ticks (3 s) | 60 to 240 | rules 4.1 | yes |
| M2 EX | slow percent | 30 | 20 to 60 | rules 4.1 | yes |
| M2 EX | slow ticks | 120 (2 s) | 60 to 180 | rules 4.1 | yes |
| SPACE | haste percent | 25 | 20 to 50 | rules 4.1 | yes |
| SPACE | haste ticks | 90 (1.5 s) | 60 to 240 | rules 4.1 | yes |
| Q | projectile speed | 20 m/s | 12 to 25 m/s | approved spec 10 | yes |
| Q | projectile radius | 0.4 m | 0.2 to 0.6 m | approved spec 10 | yes |
| Q | damage | 9 | 8 to 30 | approved spec 10 | yes |
| Q | root ticks | 60 (1 s) | 60 to 150 | rules 4.1 | yes |
| E | projectile speed | 25 m/s | 12 to 25 m/s | approved spec 10 | yes |
| E | projectile radius | 0.25 m | 0.2 to 0.6 m | approved spec 10 | yes |
| E | damage, base | 16 | 8 to 30 | approved spec 10 | yes |
| E | damage with 3 Focus, the total | 28 (16 + 4 times 3) | 8 to 30 | v3 spec 4.4 | yes |
| E EX | projectile speed, radius | 25 m/s, 0.25 m | 12 to 25, 0.2 to 0.6 | approved spec 10 | yes |
| E EX | damage | 20 | 8 to 30 | approved spec 10 | yes |
| E EX | `pierce` with `endArea` and `consumeCounter` | `pierce` true, neither | no `endArea` on a piercing projectile | v3 spec 4.3 | yes |
| R | shield absorb | 25 | 20 to 60 | rules 4.1 | yes |
| R | shield ticks | 180 (3 s) | 180 to 360 | rules 4.1 | yes |
| R | `cooldownTicksPerStack`, the cut at 3 stacks | 120, so 360 of 540 ticks | never below 0 | v3 spec 4.4 | yes |
| F | damage per pulse | 12 | 8 to 60 | approved spec 10 | yes |
| F | total over 4 pulses | 48 (12 times 4) | 8 to 60 | roster-v2 §0 | yes |
| F | slow percent | 30 | 20 to 60 | rules 4.1 | yes |
| F | slow ticks | 60 (1 s) | 60 to 180 | rules 4.1 | yes |
| F | stun, root or silence on a pulse | none | never on a pulsing area | roster-v2 §0 | yes |
| F | duration against cooldown | 120 ticks against 600 | below the cooldown | roster-v2 §0 | yes |
| counter | `cap` | 3 | 1 to 5 | v3 spec 4.4 | yes |
| counter | `windowTicks` | 360 (6 s) | 60 to 600 | v3 spec 4.4 | yes |
| EX | EX variants | 2, on M2 and E | exactly 2, never F | approved spec 4.6, roster-v1 §0 | yes |
| EX | EX cost | 25 energy | 25 energy | approved spec 10 | yes |
| F | ultimate cost | 100 energy | 100 energy | approved spec 10 | yes |
| all | `energyGain` effects | none | none | roster-v2 §0 | yes |

The numbers with no range are tuning values per roster-v1 section 0: the
cooldowns, the windups, the lifetime of a projectile, the radius and the
duration of an area and the distance of a dash.

**Model.** Cue: a bow and a quiver, four boxes in the body material, so the
accent still marks only the front. The bow rides `Arm_L` at y 0.45, so from the
55 degree camera it shows beside the arm as Durnhal's shield does and stays
inside the 0.5 m ground radius: a grip of 0.05 m by 0.05 m by 0.34 m centred at
(0, 0.45, 0.88) and two limbs of 0.30 m and 0.24 m centred at (0, 0.45, 1.16)
and (0, 0.45, 0.68), the boxes turned +30 and -30 degrees about Y so the pair
reads as a stave. The quiver is one box of 0.08 m by 0.10 m by 0.44 m on
`Spine` at (-0.10, 0, 1.30), low on the back where Ondrel's reed bundle sits but
offset to x -0.10 so the two do not read as one cue. Two numbers are fixed, by
the shared clips and the colour rule. The quiver's x offset must stay small: at
-0.16 m, on the back of the body as `Death` lays it down (key 30, `Hips` at -85
degrees and -0.64 m), it sinks 7.3 mm under the floor (near -0.17 m it sinks
17.2 mm), and at -0.10 m every key and every sample holds at 0. The limbs stop
at 1.30 m, so `Cast`'s raise of `Arm_L` to -85 degrees keeps the top at
1.7000 m rather than lifting the bow over the limit. The pose tables stay
shared, with no per-champion pose. With the head piece below, the
model's top is the cap's 1.8093 m at rest, and the clip tops are 1.8234 m
(Idle), 1.8538 m (Run), 1.8175 m (Attack), 1.8183 m (Cast), 1.8093 m (Hit) and
1.8100 m (Death), all under 1.90 m, with every clip's low at 0.0000 m. The
ground radius is 0.4847 m. The model is 672 vertices, 324 triangles and 43 180
bytes, and four builds are byte-identical.

Body colour: plum, linear (0.445, 0.093, 0.175), about `#b25674`. In 8-bit sRGB
b minus g is 30, so the overlay rule holds (`overlay None`). The distances to
the bodies are Hargrim 86.7, Brimwick 124.9, the placeholder 126.3, Durnhal
133.2, Lumeth 140.6, Skerrow 151.6, Ondrel 159.7 and Quillon 190.0; to the
client colours the enemy bar 85.9, the dead grey 88.7, the enemy projectile
96.0, the impact ring 155.3, the ally bar 178.6, the debug overlay 180.7, the
energy orb 191.3, the ally projectile 207.6 and the hit flash 232.0; to the
arena floor 86.3, the trim 99.2 and the accent 146.3. The HUD, result and menu
colours are at least 85.9 away (the enemy bar and the menu error, `#ff4d4f`).
No existing margin is tightened: the roster's tightest pairs stay Skerrow
against the black panels at 83.1 and Brimwick against Hargrim at 84.7. Three
natural wren colours were measured and set aside: hunter green
(0.0, 0.125, 0.0), about `#006300`, 84.3 from Ondrel; deep navy
(0.0, 0.06, 0.168), about `#004572`, 83.2 from Quillon; and the magenta-rose
`#b14e7b`, 89.1 from the floor but exactly on the b - g = 45 cap. The natural
wren hue cannot pass either: every muted brown and leather tried tops out at
76.6 (against Brimwick), under the 80 rule, and the paler tans that clear the
rest sit inside 80 of her own plum.

The head piece (issue #239) is an archer's cap with a swept-back feather, the
lead's decision logged on the issue: Skerrow already has the hood, so a second
hood would collide with his from the top-down camera. Two boxes on `Spine` in
the body material: a low crown 0.34 m by 0.34 m by 0.12 m centred at
(0, 0, 1.72) and a thin feather 0.05 m by 0.10 m by 0.24 m centred at
(-0.05, 0, 1.72) and turned -55 degrees about Y, so it sweeps back and up
behind the crown. The top is 1.8093 m, under the 1.85 m rest bound (`Run` lifts
`Hips` 0.035 m, so 1.8443 m posed, under 1.90 m), and the crown clears the visor
at 1.66 m. Treated alone, the crown's ground radius is 0.2404 m and the feather
sweeps to 0.1701 m, both inside 0.5 m, so the model's 0.4847 m footprint does
not move.

## 3. Ysmeer, the star caster

Ysmeer is Astronomer-like and brings the fuse (#159) and the end area (#160),
steps 4.1 of the roadmap
[#176](https://github.com/sv-tmueller/claudeline-champions/issues/176). She
is the last of the three, so this section also closes the counter web over
all nine and writes the range table (spec section 5.4).

**Fantasy.** A caster who calls falling stars a moment before they land, so
the skill is in reading where the enemy will be. Her own name, look and
colours.

**Role and range.** Area control by prediction. Intended range 8 to 12 m,
with a Starbolt that reaches 11 m. Max health 120.

**Abilities.** This package fixes the numbers of v3 spec section 5.3, so the
`[draft]` marker is dropped from the column. The numbers marked `[tuned]` in
the kit data below are the ones the table leaves open, and the fuse and the
end area are cited by the spec that defines them (v3 spec sections 4.2 and
4.3), not by a sim package, so this section does not wait for them.

| Slot | Name | What it does |
|---|---|---|
| M1 | Starbolt | Projectile, speed 20, range 11 m: 10 damage. Cooldown 0.7 s. |
| M2 | Falling Star | Placed area at aim (range 11 m), radius 2 m, fuse 0.75 s, one hit: 20 damage. Cooldown 5 s. **EX:** radius 2.5 m and stun 0.75 s. |
| SPACE | Drift | Dash 4 m and haste 30 percent for 1.5 s. Cooldown 9 s. |
| Q | Gravity Well | Slow projectile, speed 12, range 10 m: 9 damage on a hit; at its end leaves an area, radius 2 m, 3 pulses of 8 every 0.5 s (24 total) and slow 30 percent. Cooldown 10 s. |
| E | Comet | Projectile, speed 18, range 12 m: 18 damage and knockback 2 m. Cooldown 7 s. **EX:** at its end leaves a one-hit area, radius 2 m, of 14 damage. |
| R | Eclipse | Self shield 30 for 4 s and a self area, radius 3 m, one hit: knockback 2.5 m away. Cooldown 13 s. |
| F | Supernova | Placed area at aim (range 12 m), radius 3.5 m, fuse 1.5 s, one hit: 55 damage and stun 1 s. Windup 0.4 s, slowed. |

**Deviations from the draft.** The draft's two reaches of 11 m and 12 m for
M1 and E come out exact: 20 m/s for 33 ticks is 11 m and 18 m/s for 40 ticks
is 12 m (roster-v1 section 0, "reach"), so no number moves for a rounding.
The draft's Q reach of 10 m at 12 m/s is 50 ticks and 10 m exactly. The one
addition is the number the draft leaves open on every slot: the windups, the
radii and the ticks, chosen in the kit data below, each by the precedent of a
kit that has the same shape. The fuse and the end area are the draft's own
numbers, held here as written: they are the catalog's to bound (rules 2.7 and
v3 spec 4.3), not this section's to move.

**The fuse.** Falling Star and Supernova are `area` effects with a
`fuseTicks`, defined by v3 spec section 4.2 and rules 2.7. While armed an
area is visible and inert and stays where the cast aimed it, so the whole
skill is reading where the target will be when the fuse burns. A fuse of
0.75 s is 45 ticks and 1.5 s is 90 ticks, both inside the catalog's 15 to 120
`[tuned]`. The linger rule counts the fuse, so 45 plus the one-hit duration
of 1 stays under Falling Star's 300 tick cooldown, and 90 plus 1 stays under
Supernova's 600. A fused one-hit area may carry control (rules 2.7), which is
what lets Supernova stun and let the Falling Star EX stun on its own radius:
one delayed hit gives the target the fuse to walk out, and neither area
pulses more than once, so the ban on a pulsing control carries no weight here.

**The end area.** Q's Gravity Well and the E EX of Comet carry an `endArea`,
defined by v3 spec section 4.3. The projectile spawns the area where it ends,
so the area lands at the end of the projectile's `lifetimeTicks` (50 and 40
ticks), or where it stops on an obstacle or the arena edge, and never where it
hits a champion: the hit effects fire as today. A projectile with `pierce` is
rejected with an `endArea`, and neither carries `pierce` here. The spawned
area obeys every area rule, the linger rules included, and counts as an area
of the projectile's slot, so Gravity Well's 3-pulse slow field is bound the
same way a placed area would be.

**Counter web (intent).** Beats Durnhal, Ondrel and Lumeth. Loses to Skerrow,
Wrenna, Quillon, Hargrim and Brimwick. Her record over the eight other
champions is 3 wins and 5 losses. With this row the web closes over all
nine: section 2 adds Wrenna's cell against her, section 1 adds Durnhal's line
against Ondrel, and the range table below has a row per champion. The three
were the items the #226 report left open.

| | Durnhal | Ondrel | Lumeth | Hargrim | Quillon | Brimwick | Skerrow | Wrenna |
|---|---|---|---|---|---|---|---|---|
| Ysmeer | beats | beats | beats | loses | loses | loses | loses | loses |

- Beats Durnhal (spec). The slow tank has to walk to 3.5 m to reach her, and
  his one ranged tool, Breaker Throw, reaches 9 m against her band's 8 to 12
  m. Every metre he walks is a Falling Star aimed where he will be, and a
  160-health champion who cannot close is a rock she keeps dropping stars
  on. His `wound` and shields are worth nothing to him here: she is the one
  with the range.
- Beats Ondrel (spec). Her star falls at 11 m and Ondrel's Mire, Mire EX and
  Drowned Ground all place at 8 m, so Ysmeer ranges the ground and Ondrel has
  to walk into hers. Her M2 is the answer to the zones: a fused one-hit area
  of 20 at 2 m, and the Supernova of 55 with a 1.5 s fuse is the biggest hit
  in her kit, so an Ondrel who stands in a Reed Fence to hold the middle eats
  the F. Gravity Well slows Ondrel out of her own ground and its end area
  keeps the slow on the ground she wanted. She has 130 health to Ysmeer's
  120, so the fight is close only until one star lands.
- Beats Lumeth (spec). Lumeth's allies stand still to be healed, and a still
  target is a landed star: Falling Star's 0.75 s fuse and Supernova's 1.5 s
  both hit a champion who holds position. Her M1 reaches 12 m, 1 m more than
  Ysmeer's Starbolt, but Ysmeer's M2, Q and F all reach 10 to 12 m and none
  of them needs her to be closer. Mend Bolt's single-target heal cannot
  outpace a 20 damage star and a 55 damage ultimate landing on a target that
  will not move.
- Loses to Hargrim (this section, not the spec). His hook reaches 9 m and
  Rush closes 5 m, so he crosses her band in one dash and she has no root or
  slow to stop him before he is inside Maul Swing's 2.5 m. Her only
  disengage is Drift, a 4 m dash on a 9 s cooldown, and her shields are on R
  at 13 s. A fused area cannot save her against a target already on top of
  her: the fuse is the time she does not have. It is written as a loss so
  that Hargrim has a win against the three new champions.
- Loses to Quillon (this section, not the spec). Both have 120 health, and
  Rod Bolt at 13.93 m and Lance at 17.92 m both outrange her 11 to 12 m.
  Skip is a 4 m teleport on a 9 s cooldown and Hush Ward hastes her 30
  percent, so she holds the range Ysmeer needs to close, and the Lance of 28
  at 25 m/s is faster than any of Ysmeer's projectiles. Ysmeer's answer is
  her own area play, which needs the target to come to her.
- Loses to Brimwick (this section, not the spec). Flare Step brings a 6 m
  teleport, and at 7 m her Flash Powder stun (0.75 s) cancels a placed-area
  windup while her Firecracker, the same kind of placed area as Ysmeer's M2,
  lands the tick it fires instead of after a fuse. Brimwick's Grand Finale
  reaches 12 m and stuns 1.0 s, and her Starshell of 26 is well above
  Ysmeer's 20 star, so the burst beats the prediction in a straight trade.
- Loses to Skerrow (spec). Lunge closes 6 m in 0.2 s, inside the 0.4 s slowed
  windup of Supernova, and Quiet Dart silences Ysmeer for 1.5 s so no star
  lands. A rooted champion can still cast, but a silenced one cannot, and her
  whole kit is casts. She has 120 health against Rend's 14 plus a damage over
  time, and Drift's 4 m does not outrun an 8 m Lunge EX.
- Loses to Wrenna (spec). Wrenna holds her 10 to 14 m band, her Longbow
  reaches 14.00 m against Ysmeer's 12 m, and her Heartseeker of 28 is above
  Ysmeer's 20 star with a 0.5 s slowed windup. Ysmeer's whole kit lands at
  10 to 12 m, so a Wrenna who keeps 2 m more of gap takes every trade. This
  is also the closing cell Wrenna's section 2 points to: her record over the
  eight is 5 wins and 3 losses.

The web stays intent, and balance measures the truth.

**Statuses the kit needs.** None. The two mechanics her kit needs that the
catalog does not have yet are the fuse on an area and the end area on a
projectile, and she brings both. They are defined in the v3 spec, sections
4.2 and 4.3, and in rules 2.7, and nothing is copied here but the numbers her
kit gives them. Every effect of her table is in the toolkit plus those two.

- **The fuse (data):** `fuseTicks` on an `area` of M2, 45 (0.75 s), and of
  F, 90 (1.5 s). Both inside the catalog's 15 to 120 (rules 2.7). The area
  is placed on the tick the cast fires and pulses once at the fuse's end.
- **The end area (data):** `endArea` on the projectile of Q and of the E EX,
  each a one-hit area of the projectile's slot, spawned where the projectile
  ends. No `pierce`, per v3 spec section 4.3.

**Kit data.** `data/kits/ysmeer.json` is step 4.2 of the build order (#271),
after the fuse (#159) and `endArea` (#160) landed in the sim. This section
fixes the numbers it uses. The conversions are ticks = seconds x
60, one hit = `durationTicks` 1 and `intervalTicks` 1, and "N pulses of I s"
is an `area` with `intervalTicks` I times 60 and `durationTicks` N times
that. The table leaves these numbers open, each `[tuned]` and chosen by the
precedent of a kit that has the same shape:

- M1 windup 6 ticks, free, and projectile radius 0.25 m (Quillon's Rod Bolt,
  the same fast basic shot). Lifetime 33 ticks, reach 11.00 m.
- M2 windup 24 ticks, slowed (Hargrim's Ground Slam and Ondrel's Mire, the
  same placed M2 circle), radius 2 m as the table gives. The fuse is 45
  ticks and the area is one hit: `durationTicks` 1, `intervalTicks` 1. The
  EX copies the windup, the fuse and the movement, takes radius 2.5 m, and
  adds a stun of 45 ticks (0.75 s), the catalog minimum (Brimwick's Flash
  Powder), allowed on a fused one-hit area (rules 2.7).
- SPACE windup 0, free, like every SPACE: the dash is 4 m in 12 ticks
  (Lumeth's Glide), and the haste is 30 percent for 90 ticks as the table
  gives, inside the catalog's 20 to 50 percent and 60 to 240 ticks.
- Q windup 24 ticks, slowed, and projectile radius 0.5 m (Ondrel's Undertow,
  the same slow projectile). Speed 12 m/s, lifetime 50 ticks, reach 10.00 m.
  The `endArea` is a radius 2 m circle, `durationTicks` 90 and
  `intervalTicks` 30: 3 pulses at 0, 30 and 60 ticks, each 8 damage and a
  slow of 30 percent for 60 ticks, so the next pulse refreshes it (an area that
  spawns at a lifetime end runs a tick behind, rules 2.8, so the pulses fall a
  tick after those offsets). Total 24,
  inside 8 to 30 (roster-v2 section 0). The area lands where the projectile
  ends, so the field reaches as far as the 10.00 m of the shot.
- E windup 18 ticks, slowed, and projectile radius 0.4 m (Durnhal's Breaker
  Throw). Speed 18 m/s, lifetime 40 ticks, reach 12.00 m, and the knockback
  is 2 m in 8 ticks, `away` (Lumeth's Lantern Burst). The EX copies the
  windup, the movement and the lifetime, radius 0.4 m, and adds a one-hit
  `endArea` of radius 2 m and 14 damage.
- R windup 0, free, like every R: the shield is 30 for 240 ticks (Lumeth's
  Aegis Veil), and the self area is radius 3 m, one hit, with a knockback of
  2.5 m in 10 ticks `away` (Brimwick's Starshell push, scaled).
- F windup 24 ticks, slowed (the table's 0.4 s and its slowed rule), radius
  3.5 m as the table gives, fuse 90 ticks and one hit. The stun is 60 ticks
  (1.0 s), the same as Hargrim's Quarry Break, allowed on a fused one-hit
  area. `durationTicks` 1, `intervalTicks` 1.
- The EX variants copy the windup, the movement and the fuse of their base.
- Cooldowns in ticks: M1 42, M2 300, SPACE 540, Q 600, E 420, R 780, F 600.

The effects are listed in the order the table names them: damage first, then
the statuses and pushes (the knockback, then the slow or the stun). Every
damaging slot (M1, M2, Q, E and F) carries a `damage`, so each earns energy
by rules 3.1. SPACE and R carry none and earn none: R has a shield on self
and a knockback, and a shield or a push alone gives nothing (rules 3.1). EX
variants sit on M2 and E, never on F, at 25 energy, and F costs 100. A number
changes in the file, here and in the scripted fixture in the same change.
Ysmeer joins the balance harness in the last step of her series (v3 spec
section 9.3).

**Range table.** The intended range of every champion, in the shape of
[roster v2](roster-v2.md) section 1 and the closing step of spec section 5.4.

| Champion | Intended range | Source |
|----------|----------------|--------|
| Hargrim | 0 to 3 m, hook 9 m | roster v1 |
| Skerrow | 0 to 2.5 m, closing from 6 to 8 m | roster v1 |
| Durnhal | 0 to 3.5 m, throw 9 m | section 1 |
| Ondrel | 5 to 9 m | roster v2 |
| Lumeth | 6 to 10 m | roster v1 |
| Brimwick | 7 to 10 m | roster v2 |
| Ysmeer | 8 to 12 m, Supernova 12 m | section 3 |
| Quillon | 9 to 13 m | roster v1 |
| Wrenna | 10 to 14 m, Heartseeker 15.83 m | section 2 |

Every band is a range, not a point, and the order above runs from the melee
pair to the longest shot: Hargrim and Skerrow at the front, Durnhal behind
them with a 9 m throw, Ondrel in the middle where her ground lies, Lumeth
close enough to heal, Brimwick and Ysmeer the two mid-range casters, and
Quillon and Wrenna the two back-liners. Ysmeer's 8 to 12 m sits above
Brimwick's 7 to 10 m on purpose: she is the prediction caster who needs the
target to commit, so she stands behind the burst and calls stars into the
ground the enemy has to cross. Her M1 reaches 11.00 m and her F 12 m, so her
band top is her ultimate, and her band start of 8 m clears every melee swing
from where it stands and Durnhal's 3.5 m, and stays inside Ondrel's ground
(8 to 12.5 m), which is exactly the fight this section reads.

Every number of this section that a catalog range binds has one row. The
sources are the approved spec section 10 and section 4.6, rules sections 4.1,
2.7 and 5, roster-v1 section 0, roster-v2 section 0 and the v3 spec sections
4.3 and 4.4.

| Where (slot / EX / effect) | Number | Value | Range | Source | In range |
|----------------------------|--------|-------|-------|--------|----------|
| stats | `maxHealth` | 120 | 120 to 160, steps of 10 | approved spec 10, rules 5 | yes |
| stats | `moveSpeed` | 5.5 m/s | 5.5 m/s | approved spec 10 | yes |
| M1 | projectile speed | 20 m/s | 12 to 25 m/s | approved spec 10 | yes |
| M1 | projectile radius | 0.25 m | 0.2 to 0.6 m | approved spec 10 | yes |
| M1 | damage | 10 | 8 to 30 | approved spec 10 | yes |
| M2 | area radius | 2 m | areas are tuning | roster-v1 §0 | yes |
| M2 | damage | 20 | 8 to 30 | approved spec 10 | yes |
| M2 | fuse | 45 ticks (0.75 s) | 15 to 120 ticks | rules 2.7 | yes |
| M2 | fuse plus duration against cooldown | 46 ticks against 300 | below the cooldown | rules 2.7 | yes |
| M2 EX | area radius | 2.5 m | areas are tuning | roster-v1 §0 | yes |
| M2 EX | damage | 20 | 8 to 30 | approved spec 10 | yes |
| M2 EX | stun ticks | 45 (0.75 s) | 30 to 120 | rules 4.1 | yes |
| M2 EX | fuse plus duration against cooldown | 46 ticks against 300 | below the cooldown | rules 2.7 | yes |
| SPACE | haste percent | 30 | 20 to 50 | rules 4.1 | yes |
| SPACE | haste ticks | 90 (1.5 s) | 60 to 240 | rules 4.1 | yes |
| Q | projectile speed | 12 m/s | 12 to 25 m/s | approved spec 10 | yes |
| Q | projectile radius | 0.5 m | 0.2 to 0.6 m | approved spec 10 | yes |
| Q | damage on hit | 9 | 8 to 30 | approved spec 10 | yes |
| Q, end area, per pulse | damage | 8 | 8 to 30 | approved spec 10 | yes |
| Q, end area | total over 3 pulses | 24 (8 times 3) | 8 to 30 | roster-v2 §0 | yes |
| Q, end area, each pulse | slow percent | 30 | 20 to 60 | rules 4.1 | yes |
| Q, end area, each pulse | slow ticks | 60 (1 s) | 60 to 180 | rules 4.1 | yes |
| Q, end area | duration against cooldown | 90 ticks against 600 | below the cooldown | roster-v2 §0 | yes |
| Q, end area | stun, root or silence on a pulse | none | none on a pulsing area | roster-v2 §0 | yes |
| E | projectile speed | 18 m/s | 12 to 25 m/s | approved spec 10 | yes |
| E | projectile radius | 0.4 m | 0.2 to 0.6 m | approved spec 10 | yes |
| E | damage | 18 | 8 to 30 | approved spec 10 | yes |
| E | knockback distance | 2 m | 1 to 4 m | rules 4.1 | yes |
| E | knockback ticks | 8 | 6 to 15 | rules 4.1 | yes |
| E EX, end area | damage | 14 | 8 to 30 | approved spec 10 | yes |
| E EX, end area | radius, one hit | 2 m, `durationTicks` 1 | areas are tuning | roster-v1 §0 | yes |
| E EX | `endArea` with `pierce` | no `pierce` | no `endArea` on a piercing projectile | v3 spec 4.3 | yes |
| R | shield absorb | 30 | 20 to 60 | rules 4.1 | yes |
| R | shield ticks | 240 (4 s) | 180 to 360 | rules 4.1 | yes |
| R, area | knockback distance | 2.5 m | 1 to 4 m | rules 4.1 | yes |
| R, area | knockback ticks | 10 | 6 to 15 | rules 4.1 | yes |
| F | area radius | 3.5 m | areas are tuning | roster-v1 §0 | yes |
| F | damage | 55 | 8 to 60 | approved spec 10 | yes |
| F | fuse | 90 ticks (1.5 s) | 15 to 120 ticks | rules 2.7 | yes |
| F | fuse plus duration against cooldown | 91 ticks against 600 | below the cooldown | rules 2.7 | yes |
| F | stun ticks | 60 (1.0 s) | 30 to 120 | rules 4.1 | yes |
| F | duration against cooldown | 1 tick against 600 | below the cooldown | roster-v2 §0 | yes |
| EX | EX variants | 2, on M2 and E | exactly 2, never F | approved spec 4.6, roster-v1 §0 | yes |
| EX | EX cost | 25 energy | 25 energy | approved spec 10 | yes |
| F | ultimate cost | 100 energy | 100 energy | approved spec 10 | yes |
| all | `energyGain` effects | none | none | roster-v2 §0 | yes |

The numbers with no range are tuning values per roster-v1 section 0: the
cooldowns, the windups, the lifetime of a projectile, the radius and the
duration of an area, the length of a fuse chosen inside the catalog, and the
distance of a dash.

**Model.** Cue: two star motes, two boxes in the body material, so the accent
still marks only the front. Each is a cube of 0.12 m turned 45 degrees about Z,
so from the 55 degree camera it shows as a diamond, and both ride `Spine`, so
the `Attack` yaw and the `Hit` lean carry them. One is front-left at (0.08,
0.34, 1.74) and one back-right at (-0.08, -0.34, 1.62): a mote on each side of
the head, one high and one low. Both stay inside the 0.5 m ground radius, at
0.4323 m. The pose tables stay shared, with no per-champion pose. With the head
piece below, the model's top is the front-left mote's 1.8000 m at rest, and the
clip tops are 1.8096 m (Idle), 1.8222 m (Run), 1.8000 m (Attack), 1.8093 m
(Cast), 1.8150 m (Hit) and 1.8281 m (Death), all under 1.90 m, with every clip's
low at 0.0000 m. The lowest new vertex is the crown's back point at key 30 of
`Death` (on the back, `Hips` at -85 degrees and -0.64 m), 16.7 mm above the
floor, and the motes stay at least 62 mm up in every clip. The model is 648
vertices, 312 triangles and 42 036 bytes, and four builds are byte-identical.

Body colour: night blue, linear (0.000, 0.060, 0.165), about `#004571`. In 8-bit
sRGB b minus g is 44, one under the overlay cap of 45, so the overlay rule
holds (`overlay None`). The distances to the bodies are Skerrow 83.5, Quillon
83.5, Ondrel 113.7, Durnhal 172.7, the placeholder 178.2, Wrenna 178.8, Hargrim
183.0, Lumeth 211.7 and Brimwick 251.6; to the client colours the dead grey
94.0, the energy orb 149.7, the ally bar 164.0, the ally projectile 222.8, the
enemy bar 257.4, the enemy projectile 265.0, the debug overlay 299.9, the
impact ring 295.6 and the hit flash 346.1; to the arena floor 177.9, the trim
220.8 and the accent 287.6. The HUD, result, menu and select colours are at
least 132.4 away (the four panels). Every pair is at least 83.5, so no
existing margin moves, and the pair with Skerrow and Quillon is the
second-tightest of the roster after Skerrow against the black panels at 83.1.
Violet and indigo break the b - g rule. Gold, silver and white sit within 80 of
the accent, the impact ring, the HUD energy colour, the hit flash or the trim,
so night blue is the only on-theme family that passes. Two on-theme colours
were measured and set aside: aqua `#00fed6`, nearest the ally bar and the ally
projectile, so an enemy Ysmeer would read as ally-coloured, and pale star
yellow `#ffffa0`, nearest the accent, so the visor would stop marking the
front.

The head piece is a star crown: three flat bars of 0.44 m by 0.08 m by 0.04 m on
`Spine` in the body material, all centred at (0, 0, 1.69) and turned 0, +60 and
-60 degrees about Z, which makes a six-point star with one point straight over
the visor. The top is 1.71 m and the bottom 1.67 m, so the crown sits above the
accent visor (which ends at 1.61 m) and the visor stays the front mark, and the
top is far under the 1.85 m rest bound. Treated alone, the crown's ground radius
is 0.2236 m, inside 0.5 m, so the model's 0.4323 m footprint is the motes'. The
bar length is the number the shared `Death` clip fixes: at key 30 the crown's
back point is 16.7 mm above the floor, and a 0.48 m bar would sink 3.3 mm. No
box corner coincides with another box or with the body, and only Z turns are
used.
