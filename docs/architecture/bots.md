# Bots

`packages/bots`. Source: spec section 6. Bots import `sim` only. See
[packages](packages.md).

## API

`createBot(playerId, difficulty, seed) -> { think(state: GameState): PlayerInput }`.
Bots run inside the same process as the sim (browser locally, server online).
They read the full state; fairness comes from difficulty tiers, not hidden
information.

## Navigation

A-star over a coarse grid (0.5 m cells) baked from the arena definition, plus
local steering to avoid champions and projectiles.

- Cells: a cell is blocked when a champion centred on the cell centre would
  overlap an obstacle inflated by the champion radius or leave the boundary.
  Touching counts as free, and every obstacle blocks whatever its
  `blocksProjectiles` flag. A free cell can still lie partly inside an
  inflated obstacle, so every path edge also passes an exact segment test
  against the inflated obstacles and the boundary.
- Search: eight neighbours, no corner cutting, octile heuristic. The open set
  breaks ties by f, then h, then cell index, so a grid and two endpoints
  always give the same path. String pulling keeps the farthest waypoint still
  in line of walk.
- Arrival: a bot has reached a waypoint within 0.1 m, more than one tick of
  walking (about 0.092 m), so it always stops.
- Drift: eight-direction steering toward a far waypoint drifts up to about 10
  percent of the segment's length off the straight line. The path follower
  caps it by splitting each segment into points at most one cell apart. It
  lives in the walk test until the bot decisions package moves it into
  `packages/bots/src`.

## Decisions

Utility scoring over candidate intents: engage, kite, dodge a predicted
projectile, retreat, peel for an ally, hold position, use the ultimate. Each
champion kit ships a small bot profile describing preferred range and which
slots are openers, escapes and finishers.

## Aim

Lead moving targets using their current velocity; add a tier-dependent angular
error.

## Difficulty tiers

Easy, normal, hard. They differ in reaction delay (ticks between a change in
the world and a change in intent), aim error, and dodge probability.

## Testing

Bot-versus-bot headless matches are integration tests: a full match must
finish, invariants must hold, and no `NaN` may appear. See
[testing](testing.md).
