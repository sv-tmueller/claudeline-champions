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
  free, and every obstacle blocks whatever its `blocksProjectiles` flag. A
  free cell can still lie partly inside an inflated obstacle, so every path
  edge also passes an exact segment test against the inflated obstacles and
  the boundary.
- Search: eight neighbours, no corner cutting, octile heuristic. The open set
  breaks ties by f, then h, then cell index, so a grid and two endpoints
  always give the same path. String pulling keeps the farthest waypoint still
  in line of walk.
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

Utility scoring over candidate intents: engage, kite, dodge a predicted
projectile, retreat, peel for an ally, hold position, use the ultimate. Each
champion has a small bot profile with a preferred range. The kit does not ship
it: the bots derive the range from the kit data (see Profiles), and openers and
escapes are not built. The one finisher is the rule under Finisher below.

Built so far: engage, kite, retreat, plus idle, casting (see Casting) and the advance of a
retreating bot (see Deadlock). Idle means no enemy is alive: the bot stands and keeps its aim.

Target: the bot keeps its current target while it is alive, unless another
alive enemy is more than 1 m nearer. Otherwise the target is the nearest alive
enemy by centre distance; the scan runs in id order and a tie goes to the lower
id.

With `d` the distance to the target, `h` health over maximum health, and
`[rangeMin, rangeMax]` from the profile, scores are clamped to 0 to 1:

| Intent  | Score                                                | Movement                                                                                                                                                                                |
| ------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| engage  | 0.5                                                  | stand when `d <= rangeMax` and the target is in line of sight, otherwise follow the path to the target                                                                                  |
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
bot revived at a new round starts afresh). Why: without a latch a bot behind on health, say a Quillon
against a Hargrim ahead and standing at its spawn, advances until the target is within `rangeMax`,
then the first rule no longer holds, so it steps back out of reach, and again, and its cast run
restarts on every other think and nothing ever lands. The latch is per bot state and is rewritten in
place, so the think stays allocation free.

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
  shot of 0.5 m at a distance in `[rangeMin, rangeMax]`. Ties go to the smaller squared
  distance from the bot, then the lower cell index. With no such cell it follows
  the path to the target, which ends in line of sight.
- No randomness: the aim draw stays the only use of the bot's rng.

Profiles live in `packages/bots/src/profile.ts`, keyed by champion id:
`profileFor(championId, kit?)`. Without a kit the table applies. Hargrim and
Quillon have a rule: with a kit whose id equals the champion id, `rangeMax` is
the top of the base M1 reach band minus the 1 m range margin (see Casting), and
`rangeMin` is the rule's literal, because no kit field holds it: roster-v1 words
it as backing away from an enemy inside 6 m. The table applies instead when the
champion has no rule, there is no kit or the kit id differs, M1 has no band, or
the derived `rangeMax` is at most 1 or at most `rangeMin`. Lumeth, Skerrow and
other ids keep the table even with a kit until their kits exist. `KitDef` has no
profile field and `createMatch` copies only the kit contract, so profiles stay in
bots; the kit JSON must carry no bot fields.

| Champion | rangeMin | rangeMax | rangeMax with a kit   | Note                                    |
| -------- | -------- | -------- | --------------------- | --------------------------------------- |
| hargrim  | 0        | 3        | M1 band top minus 1 m | melee, never kites                      |
| quillon  | 6        | 13       | M1 band top minus 1 m | ranged, backs away inside 6 m           |
| lumeth   | 6        | 10       | the table             | support, keeps range, no ally logic yet |
| skerrow  | 0        | 2.5      | the table             | assassin, closes in and never kites     |
| default  | 4        | 8        | the table             | any other champion id                   |

Every `rangeMax` exceeds 1 m, so a bot never needs to stand inside another
champion. With the test kits Hargrim stands at 2 m and Quillon at 13 m.

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
  would press, or the champion radius 0.5 m when the ability has none.
- A stand (engage, kite), the sight-cell search and the finisher use `c` = 0.5 m.

## Casting

`packages/bots/src/casting.ts` (not `cast.ts`: the sim has one) and
`packages/bots/src/reach.ts`. The bot finds its kit in `state.kits` by champion id
on every think and derives from it, once, what it needs (see Allocation): the reach
band and the shot width of each slot's base ability and EX variant, and the profile.
It keeps that cache for as long as the kit found is the same object and the champion
id is the same, and rebuilds it otherwise.

Reach band of an ability, from kit data (`abilityReach`), with `CR` the champion
radius 0.5 and `offset` starting at 0 along the top-level effects:

