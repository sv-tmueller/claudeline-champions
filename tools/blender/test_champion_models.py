"""Contract tests for the committed champion glbs. Standard library only.

They read `assets/models/champions/*.glb` and check what the client relies on
(the `Rig` root with the joints and one skinned `Champion` mesh, a bind pose
equal to the rest pose, rigid weights, feet at the origin, facing +X, a top
below the health bar at rest and at every key of every clip) and that the
roster bodies stay easy to tell apart on screen. No Blender is needed, so they
run in CI.
"""
import copy
import json
import math
import struct
import unittest
from pathlib import Path

from test_validate_glb import table_rows

REPO = Path(__file__).resolve().parents[2]
CHAMPIONS_DIR = REPO / "assets" / "models" / "champions"
ARENA_GLB = REPO / "assets" / "models" / "arenas" / "arena01.glb"

CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942

IDS = {"placeholder", "hargrim", "quillon", "lumeth", "skerrow"}
ROSTER = ("hargrim", "quillon", "lumeth", "skerrow")

# The health bar's back starts at BAR_Y - BAR_HEIGHT / 2 - BORDER = 2.1 - 0.09 - 0.04
# = 1.97 m (health-bars.ts), so a model must end below that.
MAX_TOP = 1.90
MAX_GROUND_RADIUS = 0.50
MAX_BYTES = 48 * 1024
MAX_TRIANGLES = 600
FOOT_TOLERANCE = 1e-4
MATRIX_TOLERANCE = 1e-5
WEIGHT_TOLERANCE = 1e-6
TOP_TOLERANCE = 1e-6
# A pose may put a vertex this far below the floor (0.1 mm) and no further.
FLOOR_TOLERANCE = 1e-4
KEY_TIME_TOLERANCE = 1e-4
FPS = 30
# Between two keys three interpolates a rotation with slerp and a translation
# with lerp. The poses are built so the floor holds between keys too (the two
# rules are in gen_champion.py), so the interior samples are held to the same
# tolerance as the keys.
SAMPLE_STEPS = 20
SAMPLED_FLOOR = -FLOOR_TOLERANCE
# The key frames of each clip. assets.md's Clips table lists the same frames,
# and a test fails if they drift apart.
KEY_FRAMES = {
    "Idle": (0, 30, 60),
    "Run": (0, 3, 5, 7, 10, 13, 15, 17, 20),
    "Attack": (0, 2, 4, 12),
    "Cast": (0, 5, 9, 15),
    "Hit": (0, 2, 9),
    "Death": (0, 10, 20, 30),
}
LOOPING = ("Idle", "Run")
LOOP_TOLERANCE = 1e-6

JOINTS = ("Hips", "Spine", "Arm_L", "Arm_R", "Leg_L", "Leg_R")
NODE_COUNT = 8  # the six joints, Champion and Rig

OVERLAY_B_MINUS_G = 45  # arena.spec counts r-g > 50 and b-g > 50 as overlay
MIN_DISTANCE = 80

# Colours the client draws next to a champion. They are copied from
# packages/client/src: ALLY_BAR_COLOUR and ENEMY_BAR_COLOUR (health-bars.ts),
# RING_COLOUR (impact-rings.ts), DEAD_COLOUR (champion-look.ts),
# PROJECTILE_ALLY_COLOUR and PROJECTILE_ENEMY_COLOUR (entity-views.ts), the
# FLASH_COLOUR (champion-look.ts, the white hit flash) and the debug overlay line
# (debug-overlay.ts).
# The client may change them, so update this list in the same change.
CLIENT_COLOURS = {
    "ally bar": (0x3D, 0xDC, 0x84),
    "enemy bar": (0xFF, 0x4D, 0x4F),
    "impact ring": (0xFF, 0xD2, 0x3F),
    "hit flash": (0xFF, 0xFF, 0xFF),
    "dead grey": (0x5A, 0x60, 0x70),
    "ally projectile": (0x5C, 0xD6, 0xFF),
    "enemy projectile": (0xFF, 0x8A, 0x5C),
    "debug overlay": (0xFF, 0x00, 0xFF),
}


# glb reading


