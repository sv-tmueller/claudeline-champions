"""Build an arena glb from an arena definition.

Usage: tools/blender/run.sh tools/blender/gen_arena.py -- \
    --arena data/arenas/<id>.json --out assets/models/arenas/<id>.glb

Blender XY is sim XY and Z is up. The glTF exporter turns that into the
client mapping (x, 0, -y), so no axis conversion happens here.
"""
import argparse
import json
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

COLOURS = {
    "floor": (0.30, 0.32, 0.36),
    "wall": (0.12, 0.13, 0.15),
    "blocking": (0.55, 0.28, 0.18),
    "open": (0.25, 0.50, 0.70),
}


def single_box(name, center, size, material):
    bm = bmesh.new()
    common.add_box(bm, center, size)
    return common.new_object(name, bm, [material])


def build_obstacle(index, ob, materials):
    name = "Obstacle_%d" % index
    material = materials["blocking" if ob["blocksProjectiles"] else "open"]
    height = ob["height"]
    location = (ob["x"], ob["y"], 0.0)
    # Origin at the base: the mesh runs from z = 0 up to height.
    if ob["type"] == "rect":
        bm = bmesh.new()
        common.add_box(bm, (0, 0, height / 2), (ob["w"], ob["h"], height))
    else:
        bm = bmesh.new()
        bmesh.ops.create_cone(
            bm,
            cap_ends=True,
            cap_tris=False,
            segments=32,
            radius1=ob["r"],
            radius2=ob["r"],
            depth=height,
            matrix=Matrix.Translation((0, 0, height / 2)),
        )
    return common.new_object(name, bm, [material], location)


def build_arena(arena):
    width = arena["size"]["width"]
    depth = arena["size"]["height"]  # extent along Y, not vertical
    half_w, half_d = width / 2, depth / 2
    t = WALL_THICKNESS
    materials = {key: common.make_material(key, rgb) for key, rgb in COLOURS.items()}

    # The floor top sits at z = 0.
    single_box(
        "Floor", (0, 0, -FLOOR_THICKNESS / 2), (width, depth, FLOOR_THICKNESS),
        materials["floor"],
    )
    # Inner faces sit on x = +-half_w and y = +-half_d. N and S are longer by
    # two wall thicknesses so the corners close.
    walls = {
        "Wall_N": ((0, half_d + t / 2), (width + 2 * t, t)),
        "Wall_S": ((0, -half_d - t / 2), (width + 2 * t, t)),
        "Wall_E": ((half_w + t / 2, 0), (t, depth)),
        "Wall_W": ((-half_w - t / 2, 0), (t, depth)),
    }
    for name, (xy, size) in walls.items():
        single_box(
            name, (xy[0], xy[1], WALL_HEIGHT / 2), (size[0], size[1], WALL_HEIGHT),
            materials["wall"],
        )
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
