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
  magic and chunk layout, and that required node names are present. CI runs it
  on committed assets so Blender itself is never needed in CI.
- Generated `.glb` files are committed. Regenerating is a local step.

## Node naming

Arena nodes: `Floor`, `Wall_N`, `Wall_S`, `Wall_E`, `Wall_W`,
`Obstacle_<index>` matching the obstacle's index in the JSON.

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
- Arena 1 is left-right symmetric (mirror across `x = 0`).

See [simulation](simulation.md) for how the sim uses obstacles, spawns and the
ring.