def split_glb(data):
    """Return (document, bin chunk). Asserts the file is a well formed glb."""
    magic, version, length = struct.unpack("<4sII", data[:12])
    assert magic == b"glTF" and version == 2 and length == len(data)
    doc, bin_chunk, offset = None, b"", 12
    while offset < len(data):
        chunk_length, chunk_type = struct.unpack("<II", data[offset : offset + 8])
        body = data[offset + 8 : offset + 8 + chunk_length]
        if chunk_type == CHUNK_JSON:
            doc = json.loads(body.decode("utf-8"))
        elif chunk_type == CHUNK_BIN:
            bin_chunk = body
        offset += 8 + chunk_length
    assert doc is not None, "no JSON chunk"
    return doc, bin_chunk


def accessor_location(doc, index):
    """Return (byte offset in the BIN chunk, count) of a POSITION accessor."""
    accessor = doc["accessors"][index]
    assert accessor["componentType"] == 5126, "POSITION must be float32"
    assert accessor["type"] == "VEC3", "POSITION must be VEC3"
    view = doc["bufferViews"][accessor["bufferView"]]
    assert view.get("byteStride", 12) == 12, "POSITION must be tightly packed"
    return view.get("byteOffset", 0) + accessor.get("byteOffset", 0), accessor["count"]


def primitives(doc):
    return [p for mesh in doc["meshes"] for p in mesh["primitives"]]


def positions(doc, bin_chunk, primitive):
    offset, count = accessor_location(doc, primitive["attributes"]["POSITION"])
    return list(struct.iter_unpack("<3f", bytes(bin_chunk[offset : offset + 12 * count])))


def triangle_count(doc):
    total = 0
    for primitive in primitives(doc):
        assert primitive.get("mode", 4) == 4, "only triangle lists are counted"
        total += doc["accessors"][primitive["indices"]]["count"] // 3
    return total


