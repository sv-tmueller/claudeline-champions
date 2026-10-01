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
tools/blender/run.sh tools/blender/gen_champion.py -- --champion placeholder --out assets/models/champions/placeholder.glb
python3 tools/blender/validate_glb.py assets/models
python3 -B -m unittest discover -s tools/blender -p 'test_*.py'
```

The first two need Blender. The last two need only Python 3.9 or newer and no
packages, so they can run in CI.

## Files

| File | Purpose |
|------|---------|
| `run.sh` | Runs a script in Blender background mode |
| `gen_arena.py` | Builds an arena glb from `data/arenas/<id>.json` |
| `gen_champion.py` | Builds a placeholder champion glb |
| `blender_common.py` | Scene clearing, materials and export, shared by the generators |
| `test_export_determinism.py` | Regenerates each model four times and compares it to the committed glb. Needs Blender, skips without it |
| `validate_glb.py` | Checks glb structure, node names and the arena JSON. Standard library only |
| `test_validate_glb.py` | Unit tests for the validator. The tests that read the committed models need `assets/models` to exist |

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
  area, with their inner faces on x = +-15 and y = +-10 for arena 1.
- `Wall_N` is at +y and `Wall_E` is at +x. `Wall_N` and `Wall_S` are longer by
  two wall thicknesses (31 m for arena 1) so the corners close.
- Node names are exactly `Floor`, `Wall_N`, `Wall_S`, `Wall_E`, `Wall_W` and
  `Obstacle_0` to `Obstacle_<n-1>`, matching the obstacle order in the JSON.
- Four flat materials: floor, wall, blocking obstacle (brown) and
  non-blocking obstacle (blue), so a viewer can see which obstacles stop
  projectiles.
- The visuals come from the same JSON as the collision. The validator checks
  that each `Obstacle_i` translation is `(x_i, 0, -y_i)` within 1e-4, and a
  missing translation counts as zero.

### Champion

- `--champion placeholder` writes `assets/models/champions/placeholder.glb`.
  Roster ids come later with the roster document.
- One mesh node named `Champion`, built in one bmesh with a material per part.
  The head sphere is built from explicit vertices and faces, because
  `bmesh.ops.create_uvsphere` changes its face vertex order between runs and
  would make the export differ each time.
- Origin at the feet, footprint inside a 0.5 m radius, about 1.7 m tall.
- It faces +X in both Blender and glTF, so the client can set
  `rotation.y = aimAngle` directly. An accent-coloured visor and chest plate
  mark the front.
- Body and accent are flat colours. No rig, no animation.

## Validator

`validate_glb.py <file-or-dir>...` prints `OK <path>` or `FAIL <path>: <reason>`
per file. It exits 1 if any file fails, and also if it finds no glb at all, so
an empty folder cannot pass.

- Structure: magic `glTF`, version 2, header length equal to the file size
  (this catches every truncation), a JSON chunk first, an optional BIN chunk,
  chunk lengths that are multiples of 4, and `asset.version` 2.0.
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
