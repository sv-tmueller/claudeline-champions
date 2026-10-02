"""Contract tests for the committed champion glbs. Standard library only.

They read `assets/models/champions/*.glb` and check what the client relies on
(one `Champion` node at the scene root, feet at the origin, facing +X, a top
below the health bar) and that the roster bodies stay easy to tell apart on
screen. No Blender is needed, so they run in CI.
"""
import copy
import json
import math
import struct
import unittest
from pathlib import Path

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


def material_name(doc, primitive):
    """The material's name, or None when the primitive has no valid material."""
    index = primitive.get("material")
    materials = doc.get("materials", [])
    if not isinstance(index, int) or not 0 <= index < len(materials):
        return None
    return materials[index].get("name")


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


def contract_problems(doc, bin_chunk):
    """Return a list of problems. An empty list means the contract holds."""
    problems = []
    nodes = doc.get("nodes", [])
    if len(nodes) != 1:
        problems.append("expected exactly one node, found %d" % len(nodes))
    else:
        node = nodes[0]
        if node.get("name") != "Champion" or "mesh" not in node:
            problems.append("the node must be a mesh named Champion")
        for key in ("translation", "rotation", "scale", "matrix", "children"):
            if key in node:
                problems.append("the Champion node must not have %s" % key)
    scenes = doc.get("scenes", [])
    if doc.get("scene") != 0 or len(scenes) != 1 or scenes[0].get("nodes") != [0]:
        problems.append("the default scene must list only the Champion node")
    if len(doc.get("meshes", [])) != 1:
        problems.append("expected exactly one mesh")
    names = [m.get("name") for m in doc.get("materials", [])]
    if names != ["body", "accent"]:
        problems.append("materials must be body then accent, found %r" % names)

    ys, radii, accent_xs = [], [], []
    for primitive in primitives(doc):
        if "material" not in primitive:
            problems.append("a primitive has no material")
        elif material_name(doc, primitive) is None:
            problems.append("a primitive's material index out of range")
        is_accent = material_name(doc, primitive) == "accent"
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

    def test_rejects_a_primitive_without_a_material(self):
        del primitives(self.doc)[0]["material"]
        self.assertProblem("primitive has no material")

    def test_rejects_a_translation_on_the_node(self):
        self.doc["nodes"][0]["translation"] = [1, 0, 0]
        self.assertProblem("must not have translation")

    def test_rejects_a_second_node(self):
        self.doc["nodes"].append({"name": "Extra"})
        self.assertProblem("exactly one node")

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
