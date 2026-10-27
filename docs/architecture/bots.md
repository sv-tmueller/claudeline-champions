# Bots

`packages/bots`. Source: spec section 6. Bots import `sim` only. See
[packages](packages.md).

## API

`createBot(playerId, difficulty, seed) -> { think(state: GameState): PlayerInput; inspect(): { intent, targetId } }`.
Bots run inside the same process as the sim (browser locally, server online).
They read the full state; fairness comes from difficulty tiers, not hidden
information.

- `think` returns the bot's own `PlayerInput` record and the bot's next `think`
  overwrites every field of it (the dead and idle paths too). A caller that keeps
  an input past the next think copies it; `step` already does, since it reads the
  record and keeps no reference to it. Two bots never share a record.
- Call `think` once per tick, before `step`; it never mutates the state or
  touches `state.rng`. A champion with a kit in `state.kits` presses at most one
  slot per think, plus SHIFT for an EX variant (see Casting). A champion without
  a kit never presses: `buttons` is 0. Casting needs the kits passed to
  `createMatch`.
- `inspect()` is read-only and returns a fresh copy of the intent and target the
  bot is acting on. It exists so tests and dev tools can observe decisions. It
  allocates by design and is not on the frame path.
- `createBot` throws `Error('Invalid bot: ...')` for a `playerId` that is not a
  non-negative integer, a `difficulty` that is not an own key of the tier table,
  or a `seed` that is not an integer. `think` throws when the state has no
  champion `playerId`. A dead champion gets the neutral input with its stored
  aim.

## Navigation

A-star over a coarse grid (0.5 m cells) baked from the arena definition, plus
local steering to avoid champions and projectiles.

- Cells: a cell is blocked when its centre lies inside an obstacle inflated by
  the champion radius or outside the boundary shrunk by it. Touching counts as
  free, and so does a position within 1e-9 m of the edge (`TOUCH` in
  `geometry.ts`: the sim's collision push leaves a champion at the edge with
  rounding noise, one ulp inside was seen, and a champion that read as inside
  had no plan). Every obstacle blocks whatever its `blocksProjectiles` flag. A
  free cell can still lie partly inside an inflated obstacle, so every path
  edge also passes an exact segment test against the inflated obstacles and
  the boundary.
- Search: eight neighbours, no corner cutting, octile heuristic. The open set
  breaks ties by f, then h, then cell index, so a grid and two endpoints
  always give the same path, whatever the layout of the heap: the open set is
  three arrays (f, h, cell) with room for 8 entries a cell, and it throws when
  it is full. The tables, the closed set (stamped with the search's
  generation) and the open set are scratch shared by every bot and kept between
  searches (see Allocation), so a search allocates its path only. String
  pulling keeps the farthest waypoint still in line of walk.
- Arrival: a bot has reached a waypoint within 0.1 m, more than one tick of
  walking (about 0.092 m), so it always stops.
- Drift: eight-direction steering toward a far waypoint drifts up to about 10
  percent of the segment's length off the straight line. The path follower
  (`packages/bots/src/follow.ts`) caps it by splitting each segment into points
  at most one cell apart.
  - Following: the follower plans once, then walks the points in order and
    stops after the last one. It plans again when it has no plan, when the goal
    is more than one cell from the goal it planned for, when the segment to the
    next point is no longer clear, or when the plan is 30 ticks old. A moved
    goal and a blocked segment count only from 6 ticks of age on, so a
    shoved bot does not plan every tick. At most one plan per call. The bot
    controller starts a fresh follower when the acted intent, the target or the
    goal kind (target, spawn, sight cell) changes, and after a think that did
    not follow a path: the follower ages only when it is called, so without
    this a plan made before a run of kite steps would be walked stale.
  - Fallback: when the bot's own cell or the goal's cell is blocked (a legal
    position can lie in a blocked cell), the follower searches the cells within
    4 cells for the nearest free cell whose centre a clear segment reaches. Ties
    go to the lower cell index. A bot with no such cell stands and tries again
    on the next trigger. It never throws.
  - Local avoidance is not built yet. Being pushed by another champion is
    handled by planning again when the next segment is blocked.

## Decisions

Utility scoring over candidate intents: engage, kite, retreat, peel for an ally,
hold position, use the ultimate; dodging a predicted projectile is no intent but
an override of the move (see Dodge). Each
champion has a small bot profile with a preferred range. The kit does not ship
it: the bots derive the range from the kit data (see Profiles), and the openers
and
escapes are stateless slot conditions of the profile (see Openers and escapes).
The one
finisher is the rule under Finisher below; per-slot finishers are not built.

Built so far: engage, kite, retreat, plus idle, casting (see Casting), the
openers, escapes, dash hold and wait of a profile (see Openers and escapes) and
the advance of a retreating bot (see Deadlock) and the dodge (see Dodge). Idle
means no enemy is alive:
the bot stands and keeps its aim.

Target: the bot keeps its current target while it is alive, unless another
alive enemy is more than 1 m nearer. Otherwise the target is the nearest alive
enemy by centre distance; the scan runs in id order and a tie goes to the lower
id.

With `d` the distance to the target, `h` health over maximum health, and
`[rangeMin, rangeMax]` from the profile, scores are clamped to 0 to 1:

| Intent  | Score                                                | Movement                                                                                                                                                                                |
| ------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| engage  | 0.5                                                  | stand when `d <= rangeMax` and the target is in line of sight, or in the wait of the profile (see Openers and escapes), otherwise follow the path to the target                         |
| kite    | `rangeMin > 0 ? 0.6 + (rangeMin - d) / rangeMin : 0` | step away, leave a corner or regain line of sight, see Kite movement                                                                                                                    |
| retreat | `0.6 + (0.3 - h) / 0.3`                              | follow the path to the bot's own spawn point (slot = teammates with a lower id) and stand there, unless a finisher qualifies, see Finisher, or the deadlock rule advances, see Deadlock |

Hysteresis: the bot switches only when the best other intent scores more than
the current one plus 0.1. Ties go to retreat, then kite, then engage. This
makes kite start at `d < rangeMin` and end at `d > 1.2 rangeMin`, and retreat
start at `h < 0.3` and end at `h > 0.36`. After idle the next decision starts
again from engage.

Finisher: a bot that would choose retreat, or is retreating, does not retreat
while an alive enemy is within `rangeMax` of the profile, has a clear shot of
0.5 m (see Clear shot) and has a health fraction at or below the bot's own
(`health / maxHealth`, equal counts). The nearest such enemy, the lower id on a
tie, becomes the target, and the scores are taken against it with retreat at 0,
so the bot engages or kites it by the rules above and casts at it. Why: at low
health every champion of the kit headless run retreated to its spawn and the
match froze with no kill; a bot that can win the trade should take it. The rule
is a pure function of the state and draws no random number, and it runs inside
`decide`, so the reaction delay applies to it like to any decision. When no
enemy qualifies, retreat is as above. The engage or kite a finisher think
decides is what the next think reads as the current intent. After an engage
finisher, once that enemy leaves reach, the bot engages again instead of
resuming the retreat in the 0.30 to 0.36 band, and the retreat starts again
below 0.3. After a kite finisher the current intent is kite, which scores 0 once
the enemy is beyond `rangeMin`, so the retreat resumes while the retreat score
ties or beats engage (health up to about 0.33). The rule also runs for a bot
with no kit, which never presses: such a bot stands within `rangeMax` of a weak
enemy instead of retreating.

Deadlock: when every champion of a match is below 36 percent health, each one walks to its spawn
and stands there, nobody is in reach of anybody and the match never ends (the kit headless run of
#58 froze this way with health 3, 27, 26 and 13). A retreating bot therefore advances on its target
instead of walking to its spawn when both hold on the current state:

- no alive enemy is within `rangeMax` of the profile with a clear shot of 0.5 m (it is not in
  reach of anybody, the finisher test without the health filter);
- its team is not ahead: the sum of `health / maxHealth` over the alive champions of its team, the
  bot included, summed in id order, is at most the same sum over the alive enemies. Equal sums are
  not ahead, so on a tie both teams advance; the team that is ahead stays, so the leading team's
  low bot waits at its spawn by design.

The advance uses the sight logic of a kite beyond `rangeMin`, toward the acted target: it stands
while the target is within `rangeMax` with a clear shot (the cast logic is not tied to the intent,
so a standing bot casts), else walks to the nearest sight cell (see Kite movement), else along the
path to the target. The intent and the finisher rule do not change: the bot still retreats, and a
finisher still takes over when an enemy that qualifies comes into reach.

The advance is latched. Once begun it goes on, and the bot stands in reach to cast, until the acted
intent is not retreat, the acted target is another champion, the team gets ahead or the bot dies (a
bot revived at a new round starts afresh). Why: without a latch a bot behind on health, say a
Quillon against a Hargrim ahead and standing at its spawn, advances until the target is within
`rangeMax`, then the first rule no longer holds, so it steps back out of reach, and again, and its
cast run restarts on every other think and nothing ever lands. The latch is per bot state and is
rewritten in place, so the think stays allocation free.

A stand needs a clear shot of a champion's width, not only a line of sight: see
Clear shot. Wherever this document says a stand needs line of sight, it means
that.

Kite movement, from the acted intent, with `rangeMin` from the profile:

- Closer than `rangeMin`: the first of five points 1 m away (straight away, then
  45, -45, 90, -90 degrees) that lies in a free grid cell and is reached by a
  clear segment.
- Cornered, all five points failing: the bot follows the path to its own spawn,
  as retreat does. Once it has started, it keeps walking that path while it is
  closer than `rangeMin` and the path gives a move; the five points are not
  tried again meanwhile. Trying them on every think made the bot alternate
  between one step along the wall and the step back into the corner, so it
  never left. At the spawn, or when no path exists, it stands for one think and
  then tries the five points again. The escape has no progress bound until local
  avoidance exists: a champion standing on the route, or within 0.9 m of the
  spawn cell centre, keeps the bot pushing with a non-zero input and no kite
  retry for as long as the chaser stays inside `rangeMin`.
- At `rangeMin` or farther: stand when the target is in clear shot. Without a
  clear shot the bot follows the path to the nearest sight cell: a free cell
  within 8 cells (4 m) of the bot, not the bot's own, whose centre has a clear
  shot of 0.5 m at a distance in `[rangeMin, rangeMax]`. Ties go to the smaller
  squared
  distance from the bot, then the lower cell index. With no such cell it follows
  the path to the target, which ends in line of sight.
  - No randomness in the step itself. The bot's rng has the aim draw and the
  dodge's coin (see Dodge) and no other use.

Profiles live in `packages/bots/src/profile.ts`, keyed by champion id:
`profileFor(championId, kit?)`. Without a kit the table applies. Hargrim, Quillon,
Skerrow, Lumeth, Ondrel and Brimwick have a rule: with a kit whose id equals the
champion id, `rangeMax` is the top of the base M1 reach band minus the 1 m range
margin (see Casting), and `rangeMin` is the rule's literal, because no kit field
holds it: roster-v1 words it as backing away from an enemy inside 6 m (Hargrim
and Skerrow never kite, 0), and roster-v2 as 5 m for Ondrel and 7 m for Brimwick.
The table applies instead when the champion has no rule, there is no kit or the
kit id differs, M1 has no band, or the derived `rangeMax` is at most 1 or at most
`rangeMin`. Other ids keep the table even with a kit. Lumeth's M1 reaches 12 m,
so her `rangeMax` with her kit is 11; Ondrel's reaches 10 m (20 m/s for 30
ticks), so hers is 9, and Brimwick's 11 m (33 ticks), so hers is 10, the
roster's 9 and 10. `KitDef` has no profile field and `createMatch` copies only
the kit contract, so profiles stay in bots; the kit JSON must carry no bot
fields.

| Champion | rangeMin | rangeMax | rangeMax with a kit   | Note                                |
| -------- | -------- | -------- | --------------------- | ----------------------------------- |
| hargrim  | 0        | 3        | M1 band top minus 1 m | melee, never kites                  |
| quillon  | 6        | 13       | M1 band top minus 1 m | ranged, backs away inside 6 m       |
| lumeth   | 6        | 10       | M1 band top minus 1 m | support, keeps range, heals allies  |
| skerrow  | 0        | 2.5      | M1 band top minus 1 m | assassin, closes in and never kites |
| ondrel   | 5        | 9        | M1 band top minus 1 m | zone controller, kites inside 5 m   |
| brimwick | 7        | 10       | M1 band top minus 1 m | burst caster, kites inside 7 m      |
| default  | 4        | 8        | the table             | any other champion id               |

Every `rangeMax` exceeds 1 m, so a bot never needs to stand inside another
champion. With the test kits Hargrim stands at 2 m and Quillon at 13 m; Skerrow
of the shipped kit (an arc of 2 m, band top 2.5 m) stands at 1.5 m.

