# Blender asset pipeline

Scripts that build the arena and champion models and check them. The committed
`.glb` files in `assets/models` were generated with Blender 5.2.1 LTS. Exports
are byte-identical across runs on that version, so regenerating must leave
`git status` clean. `test_export_determinism.py` checks this by building each
model four times in Blender and comparing the bytes to the committed file. It
skips when Blender is missing.

## Commands

Run these from the repo root. Each must exit 0.

```
tools/blender/run.sh tools/blender/gen_arena.py -- --arena data/arenas/arena01.json --out assets/models/arenas/arena01.glb
tools/blender/run.sh tools/blender/gen_arena.py -- --arena data/arenas/arena02.json --out assets/models/arenas/arena02.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion placeholder --out assets/models/champions/placeholder.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion hargrim --out assets/models/champions/hargrim.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion quillon --out assets/models/champions/quillon.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion lumeth --out assets/models/champions/lumeth.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion skerrow --out assets/models/champions/skerrow.glb
python3 tools/blender/validate_glb.py assets/models
python3 -B -m unittest discover -s tools/blender -p 'test_*.py'
```

The generators need Blender. The last two commands need only Python 3.9 or
newer and no packages, so they can run in CI.

## Files

| File | Purpose |
|------|---------|
| `run.sh` | Runs a script in Blender background mode |
| `gen_arena.py` | Builds an arena glb from `data/arenas/<id>.json`, for `arena01` and `arena02` |
| `gen_champion.py` | Builds the placeholder or one of the four roster champion glbs: the body, the six-bone rig and the six clips from constant pose tables, each keying only the channels it moves |
| `blender_common.py` | Scene clearing, materials, the armature and clip helpers and export, shared by the generators |
| `test_export_determinism.py` | Regenerates each model, both arenas included, four times and compares it to the committed glb. Needs Blender, skips without it. Two tests, without Blender, check that every committed champion glb and the arena glbs, arena definitions and cases are the same set |
| `test_arena_principles.py` | Checks every `data/arenas/*.json` against `docs/design/arenas.md`, sections 3 to 7: spawns, heights, cover, gaps, reach and the end circle. It pins arena01's two grandfathered deviations. Standard library only, no Blender |
| `test_champion_models.py` | Contract test for the committed `champions/*.glb`: node layout, bind pose, rigid weights, feet, facing, height at rest and at every clip key, footprint, budgets and colour rules. Standard library only, no Blender |
| `validate_glb.py` | Checks glb structure, node names, a champion's rig and clips and the arena JSON. Standard library only |
| `test_validate_glb.py` | Unit tests for the validator, one rejection per rig and clip rule against a synthetic rigged document, and a drift test between the two tables in `assets.md` and the validator's constants. The committed-model tests need `assets/models` to exist |

## Runner

`run.sh` finds Blender at `$BLENDER`, or at
`/Applications/Blender.app/Contents/MacOS/Blender`. It prints a message and
exits non-zero if that file is not executable.

It runs `blender --background --factory-startup --python-exit-code 1 --python <script> -- <args>`.
`--python-exit-code 1` matters: without it a script that raises still exits 0.
`--factory-startup` keeps user preferences out of the output. Always keep the
`--` before the script arguments, so Blender does not read them.

## Contracts

These go beyond the design spec (sections 8 and 8.1). They are what the client
and the sim can rely on.

### Coordinates

Blender XY is sim XY, and Z is up. The exporter writes Blender `(x, y, z)` as
glTF `(x, z, -y)`, which is the client mapping from spec section 4.1,
`(x, 0, -y)` on the ground. The scripts do no axis conversion.

Obstacles and the champion have their origin at their base: location
`(x, y, 0)` and geometry from local z = 0 up to the height. The floor and
walls keep their origin at the arena centre.

Watch the names in the arena schema. A rect's `h` is its extent along Y, and
`height` is its extent along Z. `size.height` (20) is the extent along Y too,
not vertical.

### Arena

- `Floor` covers exactly `size.width` by `size.height`, 0.2 m thick, with its
  top at z = 0.
- The walls are 0.5 m thick and 1.0 m high. They sit outside the playable
  area, with their inner faces on x = +-15 and y = +-10 for both arenas.
- `Wall_N` is at +y and `Wall_E` is at +x. `Wall_N` and `Wall_S` are longer by
  two wall thicknesses (31 m for both arenas) so the corners close.
- Node names are exactly `Floor`, `Wall_N`, `Wall_S`, `Wall_E`, `Wall_W` and
  `Obstacle_0` to `Obstacle_<n-1>`, matching the obstacle order in the JSON.
- Four flat materials: floor, wall, blocking obstacle (brown) and
  non-blocking obstacle (blue), so a viewer can see which obstacles stop
  projectiles.
- The visuals come from the same JSON as the collision. The validator checks
  that each `Obstacle_i` translation is `(x_i, 0, -y_i)` within 1e-4, and a
  missing translation counts as zero. A translation that is present must be
  three finite numbers.

### Champion

- `--champion <id>` writes `assets/models/champions/<id>.glb`. The ids are
  `placeholder`, the generic model, and the four roster ids below.
- One mesh node named `Champion`, built in one bmesh with a material per part.
  The head sphere and the halo ring are built from explicit vertices and
  faces, because `bmesh.ops.create_uvsphere` changes its face vertex order
  between runs and would make the export differ each time.
- Origin at the feet, footprint inside a 0.5 m radius, about 1.7 m tall.
- It faces +X in both Blender and glTF, so the client can set
  `rotation.y = aimAngle` directly. An accent-coloured visor and chest plate
  mark the front.
