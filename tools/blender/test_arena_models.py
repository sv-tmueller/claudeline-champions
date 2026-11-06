"""Contract tests for the committed arena glbs. Standard library only.

They read `assets/models/arenas/*.glb` and the matching `data/arenas/*.json`
and check the geometry gen_arena.py builds from the definition: the five flat
materials, the two-tone floor (a field and a trim border), one trim disc under
every spawn, the floor inlays (the end circle, the centre line and the orb
mark), the per-kind obstacle profiles and the trim caps on the walls. The discs,
the inlays and the caps are geometry inside the existing `Floor` and `Wall_*`
meshes, not nodes (decision 7 of batch #134), so the vertex data is the only
place to check them. No Blender is needed, so they run in CI.

The constants below mirror gen_arena.py, which imports bmesh and so cannot be
imported here. A change to one without the other fails against the committed
glbs.
"""
import json
import math
import unittest

from test_champion_models import ARENA_GLBS, REPO, load, material_name, positions
from test_validate_glb import load_arena

# Every arena definition is checked, so a new arena needs no edit here.
ARENA_IDS = tuple(ARENA_GLBS)

FLOOR_THICKNESS = 0.2
WALL_THICKNESS = 0.5
WALL_HEIGHT = 1.0
TRIM_WIDTH = 1.0
DISC_RADIUS = 0.6
DISC_HEIGHT = 0.01
RING_INLAY_WIDTH = 0.1
LINE_WIDTH = 0.1
LINE_HEIGHT = 0.008
MARK_RADIUS = 0.3
# The four obstacle profiles replace the old 0.08 m chamfer (issue #237).
OBSTACLE_INSET = 0.1  # a wall segment's body or a column's shaft, inwards
BASE_COURSE = 0.15  # a wall segment's base course, full footprint
TOP_COURSE = 0.15  # a wall segment's cap, full footprint
BASE_RING_HEIGHT = 0.15  # a column's base ring, full radius
CAPITAL_HEIGHT = 0.15  # a column's capital, full radius
GROOVE_DEPTH = 0.05  # a crate's slat grooves, below the height
GROOVE_WIDTH = 0.06  # the gap between two crate slats
HOOP_INSET = 0.05  # a barrel's hoop bands, outwards of the body
HOOP_HEIGHT = 0.06  # a barrel's hoop band height
CAP_HEIGHT = 0.1
CAP_BEVEL = 0.05

MATERIALS = {"floor", "trim", "wall", "blocking", "open"}
TOLERANCE = 1e-4
# The glb stores float32 and the exporter writes the client mapping (x, up, z),
# where up is Blender Z and z is minus Blender Y.
X, UP, Z = 0, 1, 2


def arena_glb(arena_id):
    return load(ARENA_GLBS[arena_id])


def load_orbs():
    """The orb point of each arena that has a row in `data/orbs.json`.

    A missing file reads as an empty table, the server's semantics, so an
    arena without a row gets no mark.
    """
    path = REPO / "data" / "orbs.json"
    if not path.is_file():
        return {}
    return json.loads(path.read_text())


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


def radii_at(vertices, up):
    """The distinct radii of the vertices at one height."""
    return {round(radius(v), 4) for v in at_height(vertices, up)}


def xz_extents(vertices, up):
    """The distinct (|x| max, |z| max) footprints of the vertices at one height.

    A stacked profile repeats a height where two bands meet, so this returns a
    set: the shared ring's two footprints are both present there.
    """
    return {(round(abs(v[X]), 4), round(abs(v[Z]), 4)) for v in at_height(vertices, up)}


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


