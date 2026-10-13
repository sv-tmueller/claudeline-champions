# Asset pipeline

`tools/blender`. Source: spec sections 8 and 8.1.

## Blender scripts

- Blender runs locally in background mode: `tools/blender/run.sh <script.py> -- <args>`
  locates Blender at `$BLENDER` or `/Applications/Blender.app/Contents/MacOS/Blender`.
- `gen_arena.py --arena data/arenas/<id>.json --out assets/models/arenas/<id>.glb`
  builds floor, boundary walls and every obstacle from the arena definition.
- `gen_champion.py --champion <id> --out assets/models/champions/<id>.glb`
  builds a low-poly rigged humanoid with four clips. The spec names six clips
  (`Idle`, `Run`, `Attack`, `Cast`, `Hit`, `Death`); `Idle`, `Run`, `Cast` and
  `Death` are built, and `Attack` and `Hit` come with the client animation
  state machine in batch 10.
- `validate_glb.py` uses only the Python standard library: checks the glb
  magic and chunk layout, that required node names are present, and a
  champion's rig and clips. It also checks the arena JSON that an arena model
  is built from (see [Validator](#validator)). CI runs it on committed assets
  so Blender itself is never needed in CI.
- Generated `.glb` files are committed. Regenerating is a local step.

## Node naming

Arena nodes: `Floor`, `Wall_N`, `Wall_S`, `Wall_E`, `Wall_W`,
`Obstacle_<index>` matching the obstacle's index in the JSON.

## Asset contracts

These go beyond the spec. They are what the client and the sim can rely on.
The commands and file list are in `tools/blender/README.md`.

### Coordinates and origins

- Blender XY is sim XY, and Z is up. The exporter writes Blender `(x, y, z)`
  as glTF `(x, z, -y)`, which is the client mapping `(x, 0, -y)` on the
  ground. The scripts do no axis conversion.
- The floor and the walls keep their origin at the arena centre.
- Obstacles and the champion have their origin at their base. An obstacle sits
  at location `(x, y, 0)` and its geometry runs from local z = 0 up to its
  height. The champion has its origin at the feet.
- Watch the names in the arena schema. A rect's `h` is its extent along Y, and
  `height` is its extent along Z. `size.height` is the extent along Y too, not
  vertical.

### Arena model

- `Floor` covers exactly `size.width` by `size.height`, 0.2 m thick, with its
  top at z = 0.
- The walls are 0.5 m thick and 1.0 m high. They sit outside the playable
  area, with their inner faces on the edge of the rectangle (x = +-15 and
  y = +-10 for arena 1).
- `Wall_N` is at +y and `Wall_E` is at +x. `Wall_N` and `Wall_S` are longer by
  two wall thicknesses (31 m for arena 1) so the corners close.
- Obstacle models use a different flat material for blocking and non-blocking
  obstacles, so a viewer can see which obstacles stop projectiles.
- The visuals come from the same JSON as the collision.
- Both arenas, `arena01` and `arena02`, have a committed glb and a case in
  `test_export_determinism.py`, and `ArenaCoverageTests` fails if an arena glb,
  an arena definition or a case is missing. The walls sit at x = +-15 and
  y = +-10 in both. `arena02` needed no generator change: `gen_arena.py` is
  driven by the JSON.
- The client loads every arena under `data/arenas` by id: `?arena=<id>` picks
  the model (`arena02.glb` for `arena02`), `arena01` is the default and the
  sandbox's arena, and the arena select links to each.
- `test_arena_principles.py` checks every arena definition against the
  [arena principles](../design/arenas.md). `arena01` is grandfathered for two
  deviations, and the test pins them.

### Champion model

- The node name is `Champion`. The validator requires it in every file under
  `champions/`.
- The champion faces +X in both Blender and glTF. The client sets
  `rotation.y = aimAngle` directly, so the front must stay on +X.
- The origin is at the feet. The footprint stays inside a 0.5 m radius and the
  model is about 1.7 m tall.
- Flat colours only. Every champion model is rigged and has four clips, and
  the client plays none of them yet.
- Each of the four roster ids has `champions/<id>.glb` with the placeholder's
  nodes, origin, facing, body geometry, rig, clips and accent. They differ only
  in body colour and one silhouette cue that stays below 1.9 m.
  `placeholder.glb` stays the generic model and has the same rig and clips, so
  every champion id has them. The ids, colours and cues are in
  [`tools/blender/README.md`](../../tools/blender/README.md).
- The scene lists one node, `Rig`. Its children are `Hips` and the skinned mesh
  `Champion`, and neither `Rig` nor `Champion` has a translation, rotation or
  scale. The rest pose is the static geometry, so the bind pose matches the
  model drawn before the rig existed. A model with no clip playing shows its
  bind pose: scale 1, facing +X, origin at the feet.
- Every part is rigid: each vertex has weight 1.0 on one bone.
- The client clones each model with SkeletonUtils' `clone`. `Object3D.clone`
  shares the source skeleton, so every view of a rigged model would draw at the
  arena origin.

### Rig

One rig for all five models, in Blender coordinates (Z up). Every bone has roll
0 and is not connected to its parent. L is +Y, the champion's left when it
faces +X. The validator checks the names and the parents.

| Bone | Parent | Head | Tail | Carries (rigid, weight 1.0) |
|------|--------|------|------|-----------------------------|
| `Hips` | node `Rig` | (0, 0, 0.80) | (0, 0, 0.90) | nothing; the root that moves the whole body |
| `Spine` | `Hips` | (0, 0, 0.90) | (0, 0, 1.70) | torso, head, chest plate, visor, Hargrim's shoulder blocks, Lumeth's halo |
| `Arm_L` | `Spine` | (0, 0.34, 1.40) | (0, 0.34, 0.80) | the left arm box |
| `Arm_R` | `Spine` | (0, -0.34, 1.40) | (0, -0.34, 0.80) | the right arm box, Quillon's staff, Skerrow's blade |
| `Leg_L` | `Hips` | (0, 0.12, 0.80) | (0, 0.12, 0.00) | the left leg box |
| `Leg_R` | `Hips` | (0, -0.12, 0.80) | (0, -0.12, 0.00) | the right leg box |

### Clips

The scene rate is 30 fps. Every clip keys the rotation of all six bones and the
translation of `Hips` at each listed frame, all with LINEAR interpolation.
The last key of a looping clip equals its first. The pose values are constants
in `gen_champion.py`, with nothing random and nothing time-based, and no pose
puts a model above 1.90 m or any vertex below the floor (by more than 0.1 mm)
at a key. In `Run` the contact keys (0, 10, 20) drop `Hips` so the feet plant,
and the passing keys leave it at rest. Between keys the top holds, but the
floor dips by up to 0.04 m (0.0365 m in `Run`, 0.0343 m in `Death`), because
the client's interpolation slerps the leg turn while it lerps the `Hips` drop.
The animation work in batch 10 may rework the poses to remove that. The
validator checks the names, the key counts and the length. The contract tests
read the shared key times from the BIN and compare them with the Keys column,
check the posed top and floor at every key, and sample 20 steps in each key
interval (slerp for rotations, lerp for translations) against a floor of
-0.04 m and the same top.

| Clip | Frames | Seconds | Keys | Channels | Plays |
|------|--------|---------|------|----------|-------|
| `Idle` | 60 | 2.000 | 0, 30, 60 | `Spine, Arm_L, Arm_R, Hips translation` | loops |
| `Run` | 20 | 0.667 | 0, 3, 5, 7, 10, 13, 15, 17, 20 | `Spine, Arm_L, Arm_R, Leg_L, Leg_R, Hips translation` | loops |
| `Attack` | 12 | 0.400 | 0, 2, 4, 12 | `Spine, Arm_L, Arm_R` | once, from rest back to rest |
| `Cast` | 15 | 0.500 | 0, 5, 9, 15 | `Spine, Arm_L, Arm_R` | once, from rest back to rest |
| `Hit` | 9 | 0.300 | 0, 2, 9 | `Spine, Arm_L, Arm_R` | once, from rest back to rest |
| `Death` | 30 | 1.000 | 0, 10, 20, 30 | `Hips, Hips translation, Spine, Arm_L, Arm_R` | once, holds the last frame |

`Run` is the movement clip. `Attack` and `Hit` are not built yet.

### Export

The exporter writes the keys as authored, not sampled at every frame, which
keeps each file near 46 KB at most. Every skin and animation flag of the
exporter that bears on the output is set by name in
`blender_common.export_glb(out, rigged=True)`, so a changed default in a later
Blender cannot move the bytes unseen. That includes
`export_optimize_animation_size`, which is off so the exporter never drops a
key it takes for a duplicate, and the other animation flags at their 5.2
defaults (frame step, the sampling fallback, negative frames, NLA, merge and
pointer options). Pinning them left the bytes unchanged. Arenas call it with
`rigged=False` and keep exactly the flags they had.

Blender's exporter falls back to baking a channel when its components differ
in key count, key times or interpolation, or when a bone has a constraint. The
key scheme avoids all of these, and the validator's key-count and LINEAR checks
catch a fallback. Blender 5 removed `action.fcurves`, and Python's
`keyframe_insert` ignores the new-keyframe interpolation preference (the factory
default is BEZIER, which exports as CUBICSPLINE), so `key_clip` sets each key
to LINEAR itself.

### Regenerating

Only Blender 5.2.1 LTS may regenerate the committed models (`Blender --version`
must print it). Regenerate each model into a scratch directory twice and `cmp`
both runs against the committed file. `test_export_determinism.py` does this
four times per model. Regenerate the arenas in place: `git status` must stay
clean for them. Every champion file must stay under 48 KiB, and the budget does
not move to make a model fit.

## Validator

`validate_glb.py` checks structure and content. Every glb fails if it has
`textures` or `images`, which enforces flat colours. An arena also fails if it
has `animations` or `skins`.

- The parent folder decides the rules. `arenas/<id>.glb` is checked against
  `data/arenas/<id>.json`. `champions/*.glb` needs the rig and the clips above:
  - the `Champion` node has a mesh and a skin, and there is exactly one skin
  - the joint names are exactly the six, once each, and every joint's parent
    matches the rig table (`Hips` hangs from the node `Rig`)
  - `inverseBindMatrices` is a FLOAT MAT4 accessor with one entry per joint
  - every `Champion` primitive has `JOINTS_0` and `WEIGHTS_0`
  - the animations are exactly the four clip names
  - channels target the joints only, with the path rotation or translation;
    every joint has a rotation channel and `Hips` has a translation channel
  - every sampler of a clip shares one input accessor, so every channel has
    the same key times
  - every sampler is LINEAR, and the input accessor has the clip's key count,
    a minimum of 0 and a maximum of frames / 30 within 1e-4
- The two tables above and the validator's `RIG` and `CLIPS` constants are
  checked against each other by a unit test, so they cannot drift.
- For an arena, each `Obstacle_i` translation must be `(x_i, 0, -y_i)` within
  1e-4, so the model cannot drift from the collision data.
- The validator also checks the arena JSON itself. It must match the shape in
  spec 8.1 key for key, with positive sizes, 2 to 3 spawns per team, obstacles
  and spawns inside the playable rectangle, no spawn touching an obstacle,
  `startRadius > endRadius > 0`, and exact mirror symmetry across `x = 0`.
- It exits 1 if any file fails, and also if it finds no glb at all.

## Arena definition

File: `data/arenas/<id>.json`. The sim reads it for collision and the Blender
scripts read it for visuals.

```json
{
  "id": "arena01",
  "name": "Arena 1",
  "size": { "width": 30, "height": 20 },
  "spawns": {
    "teamA": [[-12, 2], [-12, -2], [-12, 0]],
    "teamB": [[12, 2], [12, -2], [12, 0]]
  },
  "obstacles": [
    { "type": "circle", "x": 0, "y": 0, "r": 1.5, "height": 2.0, "blocksProjectiles": true },
    { "type": "rect", "x": -6, "y": 5, "w": 3, "h": 1, "height": 0.6, "blocksProjectiles": false }
  ],
  "ring": { "startRadius": 18, "endRadius": 3, "damagePerSecond": 10 }
}
```

- `size` is the playable rectangle centred on the origin, in meters.
- `spawns` lists up to three points per team; a 2v2 uses the first two.
- Every obstacle blocks movement. `blocksProjectiles` also blocks line of sight.
- `height` is visual only.
- Arena 1 is left-right symmetric (mirror across `x = 0`). The validator
  requires this of every arena, as the [arena principles](../design/arenas.md)
  extend it.

See [simulation](simulation.md) for how the sim uses obstacles, spawns and the
ring.
