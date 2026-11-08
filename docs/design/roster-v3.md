# Roster v3: champions seven to nine

Status: in progress; Durnhal's section is written, his kit is data and his
model is built, and Wrenna's section is written and her model is built (her
kit and counter come in her own series); Ysmeer's comes in her series
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
- One section per champion. Durnhal's is section 1 and Wrenna's is section 2.
  Ysmeer's section is added by its own series (roadmap issue
  [#176](https://github.com/sv-tmueller/claudeline-champions/issues/176),
  step 4.1), and the counter web over all nine and the range table come when
  the three are in (spec section 5.4). Wrenna's section already holds her own
  web line against the seven champions that exist and her own range row, so
  for Wrenna that closing step only adds her cell against Ysmeer. It does not
  cover Durnhal's line against Ondrel or his range row.
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

**Counter web (intent).** Beats Hargrim, Quillon, Brimwick and Durnhal. Loses
to Skerrow, Ondrel and Lumeth. Her record over the seven champions that exist
is 4 wins and 3 losses, and Ysmeer's section adds the ninth.

| | Hargrim | Quillon | Lumeth | Skerrow | Ondrel | Brimwick | Durnhal |
|---|---|---|---|---|---|---|---|
| Wrenna | beats | beats | loses | loses | loses | beats | beats |

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
- **Spend (later):** the two verbs are their own package (v3 spec section
  4.4b, step 3.2). `consumeCounter` is a top-level effect with `{
  bonusDamagePerStack: 4 }` on Heartseeker and with `{ cooldownTicksPerStack:
  120, slot: 'SPACE' }` on Fade Step. It spends the whole counter on the tick
  the cast fires and does nothing at 0, so Fade Step with no Focus is a plain
  shield of 25. 120 ticks per stack is 2 s, so 3 stacks cut 360 of Tumble's
  540 ticks, and a cooldown never goes below 0. The damage range applies to
  the total: 16 + 4 times 3 is 28, under 30.

**Kit data (not built yet).** `data/kits/wrenna.json` is step 3.3 of the build
order, after the on-hit counter (step 3.1, #227) and the spend verbs (step
3.2). This section fixes the numbers it will use. The conversions are ticks =
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
the same change. Wrenna joins the balance harness in the last step of her
series (v3 spec section 9.3).

**Range table.** The intended range of this section, in the shape of
[roster v2](roster-v2.md) section 1. The table over all nine comes when
Ysmeer's section is in.

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