def disc_sized(cluster):
    """Whether a cluster of top vertices is one of the spawn discs.

    The end ring and the orb mark also top out at DISC_HEIGHT, and the ring's
    vertices cluster in pairs 0.1 apart, so only a full disc of DISC_RADIUS
    counts.
    """
    centre_x = sum(v[X] for v in cluster) / len(cluster)
    centre_z = sum(v[Z] for v in cluster) / len(cluster)
    widest = max(math.hypot(v[X] - centre_x, v[Z] - centre_z) for v in cluster)
    return abs(widest - DISC_RADIUS) <= 0.05


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
                check(self, load_arena(arena_id), doc, bin_chunk)

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
        # The inlay band (0 < up <= DISC_HEIGHT) is excluded: the centre line
        # tops out at LINE_HEIGHT, under the ring and the mark.
        tops = {
            round(v[UP], 4)
            for v in trim
            if v[UP] > -0.1 and not (TOLERANCE < v[UP] <= DISC_HEIGHT + TOLERANCE)
        }
        self.assertEqual(tops, {0.0})

    @per_arena
    def test_the_end_circle_ring(self, arena, doc, bin_chunk):
        end = arena["ring"]["endRadius"]
        inner = end - RING_INLAY_WIDTH / 2
        outer = end + RING_INLAY_WIDTH / 2
        trim = node_vertices(doc, bin_chunk, "Floor")["trim"]
        band = [v for v in trim if inner - TOLERANCE <= radius(v) <= outer + TOLERANCE]
        radii = [radius(v) for v in band]
        self.assertTrue(radii, "no ring vertices at the end radius")
        self.assertNear(min(radii), inner, "ring inner radius")
        self.assertNear(max(radii), outer, "ring outer radius")
        lo, hi = extent(at_height(band, DISC_HEIGHT), UP)
        self.assertNear(lo, DISC_HEIGHT, "ring top row")
        self.assertNear(hi, DISC_HEIGHT, "ring top row")
        lo, hi = extent(band, UP)
        self.assertNear(lo, 0.0, "ring base")
        self.assertNear(hi, DISC_HEIGHT, "ring top")

    @per_arena
    def test_the_centre_line_runs_wall_to_wall_under_the_markers(self, arena, doc, bin_chunk):
        half_d = arena["size"]["height"] / 2
        trim = node_vertices(doc, bin_chunk, "Floor")["trim"]
        # LINE_HEIGHT is under the discs and the inlays, so it isolates the
        # line's own top row from the ring and the mark.
        line = at_height(trim, LINE_HEIGHT)
        self.assertTrue(line, "no centre-line vertices")
        # 0.008 is unique to the line, so this set is its top row alone.
        lo, hi = extent(line, UP)
        self.assertNear(lo, LINE_HEIGHT, "line top row")
        self.assertNear(hi, LINE_HEIGHT, "line top row")
        for axis, low, high, name in (
            (X, -LINE_WIDTH / 2, LINE_WIDTH / 2, "line x"),
            (Z, -half_d, half_d, "line z"),
        ):
            lo, hi = extent(line, axis)
            self.assertNear(lo, low, name + " low")
            self.assertNear(hi, high, name + " high")

    @per_arena
    def test_the_orb_mark(self, arena, doc, bin_chunk):
        orb = load_orbs().get(arena["id"])
        inner = arena["ring"]["endRadius"] - RING_INLAY_WIDTH / 2
        trim = node_vertices(doc, bin_chunk, "Floor")["trim"]
        # The mark stands at DISC_HEIGHT like the discs and inside the ring, so
        # the spawn discs (well outside) and the ring do not enter the set.
        inside = [v for v in at_height(trim, DISC_HEIGHT) if radius(v) <= inner - TOLERANCE]
        if orb is None:
            self.assertEqual(inside, [], "no row in orbs.json, so no mark")
            return
        marks = clusters(inside, MARK_RADIUS)
        self.assertEqual(len(marks), 1, "one orb mark")
        mark = marks[0]
        centre_x = sum(v[X] for v in mark) / len(mark)
        centre_z = sum(v[Z] for v in mark) / len(mark)
        self.assertNear(centre_x, orb["x"], "mark x")
        self.assertNear(centre_z, -orb["y"], "mark z, glTF z is minus y")
        widest = max(math.hypot(v[X] - centre_x, v[Z] - centre_z) for v in mark)
        self.assertNear(widest, MARK_RADIUS, "mark radius")

    @per_arena
    def test_no_inlay_stands_above_the_disc_top(self, arena, doc, bin_chunk):
        trim = node_vertices(doc, bin_chunk, "Floor")["trim"]
        above = {round(v[UP], 4) for v in trim if v[UP] > TOLERANCE}
        self.assertEqual(above, {LINE_HEIGHT, DISC_HEIGHT})

    @per_arena
    def test_every_spawn_has_one_trim_disc_centred_on_it(self, arena, doc, bin_chunk):
        spawns = arena["spawns"]["teamA"] + arena["spawns"]["teamB"]
        trim = node_vertices(doc, bin_chunk, "Floor")["trim"]
        # The ring and the mark also top out at DISC_HEIGHT, so keep only the
        # disc-sized clusters before matching them to the spawns.
        discs = [d for d in clusters(at_height(trim, DISC_HEIGHT), 0.3) if disc_sized(d)]
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
    def test_every_obstacle_vertex_sits_inside_the_footprint_and_below_the_height(self, arena, doc, bin_chunk):
        for i, ob in enumerate(arena["obstacles"]):
            (vertices,) = node_vertices(doc, bin_chunk, "Obstacle_%d" % i).values()
            for v in vertices:
                self.assertGreaterEqual(v[UP], -TOLERANCE, "obstacle %d vertex below the base" % i)
                self.assertLessEqual(v[UP], ob["height"] + TOLERANCE, "obstacle %d vertex above the height" % i)
                if ob["type"] == "rect":
                    self.assertLessEqual(abs(v[X]), ob["w"] / 2 + TOLERANCE, "obstacle %d x outside" % i)
                    self.assertLessEqual(abs(v[Z]), ob["h"] / 2 + TOLERANCE, "obstacle %d z outside" % i)
                else:
                    self.assertLessEqual(radius(v), ob["r"] + TOLERANCE, "obstacle %d radius outside" % i)
            self.assertTrue(at_height(vertices, ob["height"]), "obstacle %d has no top face at its height" % i)

    @per_arena
    def test_a_blocking_rect_is_a_wall_segment_with_an_inset_body(self, arena, doc, bin_chunk):
        for i, ob in enumerate(arena["obstacles"]):
            if ob["type"] != "rect" or not ob["blocksProjectiles"]:
                continue
            (vertices,) = node_vertices(doc, bin_chunk, "Obstacle_%d" % i).values()
            hx, hz = ob["w"] / 2, ob["h"] / 2
            full = (round(hx, 4), round(hz, 4))
            body = (round(hx - OBSTACLE_INSET, 4), round(hz - OBSTACLE_INSET, 4))
            # Base course and cap keep the full footprint; the body between
            # them is inset by OBSTACLE_INSET on both axes.
            self.assertEqual(xz_extents(vertices, 0.0), {full}, "obstacle %d base" % i)
            self.assertEqual(xz_extents(vertices, BASE_COURSE), {full, body}, "obstacle %d base course" % i)
            self.assertEqual(
                xz_extents(vertices, ob["height"] - TOP_COURSE), {body, full}, "obstacle %d cap" % i
            )
            self.assertEqual(xz_extents(vertices, ob["height"]), {full}, "obstacle %d top" % i)

    @per_arena
    def test_a_blocking_circle_is_a_column_with_a_base_ring_and_a_capital(self, arena, doc, bin_chunk):
        for i, ob in enumerate(arena["obstacles"]):
            if ob["type"] != "circle" or not ob["blocksProjectiles"]:
                continue
            (vertices,) = node_vertices(doc, bin_chunk, "Obstacle_%d" % i).values()
            r = ob["r"]
            full = round(r, 4)
            shaft = round(r - OBSTACLE_INSET, 4)
            self.assertEqual(radii_at(vertices, 0.0), {full}, "obstacle %d base" % i)
            self.assertEqual(radii_at(vertices, BASE_RING_HEIGHT), {full, shaft}, "obstacle %d base ring" % i)
            self.assertEqual(
                radii_at(vertices, ob["height"] - CAPITAL_HEIGHT), {full, shaft}, "obstacle %d capital" % i
            )
            self.assertEqual(radii_at(vertices, ob["height"]), {full}, "obstacle %d top" % i)

    @per_arena
    def test_a_non_blocking_rect_is_a_crate_with_slat_grooves(self, arena, doc, bin_chunk):
        for i, ob in enumerate(arena["obstacles"]):
            if ob["type"] != "rect" or ob["blocksProjectiles"]:
                continue
            (vertices,) = node_vertices(doc, bin_chunk, "Obstacle_%d" % i).values()
            long_axis, short_axis = (X, Z) if ob["w"] >= ob["h"] else (Z, X)
            short_half = min(ob["w"], ob["h"]) / 2
            top = at_height(vertices, ob["height"])
            self.assertTrue(top, "obstacle %d has no top face" % i)
            # The grooves are gaps of GROOVE_WIDTH in the top face's long
            # axis, so the top reads as more than one slat.
            values = sorted({round(v[long_axis], 4) for v in top})
            grooves = [b - a for a, b in zip(values, values[1:]) if abs((b - a) - GROOVE_WIDTH) <= TOLERANCE]
            self.assertTrue(grooves, "obstacle %d top has no slat groove" % i)
            # Every slat spans the short axis fully.
            lo, hi = extent(top, short_axis)
            self.assertNear(lo, -short_half, "obstacle %d slat short axis" % i)
            self.assertNear(hi, short_half, "obstacle %d slat short axis" % i)
            # The body's top, one groove deep, is the floors the gaps show.
            floor = at_height(vertices, ob["height"] - GROOVE_DEPTH)
            self.assertTrue(floor, "obstacle %d has no groove floors" % i)
            for axis, half in ((X, ob["w"] / 2), (Z, ob["h"] / 2)):
                lo, hi = extent(floor, axis)
                self.assertNear(lo, -half, "obstacle %d body floor" % i)
                self.assertNear(hi, half, "obstacle %d body floor" % i)

    @per_arena
    def test_a_non_blocking_circle_is_a_barrel_with_hoop_bands(self, arena, doc, bin_chunk):
        # No committed arena has a non-blocking circle: the barrel is the
        # fourth profile the schema allows, and this loop is empty against
        # today's data. It is written data-driven so the builder is checked
        # the moment a future arena adds one, with no edit here.
        for i, ob in enumerate(arena["obstacles"]):
            if ob["type"] != "circle" or ob["blocksProjectiles"]:
                continue
            (vertices,) = node_vertices(doc, bin_chunk, "Obstacle_%d" % i).values()
            r = ob["r"]
            full = round(r, 4)
            body = round(r - HOOP_INSET, 4)
            self.assertTrue({round(radius(v), 4) for v in vertices} <= {full, body}, "obstacle %d radius" % i)
            top = at_height(vertices, ob["height"])
            self.assertTrue(top, "obstacle %d has no top face" % i)
            self.assertNear(max(radius(v) for v in top), r, "obstacle %d top radius" % i)
            # The radius-r hoop bands start at the base and finish at the top,
            # with the narrower body bands between them.
            hoops = {round(v[UP], 4) for v in vertices if round(radius(v), 4) == full}
            self.assertIn(0.0, hoops, "obstacle %d has no base hoop" % i)
            self.assertIn(round(ob["height"], 4), hoops, "obstacle %d has no top hoop" % i)

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
