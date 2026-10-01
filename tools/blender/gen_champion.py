"""Build a static low-poly placeholder champion glb.

Usage: tools/blender/run.sh tools/blender/gen_champion.py -- \
    --champion placeholder --out assets/models/champions/placeholder.glb

The glb holds one mesh node named `Champion`. Its origin is at the feet and
it faces +X in both Blender and glTF, so the client can set
`rotation.y = aimAngle` directly. Rigs and animation clips come in milestone 5.
"""
import argparse
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of tools/blender
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
from mathutils import Matrix  # noqa: E402

import blender_common as common  # noqa: E402

BODY, ACCENT = 0, 1

COLOURS = [
    ("body", (0.20, 0.35, 0.60)),
    ("accent", (0.95, 0.65, 0.10)),
]


def add_sphere(bm, center, radius, material_index):
    start = len(bm.faces)
    bmesh.ops.create_uvsphere(
        bm,
        u_segments=12,
        v_segments=8,
        radius=radius,
        matrix=Matrix.Translation(center),
    )
    for face in list(bm.faces)[start:]:
        face.material_index = material_index


def build_placeholder():
    """About 1.7 m tall, inside a 0.5 m radius, facing +X."""
    bm = bmesh.new()
    for side in (-1, 1):
        common.add_box(bm, (0, side * 0.12, 0.4), (0.18, 0.18, 0.8), BODY)  # leg
        common.add_box(bm, (0, side * 0.34, 1.1), (0.14, 0.14, 0.6), BODY)  # arm
    common.add_box(bm, (0, 0, 1.1), (0.3, 0.5, 0.6), BODY)  # torso
    add_sphere(bm, (0, 0, 1.55), 0.15, BODY)  # head
    # The accent pieces point along +X, so the facing is readable from any side.
    common.add_box(bm, (0.17, 0, 1.15), (0.06, 0.3, 0.2), ACCENT)  # chest plate
    common.add_box(bm, (0.16, 0, 1.58), (0.1, 0.2, 0.06), ACCENT)  # visor
    materials = [common.make_material(name, rgb) for name, rgb in COLOURS]
    return common.new_object("Champion", bm, materials)


BUILDERS = {"placeholder": build_placeholder}


def main():
    parser = argparse.ArgumentParser(prog="gen_champion.py")
    parser.add_argument("--champion", required=True, choices=sorted(BUILDERS))
    parser.add_argument("--out", required=True, help="path of the glb to write")
    args = parser.parse_args(common.script_args())

    common.clear_scene()
    BUILDERS[args.champion]()
    common.export_glb(args.out)


main()
