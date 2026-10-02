"""Build a static low-poly champion glb.

Usage: tools/blender/run.sh tools/blender/gen_champion.py -- \
    --champion placeholder --out assets/models/champions/placeholder.glb

The ids are placeholder (the generic model), hargrim, quillon, lumeth and
skerrow. They share the placeholder's body and accent and differ only in the
body colour and one silhouette cue, listed in tools/blender/README.md.

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

ACCENT_COLOUR = (0.95, 0.65, 0.10)

# Linear Base Color per champion.
BODY_COLOURS = {
    "placeholder": (0.20, 0.35, 0.60),
    "hargrim": (0.38, 0.03, 0.02),  # crimson
    "quillon": (0.00, 0.30, 0.25),  # teal
    "lumeth": (0.30, 0.58, 0.02),  # lime
    "skerrow": (0.03, 0.03, 0.03),  # charcoal
}


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


def add_ring(bm, center, inner_radius, outer_radius, thickness, material_index, segments=16):
    """Add a flat ring around the Z axis from explicit vertices, in a fixed order.

    Like `add_sphere`, it avoids `bmesh.ops` so the vertex order never varies.
    """
    cx, cy, cz = center
    top, bottom = cz + thickness / 2, cz - thickness / 2

    def circle(radius, z):
        return [
            bm.verts.new(
                (
                    cx + radius * math.cos(2 * math.pi * j / segments),
                    cy + radius * math.sin(2 * math.pi * j / segments),
                    z,
                )
            )
            for j in range(segments)
        ]

    outer_top, outer_bottom = circle(outer_radius, top), circle(outer_radius, bottom)
    inner_top, inner_bottom = circle(inner_radius, top), circle(inner_radius, bottom)
    faces = []
    for j in range(segments):
        k = (j + 1) % segments
        faces.append((outer_top[j], outer_top[k], inner_top[k], inner_top[j]))
        faces.append((outer_bottom[j], inner_bottom[j], inner_bottom[k], outer_bottom[k]))
        faces.append((outer_top[j], outer_bottom[j], outer_bottom[k], outer_top[k]))
        faces.append((inner_top[j], inner_top[k], inner_bottom[k], inner_bottom[j]))
    for verts in faces:
        bm.faces.new(verts).material_index = material_index


def add_body(bm):
    """The shared body: about 1.7 m tall, inside a 0.5 m radius, facing +X."""
    for side in (-1, 1):
        common.add_box(bm, (0, side * 0.12, 0.4), (0.18, 0.18, 0.8), BODY)  # leg
        common.add_box(bm, (0, side * 0.34, 1.1), (0.14, 0.14, 0.6), BODY)  # arm
    common.add_box(bm, (0, 0, 1.1), (0.3, 0.5, 0.6), BODY)  # torso
    add_sphere(bm, (0, 0, 1.55), 0.15, BODY)  # head
    # The accent pieces point along +X, so the facing is readable from any side.
    common.add_box(bm, (0.17, 0, 1.15), (0.06, 0.3, 0.2), ACCENT)  # chest plate
    common.add_box(bm, (0.16, 0, 1.58), (0.1, 0.2, 0.06), ACCENT)  # visor


# Each cue is added in the body material, so the accent still marks only the front.


def add_shoulder_blocks(bm):  # hargrim, bruiser
    for side in (-1, 1):
        common.add_box(bm, (0, side * 0.34, 1.46), (0.28, 0.22, 0.14), BODY)


def add_staff(bm):  # quillon, ranged
    common.add_box(bm, (0.04, -0.44, 0.95), (0.05, 0.05, 1.80), BODY)


def add_halo(bm):  # lumeth, healer
    add_ring(bm, (0, 0, 1.80), 0.12, 0.19, 0.03, BODY)


def add_blade(bm):  # skerrow, assassin, pointing forward from the right hand
    common.add_box(bm, (0.19, -0.34, 0.86), (0.28, 0.03, 0.08), BODY)


CUES = {
    "placeholder": None,
    "hargrim": add_shoulder_blocks,
    "quillon": add_staff,
    "lumeth": add_halo,
    "skerrow": add_blade,
}


def build(champion_id):
    bm = bmesh.new()
    add_body(bm)
    if CUES[champion_id]:
        CUES[champion_id](bm)
    materials = [
        common.make_material("body", BODY_COLOURS[champion_id]),
        common.make_material("accent", ACCENT_COLOUR),
    ]
    return common.new_object("Champion", bm, materials)


def main():
    parser = argparse.ArgumentParser(prog="gen_champion.py")
    parser.add_argument("--champion", required=True, choices=sorted(CUES))
    parser.add_argument("--out", required=True, help="path of the glb to write")
    args = parser.parse_args(common.script_args())

    common.clear_scene()
    build(args.champion)
    common.export_glb(args.out)


main()
