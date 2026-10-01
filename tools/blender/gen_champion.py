"""Build a static low-poly placeholder champion glb.

Usage: tools/blender/run.sh tools/blender/gen_champion.py -- \
    --champion placeholder --out assets/models/champions/placeholder.glb

The glb holds one mesh node named `Champion`. Its origin is at the feet and
it faces +X in both Blender and glTF, so the client can set
`rotation.y = aimAngle` directly. Rigs and animation clips come in milestone 5.
"""
import argparse
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of tools/blender
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import blender_common as common  # noqa: E402

BODY, ACCENT = 0, 1

COLOURS = [
    ("body", (0.20, 0.35, 0.60)),
    ("accent", (0.95, 0.65, 0.10)),
]


def add_sphere(bm, center, radius, material_index, u_segments=12, v_segments=8):
    """Add a UV sphere from explicit vertices and faces, in a fixed order.

    `bmesh.ops.create_uvsphere` is not used because it gave a different vertex
    order inside its faces on some runs, so the exported glb changed on every
    regenerate.
    """
    cx, cy, cz = center
    top = bm.verts.new((cx, cy, cz + radius))
    rings = []
    for i in range(1, v_segments):
        phi = math.pi * i / v_segments
        ring_radius = radius * math.sin(phi)
        z = cz + radius * math.cos(phi)
        rings.append(
            [
                bm.verts.new(
                    (
                        cx + ring_radius * math.cos(2 * math.pi * j / u_segments),
                        cy + ring_radius * math.sin(2 * math.pi * j / u_segments),
                        z,
                    )
                )
                for j in range(u_segments)
            ]
        )
    bottom = bm.verts.new((cx, cy, cz - radius))
    faces = []
    for j in range(u_segments):
        k = (j + 1) % u_segments
        faces.append((top, rings[0][j], rings[0][k]))
        for i in range(len(rings) - 1):
            upper, lower = rings[i], rings[i + 1]
            faces.append((upper[j], lower[j], lower[k], upper[k]))
        faces.append((bottom, rings[-1][k], rings[-1][j]))
    for verts in faces:
        bm.faces.new(verts).material_index = material_index


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
