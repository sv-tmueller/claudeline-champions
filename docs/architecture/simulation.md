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

- `createMatch(config: MatchConfig, arena: ArenaDef, seed: number): GameState`
  takes the parsed arena, because the sim does no I/O. `parseArenaDef` turns
  arena JSON into an `ArenaDef`.
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
  | `projectileExpired` | `projectileId`, `reason` (`hit`, `obstacle`, `boundary`, `lifetime`), `x`, `y` |
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

  Cast and energy events join with the kit contract, round and match events
  with match flow. Hit and expired positions are the projectile centre at
  contact (the final position for `lifetime`).

Randomness goes through a seeded PRNG stored in the state. Given the same seed
and the same input stream, `checksum` after N ticks is identical on every run.

## Entities

- Champion: team, champion id, position, velocity (the walk velocity), facing
  (aim angle), health, max health, energy 0..100, `statuses` (a list of
  `StatusInstance` records in application order, see [Statuses](#statuses)),
  `dash` (`null` or a record, see [Forced motion](#forced-motion)) and the alive
  flag. Per-slot cooldowns and the cast state join with the kit contract.
- Projectile: id, owner, team (copied from the owner at spawn), position,
  velocity, radius, remaining lifetime ticks, pierce flag, the champions it has
  already hit (`hitIds`, in hit order) and an inline `effects` list.
- Area: id, owner, team, shape (circle today, cone and rectangle later),
  position, radius, targets filter, remaining ticks, tick interval, ticks to
  the next application and an inline `effects` list.
- Obstacle: static, from the arena definition.
- Ring (sudden death): center, current radius, damage per second.

Projectiles and areas share one id space with `state.nextEntityId`. Champion
ids are `0` to `n-1` (so `inputs[i]` is champion `i`), and the counter starts at
`champions.length`. Ids are never reused. `state.projectiles` and `state.areas`
hold the entities in ascending id order; removed ones are filtered out after a
phase, never spliced during iteration.

An effect is plain data and the entity holds its own copy, so kit constants are
never aliased into the state. The `Effect` union is `damage { amount }`, `heal
{ amount }`, `applyStatus { status }` (a status spec: the type, `ticks` and the
strength field of that type), `shield { absorb, ticks }` and `knockback
{ distance, ticks, direction: 'away' | 'toward' }`. A hit applies its effects in
list order to each champion it lands on, with the owner as the source and no
slot. `away` points from the hit origin (the projectile contact point, the area
centre, the arc origin) to the target, `toward` from the target to the owner's
current position, and a zero vector means no push.

`Slot` (`M1`, `M2`, `SPACE`, `Q`, `E`, `R`, `F`) and `SLOTS` in `input.ts` list the
slots in `Button` bit order.

## Tick order

`step` does the following, in this order:

1. Read and sanitize every input into an array, with no mutation.
2. Clear `state.events`.
3. For each champion in id order, skipping a dead one:
   1. Store the aim.
   2. Walk: the walk velocity is the move direction times the speed, where the
      speed is the base speed times the speed factor (see
      [Statuses](#statuses)); it is `+0` while the champion is stunned, rooted
      or dashing. Move, face the aim and resolve collision, exactly as before.
   3. Forced motion (see [Forced motion](#forced-motion)): if rooted, a running
      dash ends first (`rooted`); then the dash step and each knockback impulse
      move the champion in substeps. Stun and root do not stop this step.
   4. Status upkeep: due pulses of damage over time and heal over time, then
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
7. `tick++`.

A projectile with lifetime L makes exactly L sweeps. An area with duration D
and interval I applies `ceil(D / I)` times, on its ticks 0, I, 2I and so on;
with D = 1 and I = 1 it applies once and expires in the same step. Entities
spawned between steps act from the next step on.

A status lasting D ticks affects exactly D turns of its holder, whether it was
applied between steps or by a hit in steps 4 and 5 (those reach the holder's
upkeep in the next tick). Entities must never be spawned during steps 4 to 6,
because those steps replace the entity arrays with `filter`. Casting joins
between 3.1 and 3.2 with the kit contract: cooldowns count down, a windup
runs, and a cast that fires in a champion's turn spawns entities that act in
steps 4 and 5 of the same tick.

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
  ends with `dashEnded` reason `death`. Damage to a dead champion does nothing,
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

`applyDamage` is an internal building block, not a kit primitive. Projectiles,
areas, melee arcs and damage over time use it, and the ring will.

## Toolkit entry points

These are module exports of the sim, not part of the package index. Kits reach
them from inside the sim when abilities arrive.

| Module | Export | Returns |
| --- | --- | --- |
| `projectile.ts` | `spawnProjectile(state, spec)` | the new entity id |
| `area.ts` | `spawnArea(state, spec)` | the new entity id |
| `melee.ts` | `meleeArc(state, spec)` | the target ids |
| `status.ts` | `applyStatus(state, targetId, spec, source)` | whether anything changed |
| `status.ts` | `applyShield(state, targetId, { absorb, ticks }, source)` | whether a shield was added |
| `status.ts` | `applyKnockback(state, targetId, { dirX, dirY, distance, ticks }, source)` | whether a push was added |
| `motion.ts` | `startDash(state, championId, { dirX, dirY, distance, ticks })` | whether the dash started |
| `motion.ts` | `teleport(state, championId, toX, toY)` | false when blocked |
| `health.ts` | `applyDamage`, `applyHeal`, `applyEffects` | |

`source` is `{ sourceId, slot }`, with a null slot for a direct call. The two
spawn functions are also exposed on the package index under the `debug`
namespace for tests and client dev tools only; gameplay code outside the sim
must not call them. Every function throws `Error('Invalid <thing>: ...')` for
bad input before it changes anything.

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
  reject, a shield with no absorb from above 0 to 1e6 or ticks from 1 to 36000, a
  knockback with a distance outside 0 to 1e6, ticks outside 1 to 36000 or a
  direction other than `away` or `toward`). A dead owner may still spawn.
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
  is zero or not finite, a distance that is not a number above 0 and at most
  1000 m, or ticks that are not a positive integer. A dead champion is a no-op.
- `teleport` throws `Invalid teleport: ...` on an unknown champion or a point
  that is not finite. A dead champion is a no-op with no event.

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

Walk speed is `BASE_MOVE_SPEED * (1 + (haste - slow) / 100)`, with the capped
totals. With no slow or haste the factor is exactly 1, so the speed stays
exactly 5.5 m/s. Stun, root and a running dash zero the walk velocity, which is
then stored as `+0`; the stored velocity is the walk velocity only, never the
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
first push happens in the next step after it was applied.

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
(`dashEnded` reason `stunned`, after `statusApplied`).

## Forced motion

A dash and knockback impulses move a champion regardless of stun, root and (with
abilities) a locked windup. They are step 3.3 of the tick.

`champion.dash` is `null` or `{ dirX, dirY, stepLength, ticksLeft }`.
`startDash(state, id, { dirX, dirY, distance, ticks })` sets it with
`stepLength = distance / ticks`, emits `dashStarted` and ends a running dash as
`replaced`. A dash moves `stepLength` meters a tick for `ticks` ticks.

Each tick, in step 3.3:

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
- A dash may not be longer than 1000 m, to keep the substep loop short.
- Shield absorption emits one `shieldAbsorbed` per hit, not one per shield.
- A refresh of any status emits `statusExpired` (`replaced`) then `statusApplied`,
  also for damage over time, where the instance keeps its pulse timer.
- Statuses applied by a hit carry no slot until casting provides one.
- A pulse due on the last tick of a status lands before the status ends.
- `teleport` reports the end position, and a teleport that cannot be resolved
  reports `blocked: false` with the start as the end position.

## Abilities and the effects toolkit

Slots follow the Bloodline layout: `M1` (basic), `M2` (secondary), `SPACE`
(mobility), `Q`, `E`, `R` (utility, offense, defense), `F` (ultimate). Holding
`SHIFT` with a slot casts that slot's EX variant where the kit defines one.
Each kit defines exactly two EX variants.

- EX variants cost 25 energy. The ultimate costs 100 energy. Energy is earned
  only by landing abilities on enemies and, for support kits, by healing
  allies. Energy resets to 0 at the start of each round.
- Every ability has: cooldown ticks, windup ticks (0 for instant), movement
  rule during windup (free, slowed, locked), and a list of effects.
- Effects toolkit (the only primitives kits may use): `projectile`, `dash`,
  `meleeArc`, `area`, `applyStatus`, `heal`, `shield`, `teleport`,
  `knockback`, `energyGain`. New primitives are added to the toolkit through
  the design doc first, then the sim. Statuses, forced motion and all of these
  but `energyGain` exist as the primitives in
  [Toolkit entry points](#toolkit-entry-points); the kit contract that calls
  them arrives next.
- No global cooldown. Casting is blocked while another windup is in progress,
  while stunned, and while silenced (mobility slot included).
- Health does not regenerate during a round except through healing effects.

## Match flow

State machine: `warmup -> round -> roundEnd -> (round | matchEnd)`.

- Warmup: 3 seconds, movement and casting locked, champions at spawn.
- Round: 90 seconds. A team wins the round when every enemy champion is dead.
- Sudden death: when the round timer expires, a ring centred on the arena
  shrinks linearly from `ring.startRadius` to `ring.endRadius` over 30 seconds
  and deals `ring.damagePerSecond` to champions outside it, then holds at
  `endRadius` until the round resolves.
- If both teams lose their last champion on the same tick the round is a draw:
  no score, next round.
- Round end: 3 seconds, then full heal, cooldown reset, energy to 0, respawn at
  the team's spawn points.
- Match end: first team to `roundsToWin` (default 3) round wins.
- `MatchConfig`: team size (2 or 3) and per-player champion id and team
  (`players[i]` becomes champion id `i`). Rounds to win joins it with match
  flow. The arena and the seed are `createMatch` parameters, not config fields.

The ring values come from the arena definition. See [assets](assets.md).

## Determinism rules

Enforced by review, lint and tests.

1. No `Date`, `performance.now`, timers, `Math.random`, or I/O in `sim`.
2. All time is integer ticks. All durations in config are converted to ticks
   once, at `createMatch`.
3. Iterate arrays in index order; never iterate object keys for gameplay logic.
4. The sim uses only correctly rounded operations (`+ - * /`, `Math.sqrt`),
   the exact helpers `Math.abs`, `Math.round`, `Math.min`, `Math.max` and
   `Math.imul`, the constant `Math.PI`, and the deterministic ports in `dmath.ts`. V8's `Math.atan2`,
   `Math.sin` and `Math.cos` differ in the last bit across CPU architectures
   (x86 Linux and ARM macOS) and are never used in the sim; a committed
   bit-pattern fixture checks the `atan2` port on every CI run. Guard against
   `NaN`: tests assert `checksum` is finite and that no position or health is
   `NaN`.
5. Recorded input replays with expected checksums are committed as fixtures.
   Changing gameplay intentionally means regenerating the fixture in the same
   change.

See [testing](testing.md) for the replay fixture tests.
