#!/usr/bin/env python3
"""Validate committed glb models and arena definitions. Standard library only.

Usage: validate_glb.py <file-or-dir>...

Prints `OK <path>` or `FAIL <path>: <reason>` per file. Exits 1 if any file
fails, or if no glb file was found at all.
"""
import json
import math
import struct
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

# Flat colours and no rig until milestone 5.
FORBIDDEN_KEYS = ("animations", "skins", "textures", "images")

SPAWN_RADIUS = 0.5
TRANSLATION_TOLERANCE = 1e-4

OBSTACLE_KEYS = {
    "circle": {"type", "x", "y", "r", "height", "blocksProjectiles"},
    "rect": {"type", "x", "y", "w", "h", "height", "blocksProjectiles"},
}


# glb structure


def read_glb(data):
    """Return (document, None) or (None, reason)."""
    if len(data) < 12:
        return None, "file is too short for a glb header"
    magic, version, length = struct.unpack("<4sII", data[:12])
    if magic != b"glTF":
        return None, "bad magic, expected glTF"
    if version != 2:
        return None, "unsupported glb version %d, expected 2" % version
    if length != len(data):
        return None, "header length %d does not match file size %d" % (
            length,
            len(data),
        )

    chunks = []
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            return None, "truncated chunk header at byte %d" % offset
        chunk_length, chunk_type = struct.unpack("<II", data[offset : offset + 8])
        if chunk_length % 4 != 0:
            return None, "chunk length %d is not a multiple of 4" % chunk_length
        end = offset + 8 + chunk_length
        if end > len(data):
            return None, "chunk at byte %d runs past the end of the file" % offset
        chunks.append((chunk_type, data[offset + 8 : end]))
        offset = end

    if not chunks or chunks[0][0] != CHUNK_JSON:
        return None, "first chunk is not a JSON chunk"
    if len(chunks) > 2 or (len(chunks) == 2 and chunks[1][0] != CHUNK_BIN):
        return None, "unexpected chunk after the JSON chunk, only one BIN chunk is allowed"
    try:
        doc = json.loads(chunks[0][1].decode("utf-8"))
    except ValueError:
        return None, "JSON chunk is not valid JSON"
    if not isinstance(doc, dict):
        return None, "JSON chunk is not an object"
    asset = doc.get("asset")
    if not isinstance(asset, dict) or asset.get("version") != "2.0":
        return None, "asset.version must be 2.0"
    return doc, None


# arena definition


def is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def check_keys(obj, expected, where):
    if not isinstance(obj, dict):
        return "%s must be an object" % where
    missing = sorted(expected - set(obj))
    extra = sorted(set(obj) - expected)
    if missing:
        return "%s: missing keys %s" % (where, ", ".join(missing))
    if extra:
        return "%s: unexpected keys %s" % (where, ", ".join(extra))
    return None


def check_positive(obj, keys, where):
    for key in keys:
        value = obj[key]
        if not is_number(value):
            return "%s.%s must be a number" % (where, key)
        if not value > 0:
            return "%s.%s must be greater than 0" % (where, key)
    return None


def check_point(point, where):
    ok = (
        isinstance(point, list)
        and len(point) == 2
        and all(is_number(v) for v in point)
    )
    return None if ok else "%s must be a list of two numbers" % where


def obstacle_extent(ob):
    """Half extents (along x, along y) of the obstacle's bounding box."""
    if ob["type"] == "circle":
        return ob["r"], ob["r"]
    return ob["w"] / 2, ob["h"] / 2


def touches_obstacle(point, ob):
    px, py = point
    if ob["type"] == "circle":
        return math.hypot(px - ob["x"], py - ob["y"]) <= ob["r"] + SPAWN_RADIUS
    half_w, half_h = obstacle_extent(ob)
    dx = max(abs(px - ob["x"]) - half_w, 0)
    dy = max(abs(py - ob["y"]) - half_h, 0)
    return math.hypot(dx, dy) <= SPAWN_RADIUS


def mirror_key(ob, flip):
    sign = -1 if flip else 1
    dims = (ob["r"],) if ob["type"] == "circle" else (ob["w"], ob["h"])
    return (ob["type"], sign * ob["x"], ob["y"]) + dims + (
        ob["height"],
        ob["blocksProjectiles"],
    )


