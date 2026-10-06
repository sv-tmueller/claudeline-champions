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

# Flat colours everywhere. Arenas have no rig and no clips either, and a
# champion's rig and clips are checked by check_champion.
FORBIDDEN_KEYS = {
    "arenas": ("animations", "skins", "textures", "images"),
    "champions": ("textures", "images"),
}

# The champion rig and clips. docs/architecture/assets.md has the same two
# tables, and a unit test fails if they drift apart. RIG maps each joint to its
# parent in glTF order (Hips hangs from the node `Rig`). CLIPS maps each clip to
# (length in frames, key count). The frame rate is 30.
RIG = {
    "Hips": "Rig",
    "Spine": "Hips",
    "Arm_L": "Spine",
    "Arm_R": "Spine",
    "Leg_L": "Hips",
    "Leg_R": "Hips",
}
CLIPS = {"Idle": (60, 3), "Run": (20, 5), "Cast": (15, 4), "Death": (30, 4)}
FPS = 30
TIME_TOLERANCE = 1e-4

FLOAT = 5126  # glTF componentType of a 32-bit float

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


def is_finite_number(value):
    # Only floats can be NaN or infinite. math.isfinite on a huge int raises.
    # An int beyond the float range also overflows in the tolerance check, so
    # it is rejected here too.
    if not is_number(value):
        return False
    if isinstance(value, float):
        return math.isfinite(value)
    return abs(value) <= sys.float_info.max


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
    duplicates = sorted(str(n) for n, c in Counter(names).items() if c > 1)
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
        if not (
            isinstance(translation, list)
            and len(translation) == 3
            and all(is_finite_number(v) for v in translation)
        ):
            return "Obstacle_%d translation must be three finite numbers, got %r" % (
                i,
                translation,
            )
        want = [ob["x"], 0, -ob["y"]]
        if any(abs(a - b) > TRANSLATION_TOLERANCE for a, b in zip(translation, want)):
            return "Obstacle_%d translation %s does not match the JSON, expected %s" % (
                i,
                translation,
                want,
            )
    return None


def check_nodes(doc):
    """Return a reason if nodes is not a list of objects with string names."""
    nodes = doc.get("nodes", [])
    if not isinstance(nodes, list):
        return "nodes must be a list"
    for i, node in enumerate(nodes):
        if not isinstance(node, dict):
            return "nodes[%d] must be an object" % i
        if "name" in node and not isinstance(node["name"], str):
            return "nodes[%d].name must be a string" % i
    return None


def accessor_of(doc, index):
    """The accessor at `index`, or None when the index or the entry is bad."""
    accessors = doc.get("accessors")
    if not isinstance(accessors, list) or not isinstance(index, int) or isinstance(index, bool):
        return None
    if not 0 <= index < len(accessors) or not isinstance(accessors[index], dict):
        return None
    return accessors[index]


def check_skin(doc, nodes):
    """Return a reason if the Champion skin does not match the RIG table."""
    champion = next((n for n in nodes if n.get("name") == "Champion"), None)
    if champion is None:
        return "no node named Champion"
    if "mesh" not in champion:
        return "the Champion node has no mesh"
    if "skin" not in champion:
        return "the Champion node has no skin"
    skins = doc.get("skins")
    if not isinstance(skins, list) or len(skins) != 1 or not isinstance(skins[0], dict):
        return "expected exactly one skin"
    skin = skins[0]
    joints = skin.get("joints")
    if not isinstance(joints, list) or not all(
        isinstance(j, int) and not isinstance(j, bool) and 0 <= j < len(nodes) for j in joints
    ):
        return "the skin joints must be node indices"
    names = [nodes[j].get("name") for j in joints]
    if sorted(map(str, names)) != sorted(RIG):
        return "the skin joints must be exactly %s, found %s" % (
            ", ".join(RIG),
            ", ".join(str(n) for n in names),
        )

    # Keyed by node index: another node with a joint's name cannot hide its parent.
    parent_of = {}
    for index, node in enumerate(nodes):
        children = node.get("children", [])
        if not isinstance(children, list):
            return "a node's children must be a list"
        for child in children:
            if isinstance(child, int) and not isinstance(child, bool):
                parent_of[child] = index
    for joint_node in joints:
        joint = nodes[joint_node]["name"]
        parent = nodes[parent_of[joint_node]].get("name") if joint_node in parent_of else None
        if parent != RIG[joint]:
            return "joint %s must be a child of %s, found %s" % (joint, RIG[joint], parent)

    matrices = accessor_of(doc, skin.get("inverseBindMatrices"))
    if (
        matrices is None
        or matrices.get("componentType") != FLOAT
        or matrices.get("type") != "MAT4"
        or matrices.get("count") != len(RIG)
    ):
        return "the skin needs inverseBindMatrices as a FLOAT MAT4 accessor with %d entries" % (
            len(RIG)
        )

    meshes = doc.get("meshes")
    mesh = champion["mesh"]
    if not isinstance(meshes, list) or not isinstance(mesh, int) or not 0 <= mesh < len(meshes):
        return "the Champion mesh index is out of range"
    primitives = meshes[mesh].get("primitives") if isinstance(meshes[mesh], dict) else None
    if not isinstance(primitives, list) or not primitives:
        return "the Champion mesh has no primitives"
    for primitive in primitives:
        attributes = primitive.get("attributes") if isinstance(primitive, dict) else None
        if not isinstance(attributes, dict):
            return "a Champion primitive has no attributes"
        for attribute in ("JOINTS_0", "WEIGHTS_0"):
            if attribute not in attributes:
                return "a Champion primitive has no %s" % attribute
    return None


