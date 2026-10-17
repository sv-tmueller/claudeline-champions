"""Contract tests for the committed arena glbs. Standard library only.

They read `assets/models/arenas/*.glb` and the matching `data/arenas/*.json`
and check the geometry gen_arena.py builds from the definition: the five flat
materials, the two-tone floor (a field and a trim border), one trim disc under
every spawn, the chamfered obstacle tops and the trim caps on the walls. The
discs and the caps are geometry inside the existing `Floor` and `Wall_*`
meshes, not nodes (decision 7 of batch #134), so the vertex data is the only
place to check them. No Blender is needed, so they run in CI.

The constants below mirror gen_arena.py, which imports bmesh and so cannot be
imported here. A change to one without the other fails against the committed
glbs.
"""
import json
import math
import unittest

from test_champion_models import REPO, load, material_name, positions, primitives

ARENA_IDS = ("arena01", "arena02")
ARENAS_DIR = REPO / "assets" / "models" / "arenas"
DATA_DIR = REPO / "data" / "arenas"

FLOOR_THICKNESS = 0.2
WALL_THICKNESS = 0.5
WALL_HEIGHT = 1.0
TRIM_WIDTH = 1.0
DISC_RADIUS = 0.6
DISC_HEIGHT = 0.01
BEVEL = 0.08
CAP_HEIGHT = 0.1
CAP_BEVEL = 0.05

MATERIALS = {"floor", "trim", "wall", "blocking", "open"}
TOLERANCE = 1e-4
# The glb stores float32 and the exporter writes the client mapping (x, up, z),
# where up is Blender Z and z is minus Blender Y.
X, UP, Z = 0, 1, 2


def arena_json(arena_id):
    return json.loads((DATA_DIR / ("%s.json" % arena_id)).read_text())


def arena_glb(arena_id):
    return load(ARENAS_DIR / ("%s.glb" % arena_id))


def node_vertices(doc, bin_chunk, node_name):
    """The vertices of a node's mesh by material name, in the node's own space."""
    node = next(n for n in doc["nodes"] if n.get("name") == node_name)
    out = {}
    for primitive in doc["meshes"][node["mesh"]]["primitives"]:
        out.setdefault(material_name(doc, primitive), []).extend(positions(doc, bin_chunk, primitive))
    return out


def extent(vertices, axis):
    values = [v[axis] for v in vertices]
    return min(values), max(values)


def at_height(vertices, up):
    return [v for v in vertices if abs(v[UP] - up) <= TOLERANCE]


def radius(vertex):
    return math.hypot(vertex[X], vertex[Z])


def clusters(vertices, gap):
    """Group (x, z) points by single linkage: a point joins a group within `gap`."""
    groups = []
    for vertex in {(round(v[X], 5), round(v[UP], 5), round(v[Z], 5)) for v in vertices}:
        near = [g for g in groups if any(math.hypot(vertex[X] - p[X], vertex[Z] - p[Z]) <= gap for p in g)]
        merged = [vertex]
        for group in near:
            merged.extend(group)
            groups.remove(group)
        groups.append(merged)
    return groups


def wall_bounds(arena):
    """The footprint of each wall as (x min, x max, z min, z max), glTF axes."""
    half_w = arena["size"]["width"] / 2
    half_d = arena["size"]["height"] / 2
    t = WALL_THICKNESS
    return {
        "Wall_N": (-half_w - t, half_w + t, -half_d - t, -half_d),
        "Wall_S": (-half_w - t, half_w + t, half_d, half_d + t),
        "Wall_E": (half_w, half_w + t, -half_d, half_d),
        "Wall_W": (-half_w - t, -half_w, -half_d, half_d),
    }


def per_arena(check):
    """Run a check on every arena, each as its own subtest, so one failing
    arena does not hide the other."""

    def run(self):
        for arena_id in ARENA_IDS:
            doc, bin_chunk = arena_glb(arena_id)
            with self.subTest(arena=arena_id):
                check(self, arena_json(arena_id), doc, bin_chunk)

    run.__name__ = check.__name__
    return run