- Body and accent are flat colours.
- All five files share the node layout, the origin, the facing, the body
  geometry, the rig, the clips and the accent. A roster champion differs only
  in the body colour and one cue mesh, which is in the body colour so the
  accent still marks only the front.
- The scene lists `Rig`, whose children are the joint `Hips` and the skinned
  mesh `Champion`. The rest pose is the static geometry, so the bind pose
  equals it and a model with no clip playing looks as it did unrigged. Every
  part is rigid, with weight 1.0 on one of the six bones.
- The bones (`Hips`, `Spine`, `Arm_L`, `Arm_R`, `Leg_L`, `Leg_R`) and the clips
  (`Idle`, `Run`, `Attack`, `Cast`, `Hit`, `Death`, at 30 fps, LINEAR keys, each
  on only the channels it moves) are the two tables in
  `docs/architecture/assets.md`, which the validator's constants must match.
  The pose values are constant tables in `gen_champion.py`, and `key_clip`
  asserts that a channel a clip does not key is at rest at every key.
- The export writes the keys as authored, and only the channels each clip
  keys, so each file stays at most 46 KB. `export_glb(out, rigged=True)` sets
  by name every skin and animation flag of the exporter that bears on the
  output. That includes `export_optimize_animation_size` (off, so no key is
  dropped as a duplicate) and the other animation flags at their 5.2 defaults.
  Arenas keep their flags. Python's `keyframe_insert` ignores the interpolation
  preference, so `key_clip` sets each key to LINEAR.
- The top of every model is at most 1.90 m, because the health bar starts
  above 1.97 m, and the ground radius is at most 0.50 m. Each file is at most
  48 KiB and 600 triangles.

| id | archetype | body colour (linear) | about | cue |
|----|-----------|----------------------|-------|-----|
| `placeholder` | generic | (0.20, 0.35, 0.60) | `#7ca0cb` | none |
| `hargrim` | bruiser | (0.38, 0.03, 0.02) | `#a63027` | two shoulder blocks, top at 1.53 m |
| `quillon` | ranged | (0.00, 0.30, 0.25) | `#009589` | staff in the right hand, top at 1.85 m |
| `lumeth` | healer | (0.30, 0.58, 0.02) | `#95c827` | halo ring above the head, top at 1.815 m |
| `skerrow` | assassin | (0.03, 0.03, 0.03) | `#303030` | short blade forward from the right hand |

The accent is (0.95, 0.65, 0.10) in every file. The colours obey two rules,
checked by `test_champion_models.py`. No body has a blue channel more than 45
above its green channel in 8-bit sRGB, so nothing reads as the magenta debug
overlay. Each roster body is at least 80 away, as an RGB distance, from the
other roster bodies, the placeholder body, the accent, the arena floor and
the colours the client draws near a champion (bars, projectiles, impact ring,
hit flash, dead grey and the magenta debug overlay `#ff00ff`).

## Validator

`validate_glb.py <file-or-dir>...` prints `OK <path>` or `FAIL <path>: <reason>`
per file. It exits 1 if any file fails, and also if it finds no glb at all, so
an empty folder cannot pass. An unexpected error while checking a file is
reported as that file's FAIL line, and the remaining files still run.

- Structure: magic `glTF`, version 2, header length equal to the file size
  (this catches every truncation), a JSON chunk first, an optional BIN chunk,
  chunk lengths that are multiples of 4, and `asset.version` 2.0. `nodes` is
  a list of objects, and a node's `name`, if present, is a string.
- The parent folder decides the rules. `arenas/<id>.glb` is checked against
  `data/arenas/<id>.json`, and `champions/*.glb` needs a `Champion` node. Any
  other folder fails.
- Every file fails if it has `textures` or `images`, which enforces flat
  colours. An arena also fails if it has `animations` or `skins`.
- A champion needs the rig and the clips: a `Champion` node with a mesh and a
  skin and exactly one skin; the six joint names once each with the parents of
  the rig table, `Hips` under `Rig`; `inverseBindMatrices` as a FLOAT MAT4
  accessor with one entry per joint; `JOINTS_0` and `WEIGHTS_0` on every
  primitive; exactly the six clip names; channels on joints only, with only
  `Hips` translating and each clip's channels exactly the set of the Clips
  table, once each (a missing, an extra or a duplicate channel fails); and
  LINEAR samplers that share one input with the table's key count, a minimum of
  0 and a maximum of frames / 30 within 1e-4, each with a FLOAT output of one
  element per key (VEC4 for a rotation channel, VEC3 for a translation). A key
  moved to another frame makes the exporter write a second input, and a dropped
  key makes it bake the channel, so both fail. `test_champion_models.py` also
  reads the shared input times from the BIN chunk and compares them with the
  frames of the Clips table divided by 30, within 1e-4, so moving a key for
  every channel at once fails too. It checks the top (at most 1.90 m) and the
  floor (no vertex below 0, with a tolerance of 0.1 mm) at every key of every
  clip, that `Idle` and `Run` end on the pose they start with (within 1e-6),
  and samples 20 steps in each key interval against the same floor and top. A
  mutation of Run key 1 that keeps every key above the floor but sinks the foot
  between two keys is caught by the sampled floor only.
- The arena JSON must match spec 8.1 key for key, with positive sizes, 2 to 3
  spawns per team, obstacles and spawns (a 0.5 m circle) inside the playable
  rectangle, no spawn touching an obstacle, `startRadius > endRadius > 0`, and
  exact mirror symmetry across x = 0.
