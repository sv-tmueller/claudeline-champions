# Simulation core

`packages/sim`. Source: spec section 4. Dependency rules are in
[packages](packages.md).

## Time and space

- Fixed tick rate: 60 Hz. `TICK_RATE = 60`, `DT = 1 / 60`. All durations in
  the sim are integer tick counts, never seconds.
- 2D plane in meters. Sim coordinates `(x, y)`. `+x` is east, `+y` is north.
  The client maps sim `(x, y)` to Three.js `(x, 0, -y)` so screen-up is `+y`.
- Champions are circles of radius 0.5 m. Obstacles are circles or axis-aligned
  rectangles. The arena boundary rectangle is a wall.
- Collision: after each champion moves, in id order, it is pushed out of the
  other champions, the obstacles and the boundary, and slides along them.
  Champions block each other's bodies and cannot shove each other: the moving
  champion is pushed out and every other champion counts as static.
- Line of sight is a segment-versus-obstacle test against obstacles flagged
  `blocksProjectiles`. See [Line of sight](#line-of-sight).

## Input record

One `PlayerInput` per player per tick:

```ts
interface PlayerInput {
  moveX: -1 | 0 | 1;      // screen-relative WASD
  moveY: -1 | 0 | 1;
  aimX: number;            // world position in centimeters, integer
  aimY: number;
  buttons: number;         // bitmask: M1, M2, SPACE, Q, E, R, F, SHIFT
}
```

Aim is quantized to integer centimeters so the record is small and stable on
the wire later. The sim rounds a finite aim coordinate to the nearest integer
(`Math.round`, so 0.5 becomes 1 and -0.5 becomes 0). A missing input for a
player on a tick is treated as "no movement, no buttons, aim unchanged".

The sim sanitizes every input at runtime because inputs will later arrive over
the network. `step` reads and sanitizes every input before it changes the
state. A JSON-decoded input never makes it throw; an entry whose property read
throws makes `step` throw with the state unchanged. An entry that is not an
object (`null`, a number, a string) counts as missing. A move axis that is not
exactly -1, 0 or 1 becomes 0. A non-finite aim coordinate keeps the stored
aim, and `-0` is stored as `+0` so every stored number survives a JSON round
trip. Buttons that are not a non-negative integer become 0, with valid buttons
masked to the eight defined bits.

## State and API surface

`GameState` is plain, JSON-serializable data: no classes with methods, no
`Map`, no `Set`, no closures. Entities live in arrays ordered by ascending id.
Iteration order is always id order. This gives:

- `createMatch(config: MatchConfig, arena: ArenaDef, seed: number, kits:
  readonly KitDef[] = []): GameState` takes the parsed arena, because the sim
  does no I/O. `parseArenaDef` turns arena JSON into an `ArenaDef`. It rejects
  a size, a spawn coordinate or an obstacle `x`, `y`, `r`, `w` or `h` above 1e6
  m in magnitude (`MAX_ARENA_METERS`; exactly 1e6 is accepted), because a
  champion stands at its spawn until the first step, and a teleport from there
  feeds the squares of the collision tests. It also rejects a ring radius that
  is not above 0 and at most `MAX_ARENA_METERS`, and an `endRadius` that is not
  below the `startRadius`: with unbounded radii the shrink arithmetic could
  overflow, and a non-finite radius would make `checksum` throw. `kits` are the
  ability kits (see [Abilities](#abilities-and-the-effects-toolkit)); with
  none, no champion has abilities. The optional fourth argument extends the
  three-argument signature of the design spec, section 4.3, compatibly.
  `MatchConfig` is `teamSize` (2 or 3), `players` (`players[i]` becomes
  champion id `i`) and an optional `roundsToWin`. With `roundsToWin` (a positive
  safe integer; anything else throws `Invalid match: roundsToWin must be a
  positive integer`) the match runs the rounds of [Match flow](#match-flow) and
  `state.match` is set. Without it the match is free play and the `match` key is
  missing from the state, never `undefined`. The standard value is
  `DEFAULT_ROUNDS_TO_WIN = 3`.
- `step(state: GameState, inputs: readonly (PlayerInput | undefined)[]): void`
  advances one tick in place. `inputs[i]` belongs to champion id `i`; an
  `undefined` or absent entry is a missing input.
- `cloneState(state): GameState`
- `checksum(state): number` for replay and desync tests
- `state.events: SimEvent[]` cleared at the start of each tick (after the
  inputs are read), appended during the tick. The renderer and audio consume
  events; they are not needed to reproduce state, but they are part of the
  state and of `checksum`. Toolkit calls made between steps append to
  `state.events` too, and the next `step` clears them.

  The union today:

  | Event | Fields |
  | --- | --- |
  | `projectileSpawned` | `projectileId`, `ownerId`, `x`, `y`, `vx`, `vy`, `radius` |
  | `projectileHit` | `projectileId`, `ownerId`, `targetId`, `x`, `y` |
  | `projectileExpired` | `projectileId`, `reason` (`hit`, `obstacle`, `boundary`, `lifetime`, `roundEnd`), `x`, `y` |
  | `areaSpawned` | `areaId`, `ownerId`, `x`, `y`, `radius` |
  | `areaTick` | `areaId`, `targetIds` (champion id order, empty when nobody is inside) |
  | `areaExpired` | `areaId` |
  | `damage` | `targetId`, `sourceId`, `amount` (health actually removed), `health` (after) |
  | `heal` | `targetId`, `sourceId`, `amount` (health actually restored), `health` (after) |
  | `death` | `targetId`, `sourceId` |
  | `statusApplied` | `targetId`, `sourceId`, `slot` (or `null`), `status` (the type), `remainingTicks` |
  | `statusExpired` | `targetId`, `sourceId`, `slot`, `status`, `reason` (`expired`, `depleted`, `stopped`, `replaced`, `death`) |
  | `shieldAbsorbed` | `targetId`, `sourceId` (the damage source), `amount` (absorbed by all shields in this hit), `absorbLeft` (over all the target's shields afterwards) |
  | `meleeArc` | `ownerId`, `x`, `y`, `dirX`, `dirY` (unit), `radius`, `cosHalfAngle`, `targetIds` (id order, built before any effect applies) |
  | `teleport` | `championId`, `fromX`, `fromY`, `toX`, `toY` (where the champion ended up), `blocked` |
  | `dashStarted` | `championId`, `x`, `y`, `dirX`, `dirY` (unit), `distance`, `ticks` |
  | `dashEnded` | `championId`, `x`, `y`, `reason` (`complete`, `blocked`, `rooted`, `stunned`, `death`, `replaced`) |
  | `castStarted` | `championId`, `castId`, `slot`, `ex`, `windupTicks`, `cost` (energy paid: 100 for F, 25 for an EX variant, else 0) |
  | `castFired` | `championId`, `castId`, `slot`, `ex` |
  | `castInterrupted` | `championId`, `castId`, `slot`, `ex`, `reason` (`stun`, `death`, `roundEnd`) |
  | `energyGained` | `championId` (the caster), `castId`, `targetId`, `amount` (what was added, after the cap trimmed it, always above 0), `energy` (the caster's after) |
  | `roundStarted` | `round` (counting from 1) |
  | `suddenDeathStarted` | `round`, `radius` (the ring's start radius) |
  | `roundEnded` | `round`, `winner` (`A`, `B`, or `null` for a draw), `scoreA`, `scoreB` (after this round counted) |
  | `matchEnded` | `winner`, `scoreA`, `scoreB` |

  The four match events come only from a match with match flow. Ring `damage`
  and `death` events carry `sourceId` -1 (`RING_SOURCE_ID`). The clocks
  (`phaseTicks`, the ring radius) advance without events, as `tick` and the
  positions do; every discrete change has an event. Hit and expired positions
  are the projectile centre at contact (the final position for `lifetime`, and
  where it was for `roundEnd`).

Randomness goes through a seeded PRNG stored in the state. Given the same seed
and the same input stream, `checksum` after N ticks is identical on every run.

## Entities

- Champion: team, champion id, position, velocity (the walk velocity), facing
  (aim angle), health, max health, energy 0..100, `statuses` (a list of
  `StatusInstance` records in application order, see [Statuses](#statuses)),
  `dash` (`null` or a record, see [Forced motion](#forced-motion)), `cooldowns`
  (seven integers in `SLOTS` order, the ticks until each slot may cast), `cast`
  (`null` or the windup in progress, `{ castId, slot, ex, windupTicks,
  windupLeft }`, see [Abilities](#abilities-and-the-effects-toolkit)) and the
  alive flag.
- Projectile: id, owner, team (copied from the owner at spawn), position,
  velocity, radius, remaining lifetime ticks, pierce flag, the champions it has
  already hit (`hitIds`, in hit order), an inline `effects` list and `castId`
  (the cast that fired it, or `null` for a dev tool spawn).
- Area: id, owner, team, shape (circle today, cone and rectangle later),
  position, radius, targets filter, remaining ticks, tick interval, ticks to
  the next application, an inline `effects` list and `castId` as for a
  projectile.
- Kits and casts: `state.kits` holds the kits of the match, plain data, and
  `state.casts` the records of casts that something still refers to, in
  ascending id order (see [Abilities](#abilities-and-the-effects-toolkit)).
- Obstacle: static, from the arena definition.
- Match (match flow only): `state.match` holds the phase, the step count of the
  phase, the round, `roundsToWin`, the score and the ring, see [Match
  flow](#match-flow). The ring (sudden death) is `match.ring`: its centre `(0,
  0)`, the current radius and the damage per tick, or `null`.

Projectiles, areas and casts share one id space with `state.nextEntityId`. Champion
ids are `0` to `n-1` (so `inputs[i]` is champion `i`), and the counter starts at
`champions.length`. Ids are never reused. `state.projectiles` and `state.areas`
hold the entities in ascending id order; removed ones are filtered out after a
phase, never spliced during iteration.

An effect is plain data and the entity holds its own copy, so kit constants are
never aliased into the state. The `Effect` union is `damage { amount }`, `heal
{ amount }`, `applyStatus { status }` (a status spec: the type, `ticks` and the
strength field of that type), `shield { absorb, ticks }`, `knockback
{ distance, ticks, direction: 'away' | 'toward' }` and `energyGain { amount }`
(an integer from 1 to 100; only `landHit` reads it). A hit applies its effects
in list order to each champion it lands on, with the owner as the source and
the slot of the cast that made it, or no slot for a dev tool spawn. `away`
points from the hit origin (the projectile contact point, the area centre, the
arc origin) to the target, `toward` from the target to the owner's current
position, and a zero vector means no push.

`Slot` (`M1`, `M2`, `SPACE`, `Q`, `E`, `R`, `F`) and `SLOTS` in `input.ts` list the
slots in `Button` bit order.

## Tick order

`step` does the following, in this order:

1. Read and sanitize every input into an array, with no mutation.
2. Clear `state.events`.
   - L. Locked phases (match flow, phase `warmup`, `roundEnd` or `matchEnd`):
     for each alive champion in id order, store the aim (3a), set the walk
     velocity to `+0` and face the aim (the expression of 3e). Nothing else
     runs: no cooldown, windup, cast, walk, forced motion, status upkeep,
     projectile, area, ring or decision, and no step 7. Then 7b and 8 run, and
     the phase may end there (see [Match flow](#match-flow)). Steps 3 to 7
     below are the round phase, and free play, which has no phase.
3. For each champion in id order, skipping a dead one and ending its turn if it
   dies:
   - 3a. Store the aim.
   - 3b. Cooldowns: every cooldown above 0 drops by 1.
   - 3c. Windup: a cast in progress loses a turn (`windupLeft - 1`) and fires
      when `windupLeft` reaches zero.
   - 3d. Cast start: at most one cast starts from the held buttons; a windup of 0
      fires at once (see [Abilities](#abilities-and-the-effects-toolkit)).
   - 3e. Walk: the walk velocity is the move direction times the speed, where the
      speed is the kit move speed (5.5 without a kit) times the speed factor
      (see [Statuses](#statuses)), halved during a `slowed` windup; it is `+0`
      while the champion is stunned, rooted, dashing or in a `locked` windup.
      Move, face the aim and resolve collision.
   - 3f. Forced motion (see [Forced motion](#forced-motion)): if rooted, a
      running dash ends first (`rooted`); then the dash step and each knockback
      impulse move the champion in substeps. Stun, root and a locked windup do
      not stop this step. A dash that ended `complete`, `blocked` or `rooted`
      fires its `then` effects here, after all of the step, from where the
      champion is.
   - 3g. Status upkeep: due pulses of damage over time and heal over time, then
      every status loses a tick and ends at 0 (reason `expired`). A pulse that
      kills the champion ends the turn.
4. For each projectile in id order: sweep it (see below), hit, and remove it if
   it ends.
5. For each area in id order: if `ticksToNextApply` is 0, emit `areaTick`,
   apply the effects to the targets in id order and set `ticksToNextApply` to
   the interval; then decrement it.
6. Expiries: each projectile in id order loses a tick of lifetime and ends with
   `lifetime` at 0; then each area loses a tick of duration and ends with
   `areaExpired` at 0.
   - 6b. Sudden death (match flow only, when `phaseTicks` is at least 5400,
     `ROUND_TICKS`). With `e = phaseTicks - 5400`: at `e = 0` the ring is
     created with the arena's start radius and `damagePerSecond / TICK_RATE`
     per tick, and `suddenDeathStarted` is emitted. The radius is `endRadius`
     when `e >= 1800` (`SUDDEN_DEATH_TICKS`), else `startRadius + ((endRadius -
     startRadius) * e) / 1800`, recomputed from the integer `e` every step. Then
     each alive champion in id order whose centre is farther than the radius
     from the ring centre takes the ring damage (see [Damage](#damage-healing-and-death)).
   - 6c. Round decision (match flow only): if a team has no alive champion, the
     round is decided. The other team wins, or it is a draw when neither team
     has one. In this order: `roundEnded`, a `castInterrupted` (`roundEnd`) for
     each windup in champion id order, a `projectileExpired` (`roundEnd`) for
     each projectile in id order at its position, an `areaExpired` for each
     area in id order. Both lists are replaced by empty ones, the phase becomes
     `roundEnd` and `phaseTicks` 0.
7. Drop the cast records nothing refers to: no windup, projectile, area or dash
   of that cast is left. A match with no kits allocates nothing in steps 3b to 3d
   or here (the combat e2e counts per-tick allocations), so these hold no
   closure: V8 allocates a closure's context on every call, before an early
   return.
   - 7b. `phaseTicks += 1` (match flow only). In a locked step this comes first,
     then the phase ends if its length is reached.
8. `tick++`.

A projectile with lifetime L makes exactly L sweeps. An area with duration D
and interval I applies `ceil(D / I)` times, on its ticks 0, I, 2I and so on;
with D = 1 and I = 1 it applies once and expires in the same step. Entities
spawned between steps act from the next step on.

A status lasting D ticks affects exactly D turns of its holder, whether it was
applied between steps, by a hit in steps 4 and 5 (those reach the holder's
upkeep in the next tick) or by a cast in step 3. A cast fires in its caster's
turn, so a status or knockback it lands on a champion with a higher id takes
effect in that champion's turn of the same tick, and on one with a lower id
from the next tick. A dash or teleport a cast starts moves the caster in the
same turn. Entities a cast spawns in step 3 act in steps 4 and 5 of the same
tick. Entities must never be spawned during steps 4 to 6, because those steps
replace the entity arrays with `filter`; this is also why root does not end a
dash when it is applied, and why dash `then` effects fire in step 3.

## Projectiles

A projectile moves in a straight line at constant speed. Each tick it sweeps
from its position `p0` to `p0 + v * DT` instead of testing the end position, so
a fast projectile cannot tunnel through a champion or a thin wall.

- Blocking: the first blocking obstacle (arena order) or the boundary on the
  sweep ends it at that time, with reason `obstacle` or `boundary`. Obstacles
  with `blocksProjectiles: false` are ignored. The boundary is hit once the
  centre reaches `W/2 - radius` (and the same for y), outward only.
- Champions: a projectile can touch alive champions of the other team that are
  not in its `hitIds`, using the reach `0.5 + radius`. It never hits its owner
  or an ally. A champion it already overlaps at spawn is hit at t = 0. Dead
  champions are passed through.
- Order: contacts at or before the blocker time are taken by time, then by
  champion id. A non-piercing projectile ends at the first one (reason `hit`);
  a piercing one hits each once and goes on until a blocker or its lifetime
  ends it. A champion killed by an earlier projectile in the same tick is
  skipped by the later ones.
- Against a wall: a contact at t = 0 blocks only a projectile that moves into
  the obstacle, so a champion pressed against a wall can still fire away from
  it. Into the wall it ends at once.
- Each projectile gets exactly one `projectileExpired`.

## Areas

An area is a circle that applies its effects every `intervalTicks` for
`durationTicks`. `targets` is `enemies` (the other team), `allies` (the owner's
team including the owner) or `all`; dead champions are never targets. A
champion is inside when its body overlaps the circle, `dist <= radius + 0.5`,
inclusive (a tuning choice that may become a `[tuned]` rule later). Areas ignore
obstacles. The target list in `areaTick` is built before any effect applies.

## Line of sight

`hasLineOfSight(state, from, to)` is false when the segment touches an obstacle
that blocks projectiles. A tangent counts as blocked. The boundary does not
matter because the arena is convex.

## Damage, healing and death

- Damage first goes to the target's shields, in `statuses` order (oldest first,
  see [Statuses](#statuses)). If anything was absorbed, one `shieldAbsorbed`
  event carries the total absorbed and the absorb left over all shields, and
  each used-up shield ends with `statusExpired` reason `depleted`. What the
  shields did not take removes `min(health, rest)`, emits `damage` with the
  amount actually removed (health before minus health after) and the health
  afterwards, and at 0 health sets `alive = false`, zeroes the velocity and
  emits `death` once, right after that damage event. After `death`, every
  status ends in application order with reason `death`, then a running dash
  ends with `dashEnded` reason `death`, then a windup in progress ends with
  `castInterrupted` reason `death`. Damage to a dead champion does nothing,
  and an amount too small to change the health (below about half an ulp of it)
  emits nothing. A hit fully absorbed by shields emits no `damage` event.
- An invulnerable target takes no damage: `applyDamage` returns 0, emits
  nothing and leaves shields and health alone. Invulnerable does not stop a
  heal.
- Healing restores up to `maxHealth`, emits `heal` with the amount actually
  restored (health after minus health before), and emits nothing when that
  amount is 0, also when the amount is too small to change the health. A dead
  champion is not revived.
- A non-finite or negative amount throws; 0 does nothing. An unknown target id
  throws `Error('Invalid damage: ...')` or `Error('Invalid heal: ...')`.
- A dead champion is skipped in the movement loop (no input, aim, facing or
  move), is no obstacle for other champions and is never touched by
  projectiles or areas.

- The ring damages through `applyDamage(state, id, damagePerTick, -1, true)`.
  The last argument, `ignoreShields`, skips the whole shield block: no
  `shieldAbsorbed`, no shield change. Invulnerable still blocks it. The ring
  gives no energy, because `applyDamage` never does. A ring death is a `death`
  with `sourceId` -1.

`applyDamage` is an internal building block, not a kit primitive. Projectiles,
areas, melee arcs, damage over time and the ring use it.

## Toolkit entry points

These are module exports of the sim, not part of the package index. Kits reach
them from inside the sim, through `cast.ts`.

| Module | Export | Returns |
| --- | --- | --- |
| `projectile.ts` | `spawnProjectile(state, spec, castId = null)` | the new entity id |
| `area.ts` | `spawnArea(state, spec, castId = null)` | the new entity id |
| `melee.ts` | `meleeArc(state, spec)`, with an optional `castId` in the spec | the target ids |
| `status.ts` | `applyStatus(state, targetId, spec, source)` | whether anything changed |
| `status.ts` | `applyShield(state, targetId, { absorb, ticks }, source)` | whether a shield was added |
| `status.ts` | `applyKnockback(state, targetId, { dirX, dirY, distance, ticks }, source)` | whether a push was added |
| `motion.ts` | `startDash(state, championId, { dirX, dirY, distance, ticks }, cast = { castId: null, then: [] })` | whether the dash started |
| `motion.ts` | `teleport(state, championId, toX, toY)` | false when blocked |
| `health.ts` | `applyDamage`, `applyHeal`, `applyEffects(state, sourceId, targetId, effects, origin, slot = null)` | `applyEffects` returns the health its `heal` effects restored |
| `energy.ts` | `landHit(state, { ownerId, castId }, targetId, effects, origin)` | |
| `cast.ts` | `tickCooldowns`, `advanceWindup`, `startCast`, `fireDashThen`, `dropUnusedCasts`, `resetAbilityState` | what `step` calls, see [Abilities](#abilities-and-the-effects-toolkit) |
| `flow.ts` | `stepLocked`, `stepRoundEnd` | what `step` calls for match flow, see [Match flow](#match-flow) |

`source` is `{ sourceId, slot }`, with a null slot for a direct call. Projectiles,
areas and melee arcs land their hits through `landHit`, which wraps
`applyEffects` and gives energy. The `castId` of the two spawn functions and of
`meleeArc` is for `cast.ts`: a cast id that is not in `state.casts` throws
`Invalid projectile: ...`, `Invalid area: ...` or `Invalid melee arc: ...`. The
two spawn functions are also exposed on the package index under the `debug`
namespace for tests and client dev tools only, as two-argument wrappers that
always store `castId: null`; gameplay code outside the sim must not call them,
and only `index.ts` imports `debug.ts`. Every function throws `Error('Invalid
<thing>: ...')` for bad input before it changes anything.

- `spawnProjectile` and `spawnArea` throw `Invalid projectile: ...` or
  `Invalid area: ...` on an unknown owner, a non-finite number, a zero
  direction, a direction too large to measure (a length beyond about 1.3e154,
  the square root of the largest double: on an axis, or about 9.5e153 per
  component on the diagonal) or too small to measure (both components below
  1e-150 in magnitude but not both zero, since the squares inside the length
  turn subnormal below about 1.5e-154; a component of exactly 1e-150 is
  accepted), a speed or radius at or below 0, a lifetime, duration or interval
  that is not a positive integer, a projectile `pierce` that is not a boolean,
  `effects` that is not an array, an effect of an unknown type or with a bad
  field (an amount at or below 0, a status spec that `applyStatus` would
  reject, a shield with an absorb not above 0 and at most 1e6 or ticks outside 1
  to 36000, a knockback with a distance not above 0 and at most 1e6, ticks
  outside 1 to 36000 or a direction other than `away` or `toward`). A dead owner
  may still spawn.
- `meleeArc` hits every alive enemy of `ownerId` whose body overlaps the circle
  of `radius` around `(x, y)`, `dist <= radius + 0.5` inclusive, and whose
  centre lies inside the arc. The arc is the half-angle stored as its cosine,
  `cosHalfAngle` in [-1, 1], never computed in the sim: a target is inside when
  `dot(dir, d) >= cosHalfAngle * |d|`, inclusive, where `d` is the vector from
  the origin to the target and `dir` the normalized direction. A cosine of -1
  hits every direction, and a target exactly at the origin is always inside.
  Obstacles are ignored. The `meleeArc` event, with the target list built before
  any effect applies, comes first, then the effects apply to each target in id
  order with the arc origin as the hit origin. A dead owner may still swing. It
  throws `Invalid melee arc: ...` on an unknown owner, a non-finite number, a
  zero direction, a radius at or below 0, a cosine outside [-1, 1] or bad
  effects.
- `applyStatus`, `applyShield` and `applyKnockback` throw `Invalid status: ...`
  on an unknown target or source, a spec that is not an object, an unknown type
  or a missing or bad field (see [Statuses](#statuses)), and then do nothing at
  all to a dead target. `applyStatus` takes a spec per type and has no shield or
  knockback: those have their own calls.
- `startDash` throws `Invalid dash: ...` on an unknown champion, a direction that
  is zero or not finite, a distance that is not a number from 0.000001 to 1000 m
  (`MIN_DASH_DISTANCE`, `MAX_DASH_DISTANCE`), or ticks that are not an integer
  from 1 to 36000 (`MAX_STATUS_TICKS`, as for a knockback). A dead champion is a
  no-op. `cast` (not for callers outside `cast.ts`) stores the cast id and a
  copy of the `then` effects on the dash.
- `teleport` throws `Invalid teleport: ...` on an unknown champion, a point that
  is not finite, or a point more than 1e9 m from the champion along either axis
  (`MAX_TELEPORT_METERS`; the line of sight test squares the span, so the bound
  keeps the sum of squares at 2e18, far from overflow, and every arena value
  and spawn is within 1e6 m, so the squares of a position stay small as well).
  A dead champion is a no-op with no event.

## Statuses

Catalog: stun, root, silence, invulnerable, slow (percent), haste (percent),
shield (absorb amount), damage over time (`dot`), heal over time (`hot`) and
knockback. The values and ranges that bind kits are in [rules](../design/rules.md)
section 4; this section is what the sim does.

### Record

`champion.statuses` is a list in application order. Each entry has `type`,
`sourceId`, `slot` (a `Slot` or `null` for a direct toolkit call) and
`remainingTicks`, plus these fields per type:

| Type | Extra fields |
| --- | --- |
| `stun`, `root`, `silence`, `invulnerable` | none |
| `slow`, `haste` | `percent` (integer 1 to 100) |
| `shield` | `absorb` (above 0) |
| `dot`, `hot` | `perPulse`, `ticksToNextPulse` (1 to 30) |
| `knockback` | `dirX`, `dirY` (unit), `distance` (D after the cap trim), `totalTicks` (N) |

The source of a status is the pair (`sourceId`, `slot`). An EX variant shares the
slot of its normal ability.

### Stacking and refreshing

Every application emits `statusApplied`. A status that is replaced or refreshed
first emits `statusExpired` with reason `replaced` for the instance it removes.

| Type | Instances | A new application |
| --- | --- | --- |
| stun, root, silence, invulnerable | one per type | replaces the old one only if its remaining ticks are more (the new source takes over); otherwise nothing changes and no event is emitted, so a refresh never shortens |
| slow, haste | one per (type, source) | removes the old instance of the same source and appends the new one, with the new percent and ticks |
| shield | one per source | removes the old shield of the same source and appends the new one, so the newest is last |
| dot, hot | one per source | sets the new ticks and `perPulse`, keeps `ticksToNextPulse` and moves the instance to the end |
| knockback | one per source | replaces the instance of the same source, see below |

Remaining stun is capped at 120 ticks when it is applied (`STUN_CAP_TICKS`).
Slow and haste add their percents over all sources and the totals are capped at
70 and 50 (`SLOW_CAP_PERCENT`, `HASTE_CAP_PERCENT`).
Every status, shield and knockback spec is bounded, so no number in the state or
an event can overflow to infinity or turn NaN: `ticks` is an integer from 1 to
36000, ten minutes (`MAX_STATUS_TICKS`); `absorb`, `perPulse` and `distance` are
numbers above 0 and at most 1e6 (`MAX_MAGNITUDE`); `percent` is an integer from
1 to 100. A spec outside these bounds throws `Invalid status: ...` (or the
effect form of the message for a projectile, area or melee arc). The
`absorbLeft` of a `shieldAbsorbed` event is the sum over the target's shields,
which stays finite because each is at most 1e6.

### Speed

Walk speed is the kit's `moveSpeed` (`BASE_MOVE_SPEED`, 5.5, for a champion
without a kit, with the same expression as before kits) times `(1 + (haste -
slow) / 100)`, with the capped totals, and times 0.5 more during a `slowed`
windup (`SLOWED_WINDUP_FACTOR`; the product, so it multiplies after slow and
haste). With no slow or haste the factor is exactly 1, so the speed stays
exactly 5.5 m/s. Stun, root, a running dash and a `locked` windup zero the walk
velocity, which is then stored as `+0`; the stored velocity is the walk velocity only, never the
displacement left after collision or forced motion. Dash and knockback ignore
the speed factor.

### Shields

Damage uses the shields in array order, oldest first, before health (see
[Damage](#damage-healing-and-death)). A shield that times out loses its
remaining absorb with no event beyond `statusExpired` reason `expired`. Shields
are not blocked by invulnerable.

### Damage over time and heal over time

A new instance starts with `ticksToNextPulse = 30` (`STATUS_PULSE_TICKS`). In
the upkeep of each of the holder's turns the timer drops by 1 and at 0 the pulse
fires and the timer resets to 30, so pulses land on elapsed ticks 30, 60, and so
on, and a status of D ticks gives `floor(D / 30)` pulses; a pulse due on the last
tick lands before the status ends. A pulse is `applyDamage` or `applyHeal` with
the source's id. While the holder is invulnerable a damage pulse does nothing
because the damage is blocked, and the timer keeps running. A damage pulse that
kills the holder ends its upkeep.

### Knockback

A knockback of `D` meters over `N` ticks leaves `D n (n + 1) / (N (N + 1))`
meters still to push when `n` ticks remain, so the tick with `n` ticks left (before
upkeep) moves the champion `D * 2 n / (N (N + 1))` m along its direction, and the
ticks add up to D. The push still to come, summed over all instances on a
champion, never exceeds 6 m (`KNOCKBACK_CAP_METERS`): a new push becomes `D' =
min(D, 6 - the remaining push of the other instances)`, the instance of the
same source not counted. If `D' <= 0` the new push is dropped, with no event and
nothing changed. Otherwise it replaces the instance of the same source. The
first push happens in the holder's next turn after it was applied: in the same
tick for a cast of a lower-numbered champion, from the next tick otherwise.

### Invulnerable

Invulnerable blocks the application of stun, root, silence, slow, damage over
time and knockback (the call returns false and emits nothing), and blocks
damage. It does not block heal, shield, haste, heal over time or another
invulnerable, and it does not end statuses that are already running. Rules.md
says invulnerable blocks "No actions"; the sim reads that as blocking none of
the holder's own actions.

### Death and the end of a status

Death ends every status, in application order, with reason `death`. Otherwise a
status ends when its ticks run out (`expired`), a shield is used up
(`depleted`), a knockback is stopped by contact (`stopped`) or it is replaced
(`replaced`). Stun does one more thing when it lands: it cancels a running dash
(`dashEnded` reason `stunned`, after `statusApplied`) and a windup in progress
(`castInterrupted` reason `stun`, after the dash end).

## Forced motion

A dash and knockback impulses move a champion regardless of stun, root and a
locked windup. They are step 3f of the tick.

`champion.dash` is `null` or `{ dirX, dirY, stepLength, ticksLeft, castId, then
}`: the cast that started it (`null` for a direct call) and the effects that
fire where it ends. `startDash(state, id, { dirX, dirY, distance, ticks })` sets
it with `stepLength = distance / ticks`, emits `dashStarted` and ends a running
dash as `replaced`, which drops that dash's `then`. A dash first moves in step
3f of the holder's next turn, or of the same turn when a cast starts it, and
moves `stepLength` meters a tick for `ticks` ticks. Its
distance is at least 1e-6 m and its ticks at most 36000, so `stepLength` is
always above 0 and the tick count always counts down to the end.

Each tick, in step 3f:

1. If the champion is rooted, a running dash ends first (`dashEnded` reason
   `rooted`). Root does not end a dash when it is applied; the check is here, so
   a dash never ends during steps 4 to 6, where nothing may spawn entities.
2. The displacement is the dash step plus each knockback's step, added as
   vectors. A zero total moves nothing and stops nothing.
3. The displacement is cut into substeps of at most 0.25 m
   (`MOTION_SUBSTEP_METERS`); the champion moves one substep at a time and
   `resolveChampion` runs after each, so a fast dash or push cannot tunnel
   through a thin wall or champion.
4. The first substep that pushes the champion, or sends it back to where the
   substep started, ends the motion for the tick: the dash ends as `blocked`, and
   every knockback ends with `statusExpired` reason `stopped`, in that order. The
   champion rests at contact and does not slide along the surface.
5. Otherwise the dash loses a tick and ends as `complete` at 0.

`stepForcedMotion` returns the dash record that ended in the call as `rooted`,
`blocked` or `complete`, and `step` hands it to `cast.ts`, which fires its `then`
effects after the whole of step 3f (so after a knockback of the same turn has
moved the champion). The motion module cannot do it itself because `cast.ts`
imports it. The other ends (`stunned`, `death`, `replaced`) happen in `status.ts`,
`health.ts` and `startDash`, which discard the record, so their `then` effects
are dropped.

A contact on the last tick of a dash is `blocked`, not `complete`. The upkeep
that follows then ends knockbacks that ran out as `expired`.

`teleport(state, id, toX, toY)` moves the champion to the point at once if the
segment from its position clears every obstacle with `blocksProjectiles` (the
line of sight rule; touching blocks, low walls do not). Collision is then
resolved at the destination with the start as the previous position, so the
champion is pushed out of obstacles and champions, clamped inside the boundary, or
left at the start if it cannot be cleared. A blocked teleport leaves the champion
where it was and the event says `blocked: true`. `toX` and `toY` are where the
champion ended up, so for a blocked teleport they equal the start.

## Choices the rules do not state

These are sim-level choices that may become `[tuned]` lines in rules.md:

- A melee arc ignores obstacles.
- The arc and area overlap test is `dist <= radius + 0.5`, inclusive; the angle
  test is inclusive, and a target at the arc origin counts.
- Forced motion substeps are at most 0.25 m, and the first push stops all forced
  motion that tick.
- Stun cancels a running dash when it is applied; root ends it in the next step.
- A dash may not be longer than 1000 m, to keep the substep loop short, and not
  shorter than 1e-6 m, so its step length cannot underflow to 0.
- Dash, status, shield and knockback `ticks` are at most 36000 (ten minutes), an
  absorb, a pulse or a push distance at most 1e6, and a teleport spans at most
  1e9 m per axis. These keep every number in the state and the events finite;
  no rule states them. The 1e9 bound exists so that the line of sight test,
  which squares the span, cannot overflow; arena values stay within 1e6 m.
- Shield absorption emits one `shieldAbsorbed` per hit, not one per shield.
- A refresh of any status emits `statusExpired` (`replaced`) then `statusApplied`,
  also for damage over time, where the instance keeps its pulse timer.
- A status a cast lands carries the slot of the cast (its EX variant shares the
  slot); a status from a dev tool spawn or a direct call carries none.
- A pulse due on the last tick of a status lands before the status ends.
- `teleport` reports the end position, and a teleport that cannot be resolved
  reports `blocked: false` with the start as the end position.
- Invulnerable blocks none of the holder's own actions (rules.md says "No
  actions"; the sim reads it as blocking incoming effects only).
- Casting is not blocked while dashing, so a champion can have a dash and a
  windup at once.
- A hit that qualifies for energy marks its target in `credited` even when the
  cap trims the gain to 0, and then no `energyGained` event is emitted. A dead
  caster earns nothing and gets no event, though its projectiles and areas
  still hit.
- A windup that fires clears `champion.cast` and emits `castFired` before its
  first effect runs, and a new cast may start in the turn the previous one
  fires. Only one cast starts per tick.
- A cast fires its effects from where the caster stands when each effect runs:
  each top-level effect reads the caster position and the aim again, so a
  teleport followed by an arc swings where the teleport arrives. An effect
  listed after a dash still acts at the dash start; `then` is how an effect
  acts at the dash end.
- The `then` effects of a dash take the dash direction and the aim of the tick
  the dash ends: a placement `aim` goes the dash direction for the smaller of
  the range and the distance to that aim.
- A `then` list of a dash that ended `rooted`, `blocked` or `complete` fires
  after the whole of step 3f; one that a stun, a death or a new dash ended is
  dropped.
- Kit data is checked at `createMatch` so that no number can make a toolkit call
  throw inside `step`. A teleport range in a kit stops at 1e6, not 1e9, because
  near 1e9 the rounded `origin + dir * range` can land an ulp past the per-axis
  check of `teleport`.
- The deciding step of a round counts as the first tick of the 180 tick pause
  (rules.md says the pause "starts on the tick a round is decided").
- The decision is made at the end of the step, after the ring: a champion that
  dies to the ring and a champion that dies to a hit in the same step both count.
- A champion exactly on the ring radius is inside; the test is on squared
  distances, `dx * dx + dy * dy > radius * radius`, with no square root.
- Aim and facing stay live in locked phases and are kept through the reset;
  rules.md locks movement and casting only.
- Statuses and dashes are frozen through the pause, not run down, and the reset
  drops them. They get no events of their own at the reset.
- Projectiles and areas end with `roundEnd` events when a round is decided (and
  any left at a reset), so the rule that every projectile gets one
  `projectileExpired` holds; `roundEnd` is a new `ProjectileEndReason`, and the
  `castInterrupted` reason `roundEnd` is rules.md 2.4.
- Ring damage and ring deaths use the source id -1, which no champion has.
- A dev tool spawn made during a locked phase is frozen with the rest and
  cleared at the next round start.
- rules.md 2.4 (a decided round interrupts a windup) governs over 1.2 ("a cast
  in progress is dropped" at the reset) for when a windup ends, so the drop in
  1.2 finds nothing to drop.

## Abilities and the effects toolkit

Slots follow the Bloodline layout: `M1` (basic), `M2` (secondary), `SPACE`
(mobility), `Q`, `E`, `R` (utility, offense, defense), `F` (ultimate). Holding
`SHIFT` with a slot casts that slot's EX variant where the kit defines one.
Each kit defines exactly two EX variants.

- EX variants cost 25 energy (`EX_ENERGY_COST`). The ultimate costs 100
  (`ULTIMATE_ENERGY_COST`). Energy is earned only by landing abilities on enemies
  and, for support kits, by healing allies, and runs from 0 to 100
  (`MAX_ENERGY`). Energy resets to 0 at the start of each round.
- Every ability has: cooldown ticks, windup ticks (0 for instant), movement
  rule during windup (free, slowed, locked), and a list of effects.
- Effects toolkit (the only primitives kits may use): `projectile`, `dash`,
  `meleeArc`, `area`, `applyStatus`, `heal`, `shield`, `teleport`,
  `knockback`, `energyGain`. New primitives are added to the toolkit through
  the design doc first, then the sim.
- No global cooldown. Casting is blocked while another windup is in progress,
  while stunned, and while silenced (mobility slot included).
- Health does not regenerate during a round except through healing effects.

### Kit contract and registration

A kit is typed plain data in `kit.ts`, stored in the state like `state.arena`
and run by a `switch` in `cast.ts`. A closed union of effects run by a switch is
the toolkit, not a scripting language, so ADR-003 holds: there is no expression
evaluator, no kit code and no kit-defined control flow. `step(state, inputs)`
is unchanged.

```ts
interface KitDef {
  id: string;                  // matches PlayerConfig.championId
  maxHealth: number;
  moveSpeed: number;           // m/s before statuses
  support: boolean;            // healing allies earns energy
  slots: Record<Slot, SlotSpec>;
  ex: [Slot, Slot];            // the two slots with an EX variant, never F
}
type SlotSpec = AbilitySpec & { cooldownTicks: number; ex?: AbilitySpec };
interface AbilitySpec { windupTicks: number; movement: 'free' | 'slowed' | 'locked'; effects: AbilityEffect[] }
```

All times are integer ticks. `AbilityEffect` is one of:

| Effect | Fields | What it does |
| --- | --- | --- |
| `projectile` | `speed`, `radius`, `lifetimeTicks`, `pierce`, `effects` | spawns a projectile from the caster along the fire direction |
| `area` | `placement` (`self`, `ahead { distance }`, `aim { range }`), `radius`, `durationTicks`, `intervalTicks`, `targets`, `effects` | spawns an area; `ahead` goes `distance` m along the fire direction, `aim` goes to the aim point, at most `range` m |
| `meleeArc` | `radius`, `cosHalfAngle`, `effects` | swings an arc at the caster position along the fire direction |
| `dash` | `distance`, `ticks`, `then` | starts a dash along the fire direction; `then` effects fire where it ends and may not hold a dash |
| `teleport` | `range`, `fixed` | goes exactly `range` m along the fire direction, or only as far as the aim when not `fixed` |
| `applyStatus`, `shield`, `heal` | as the toolkit calls | land on the caster, never give energy |

`effects` inside a projectile, area or arc are hit effects (the `Effect` union,
including `energyGain`) that land on each champion the entity touches.

`createMatch(config, arena, seed, kits = [])` validates every kit it is given
(an invalid one throws `Invalid kit: <path>: <problem>`), rejects a duplicate id
(`Invalid match: duplicate kit id "..."`), gives a player whose `championId`
equals a kit id that kit's `maxHealth` and `moveSpeed` and its abilities, and
stores a deep copy of the kits the players use in `state.kits`, in the order they
were given. A player with no kit has no abilities, `DEFAULT_MAX_HEALTH` and
`BASE_MOVE_SPEED`. There is no default kit: the committed replay and scripted
fixtures press buttons with roster ids and the client and bots tests call
`createMatch` without kits, and all of them must keep behaving as before.

`validateKit` keeps every number inside what the primitive that receives it
accepts: cooldown 1 to 36000 ticks, windup 0 to 36000, lifetime, duration,
interval, dash ticks and status ticks 1 to 36000; projectile speed and radius,
area radius, placement distance and range, arc radius, teleport range, shield
absorb, heal amount, `maxHealth` and `moveSpeed` above 0 and at most 1e6; dash
distance 0.000001 to 1000; `cosHalfAngle` from -1 to 1; `energyGain` an integer
from 1 to 100; hit effects and status specs as the toolkit accepts them. It also
checks the structure: every slot present, non-empty effect lists, a known
movement rule, exactly two distinct EX slots (never F) that match the slots
carrying an `ex`. Catalog ranges (a stun of 30 to 120 ticks, 8 to 30 damage) are
not checked here; roster tests do that. The bounds keep `step` from throwing, not
cheap: the live entities of a kit grow with lifetime over cooldown, step 7
(`dropUnusedCasts`) is quadratic in them, and the catalog ranges keep them small.

### Casting

State: `champion.cooldowns` (seven integers in `SLOTS` order), `champion.cast`
(the windup in progress) and `state.casts` (`{ id, casterId, slot, ex, credited
}`, ids from `nextEntityId`). A slot's cooldown is set when its cast starts and
keeps counting during the windup; its EX variant shares it. Holding a button
with cooldown C casts every C ticks.

Step 3d resolves a cast for a champion that is alive, has no windup in
progress, and is neither stunned nor silenced. Slots are tried in the order F, R,
E, Q, SPACE, M2, M1, for the buttons held. With SHIFT held and an EX variant on
the slot, the EX variant is the ability. The cost is 100 for F, 25 for an EX
variant and 0 otherwise. A slot is passed over when its cooldown is above 0,
when the energy is below the cost (an EX with too little energy is rejected
without falling back to the normal ability, and the next slot is tried), or when
the champion is rooted and the ability has a top-level `dash`. The first slot
that passes pays the cost, sets the cooldown, creates the cast record and emits
`castStarted`. Rejections emit nothing. SHIFT on a slot without an EX variant
casts the normal ability. One cast starts per tick.

### Windup, movement and interruption

A windup of W ticks fires W turns after the start: the cast is stored with
`windupLeft = W`, step 3c lowers it by 1 and fires at 0, with the aim of that
tick. A windup of 0 emits `castFired` and runs the effects in the turn it starts,
and is never stored. The movement rule applies for W turns, the start tick
counting and the fire tick not: `free` walks at the normal speed, `slowed` at
half of it after slow and haste, `locked` not at all. Knockback and a dash still
move a champion in a locked windup.

Only stun, death and a round end interrupt a windup (`castInterrupted` reasons
`stun`, `death` and `roundEnd`; the event order is in [Statuses](#statuses),
[Damage](#damage-healing-and-death) and [Match flow](#match-flow)). Nothing is refunded, and the cooldown keeps
running. Silence, root, slow and knockback do not interrupt it. A rooted champion
whose windup fires skips the `dash` effect of the cast, fires that dash's `then`
effects at once and applies the rest of the ability.

### Firing

`castFired` is emitted first, then the effects run in list order. Each top-level
effect builds its own context when it runs: the origin is the caster's position
then, the direction is `direction(aim - origin)` for the aim stored this tick (in
centimeters, divided by 100), and a zero vector falls back to +x for team A and
-x for team B. A dash only moves the caster in step 3f, so effects listed after
it still act at the start point, and `then` is how an effect acts at the dash
end. When a dash ends `complete`, `blocked` or `rooted`, `step` fires its `then`
effects from the champion's position then, along the dash direction, with that
tick's aim.

### Energy

`landHit(state, { ownerId, castId }, targetId, effects, origin)` wraps
`applyEffects` for projectiles, areas and arcs, and gives the caster energy:

| Slot | Gain |
| --- | --- |
| F | 15 per target |
| any EX variant | 10 |
| M1 | 5 |
| M2, SPACE, Q, E, R | 10 |

An enemy target counts when, before the effects, it is alive and not invulnerable
and the effect list holds a `damage`: a hit that a shield absorbs completely
counts, and a status, a shield or a push alone does not. An ally target counts
when the caster's kit has `support`, the target is not the caster and the heals of
this application restored more than 0 health. A target gives energy once per cast
(`credited`), however many pulses of an area or effects touch it. The gain is the
table value plus every `energyGain` in the list, which only adds to a qualifying
gain, cut to the room under 100; `energyGained` is emitted when the amount is
above 0. Damage over time and heal over time pulses give nothing, and neither
does a hit with no cast id, which a dev tool spawn makes.

Cast records are dropped in step 7 once no windup, projectile, area or dash of
the cast refers to them.

`resetAbilityState(state)` in `cast.ts` is the hook `startRound` in `flow.ts`
calls at the start of every round, inside `roundStarted`. It sets every
champion's energy and cooldowns to 0, drops its windup and dash, empties
`statuses` and `state.casts`, sets `castId` to null on the projectiles and areas
still alive and emits nothing. It is not in the index.

## Match flow

State machine: `warmup -> round -> roundEnd -> (round | matchEnd)`. The numbers
are in rules.md section 1; the code is `flow.ts` and three checks in `step.ts`.

**Opt-in.** A match has match flow when its config has `roundsToWin`.
`state.match` is then:

```ts
interface MatchState {
  phase: 'warmup' | 'round' | 'roundEnd' | 'matchEnd';
  phaseTicks: number;             // steps completed in this phase
  round: number;                  // 0 in warmup, then the current or last decided round
  roundsToWin: number;
  score: { A: number; B: number };
  ring: { x: number; y: number; radius: number; damagePerTick: number } | null;
}
```

It starts as warmup, `phaseTicks` 0, round 0, score 0 : 0 and no ring. Without
`roundsToWin` the match is free play: the `match` key is missing, and `step`
does what it did before match flow existed: no warmup, no round clock, no ring
and no round end. A missing key keeps every free-play state and checksum bit for
bit what it was, so the committed fixtures, the bots tests and the client's
walk spec need no change.

**Phases.**

- Warmup: 180 ticks (`WARMUP_TICKS`). The steps that make `state.tick` 1 to 180
  are locked, and round 1 starts in the step that makes it 180.
- Round: no length of its own. Steps 3 to 7 run as in free play. The round
  clock is 5400 ticks (`ROUND_TICKS`); from the step that makes `state.tick`
  5581 (counting from a round that started at tick 180) sudden death runs.
- Sudden death: the ring starts at the arena's `startRadius` and reaches
  `endRadius` 1800 ticks (`SUDDEN_DEATH_TICKS`) later, then holds. For the v1
  arena (18 m to 3 m) the radius after the step that makes `state.tick` 5581 is
  18, after 5582 it is 17.991666666666667, after 5701 it is 17, after 6481 it
  is 10.5, after 7380 it is 3.008333333333333 and after 7381 it is 3. Ring
  damage ignores shields, gives no energy and is blocked by invulnerable. There
  is no win by timer: only a dead team decides a round.
- Round end pause: 180 ticks (`ROUND_END_TICKS`). The deciding step is the
  first of them, so a round decided in the step that makes `state.tick` T is
  followed by `roundStarted` or `matchEnded` in the step that makes it T + 179.
  Locked.
- Match end: reached from the pause when a score has reached `roundsToWin`,
  with `matchEnded`, `phaseTicks` 0. It never ends; the steps are locked.
- No cap on rounds: draws score nothing, so a match can run longer than
  `2 * roundsToWin - 1` rounds.

**Locked steps** run only step L: the aim is stored and the facing follows it
for every alive champion, the walk velocity is `+0`, and nothing else changes.
Inputs are still read first, so a throwing input throws with the state
unchanged. Statuses, a dash and the ring stay frozen through the pause.

**The deciding step** (step 6c) emits, in this order: the deaths of that tick,
`roundEnded`, `castInterrupted` (`roundEnd`) per windup in champion id order,
`projectileExpired` (`roundEnd`) per projectile in id order at its position,
`areaExpired` per area in id order. Each projectile therefore still gets
exactly one `projectileExpired`. The client package may rely on this order.

**The round reset** (`startRound`, the same for round 1 and every later round)
runs in the last locked step of the warmup or the pause: leftover projectiles and
areas end with `projectileExpired` (`roundEnd`) or `areaExpired` (only a dev
tool spawn made between steps in a locked phase can leave one), each champion
goes back to its spawn in the team slot order of `createMatch` with velocity
`+0`, `health = maxHealth` and `alive = true`, `resetAbilityState` runs (energy
0, cooldowns 0, no status, dash or cast, `casts` empty), the ring is dropped,
`round` counts up, the phase is `round`, and `roundStarted` is emitted last. The
score and `nextEntityId` carry over, and so do the aim and the facing.

`createMatch` rejects a bad `roundsToWin` (see [State and
API](#state-and-api-surface)). The sim never reads the wall clock for the round
timer: it counts steps.

The ring values come from the arena definition. See [assets](assets.md).

## Determinism rules

Enforced by review, lint and tests.

1. No `Date`, `performance.now`, timers, `Math.random`, or I/O in `sim`.
2. All time is integer ticks. All durations in config are converted to ticks
   once, at `createMatch`.
3. Iterate arrays in index order; never iterate object keys for gameplay logic.
4. The sim uses only correctly rounded operations (`+ - * /`, `Math.sqrt`),
   the exact helpers `Math.abs`, `Math.round`, `Math.min`, `Math.max` and
   `Math.imul`, the constant `Math.PI`, and the deterministic ports in
   `dmath.ts`. V8's `Math.atan2`, `Math.sin` and `Math.cos` differ in the last
   bit across CPU architectures (x86 Linux and ARM macOS) and are never used in
   the sim; a committed bit-pattern fixture checks the `atan2` port on every CI
   run. Kit cosines are decimal literals in the kit data, never computed, and
   the sim uses no `Math.floor`, `Math.ceil`, `Math.trunc` or `Math.sign` either
   (grep for them; lint does not). Guard against `NaN`: tests assert `checksum`
   is finite and that no position or health is `NaN`.
5. Recorded input replays with expected checksums are committed as fixtures.
   Changing gameplay intentionally means regenerating the fixture in the same
   change.

See [testing](testing.md) for the replay fixture tests.
