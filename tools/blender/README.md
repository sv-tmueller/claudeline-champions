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
tools/blender/run.sh tools/blender/gen_arena.py -- --arena data/arenas/arena03.json --out assets/models/arenas/arena03.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion placeholder --out assets/models/champions/placeholder.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion hargrim --out assets/models/champions/hargrim.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion quillon --out assets/models/champions/quillon.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion lumeth --out assets/models/champions/lumeth.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion skerrow --out assets/models/champions/skerrow.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion ondrel --out assets/models/champions/ondrel.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion brimwick --out assets/models/champions/brimwick.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion durnhal --out assets/models/champions/durnhal.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion wrenna --out assets/models/champions/wrenna.glb
tools/blender/run.sh tools/blender/gen_champion.py -- --champion ysmeer --out assets/models/champions/ysmeer.glb
tools/blender/run.sh tools/blender/preview.py -- --out /tmp/champions-preview
tools/blender/run.sh tools/blender/preview.py -- --champion durnhal --out /tmp/champions-preview
tools/blender/run.sh tools/blender/preview.py -- --arena arena01 --out /tmp/champions-preview
python3 tools/blender/validate_glb.py assets/models
python3 -B -m unittest discover -s tools/blender -p 'test_*.py'
```

The generators need Blender. The last two commands need only Python 3.9 or
newer and no packages, so they can run in CI. `preview.py` needs Blender too,
and its test skips without it.

### Preview renders

`preview.py` renders the committed glbs to PNGs in the directory `--out` names.
With no selection flag it previews every `assets/models/champions/*.glb` and
every `assets/models/arenas/*.glb`; the file stems are the ids, so a new
champion or arena needs no change. `--champion <id>` and `--arena <id>` render
one model and are mutually exclusive. `--out` is required and must not be under
`assets/`, so a render can never be committed: point it at a scratch directory
such as `/tmp/champions-preview`.

It renders the glb on disk, so regenerate a model first and preview after, and
it never builds geometry itself. The engine is Workbench with material colours
and no lights, so nothing about a render is an asset. The renders are for the
eye: not byte-deterministic, and no part of CI.

An arena gets two views, both 1280x720:

| View | What it is |
|------|------------|
| `<id>_top.png` | Mirror of the client camera: a 55 degree tilt, a 40 degree vertical field of view and a 1.06 margin over the arena corners, fit with the same formula as `fitCameraDistance` in `packages/client/src/camera.ts` (visually, not bit for bit) |
| `<id>_quarter.png` | A free three-quarter view from 35 degrees off the client's axis and 40 degrees up, framing the whole arena |

A champion gets `<id>_rest.png` at 720x720 in the bind pose, plus one strip per
clip at 360x360 per key, stitched left to right into `<id>_<clip>.png`, the
clip in lower case (`placeholder_run.png`). The strips follow the six clips of
the Clips table below (`Idle`, `Run`, `Attack`, `Cast`, `Hit`, `Death`), and
the keys come from the imported action's own fcurves, so a moved key is
followed rather than shadowed by a hardcoded list: 27 key renders plus the rest
render per champion. The camera is a three-quarter view framing the ~1.9 m
model, so a cue or a head piece is checked at the pose that moves it.

A full run is 76 PNGs: three arenas at two views each and ten champions at
seven files each.

## Files

| File | Purpose |
|------|---------|
| `run.sh` | Runs a script in Blender background mode |
| `gen_arena.py` | Builds an arena glb from `data/arenas/<id>.json`, for every arena. It also reads the orb table (`--orbs`, default `data/orbs.json`; a missing file is an empty table) and marks each arena's orb point |
| `gen_champion.py` | Builds the placeholder or one of the nine roster champion glbs: the body, the six-bone rig and the six clips from constant pose tables, each keying only the channels it moves |
| `blender_common.py` | Scene clearing, materials, the armature and clip helpers and export, shared by the generators. `add_box` takes an optional Euler XYZ in degrees about the box's centre, default identity |
| `preview.py` | Renders committed glbs to PNGs in a given `--out` for local eyeballing: two arena views, a champion rest view and one strip per clip keyed at every key. Needs Blender, never writes under `assets/`, and its renders are not deterministic and not in CI |
| `test_export_determinism.py` | Regenerates each model, every arena included, four times and compares it to the committed glb. Needs Blender, skips without it. Two tests, without Blender, check that every committed champion glb and the arena glbs, arena definitions and cases are the same set |
| `test_preview.py` | Renders the placeholder through `preview.py` into a temporary directory and checks the rest PNG and one strip per clip exist and are non-empty. Needs Blender, skips without it |
| `test_arena_principles.py` | Checks every `data/arenas/*.json` against `docs/design/arenas.md`, sections 3 to 7: spawns, heights, cover, gaps, reach and the end circle. It pins arena01's two grandfathered deviations. Standard library only, no Blender |
| `test_arena_models.py` | Contract test for the committed `arenas/*.glb` against `data/arenas/*.json` and `data/orbs.json`: the five materials, the floor field and trim border, one trim disc per spawn, the floor inlays (the end circle, the centre line and the orb mark), the four per-kind obstacle profiles and the wall caps. Standard library only, no Blender |
| `test_champion_models.py` | Contract test for the committed `champions/*.glb`: node layout, bind pose, rigid weights, feet, facing, height at rest and at every clip key, footprint, budgets, the cue and head-piece boxes of all nine roster ids (each head piece at most 1.85 m at rest and inside the 0.5 m radius) and colour rules. Standard library only, no Blender |
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
  slab top at z = 0. It is a floor-coloured field inside a 1 m trim border,
  a 3 by 3 grid of boxes sharing whole edges: x cuts at -15, -14, 14 and 15,
  y cuts at -10, -9, 9 and 10, the centre cell `floor` and the other eight
  `trim`.
- One trim disc marks each spawn, part of the `Floor` mesh and not a node:
  0.6 m in radius, 0.01 m above the slab top, wholly on the field.
- Three trim inlays share the `Floor` mesh: the end circle, an annulus 0.1 m
  wide centred on `ring.endRadius` with its top at 0.01 m; the centre line, a
  0.1 m band on x = 0 from wall to wall, its top at 0.008 m; and the orb mark,
  a 0.3 m disc at the point of `data/orbs.json` for the arena, its top at
  0.01 m. An arena with no row there gets no mark. The line's 0.008 m top sits
  under the other two, so their faces are never coplanar where they cross, and
  nothing is above 0.01 m, so the client's 0.03, 0.04 and 0.05 m overlays stay
  above. The generator asserts that the ring and the mark fit on the field and
  that the mark clears the ring's inner edge.
- The walls are 0.5 m thick and 1.0 m high. They sit outside the playable
  area, with their inner faces on x = +-15 and y = +-10 for every arena. Each
  is a `wall` box up to 0.9 m and a `trim` cap from 0.9 m to 1.0 m in the same
  mesh, with the long top edges of the cap chamfered by 0.05 m.
- `Wall_N` is at +y and `Wall_E` is at +x. `Wall_N` and `Wall_S` are longer by
  two wall thicknesses (31 m for every arena) so the corners close.
- Node names are exactly `Floor`, `Wall_N`, `Wall_S`, `Wall_E`, `Wall_W` and
  `Obstacle_0` to `Obstacle_<n-1>`, matching the obstacle order in the JSON.
- Five flat materials: floor, trim, wall, blocking obstacle (brown) and
  non-blocking obstacle (blue), so a viewer can see which obstacles stop
  projectiles. Each obstacle reads as a silhouette from the top-down camera,
  one profile per kind, all stacked convex bands from explicit vertices, so
  every vertex stays inside the footprint prism and nothing stands above
  `height`:
  - a blocking rect is a wall segment: a full-footprint base course to
    `BASE_COURSE = 0.15`, a body inset by `OBSTACLE_INSET = 0.1` to
    `height - TOP_COURSE`, and a cap back out to the full footprint;
  - a blocking circle is a column: a full-radius base ring to
    `BASE_RING_HEIGHT = 0.15`, a shaft at `r - OBSTACLE_INSET`, and a
    full-radius capital from `CAPITAL_HEIGHT = 0.15` below the top;
  - a non-blocking rect is a crate: a body to `height - GROOVE_DEPTH`, then
    slats reaching `height`, separated by `GROOVE_WIDTH = 0.06` gaps whose
    floors are `GROOVE_DEPTH = 0.05` below the top;
  - a non-blocking circle is a barrel: alternating hoop bands at `r`
    (`HOOP_HEIGHT = 0.06`) and body bands at `r - HOOP_INSET = 0.05`.

  The footprint, height and origin are unchanged. `arena03` ships two
  non-blocking circles, the barrels at (5, 0) and (-5, 0), so the barrel is
  live in committed data; the dispatch is keyed by
  `(type, blocksProjectiles)` and needed no edit.
- The discs, the inlays and the caps are geometry inside the existing meshes,
  so the node set and the validator are unchanged. `test_arena_models.py`
  checks them from the vertex data.
- The visuals come from the same JSON as the collision. The validator checks
  that each `Obstacle_i` translation is `(x_i, 0, -y_i)` within 1e-4, and a
  missing translation counts as zero. A translation that is present must be
  three finite numbers.

### Champion

- `--champion <id>` writes `assets/models/champions/<id>.glb`. The ids are
  `placeholder`, the generic model, and the nine roster ids below.
- One mesh node named `Champion`, built in one bmesh with a material per part.
  The head sphere and the halo ring are built from explicit vertices and
  faces, because `bmesh.ops.create_uvsphere` changes its face vertex order
  between runs and would make the export differ each time.
- Origin at the feet, footprint inside a 0.5 m radius, about 1.7 m tall.
- It faces +X in both Blender and glTF, so the client can set
  `rotation.y = aimAngle` directly. An accent-coloured visor and chest plate
  mark the front.
- Body and accent are flat colours.
- All ten files share the node layout, the origin, the facing, the body
  geometry, the rig, the clips and the accent. A roster champion differs only
  in the body colour, one cue and one head piece, both in the body colour so
  the accent still marks only the front. A cue can be several boxes: one on
  Spine for Ondrel and Brimwick, two on Spine for Hargrim, and three on the two
  arms for Durnhal, three on `Arm_L` for Wrenna plus her quiver on Spine, and
  two on Spine for Ysmeer. A head piece is one to three boxes on Spine, so the `Attack` yaw and the `Hit`
  lean carry it. Brimwick's fuse cap is his cue and his head piece at once.
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
  keys, so each file stays under 47 KiB (the largest, Lumeth's, is 46.8 KiB).
  `export_glb(out, rigged=True)` sets
  by name every skin and animation flag of the exporter that bears on the
  output. That includes `export_optimize_animation_size` (off, so no key is
  dropped as a duplicate) and the other animation flags at their 5.2 defaults.
  Arenas keep their flags. Python's `keyframe_insert` ignores the interpolation
  preference, so `key_clip` sets each key to LINEAR.
- The top of every model is at most 1.90 m, because the health bar starts
  above 1.97 m, and the ground radius is at most 0.50 m. Each file is at most
  48 KiB and 600 triangles.
- A head piece tops out at 1.85 m at rest, not 1.90 m: the `Run` clip lifts
  `Hips` 0.035 m, so a 1.85 m rest top is 1.885 m posed, under the 1.90 m clip
  limit with room for the `Hit` lean. The 1.85 m bound is per head-piece box
  and not a whole-model rule: Quillon's staff already reaches exactly 1.85 m at
  rest and the whole-model checks stay at 1.90 m. No head piece hides the
  accent visor (z 1.55 to 1.61 m, x from 0.11 m): each sits at or above about
  1.62 m or behind x = 0.

| id | archetype | body colour (linear) | about | cue | head piece |
|----|-----------|----------------------|-------|-----|------------|
| `placeholder` | generic | (0.20, 0.35, 0.60) | `#7ca0cb` | none | none |
| `hargrim` | bruiser | (0.38, 0.03, 0.02) | `#a63027` | two shoulder blocks, top at 1.53 m | flat-topped helm with cheek guards, top at 1.80 m |
| `quillon` | ranged | (0.00, 0.30, 0.25) | `#009589` | staff in the right hand, top at 1.85 m | wide-brimmed hat, top at 1.78 m |
| `lumeth` | healer | (0.30, 0.58, 0.02) | `#95c827` | halo ring above the head, top at 1.815 m | cowl under the halo, top at 1.74 m |
| `skerrow` | assassin | (0.03, 0.03, 0.03) | `#303030` | short blade forward from the right hand | hood with a back peak, top at 1.84 m |
| `ondrel` | zone controller | (0.03, 0.30, 0.03) | `#309530` | reed bundle on the back, top at 1.82 m | conical reed hat, top at 1.82 m |
| `brimwick` | burst caster | (0.74, 0.12, 0.00) | `#df6100` | fuse cap on top of the head, top at 1.82 m | the same fuse cap, top at 1.82 m |
| `durnhal` | guardian tank | (0.19, 0.18, 0.00) | `#797600` | box shield on the left arm and a hammer in the right hand, top at 1.34 m | visored helm with a nose ridge, top at 1.82 m |
| `wrenna` | bow archer | (0.445, 0.093, 0.175) | `#b25674` | bow in the left hand and a quiver on the back, top at 1.52 m | archer's cap with a swept-back feather, top at 1.81 m |
| `ysmeer` | star mage | (0.000, 0.060, 0.165) | `#004571` | two star motes by the torso, top at 1.80 m | star crown of three flat bars, top at 1.71 m |

The accent is (0.95, 0.65, 0.10) in every file. The colours obey two rules,
checked by `test_champion_models.py`. No body has a blue channel more than 45
above its green channel in 8-bit sRGB, so nothing reads as the magenta debug
overlay. Each roster body is at least 80 away, as an RGB distance, from the
other roster bodies, the placeholder body, the accent, the floor and the trim
of every arena and the colours the client draws near a champion (bars,
projectiles, impact ring, hit flash, dead grey and the magenta debug overlay
`#ff00ff`).

The arena floor (0.30, 0.32, 0.36), about `#9599a2`, and trim
(0.50, 0.45, 0.30), about `#bcb395`, follow a surface rule in the same test.
Each is at least 80 from the eight client colours of the body rule and from
the accent, and no arena material has a blue channel more than 45 above its
green. The trim is also at least 80 from the placeholder body. The floor is
not held to it (48.5 away, as before). The trim is 48.6 from the floor on
purpose, so the floor reads as one two-tone surface, and nothing compares the
two.

Ondrel keeps the colour decision 2 of batch #134 reserved for it. Brimwick's
reserved colour, (0.72, 0.19, 0.00), about `#dd7900`, is superseded by decision
1 of batch #147. It was 64.7 from the HUD's energy colour `#ffb000`, and the
client's `hud-palette.test.ts` holds every body 80 from the colours of the HUD,
the result panel and the menu, so one of the two had to move. The body moved,
24.1 from the reserved value, and the HUD stayed. Its nearest colours are
Hargrim at 84.7, the HUD energy colour at 85.2 and the enemy bar at 87.5. The
nearest to Ondrel are the dead grey at 93.1 and Skerrow at 101.0. Wrenna's
colour decision is the third in this list: it holds the natural wren colours
aside and gives her the plum, both below.

Durnhal's olive brass, (0.19, 0.18, 0.00), is decision 2 of batch #203. Its
nearest colours are Hargrim at 91.9, Ondrel at 92.7, Lumeth at 95.0, Brimwick
at 104.1, Skerrow at 112.0 and the dead grey at 118.3. The floor is 168.1 away,
and the other client and trim colours 160.9 or more, the HUD colours 146.0 or
more (the energy colour `#ffb000` is the nearest). The shield is a plate
0.30 by 0.04 by 0.60 m, 1 cm off `Arm_L` and below the shoulder. The hammer
hangs from `Arm_R`: a haft 0.05 by 0.05 by 0.40 m and a head 0.22 by 0.14 by
0.14 m, 7 cm outside the arm so it shows from above. The head is 0.22 m long
and the hammer sits at y = -0.41 for two reasons: at 0.28 m the head sinks
3.3 mm under the floor at Death key 30, and at y = -0.34 the head's y span
equals the arm's, so from above it adds only 4 cm strips in front of and
behind the arm. The model has 600 vertices and 288 triangles, a ground radius of
0.4924 m and 39 780 bytes.

Wrenna's plum, (0.445, 0.093, 0.175), about `#b25674`, is the lead's decision
for her model (issue #235). Three decimal places are needed: two give `#b35573`,
not `#b25674`. In 8-bit sRGB b minus g is 30, so the overlay rule holds
(`overlay None`). Its nearest colours are the enemy bar and the menu error at
85.9, the floor of every arena at 86.3, Hargrim at 86.7, the dead grey at 88.7,
the enemy projectile at 96.0, the trim of every arena at 99.2, Brimwick at 124.9
and the placeholder at 126.3; every pair is at least 85.9, so no existing margin
moves. Three natural wren colours were measured and set aside. Hunter green
(0.0, 0.125, 0.0), about `#006300`, is 84.3 from Ondrel, under the rule. Deep
navy (0.0, 0.06, 0.168), about `#004572`, is 83.2 from Quillon. The magenta-rose
`#b14e7b` is 89.1 from the floor but exactly on the b - g = 45 cap. The natural
wren hue itself cannot pass either: every muted brown and leather tried tops out
at 76.6 (against Brimwick), under the 80 rule, and the paler tans that clear the
rest sit inside 80 of her own plum. Her cue is a bow of three boxes on `Arm_L`
at y = 0.45: a grip 0.05 by 0.05 by 0.34 m and two limbs 0.30 and 0.24 m long,
angled 30 degrees off it, plus one quiver 0.08 by 0.10 by 0.44 m on `Spine` at
(-0.10, 0, 1.30). The quiver's x offset must stay small: at -0.16 m, on the back
of the body as it lies at Death key 30, it sinks 7.3 mm under the floor (near
-0.17 m it sinks 17.2 mm). The model has 624 vertices and 300 triangles, a
ground radius of 0.4847 m and 40 924 bytes.

Ysmeer's night blue, (0.000, 0.060, 0.165), about `#004571`, is the lead's
decision for her model (issue #273, accepted in batch #279). In 8-bit sRGB b
minus g is 44, one under the overlay cap of 45, so the overlay rule holds
(`overlay None`). Its nearest colours are Skerrow and Quillon at 83.5, the dead
grey at 94.0, Ondrel at 113.7, the HUD, result, menu and select panels at 132.4
and the energy orb at 149.7; every pair is at least 80, and the model is the
second-tightest roster pair after Skerrow against the black panels (83.1), so
no existing margin moves. Violet and indigo break the b - g rule. Gold, silver
and white sit within 80 of the accent, the impact ring, the HUD energy colour,
the hit flash or the trim. Two on-theme colours were set aside: aqua
`#00fed6` is nearest the ally bar and the ally projectile, so an enemy Ysmeer
would read as ally-coloured, and pale star yellow `#ffffa0` is nearest the
accent, so the visor would stop marking the front. Her head piece is a star
crown of three flat bars, each 0.44 by 0.08 by 0.04 m, on `Spine` at
(0, 0, 1.69) and turned 0, +60 and -60 degrees about Z: a six-point star with
one point straight over the visor, from 1.67 to 1.71 m (so the visor rule
holds) inside a radius of 0.2236 m. Her cue is two star motes, 0.12 m cubes
turned 45 degrees about Z so they show as diamonds from the camera, on `Spine`
at (0.08, 0.34, 1.74) and (-0.08, -0.34, 1.62). The bar length is the number
the floor bounds: at Death key 30 the crown's back point is 16.7 mm above the
floor, and a 0.48 m bar would sink 3.3 mm. The motes stay at least 62 mm up in
every shared clip. Over the six clips the posed tops are 1.8096 (Idle), 1.8222
(Run), 1.8000 (Attack), 1.8093 (Cast), 1.8150 (Hit) and 1.8281 m (Death), and
the rest top is 1.8000 m. The model has 648 vertices and 312 triangles, a ground
radius of 0.4323 m and [C3: the glb's byte count, once `ysmeer.glb` is
committed] bytes, about 42.0 KB by estimate.

That client test keeps its own `BODY_COLOURS` table with the bodies above, so
change both in the same commit.

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
