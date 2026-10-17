"""Build an arena glb from an arena definition.

Usage: tools/blender/run.sh tools/blender/gen_arena.py -- \
    --arena data/arenas/<id>.json --out assets/models/arenas/<id>.glb

Blender XY is sim XY and Z is up. The glTF exporter turns that into the
client mapping (x, 0, -y), so no axis conversion happens here.

The visual pass lives inside the existing nodes, so the node set is the
validator's: the Floor mesh holds a trim border, the spawn discs and the
field, and each Wall_* mesh holds the wall and its trim cap. Every added
shape is built from explicit vertices and faces (or `create_cone`, the op the
circle obstacles already use), never from an op whose face order can vary
between runs: `bmesh.ops.bevel` is not used.
"""
import argparse
import json
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of tools/blender
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
from mathutils import Matrix  # noqa: E402

import blender_common as common  # noqa: E402

FLOOR_THICKNESS = 0.2
WALL_THICKNESS = 0.5
WALL_HEIGHT = 1.0
TRIM_WIDTH = 1.0  # the floor's border, from the wall's inner face inwards
DISC_RADIUS = 0.6  # a spawn disc
DISC_HEIGHT = 0.01  # the disc stands this far above the slab top at z = 0
BEVEL = 0.08  # the chamfer on an obstacle's top edge, in both directions
CAP_HEIGHT = 0.1  # a wall's trim cap, the top of the wall height
CAP_BEVEL = 0.05  # the chamfer on a cap's two long top edges
CIRCLE_SEGMENTS = 32

COLOURS = {
    "floor": (0.30, 0.32, 0.36),
    "trim": (0.50, 0.45, 0.30),
    "wall": (0.12, 0.13, 0.15),
    "blocking": (0.55, 0.28, 0.18),
    "open": (0.25, 0.50, 0.70),
}


def add_solid(bm, points, faces, material_index=0):
    """Add a convex solid from explicit points and faces.

    Each face is a tuple of indices into `points`. A face is wound so that its
    normal points away from the solid's centre, whatever order it is listed
    in, so the sides of a prism do not each need a hand-checked winding.
    """
    verts = [bm.verts.new(point) for point in points]
    centre = [sum(point[axis] for point in points) / len(points) for axis in range(3)]
    for indices in faces:
        ring = [points[i] for i in indices]
        # Newell's normal of the polygon, and the polygon's own centre.
        normal = [0.0, 0.0, 0.0]
        for k, a in enumerate(ring):
            b = ring[(k + 1) % len(ring)]
            normal[0] += (a[1] - b[1]) * (a[2] + b[2])
            normal[1] += (a[2] - b[2]) * (a[0] + b[0])
            normal[2] += (a[0] - b[0]) * (a[1] + b[1])
        middle = [sum(v[axis] for v in ring) / len(ring) for axis in range(3)]
        outward = sum(normal[axis] * (middle[axis] - centre[axis]) for axis in range(3))
        assert outward != 0.0, "a degenerate face"
        order = indices if outward > 0 else tuple(reversed(indices))
        face = bm.faces.new([verts[i] for i in order])
        face.material_index = material_index


def ring_faces(lower, upper, count):
    """Quads between two rings of `count` points that start at `lower` and `upper`."""
    return [
        (lower + k, lower + (k + 1) % count, upper + (k + 1) % count, upper + k)
        for k in range(count)
    ]


def rect_obstacle(bm, ob):
    height = ob["height"]
    hx, hy = ob["w"] / 2, ob["h"] / 2
    # Three rings: the base, the shoulder where the chamfer starts, the top.
    rings = (
        (0.0, hx, hy),
        (height - BEVEL, hx, hy),
        (height, hx - BEVEL, hy - BEVEL),
    )
    points = []
    for z, x, y in rings:
        points += [(-x, -y, z), (x, -y, z), (x, y, z), (-x, y, z)]
    faces = [(0, 1, 2, 3), (8, 9, 10, 11)]
    faces += ring_faces(0, 4, 4) + ring_faces(4, 8, 4)
    add_solid(bm, points, faces)


def circle_obstacle(bm, ob):
    height = ob["height"]
    r = ob["r"]
    rings = ((0.0, r), (height - BEVEL, r), (height, r - BEVEL))
    n = CIRCLE_SEGMENTS
    points = []
    for z, radius in rings:
        for k in range(n):
            angle = 2 * math.pi * k / n
            points.append((radius * math.cos(angle), radius * math.sin(angle), z))
    faces = [tuple(range(n)), tuple(range(2 * n, 3 * n))]
    faces += ring_faces(0, n, n) + ring_faces(n, 2 * n, n)
    add_solid(bm, points, faces)


def build_obstacle(index, ob, materials):
    name = "Obstacle_%d" % index
    material = materials["blocking" if ob["blocksProjectiles"] else "open"]
    location = (ob["x"], ob["y"], 0.0)
    # Origin at the base: the mesh runs from z = 0 up to height, its footprint
    # unchanged and its top edge chamfered by BEVEL.
    bm = bmesh.new()
    if ob["type"] == "rect":
        rect_obstacle(bm, ob)
    else:
        circle_obstacle(bm, ob)
    return common.new_object(name, bm, [material], location)


