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

  Ability cast, status applied, round and match events join with abilities and
  match flow. Hit and expired positions are the projectile centre at contact
  (the final position for `lifetime`).

Randomness goes through a seeded PRNG stored in the state. Given the same seed
and the same input stream, `checksum` after N ticks is identical on every run.

## Entities

- Champion: team, champion id, position, velocity, facing (aim angle), health,
  max health, energy 0..100, per-slot cooldowns in ticks, cast state (slot,
  remaining windup ticks), statuses, alive flag.
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

An effect is plain data, `{ type: 'damage' | 'heal', amount }`, and the entity
holds its own copy, so kit constants are never aliased into the state.

## Tick order

`step` does the following, in this order:

1. Read and sanitize every input into an array, with no mutation.
2. Clear `state.events`.
3. For each champion in id order: skip a dead one; otherwise apply input, move,
   face the aim and resolve collision.
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

- Damage removes `min(health, amount)`, emits `damage` with the amount actually
  removed (health before minus health after) and the health afterwards, and at
  0 health sets `alive = false`, zeroes the velocity and emits `death` once,
  right after that damage event. Damage to a dead champion does nothing, and
  an amount too small to change the health (below half an ulp of it) emits
  nothing.
- Healing restores up to `maxHealth`, emits `heal` with the amount actually
  restored (health after minus health before), and emits nothing when that
  amount is 0, also when the amount is too small to change the health. A dead
  champion is not revived.
- A non-finite or negative amount throws; 0 does nothing. An unknown target id
  throws `Error('Invalid damage: ...')` or `Error('Invalid heal: ...')`.
- A dead champion is skipped in the movement loop (no input, aim, facing or
  move), is no obstacle for other champions and is never touched by
  projectiles or areas.

`applyDamage` is an internal building block, not a kit primitive. Projectiles
and areas use it, and the melee arc and the ring will.

## Toolkit entry points

The sim modules `projectile.ts` and `area.ts` export `spawnProjectile(state,
spec)` and `spawnArea(state, spec)`, which return the new entity id, and
`health.ts` exports `applyDamage`, `applyHeal` and `applyEffects`. They are not
part of the package index: kits will call them when abilities arrive. A spawn
throws `Error('Invalid projectile: ...')` or `Error('Invalid area: ...')` on an
unknown owner, a non-finite number, a zero direction, a direction too large to
measure (a component beyond about 1.3e154, the square root of the largest
double) or too small to measure (both components below 1e-150 in magnitude but
not both zero, since the squares inside the length turn subnormal below about
1.5e-154), a speed or radius at or below 0, a lifetime, duration or interval
that is not a positive integer, a projectile `pierce` that is not a boolean,
`effects` that is not an array, an effect of an unknown type, or an effect
amount at or below 0. A dead owner may still spawn.

## Statuses

Catalog: stun, root, silence, slow (percent), haste (percent), shield
(absorb amount), damage over time, heal over time, knockback (velocity impulse
decaying over ticks), invulnerable. Each status has a remaining tick count. The
same status from the same source refreshes duration rather than stacking.
Different sources stack unless the design doc says otherwise for that status.
Stun blocks movement and casting. Root blocks movement only. Silence blocks
casting only.

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
  the design doc first, then the sim.
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
   `Math.imul`, and the deterministic ports in `dmath.ts`. V8's `Math.atan2`,
   `Math.sin` and `Math.cos` differ in the last bit across CPU architectures
   (x86 Linux and ARM macOS) and are never used in the sim; a committed
   bit-pattern fixture checks the `atan2` port on every CI run. Guard against
   `NaN`: tests assert `checksum` is finite and that no position or health is
   `NaN`.
5. Recorded input replays with expected checksums are committed as fixtures.
   Changing gameplay intentionally means regenerating the fixture in the same
   change.

See [testing](testing.md) for the replay fixture tests.
