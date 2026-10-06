# Arena design principles

Status: v1 principles, checked by `tools/blender/test_arena_principles.py`. Two arenas: arena01 (grandfathered, see section 8) and arena02
Source of truth for numbers: [design spec](../superpowers/specs/2026-10-01-claudeline-champions-design.md), sections 4.1, 4.7, 8.1 and 10
Companion document: [game rules and controls](rules.md)

This document sets the rules every arena must follow. It contains no specific arena layout. Layouts live in the arena definition files, which follow the data format in section 8.1 of the spec. Section 8 lists the arenas.

`[spec]` marks a value copied from the design spec. `[tuned]` marks a value chosen here, which a balance pass may move.

The sample arena JSON in spec section 8.1 is a schema illustration, not a compliant layout. Its rect obstacle at (-6, 5) has no mirrored twin at (6, 5), for example.

## 1. Playable area

- The playable area is a rectangle centred on the origin `[spec]`.
- Arena 1 is 30 m wide and 20 m tall `[spec]`. Other arenas should use the same size until a design reason says otherwise `[tuned]`.
- The boundary rectangle is a wall `[spec]`. It blocks movement and projectiles.
- Coordinates are in meters. `+x` is east and `+y` is north `[spec]`.
- A champion is a circle with a radius of 0.5 m `[spec]`.

## 2. Symmetry

- Every arena is left-right symmetric. It mirrors across the line `x = 0` `[tuned]`. The spec states this for Arena 1 only. This rule extends it to every arena.
- Every obstacle at `(x, y)` has a twin at `(-x, y)` with the same type, size and `blocksProjectiles` value `[tuned]`.
- An obstacle centred on `x = 0` is its own twin. It must be symmetric itself.
- Circles and axis-aligned rectangles stay the same kind of shape when mirrored, so the rule holds for every allowed obstacle type.
- Obstacle positions are the shape centres `[tuned]`.
- Spawn points mirror too. Spawn number `i` of team A mirrors to spawn number `i` of team B.
- Symmetry across `y = 0` is allowed but not required.

## 3. Spawns

- Each team has up to three spawn points `[spec]`. A 2v2 uses the first two. A 3v3 uses all three.
- Team A spawns in the west half and team B in the east half `[tuned]`.
- Opposing spawn points are 20 to 26 m apart `[tuned]`. This leaves room to move and use cover before the first fight.
- The first two spawn points of a team are the 2v2 pair. They sit 2 to 4 m apart, mirrored across `y = 0` `[tuned]`, so a 2v2 start is fair for both champions.
- The third spawn point sits so that a 3v3 start does not give one champion a better position than the others `[tuned]`.
- Teammates start at least 2 m apart, so the 1 m wide champions do not overlap `[tuned]`.
- A spawn point is at least 2 m from the boundary wall and at least 3 m from the edge of any obstacle `[tuned]`.
- Spawn points are used at the start of every round, after the reset described in the [rules document](rules.md).

## 4. Obstacle types

Only two shapes are allowed `[spec]`:

| Type | Fields |
|------|--------|
| `circle` | `x`, `y`, `r` |
| `rect` | `x`, `y`, `w`, `h` (axis-aligned, never rotated) |

Every obstacle also has a `height` and a `blocksProjectiles` flag.

- Every obstacle blocks movement `[spec]`.
- `height` is visual only `[spec]`. The sim ignores it.
- Obstacles lie fully inside the playable area and do not overlap each other `[tuned]`.
- The smallest allowed size is a radius of 0.5 m for a circle and 0.5 m on each side for a rectangle `[tuned]`.

## 5. The `blocksProjectiles` rule

- `blocksProjectiles: true` means the obstacle blocks projectiles and blocks line of sight `[spec]`.
- `blocksProjectiles: false` means champions cannot walk through the obstacle, but projectiles and line of sight pass over it `[spec]`. It works as low cover that blocks movement only.
- Line of sight is a segment-versus-obstacle test against the obstacles with the flag set `[spec]`.
- Piercing projectiles are still stopped by flagged obstacles. Piercing only changes how they treat champions `[tuned]`.
- The boundary wall always blocks projectiles.
- Make the flag readable from the camera. A blocking obstacle should have a `height` of at least 1.8 m. A non-blocking obstacle should have a `height` of at most 0.8 m `[tuned]`.

## 6. Cover density and line of sight

- Obstacles cover 5 to 10 percent of the playable area `[tuned]`. For a 30 m by 20 m arena that is 30 to 60 m2 of a 600 m2 floor.
- Use both kinds of obstacle. At least one mirrored pair should block projectiles and at least one mirrored pair should not `[tuned]`.
- No single obstacle is longer than 6 m in any direction `[tuned]`. Players must be able to go around cover.
- From any point of the floor, an obstacle with `blocksProjectiles: true` is within 8 m `[tuned]`. A player is never stranded in the open.
- Every gap between two obstacles, or between an obstacle and the wall, is at least 1.5 m wide `[tuned]`. A 1 m wide champion passes with room to spare, and the bot grid of 0.5 m cells can route through it.
- The floor is one connected area. Every point can be reached on foot from every spawn point. No pocket is closed off.

## 7. Sudden death ring

- The ring is centred on the arena, which is the origin `[spec]`.
- It shrinks linearly from `startRadius` 18 m to `endRadius` 3 m over 30 s and deals `damagePerSecond` 10 to champions outside it `[spec]`.
- The 18 m start radius covers almost the whole 30 m by 20 m floor. The corner of the floor lies about 18.03 m from the centre.
- The ring values are stored in the arena definition under `ring`. v1 arenas use the values above `[spec]`.
- The circle inside `endRadius` must be playable. It holds at least 20 m2 of walkable floor and every part of it is reachable `[tuned]`. The full circle is about 28 m2.
- Keep obstacles inside the end circle small, so the last fight stays a fight and nobody can hide from the ring and every enemy at once `[tuned]`.

## 8. The arenas

| id | name | intent |
|----|------|--------|
| `arena01` | Arena 1 | A fight around a central pillar. The pillar sits inside the end circle, and the lanes beside it are open, so a round opens with a long-range duel. |
| `arena02` | Arena 2 | The reverse. The centre is open floor, so the whole end circle is walkable and sudden death is fought in the open. Two walls in front of the spawns cut every sightline between them, so a round opens with movement, not a duel. Pillars and posts give flank and lane cover. Low walls fence the centre for movement only. |

Layouts are in `data/arenas/<id>.json`, and both use the ring values of section 7.

`arena01` breaks two rules of this document, and it is grandfathered. Six of its blocking obstacles are 1.5 m high, where section 5 asks for at least 1.8 m. Its corners are 10.7 m from the nearest blocking obstacle, where section 6 asks for at most 8 m. It cannot change, because every sim fixture checksums `state.arena`, so a new height or a new obstacle would move every checksum. No other arena may break a rule.

`tools/blender/test_arena_principles.py` checks sections 3 to 7 against every file in `data/arenas`, so a new arena is checked without an edit to the test. It expects no problem from any arena except `arena01`, for which it pins exactly these two, so a third deviation, or a repair of one of these, fails the test.