COMPONENT_FORMATS = {5121: ("B", 1), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
TYPE_WIDTHS = {"SCALAR": 1, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def read_accessor(doc, bin_chunk, index):
    """Return the accessor's elements as a list of tuples, honouring byteStride."""
    accessor = doc["accessors"][index]
    code, size = COMPONENT_FORMATS[accessor["componentType"]]
    width = TYPE_WIDTHS[accessor["type"]]
    view = doc["bufferViews"][accessor["bufferView"]]
    stride = view.get("byteStride", size * width)
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    fmt = "<%d%s" % (width, code)
    return [
        struct.unpack_from(fmt, bytes(bin_chunk), start + i * stride)
        for i in range(accessor["count"])
    ]


def accessor_offset(doc, index):
    """The byte offset of the accessor's first element in the BIN chunk."""
    accessor = doc["accessors"][index]
    view = doc["bufferViews"][accessor["bufferView"]]
    return view.get("byteOffset", 0) + accessor.get("byteOffset", 0)


def identity():
    return [[1.0 if r == c else 0.0 for c in range(4)] for r in range(4)]


def mat_mul(a, b):
    return [[sum(a[r][k] * b[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def trs_matrix(translation, rotation, scale):
    """A row-major 4x4 from a glTF translation, quaternion (x, y, z, w) and scale."""
    x, y, z, w = rotation
    rot = [
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ]
    m = identity()
    for r in range(3):
        for c in range(3):
            m[r][c] = rot[r][c] * scale[c]
        m[r][3] = translation[r]
    return m


def column_major(flat):
    return [[flat[c * 4 + r] for c in range(4)] for r in range(4)]


def node_trs(node):
    return (
        tuple(node.get("translation", (0.0, 0.0, 0.0))),
        tuple(node.get("rotation", (0.0, 0.0, 0.0, 1.0))),
        tuple(node.get("scale", (1.0, 1.0, 1.0))),
    )


def world_matrices(doc, pose):
    """World matrix per node index. `pose` maps a node index to (t, r, s) overrides."""
    nodes = doc["nodes"]
    parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}
    cache = {}

    def world(i):
        if i not in cache:
            local = trs_matrix(*pose.get(i, node_trs(nodes[i])))
            cache[i] = mat_mul(world(parent[i]), local) if i in parent else local
        return cache[i]

    return [world(i) for i in range(len(nodes))]


def material_index_in_range(doc, primitive):
    index = primitive.get("material")
    return isinstance(index, int) and 0 <= index < len(doc.get("materials", []))


def material_name(doc, primitive):
    """The material's name, or None when the material or its name is missing."""
    if not material_index_in_range(doc, primitive):
        return None
    return doc["materials"][primitive["material"]].get("name")


def srgb8(linear):
    c = 12.92 * linear if linear <= 0.0031308 else 1.055 * linear ** (1 / 2.4) - 0.055
    return min(255, max(0, round(c * 255)))


def material_rgb8(doc, name):
    material = next(m for m in doc["materials"] if m["name"] == name)
    factor = material["pbrMetallicRoughness"]["baseColorFactor"]
    return tuple(srgb8(c) for c in factor[:3])


def base_color_factor(doc, name):
    """The raw linear baseColorFactor of a material, not 8-bit values."""
    material = next(m for m in doc["materials"] if m["name"] == name)
    return tuple(material["pbrMetallicRoughness"]["baseColorFactor"])


def distance(a, b):
    return math.sqrt(sum((p - q) ** 2 for p, q in zip(a, b)))


def hex_of(rgb):
    return "#%02x%02x%02x" % rgb


# contract


def layout_problems(doc):
    """The node layout: `Rig` at the scene root over the joints and `Champion`."""
    problems = []
    nodes = doc.get("nodes", [])
    if len(nodes) != NODE_COUNT:
        problems.append("expected %d nodes, found %d" % (NODE_COUNT, len(nodes)))
    by_name = {n.get("name"): n for n in nodes}
    champion, rig = by_name.get("Champion"), by_name.get("Rig")
    if champion is None or "mesh" not in champion or "skin" not in champion:
        problems.append("Champion must have a mesh and a skin")
    if champion is not None:
        for key in ("translation", "rotation", "scale", "matrix", "children"):
            if key in champion:
                problems.append("the Champion node must not have %s" % key)
    if rig is None:
        problems.append("no node named Rig")
    else:
        for key in ("translation", "rotation", "scale", "matrix"):
            if key in rig:
                problems.append("the Rig node must not have %s" % key)
        children = sorted(nodes[c].get("name") for c in rig.get("children", []))
        if children != ["Champion", "Hips"]:
            problems.append(
                "the Rig node's children must be Hips and Champion, found %r" % children
            )
    scenes = doc.get("scenes", [])
    rig_index = nodes.index(rig) if rig is not None else None
    if doc.get("scene") != 0 or len(scenes) != 1 or scenes[0].get("nodes") != [rig_index]:
        problems.append("the default scene must list only Rig")
    return problems


def champion_primitives(doc):
    index = next(n["mesh"] for n in doc["nodes"] if n.get("name") == "Champion")
    return doc["meshes"][index]["primitives"]


def skinned_vertices(doc, bin_chunk):
    """Every Champion vertex as (position, joints, weights)."""
    vertices = []
    for primitive in champion_primitives(doc):
        attributes = primitive["attributes"]
        vertices += zip(
            read_accessor(doc, bin_chunk, attributes["POSITION"]),
            read_accessor(doc, bin_chunk, attributes["JOINTS_0"]),
            read_accessor(doc, bin_chunk, attributes["WEIGHTS_0"]),
        )
    return vertices


def bind_problems(doc, joints, inverse):
    """Every joint's rest world matrix times its inverse bind matrix is the identity."""
    problems = []
    rest = world_matrices(doc, {})
    for joint, ibm in zip(joints, inverse):
        product = mat_mul(rest[joint], ibm)
        off = max(abs(product[r][c] - identity()[r][c]) for r in range(4) for c in range(4))
        if off > MATRIX_TOLERANCE:
            name = doc["nodes"][joint]["name"]
            problems.append("bind pose of %s differs from the rest pose" % name)
    return problems


def weight_problems(vertices, joint_count):
    """Every vertex is rigid: one joint at weight 1.0, the others at 0."""
    for _, indices, weights in vertices:
        ones = [w for w in weights if abs(w - 1.0) <= WEIGHT_TOLERANCE]
        zeros = [w for w in weights if abs(w) <= WEIGHT_TOLERANCE]
        if len(ones) != 1 or len(zeros) != 3 or any(i >= joint_count for i in indices):
            return ["every vertex must be rigid on one joint at weight 1.0"]
    return []


def clip_times(doc, bin_chunk, animation):
    """The clip's key times, or None when its samplers do not share one input."""
    inputs = {s["input"] for s in animation["samplers"]}
    if len(inputs) != 1:
        return None
    return [t for (t,) in read_accessor(doc, bin_chunk, inputs.pop())]


def slerp(a, b, t):
    """Quaternion (x, y, z, w) interpolation along the short arc, as three does."""
    if t == 0:
        return tuple(a)
    dot = sum(p * q for p, q in zip(a, b))
    if dot < 0:
        b, dot = tuple(-q for q in b), -dot
    if dot > 0.9995:
        mixed = [p + t * (q - p) for p, q in zip(a, b)]
    else:
        theta = math.acos(dot)
        wa = math.sin((1 - t) * theta) / math.sin(theta)
        wb = math.sin(t * theta) / math.sin(theta)
        mixed = [wa * p + wb * q for p, q in zip(a, b)]
    length = math.sqrt(sum(c * c for c in mixed))
    return tuple(c / length for c in mixed)


def lerp(a, b, t):
    return tuple(p + t * (q - p) for p, q in zip(a, b))


def clip_values(doc, bin_chunk, animation):
    """The animated output per (node, path): one value per key."""
    values = {}
    for channel in animation["channels"]:
        sampler = animation["samplers"][channel["sampler"]]
        target = channel["target"]
        values[(target["node"], target["path"])] = read_accessor(
            doc, bin_chunk, sampler["output"]
        )
    return values


def pose_between(doc, values, key, fraction):
    """The pose a fraction of the way from `key` to the next key."""
    pose = {}
    for (node, path), outputs in values.items():
        t, r, s = pose.get(node, node_trs(doc["nodes"][node]))
        after = outputs[min(key + 1, len(outputs) - 1)]
        if path == "translation":
            pose[node] = (lerp(outputs[key], after, fraction), r, s)
        else:
            pose[node] = (t, slerp(outputs[key], after, fraction), s)
    return pose


def pose_extremes(doc, joints, inverse, vertices, pose):
    """The lowest and the highest skinned vertex height in a pose."""
    world = world_matrices(doc, pose)
    skin_matrices = [mat_mul(world[j], ibm) for j, ibm in zip(joints, inverse)]
    heights = [posed_y(skin_matrices, v) for v in vertices]
    return min(heights), max(heights)


def sampled_extremes(doc, joints, inverse, vertices, values, keys):
    """The lowest and highest height over the interior samples of every key interval.

    Returns (low, low_at, high) where `low_at` is the (key, fraction) of the low.
    """
    low, low_at, high = math.inf, None, -math.inf
    for key in range(keys - 1):
        for step in range(1, SAMPLE_STEPS):
            fraction = step / SAMPLE_STEPS
            pose = pose_between(doc, values, key, fraction)
            bottom, top = pose_extremes(doc, joints, inverse, vertices, pose)
            if bottom < low:
                low, low_at = bottom, (key, fraction)
            high = max(high, top)
    return low, low_at, high


def clip_problems(doc, bin_chunk, joints, inverse, vertices):
    """The key times against the table, then the posed top and floor at every key."""
    problems = []
    for animation in doc["animations"]:
        name = animation["name"]
        times = clip_times(doc, bin_chunk, animation)
        if times is None:
            problems.append("clip %s: the samplers must share one input accessor" % name)
            continue
        wanted = [frame / FPS for frame in KEY_FRAMES[name]]
        if len(times) != len(wanted) or any(
            abs(t - w) > KEY_TIME_TOLERANCE for t, w in zip(times, wanted)
        ):
            problems.append(
                "clip %s: key times %s differ from the table frames %s / %d"
                % (name, [round(t, 4) for t in times], list(KEY_FRAMES[name]), FPS)
            )
            continue
        values = clip_values(doc, bin_chunk, animation)
        if name in LOOPING:
            for (node, path), outputs in values.items():
                if any(abs(p - q) > LOOP_TOLERANCE for p, q in zip(outputs[0], outputs[-1])):
                    problems.append(
                        "loop of %s does not close: %s %s starts at %s and ends at %s"
                        % (name, doc["nodes"][node]["name"], path, outputs[0], outputs[-1])
                    )
        for key in range(len(times)):
            pose = pose_between(doc, values, key, 0)
            low, high = pose_extremes(doc, joints, inverse, vertices, pose)
            if high > MAX_TOP + TOP_TOLERANCE:
                problems.append(
                    "posed top is %.4f m in %s at key %d, the limit is %.2f m"
                    % (high, name, key, MAX_TOP)
                )
            if low < -FLOOR_TOLERANCE:
                problems.append(
                    "posed floor is %.4f m in %s at key %d, no vertex may be below 0"
                    % (low, name, key)
                )
        low, low_at, high = sampled_extremes(doc, joints, inverse, vertices, values, len(times))
        if low < SAMPLED_FLOOR:
            problems.append(
                "sampled floor is %.4f m in %s after key %d (%.2f of the way), "
                "the limit is %.4f m" % (low, name, low_at[0], low_at[1], SAMPLED_FLOOR)
            )
        if high > MAX_TOP + TOP_TOLERANCE:
            problems.append(
                "sampled top is %.4f m in %s between keys, the limit is %.2f m"
                % (high, name, MAX_TOP)
            )
    return problems


def rig_problems(doc, bin_chunk):
    """The joints, the bind pose, the weights and every clip's keys, top and floor."""
    skin = doc["skins"][0]
    joints = skin["joints"]
    if sorted(doc["nodes"][j]["name"] for j in joints) != sorted(JOINTS):
        return ["the skin joints must be %s" % ", ".join(JOINTS)]
    inverse = [column_major(m) for m in read_accessor(doc, bin_chunk, skin["inverseBindMatrices"])]
    vertices = skinned_vertices(doc, bin_chunk)
    problems = bind_problems(doc, joints, inverse) + weight_problems(vertices, len(joints))
    if problems:
        return problems
    return clip_problems(doc, bin_chunk, joints, inverse, vertices)


def posed_y(skin_matrices, vertex):
    (x, y, z), indices, weights = vertex
    return sum(
        w * (m[1][0] * x + m[1][1] * y + m[1][2] * z + m[1][3])
        for i, w in zip(indices, weights)
        for m in (skin_matrices[i],)
    )


def contract_problems(doc, bin_chunk):
    """Return a list of problems. An empty list means the contract holds."""
    problems = layout_problems(doc)
    if len(doc.get("meshes", [])) != 1:
        problems.append("expected exactly one mesh")
    names = [m.get("name") for m in doc.get("materials", [])]
    if names != ["body", "accent"]:
        problems.append("materials must be body then accent, found %r" % names)

    ys, radii, accent_xs = [], [], []
    for primitive in primitives(doc):
        name = material_name(doc, primitive)
        if "material" not in primitive:
            problems.append("a primitive has no material")
        elif not material_index_in_range(doc, primitive):
            problems.append("a primitive's material index out of range")
        elif not isinstance(name, str):
            problems.append("a primitive's material has no name")
        is_accent = name == "accent"
        for x, y, z in positions(doc, bin_chunk, primitive):
            ys.append(y)
            radii.append(math.sqrt(x * x + z * z))
            if is_accent:
                accent_xs.append(x)
    if not ys:
        return problems + ["the mesh has no vertices"]
    if abs(min(ys)) > FOOT_TOLERANCE:
        problems.append("lowest point is %.4f m, the feet must be at 0" % min(ys))
    if max(ys) > MAX_TOP:
        problems.append("top is %.4f m, the limit is %.2f m" % (max(ys), MAX_TOP))
    if max(radii) > MAX_GROUND_RADIUS:
        problems.append(
            "ground radius is %.4f m, the limit is %.2f m" % (max(radii), MAX_GROUND_RADIUS)
        )
    if any(x <= 0 for x in accent_xs):
        problems.append("every accent vertex must have x > 0 so the accent marks the front")
    if triangle_count(doc) > MAX_TRIANGLES:
        problems.append("more than %d triangles" % MAX_TRIANGLES)
    if not problems:
        problems += rig_problems(doc, bin_chunk)
    return problems


def overlay_problem(doc):
    """Rule a: no body colour can read as the magenta debug overlay."""
    r, g, b = material_rgb8(doc, "body")
    if b - g > OVERLAY_B_MINUS_G:
        return "body %s has b - g = %d, the limit is %d" % (hex_of((r, g, b)), b - g, OVERLAY_B_MINUS_G)
    return None


# test helpers


def champion_paths():
    return sorted(CHAMPIONS_DIR.glob("*.glb"))


def load(path):
    return split_glb(Path(path).read_bytes())


def node_named(doc, name):
    return next(n for n in doc["nodes"] if n.get("name") == name)


def joint_index(doc, name):
    return next(i for i, n in enumerate(doc["nodes"]) if n.get("name") == name)


def clip_named(doc, name):
    return next(a for a in doc["animations"] if a["name"] == name)


def channel_of(doc, clip, joint, path):
    target = {"node": joint_index(doc, joint), "path": path}
    return next(c for c in clip_named(doc, clip)["channels"] if c["target"] == target)


def accent_primitive(doc):
    return next(p for p in primitives(doc) if material_name(doc, p) == "accent")


def body_primitive(doc):
    return next(p for p in primitives(doc) if material_name(doc, p) == "body")


def set_vertex(doc, bin_chunk, primitive, index, xyz):
    offset, _ = accessor_location(doc, primitive["attributes"]["POSITION"])
    struct.pack_into("<3f", bin_chunk, offset + 12 * index, *xyz)


class CommittedChampionTests(unittest.TestCase):
    def test_champion_files_are_exactly_the_roster_and_the_placeholder(self):
        self.assertEqual({p.stem for p in champion_paths()}, IDS)

    def test_every_file_meets_the_contract(self):
        for path in champion_paths():
            with self.subTest(file=path.name):
                doc, bin_chunk = load(path)
                self.assertEqual(contract_problems(doc, bin_chunk), [])

    def test_every_file_fits_the_size_budget(self):
        for path in champion_paths():
            with self.subTest(file=path.name):
                self.assertLessEqual(path.stat().st_size, MAX_BYTES)

    def test_the_accent_is_the_same_in_every_file(self):
        accents = {path.name: base_color_factor(load(path)[0], "accent") for path in champion_paths()}
        self.assertEqual(len(set(accents.values())), 1, accents)

    def test_no_body_colour_can_read_as_the_debug_overlay(self):
        for path in champion_paths():
            with self.subTest(file=path.name):
                self.assertIsNone(overlay_problem(load(path)[0]))

    def test_roster_colours_stay_distinct_from_the_scene_and_each_other(self):
        placeholder_doc = load(CHAMPIONS_DIR / "placeholder.glb")[0]
        arena_doc = load(ARENA_GLB)[0]
        others = dict(CLIENT_COLOURS)
        others["arena floor"] = material_rgb8(arena_doc, "floor")
        others["accent"] = material_rgb8(placeholder_doc, "accent")
        others["placeholder body"] = material_rgb8(placeholder_doc, "body")
        roster = {i: material_rgb8(load(CHAMPIONS_DIR / ("%s.glb" % i))[0], "body") for i in ROSTER}
        for champion, colour in roster.items():
            candidates = dict(others)
            candidates.update({"%s body" % o: c for o, c in roster.items() if o != champion})
            for label, other in candidates.items():
                with self.subTest(champion=champion, against=label):
                    self.assertGreaterEqual(
                        distance(colour, other),
                        MIN_DISTANCE,
                        "%s %s is too close to %s %s"
                        % (champion, hex_of(colour), label, hex_of(other)),
                    )


class KeyFrameTableTests(unittest.TestCase):
    def test_key_frames_match_the_clips_table_in_assets_md(self):
        text = (REPO / "docs" / "architecture" / "assets.md").read_text()
        rows = table_rows(text, "| Clip | Frames |")
        table = {row[0]: tuple(int(k) for k in row[3].split(",")) for row in rows}
        self.assertEqual(table, KEY_FRAMES)


class ContractCheckTests(unittest.TestCase):
    """Each check must be able to fail, so a broken model cannot pass in CI."""

    def setUp(self):
        doc, bin_chunk = load(CHAMPIONS_DIR / "placeholder.glb")
        self.doc = doc
        self.bin = bytearray(bin_chunk)

    def assertProblem(self, text):
        problems = contract_problems(self.doc, self.bin)
        self.assertTrue(any(text in p for p in problems), "%r not in %r" % (text, problems))

    def test_placeholder_has_no_problems(self):
        self.assertEqual(contract_problems(self.doc, self.bin), [])

    def test_rejects_a_dangling_material_index(self):
        primitives(self.doc)[0]["material"] = 7
        self.assertProblem("material index out of range")

    def test_names_a_material_without_a_name_as_unnamed_not_out_of_range(self):
        accent = next(m for m in self.doc["materials"] if m["name"] == "accent")
        del accent["name"]
        problems = contract_problems(self.doc, self.bin)
        self.assertTrue(any("material has no name" in q for q in problems), problems)
        self.assertFalse(any("index out of range" in q for q in problems), problems)

    def test_rejects_a_primitive_without_a_material(self):
        del primitives(self.doc)[0]["material"]
        self.assertProblem("primitive has no material")

    def test_rejects_a_translation_on_the_champion_node(self):
        node_named(self.doc, "Champion")["translation"] = [1, 0, 0]
        self.assertProblem("Champion node must not have translation")

    def test_rejects_a_rotation_on_the_rig_node(self):
        node_named(self.doc, "Rig")["rotation"] = [0, 0.7071, 0, 0.7071]
        self.assertProblem("Rig node must not have rotation")

    def test_rejects_a_child_of_the_champion_node(self):
        node_named(self.doc, "Champion")["children"] = [0]
        self.assertProblem("Champion node must not have children")

    def test_rejects_a_champion_node_without_a_skin(self):
        del node_named(self.doc, "Champion")["skin"]
        self.assertProblem("Champion must have a mesh and a skin")

    def test_rejects_a_rig_whose_children_are_not_hips_and_champion(self):
        node_named(self.doc, "Rig")["children"].pop()
        self.assertProblem("children must be Hips and Champion")

    def test_rejects_a_second_scene_root(self):
        self.doc["scenes"][0]["nodes"].append(0)
        self.assertProblem("scene must list only Rig")

    def test_rejects_an_extra_node(self):
        self.doc["nodes"].append({"name": "Extra"})
        self.assertProblem("expected 8 nodes")

    def test_rejects_a_bind_pose_that_differs_from_the_rest_pose(self):
        ibm = self.doc["skins"][0]["inverseBindMatrices"]
        # Element 13 is the y translation of the first inverse bind matrix.
        struct.pack_into("<f", self.bin, accessor_offset(self.doc, ibm) + 4 * 13, 0.5)
        self.assertProblem("bind pose")

    def test_rejects_a_vertex_that_is_not_rigid_on_one_joint(self):
        weights = body_primitive(self.doc)["attributes"]["WEIGHTS_0"]
        struct.pack_into("<4f", self.bin, accessor_offset(self.doc, weights), 0.5, 0.5, 0, 0)
        self.assertProblem("rigid")

    def test_rejects_a_vertex_on_a_joint_that_does_not_exist(self):
        joints = body_primitive(self.doc)["attributes"]["JOINTS_0"]
        struct.pack_into("<4B", self.bin, accessor_offset(self.doc, joints), 9, 0, 0, 0)
        self.assertProblem("rigid")

    def output_offset(self, clip, joint, path):
        """The byte offset of a channel's output accessor in the BIN chunk."""
        channel = channel_of(self.doc, clip, joint, path)
        sampler = clip_named(self.doc, clip)["samplers"][channel["sampler"]]
        return accessor_offset(self.doc, sampler["output"])

    def run_hips_key(self, key):
        """The offset of a Run Hips translation key in the BIN and its (x, y, z)."""
        offset = self.output_offset("Run", "Hips", "translation") + 12 * key
        return offset, struct.unpack_from("<3f", self.bin, offset)

    def move_run_hips(self, dy):
        """Move the second key of the Run clip's Hips translation by dy (glTF y)."""
        offset, (x, y, z) = self.run_hips_key(1)
        struct.pack_into("<3f", self.bin, offset, x, y + dy, z)

    def open_the_loop(self, clip):
        """Move the last Spine key of a clip by 0.001 in the quaternion's y."""
        last = 16 * (len(KEY_FRAMES[clip]) - 1)
        offset = self.output_offset(clip, "Spine", "rotation") + last
        x, y, z, w = struct.unpack_from("<4f", self.bin, offset)
        struct.pack_into("<4f", self.bin, offset, x, y + 0.001, z, w)

    def test_rejects_an_idle_loop_that_does_not_close(self):
        self.open_the_loop("Idle")
        self.assertProblem("loop of Idle does not close")

    def test_rejects_a_run_loop_that_does_not_close(self):
        self.open_the_loop("Run")
        self.assertProblem("loop of Run does not close")

    def test_rejects_a_pose_that_lifts_the_top_above_the_limit(self):
        self.move_run_hips(1.0)
        self.assertProblem("posed top")

    def test_rejects_a_pose_that_sinks_a_vertex_below_the_floor(self):
        self.move_run_hips(-1.0)
        self.assertProblem("posed floor")

    def test_rejects_a_pose_that_sinks_below_the_sampled_floor(self):
        self.move_run_hips(-1.0)
        self.assertProblem("sampled floor")

    def test_rejects_a_pose_that_lifts_above_the_sampled_top(self):
        self.move_run_hips(1.0)
        self.assertProblem("sampled top")

    def test_the_sampled_floor_catches_what_the_keys_miss(self):
        # Run key 1 (frame 3) lifts Hips by 0.022 m, which holds the foot corner
        # on the floor while the leg straightens into the passing key. At 0.010 m
        # every key is still at or above the floor, but between key 1 and key 2
        # the corner sinks by 1.3 mm.
        self.assertAlmostEqual(self.run_hips_key(1)[1][1], 0.80 + 0.022, places=4)
        self.move_run_hips(-0.012)
        problems = contract_problems(self.doc, self.bin)
        self.assertTrue(any("sampled floor" in p for p in problems), problems)
        self.assertFalse(any("posed floor" in p for p in problems), problems)

    def test_slerp_takes_the_short_arc_and_the_midpoint_of_a_quarter_turn(self):
        quarter = (0.0, math.sin(math.pi / 4), 0.0, math.cos(math.pi / 4))
        half = slerp((0.0, 0.0, 0.0, 1.0), quarter, 0.5)
        self.assertAlmostEqual(half[1], math.sin(math.pi / 8), places=6)
        self.assertAlmostEqual(half[3], math.cos(math.pi / 8), places=6)
        # A quarter of the way, slerp and a normalised lerp differ in the second decimal
        # (y 0.1951 against 0.1874).
        early = slerp((0.0, 0.0, 0.0, 1.0), quarter, 0.25)
        self.assertAlmostEqual(early[1], math.sin(math.pi / 16), places=6)
        flipped = tuple(-c for c in quarter)
        self.assertEqual(
            [round(c, 6) for c in slerp((0.0, 0.0, 0.0, 1.0), flipped, 0.5)],
            [round(c, 6) for c in half],
        )

    def test_rejects_a_joint_that_is_renamed(self):
        node_named(self.doc, "Spine")["name"] = "Torso"
        self.assertProblem("skin joints must be")

    def test_rejects_key_times_that_differ_from_the_table(self):
        cast = clip_named(self.doc, "Cast")
        offset = accessor_offset(self.doc, cast["samplers"][0]["input"])
        # Key 2 moves from frame 9 to frame 10, for every channel at once.
        struct.pack_into("<f", self.bin, offset + 8, 10 / 30)
        self.assertProblem("key times")

    def test_rejects_samplers_that_do_not_share_one_input(self):
        cast = clip_named(self.doc, "Cast")
        self.doc["accessors"].append(dict(self.doc["accessors"][cast["samplers"][0]["input"]]))
        cast["samplers"][1]["input"] = len(self.doc["accessors"]) - 1
        self.assertProblem("share one input")

    def test_rejects_a_vertex_outside_the_ground_radius(self):
        set_vertex(self.doc, self.bin, body_primitive(self.doc), 0, (0.6, 1.0, 0.0))
        self.assertProblem("ground radius")

    def test_rejects_a_vertex_below_the_feet(self):
        set_vertex(self.doc, self.bin, body_primitive(self.doc), 0, (0.0, -0.01, 0.0))
        self.assertProblem("feet must be at 0")

    def test_rejects_a_vertex_above_the_top_limit(self):
        set_vertex(self.doc, self.bin, body_primitive(self.doc), 0, (0.0, 1.95, 0.0))
        self.assertProblem("the limit is 1.90 m")

    def test_rejects_an_accent_vertex_behind_the_origin(self):
        set_vertex(self.doc, self.bin, accent_primitive(self.doc), 0, (-0.01, 1.2, 0.0))
        self.assertProblem("accent vertex")

    def test_rejects_a_body_colour_that_reads_as_the_overlay(self):
        self.assertIsNone(overlay_problem(self.doc))
        doc = copy.deepcopy(self.doc)
        for material in doc["materials"]:
            if material["name"] == "body":
                material["pbrMetallicRoughness"]["baseColorFactor"] = [0.3, 0.05, 0.6, 1]
        self.assertIn("b - g", overlay_problem(doc))


if __name__ == "__main__":
    unittest.main()
