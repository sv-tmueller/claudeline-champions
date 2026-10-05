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
| `gen_champion.py` | Builds the placeholder or one of the four roster champion glbs |
| `blender_common.py` | Scene clearing, materials and export, shared by the generators |
| `test_export_determinism.py` | Regenerates each model, both arenas included, four times and compares it to the committed glb. Needs Blender, skips without it. Two tests, without Blender, check that every committed champion glb and the arena glbs, arena definitions and cases are the same set |
| `test_arena_principles.py` | Checks every `data/arenas/*.json` against `docs/design/arenas.md`, sections 3 to 7: spawns, heights, cover, gaps, reach and the end circle. It pins arena01's two grandfathered deviations. Standard library only, no Blender |
| `test_champion_models.py` | Contract test for the committed `champions/*.glb`: node layout, feet, facing, height, footprint, budgets and colour rules. Standard library only, no Blender |
| `validate_glb.py` | Checks glb structure, node names and the arena JSON. Standard library only |
| `test_validate_glb.py` | Unit tests for the validator, over both arenas where they read the committed models. Those tests need `assets/models` to exist |

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
- Body and accent are flat colours. No rig, no animation.
- All five files share the node layout, the origin, the facing, the body
  geometry and the accent. A roster champion differs only in the body colour
  and one cue mesh, which is in the body colour so the accent still marks
  only the front.
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
- Every file fails if it has `animations`, `skins`, `textures` or `images`.
  This enforces flat colours and no rigs. It gets relaxed for champions in
  milestone 5.
- The arena JSON must match spec 8.1 key for key, with positive sizes, 2 to 3
  spawns per team, obstacles and spawns (a 0.5 m circle) inside the playable
  rectangle, no spawn touching an obstacle, `startRadius > endRadius > 0`, and
  exact mirror symmetry across x = 0.
