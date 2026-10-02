# Bots

`packages/bots`. Source: spec section 6. Bots import `sim` only. See
[packages](packages.md).

## API

`createBot(playerId, difficulty, seed) -> { think(state: GameState): PlayerInput; inspect(): { intent, targetId } }`.
Bots run inside the same process as the sim (browser locally, server online).
They read the full state; fairness comes from difficulty tiers, not hidden
information.

- Call `think` once per tick, before `step`; it never mutates the state or
  touches `state.rng`, and returns `buttons` 0 until bots use abilities.
- `inspect()` is read-only and returns a fresh copy of the intent and target the
  bot is acting on. It exists so tests and dev tools can observe decisions.
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
    shoved bot does not plan every tick. At most one plan per call.
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
champion kit ships a small bot profile describing preferred range and which
slots are openers, escapes and finishers.

Built so far (movement only): engage, kite, retreat, plus idle. Idle means no
enemy is alive: the bot stands and keeps its aim.

Target: the bot keeps its current target while it is alive, unless another
alive enemy is more than 1 m nearer. Otherwise the target is the nearest alive
enemy by centre distance; the scan runs in id order and a tie goes to the lower
id.

With `d` the distance to the target, `h` health over maximum health, and
`[rangeMin, rangeMax]` from the profile, scores are clamped to 0 to 1:

| Intent  | Score                                                | Movement                                                                                                                      |
| ------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| engage  | 0.5                                                  | stand when `d <= rangeMax` and the target is in line of sight, otherwise follow the path to the target                         |
| kite    | `rangeMin > 0 ? 0.6 + (rangeMin - d) / rangeMin : 0` | stand when `d >= rangeMin`, otherwise step to the first free point 1 m away: straight away, then 45, -45, 90, -90 degrees      |
| retreat | `0.6 + (0.3 - h) / 0.3`                              | follow the path to the bot's own spawn point (slot = teammates with a lower id) and stand there                                |

Hysteresis: the bot switches only when the best other intent scores more than
the current one plus 0.1. Ties go to retreat, then kite, then engage. This
makes kite start at `d < rangeMin` and end at `d > 1.2 rangeMin`, and retreat
start at `h < 0.3` and end at `h > 0.36`. After idle the next decision starts
again from engage.

Profiles live in `packages/bots/src/profile.ts`, keyed by champion id. Until
kits exist they are plain constants with a default; the roster-kit package
decides whether they move into the kit modules.

| Champion | rangeMin | rangeMax | Note                                         |
| -------- | -------- | -------- | -------------------------------------------- |
| hargrim  | 0        | 3        | melee, never kites                           |
| quillon  | 6        | 13       | ranged, backs away inside 6 m                |
| lumeth   | 6        | 10       | support, keeps range, no ally logic yet      |
| skerrow  | 0        | 2.5      | assassin, closes in and never kites          |
| default  | 4        | 8        | any other champion id                        |

Every `rangeMax` exceeds 1 m, so a bot never needs to stand inside another
champion.

## Aim

Lead moving targets using their current velocity; add a tier-dependent angular
error.

- Lead: with `D` the vector from shooter to target, `V` the target velocity and
  `s` the nominal projectile speed (20 m/s), solve `a t^2 + b t + c = 0` with
  `a = V.V - s^2`, `b = 2 D.V`, `c = D.D`. The time is the positive root,
  `(b + sqrt(b^2 - 4ac)) / (-2a)` for `b >= 0` and `2c / (sqrt(b^2 - 4ac) - b)`
  otherwise, which avoids a cancelling subtraction. The aim point is the target
  position plus `V t`.
- Fallback: aim at the target when `c = 0`, `a >= 0` (the target is at least as
  fast as the projectile) or `t` is not finite.
- Error: the vector to the aim point turns by `2 atan(u)` with the rational
  form `cos = (1 - u^2) / (1 + u^2)`, `sin = 2u / (1 + u^2)`, so no
  trigonometry runs. `u` is drawn uniformly from `[-T, T]` and redrawn every 15
  ticks while the bot has a target.
- Rounding: `Math.round(v * 100) + 0` gives whole centimetres and never `-0`.

## Difficulty tiers

Easy, normal, hard. They differ in reaction delay (ticks between a change in
the world and a change in intent), aim error, and dodge probability.

| Tier   | Reaction delay | Aim error (largest) | T (`tan` of half the error) | Dodge probability |
| ------ | -------------- | ------------------- | --------------------------- | ----------------- |
| easy   | 30 ticks       | 12 degrees          | 0.10510423526567646         | with dodging      |
| normal | 15 ticks       | 6 degrees           | 0.0524077792830412          | with dodging      |
| hard   | 6 ticks        | 2 degrees           | 0.017455064928217585        | with dodging      |

Dodge probability arrives with dodging; profiles and scores are the same for
every tier. The delay is a ring of `delay` records: the bot decides on the
current state every tick, stores the decision, and acts on the one it stored
`delay` ticks earlier. Movement and aim use the current positions.

## Determinism

Bots need to repeat only within one process. The bot owns its PRNG (mulberry32,
seeded from `seed`), and `think` is a pure function of the state plus the bot's
private state. A bot keeps no module-level state, iterates arrays in index
order, never reads the wall clock or `Math.random`, never reads or writes
`state.rng`, never mutates the state, and stores copies of numbers and ids
rather than references into the state. Decisions use only `+ - * /`,
comparisons, `sqrt`, `abs`, `min`, `max`, `floor`, `ceil`, `round`, `hypot`,
`imul` and the sim's public exports. Bots do not use the sim's `dmath`. Review
enforces this; a lint row for `Math.random`, `Date` and `performance` in bots
source is a follow-up.

Bot output is not promised to be bit-identical across platforms, so no checksum
fixture of a bot-driven match is committed (batch #32 decision 1). A recorded
match replays exactly from its input stream.

## Not built yet

- A full match must finish: it waits for match flow, so the headless test runs
  a fixed 3600 ticks.
- Local steering around champions and projectiles, dodging, abilities and
  ally logic.
- A ranged bot standing in kite range without line of sight waits until the
  target moves, because kite stands once `d >= rangeMin`.

## Testing

Bot-versus-bot headless matches are integration tests: invariants must hold,
and no `NaN` may appear. The headless test runs a 2v2 match of four bots on
arena 1 for 3600 ticks with a mix of tiers, checks the sim invariants and the
input rules every tick, and checks that `think` leaves the state's checksum
unchanged. The determinism test runs the same match twice, and two matches
stepped in turn, and compares input streams and final checksums in memory. See
[testing](testing.md).