def add_disc(bm, x, y, material_index):
    # The op may reuse the slots of faces it freed, so the new faces are not
    # always the last ones in `bm.faces`. Take them from the new vertices.
    made = bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=CIRCLE_SEGMENTS,
        radius1=DISC_RADIUS,
        radius2=DISC_RADIUS,
        depth=DISC_HEIGHT,
        matrix=Matrix.Translation((x, y, DISC_HEIGHT / 2)),
    )
    for vert in made["verts"]:
        for face in vert.link_faces:
            face.material_index = material_index


def build_floor(arena, materials):
    half_w = arena["size"]["width"] / 2
    half_d = arena["size"]["height"] / 2
    x_cuts = (-half_w, -half_w + TRIM_WIDTH, half_w - TRIM_WIDTH, half_w)
    y_cuts = (-half_d, -half_d + TRIM_WIDTH, half_d - TRIM_WIDTH, half_d)
    # A 3 by 3 grid of boxes that share whole edges: the centre cell is the
    # field, the eight around it the trim border. The union is the full slab
    # with its top at z = 0.
    bm = bmesh.new()
    for i in range(3):
        for j in range(3):
            centre = (
                (x_cuts[i] + x_cuts[i + 1]) / 2,
                (y_cuts[j] + y_cuts[j + 1]) / 2,
                -FLOOR_THICKNESS / 2,
            )
            size = (x_cuts[i + 1] - x_cuts[i], y_cuts[j + 1] - y_cuts[j], FLOOR_THICKNESS)
            common.add_box(bm, centre, size, 0 if (i, j) == (1, 1) else 1)
    # One trim disc under each spawn, teamA then teamB in JSON order. It must
    # sit wholly on the field, so it never meets the border.
    for team in ("teamA", "teamB"):
        for x, y in arena["spawns"][team]:
            assert abs(x) + DISC_RADIUS <= half_w - TRIM_WIDTH, "spawn %s disc leaves the field" % ((x, y),)
            assert abs(y) + DISC_RADIUS <= half_d - TRIM_WIDTH, "spawn %s disc leaves the field" % ((x, y),)
            add_disc(bm, x, y, 1)
    common.new_object("Floor", bm, [materials["floor"], materials["trim"]])


def build_wall(name, centre, size, materials):
    """A wall box up to the cap, and a trim cap whose long top edges are chamfered."""
    wall_top = WALL_HEIGHT - CAP_HEIGHT
    bm = bmesh.new()
    common.add_box(bm, (centre[0], centre[1], wall_top / 2), (size[0], size[1], wall_top), 0)
    # The cap is a prism along the wall's long axis with a hexagonal section
    # across its thickness: the sides rise to CAP_HEIGHT - CAP_BEVEL, then
    # chamfer in by CAP_BEVEL. Its ends are square.
    long_axis = 0 if size[0] > size[1] else 1
    across = 1 - long_axis
    half_thick = size[across] / 2
    half_long = size[long_axis] / 2
    section = (
        (-half_thick, wall_top),
        (half_thick, wall_top),
        (half_thick, WALL_HEIGHT - CAP_BEVEL),
        (half_thick - CAP_BEVEL, WALL_HEIGHT),
        (-half_thick + CAP_BEVEL, WALL_HEIGHT),
        (-half_thick, WALL_HEIGHT - CAP_BEVEL),
    )
    points = []
    for along in (-half_long, half_long):
        for offset, z in section:
            point = [0.0, 0.0, z]
            point[long_axis] = centre[long_axis] + along
            point[across] = centre[across] + offset
            points.append(tuple(point))
    count = len(section)
    faces = [tuple(range(count)), tuple(range(count, 2 * count))]
    faces += [(k, (k + 1) % count, count + (k + 1) % count, count + k) for k in range(count)]
    add_solid(bm, points, faces, 1)
    common.new_object(name, bm, [materials["wall"], materials["trim"]])


def build_arena(arena):
    width = arena["size"]["width"]
    depth = arena["size"]["height"]  # extent along Y, not vertical
    half_w, half_d = width / 2, depth / 2
    t = WALL_THICKNESS
    materials = {key: common.make_material(key, rgb) for key, rgb in COLOURS.items()}

    # The floor top sits at z = 0; the discs stand DISC_HEIGHT above it.
    build_floor(arena, materials)
    # Inner faces sit on x = +-half_w and y = +-half_d. N and S are longer by
    # two wall thicknesses so the corners close.
    walls = {
        "Wall_N": ((0, half_d + t / 2), (width + 2 * t, t)),
        "Wall_S": ((0, -half_d - t / 2), (width + 2 * t, t)),
        "Wall_E": ((half_w + t / 2, 0), (t, depth)),
        "Wall_W": ((-half_w - t / 2, 0), (t, depth)),
    }
    for name, (xy, size) in walls.items():
        build_wall(name, xy, size, materials)
    for index, ob in enumerate(arena["obstacles"]):
        build_obstacle(index, ob, materials)


def main():
    parser = argparse.ArgumentParser(prog="gen_arena.py")
    parser.add_argument("--arena", required=True, help="path to data/arenas/<id>.json")
    parser.add_argument("--out", required=True, help="path of the glb to write")
    args = parser.parse_args(common.script_args())

    with open(args.arena) as f:
        arena = json.load(f)
    common.clear_scene()
    build_arena(arena)
    common.export_glb(args.out)


main()