| Effect                           | Band                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `projectile`                     | `[0, offset + speed * lifetimeTicks / 60]`, multiplied first                              |
| `meleeArc`                       | `[0, offset + radius + CR]`                                                               |
| `area` on enemies or all, `self` | `[0, offset + radius + CR]`                                                               |
| `area` `ahead d`                 | `[offset > 0 ? 0 : max(0, d - radius - CR), offset + d + radius + CR]`                    |
| `area` `aim R`                   | `[0, offset + R + radius + CR]`                                                           |
| `area` on allies                 | none                                                                                      |
| `dash D`                         | for its `then` effects, `[0, offset + D + b.max]`: a dash stops at the first body it hits |
| `teleport R`                     | none; adds R to `offset` for the effects after it                                         |
| `applyStatus`, `shield`, `heal`  | none (they land on the caster)                                                            |

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
- in reach, with a clear shot (see Clear shot) of the width of that ability;
- the cast delay, below.

Order and variants: the bot presses the first slot in F, R, E, Q, SPACE, M2, M1
that passes, one slot per think. A slot listed in `kit.ex` casts its EX variant
(buttons plus SHIFT) when the energy is at least 25, the variant has a band and F
is not holding the energy back; otherwise it casts its base ability without
SHIFT. F always casts its base ability and is never sent with SHIFT.

Energy reserve: F holds the energy back while F is ready (its cooldown is at most 1,
as the cast gate reads it), its base ability has a reach band and the energy is at
least 75, which is the 100 that F costs less the 25 of one EX press. The EX variants are
then not cast, and the band and the shot width the slot is tested with are those of
its base ability, so a slot whose base reach is shorter than its EX reach waits for
the target to come in. Why: greedy EX spending kept the energy of the kit headless
run under 66, so the ultimate never fired. Only an ultimate with a band holds the
reserve: a support ultimate that reaches allies only (no band) would otherwise keep
every EX variant held for good at 75 energy or more. The cost is that a bot at 75 energy
or more does without its EX variants until F is cast, F goes on cooldown, or the bar
falls below 75, even when no enemy is in F's reach.

Cast delay: per slot, a run counts the consecutive thinks, this one included, on
which the target was in reach with a clear shot of the ability the slot would cast.
The slot may be pressed when the run exceeds `castDelay`, so `castDelay` thinks
after the first think of the run. The run restarts when the test fails, on an
idle or dead think, and when the acted target changes. It ignores cooldown,
energy, status and windup, so a slot that comes off cooldown while the target
stays in reach is pressed on the first tick the sim would cast it.

Never pressed: an ability with no band (self and ally abilities: Hargrim Q, R and
base SPACE, Quillon SPACE and R in the test kits), and any slot of a champion
without a kit. Openers and escapes are not built.

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
  the shot test), and the aim is written out over locals. The object-and-field form
  gives the same numbers as the pure functions it replaces (`scoreIntents`,
  `leadPoint`, `rotateByHalfTangent`, `roundAim`, `clearShot`, `nearestSightCell`,
  `steerToward`, `followPath`), which stay as the reference the tests compare it with.
- `hypot2` is V8's algorithm for `Math.hypot` of two numbers, which allocates 32 B per
  call, so a bot that measures a dozen distances allocated 400 B for them. A test
  compares it, bit for bit, with `Math.hypot`.
- `lineOfSight` is the sim's `hasLineOfSight` over a Float64Array of the obstacles,
  because the sim's allocates about 128 B per call (each sweep returns a double). A
  test compares the two on random segments. The table is rebuilt when the arena is
  another object.
- `segmentClear` reads the obstacles from `NavGrid.shapes` (a flat array of numbers,
  kept next to `obstacles` in the grid, which stays plain JSON) and takes every
  distance from one `hypot2` call site.
- The scratch of the shot test and the scan is per bot, so two bots never share it.
  A direct call of `clearShot` or `nearestSightCell` without a scratch allocates one.
- V8 gives every object literal with the same keys in the same order one shape, across
  all code in the process, and a field that any of them filled with a small integer or an
  object is no longer a double field. A store into such a field boxes the double (16 B).
  A scratch with a key as common as `value` was measured doing that under Vitest, so the
  distance box has the key `metres`. The heap check is what notices a scratch that
  loses its double fields.