class CommittedArenaTests(unittest.TestCase):
    def assertNear(self, actual, expected, message):
        self.assertAlmostEqual(actual, expected, delta=TOLERANCE, msg=message)

    @per_arena
    def test_the_materials_are_exactly_floor_trim_wall_blocking_open(self, arena, doc, bin_chunk):
        self.assertEqual({m["name"] for m in doc["materials"]}, MATERIALS)

    @per_arena
    def test_the_node_set_is_unchanged(self, arena, doc, bin_chunk):
        want = ["Floor", "Wall_N", "Wall_S", "Wall_E", "Wall_W"]
        want += ["Obstacle_%d" % i for i in range(len(arena["obstacles"]))]
        self.assertEqual(sorted(n["name"] for n in doc["nodes"]), sorted(want))

    @per_arena
    def test_the_floor_field_spans_the_field_inside_the_border(self, arena, doc, bin_chunk):
        half_w, half_d = arena["size"]["width"] / 2 - TRIM_WIDTH, arena["size"]["height"] / 2 - TRIM_WIDTH
        field = node_vertices(doc, bin_chunk, "Floor")["floor"]
        for axis, low, high in ((X, -half_w, half_w), (UP, -FLOOR_THICKNESS, 0.0), (Z, -half_d, half_d)):
            lo, hi = extent(field, axis)
            self.assertNear(lo, low, "floor axis %d low" % axis)
            self.assertNear(hi, high, "floor axis %d high" % axis)

    @per_arena
    def test_the_trim_spans_the_whole_slab_and_stands_to_the_disc_top(self, arena, doc, bin_chunk):
        half_w, half_d = arena["size"]["width"] / 2, arena["size"]["height"] / 2
        trim = node_vertices(doc, bin_chunk, "Floor")["trim"]
        for axis, low, high in ((X, -half_w, half_w), (UP, -FLOOR_THICKNESS, DISC_HEIGHT), (Z, -half_d, half_d)):
            lo, hi = extent(trim, axis)
            self.assertNear(lo, low, "trim axis %d low" % axis)
            self.assertNear(hi, high, "trim axis %d high" % axis)

    @per_arena
    def test_the_border_is_flush_with_the_slab_top(self, arena, doc, bin_chunk):
        trim = node_vertices(doc, bin_chunk, "Floor")["trim"]
        tops = {round(v[UP], 4) for v in trim if abs(v[UP] - DISC_HEIGHT) > TOLERANCE and v[UP] > -0.1}
        self.assertEqual(tops, {0.0})

    @per_arena
    def test_every_spawn_has_one_trim_disc_centred_on_it(self, arena, doc, bin_chunk):
        spawns = arena["spawns"]["teamA"] + arena["spawns"]["teamB"]
        trim = node_vertices(doc, bin_chunk, "Floor")["trim"]
        discs = clusters(at_height(trim, DISC_HEIGHT), 0.3)
        self.assertEqual(len(discs), len(spawns), "one disc per spawn")
        matched = set()
        for disc in discs:
            cx = sum(v[X] for v in disc) / len(disc)
            cz = sum(v[Z] for v in disc) / len(disc)
            index = next(
                (
                    i
                    for i, (x, y) in enumerate(spawns)
                    if abs(cx - x) <= TOLERANCE and abs(cz + y) <= TOLERANCE
                ),
                None,
            )
            self.assertIsNotNone(index, "a disc centred at (%.4f, %.4f) is on no spawn" % (cx, cz))
            self.assertNotIn(index, matched, "two discs on spawn %d" % index)
            matched.add(index)
            widest = max(math.hypot(v[X] - cx, v[Z] - cz) for v in disc)
            self.assertNear(widest, DISC_RADIUS, "disc %d radius" % index)

    @per_arena
    def test_each_obstacle_spans_zero_to_its_height(self, arena, doc, bin_chunk):
        for i, ob in enumerate(arena["obstacles"]):
            (vertices,) = node_vertices(doc, bin_chunk, "Obstacle_%d" % i).values()
            lo, hi = extent(vertices, UP)
            self.assertNear(lo, 0.0, "obstacle %d base" % i)
            self.assertNear(hi, ob["height"], "obstacle %d top" % i)
            if ob["type"] == "rect":
                for axis, half in ((X, ob["w"] / 2), (Z, ob["h"] / 2)):
                    low, high = extent(vertices, axis)
                    self.assertNear(low, -half, "obstacle %d footprint" % i)
                    self.assertNear(high, half, "obstacle %d footprint" % i)
            else:
                self.assertNear(max(radius(v) for v in vertices), ob["r"], "obstacle %d radius" % i)

    @per_arena
    def test_each_obstacle_top_is_inset_by_the_chamfer(self, arena, doc, bin_chunk):
        for i, ob in enumerate(arena["obstacles"]):
            (vertices,) = node_vertices(doc, bin_chunk, "Obstacle_%d" % i).values()
            top = at_height(vertices, ob["height"])
            shoulder = at_height(vertices, ob["height"] - BEVEL)
            self.assertTrue(top and shoulder, "obstacle %d has no chamfer rows" % i)
            if ob["type"] == "rect":
                for axis, half in ((X, ob["w"] / 2), (Z, ob["h"] / 2)):
                    self.assertNear(max(abs(v[axis]) for v in top), half - BEVEL, "obstacle %d top" % i)
                    self.assertNear(max(abs(v[axis]) for v in shoulder), half, "obstacle %d shoulder" % i)
            else:
                self.assertNear(max(radius(v) for v in top), ob["r"] - BEVEL, "obstacle %d top" % i)
                self.assertNear(max(radius(v) for v in shoulder), ob["r"], "obstacle %d shoulder" % i)

    @per_arena
    def test_each_wall_keeps_its_bounds_and_splits_into_a_wall_and_a_trim_cap(self, arena, doc, bin_chunk):
        for name, (x0, x1, z0, z1) in wall_bounds(arena).items():
            parts = node_vertices(doc, bin_chunk, name)
            self.assertEqual(set(parts), {"wall", "trim"}, name)
            every = parts["wall"] + parts["trim"]
            for axis, low, high in ((X, x0, x1), (UP, 0.0, WALL_HEIGHT), (Z, z0, z1)):
                lo, hi = extent(every, axis)
                self.assertNear(lo, low, "%s axis %d low" % (name, axis))
                self.assertNear(hi, high, "%s axis %d high" % (name, axis))
            lo, hi = extent(parts["wall"], UP)
            self.assertNear(lo, 0.0, "%s wall base" % name)
            self.assertNear(hi, WALL_HEIGHT - CAP_HEIGHT, "%s wall top" % name)
            lo, hi = extent(parts["trim"], UP)
            self.assertNear(lo, WALL_HEIGHT - CAP_HEIGHT, "%s cap base" % name)
            self.assertNear(hi, WALL_HEIGHT, "%s cap top" % name)

    @per_arena
    def test_each_cap_chamfers_its_two_long_top_edges_and_keeps_square_ends(self, arena, doc, bin_chunk):
        for name, (x0, x1, z0, z1) in wall_bounds(arena).items():
            cap = node_vertices(doc, bin_chunk, name)["trim"]
            top = at_height(cap, WALL_HEIGHT)
            shoulder = at_height(cap, WALL_HEIGHT - CAP_BEVEL)
            base = at_height(cap, WALL_HEIGHT - CAP_HEIGHT)
            self.assertTrue(top and shoulder and base, "%s cap has no chamfer rows" % name)
            # The thin axis is the one across the wall; the other is its length.
            across, along = (X, Z) if x1 - x0 < z1 - z0 else (Z, X)
            bounds = {X: (x0, x1), Z: (z0, z1)}
            for vertices, inset in ((top, CAP_BEVEL), (shoulder, 0.0), (base, 0.0)):
                lo, hi = extent(vertices, across)
                self.assertNear(lo, bounds[across][0] + inset, "%s across low" % name)
                self.assertNear(hi, bounds[across][1] - inset, "%s across high" % name)
                lo, hi = extent(vertices, along)
                self.assertNear(lo, bounds[along][0], "%s along low" % name)
                self.assertNear(hi, bounds[along][1], "%s along high" % name)


if __name__ == "__main__":
    unittest.main()