The rule table of the profile (`RULES` in profile.ts, applied under the same
condition as `KIT_RULES`: a kit of the champion's own id) adds what no kit field
holds. Roster-v1's bot profile sketches are its source, and for Ondrel and
Brimwick roster-v2's (sections 2 and 3); see Openers and escapes for what each
row means. A row also has `escapeWithin`: null for Hargrim, Quillon, Skerrow,
Ondrel and Brimwick, who keep the common escape trigger, and 3 for Lumeth, whose
trigger is her own; and `allies`, the slots the champion presses at an ally
(Lumeth's F, R, M2 and M1, the others none: see Ally slots under Casting).

| Champion | Openers                                                                                                                                               | Escapes                                                 | Ultimate F                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------- |
| hargrim  | SPACE (Rush, the dash band); E (Chain Hook), 4 to 7 m, target walking away                                                                            | R (Iron Hide)                                           | pressed in reach                  |
| quillon  | Q (Snare Orb), kit band, target walking toward her                                                                                                    | SPACE (Skip), then R (Hush Ward)                        | pressed in reach                  |
| skerrow  | SPACE (Lunge, the dash band); Q (Quiet Dart), kit band, target with an escape ready; waits at 6 to 8 m while SPACE has 2 to 90 ticks of cooldown left | R (Vanish Step)                                         | held for a low or cornered target |
| lumeth   | Q (Binding Sigil), kit band, target within 6 m of an ally                                                                                             | E (Lantern Burst), then SPACE (Glide), on a 3 m trigger | allies only, see Ally slots       |
| ondrel   | E (Undertow), kit band, target walking away                                                                                                           | SPACE (Reed Step), then R (Reed Screen)                 | pressed in reach                  |
| brimwick | Q (Flash Powder), kit band, target walking toward her                                                                                                 | SPACE (Flare Step), then R (Smoke Pot)                  | held for a low or cornered target |
| other    | none                                                                                                                                                  | none                                                    | pressed in reach                  |

### Dodge

`packages/bots/src/dodge.ts`. Dodging a predicted projectile is a movement
override of the acted intent, not a fourth scored intent (spec section 6,
amended on batch #134 decision 3): a scored intent would go through the delay
ring and be 30, 15 or 6 ticks late, longer than most bolts fly, and would
reset the follower with every dodge. It is decided on the current state after
`aim()`, on the acting path only (no dodge on an idle or a dead think), and it
rewrites `moveX` and `moveY` alone: the intent, the target, the follower, the
casts, the aim, `inspect()` and the `Intent` type stay as they were.

Threat. A projectile is a threat to the bot when, with the bot standing where
it is (its own move is not in the prediction):

- it is not of the bot's team, it is not an ally bolt with no effect on
  enemies (`allyEffects` and empty `effects`, Lumeth's M2, which passes the
  other team) and the bot's id is not in its `hitIds`;
- with `D` the vector from the bot to the projectile, `V` its velocity and
  `R` the champion radius plus the projectile's radius (the sim's reach),
  `c = D.D - R^2` is above 0 (a projectile already overlapping hits on the
  next sweep whatever the bot does) and `b = 2 D.V` is below 0 (it closes
  in), and `b^2 - 4 a c` is not negative, with `a = V.V`;
- the contact time is `t = 2c / (-b + sqrt(b^2 - 4ac))`, the stable root, as
  the aim's lead takes it, and the hit sweep `ceil(60 t)` is at most the
  projectile's `remainingTicks` (champions move before the sweep, and
  `remainingTicks` counts the next one);
- `lineOfSight` holds from the projectile to its point of contact
  (`P + V t`). That is the centre line standing in for the swept circle, as
  Clear shot does for a shot: it may dodge a bolt that a pillar's edge would
  stop, and never misses a hit.

Reaction and the coin. The first think a projectile is a threat, the bot
writes it into a memo: eight entries of projectile id, the think count and
the coin (typed arrays, a ring that replaces the oldest entry). Once
`castDelay` thinks (15, 8, 3: which Difficulty already reads as a
reaction delay) have passed since that think and the hit is still predicted,
one coin is drawn for the projectile, kept in the memo and never drawn again:
a yes when it is under the tier's `dodgeChance` (0.25, 0.5, 0.75). A draw on
every threatened think would compound the chance over the thinks a bolt stays
a threat and shift the aim's stream on every one of them. The think count
counts the thinks that reach the dodge, so a reaction counts acting thinks.
The memo is cleared when the kit cache rebuilds, as the held ally is.

The step. Among the threats whose coin is a yes, the one that hits first, the
lower index on a tie, is dodged: one metre along the perpendicular
`(-vy, vx) / |V|` of its velocity, to the side the bot is already on (`(me -
P).n >= 0`, so the centre line itself takes +), else to the other side. A
side's point must lie in a free grid cell and be reached by a clear segment,
the two tests of the kite step; the move is `steerTowardInto` toward it. With
neither side free there is no override and the bot moves as its intent says.
The step is taken on every think while the hit is still predicted, so the bot
walks out of the lane and stops dodging once the prediction clears.

The rng. The bot's generator has two uses now: the aim error draw, and the
coin. Within a think the aim draw comes first (when the error is redrawn), then
the coins in projectile index order. The coin is mulberry32 written out in
`dodgeInto` over the same `Uint32Array` state, operation for operation, as the
draw in `aim` is (see Allocation). Nothing else draws.

What it does not do: it does not look at champions (a dodge may walk into one;
local avoidance stays unbuilt), it does not weigh the cost of leaving a stand,
and it does not dodge areas.

## Clear shot

`clearShot(state, from, to, c)` in `packages/bots/src/sight.ts`: the sim's
`hasLineOfSight` along the centre segment and along two segments shifted
sideways by `c`, one each side, so a shot of radius `c` fits. A zero-length shot
has only the centre segment. It is a pure function of the state and draws no
random number. Why: a position on the edge of an obstacle's shadow has a line of
sight, but every bolt with the smallest aim error hits the obstacle. Without the
test both Quillons of the kit headless run stood on the edge of the pillar's
shadow and never landed a bolt again. Three lines are a stand-in for the swept
circle of the sim, and a shot can still clip in two cases: an obstacle narrower
than `c` that lies between two of the three lines (a post of radius under `c` / 2,
or a thin wall parallel to the shot), and a flight line that the lead or the aim
error (up to 12 degrees on easy) moves off the centre-to-centre segment.

- A cast uses `c` = the radius of the first top-level projectile of the ability it
  would press, or the champion radius 0.5 m when the ability has none, with one exception: a
  press whose ability's first top-level effect is a `meleeArc` gets no clear-shot test at all
  (#186). The sim's arc ignores obstacles (`melee.ts`, and "A melee arc ignores obstacles" in
  simulation.md), so the bot presses what the sim lands, as a human does. Why: the test is for
  what an obstacle stops, and the reason above, a bolt that hits the obstacle at the smallest
  aim error, does not hold for an arc. The exception reads the first effect only: an arc after a
  dash (the EX Lunge, whose dash stops at an obstacle) or after a teleport (Reaper's Dance, whose
  teleport needs a line of sight, `motion.ts`) keeps the 0.5 m test, and so does every area
  (Hargrim's Shockwave, though the sim places an area through an obstacle too: the rule names the
  arc). The four melee presses are Hargrim M1, Skerrow M1, Rend (Skerrow E) and its EX variant;
  the cache holds the flag beside the dash flag (`baseMelee`, `exMelee`), and the press oracle of
  the tests keeps the same set (`MELEE`), which a table test works out again from the kit files.
  If the sim's choice about obstacles ever changes, this exception goes with it.
- A stand (engage, kite), the sight-cell search and the finisher use `c` = 0.5 m, with one
  exception: a bot that could press F now stands, and searches for a sight cell, with `c` = the
  width of F's shot when that is wider than 0.5 m (`sight.standClearance`, a double field that
  starts at 0.5). "Could press F now" is the reserve test of Casting plus the full 100 energy.
  Why: a wide ultimate (Quillon's 0.6 m) waited behind cover that a 0.5 m shot clears and never
  cast; a Quillon at 100 energy stood on the edge of the pillar's shadow. The finisher, the
  reach test of the deadlock rule and the tests' stall oracle keep 0.5 m, and every other think
  of a kit whose F is wider changes nothing. These checks keep 0.5 m for a melee kit too (#186):
  they decide where a bot stands or whom it fights, not whether a press lands.

## Casting

`packages/bots/src/casting.ts` (not `cast.ts`: the sim has one) and
`packages/bots/src/reach.ts`. The bot finds its kit in `state.kits` by champion id
on every think and derives from it, once, what it needs (see Allocation): the reach
band and the shot width of each slot's base ability and EX variant, and the profile.
It keeps that cache for as long as the kit found is the same object and the champion
id is the same, and rebuilds it otherwise.

Reach band of an ability, from kit data (`abilityReach`), with `CR` the champion
radius 0.5 and `offset` starting at 0 along the top-level effects:

| Effect                           | Band                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `projectile`                     | `[0, offset + speed * lifetimeTicks / 60]`, multiplied first; none when `effects` is empty |
| `meleeArc`                       | `[0, offset + radius + CR]`                                                                |
| `area` on enemies or all, `self` | `[0, offset + radius + CR]`                                                                |
| `area` `ahead d`                 | `[offset > 0 ? 0 : max(0, d - radius - CR), offset + d + radius + CR]`                     |
| `area` `aim R`                   | `[0, offset + R + radius + CR]`                                                            |
| `area` on allies                 | none                                                                                       |
| `dash D`                         | for its `then` effects, `[0, offset + D + b.max]`: a dash stops at the first body it hits  |
| `teleport R`                     | none; adds R to `offset` for the effects after it                                          |
| `applyStatus`, `shield`, `heal`  | none (they land on the caster)                                                             |

The band of an ability is the hull of its effects' bands, null when no effect has
one. A target is in reach when `band.min <= d <= band.max - RANGE_MARGIN`, both
ends inclusive, with `d` the centre distance and `RANGE_MARGIN` 1 m: a target
walking away at 5.5 m/s gains 0.825 m during a 9 tick windup.

Gates, copied from steps 3b to 3d of the sim's `step` and read on the state the
bot thinks on. Step 3b counts cooldowns down, step 3c fires a windup at 1, then
step 3d tries a new cast. For each slot, with the ability it would cast:

- the bot is alive, the acted intent is not idle and the acted target is an alive enemy;
- windup: none in progress, or `windupLeft` is 1;
- cooldown at most 1 (a 30 tick slot casts on ticks 0, 30 and 60);
- energy: F needs 100, an EX variant 25, otherwise 0;
- no `stun` and no `silence` (silence includes SPACE); under `root` an ability with
  a top-level `dash` is skipped;
- on an escape think no ability that starts with a dash: the dash hold, below;
- in reach, with a clear shot (see Clear shot) of the width of that ability (none for a melee
  arc), and the slot's condition if its opener rule has one (see Openers and escapes);
- the cast delay, below.

Order and variants: on an escape think (see Openers and escapes) the escape slots of the
profile go first, in the order of the rule; otherwise, and after them, the bot presses the first
slot in F, R, E, Q, SPACE, M2, M1 that passes, one slot per think, skipping the slots the escape
choice already tried. A slot listed in `kit.ex` casts its EX variant
(buttons plus SHIFT) when the energy is at least 25, the variant has a band and F
is not holding the energy back; otherwise it casts its base ability without
SHIFT. F always casts its base ability and is never sent with SHIFT.

Energy reserve: F holds the energy back while F is ready (its cooldown is at
most 1, as the cast gate reads it), its base ability has a reach band, the
energy is at least 75, which is the 100 that F costs less the 25 of one EX
press, the acted target is within F's reach (its band less the margin) and F's
own condition holds (always, unless the profile holds F, see Openers and
escapes). The EX variants are then not cast, and the band and the shot width the
slot is tested with are those of its base ability, so a slot whose base reach is
shorter than its EX reach waits for the target to come in. Why: greedy EX
spending kept the energy of the kit headless run under 66, so the ultimate never
fired. Only an ultimate with a band holds the reserve: a support ultimate that
reaches allies only (no band) would otherwise keep every EX variant held for
good at 75 energy or more (Lumeth's Dawnbloom, whose slow on enemies is no band:
see Ally slots). The reach clause lets a bot at 75 energy or more spend EX while
no enemy is in F's reach, and the condition clause lets a Skerrow do the same
while no target is low or cornered. For the shipped Hargrim and Quillon every EX
band top lies below F's, so the reach clause only changes a press where the
target is beyond F's reach.

Cast delay: per slot, a run counts the consecutive thinks, this one included, on
which the target was in reach with a clear shot of the ability the slot would
cast (and the slot's condition held). On an escape think the escape slots are
gated on the escape streak instead, one run for the whole order (see Openers and
escapes), and their own runs go on counting the trigger, with no band and no
shot test: one cast-delay rule for every press. The slot may be pressed when the
run exceeds `castDelay`, so `castDelay` thinks after the first think of the run.
The run restarts when the test fails, on an idle or dead think, and when the
acted target changes. It ignores cooldown, energy, status and windup, so a slot
that comes off cooldown while the target stays in reach is pressed on the first
tick the sim would cast it. The run of an ally slot is the one of Ally slots
below.

Ally slots: a champion's rule lists the slots it presses at an ally (`allies` in
`RULES`; Lumeth's F, R, M2 and M1, the others none). The kit cache holds a kind,
a reach, a need and a shot width for each slot of the list and for no other, so
Hargrim's Rally Cry, an area on allies that he places on himself, is no ally
slot. The numbers come from the kit once, on a rebuild:

| Slot                | Kind            | Reach, less the 1 m margin | Need | Shot width |
| ------------------- | --------------- | -------------------------- | ---- | ---------- |
| M1 (Mend Bolt)      | bolt            | 12 - 1 = 11 m              | 10   | 0.35 m     |
| M2 (Soothing Surge) | bolt            | 10.133 - 1 = 9.133 m       | 14   | 0.5 m      |
| R (Aegis Veil)      | area on herself | 5.5 - 1 = 4.5 m            | 30   | none       |
| F (Dawnbloom)       | area on herself | 5.5 - 1 = 4.5 m            | 30   | none       |

- Kind 1 is a projectile with `allyEffects`: a bolt, which never hits its owner
  in flight and is never pressed at herself: bots do not self-cast (a bolt aimed
  at herself would land on her at 60 percent heal, the sim's self-cast rule).
  Kind 2 is an area on allies placed on self,
  which includes the caster. The reach is the bolt's speed times its lifetime
  over 60, or the area's radius plus 0.5.
- Hurt means missing at least what the slot gives (decision 1 of batch #105):
  the sum of the `heal` amounts of what it does to allies, else its shield's
  absorb. There is no overheal, and M1 keeps damaging enemies when no ally
  needs it.
- A scan per ally slot runs in `updateRuns`, over the champions in id order:
  alive, on her team, not herself for a bolt, missing at least the need, within
  the reach less the margin, and for a bolt with a clear shot of the bolt's
  width (`clearShotWith`, the test of every cast). The lowest health fraction
  wins, and a tie goes to the lower id, because the comparison is strict. The
  id is a cue, `allyFor`, an Int32 per slot (-1 for none), so no object is made
  and no double crosses a call.
- A slot's run counts while some ally qualifies, whoever it is: switching to
  another ally does not restart it. A change of the acted enemy restarts it, as
  for every slot. M1 with no ally in need runs on its enemy band as before (the
  kit band less the margin, a clear shot of 0.35), so M1 goes to an ally first
  and to an enemy when none needs it.
- An area ally slot (kind 2) has no enemy band: Dawnbloom's slow on enemies is
  no reason to press it, so the cache sets its `hasBase` to 0, and the energy
  reserve reads no band for it, which is the support ultimate that reaches
  allies only. A projectile ally slot (kind 1, M1) keeps its band.
- Ally presses still need an alive acted enemy, so she never heals on an idle
  think. A press at an ally aims at the ally (see Aim), except R and F, which
  keep the acted enemy as the aim point. The EX variants of M2 and R have no
  enemy band and no ally row: they are never pressed.

Never pressed: an ability with no band that no rule presses (an ally ability no
rule lists: Hargrim Q, and the EX variants of Lumeth's M2 and R), and any slot
of a champion without a kit. The rules press three kinds of slot that have no
band: the base dash opener (Hargrim SPACE, Skerrow SPACE: its band is derived
from the dash), the escape slots (Hargrim R, Quillon SPACE and R, Skerrow R,
Lumeth E and SPACE, Ondrel SPACE and R, Brimwick SPACE and R, on an escape think
only), and the ally slots (Lumeth M2, R and F, at an ally that needs them). On
an escape think the dash openers are not pressed either (see the dash hold under
Openers and escapes). Not every escape slot is without a band: Lumeth's E,
Ondrel's SPACE and R and Brimwick's R reach an enemy with an area around them
(Reed Step's 1 m, Reed Screen's 2.5 m and Smoke Pot's 3 m, each the kit band less
the margin), so the walk presses them on that band too, and on an escape think
the escape choice comes first. Flare Step has no band: a teleport reaches nobody.

## Openers and escapes

Openers and escapes are stateless slot conditions of a champion's rule (`RULES` in
`packages/bots/src/profile.ts`, see Profiles), read from the kit once into the kit cache and
tested on every think. They add no state to the bot and no random draw, and a think still presses
at most one slot. A champion with no rule, no kit or a kit of another id has none.

Openers: a slot with an opener rule is pressed on a condition narrower than its kit band.

- Band: a literal pair in metres, inclusive and with no range margin; or, for a base ability
  that has no band of its own and whose first effect is a dash of distance D, the band [D - 1, D]
  derived from the kit (`dashBand`): its windup is 0, so the target cannot walk out of reach before
  it fires, and at D the dash ends against the target's body. That gives Hargrim's Rush [4, 5],
  the roster's numbers, and Skerrow's Lunge [5, 6]; the roster's 6 to 8 m for
  Skerrow is where she waits for the opening, see the wait below. An EX variant
  keeps its kit band, and an EX press has no opener condition.
- Motion: a target walking away has `dot > 0`, one closing in `dot < 0`, with
  `dot = (target - bot) . (target velocity)` from the state, worked out once per think. A target
  that stands or walks across is neither, so `>` and `<` are strict.
- Hargrim E (Chain Hook) is the roster's 4 to 7 m, inside the kit band less the margin (0 to 8 m),
  and only while the target walks away: it restricts the press, where a condition that only added
  presses would change nothing. Quillon Q (Snare Orb) keeps its kit band less the margin and needs
  a target walking toward her; otherwise she goes on to M2.
- Quiet Dart (Skerrow Q) keeps its kit band less the margin and needs a target
  with an escape ready (the roster: "Q first if the target has an escape
  ready"): one of the escapes of the target's own rule (`rulesFor` with the kit
  of its champion id) has a cooldown of at most 1, and the target is neither
  stunned nor silenced. The target's rule decides, so a Quillon counts Skip and
  Hush Ward, a Hargrim Iron Hide, a Lumeth Lantern Burst or Glide, and a
  champion with no rule (any champion without a kit, a kitless Lumeth included)
  never has one: Skerrow goes on to M2 there. It
  restricts the press the way Chain Hook's motion test restricts E, and it is
  worked out once per think into a cue, only for a champion that has such an
  opener. The point is the silence: Quiet Dart is what stops Skip and Hush Ward
  from being pressed, and at a target with nothing to stop it is only a slower
  M2.
- Binding Sigil (Lumeth Q) keeps its kit band less the margin and needs the
  acted target within 6 m, inclusive (`NEAR_ALLY`), of an alive ally of hers,
  herself not counted (the roster: "Q on a target inside 6 m of an ally"). The
  ally scan is a loop over the champions in `computeCues`, done once per think
  into a cue and only for a champion that has such an opener; it allocates
  nothing. With no ally alive she never presses Q.
- Undertow (Ondrel E) keeps its kit band less the margin (0 to 7 m: a bolt of 16
  m/s for 30 ticks reaches 8 m) and needs a target walking away: the bolt drags
  the target 3 m back into her zones (roster-v2, section 2). The EX variant keeps
  its band and, as every EX press, has no condition. At a target that stands or
  closes in she goes on to M2 (the Mire).
- Flash Powder (Brimwick Q) keeps its kit band less the margin (0 to 9 m: 24 m/s
  for 25 ticks reaches 10 m) and needs a target walking toward her, the one it
  stuns as it walks in (roster-v2, section 3); at a target that walks away or
  stands she goes on to M2 (Firecracker).
- The condition is part of the cast-delay run, so the delay counts from the moment it holds, as it
  does for reach, and the run restarts when it stops holding.
- With the reserve holding the EX variants, an opener is the base ability: Hargrim at 80 energy
  with F ready presses base Rush at 4.5 m, with no SHIFT.
- The shot test of a dash opener sees only the obstacles that block projectiles, so a low wall in
  the way can stop a Lunge that would be blocked in the sim; the EX dashes already work this way.

The wait: an engaging Skerrow stands, instead of walking in, while the target is
6 to 8 m away (both ends inclusive), the stand has a clear shot (the stand's
own, see Clear shot) and her SPACE has 2 to 90 ticks of cooldown left (the
`wait` field of her row: band [6, 8], slot SPACE, at most 90 ticks). At a
cooldown of 1 or 0 Lunge is ready and she closes to its band of 5 to 6 m; past
90 it is too far off to wait for. Why bounded (decision 3 of batch #91): a stand
of the whole 360 tick cooldown, 6 s under fire, just makes her a target, and 90
ticks stays inside the stall bound of 120. She casts from the stand like any
engaging bot, so Quiet Dart and M2 come from there. It is a slot condition of
the profile read from the kit cache's typed arrays (`waitsFor` in casting.ts,
which takes the distance as a measure, not a number), with no bot state, and the
stall tracker's oracle knows the stand in its own code.

Escapes: a retreat, or a kite inside the minimum range, presses an escape slot.

- An escape think is a think whose acted intent is retreat with the acted target within
  `ESCAPE_RANGE` = 6 m, inclusive, or kite with the acted target closer than `rangeMin`. One
  trigger serves Hargrim, Quillon, Skerrow, Ondrel and Brimwick (their `rangeMin`
  is 0, 6, 0, 5 and 7; roster-v2 words the trigger of the last two as the common
  one). For Skerrow it is decision 6 of batch #80: the roster words her escape as
  "health below 50 percent", which would vanish her in the middle of an engage and walk her
  straight back in; a retreat starts below 30 percent health, unless a finisher qualifies (then
  the acted intent is engage or kite, and no escape think starts from the retreat).
- Lumeth's trigger is her own (the `escapeWithin` field of her row, 3 m): any
  acted intent but idle, with the acted target within 3 m, inclusive. The roster
  words it as "an enemy inside 3 m". A kite inside her `rangeMin` of 6 m or a
  retreat within 6 m is no escape think for her unless the target is that close,
  so a kite at 5 m presses neither Lantern Burst nor Glide. Any intent counts
  because a dive can land inside her reaction delay (decision 1 of batch #105).
  The field is a Float64Array of the kit cache, -1 for the common trigger.
- On an escape think the escape slots count the trigger, with no band and no shot test, and
  `chooseEscape` (escape.ts) tries the slots of the rule in order before the usual order: Hargrim
  R; Quillon SPACE, then R; Skerrow R; Lumeth E, then SPACE; Ondrel SPACE, then R; Brimwick
  SPACE, then R. "SPACE, then R" is a priority order, not a sequence: the
  first slot that passes the gates is pressed, and Hush Ward is pressed only when Skip is on
  cooldown, has no landing or is otherwise refused. The gates are the cast gates of Casting
  (windup, cooldown at most 1, stun or silence, root with a dash, the run over the cast delay). The
  slots it tried are skipped in the usual walk, so a teleport that found no landing is not pressed
  there.
- One trigger run for the whole order (#165). The run over the cast delay is the escape streak,
  the number of consecutive escape thinks, this one included (`EscapeScratch.streak`, an integer
  that `think` sets after `computeCues` and zeroes with the runs: on a dead think and when the
  acted target changes), and every escape slot is gated on it. It is not the slot's own run:
  for a slot with a band that run also carries the ordinary band run (Ondrel's Reed Screen has a
  band of 0 to 2.5 m, Brimwick's Smoke Pot 0 to 3 m), which arrives at the first escape think of
  a streak with a head start, so Reed Screen was pressed ahead of Reed Step, against roster-v2's
  "SPACE, then R" (found by the press oracle: 2 of 16 cells red on the seeds 101 to 104, "ondrel:R
  pressed with SPACE ready", ticks 4000 and 2871 on arena02, the target at 1.1 m). For the four
  kits before them the two readings are the same (an escape slot has no band, or Lumeth's E has
  one inside her 3 m trigger), and the 16 rows of the identity harness are unchanged. The rule
  it leaves: on the first thinks of a streak no escape slot is pressed, and the first press is at
  the think the streak passes the cast delay, whatever band run a slot carried in.
- A slot whose first effect is a teleport needs a landing. The bot tries the five kite directions
  from the acted target (straight away, then +45, -45, +90, -90 degrees, the constants of the kite
  step) and takes the first whose landing lies in a free grid cell and has a line of sight from the
  bot. The landing is the aim point `range` metres off in whole centimetres, worked out with the
  sim's own arithmetic (see Determinism), and it is that raw point whose cell must be free: a raw
  point in a blocked cell is skipped even where the sim would push its teleport clear of the wall
  (the press oracle tests the same raw point, decision 16 of batch #105), while a point in a free
  cell may still land within 0.5 m of a wall or on a champion, where the sim pushes the champion out
  after the teleport; the reach is the full range for a fixed teleport and
  `min(range, aim distance)` otherwise (Skip is 4 m and fixed, Vanish Step 5 m and Flare Step 6 m
  and not: the bot aims the whole range straight away, so the aim distance is the range). The line
  of sight is the one of Clear shot's `lineOfSight`: it sees only obstacles that block
  projectiles, as the sim's teleport does, so a teleport may cross a low wall. When no direction
  passes the slot is skipped and R comes next: a Quillon boxed in a corner shields herself, an
  Ondrel or a Brimwick raises Reed Screen or Smoke Pot.
- A slot whose first effect is a dash (Lumeth's Glide, a dash of 4 m; Ondrel's Reed
  Step, a dash of 4.5 m with a slowing area around her at the point she leaves) needs a
  landing too: the end of the dash, which goes its whole distance along the aim
  (the same arithmetic as a fixed teleport, so `landingInto` gives it with the
  dash distance as the range). The same five directions are tried in the same
  order, and the first whose end cell is free and whose straight path is clear
  (`segmentClear`, not the line of sight: a dash collides with low walls, which
  a teleport crosses) is taken, and the press is aimed at it. A body stops a
  dash early and the search ignores champions. Boxed in, Glide is skipped and
  the walk goes on. A root skips it, as every dash. The kit cache flags it per
  slot (`escapeDash`). It comes after Lantern Burst: Glide is pressed only when
  E is refused. Reed Step comes first in Ondrel's order, ahead of Reed Screen.
- The dash hold: on an escape think no slot whose ability starts with a dash is
  pressed, base or EX variant (the one that would be cast), for every kit:
  Hargrim's Rush, EX Rush and ultimate, and Skerrow's Lunge and EX Lunge. A dash
  carries the bot along its aim, toward the target it is leaving: a cornered
  Skerrow with Vanish Step cooling down used to Lunge into the Hargrim she was
  fleeing, and Rush did the same. The kit cache holds a flag per slot for each
  (`baseDash`, `exDash`), and the gate is in `chooseCast`. Glide is an escape
  slot that starts with a dash: `chooseEscape` marks it tried and aims it away
  from the target (see the landing above), so the hold never reaches it, and it
  has no band, so nothing else presses it. Reed Step is the second: on an escape
  think `chooseEscape` marks it tried the same way, so the walk skips it before
  the hold; off one, its band of 1 m from its area lets the walk press it only at
  a target that touches her. A dash escape
  for another kit (Lunge away) is not built. A press the hold withholds leaves
  the slot unpressed on that think: the walk goes on to the next slot, and a dash
  with an EX variant that would be cast is not replaced by its base.
- Smoke Pot (Brimwick R) is the second escape of her order, with no landing: its
  area slows every enemy within 3.5 m by 40 percent for 90 ticks, and she herself
  gains 40 percent haste for the same time, which is the way out that a Flare Step
  without a landing does not give (roster-v2: "teleport away, then slow and haste").
  The haste is not read: she presses it as the second escape, as Reed Screen (a shield
  of 40 and a slowing area of 3 m) is pressed second in Ondrel's. A sim step pins it:
  `statusApplied` of haste on her and of slow on a target inside 3.5 m.
- The aim: `aim()` runs on every think, so the draw cadence of the aim error does not change; an
  escape press with a landing then overwrites `aimX` and `aimY` with the landing's aim, with no
  error and no draw.
- The deadlock rule's latched advance is a retreat, so a latched Quillon that a target closes on
  within 6 m blinks away. The #58 scene of the Deadlock section passes with both kit sets; the
  fallback if that ever fails is to leave the latched advance out of the trigger.

The held ultimate: Skerrow's Reaper's Dance and Brimwick's Grand Finale are held for a target she
can finish or one that cannot get away (`holdF` of the row). The run of F counts only while the
target's health is at most F's damage, the sum of the `damage` amounts in F's effects as read from
the kit (40 for Reaper's Dance, 55 for Grand Finale), or the target is cornered. "Low" follows the
roster's finisher pattern (Quillon at 30 health for a 28 to 30 damage Lance, Skerrow at 28 for EX
Rend). Cornered means the kite step run from the target's side, away from the bot, finds none of
its five points 1 m off (free cell and a clear segment). The finisher rule does not change, and
the reserve requires the same condition (see Casting): Brimwick at 80 energy with F ready and a
healthy target at 10.2 m spends the EX Firecracker (`M2+SHIFT`), and at a target with 55 health
presses nothing and keeps the energy for F. Ondrel's Drowned Ground is not held (`holdF` false in
her row): the sum of the damage read from the kit is 10, one pulse of its five, so the reading
would hold it for a target at 10 health or less and so wait for one the zone does not finish, and
roster-v2 has it pressed on its band with 100 energy. The reading `damageIn` gives for it is left
unused on purpose (`lowHealth` is 0 for a row that does not hold F).

## Allocation

A think allocates nothing in the steady state: the bot runs in the frame path of the
browser, and `packages/bots/test/allocation.test.ts` measures it (see Testing). What
makes that true, and what stays outside it:

- Every record a think reads or writes is made once, in `createBot`, and rewritten
  field by field: the decision and the acted decision, the delay ring, the move
  command, the scores, the cast choice, the returned input, the scratch points of the
  shot test and the kit cache. Loops on the think path are indexed. Fields that hold
  doubles start as doubles (0.5), so no field changes representation and boxes.
- A double passed to a call that V8 does not inline, or returned from one, is boxed
  (16 B), and so is a double loaded from a field that holds a small integer in one
  object and a double in another. So the hot helpers take objects and write a field of
  one (`distanceInto`, `scoreIntentsInto`, `clearShotWith`, `nearestSightCellIn`,
  `steerTowardInto`, `followPathInto`), the numbers a scan reads come from typed
  arrays or arrays of doubles (the kit cache, `NavGrid.shapes`, the obstacle table of
  the shot test), and the aim is written out over locals. `scoreIntents`, `clearShot`,
  `nearestSightCell`, `steerToward` and `followPath` are wrappers over those forms, so
  there is one implementation of each and nothing to keep in step. The aim is the one
  place with two: `leadPoint`, `rotateByHalfTangent` and `roundAim` of aim.ts stay as the
  independent reference, and a seeded test compares `think`'s inlined aim with them.
- The cache of the rules is typed arrays and double fields too: per slot
  `hasOpen`, `openMin`, `openMax`, `motion` (Int8), `needsNearAlly`, `isEscape`,
  `escapeRange`, `escapeFixed`, `escapeDash`, `escapeWithin` (one double) and
  `escapeOrder` (Int8 ended by -1), and `lowHealth` (a double field) with
  `holdF`. They are filled on a rebuild only; so are the ally arrays, `allyKind`
  (Int8) and `allyMax`, `allyNeed` and `allyClearance` (doubles), per slot. The
  cues of a think (`dot`, `escapeThink`, `reserve`, `fOk`, `nearAlly`, and
  `allyFor`, an Int32 per slot) are fields of one object, the landing is a
  record of seven doubles and a boolean, and the kite points, the cornered
  test's move and the landing are scratch the bot owns: the landing search and
  the cornered test allocate nothing. The escape scratch also holds the escape
  streak (#165), one integer field (`EscapeScratch.streak`): it counts up by 1,
  never by a double, so no field changes representation.
  The dodge's `DodgeScratch` is the same kind: two points that start as
  doubles, the tier's chance as a double field and its reaction as an integer,
  the think count and the ring position as integer fields, and the memo as an
  `Int32Array` of ids, an `Int32Array` of first thinks and an `Int8Array` of
  coins, all made in `createBot`; `dodgeInto` takes objects only, keeps every
  double in a local, passes no double to a call, writes the coin as mulberry32
  over the bot's `Uint32Array` state and uses `sqrt` and `ceil`.
- `hypot2` is V8's algorithm for `Math.hypot` of two numbers, which allocates
  32 B per call, so a bot that measures a dozen distances allocated 400 B for
  them. A test compares it, bit for bit, with `Math.hypot`. That test pins the
  `Math.hypot` of current V8 (Node 22). If it fails after a Node upgrade, V8
  changed `Math.hypot`: that is a decision to make (follow it or keep these
  bits), not a bug in the bots.
- `lineOfSight` is the sim's `hasLineOfSight` over a Float64Array of the
  obstacles, because the sim's allocates about 128 B per call (each sweep
  returns a double). A test compares the two on random segments. The table is
  rebuilt when the arena is another object.
- `segmentClear` reads the obstacles from `NavGrid.shapes` (a flat array of
  numbers, kept next to `obstacles` in the grid, which stays plain JSON) and
  has `hypot2` written out at its one site.
- The scratch of the shot test and the scan is per bot, so two bots never share it.
  A direct call of `clearShot` or `nearestSightCell` without a scratch allocates one.
- V8 gives every object literal with the same keys in the same order one shape, across
  all code in the process, and a field that any of them filled with a small integer or an
  object is no longer a double field. A store into such a field boxes the double (16 B).
  A scratch with a key as common as `value` was measured doing that under Vitest, so the
  distance box has the key `metres`. The heap check is what notices a scratch that
  loses its double fields.

Outside the steady state, by design: a plan, which allocates its path (the
waypoints of `findPath`, the points of `splitPath`, the follower's goal) and
nothing else, a fresh path follower after a goal or intent change, the grid
and the tables built for a new arena, the search scratch made for a larger
one, the kit cache built for a new kit, and `inspect()`. The aim error is a
field of a record (`aimError`), not a closure variable: V8's Maglev tier boxed
every number written to one, in the engines measured. The decision records are
what a think would have allocated once: one small object per think stays under
the bound of the test, so only review and the unit tests guard the returned
input (it is the bot's own record) and the decision record.

### In the browser

The steady state above is the one the Node check reaches, and a live match is
not in it. On bc1d6f1 the live probe read 25 to 132 KB of bots bytes in each
of its five 30-frame windows (ticks 3029 to 3179 of the default match, 90
thinks a window): a median window of 39 to 44 KB over 15 local attempts and 40
to 52 KB in two runner jobs, the same bytes in every attempt, against 0 B in
the Node check. Two causes, each named by the probe's split by function, and
neither is tier timing:

- The plans. A search allocated about 53 KB: a table per search, an object per
  open entry, an array of cells and two cell centres per edge test.
  `searchCells`, `canStep`, `lineOfWalk`, `octile`, `splitPath` and `OpenSet`
  were nine tenths of the bytes, in the same windows in every attempt, and a
  warm-up of 3400 ticks instead of 2100 read plans in the next round too. The
  search runs on scratch now (see Navigation).
- The Maglev tier. In a traced run `aim`, `updateRuns`, `computeCues`,
  `clearShotWith`, `steerTowardInto` and `hypot2` were in Maglev, V8's middle
  tier, at tick 3029 and none of them was deoptimized or compiled again inside
  the windows. In the engines measured (the Chromium of Playwright 1.63, and V8
  14.6 on Node 26) Maglev does not inline a call with a double argument or
  result, and calls `Number.isFinite` with its argument boxed: one 16 B box per
  call. Node 22's V8 12.4 does not reproduce it (`--maglev --no-turbofan` reads
  tens of KB a think before and after alike); Node 26's does, and the heap
  check runs it there since #108 (see Testing). That was `bot.ts:aim` at 1.2 KB
  a window (a `Number.isFinite` per think, and the `aimU` store), the distance
  of `steerTowardInto` with the finite test of `cellIndexAt` at about 5 KB
  together, and `clearShotWith` with `needsPlan` at about 1.5 KB. The finite
  tests are `x - x === 0` now, the distances go through `distanceInto`, and
  `segmentClear` has `hypot2` written out. The same scenes run Maglev-only
  (Node 26, `--no-turbofan`) read 18 B a think in `aim` and up to 54 KB in a
  scene that plans; after that change every scene that does not plan read 2 B
  there, the rng draw, which is written out inside `aim` now (below).

Not the cause: an unoptimized `aim` (Ignition, `--no-turbofan --no-maglev`)
boxes about 755 B a think in `aim` itself (the whole think reads 44 KB a think
there), 68 KB a window for `aim` alone, and the live one read 13 B; a deopt
loop on live feedback (none of those functions deoptimized in the windows, and
`--no-concurrent-recompilation`, which counts tier-up in ticks and not in
time, left `aim` at 1.0 to 1.3 KB while `steerTowardInto` read 6 to 16 KB and
`scoreIntentsInto` 7.5 KB a window and the counted client code 37 KB: counting
tier-up in ticks does not clean the figures, it moves which functions box).
The deopts the trace does show are three's `needsUpdate` and code a GC clears
(`embedded weak objects cleared`), which the plans' garbage fed.

After, 15 local attempts: a median window of 3.5 to 4.0 KB, the five windows
6.1, 10.8, 2.6, 3.7 and 1.6 KB, with `aim`, `updateRuns`, `computeCues`,
`sight.ts`, `steer.ts`, `hypot.ts` and `cellIndexAt` at 0 B. What is left is
the path of a plan (`splitPath`, `findPath`, `cellCenter`, `plan`: 0.9 to 6.9
KB a window), the rng draw (`rng.next` runs in the interpreter, one call in 15
thinks: 0.5 to 0.7 KB; written out inside `aim` since #108, below) and the kite
step in the first two windows (cold code, 2 to 3 KB).

On the runner (the live probe, three Playwright jobs on 04be0f9, run
37457728094) the median window read 3588, 3912 and 3756 B, against 52.2 and
39.9 KB at bc1d6f1; `aim`, `searchCells`, `canStep`, `hypot2`, `cellIndexAt`,
`steerTowardInto` and `updateRuns` were absent from every window. On the head
rebased over #97, 15 local attempts read a median window of 3.2 to 3.7 KB.

The dash hold of #98 shortens rounds 1 and 2, so round 3 begins by tick 2609
(2879 before) and the measured windows are windows 4 to 8 of it, ticks 2729 to
2879, earlier in the chase than windows 5 to 9 were. There the same bots read
more: 15 local attempts on the head of #98 read a median window of 6404 to 7996
B (the windows 4.0 to 10.5 KB, and 20 KB once), and the three runner jobs on
4ea802d 6952, 7348 and 7200 B; main's bots on the same windows read 5744 to 6416
B (3 attempts), and the tester's twelve attempts up to 7568 B. What is in them
is the plans (`splitPath`, `plan`), the cold kite step and the escape landing
code, no hot path: `aim`, `updateRuns` and `computeCues` read 0 B.

The dodge of #137 lengthens the rounds before round 3, which now begins by tick
4289, with the first projectile in window 2 and the first hits in window 4 of
it (three 17-window runs, identical; window 6 reads no hit, the other windows
after window 4 read 1 or 2). The lead is 2 windows, the window of the first
projectile, as #97 derived it (decision 9 of batch #134), so the measured
windows are windows 2 to 6, ticks 4349 to 4499. They hold the first plans of
the chase: 15 local attempts read the five windows at 17.5 to 20.6 KB, 8.9 to
11.9 KB, 1.0 to 1.4 KB, 12.6 to 13.3 KB and 3.7 to 4.0 KB, a median window of
8908 to 9484 B in 12 attempts and of 11 720, 11 844 and 11 980 B in 3 that have
one interpreted call of 2.5 to 2.9 KB (`distanceInto`, `segmentClear` or
`openPop`) in window 3. Read by function, windows 2 and 3 are the follower's
plans: `splitPath` 13.3 to 13.9 KB and 6.4 to 6.7 KB, then `plan`,
`findPath`, `needsPlan` and `cellCenter`, and nothing else counts. They are
mostly the cold plans of the chase: with the dodge off (chance 0, 3 attempts)
the same two windows read 14.5 and 14.6 KB, `splitPath` 10.4 to 10.9 KB and
10.4 to 10.7 KB, against 17.5 to 20.6 KB and 8.9 to 11.9 KB here. That control
is a different match, with round 3 begun by tick 2609, and a replan after a
sidestep lands in `follow.ts` too, so the dodge may add to them. The old lead
of 4 skipped them (at 4 the median read 3428 to 4068 B). `dodge.ts` is in no
window's list of functions.

The live scene bounds the bots: the median of its five windows' own bots figures
must be at most 18 000 B (`LIVE_BOTS_LIMIT_BYTES` in `e2e/heap-probe.ts`). That
is 50 percent above the largest median of any clean attempt, 11 980 B (17 970,
rounded up to 100). The 15 local attempts on the head of #137 read 8908, 9012,
9056, 9056, 9200, 9296, 9296, 9368, 9388, 9416, 9480, 9484, 11 720, 11 844 and
11 980 B; the last three have one interpreted call in window 3, a first-time
deoptimisation that falls back to the interpreter, which decision 12 of #91
counts as clean, so they are in the set. At the merge the rule is applied again
over every source, the tester's attempts and the runner's three (the decision
18 addendum of #91, the lead's step), and a median over the limit reopens it.
It was 12 000 B on #98's windows (7996 B, the runner's 7348 B and the
tester's 7568 B; decision 12 of #91 set 9600 B on 6.4 KB, the one attempt where
a single interpreted call of `lineOfSight` read 2.7 KB in the median window),
and it moved with the windows: the lead of 2 puts the first plans of the chase
in them. The other clause, at most a quarter of the
smallest median with the plan search and the Maglev fixes reverted, is not the
lower one: the revert reads 208.2, 209.2 and 210.0 KB on these windows (a
quarter of 208.2 KB is 52 KB), and fails 3 of 3 local attempts (61.9, 65.8 and
66.7 KB on #98's windows, 38.9 to 43.4 KB on the old ones, 9 of 9). The -0 deopt
of `aim` above is the second positive control: 72.3 to 74.2 KB in 3 of 3
attempts. The bound does not catch one reverted Maglev fix: `aim`'s 1.2 KB, or
the distance of `steerTowardInto` with the finite test of `cellIndexAt` at up to
5 KB a window, can leave the median window under the bound.
The Maglev heap check guards each of them singly (see Testing): the Node check
in the default tiers runs Turbofan, which inlines them, and the bound sits
above their size. A runner median above 18 000 B reopens the limit.

The first windows of a round are not in that figure and are not bounded. With
the profiler on from tick 0 locally, the first window of round 1 read 2.5 MB
of bots bytes before and 0.72 MB after (cold code: the first plans and shot
tests run in the interpreter), of round 2 1.5 MB before and 40 KB after, of
round 3 1.1 MB before and 0.11 MB after, and the fifth window of a round 0.2
MB before and under 0.15 MB after (round 3: 8 KB). The probe prints no bytes
for the warm-up, so these windows are unmeasured on the runner, and these
local figures stand for them.

One kind of byte is probably not caused by the bots' code: an optimized
function that deoptimizes in a window runs its next call or calls in the
interpreter. `sight.ts:lineOfSight` read 2.7 KB in one window of one local
attempt (a median window of 6.4 KB, window 3) and 1.7 KB in one window of a
runner attempt (window 1), and 0 B in the other 100 or so attempts. The cause
is inferred, not traced: one interpreted call of it reads 1.1 to 3.1 KB in a
micro-run (Node 26), the size of both events, and the trace shows a first-time
deopt of it once per run (`Insufficient type feedback for binary operation`,
tick 299) and `clearShotWith` deoptimizing on `wrong map`; no late deopt of it
was caught in 25 traced and 72 live attempts. If it is a branch of the sweep
that no earlier shot took, first taken late, V8's feedback decides it, and
this document knows no change that removes it. Either way the live bound has
to tolerate one such event in the median window.

A second deopt, found by #98: `Math.round` of an aim point in [-0.5, 0) cm is
-0, and the `+ 0` after it that makes it 0 had int32 feedback (every earlier
value was a whole number in a Smi), so the first such point deoptimized `aim` in
Maglev (`not int32`, at the `+ 0` of x and of y) and it ran in the interpreter,
65 KB a window, until it was optimized again. The match is deterministic, so the
point comes at the same tick in every attempt: with the dash hold of #98 it fell
just before the measured windows of the live scene in all of them, and the bots
median read 73 KB. The rounding is `+ 0.5 - 0.5` in `aim` now: the same value as
`+ 0` while |Math.round(x)| is below 2^52 cm (a whole number that size survives
both additions, and -0 + 0.5 is 0.5; the aim of a champion in any arena is a few
thousand cm), and a double constant gives the sum number feedback from its first
run. The windows read 0 B in `aim` again. `escape.ts:landingInto` had the same
`Math.round(...) + 0` and the same hazard, with a landing point in [-0.5, 0)
cm: in Maglev alone the bot then ran about 1200 thinks at 288 B a think. Its
two rounding lines end in `+ 0.5 - 0.5` too since #108, the same values;
`teleportEndInto`'s `+ 0` copies the sim's operation and stays (its inputs are
heap numbers, so its feedback is number feedback and not int32). A value pin in
escapes.test.ts (a landing point in [-0.5, 0) cm, on x and on y, is +0 and
equals `roundAim`; red under a bare `Math.round`) and the -0 pins of the heap
check hold it.

The rng draw. `rng.ts:next` runs once in 15 thinks (the aim error is held for
15), so V8 never optimised it before a long run, and in the interpreter its
double result and every int32 above the Smi range boxed: about 30 B a draw in
the browser (the 0.5 to 0.7 KB a window above), 16 to 32 B in a block of 15
thinks in Maglev alone. The draw is written out inside `aim` now, over a
`Uint32Array(1)` state made in `createBot`, with the same operations in the
same order, so it runs in the compiled code of `aim`; `rng.ts` stays as the
reference with its own test. A seeded stream test in bot.test.ts compares the
aim of 12 seeds (-1, 2^32 - 1 and 2^32 among them) over 2400 thinks at a
stationary target, at each tier, with `createRng`, `rotateByHalfTangent` and
`roundAim`, and is red under a changed constant, shift or xor. The live scene
on the head of #108 (3 attempts): `rng.ts:next` absent from every window and
`aim` at 0 B.

`bot.ts:move` in the sandbox. The sandbox scene (`combat.spec.ts`, whose one
bot has thought 180 to 330 times by its windows) reads 588 to 912 B a window in
`bot.ts:move` and in no other bots function: 15 windows of 3 attempts, 7 to 10
B a think of the 90 in a window. The live scene reads 0 B there: round 3
(windows 4 to 8) and round 4 (4 lead windows and 5 measured ones after round 3
ends, begun by tick 3839: a median window of 4048, 4156 and 4344 B, `move` and
`aim` at 0 B in all 15 windows), 3 attempts each. A traced sandbox run
(`--js-flags=--trace-opt --trace-deopt`) marks `think`, `decide` and `aim` for
Maglev and compiles them, deoptimizes none of them, and never compiles `move`
on its own (it is inlined into a caller or stays in a lower tier; the trace
does not say which). The cause is not found: no scene of the heap check reads a
byte in `move` (0 B in all 17 scenes, in Maglev alone as in the default tiers),
so it is consistent with a state of the first few hundred thinks that a long
run does not have, and nothing in `move` or in follow.ts changed. The sandbox
figure stays unasserted.

The Chromium question: does the push-grown `splitPath` with the spread fallback
(`follow.ts` of 3333cb5^, the control) cost more in the browser than the array
made at its final length? The live scene, 3 attempts twice on each, read a mean
of 2734 and 2684 B a window in `follow.ts:splitPath` on main against 3099 and
3065 B on the control, 454 and 428 B in `follow.ts:plan` against 431 and 455 B,
and a bots median window of 6104 to 6616 B on main against 6464 to 7028 B on
the control. So the final-length array saves about 370 B a window in
`splitPath` (14 percent of it) and about 0.3 KB of a 6.5 KB median window (4
percent) in Chromium. No code follows.

What the Node check misses, by construction: it reaches Turbofan only (20000
warm-up thinks and the settle), it runs frozen states (one kit, one cast state,
so no polymorphic feedback), the median of single thinks hides the plans and
the aim draw, and Node 22's V8 is not the browser's. The Maglev-only run is in
the CI now (see Testing), on Node 26.7 and not in the browser: Node builds have
no pointer compression, so a Smi is 32 bits there and 31 in Chromium, and an
int32 above 2^30 boxes only in the browser. The live probe stays the authority.

### The default tiers on the runner

On the first attempt of PR #132 (run 39014736086, job 117344361894: the checks
job, Node 22.23.3 on ubuntu-latest, the merge of 20d003c into 5820f16) the
scene check read the kite, no clear shot scene at 5440, 5440 and 5440 B a
think, the retreat scene at 96, 96 and 96 B, the press scene at 0, 256 and 0 B
and every other scene at 0 B. The rerun (job 117344842670) read 0 B everywhere
but the press scene's 256 B in round 2, which both attempts share. The failing
attempt was the faster one: the scene check took 3688 ms against 4896 ms, the
tools harness beside it 33.7 s against 63.0 s. Node 22's V8 12.4 runs without
Maglev unless asked, so its default tiers are Ignition, Sparkplug and Turbofan,
and 5440 B is 340 heap numbers of 16 B, about one per cell of the sight scan's
17 by 17 window.

Nothing reproduced that state locally (Apple silicon, Node 22.23.2, the scene
check on the unchanged test, 1 to 20 runs in each configuration below). V8
flags reach the workers only through `execArgv` in a project of the config
(Vitest 5.0.3 ignores `--execArgv` on the command line when the config has
projects), so each run used a scratch config of one forks project whose
`execArgv` is the flags, started from the repo root as `REPO=$PWD
G133_FLAGS='<flags>' npx vitest run --config <scratch config> --project bots
<test file> -t 'every scene'`, the test file being this one or, for the
unchanged test, a copy of the file before #133 beside it; PR #184 has the
config, which reads the repo root from `REPO`. Whole-worker tiers read what the
header says: with `--no-turbofan` (and the same with `--no-sparkplug` added, or
`--maglev --no-turbofan`) every scene reads 23 to 323 KB a think in all three
rounds, the kite scene 322544 B. A delay of the background compile,
`--concurrent-recompilation-delay=<ms>` (a job is installed no sooner than that
after it was queued), shows the mechanism but not the runner's figures. On the
unchanged test:

- 0 ms: every scene 0 B in 3 of 3 runs; 5 ms: the same but the press scene at
  32 to 48 B (under the bound) in 3 of 3.
- 10 ms: red in 20 of 20 runs (load average 25 to 35 on a shared machine): the
  press scene at 1040 to 1696 B, the engage stand scene at 368 to 2576 B, the
  kite step and deadlock stand scenes at 32 to 128 B. An earlier set of ten
  runs at lower load read red in 8.
- 15 ms: the press scene at 912 to 1696 B, the engage stand scene at 368 to
  1360 B, the kite step, deadlock stand and skerrow wait scenes at 32 B, a
  dozen scenes clean; 25 ms: the press scene at 1696 to 3424 B, the engage
  stand scene at 368 to 1360 B, the lumeth windup scene at 864 B, the kite step
  scene at 128 to 464 B, the path follow, escape press and lumeth escape scenes
  at 16 to 96 B, ten scenes clean; red in 3 of 3 runs each.
- 50 to 200 ms: most scenes at 16 B to 4 KB; 400 and 800 ms: the press and
  engage stand scenes at 44 and 36 KB, the kite scene at 64 and 127 KB.
- Controls at 25 ms: `--no-concurrent-recompilation` read 0 B in every scene in
  3 of 3 runs, `--no-use-osr` stayed red in 3 of 3, `--v8-pool-size=1` alone
  read 0 B in 3 of 3.

`--trace-opt --trace-deopt` at 25 ms shows why a delay hurts a whole scene:
each scene's frozen state deoptimises functions that an earlier scene's
feedback had optimised ("Insufficient type feedback", `updateRuns`, `move`,
`think`, `kiteStepInto`, `kiteDirectionInto`, `waitsFor`), 37 deopts in the
run, and every reoptimisation waits the delay again. The code a window measures
is then still a lower tier's until the job lands.

Pinning one function out of Turbofan (`--turbo-filter=-<fn>`, one run each)
gives no kite-only state. `nearestSightCellIn`: the kite scene at 62224 B, the
retreat at 29232, the deadlock advance at 35616; `lineOfSight`: 6 to 175 KB in
15 scenes; `distanceInto`: 48 to 272 B in all 17; `steerTowardInto`: 176 B in
the path follow, kite and deadlock flee scenes; `seekShot`: 32 to 64 B in four
scenes; `clearShotWith`: 672 B in the two Lumeth ally scenes; `cellIndexAt`:
224 B in the two escape scenes; `move`: 16 to 32 B in all 17; `hypot2`,
`cellCenterInto` and `followPathInto`: 0 B (not on these paths, or inlined into
a caller that is still optimised). `--max-lazy` is no tier flag (it ignores
eager compilation hints at parse time) and was not run; `--no-opt` is
`--no-turbofan`.

The reading, likely and not proven: one function on the kite scene's scan path
(the 5440 B is one boxed double per cell, which `nearestSightCellIn` in a lower
tier, or one of its callees not inlined, would give) ran in Ignition or
Sparkplug through all three rounds because its Turbofan job, compiled on a
background thread, landed after them. The warm-up counts thinks; the job takes
wall time; the runner had three Vitest workers on four vCPUs, a fast main
thread next to a starved compile thread, and the lowest-round rule cannot
absorb a state that lasts all three rounds. No delay reproduced the runner's
figures (the delay stretches every job alike; the runner's state was one
scene), and no survey of other attempts was run.

Since #133 the check settles in the default tiers: after the warm-up it reads
windows of 600 thinks, measured as a round is, until one reads under the bound,
at most 20, then the three rounds. The settle decides nothing: the verdict is
still the lowest of the three rounds, and Maglev alone does not settle, since
its flags pin the compile timing. What the settle absorbs is a series that
falls, a tier-up that came late. It does not cure a series that stays flat
through the cap, which is a function that stays in a lower tier (or deoptimises
and waits its reoptimisation again and again); the check is then red, as
before, and the log line says which it was. The measure, at a 10 ms delay with
the settle (20 runs, load average 36 to 51 on a shared machine, the command
above with `--concurrent-recompilation-delay=10`): the press scene's series
fell to under the bound in 8 to 18 windows in 6 runs, all green, and stayed
flat through the 20 windows at 320 to 1312 B in 14 runs: in 2 of those the
series fell in the rounds just after the cap (rounds 32, 0, 0 B and 48, 48, 48
B, green), in 1 only the last round read low (1040, 1040, 48 B, green on the
lowest-round rule), and 11 were red. So the check was green in 9 of 20 against
0 of 20 on the unchanged test, not in all of them. At 15 ms (4 runs) 3 were
green, the red one flat through 20 windows, and at 25 ms (3 runs) the press
scene stayed flat through 20 windows in 3 of 3. For the record, at 10 ms with
the settle: `--no-concurrent-recompilation` was green in 10 of 10 runs (every
scene one window at 0 B, since nothing is delayed), `--no-use-osr` green in 3
of 10 (7 flat through the cap at 864 to 1248 B). A flag-pinned project was not
taken: the delay is a stress the runner does not show, and a pin would hide the
tier the users run.

A mutation that allocates on every think settles to the cap and stays red, in 3
of 3 runs each, on Node 22 in the default tiers: a six-double object kept in
`waitsFor` (168 B in the skerrow engage and wait scenes), a `{ slot, ex }`
object per slot in `updateRuns` (all 17 scenes red, 280 B in twelve and 200 B
in five, the whole red run 2.2 to 3.9 s locally against the 15 s timeout), and
a two-double cell centre object in the sight scan (14328 to 17784 B in the
kite, retreat and deadlock advance scenes). The clean tree reads 0 B in all 17
scenes with one settle window each, in every run without a delay, and on Node
26.7 the Maglev project reads 0 B in all 17 and its kite scene reads 16 B
against 8 B with `bestDistance` of the sight scan made a local. The measured
loop is written out twice, word for word (the settle's and the rounds'),
because one copy in a loop over both read 80 B a think in 3 to 12 of 17 scenes
of the clean tree: the loop sat in another tier, as in the 144 B case of
Testing.

On the runner (the three attempts of run 40339535608 of PR #184, the checks job
and both heap jobs, nine jobs) every scene settled in one window of 10 to 58 ms
and read 0 B, and the scene check took 4.8 to 6.9 s in the checks job.

Each scene's log line prints the settle windows and their wall time, then the
rounds: `kite, no clear shot: settle 5440, 5440, 0 (3 windows, 41 ms); 0, 0, 0
B per think`. That line is how a future failure says which state it was. A
series that falls but is still at or over the bound at the cap came late; the
cap is already the largest the rule allows (the smallest of 10 and 20 that is
at least twice the largest series seen), so such a failure is reported with its
series and not absorbed by a larger cap; a clean tree that needs more than 10
windows passes, and its log line is reported when seen. A series flat through
the cap did not tier up (a deopt loop, or a function V8 did not optimise), and
its bytes name the function by the pin figures above. The test cannot name a
tier itself: `%GetOptimizationStatus` needs `--allow-natives-syntax`, and V8's
code statistics are in `node:v8`, which the bots tests do not import.

## Aim

Lead moving targets using their current velocity; add a tier-dependent angular
error.

- Lead: with `D` the vector from shooter to target, `V` the target velocity and
  `s` the projectile speed, solve `a t^2 + b t + c = 0` with
  `a = V.V - s^2`, `b = 2 D.V`, `c = D.D`. The time is the positive root,
  `(b + sqrt(b^2 - 4ac)) / (-2a)` for `b >= 0` and `2c / (sqrt(b^2 - 4ac) - b)`
  otherwise, which avoids a cancelling subtraction. The aim point is the target
  position plus `V t`.
- Subject: the point the lead aims at is the acted target, except for a bolt
  pressed at an ally (kind 1 of the ally slots, never herself): that is aimed
  at the ally, led with the bolt's own speed, and the error is the same single
  draw, so the cadence is unchanged. R and F keep the acted enemy as the aim
  point, since an aim at her own centre is a zero-length vector.
- Held ally: the sim fires at the aim of the firing tick and Soothing Surge
  winds up for 18, so the bot holds the ally for every think of the windup in
  one integer field, `allyAim` (the ally's id, -1 for none; an integer in a
  field, never a double in a closure variable). The press sets it, a press on
  the tick that fires another cast (`windupLeft` 1) aims for that cast and then
  holds its own ally, the aim falls back to the acted target when the held ally
  dies, and the hold is cleared on a think with no cast in progress.
- Speed: the first top-level projectile of the ability winding up, or else of the
  ability pressed on this think, or else the nominal 20 m/s (no kit, or no
  projectile in it).
- Areas lead at the nominal speed too, and a kit-derived lead was measured and
  not built (#165). An ability with no projectile (the Mire and Drowned Ground
  of Ondrel, Firecracker of Brimwick, Binding Sigil of Lumeth) is placed at the
  aim point, so the lead moves the point to where a target walking at 5.5 m/s
  would be after the flight of a 20 m/s projectile. The question was whether a
  lead bounded by the area does better than the nominal one. A scratch copy of
  the head with the lead of an area ability changed played 160 seeded 2v2
  matches of Ondrel and Brimwick against each shipped kit on both arenas (normal
  tier, seeds 1 to 10, not committed: it patches `aim`), and counted the pulses
  of the areas they placed that had an enemy inside:

  | Lead of an area ability        | Mire (r 2)         | Drowned Ground (r 4) | Firecracker (r 1.5) | Firecracker EX (r 2) |
  | ------------------------------ | ------------------ | -------------------- | ------------------- | -------------------- |
  | nominal 20 m/s (built)         | 932 of 1185 (78.6) | 71 of 76 (93.4)      | 374 of 400 (93.5)   | 488 of 510 (95.7)    |
  | offset at most the radius      | 943 of 1192 (79.1) | 72 of 77 (93.5)      | 387 of 395 (98.0)   | 482 of 499 (96.6)    |
  | offset at most half the radius | 938 of 1207 (77.7) | 82 of 88 (93.2)      | 400 of 403 (99.3)   | 489 of 504 (97.0)    |
  | none (the target's own point)  | 863 of 1137 (75.9) | 81 of 88 (92.0)      | 394 of 397 (99.2)   | 488 of 503 (97.0)    |
  | doubled                        | 793 of 1317 (60.2) | 71 of 89 (79.8)      | 239 of 449 (53.2)   | 402 of 484 (83.1)    |

  The nominal lead is within a point of the best for the lingering areas (the
  Mire and Drowned Ground, which pulse three and five times): a cap at the
  radius reads 0.5 and 0.1 points above it, a cap at half the radius 0.9 and 0.2
  below, and no lead 2.7 and 1.4 below, so a kit-derived lead would add
  arithmetic on doubles to `aim` (the boxing hazard of the Allocation section)
  for nothing, and `aim` is unchanged. The one-hit areas read the other way:
  Firecracker gains 4 to 6 points from a cap (93.5 to 98.0 and 99.3), a
  kit-derived lead for the areas with one pulse stays unbuilt (see Not built
  yet). The shares are over different matches, the bots' own lead changing what
  they face, and the first figure of each cell moves by a few pulses with the
  seeds (an earlier scratch on the same design read 938 of 1189 for the nominal
  Mire). `packages/bots/test/area-lead.test.ts` pins the built behaviour with
  the sim as the oracle: the bot and an enemy strafing at full speed, five of
  five pulses of Drowned Ground at 6 m and two of three of the Mire at 7 m on the
  first area; the lead dropped reads 2 of 5 and 1 of 3, doubled 0 of 3 on the
  Mire. The six-kit set of the reference-chain test of `bot.test.ts` adds the
  16 and 24 m/s of Undertow and Flash Powder to the speeds the aim is compared
  at, and the areas of the six kits to the casts that lead at the nominal 20.
- Fallback: aim at the target when `c = 0`, `a >= 0` (the target is at least as
  fast as the projectile) or `t` is not finite.
- Error: the vector to the aim point turns by `2 atan(u)` with the rational
  form `cos = (1 - u^2) / (1 + u^2)`, `sin = 2u / (1 + u^2)`, so no
  trigonometry runs. `u` is drawn uniformly from `[-T, T]` and redrawn every 15
  ticks while the bot has a target.
- Rounding: `Math.round(v * 100) + 0` gives whole centimetres and never `-0`.
- Order of draws: within a think the aim draw comes first, then the dodge coins
  in projectile index order (see Dodge); the aim draw is the one made when the
  held error is redrawn, so a coin shifts the next redraw to the next value.
- Override: an escape press with a teleport or dash landing replaces the aim
  with the landing's (see Openers and escapes), after the draw, the lead and the
  subject have run, so the cadence of `u` is the one of a think that does not
  escape, and a Glide pressed on the tick an ally-aimed Soothing Surge fires
  still aims at its landing.

## Difficulty tiers

Easy, normal, hard. They differ in reaction delay (ticks between a change in
the world and a change in intent), cast delay, aim error, and dodge probability.
The cast delay is read as a reaction delay: the ticks between a change in the
world (the target enters an ability's reach with a clear shot) and the press. It
is half the reaction delay, rounded up.

| Tier   | Reaction delay | Cast delay | Aim error (largest) | T (`tan` of half the error) | Dodge probability |
| ------ | -------------- | ---------- | ------------------- | --------------------------- | ----------------- |
| easy | 30 ticks | 15 thinks | 12 degrees | 0.10510423526567646 | 0.25 |
| normal | 15 ticks | 8 thinks | 6 degrees | 0.0524077792830412 | 0.5 |
| hard | 6 ticks | 3 thinks | 2 degrees | 0.017455064928217585 | 0.75 |

The dodge probability is the chance of the coin drawn once for a projectile (see
Dodge), and the reaction of a dodge is the cast delay; profiles and scores are
the same for
every tier. The delay is a ring of `delay` records: the bot decides on the
current state every tick, stores the decision, and acts on the one it stored
`delay` ticks earlier. Movement and aim use the current positions.

## Determinism

Bots need to repeat only within one process. The bot owns its PRNG (mulberry32,
seeded from `seed`), and `think` is a pure function of the state plus the bot's
private state. A bot keeps no module-level state, iterates arrays in index
order, never reads the wall clock or `Math.random`, never reads or writes
`state.rng`, never mutates the state, adds no random draw for casting (the bot's
rng has two uses, the aim
draw and the dodge's coin), and stores copies of numbers and ids
rather than references into the state. The exceptions are three references the
bot
keeps for identity checks, each rebuilt when the object it was built from is
another
one: `state.arena` (the navigation grid and the path follower stay while it is
the
same object; a new arena object, for example from `cloneState` each tick,
rebuilds
the grid and resets the follower, so such a caller pays a rebuild every tick),
the
same arena for the obstacle table of the shot test (see Allocation), and the kit
object found in `state.kits` together with the champion id (the kit cache). The
caches are per bot and a kit or an arena mutated in place is not supported.
The tier table and each tier are frozen and readonly. Decisions use only
`+ - * /`, comparisons, `sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `round`,
`imul`,
the sim's public exports, the arithmetic of the landing below and `hypot2` of
`packages/bots/src/hypot.ts`, which gives the
bits `Math.hypot` gives (see Allocation). Bots do not use the sim's `dmath`.
Lint
bans `Date`, `performance`, `Math.random`, `Date.now` and `performance.now` in
bots source (the sim's transcendental-math ban is not copied: bots output is not
promised bit-identical across platforms); review enforces the rest.

The landing of an escape teleport copies the sim's arithmetic operation for operation: `fireFrom`
and the teleport case of cast.ts and `direction` of geometry.ts (a divide by the larger axis, one
`sqrt`, `+ 0`). It uses only `+ - * /`, `sqrt`, `abs`, `max` and `min`, so it is allowed here, and a
differential test compares it with the sim's teleport end bit for bit. Normalising with `hypot2`
instead gives other bits for some aims, which that test catches.

Bot output is not promised to be bit-identical across platforms, so no checksum
fixture of a bot-driven match is committed (batch #32 decision 1). A recorded
match replays exactly from its input stream.

## Not built yet

- A full match to matchEnd in the headless runs of the first three kits: they run
  a fixed 3600 ticks of free play, and only Lumeth's four seeded runs and the 18
  cells of Ondrel and Brimwick play to the end (see Testing). A 3v3 with the six
  kits is not played in a bots test either; the balance report plays 3v3s over
  the six (`balance.md` section 5.9, #189).
- A lead for an area that is derived from the kit: the nominal lead stays, which
  for the Mire and Drowned Ground measured within a point of the best (see Aim).
  The one-hit areas
  (Firecracker, and Binding Sigil, which was not measured) read the other way:
  Firecracker lands 93.5 percent of its pulses on an enemy with the nominal lead
  and 98 and more with the offset capped at the radius (see Aim); a follow-up,
  low priority.
- Local steering around champions (the dodge ignores them), and ally logic
  beyond Lumeth's ally slots (peeling for an ally).
  Dodging an area is not built either; the dodge is built for projectiles (see
  Dodge).
- The rest of Lumeth's ally play: staying within 8 m of an ally (the roster's
  leash), her M1 finisher on an enemy at 10 health or less, and the EX variants
  of M2 and R. Abilities that land on allies or on the caster that no rule
  presses (Hargrim Q), and the rest of the roster's bot sketches: a target
  choice by lowest health (the target is the nearest enemy), and per-slot
  finishers (the one finisher is the rule above).
- A dash away from the target for Skerrow (Lunge away): the dash hold leaves it
  unpressed on an escape think. Glide is built, see Openers and escapes.

## Testing

Bot-versus-bot headless matches are integration tests: invariants must hold, and
no `NaN` may appear. The headless test runs a 2v2 match of four bots on arena 1
for 3600 ticks with a mix of tiers, checks the sim invariants and the input
rules every tick, and checks that `think` leaves the state's checksum unchanged.
A second headless run puts a mirror 2v2 (Hargrim and Quillon on both teams)
through the same checks, once on the bots-local test kits in
`packages/bots/test/kits.ts` and once on the shipped kits
`data/kits/hargrim.json` and `quillon.json`, with a press oracle: every press is
checked on the state the bot thought on against a literal band and clearance
table of the kit set (written from the kit files, not from src, and worked out
again from the files by a test, since the run presses only some slots), the
acted target, line of sight and a clear shot of the ability's width, the
cooldown, the energy, stun, silence, root with a dash and the windup, and
afterwards the sim must have started that cast, or a death, a stun, a silence or
a root explains why not. The opener rows are the literal band with no margin
(Rush [4, 5], Chain Hook [4, 7], Lunge [5, 6]) and the motion of the target by
the oracle's own sign. An escape row has no band and no shot: the oracle checks
the trigger (a retreat within 6 m, or a kite inside the literal rangeMin of the
champion; for Lumeth the literal 3 m of any intent but idle, a table of its
own), and for a teleport its own first-of-five landing, found by casting the
slot on a clone of the state, checked with `hasLineOfSight` and the clearance of
the cell centre: the aim of the press must be that landing's and the sim must
put the champion on it, unless a champion ahead of it in the step's turn order
(a lower id) walked in that step, or a champion died before the caster's cast (a
melee arc of a champion ahead kills one with a higher id without moving): the
teleport pushes its end out of every other champion where that champion stands
at the caster's turn, and the oracle's clone, which gives no other champion an
input, sees them standing. Then the end must equal, bit for bit, the teleport
end of a clone of the state the bot thought on stepped with the inputs of the
champions ahead and the caster's press, and a champion ahead must have moved or
some champion died: the oracle models the walks and the deaths that land before
the cast and nothing else (#146; the deaths of a higher id were added in #165
after the review of #182 found that the first form looked only at the champions
with a lower id, so an arc of a champion ahead that killed a champion behind the
caster, whose body the landing depended on, failed it; `escape-oracle.test.ts`
pins it on a hand-built state, with a fixture champion whose M1 is an arc with
no windup). The bot models neither the walks nor the deaths ahead of it; its
landing search ignores champions. Hush Ward is pressed only when Skip is not
ready or has no landing. A direction whose raw point, the one the teleport aims
at before the sim's collision pushes a champion off a wall, is not a free cell
is skipped too, as the bot does: a match played to its end has a Skip that ends
2 cm inside the south wall, which the sim pushes clear and the bot passes over.
Lumeth's rows are Lantern Burst (an escape row), Glide (a dash row: the oracle's
own first-of-five 4 m dash landing, a free cell and a path
`oracleSegmentViolates` finds clean, the aim equal to it, a `dashStarted` in
that direction after the step, and E not ready), Binding Sigil (the kit band
less the margin, a clear shot of 0.5, and the oracle's own check that the target
is within 6 m of an alive ally of hers), Mend Bolt (its enemy band, or an ally
row when an ally qualifies) and the ally rows of Soothing Surge, Aegis Veil and
Dawnbloom, which have no enemy band: a press of them needs an ally. An ally row
is written from the kit (a reach of the bolt's speed times its lifetime, or an
area's radius plus 0.5, less the margin of 1 m; a need of 10, 14, 30 and 30; a
shot width of 0.35 and 0.5), and a table test works every literal out from
`lumeth.json` again, so a change to the kit fails it. The oracle's own scan
(alive, on her team, not herself for a bolt, missing at least the need, in
reach, a clear shot for a bolt) picks the ally with the lowest health fraction,
the lower id on a tie. A press with no ally that qualifies fails the run, and a
bolt press must be aimed within 12.1 degrees (the widest tier error, 12, and the
whole centimetres) of the lead point at that ally, unless a cast in progress
fires on that tick. The EX variants of M2 and R have no row and fail the run.
The ultimates of Skerrow and Brimwick pass only for a target at 40 or 55 health
or less (the damage F does, written from each kit file), or one the oracle finds
cornered by its own walk of the five points. The dash rows (Rush, EX Rush,
Hargrim's ultimate, Lunge, EX Lunge, Reed Step) fail a press on an escape think,
and Quiet Dart's row fails a press at a target the oracle finds with no escape
ready (its own table of escape slots, a cooldown of at most 1, no stun or
silence). A tally (`tallyTeleports` in the test helpers) counts the escape
teleports of the runs (a press with a landing) apart from every other teleport
(Reaper's Dance), each with its blocked count: every escape teleport must be
reported unblocked, and Reaper's Dance may be blocked legitimately. The run must
end with a death from a cast, every champion must start a cast, and one cast
must be an EX. The seeds are 101 to 104, the match seed 7 and the tiers easy,
normal, hard, normal; they are pinned, and a miss after a change to the bots,
the sim or the Node version is governed by batch #53 decision 8.3. The ultimate
has its own pinned run: the 2v2 ends its fights by tick 700 with the energy bar
at 75 at most, and 9000 matches of it on the shipped kits gave no F cast, so a
3v3 of Hargrim and two Quillons a side, seeds 101 to 106 at the hard tier, runs
through the same checks and must start an F (decision 8 of #63 allows a separate
set for this alone; it needed another size of match). Since the bots dodge
(#137) the run is a declared start edit (decision 4 of batch #134): every
champion starts at 75 energy, because no seed set reached an F by landing hits
alone. Four (test kits) and five (shipped kits) of the six press F, and with the
reserve dropped none does, so the energy reserve is still what lets it fire. A
free-play run of the same 3v3 on the shipped kits, seeds 648 to 653 with no
start edit, pins the turn-order model above: on tick 341 champion 1's Skip ends
2.0 m from the standing landing because champion 0 slid along champion 2 first.
A Skerrow 2v2 pins the Skerrow profile: Skerrow and Quillon against Hargrim and
Quillon on the shipped kits in free play, seeds 101 to 104, every bot on normal,
match seed 7; a team is eliminated by tick 3600 (a round is 5400 ticks in match
flow, which would decide the same way), Skerrow starts a Lunge, every press
passes the oracle and no bot stalls for more than 120 ticks. Hargrim and Lumeth
against Hargrim and Quillon on the four shipped kits (seeds 101 to 104, normal,
match seed 7, 3600 ticks) run the same checks, with two runs that declare a
start edit because her escape never fires in free play: the enemy Hargrim 2 m
east of her on tick 0, once with Lantern Burst ready (it is pressed) and once
with it on cooldown (Glide is pressed, and the oracle checks its landing and the
dash the sim starts). The same match with a start edit declared in the test,
Skerrow at 100 energy and both enemies at 40 health, runs the oracle's F row on
a real press: Skerrow starts Reaper's Dance, the tally counts a teleport of it
apart, the escape teleports are exactly 2 and none is blocked. One run only,
with the seeds above (a miss is governed by decision 8.3 of batch #53; the
declared fallback is Skerrow against a Quillon at 40 health, the other two dead,
9 m apart). `reaper.test.ts` also blocks it: a target at 40 health steps behind
the pillar of arena 1 during F's 18 tick windup, the sim fires toward the
current aim, reports the teleport blocked, Skerrow stays where the cast began,
and the tally counts it apart with no blocked escape. A shadow-edge test on
arena 1 pins that a position where the centre line is clear and a shifted line
hits the pillar gets no press and is not chosen as a sight cell. The determinism
test runs the same match twice, and two matches stepped in turn, on the test
kits and on the shipped kits (the second one interleaved with a match on the
test kits), and compares input streams and final checksums in memory; a Skerrow
2v2 block does the same on the shipped kits, interleaved with a match on the
test kits and against another match seed, each with the guard of one distinct
record per bot per tick. See [testing](testing.md).

The rules have their own pins on frozen states of the shipped kits
(`openers.test.ts`, `escapes.test.ts`, `reserve.test.ts`, `reaper.test.ts`, with
the scenes of `scenes.ts`), each tied to a mutation that turns it red: the bands
of Rush and Lunge (and the derived dash band), the motion tests of Chain Hook
and Snare Orb, the trigger of an escape (6 m inclusive, the kite clause), the
order of an escape against F, the landing order and its line of sight (a pillar
skips a direction, a low wall does not), the boxed-in Hush Ward, the draw
cadence across an escape press, the reach and condition clauses of the reserve,
the wide-ultimate stand and the hold of Reaper's Dance. A differential test
compares the landing with the sim's teleport end bit for bit over 2000 seeded
aims. The rules of #98 have theirs: `escapes.test.ts` pins the dash hold (Lunge
at 5.5 m, EX Lunge at 4 m with 50 energy, Rush at 4.5 m and Hargrim's ultimate
on a retreat are not pressed, and are pressed on a think that is no escape
think; two edited kits tell the base flag from the EX flag), `openers.test.ts`
Quiet Dart (Q at a Quillon with Skip or Hush Ward ready, M2 with both cooling
down, at a cooldown of 1 and of 2, at a silenced and at a stunned Quillon, Q at
a Hargrim with Iron Hide ready, M2 at a champion with no rule) and
`wait.test.ts` the wait (a stand at 6, 7 and 8 m and not at 5.95 or 8.05, at a
cooldown of 2 and 90 and not at 0, 1 or 91, no stand behind the pillar, none for
a Hargrim, none on a retreat). Mutations that turn each red: the dash hold
dropped, read from the base flag only or the EX flag only; the Quiet Dart
condition dropped, inverted, ignoring silence, ignoring stun, with a cooldown
test of below 1 or at most 2, and never worked out; each edge of the wait moved
past the pin (the band at 5.9, 6.05, 7.95 and 8.1, the cooldown bounds at 1, 3,
89 and 91, each comparison made strict) and the clear shot dropped; the tally
counting every teleport and every block.

The rules of #106 (the trigger field, Binding Sigil and Glide):
`escapes.test.ts` pins Lumeth's trigger (E at 3 m and not at 3.05 m on a kite
and on a retreat, a retreat at 4 m and a kite at 5 m are no escape think, E
pressed beyond its band behind a wall; a direct `computeCues` test for each
intent, the idle intent and the common trigger of the other three kits) and
Glide (pressed with E cooling down and aimed 4 m straight away with no aim
error, after E when both are ready, the landing order behind a wall, a low wall
that skips a direction, the boxed-in corner where nothing is pressed and the
walk goes on, a root, and the sim starting the dash away from the target and
ending it 4 m off); `openers.test.ts` Binding Sigil (Q at 5.95, 6 and not at
6.05 m of an ally, in any direction, no ally, herself not counted, a dead ally,
a champion of the other team) and Quiet Dart at a kitted Lumeth (Q while Lantern
Burst or Glide is ready, M2 with both cooling down; a Lumeth with no kit still
gets M2); `profile.test.ts` her profile (6 and 11 with her kit, 6 and 10
without) and her row; `reach.test.ts` the bolt with no `effects`. Mutations that
turn each red (each applied alone to the head): the comparison of the trigger
made strict, the intent clause dropped, the literal moved to 4, to 3.1 and to
2.99, a kite at 5 m made an escape think by the literal 6, the common kite
clause added to her trigger; the near-ally literal moved to 5 and to 7, its
comparison made strict, the condition dropped, herself counted or a dead ally
counted; the path test of Glide made the line of sight, the landing order
reversed, `findLanding` true when none passes, the aim override dropped, the
dash hold applied to Glide, the escape order `['SPACE', 'E']`, and the
empty-effects line of `reach.ts` dropped.

The rules of #112 (the ally slots and the aim at an ally): `ally.test.ts` pins
them on frozen states of the shipped kits, with `scenes.ts` giving a scene an
ally and its missing health. Soothing Surge (M2) is pressed at an ally 9 m off
that is missing 14 and not at 13, within 9.133 m and not at 9.2, not behind the
pillar and pressed where nothing is in the way, never at an enemy or at herself,
not at a dead ally or one of the other team, and never on an idle think. Of two
allies the one with the lowest health fraction is the one, a tie going to the
lower id, and only among those that qualify. Mend Bolt (M1) goes at an ally that
is missing 10 and at the enemy when it is missing 9, at an ally within 11 m and
at the enemy past 11.05, at an ally with the enemy out of its band, and at the
enemy when the ally is behind the pillar. Aegis Veil (R) and Dawnbloom (F) are
pressed for an ally or for herself within 4.5 m that is missing 30, not at 4.55
m or 29, F only at 100 energy, and never for an enemy 3 m away with nobody hurt;
both aim at the enemy. The aim equals the reference chain of aim.ts at the ally,
led with the bolt's own speed (16 and 20 m/s); a stepped scene shows the heal
landing on the ally after the 18 tick windup; the aim falls back to the enemy
when the ally dies during it and is the enemy's again once no cast is in
progress; a Mend Bolt pressed on the tick Soothing Surge fires aims for the
Surge and then holds its own ally; and a Glide pressed on that tick still aims
at its landing. The run of an ally slot goes on when another ally takes over,
and the cache holds the kind, the reach, the need and the shot width of the four
slots, no enemy band for F, and no ally slot for the other three kits.
`profile.test.ts` pins her `allies` list. Mutations that turn each red (each
applied alone to the head): the need compared strictly, the margin dropped, the
clear shot dropped, the highest health fraction chosen, the tie order flipped,
herself allowed for a bolt, a dead ally counted or one of the other team; Mend
Bolt aimed at the enemy first or its run ignoring allies; the windup hold
dropped, never cleared or kept for a dead ally; a press on the firing tick
re-aiming it, the areas aimed at the ally, the landing override dropped;
the reach of R and F made 4.6 m, the need of R and F made 29, of M2 13, the
reach of M2 made 10 m, the width of the bolts made 0.5; F's enemy band kept; an
ally switch restarting the run; the ally arrays taken from the kit alone,
whatever the rule lists; and the allies list emptied.

The rules of #137 (the dodge): `dodge.test.ts` pins them on frozen states of a
champion with no kit that stands 6 m from its enemy, so every move is a dodge,
with the sim as the oracle of every reach, hit sweep and miss (`sweepOfHit` of
`scenes.ts` steps a clone with the bot standing). Per tier: a dodge from the
think `delay + castDelay` on (45, 23, 9) and none before it, by a seed whose
coin falls within 0.02 under the chance, a non-dodge by one within 0.02 over it
(with the values next to the coin on the other side by 0.05, so a coin one place
early or late flips), the aim stream replayed with `createRng` (the coin after
the aim draw, once, and the next aim block on the next value), and a stepped
scene where the bolt misses a yes bot and hits a no bot. Edges: the reach at
0.79 and 0.81 m and with a 0.6 m bolt (1.09 and 1.11 m), the hit sweep as
lifetime (15 dodges, 14 does not), a bolt already overlapping or touching, one
moving away or across, a diagonal bolt, the own team's bolt (a heal included),
an ally bolt with empty or with non-empty `effects`, a piercing bolt that has
hit the bot, a wall before the contact point (no dodge) and behind the bot or a
low wall (dodge), both sides and the tie, the diagonal sectors, the first side
in a wall, in a blocked cell that holds a legal point, grazed by a post along
the segment, and both sides blocked; two threats (the earlier hit, the lower
index on a tie, one coin per projectile in index order, a no coin skipped); a
bolt that appears later (the reaction counts from its first sight); the memo
cleared on a kit-cache rebuild; no move on an idle or a dead think; and the move
rewritten alone (intent, aim and buttons equal a bolt-free run). Mutations that
turn each red (44 run, alone, on the head): the radius or the champion radius
dropped, the reach moved by 0.02, `c > 0` made `>=` or dropped, the closing test
dropped, the lifetime compared strictly, with a sweep more or not at all, `ceil`
as `floor` or `round`, the line of sight dropped or taken to a point 3 s on, the
own team, the ally rule (either form) or `hitIds` dropped, the reaction moved by
one think, made `>` or dropped, each chance moved by 0.05, the coin drawn on
every think, at first sight or before the aim draw, the side inverted, the tie
flipped, the perpendicular flipped, either clearance test dropped or both, the
second side never tried, a later hit or a tie for the later index winning, the
first yes winning, the memo not cleared, and the dodge also run on an idle
think. One survives: `u <= chance` (a coin exactly on the chance cannot be set
up). `touching.test.ts` pins the tolerance of `geometry.ts` on the state of the
stall it fixed (a Hargrim at 1.4999999999999998 m from the pillar of arena02 at
(9, -6), against 1.5): not blocked, a clear segment leaves it, a point 1e-6 m
inside is still blocked, and a bot there walks to its enemy behind the pillar;
red without the tolerance. The same file pins the four states of the stalls of
#129 (the Hargrim and Quillon tuning candidates of #124, which turned the
no-stall clause of `lumeth.test.ts` red for 123 to 6003 ticks, section 6.2 of
balance.md): a champion at rest one ulp inside an inflated obstacle, at the
corner of a rectangle in three of them and on the circle (0, -7.5), radius
0.75, in the fourth, at a gap of 5.6e-17 to 2.2e-16. Each state has both
sides: the goal side, a bot chasing an enemy that stands there (its cell is
blocked, so the follower needs `nearestFreeCell` from the goal point, which
needs a clear segment from it), and the start side, a bot standing there that
must plan out of its cell. A row asserts that the oracle clearance is a hair
below 0, that `pointBlocked` is false there and that a hard bot walks on each
side, in a test of its own (69 thinks, seed 1, the shipped kits). Without the
tolerance every row is red, both sides included; with the rect limit of
`obstacleShapes` without it the three rect rows are red on both sides (the
walk) and the circle row is green; with the rect branch of `overlapsObstacle`
without it only the `pointBlocked` asserts of the three rect rows are red and
the walks stay green. The architect of #129 replayed 600 ticks from a snapshot
of each, in scratch scripts that are not in the repository (the figures that
follow are that architect's scratch evidence, in
[the #129 comment](https://github.com/sv-tmueller/claudeline-champions/issues/129#issuecomment-6273751736)):
the bots before the dodge and the tolerance stalled for the 600 ticks
(142 on the circle), those with the tolerance and no dodge and those of today
for 15, which is a fresh bot's delay ring starting on idle and no stall, and
those with the dodge and no tolerance for 600 (300 on the circle). So the
tolerance of #137 resolved the four and the dodge did not; no rule was missing
in the bots.

The same file pins the stand of #123, the match of seed 6 (Quillon against
Skerrow, 3v3, arena 1, Lumeth and Hargrim as fill) that ran to the tick budget
and the eight H3 seeds of section 5.8 of balance.md that did the same. On the
bots of 9a9c653 all nine are one state, not the end ring's: a Hargrim rests one
ulp inside the inflated circle of the centre pillar, (0, 0) with radius 1.5 and
the champion radius 0.5 (|p| = 1.9999999999999998 in seed 6, 1.9999999999999996
in seed 98), so `nearestFreeCell` reached no cell from it, the follower of the
Hargrim at the pillar and that of the enemy Hargrim both got no points, and the
two stood. In seed 6 the pair stood from tick 480, before the ring of the round
clock closed around it; the ring was incidental. Nothing was wrong with any
press: at 2.139 m an M1 is out of reach (the band top of 3 m less the margin of
1 leaves `rangeMax` 2), so the engage case walks in, and that walk is what
failed. Two rows of `RECORDED` hold the states at tick 20000 (seed 6: A at
(0.0855, -1.9982), B at (2.0015, -1.0464); seed 98: A at (0.2539, -1.9838), B at
(1.2433, -1.8387), 1.0 m apart, touching) and take the same four asserts as the
rows of #129. A stepped scene, "the end-ring stand of #123, stepped", puts the
two Hargrims of each row on free play with a normal, hard or easy bot each (bot
seeds 601 and 603) and steps the sim: the first move comes within the reaction
delay plus one think, a Hargrim presses, a damage event between the two
follows, and one of them dies within 1400 ticks (twice the slowest death
measured, 697 ticks on easy in seed 6 with the bot seeds 602 and 605, rounded
up to 100; the seeds of the test give 587 on normal since #186, 618 before). Without the tolerance
(`TOUCH = 0`) every new assert that reads the bots' geometry is red:
`pointBlocked`, the walks on both sides, the stepped scene and the stall
tracker's row below (the clearance asserts read only the test's own oracle and
stay green); with the circle limit of `obstacleShapes` without it the walks, the
stepped scene and the tracker row are red and `pointBlocked` is green; with the
circle branch of `overlapsObstacle` without it only the `pointBlocked` asserts
of the two rows are red (as in #129 with the rect branch, the segment test
decides the walks). The figures that follow are the scratch evidence of the
architect of #123, in scripts that are not in the repository (in [the #123
sub-plan](https://github.com/sv-tmueller/claudeline-champions/issues/123#issuecomment-6417700905)):
main's bots (normal tier) taken over each of the nine frozen states move on the
first acting think (+15 ticks), press within +24 to +27 and end round 1 within
+321 to +843 ticks; a copy of main's bots with `TOUCH = 0` (the dodge still on)
stands for 6000 ticks in all nine, so, as in #129, the tolerance resolves the
stand and the dodge does not; and the whole H3 cell on main, seeds 1 to 100 in
both fills (200 matches), has no budget hit.
No rule was missing in the stand; one press was refused: the bots tested a
Hargrim M1 for a clear shot of 0.5 m, while the sim's melee arc ignores
obstacles (`melee.ts`), so the touching pair of seed 98 (1.0 m, the pillar
clips a shifted line) pressed no M1 and walked on, which was no stall on main
(the scene ended in 446 ticks). #186 settled it: a melee arc gets no clear-shot
test (see Clear shot), the pair presses M1 on the first think after the cast
delay and the scene ends in 451 ticks (the rule of #186, below). The harness row of
`tools/balance/harness.test.ts` plays the match of seed 6 through `playMatch`
and asserts that it ends in a decision (no end tick is pinned). It is green on
main and red on the bots of 9a9c653 (budget hit, 60000 ticks), which a scratch
copy of that commit shows, but not under a mutation of the tolerance: without it
the full match takes another course (it ends at tick 5769, not 5096) and never
reaches the stand, so the frozen, stepped and tracker rows carry the mutation
reading.

The rule of #186 (`melee.test.ts`, the `MELEE` keys of `press-oracle.ts`): a
press whose ability's first top-level effect is a melee arc gets no clear-shot
test (see Clear shot). Two outcomes were open, the exception and a rule that
stays with a note on why a bot refuses a hit the sim grants; the exception is
chosen (decision 3 on #203) because the sim's arc is the truth: a bot makes the
input a human makes, and a human Hargrim lands that M1. The frozen scene is the
seed 98 state of #123, copied literally from `touching.test.ts`: two Hargrims
1.0 m apart on arena01 with the centre pillar on the line, a line of sight, no
clear shot of 0.5 m from either side and a clear shot of 0.25 m. On main
(8ce78fd) a Hargrim with only M1 ready presses nothing there, on any tier and
from either side, and with every slot ready at 40 energy it presses nothing at
all. With the rule M1 is pressed on the think after the reaction and cast delays
(think 45, 23 and 9, counted from 0, on easy,
normal and hard), and stepped from that press the
sim's arc names the other Hargrim and deals 12. In the same state Skerrow M1,
Rend and Rend's EX variant (at 25 energy) are pressed. The rows that keep the
0.5 m test, in the same state: Hargrim M2 (an area) at 0 and at 40 energy, the
EX Lunge (an arc after a dash) at 25, Reaper's Dance (an arc after a teleport)
at 100 energy against a target at 40 health, and Hargrim F. Two edited Skerrow
kits read the base and the EX flag apart, as the dash hold of #98 does: an arc
base with a 0.6 m bolt EX presses the arc at 24 energy and refuses the EX bolt at
25, and a 0.6 m bolt base with an arc EX refuses the base at 24 and presses the EX
arc at 25. The oracle of the headless runs skips the line of sight and the clear
shot for the four `MELEE` keys (Hargrim M1, Skerrow M1, Rend and its EX variant,
which a table test of `headless-kits.test.ts` works out again from the kit
files), and two direct rows call `pressProblems` on the same state: the M1 press
has no problem, and a Hargrim M2 press still reports "no clear shot of width
0.5". No seeded run presses a melee ability with no clear shot (the Lumeth runs,
the 18 six-kit cells and the shipped headless mirror: none), so the exception
needs these rows. `melee.test.ts` is red against main's `casting.ts` (12 of its
20 rows; the counter rows, the oracle rows and the facts row pass there). Six
mutations, each applied alone and then restored: the flag never set (12 red,
the pressing rows, the landing and the two edited kits); the EX press reading
the base flag (the two edited kits); the flag set for an arc anywhere in the
ability (the EX Lunge row and the Reaper's Dance row, each red alone with the
flag set for its own half);
the flag set for areas (the M2 row, the every-slot row and the Lumeth headless
run's oracle); the oracle's exception dropped (the direct M1 row) and applied to
every key (the direct M2 row). The heap check reads 0 B per think in every scene
(Node 22 `--project bots-heap`; Node 26.7.0 both projects), and a six-double
object kept at the melee branch of `updateRuns` reads 168 B in the engage stand
scene on both (also in skerrow engage, and 336 in skerrow wait), so an existing
scene reaches the branch.

What moved. The identity harness (the 16 rows of PR #142's harness, run on
main's `packages/bots/src` and on the branch) moves none: headless fb22c35a5f68,
stall 023b25dc3b04, kits 803c0466d16b, kits301 7caa05ab704f, kitsHard
21dc77500889, kitsEasy 49a4540e98b4, kitsSwapped be866c24b934, kitsSeed99
42d095f016c6, plain1200 3ad008d826fb, plainOther fc396896b5ae, kitsLowEarly
c9914a11d463, kitsLow2 f68ca6808815, plainLow 8f9a01c750c4, skerrow
d55b53efc5e5, lumeth2v2 06749c0ade0a and lumeth3v3 071221f5026e, the same old and
new (the first diff tick is none). The seeded runs that move: the Lumeth 2v2 on
arena01 ends at tick 5081, not 6623 (its budget 16000 and the harness row of
`tools/balance/harness.test.ts` are re-recorded, as PR #142 re-recorded its
pins), the other three Lumeth ticks (7521, 6773 and 10934) stand, Brimwick v
Skerrow on arena02 ends at 2351, not 2323, and Ondrel v Quillon on arena02 and
Brimwick v Skerrow on arena01 change their streams but not their end ticks
(5533 and 4057); the literals of the six-cell rows are records of when each
budget was set and stand. In the stepped scene of #123 the normal tier ends seed
6 at 587 ticks, not 618, and seed 98 at 451, not 446.

The rider: are the low standings of Hargrim (11.4) and Skerrow (13.7) in the
six-kit block explained by refused presses? No. The measurement plays the 36
cells of the block where Hargrim or Skerrow is X or Y on the block's own
schedule (seeds 1 to 50 for each 2v2 config, 1 to 16 for each 3v3 config, normal
tier, bot seed `seed * 100 + id`: 7 056 matches a side), with main's
`packages/bots/src` before and the branch after, in scratch scripts that are not
in the repository (their text is in the body of PR #208). The before side
reproduces the committed rates of all 36 cells. A press is counted on the think
whose input carries the slot's bit; a refused think is one on which every gate
of the press held (a round phase, an acting intent, an alive enemy target
within the band top less 1 m, a cooldown of at most 1, no stun or silence, no
windup or `windupLeft` 1) and the 0.5 m clear shot failed, and an episode is a
run of consecutive refused thinks of one champion and slot.

| Slot | Presses before | Refused before | Presses after | Pressed after with no clear shot |
| --- | --- | --- | --- | --- |
| Hargrim M1 | 104 284 | 928 episodes (0.9% of presses), 5 281 thinks (1.2% of the ready thinks) | 104 482 | 236 |
| Skerrow M1 | 82 758 | 728 episodes (0.9%), 2 031 thinks (0.5%) | 82 867 | 64 |
| Rend (Skerrow E, EX pooled) | 25 457 | 933 episodes (3.7%), 4 853 thinks (2.6%) | 25 530 | 86 |

Lifting the refusal adds 198, 109 and 73 presses over about 105 000, 83 000 and
25 000, and the mean rate over each kit's 20 cells goes from 11.5 to 11.8
(Hargrim) and from 13.7 to 13.9 (Skerrow); 18 of the 36 cells move, the largest
by 5.7 points (3v3 on arena02, Brimwick v Skerrow, 88.5 to 82.8; Quillon v
Skerrow 95.3 to 90.6), none across the band and none to a budget hit. The
regenerated block (balance.md, 5.10) puts Hargrim at 11.7 and Skerrow at 13.9
over all their cells. So refused presses are about 1 percent of the melee
presses (3.7 for Rend) and do not explain the standing: it moves by tenths of a
point.

The diagnostic that names the next step: over the 60 cells of the block on a
seed subset (seeds 1 to 8 in 2v2 and 1 to 2 in 3v3, after the change), per kit,
over its alive round thinks.

| Kit | Acted target within rangeMax | Damage dealt per alive second | Damage taken per alive second | Thinks retreating |
| --- | --- | --- | --- | --- |
| Hargrim | 33.5% | 8.56 | 16.06 | 34.0% |
| Skerrow | 21.9% | 10.25 | 15.29 | 31.1% |
| Quillon, Ondrel, Brimwick | 90.3%, 80.1%, 81.5% | 10.54, 10.54, 9.46 | 6.29, 8.55, 6.65 | 10.9%, 13.1%, 10.8% |
| Lumeth | 87.6% | 4.63 (and heals) | 5.34 | 10.2% |

The melee kits deal about as much damage per alive second as the ranged ones
(8.6 and 10.3 against 9.5 to 10.5 for the three ranged damage kits; Lumeth's is
mostly heals), take two to three times the damage (16.1 and
15.3 against 5.3 to 8.6 for the four), have the target within their reach on a third and a
fifth of their thinks (against 80 to 90 percent) and spend three times as long
retreating (31 to 34 percent of their alive thinks against 10 to 13). The
reading: the melee kits are exposed while they close and while they retreat,
and not blind at the point of the press. The next bots step moves the approach
and the retreat of the two rangeMin-0 profiles (the walk-in of the engage case
and the spawn retreat of the 0.3 and 0.36 health thresholds, see Decisions) before
any kit change or roster-v2 rewrite. This is a reading of one scratch
diagnostic: no share of any cell is stated as the cause, and the decision
stays with the lead.

The seeded matches of #112 (`lumeth.test.ts`) play Hargrim and Lumeth against
Hargrim and Quillon, and the client's 3v3 (Hargrim, Quillon and Lumeth a side,
`configLumeth3v3`), to matchEnd with 3 rounds to win on arena01 and arena02:
seeds 101 to 104 (101 to 106), every bot on normal, match seed 7. They run
through `play` of `press-oracle.ts` (the press oracle above, moved out of
headless-kits.test.ts so that both files use it): every press passes the oracle
(a press in the warmup or the pause between rounds is explained, because `step`
ignores buttons there), the invariants hold, `think` leaves the checksum alone,
no bot stalls for more than 120 ticks and no escape teleport is blocked. Each
match ends within a tick budget by the formula of the client's rows: the end
tick when the budget was set (5081, 7521, 6773 and 10934: the first moved from
6623 with #186, the others stand on the bots of #137),
plus two rounds of
the longest round that did not go to sudden death, rounded up to 100 (1700 in
the 2v2 runs, whose longest is 1619, and 2900 in the 3v3 runs, the client's
longest for the same roster, 2801), and one of 7000, rounded up to 1000 (16000,
18000, 20000 and 24000; the first was 18000 before #186); a run whose longest round passes its term fails. Every
run has
a Lumeth heal an ally; across the four, Soothing Surge heals an ally, Aegis Veil
is cast, Mend Bolt hits an enemy, and Lantern Burst and Glide are pressed (both
in the 3v3 on arena02). The two start-edit runs of headless-kits.test.ts stay as
their declared fallback (a miss is governed by decision 8.3 of batch #53). The
seeds, tiers and budgets are pinned. The sim's ability watcher has the matching
rows: a projectile hit on the owner's team needs `allyEffects` and a target that
is not the owner, a hit on an enemy a non-empty `effects`, and energy for an
ally other than the caster a support kit and a heal that restored health in the
same step.

The rules of #165 (the Ondrel and Brimwick profiles), pinned on frozen states of
the six shipped kits (`sixKits()` of the helpers; `rosterKits()` keeps its four,
so a champion with no kit still reads none). `profile.test.ts` reads their rows
(5 and 9, 7 and 10 with a kit, derived: an M1 of 21 m/s for 30 ticks gives 9.5;
the table with no kit, no band or another id; the fallback when the derived
maximum is at most `rangeMin`) and freezes them; `openers.test.ts` Undertow (E
at 4, 5 and 7 m at a target walking away, not at 7.05, at a target that stands
or closes in, and the EX variant with 25 energy) and Flash Powder (Q at 8 and 9
m at a target closing in, M2 at 9.05 m and at one that walks away or stands) and
Quiet Dart at a kitted Ondrel or Brimwick; `escapes.test.ts` Reed Step (SPACE
aimed 4.5 m straight away at 4.9 m, not at 5 or 5.5 m, on a retreat at 6 m and
not at 6.05 m, ahead of Reed Screen, R alone when boxed in at the north-east
corner or rooted, a low wall that skips a direction, and the sim starting the
dash, dropping the area where she stood and ending 4.5 m off) and Flare Step (6
m, not at 7 or 7.5 m, ahead of Smoke Pot, R alone when boxed in, a low wall that
does not skip, the teleport the sim reports, and the haste on her and the slow
on a target inside 3.5 m); the kite goes on at exactly `rangeMin` and 0.5 m past
it; the streak is one run for the whole order (see Openers and escapes), pinned
for both kits by a target that jumps to 2 m while R's band run builds with R and
SPACE on cooldown, and the two come off cooldown on the think after the first
kite think: SPACE is pressed, not R, red when the gate reads the slot's run
again; and the streak starts again after a break in the kite, after a change of
the acted target and after a dead think with a hand-built revive (the press is
`castDelay` thinks after the first think of the new streak; the revive pins the
zeroing in `bot.ts`, as `casting.test.ts` pins `runs.fill(0)`).
`grand-finale.test.ts` holds Grand Finale (pressed at 55 health, not at 56 or at
a healthy target at 8 m, pressed at a healthy target in the north-east corner,
not against a wall with a way along it; Ondrel presses Drowned Ground at a
healthy target; the reserve spends `M2+SHIFT` at 80 energy at 10.2 m against a
healthy target and holds it against 55 health). `area-lead.test.ts` pins the
lead of the areas on the sim (see Aim). Mutations that turn each red (each
alone, restored after): the `PROFILES` row, the `KIT_RULES` row or the `RULES`
row dropped, `rangeMin` moved to 4 or 6 (Ondrel) and 6 or 8 (Brimwick), either
`holdF` flipped; the motion of Undertow or Flash Powder dropped or inverted,
either band moved to a literal one metre off, either opener dropped; `<=` for
`<` in the held test, the damage read as 54 or 56, the cornered test dropped;
the kite trigger made inclusive, either escape order reversed, the path test of
Reed Step made the line of sight, that of Flare Step made `segmentClear`, the
aim override dropped, `findLanding` true when none passes, the streak gate
returned to `runs[i]`, the streak not zeroed on a change of target, the streak
not zeroed on a dead think, the streak never reset; the lead dropped, doubled or
taken from 10 m/s; an object per escape gate (168 B in the two escape scenes of
the heap check).

The seeded matches of #165 (`ondrel.test.ts` and `brimwick.test.ts`, over
`six-cells.ts`, so Vitest runs the two in parallel) play each new kit, with a
filler of Hargrim (Quillon when Hargrim is one of the two), against each of the
four shipped kits with the same filler, on arena01 and arena02: 8 cells each,
and Ondrel against Brimwick on both arenas as two more in the Ondrel file. Team
A is the new kit and the filler; seeds 101 to 104, match seed 7, every bot on
normal, `roundsToWin` the default (3), played to matchEnd on the six kits. Every
press of every tick passes the oracle (`SIX_SET` of `press-oracle.ts`,
`LUMETH_SET`'s pattern), the invariants hold, `think` leaves the checksum alone,
no escape teleport is blocked, no bot stalls for more than 120 ticks (the worst
is 28), each match ends on 3 rounds before its budget, and no round that did not
go to sudden death runs past its term (the formula of `lumeth.test.ts`, per
cell). The end ticks and the longest ordinary round of each cell, which set the
budgets: Ondrel against Hargrim 4292 and 1009 (arena01), 5573 and 1444, Quillon
5126 and 1470, 5533 and 1023, Lumeth 4924 and 1607, 6725 and 1313, Skerrow 3281
and 1105, 2510 and 621, Brimwick 3703 and 1027, 6098 and 1152; Brimwick against
Hargrim 4046 and 1412, 4347 and 1039, Quillon 4802 and 1028, 3787 and 800,
Lumeth 6551 and 1710, 6159 and 2325, Skerrow 4057 and 1226, 2323 and 552. Across
a kit's cells every slot but F is started (M1, M2, SPACE, Q, E, R). Ondrel
dashes away in each of the 8 cells without another dash escaper (her own
`glides`, since Lumeth's Glide counts in the others), and Brimwick casts Flare
Step in all 8, each cast an escape because it has no band, no ally row and no EX
(`slots['brimwick:SPACE']`, not `tally.escapes`, which counts Quillon's Skip and
Skerrow's Vanish Step too). Each alone, these turn the rows red: champion 0's
dash escapes left out of `glides` (the earlier summed row stayed green on
Lumeth's three Glides), champion 0's SPACE casts left out of `slots`, and a band
added for `brimwick:SPACE`. F never fires in them, as the 2v2 of the first kits
never did, so two declared start edits (the precedent of Reaper's Dance) run the
whole play loop with the oracle's F row: Brimwick at 100 energy with both
enemies at 55 health starts Grand Finale, at 56 it does not in 3600 ticks, and
Ondrel at 100 energy starts Drowned Ground. A miss after a change to the bots,
the sim or the Node version is governed by decision 8.3 of batch #53, with the
declared fallback of a duel at 9 m. Two more start edits give the oracle's
escape rows their cases: a rooted Ondrel with an enemy 2 m off, or boxed in at
the north-east corner, with Reed Step ready, presses Reed Screen.

The oracle got three extensions (test code only; the first red of the seeded
runs found the reason for each). A slot that is both an escape and a slot with a
band of its own (Ondrel's SPACE and R, Brimwick's R) passes as an escape when
the trigger holds and otherwise as an ordinary press on its band; before, the
escape branch alone ran and a press on the band at 0.9 m was a red. The `after`
check of an escape row accepts a dash (`after: { slot: 'SPACE', teleport: null,
dash: 4.5 }`): Reed Screen fails the run when Reed Step is ready and
`oracleDashLanding` finds a landing, and a rooted champion counts Reed Step as
not ready. And the widened turn-order condition above. The escape rows: Reed
Step is `{ teleport: null, dash: 4.5 }` with no `after`, Reed Screen follows it,
Flare Step is `{ teleport: 6 }`, Smoke Pot follows it; the held table has
`'brimwick:F': 55`, the dash set has `'ondrel:SPACE'`, and the literal
`RANGE_MIN` has 5 and 7. A table test in `headless-kits.test.ts` works every
literal of the two kits out again from `ondrel.json` and `brimwick.json` (the
reach of each bolt and area, the shot width, the opener motions, the escape
rows, the held damage, no hold for Drowned Ground), so a change to a kit or a
row fails it. Mutations of the oracle that turn something red: the either-or
dropped (Ondrel against Skerrow, 2 cells), the `after` check as it was (the two
start edits), without the root clause or without the dash landing (one each),
the Ondrel dash row without its `dash` and ten rows or literals of the tables
(each one test of the table test), the held literal at 54 (the Grand Finale
run), and the old turn-order condition (the hand-built state).

The win rates are re-measured for the six-kit balance report (the harness
roster is six since #189, and `balance.md` section 5.9 reads the same pairings
on 200 matches a cell). A scratch test, not committed (it is the design of
#155's check), plays 9 pairings with every other kit as the
filler of both teams, on both arenas, seeds 1 to 10 (the match seed, the bots'
seeds 100 times it plus the id), normal tier, the teams alternating by parity:
720 matches. The first kit's wins out of 80, and the longest match, before the
profiles (`main`, the rules of #148 only) and after (the profiles and the
streak):

| Pairing (X first) | X wins before | X wins after | Longest match before to after |
| ----------------- | ------------- | ------------ | ----------------------------- |
| hargrim v ondrel  | 0 of 80       | 0 of 80      | 6085 to 6447                  |
| lumeth v ondrel   | 60 of 80      | 69 of 80     | 12872 to 7874                 |
| quillon v ondrel  | 45 of 80      | 61 of 80     | 8725 to 11960                 |
| skerrow v ondrel  | 1 of 80       | 1 of 80      | 6466 to 7880                  |
| hargrim v brimwick | 0 of 80      | 5 of 80      | 5169 to 10217                 |
| lumeth v brimwick | 61 of 80      | 71 of 80     | 7220 to 11540                 |
| quillon v brimwick | 49 of 80     | 61 of 80     | 10191 to 9696                 |
| skerrow v brimwick | 0 of 80      | 2 of 80      | 6108 to 12324                 |
| ondrel v brimwick | 45 of 80      | 38 of 80     | 9188 to 9350                  |

No budget hit before or after, and the worst stall is 37 ticks before and 33
after. Against roster-v2's counter web the profiled Ondrel matches it against
Hargrim and Skerrow (she wins 80 of 80 and 79 of 80) and Quillon and Lumeth (she
loses 61 and 69 of 80), and wins 38 of 80 against Brimwick where the roster has
her win; the profiled Brimwick comes out the opposite of the roster on four of
four (she wins 75 of 80 against Hargrim and 78 against Skerrow, and loses 61 to
Quillon and 71 to Lumeth): a matter of the kits and of the six-kit balance
report, not of the bots; the report (`balance.md` section 5.9) measures the same
inversion in all 16 cells of those four pairings.

The identity harness (the "harness text" of the body of PR #142, 16 rows) is
unchanged by the profiles and the streak: none of its 16 rows has an Ondrel or a
Brimwick, and for the four kits the streak reads the same as the slot's run.
Hashes before and after are the same for every row, and so are the input streams
(`cmp` on `hashes-*.txt` and `streams-*.json`).

A heap check, `packages/bots/test/allocation.test.ts`, pins the Allocation
section. It builds nineteen frozen scenes on arena 1 with the six shipped kits (a
press, an engage stand, a path follow past the age of the segment test, a kite
with no clear shot, a kite step, a retreat, the deadlock rule's advance, flee
and latched stand, an opener press, an escape press with its landing search, a
Skerrow engage with F held, a Skerrow wait, the stand with its clear shot and
the Quiet Dart cue on every think, and a Lumeth escape: the 3 m trigger, the
near-ally scan, the dash landing and the aim override on every think, a Lumeth
heal: the ally scan of her four ally slots and the aim at the ally on every
think with Soothing Surge pressed on each, and a Lumeth windup: the same with
its cast in progress, so the ally is held through the windup on every think,
an Ondrel escape: a kite inside 5 m with Reed Step ready, the dash landing
search and the aim override on every think, a Brimwick escape: a kite inside 7
m with Flare Step ready, the landing search for a teleport that is not fixed
and the aim override on every think, and a dodge: a Quillon standing with two
bolts at her, one along an axis and one on a diagonal, so the threat scan of
both and the sidestep run on every think), warms each bot up with 20000 thinks,
settles it in the default tiers (windows read like a round until one is under
the bound, at most 20, which decide nothing: a series that falls is a late
tier-up the settle absorbs, a series flat through the cap is a state it does not
cure and the log line names; see The default tiers on the runner) and reads
`process.memoryUsage().heapUsed` around one `think`, 600 samples per round. The
figure of a round is the median delta minus the median delta of an empty pair of
reads taken in the same loop, just before each think (a call of
`process.memoryUsage()` allocates its result object, 144 B in a tier that does
not optimise it away, and a pair read in another function sat in another tier
and moved a scene by 144 B on Node 24), and the lowest of three rounds of every
scene must be under a literal bound, 128 B per think. The think before the
rewrite (b09b437) read 4 to 56 KB per think; the current think reads 0 B, and
the bound sits between the two. The test also reads the sim's baseline step
against the floor of the sim's own check, which proves the counter moves, and it
checks that `think` leaves the checksum alone and that every scene stayed in its
intent. It gates on the native runner and not on the Linux container (batch #53
decision 12). Differential tests keep the allocation-free forms honest: `hypot2`
and `distanceInto` against `Math.hypot`, `lineOfSight` against the sim's
`hasLineOfSight`, and `segmentClear` against a copy of the implementation
before the rewrite and against the sampled clearance oracle. The test helpers
copy every input a bot returns, and a guard counts one distinct record per bot
per tick, since a stream of aliases would compare a few objects with
themselves.

A plan check in the same file reads the median `heapUsed` delta around one plan
step of the path follower, `followPathInto` on a fresh follower (the search, the
string pull, `splitPath`, the goal copy and, at an end in a blocked cell,
`nearestFreeCell`), over 600 start and goal pairs spread across arena 1, minus
the empty pair, on two spreads: clear (both ends in free cells) and fallback
(both ends at legal points inside blocked cells); all 600 pairs of each plan.
The lowest of three rounds must be under 2950 B (clear) and 2300 B (fallback).
Before the scratch the search read 55980 to 56436 B (clear) and 39288 to 39796 B
(fallback) per plan on Node 22. It now reads, as the rounds read: clear 2784 to
2800 B on Node 22 and 2784 B on Node 26, fallback 2072 to 2132 B on Node 22 and
1920 to 2064 B on Node 26. That is the output, about 46 objects of 56 B for a
path across the arena, in an array made at its final length: while `splitPath`
grew its array by push and the fallback copied it with a spread, Node 26 (V8
14.6) read 2904 to 3176 B on the fallback spread against 2280 B on Node 22, and
no one limit held on both. A fresh six-double object kept in a module variable
goes over the limit on both Node majors (lowest round, clear and fallback,
within 100 B between them) per edge test (44260 and 22792 B), per open push
(25716 and 14224 B), per point of `splitPath` (7320 and 4920 B) and per segment
of `splitPath` (3200 and 2400 B), and per cell of `nearestFreeCell` (19636 B,
fallback). Two mutations are at the edge and not guarded: per call of `plan`,
`findPath` or `pullString` reads 2952 B on clear, 2 B over the limit on both
majors (clean 2800 B on Node 22, 2784 B on Node 26), and per call of
`nearestFreeCell` is red on Node 22 (2400 to 2408 B on the fallback spread,
clean 2072 to 2132 B) but at the limit on Node 26 (2400 B in one run, 2256 B in
another, against 2300 B; clean 1920 to 2064 B), and invisible on clear. The
fallback limit stays 2300 B: 2200 B would leave Node 22's clean figure a margin
of 3 percent. A smaller object per plan or a typed array per search is not
measured and is the limit of this check, as a two-double point is for the think
bound. The steady-state scenes cannot see what only Maglev boxes (see
Allocation, In the browser). A fresh six-double object kept in a module variable
at each rewritten site of the think (`steerTowardInto`, `cellIndexAt`,
`clearShotWith`, `needsPlan`, `aim`, `segmentClear`) reads 168 B or more in the
scenes that reach it, and the same object in each new path of #98 (`waitsFor`,
the target's escape test, the Quiet Dart condition) reads 168 B in the skerrow
wait scene, and in each new path of #106 (the dash landing search, the near-ally
scan) 168 B in the lumeth escape scene on Node 22 and Node 26, and in each new
path of #112 (the ally scan, the aim at an ally that is pressed, the ally held
through a windup) 672 B (four slots of 168), 168 B and 168 B in the lumeth
scenes that run it, on both majors. A double argument to `waitsFor` read 16 B a
think on Node 26, so it takes the distance as a measure. The two scenes of #165
(Ondrel's Reed Step and Brimwick's Flare Step escapes) read 0 B in every round in
the default tiers on Node 22, 24 and 26 and in Maglev alone on Node 26.7, so the
non-fixed teleport of Flare Step (`Math.min` in `teleportEndInto`) does not box
there; the same object kept per escape gate (the line of the streak test in
`chooseEscape`) reads 168 B in each of them, and 336 B in the kite step scene and
Lumeth's escape scene, 168 B in the escape press scene, on Node 22.

The same file runs in a second project, `bots-heap-maglev` of
`vitest.heap.config.ts`, on Node 26.7 (V8 14.6) with `--maglev --no-turbofan
--no-concurrent-recompilation --no-use-osr`: Maglev alone, the tier a browser
match runs the bots in. The last two flags switch off background compilation
and on-stack replacement (OSR), which the browser keeps on, so the check
measures what Maglev's code boxes and not how the browser tiers the bots up:
that is the live probe's job (the Allocation section has
`--no-concurrent-recompilation` moving which functions box in the browser).
They are there because the figures otherwise depended on when V8 compiles a
function and when it replaces a loop of the test on the stack: on a loaded host
the draw block below read 480 B and a -0 pin 32 B in some runs of a clean tree
(4 of 18 and 15 of 36 tests, six copies in parallel), and once in about twenty
runs on the runner with the first flag alone. With both flags none of 27 copies
read it locally, and the final head's job was green in 5 of 5 runs on the
runner. That timing is the likely cause and not a proven one: Rosetta and
Docker did not reproduce the runner, and a hardware difference is not excluded.
The limits are literals of their own: 8 B a think for the scenes (they read 0
B; the smallest mutation is one 16 B box a think), and 2900 B clear and 2500 B
fallback for the plan step (clean 2784 B and 2400 to 2416 B: Maglev allocates a
little more for a fallback plan than the default tiers do). A guard fails with
the flags a worker lacks, or a V8 below 14, and a control, a loop of `hypot2`
calls whose result goes into a Float64Array, must read at least 16 B a call (it
reads 40 B), so a run that reads 0 B has not lost its tier. The project needs
Node 26: on Node 22 the whole config is red by design (the guard and the Maglev
checks fail on V8 12.4), and the Node 22 command is `--project bots-heap`.

The draw block reads the press scene in blocks of 15 thinks, one aim draw each,
the median of 600 blocks, since the per-think median hides the draw: 16 to 32 B
with `rng.next`, 0 B with the draw written out in `aim`, limit 8 B. The two -0
pins warm the press scene and the escape press scene up on whole-centimetre
aims, move the bots 1 to 3 m so that the aim and the landing fall in [-0.5, 0)
cm, count the aims of +0 that result (440 and 1200 of 1200 thinks) and read the
lower of the two windows after the move against 8 B: 768 B (aim) and 288 B
(landing) under `+ 0`, 0 B clean. The mutation table in the header of the test
reverts each fix of a Maglev boxing site alone, on Node 26.7 in Maglev alone,
red in 3 of 3 runs, with the clean figures beside it (all 17 scenes at 0 B, the
plan step 2784 B and 2400 to 2416 B, the blocks and both pins 0 B). Two
mutations stay at 0 B and are listed there as unguarded: `Number.isFinite` for
the final aim test, and `needsPlan`'s distance through `hypot2`.

The dodge block reads the dodge scene in blocks of `castDelay + 1` = 9 thinks
with the two bolts renumbered at the start of each, so each block holds one coin
for each bolt (the scene itself draws a coin once and then never, and reads none
in a measured think); the median of 600 blocks, limit 8 B, 0 B clean. The four
rows of #137 in the header's mutation table, on Node 26.7 in Maglev alone, red
in 3 of 3 runs: a six-double object kept per projectile scanned (the dodge scene
304 B, the block 2736 B) and per sidestep (120 B and 120 B), the coin through
`rng.ts:next` (the block, 32 B: the scene reads 0) and a double argument to
`dodgeInto` (the scene 16 B, the dodge block 144 B and the draw block 240 B). In
the default tiers on Node 22 only the scan row (304 B) is over the bound of 128
B; the other three are Maglev's.

The CI runs the file in its own job: Node 26.7.0 (pinned: a bump means
measuring again) with both projects, and Node 24 with the default tier; Node 22
keeps the check in the unit job. On the runner (an AMD EPYC 7763) Node 26.7.0
reads 0 B in all 17 scenes in both projects, the plan step 2784 B clear and
2064 to 2068 B fallback in the default tier and 2784 B and 2400 to 2416 B in
Maglev alone, the control 40 B a call and the block and both pins 0 B; Node 24
reads 0 B in all 17 scenes and 2832 B clear and 2080 to 2084 B fallback for the
plan step, which are 2688 and 1936 B on its earlier runs, a spread of 144 B:
the limits are 2950 and 2300 B.

A stall tracker in the test helpers counts, per bot, consecutive ticks whose
input has `moveX` and `moveY` both 0, while some alive enemy is reachable on the
grid (a path exists between the free cells nearest the two champions) and the
bot is not in a stand this document describes: engage in range with line of
sight, kite in `[rangeMin, rangeMax]` with line of sight, retreat within 0.5 m
of its own spawn while the team of the bot is ahead or an enemy is in its reach (with
no enemy in reach and the team not ahead the deadlock rule says advance, so that stand
is a stall), or retreat standing in reach of its target with a clear shot (the latched
stand, which casts), or Skerrow's wait (an engage stand from 6 to 8 m with a
clear shot while her SPACE has 2 to 90 ticks left, the oracle's own literals).
The tracker works the team sums and the reach out with its own oracle
(`clearShotOracle`), not with the code of the bot. Idle counts as standing, and
a cornered kiter closer than `rangeMin` counts. Any other tick resets the run.
The tracker also counts the ticks of its worst run by intent, and the no-stall
messages print the counts ("in idle (engage 691, idle 15)"): the intent that
names a run is that of its last tick, so the stall of #129 filed as 706 ticks
in idle was 691 ticks of engage and 15 of idle once the target died.
No bot may stall for more than 120 ticks, in the headless run and in a
corner-start run: the same match with one bot in the north-east corner of arena
1 and a melee champion 2.83 m away on the diagonal, which the old stand rule
left frozen for the whole 3600 ticks. A bot pushed by another champion keeps a
non-zero input and is not counted: local avoidance is not built. A unit test of
the tracker drives it with stub bots and zero inputs over 10 observes: engaging
far from the enemy gives 10, retreating at the spawn while the team is ahead 0,
retreating at the spawn while the team is not ahead and nothing is in reach 10,
retreating at the spawn with an enemy in reach (the target or another one) 0,
with the enemy in range behind an obstacle 10, retreating 1 m off the spawn 10,
retreating in reach of the target with a clear shot away from the spawn 0,
kiting closer than `rangeMin` in sight 10, engaging in range 0, no alive enemy
0, and a non-zero input resets the run. A run of engage and then idle reports
both counts, and a run that ended leaves none in the next. The wait of
Skerrow reads 0 from 6 to 8 m at a SPACE cooldown of 2 to 90, and 10 at 5.95
and 8.05 m, at a cooldown of 0, 1 and 91, with no clear shot, for a Skerrow
with no kit and for a Hargrim. A row on the recorded stand of #123 (seed 6: two
Hargrims 2.139 m apart on arena 1, one ulp inside the inflated centre pillar,
kitted, so `rangeMax` is 2 and neither holds) reads 10 of 10 with the stubs
`engage` at both champions and zero inputs. Its reachability test goes through
the bots' own `nearestFreeCell`, so without the tolerance of `geometry.ts` it
reads 0: the search finds no free cell, the enemy reads unreachable and the
tracker counts nothing. That is why the tracker could not see the stand on the
bots of 9a9c653, where the stall ran to the tick budget, and why the row is red
without the tolerance.

`packages/bots/test/deadlock.test.ts` pins the rule. Unit scenes on frozen states cover
the advance, the stay of a team that is ahead, the tie (a mirror where all four advance),
the sum over the alive champions of the team, the flight when an enemy is in reach, the
walk around a pillar to a sight cell, and the latch with each of its four ends. A match
test replays the final state of the #58 run (health 3, 27, 26 and 13 of 160, 120, 160 and
120, everyone at its spawn, seeds 101 to 104) on both kit sets: the two bots of the team
that is behind are 1 m from their spawns within their reaction delay and a second, and a
death follows within 3600 ticks.
