# Asset pipeline

`tools/blender`. Source: spec sections 8 and 8.1.

## Blender scripts

- Blender runs locally in background mode: `tools/blender/run.sh <script.py> -- <args>`
  locates Blender at `$BLENDER` or `/Applications/Blender.app/Contents/MacOS/Blender`.
- `gen_arena.py --arena data/arenas/<id>.json --out assets/models/arenas/<id>.glb`
  builds floor, boundary walls and every obstacle from the arena definition.
- `gen_champion.py --champion <id> --out assets/models/champions/<id>.glb`
  builds a low-poly placeholder humanoid. Rigs and animation clips (`Idle`,
  `Run`, `Attack`, `Cast`, `Hit`, `Death`) are added in milestone 5.
- `validate_glb.py` uses only the Python standard library: checks the glb
  magic and chunk layout, and that required node names are present. It also
  checks the arena JSON that an arena model is built from (see
  [Validator](#validator)). CI runs it on committed assets so Blender itself is
  never needed in CI.
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

### Champion model

- The node name is `Champion`. The validator requires it in every file under
  `champions/`.
- The champion faces +X in both Blender and glTF. The client sets
  `rotation.y = aimAngle` directly, so the front must stay on +X.
- The origin is at the feet. The footprint stays inside a 0.5 m radius and the
  model is about 1.7 m tall.
- Flat colours only, no rig and no animation until milestone 5.

## Validator

`validate_glb.py` checks structure and content. It fails on any glb that has
`animations`, `skins`, `textures` or `images`, which enforces flat colours and
no rigs until milestone 5.

- The parent folder decides the rules. `arenas/<id>.glb` is checked against
  `data/arenas/<id>.json`, and `champions/*.glb` needs a `Champion` node.
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