def validate_arena_json(arena, arena_id):
    """Return None if the definition follows spec 8.1, else a reason."""
    error = check_keys(
        arena, {"id", "name", "size", "spawns", "obstacles", "ring"}, "arena"
    )
    if error:
        return error
    if arena["id"] != arena_id:
        return "id %r does not match the file name %r" % (arena["id"], arena_id)
    if not isinstance(arena["name"], str) or not arena["name"]:
        return "name must be a non-empty string"

    error = check_keys(arena["size"], {"width", "height"}, "size")
    error = error or check_positive(arena["size"], ("width", "height"), "size")
    if error:
        return error
    half_w = arena["size"]["width"] / 2
    half_h = arena["size"]["height"] / 2

    spawns = arena["spawns"]
    error = check_keys(spawns, {"teamA", "teamB"}, "spawns")
    if error:
        return error
    for team in ("teamA", "teamB"):
        points = spawns[team]
        if not isinstance(points, list) or not 2 <= len(points) <= 3:
            return "spawns.%s must list 2 to 3 points" % team
        for i, point in enumerate(points):
            error = check_point(point, "spawns.%s[%d]" % (team, i))
            if error:
                return error

    obstacles = arena["obstacles"]
    if not isinstance(obstacles, list):
        return "obstacles must be a list"
    for i, ob in enumerate(obstacles):
        where = "obstacles[%d]" % i
        kind = ob.get("type") if isinstance(ob, dict) else None
        if kind not in OBSTACLE_KEYS:
            return "%s.type must be circle or rect" % where
        error = check_keys(ob, OBSTACLE_KEYS[kind], where)
        if error:
            return error
        for key in ("x", "y"):
            if not is_number(ob[key]):
                return "%s.%s must be a number" % (where, key)
        dims = ("r",) if kind == "circle" else ("w", "h")
        error = check_positive(ob, dims + ("height",), where)
        if error:
            return error
        if not isinstance(ob["blocksProjectiles"], bool):
            return "%s.blocksProjectiles must be a bool" % where

    ring = arena["ring"]
    error = check_keys(ring, {"startRadius", "endRadius", "damagePerSecond"}, "ring")
    error = error or check_positive(
        ring, ("startRadius", "endRadius", "damagePerSecond"), "ring"
    )
    if error:
        return error
    if not ring["startRadius"] > ring["endRadius"]:
        return "ring.startRadius must be greater than ring.endRadius"

    for i, ob in enumerate(obstacles):
        ext_x, ext_y = obstacle_extent(ob)
        if abs(ob["x"]) + ext_x > half_w or abs(ob["y"]) + ext_y > half_h:
            return "obstacles[%d] is out of bounds" % i
    for team in ("teamA", "teamB"):
        for i, (x, y) in enumerate(spawns[team]):
            where = "spawns.%s[%d]" % (team, i)
            if abs(x) + SPAWN_RADIUS > half_w or abs(y) + SPAWN_RADIUS > half_h:
                return "%s is out of bounds" % where
            for j, ob in enumerate(obstacles):
                if touches_obstacle((x, y), ob):
                    return "%s touches obstacles[%d]" % (where, j)

    mirrored = Counter(mirror_key(ob, True) for ob in obstacles)
    if mirrored != Counter(mirror_key(ob, False) for ob in obstacles):
        return "obstacles are not mirror-symmetric across x = 0"
    team_a, team_b = spawns["teamA"], spawns["teamB"]
    if len(team_a) != len(team_b) or any(
        b != [-a[0], a[1]] for a, b in zip(team_a, team_b)
    ):
        return "spawns are not mirror-symmetric across x = 0"
    return None


# per-category rules


def check_arena(path, doc):
    arena_id = path.stem
    json_path = REPO / "data" / "arenas" / (arena_id + ".json")
    if not json_path.is_file():
        return "no arena definition at data/arenas/%s.json" % arena_id
    try:
        with open(json_path) as f:
            arena = json.load(f)
    except ValueError:
        return "data/arenas/%s.json is not valid JSON" % arena_id
    error = validate_arena_json(arena, arena_id)
    if error:
        return "arena definition: " + error

    nodes = doc.get("nodes", [])
    names = [n.get("name") for n in nodes]
    duplicates = sorted({str(n) for n in names if names.count(n) > 1})
    if duplicates:
        return "duplicate node names: " + ", ".join(duplicates)
    expected = {"Floor", "Wall_N", "Wall_S", "Wall_E", "Wall_W"}
    expected |= {"Obstacle_%d" % i for i in range(len(arena["obstacles"]))}
    missing = sorted(expected - set(names))
    unexpected = sorted(str(n) for n in set(names) - expected)
    if missing or unexpected:
        parts = []
        if missing:
            parts.append("missing node names: " + ", ".join(missing))
        if unexpected:
            parts.append("unexpected node names: " + ", ".join(unexpected))
        return "; ".join(parts)

    # Sim (x, y) maps to glTF (x, 0, -y); see spec 4.1.
    by_name = {n["name"]: n for n in nodes}
    for i, ob in enumerate(arena["obstacles"]):
        node = by_name["Obstacle_%d" % i]
        if "matrix" in node:
            return "Obstacle_%d uses a matrix, expected a translation" % i
        translation = node.get("translation", [0, 0, 0])
        want = [ob["x"], 0, -ob["y"]]
        if len(translation) != 3 or any(
            abs(a - b) > TRANSLATION_TOLERANCE for a, b in zip(translation, want)
        ):
            return "Obstacle_%d translation %s does not match the JSON, expected %s" % (
                i,
                translation,
                want,
            )
    return None


def check_champion(path, doc):
    if "Champion" not in [n.get("name") for n in doc.get("nodes", [])]:
        return "no node named Champion"
    return None


CATEGORY_RULES = {"arenas": check_arena, "champions": check_champion}


def validate_file(path):
    """Return None if the file is valid, else a reason."""
    path = Path(path)
    try:
        data = path.read_bytes()
    except OSError as exc:
        return "cannot read file: %s" % exc.strerror
    doc, error = read_glb(data)
    if error:
        return error
    for key in FORBIDDEN_KEYS:
        if key in doc:
            return "%s are not allowed, models are flat-colour and unrigged" % key
    rule = CATEGORY_RULES.get(path.parent.name)
    if rule is None:
        return "unknown category folder %r, expected arenas or champions" % (
            path.parent.name
        )
    return rule(path, doc)


def main(argv):
    if not argv:
        print("usage: validate_glb.py <file-or-dir>...", file=sys.stderr)
        return 2
    files = []
    for arg in argv:
        path = Path(arg)
        if path.is_dir():
            files.extend(sorted(path.rglob("*.glb")))
        else:
            files.append(path)
    if not files:
        print("FAIL: no glb files found")
        return 1
    failed = False
    for path in files:
        error = validate_file(path)
        if error is None:
            print("OK %s" % path)
        else:
            failed = True
            print("FAIL %s: %s" % (path, error))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