Outside the steady state, by design: a plan (A star, `splitPath`, the fallback search),
a fresh path follower after a goal or intent change, the grid and the tables built for a
new arena, the kit cache built for a new kit, `inspect()`, and the aim error draw, whose
`aimU` is a closure variable written once every 15 thinks. The decision records are
what a think would have allocated once: one small object per think stays under the
bound of the test, so only review and the unit tests guard the returned input (it is the
bot's own record) and the decision record.

## Aim

Lead moving targets using their current velocity; add a tier-dependent angular
error.

- Lead: with `D` the vector from shooter to target, `V` the target velocity and
  `s` the projectile speed, solve `a t^2 + b t + c = 0` with
  `a = V.V - s^2`, `b = 2 D.V`, `c = D.D`. The time is the positive root,
  `(b + sqrt(b^2 - 4ac)) / (-2a)` for `b >= 0` and `2c / (sqrt(b^2 - 4ac) - b)`
  otherwise, which avoids a cancelling subtraction. The aim point is the target
  position plus `V t`.
- Speed: the first top-level projectile of the ability winding up, or else of the
  ability pressed on this think, or else the nominal 20 m/s (no kit, or no
  projectile in it).
- Fallback: aim at the target when `c = 0`, `a >= 0` (the target is at least as
  fast as the projectile) or `t` is not finite.
- Error: the vector to the aim point turns by `2 atan(u)` with the rational
  form `cos = (1 - u^2) / (1 + u^2)`, `sin = 2u / (1 + u^2)`, so no
  trigonometry runs. `u` is drawn uniformly from `[-T, T]` and redrawn every 15
  ticks while the bot has a target.
- Rounding: `Math.round(v * 100) + 0` gives whole centimetres and never `-0`.

## Difficulty tiers

Easy, normal, hard. They differ in reaction delay (ticks between a change in
the world and a change in intent), cast delay, aim error, and dodge probability.
The cast delay is read as a reaction delay: the ticks between a change in the
world (the target enters an ability's reach with a clear shot) and the press. It
is half the reaction delay, rounded up.

| Tier   | Reaction delay | Cast delay | Aim error (largest) | T (`tan` of half the error) | Dodge probability |
| ------ | -------------- | ---------- | ------------------- | --------------------------- | ----------------- |
| easy   | 30 ticks       | 15 thinks  | 12 degrees          | 0.10510423526567646         | with dodging      |
| normal | 15 ticks       | 8 thinks   | 6 degrees           | 0.0524077792830412          | with dodging      |
| hard   | 6 ticks        | 3 thinks   | 2 degrees           | 0.017455064928217585        | with dodging      |

Dodge probability arrives with dodging; profiles and scores are the same for
every tier. The delay is a ring of `delay` records: the bot decides on the
current state every tick, stores the decision, and acts on the one it stored
`delay` ticks earlier. Movement and aim use the current positions.

## Determinism

Bots need to repeat only within one process. The bot owns its PRNG (mulberry32,
seeded from `seed`), and `think` is a pure function of the state plus the bot's
private state. A bot keeps no module-level state, iterates arrays in index
order, never reads the wall clock or `Math.random`, never reads or writes
`state.rng`, never mutates the state, adds no random draw for casting (the aim
draw stays the only use of the bot's rng), and stores copies of numbers and ids
rather than references into the state. The exceptions are three references the bot
keeps for identity checks, each rebuilt when the object it was built from is another
one: `state.arena` (the navigation grid and the path follower stay while it is the
same object; a new arena object, for example from `cloneState` each tick, rebuilds
the grid and resets the follower, so such a caller pays a rebuild every tick), the
same arena for the obstacle table of the shot test (see Allocation), and the kit
object found in `state.kits` together with the champion id (the kit cache). The
caches are per bot and a kit or an arena mutated in place is not supported.
The tier table and each tier are frozen and readonly. Decisions use only
`+ - * /`, comparisons, `sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `round`, `imul`,
the sim's public exports and `hypot2` of `packages/bots/src/hypot.ts`, which gives the
bits `Math.hypot` gives (see Allocation). Bots do not use the sim's `dmath`. Lint
bans `Date`, `performance`, `Math.random`, `Date.now` and `performance.now` in
bots source (the sim's transcendental-math ban is not copied: bots output is not
promised bit-identical across platforms); review enforces the rest.

Bot output is not promised to be bit-identical across platforms, so no checksum
fixture of a bot-driven match is committed (batch #32 decision 1). A recorded
match replays exactly from its input stream.

## Not built yet

- A full match must finish: it waits for match flow, so the headless test runs
  a fixed 3600 ticks.
- Local steering around champions and projectiles, dodging and ally logic.
- Openers and escapes, and abilities that land on the caster or on
  allies (self and ally abilities).

## Testing

Bot-versus-bot headless matches are integration tests: invariants must hold,
and no `NaN` may appear. The headless test runs a 2v2 match of four bots on
arena 1 for 3600 ticks with a mix of tiers, checks the sim invariants and the
input rules every tick, and checks that `think` leaves the state's checksum
unchanged. A second headless run puts a mirror 2v2 (Hargrim and Quillon on both
teams) through the same checks, once on the bots-local test kits in
`packages/bots/test/kits.ts` and once on the shipped kits `data/kits/hargrim.json` and
`quillon.json`, with a press oracle: every press is checked on the state the bot thought
on against a literal band and clearance table of the kit set (written from the kit files,
not from src, and worked out again from the files by a test, since the run presses only
some slots), the acted target, line of sight and a clear shot of the ability's width, the
cooldown, the energy, stun, silence, root with a dash and the windup, and afterwards the sim
must have started that cast, or a death, a stun, a silence or a root explains why not. The
run must end with a death from a cast, every champion must start a cast, and one cast must
be an EX. The seeds are 101 to 104, the match seed 7 and the tiers easy, normal, hard,
normal; they are pinned, and a miss after a change to the bots, the sim or the Node
version is governed by batch #53 decision 8.3. The ultimate has its own pinned run: the 2v2
ends its fights by tick 700 with the energy bar at 75 at most, and 9000 matches of it on the
shipped kits gave no F cast, so a 3v3 of Hargrim and two Quillons a side, seeds 101 to 106 at
the hard tier, runs through the same checks and must start an F (decision 8 of #63 allows a
separate set for this alone; it needed another size of match). The energy reserve is what
lets it fire: without it the run starts none. A shadow-edge test on arena 1 pins that a
position where the centre line is clear and a shifted line hits the pillar gets no press and
is not chosen as a sight cell. The determinism test runs the same match twice, and two
matches stepped in turn, on the test kits and on the shipped kits (the second one
interleaved with a match on the test kits), and compares input streams and final checksums
in memory. See [testing](testing.md).

A heap check, `packages/bots/test/allocation.test.ts`, pins the Allocation section. It
builds nine frozen scenes on arena 1 with the shipped Hargrim and Quillon kits (a press, an
engage stand, a path follow past the age of the segment test, a kite with no clear shot, a
kite step, a retreat, and the deadlock rule's advance, flee and latched stand), warms each bot up with 20000 thinks and reads
`process.memoryUsage().heapUsed` around one `think`, 600 samples per round. The figure of a
round is the median delta minus the median delta of an empty pair of reads, and the lowest of
three rounds of every scene must be under a literal bound, 128 B per think. Main reads 4 to 56 KB
per think, the branch 0 B, and the bound sits between the two. The test also reads the sim's
baseline step against the floor of the sim's own check, which proves the counter moves, and it
checks that `think` leaves the checksum alone and that every scene stayed in its intent. It gates
on the native runner and not on the Linux container (batch #53 decision 12). Differential tests
keep the allocation-free forms honest: `hypot2` and `distanceInto` against `Math.hypot`,
`lineOfSight` against the sim's `hasLineOfSight`, and `segmentClear` against a copy of the
implementation before the rewrite and against the sampled clearance oracle. The test helpers
copy every input a bot returns, and a guard counts one distinct record per bot per tick, since a
stream of aliases would compare a few objects with themselves.

A stall tracker in the test helpers counts, per bot, consecutive ticks whose
input has `moveX` and `moveY` both 0, while some alive enemy is reachable on the
grid (a path exists between the free cells nearest the two champions) and the
bot is not in a stand this document describes: engage in range with line of
sight, kite in `[rangeMin, rangeMax]` with line of sight, retreat within 0.5 m
of its own spawn while the team of the bot is ahead or an enemy is in its reach (with
no enemy in reach and the team not ahead the deadlock rule says advance, so that stand
is a stall), or retreat standing in reach of its target with a clear shot (the latched
stand, which casts). The tracker works the team sums and the reach out with its own
oracle (`clearShotOracle`), not with the code of the bot. Idle counts as standing, and a
cornered kiter closer than `rangeMin` counts. Any other tick resets the run. No bot may stall for more
than 120 ticks, in the headless run and in a corner-start run: the same match
with one bot in the north-east corner of arena 1 and a melee champion 2.83 m
away on the diagonal, which the old stand rule left frozen for the whole 3600
ticks. A bot pushed by another champion keeps a non-zero input and is not
counted: local avoidance is not built. A unit test of the tracker drives it with
stub bots and zero inputs over 10 observes: engaging far from the enemy gives 10,
retreating at the spawn while the team is ahead 0, retreating at the spawn while the team
is not ahead and nothing is in reach 10, retreating at the spawn with an enemy in reach
(the target or another one) 0, with the enemy in range behind an obstacle 10, retreating
1 m off the spawn 10, retreating in reach of the target with a clear shot away from the
spawn 0, kiting closer than `rangeMin` in sight 10, engaging in range 0, no alive enemy
0, and a non-zero input resets the run.

`packages/bots/test/deadlock.test.ts` pins the rule. Unit scenes on frozen states cover
the advance, the stay of a team that is ahead, the tie (a mirror where all four advance),
the sum over the alive champions of the team, the flight when an enemy is in reach, the
walk around a pillar to a sight cell, and the latch with each of its four ends. A match
test replays the final state of the #58 run (health 3, 27, 26 and 13 of 160, 120, 160 and
120, everyone at its spawn, seeds 101 to 104) on both kit sets: the two bots of the team
that is behind are 1 m from their spawns within their reaction delay and a second, and a
death follows within 3600 ticks.