def check_clip(doc, nodes, joints, animation):
    """Return a reason if one animation breaks the CLIPS table or the rig."""
    name = animation.get("name")
    frames, keys = CLIPS[name]
    channels, samplers = animation.get("channels"), animation.get("samplers")
    if not isinstance(channels, list) or not isinstance(samplers, list):
        return "clip %s needs channels and samplers" % name
    paths = set()
    for channel in channels:
        target = channel.get("target") if isinstance(channel, dict) else None
        node = target.get("node") if isinstance(target, dict) else None
        if not isinstance(node, int) or isinstance(node, bool) or node not in joints:
            return "clip %s: channels may target the rig joints only" % name
        path = target.get("path")
        if path not in ("rotation", "translation"):
            return "clip %s: channel path %r must be rotation or translation" % (name, path)
        paths.add((nodes[node]["name"], path))
        sampler = channel.get("sampler")
        if (
            not isinstance(sampler, int)
            or isinstance(sampler, bool)
            or not 0 <= sampler < len(samplers)
        ):
            return "clip %s: a channel's sampler index is out of range" % name
    for joint in RIG:
        if (joint, "rotation") not in paths:
            return "clip %s: joint %s has no rotation channel" % (name, joint)
    if ("Hips", "translation") not in paths:
        return "clip %s: Hips has no translation channel" % name
    inputs = {
        s["input"] for s in samplers if isinstance(s, dict) and isinstance(s.get("input"), int)
    }
    if len(inputs) > 1:
        return "clip %s: every sampler must share one input accessor (the same key times)" % name
    for sampler in samplers:
        if not isinstance(sampler, dict) or sampler.get("interpolation") != "LINEAR":
            return "clip %s: every sampler must be LINEAR" % name
        times = accessor_of(doc, sampler.get("input"))
        if times is None or times.get("count") != keys:
            return "clip %s: every sampler needs %d keys" % (name, keys)
        low, high = times.get("min"), times.get("max")
        if (
            not isinstance(low, list)
            or not isinstance(high, list)
            or len(low) != 1
            or len(high) != 1
            or not is_finite_number(low[0])
            or not is_finite_number(high[0])
        ):
            return "clip %s: the key times need a min and a max" % name
        if abs(low[0]) > TIME_TOLERANCE or abs(high[0] - frames / FPS) > TIME_TOLERANCE:
            return "clip %s must run 0 to %d frames at %d fps, found %s to %s" % (
                name,
                frames,
                FPS,
                low[0],
                high[0],
            )
    return None


def check_champion(path, doc):
    nodes = doc.get("nodes", [])
    error = check_skin(doc, nodes)
    if error:
        return error
    joints = set(doc["skins"][0]["joints"])
    animations = doc.get("animations")
    if not isinstance(animations, list) or not all(isinstance(a, dict) for a in animations):
        return "animations must be a list of objects"
    names = [a.get("name") for a in animations]
    if sorted(map(str, names)) != sorted(CLIPS):
        return "the animations must be exactly %s, found %s" % (
            ", ".join(CLIPS),
            ", ".join(str(n) for n in names),
        )
    for animation in animations:
        error = check_clip(doc, nodes, joints, animation)
        if error:
            return error
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
    rule = CATEGORY_RULES.get(path.parent.name)
    if rule is None:
        return "unknown category folder %r, expected arenas or champions" % (
            path.parent.name
        )
    for key in FORBIDDEN_KEYS[path.parent.name]:
        if key in doc:
            return "%s are not allowed in %s" % (key, path.parent.name)
    return check_nodes(doc) or rule(path, doc)


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
        try:
            error = validate_file(path)
        except Exception as exc:  # fail closed and keep checking the other files
            error = "validator error: %s: %s" % (type(exc).__name__, exc)
        if error is None:
            print("OK %s" % path)
        else:
            failed = True
            print("FAIL %s: %s" % (path, error))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
