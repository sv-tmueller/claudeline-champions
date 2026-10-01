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
  `blocksProjectiles`.

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
the wire later. A missing input for a player on a tick is treated as "no
movement, no buttons, aim unchanged".

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
- `state.events: SimEvent[]` cleared at the start of each tick, appended during
  the tick: ability cast, projectile spawn, hit, heal, status applied, death,
  round start, round end, match end. The renderer and audio consume events.
  Events are not needed to reproduce state.

Randomness goes through a seeded PRNG stored in the state. Given the same seed
and the same input stream, `checksum` after N ticks is identical on every run.

## Entities

- Champion: team, champion id, position, velocity, facing (aim angle), health,
  max health, energy 0..100, per-slot cooldowns in ticks, cast state (slot,
  remaining windup ticks), statuses, alive flag.
- Projectile: owner, position, velocity, radius, remaining lifetime ticks,
  pierce flag, on-hit effect reference.
- Area: owner, shape (circle or cone or rectangle), position, remaining ticks,
  tick interval, effect reference.
- Obstacle: static, from the arena definition.
- Ring (sudden death): center, current radius, damage per second.

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

Enforced by review and tests.

1. No `Date`, `performance.now`, timers, `Math.random`, or I/O in `sim`.
2. All time is integer ticks. All durations in config are converted to ticks
   once, at `createMatch`.
3. Iterate arrays in index order; never iterate object keys for gameplay logic.
4. Floats are fine (same engine everywhere). Guard against `NaN`: tests assert
   `checksum` is finite and that no position or health is `NaN`.
5. Recorded input replays with expected checksums are committed as fixtures.
   Changing gameplay intentionally means regenerating the fixture in the same
   change.

See [testing](testing.md) for the replay fixture tests.
