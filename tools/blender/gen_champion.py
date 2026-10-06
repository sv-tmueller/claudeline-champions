"""Build a low-poly rigged champion glb with four animation clips.

Usage: tools/blender/run.sh tools/blender/gen_champion.py -- \
    --champion placeholder --out assets/models/champions/placeholder.glb

The ids are placeholder (the generic model), hargrim, quillon, lumeth and
skerrow. They share the placeholder's body and accent and differ only in the
body colour and one silhouette cue, listed in tools/blender/README.md.

The glb holds a node `Rig` with the six bones as joints and the skinned mesh
node `Champion`. The mesh origin is at the feet and it faces +X in both Blender
and glTF, so the client can set `rotation.y = aimAngle` directly. Every part
is rigid on one bone. The clips are Idle, Run, Cast and Death, keyed at 30 fps
from the pose tables below. The bones, the keys and the contract are in
docs/architecture/assets.md. Attack and Hit come with the client animation
state machine.
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

# The shared rig in Blender coordinates: (name, parent, head, tail). Every part
# is weight 1.0 on one bone, and the rest pose is the static geometry. L is +Y,
# the champion's left when it faces +X.
BONES = (
    ("Hips", None, (0.0, 0.0, 0.80), (0.0, 0.0, 0.90)),
    ("Spine", "Hips", (0.0, 0.0, 0.90), (0.0, 0.0, 1.70)),
    ("Arm_L", "Spine", (0.0, 0.34, 1.40), (0.0, 0.34, 0.80)),
    ("Arm_R", "Spine", (0.0, -0.34, 1.40), (0.0, -0.34, 0.80)),
    ("Leg_L", "Hips", (0.0, 0.12, 0.80), (0.0, 0.12, 0.00)),
    ("Leg_R", "Hips", (0.0, -0.12, 0.80), (0.0, -0.12, 0.00)),
)
BONE_NAMES = tuple(bone[0] for bone in BONES)

FPS = 30

# The poses are constants in armature space: an Euler XYZ turn in degrees about
# a bone's head, and for Hips also a move in metres. A positive turn about Y
# swings a hanging limb backward, and a positive turn about X lifts a left limb
# outward. Nothing is random and nothing reads a clock. At every key the top of
# the model is at or under 1.90 m (Hips moves at most 0.03 m up, and in Cast the
# arms stay at or below horizontal) and no vertex is below the floor (the Hips
# drops below). test_champion_models.py checks both at every key.


def pose(turns=None, move=(0.0, 0.0, 0.0)):
    """One key: {bone: (degrees, metres)}. A bone left out stays at rest."""
    key = {bone: (degrees, (0.0, 0.0, 0.0)) for bone, degrees in (turns or {}).items()}
    key["Hips"] = (key.get("Hips", ((0.0, 0.0, 0.0),))[0], move)
    return key


# Run. A leg of 0.8 m and a 0.09 m half width, turned 35 degrees about the hip,
# has its lowest corner 0.8 - (0.8 cos 35 + 0.09 sin 35) = 0.093 m above the
# floor, so the contact keys drop Hips by 0.093 m and the feet plant. The legs
# are straight at the passing keys and Hips is at rest.
RUN_DROP = (0.0, 0.0, -0.093)
RUN_A = pose(
    {
        "Spine": (0, 10, 0),
        "Arm_L": (0, -40, 0),
        "Arm_R": (0, 40, 0),
        "Leg_L": (0, 35, 0),
        "Leg_R": (0, -35, 0),
    },
    move=RUN_DROP,
)
RUN_PASS = pose({"Spine": (0, 10, 0)})
RUN_B = pose(
    {
        "Spine": (0, 10, 0),
        "Arm_L": (0, 40, 0),
        "Arm_R": (0, -40, 0),
        "Leg_L": (0, -35, 0),
        "Leg_R": (0, 35, 0),
    },
    move=RUN_DROP,
)

# Death. Hips turns about Y and drops so the lowest leg corner just reaches the
# floor at key 10 (0.8 - (0.8 cos 30 + 0.09 sin 30) = 0.062 m) and at key 20 (the
# same at 70 degrees, 0.442 m, rounded down to 0.44). At key 30 the body lies on
# its back.
DEATH_FALL = {10: (0, -30, 0), 20: (0, -70, 0), 30: (0, -85, 0)}
DEATH_ARMS = {10: 20, 20: 40, 30: 40}
DEATH_DROP = {10: -0.062, 20: -0.44, 30: -0.6}


def death_pose(key):
    arms = {"Arm_L": (DEATH_ARMS[key], 0, 0), "Arm_R": (-DEATH_ARMS[key], 0, 0)}
    return pose({"Hips": DEATH_FALL[key], **arms}, move=(0.0, 0.0, DEATH_DROP[key]))


IDLE_BREATH = pose(
    {"Spine": (0, 2, 0), "Arm_L": (3, 0, 0), "Arm_R": (-3, 0, 0)}, move=(0.0, 0.0, 0.01)
)

# (name, frames, loops, {frame: key}). The frames are the clip length at 30 fps.
CLIPS = (
    ("Idle", 60, True, {0: pose(), 30: IDLE_BREATH, 60: pose()}),
    ("Run", 20, True, {0: RUN_A, 5: RUN_PASS, 10: RUN_B, 15: RUN_PASS, 20: RUN_A}),
    (
        "Cast",
        15,
        False,
        {
            0: pose(),
            5: pose({"Spine": (0, -4, 0), "Arm_L": (0, -30, 0), "Arm_R": (0, -30, 0)}),
            9: pose({"Spine": (0, 6, 0), "Arm_L": (0, -85, 0), "Arm_R": (0, -85, 0)}),
            15: pose(),
        },
    ),
    (
        "Death",
        30,
        False,
        {0: pose(), 10: death_pose(10), 20: death_pose(20), 30: death_pose(30)},
    ),
)


def carry(bm, bone, build, *args):
    """Run a part builder, then give the vertices it added to `bone`."""
    start = len(bm.verts)
    build(bm, *args)
    common.weight_vertices(bm, start, BONE_NAMES.index(bone))


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
    for side, leg, arm in ((-1, "Leg_R", "Arm_R"), (1, "Leg_L", "Arm_L")):
        carry(bm, leg, common.add_box, (0, side * 0.12, 0.4), (0.18, 0.18, 0.8), BODY)
        carry(bm, arm, common.add_box, (0, side * 0.34, 1.1), (0.14, 0.14, 0.6), BODY)
    carry(bm, "Spine", common.add_box, (0, 0, 1.1), (0.3, 0.5, 0.6), BODY)  # torso
    carry(bm, "Spine", add_sphere, (0, 0, 1.55), 0.15, BODY)  # head
    # The accent pieces point along +X, so the facing is readable from any side.
    carry(bm, "Spine", common.add_box, (0.17, 0, 1.15), (0.06, 0.3, 0.2), ACCENT)  # chest plate
    carry(bm, "Spine", common.add_box, (0.16, 0, 1.58), (0.1, 0.2, 0.06), ACCENT)  # visor


# Each cue is added in the body material, so the accent still marks only the front.


def add_shoulder_blocks(bm):  # hargrim, bruiser, on the torso
    for side in (-1, 1):
        carry(bm, "Spine", common.add_box, (0, side * 0.34, 1.46), (0.28, 0.22, 0.14), BODY)


def add_staff(bm):  # quillon, ranged, in the right hand
    carry(bm, "Arm_R", common.add_box, (0.04, -0.44, 0.95), (0.07, 0.07, 1.80), BODY)


def add_halo(bm):  # lumeth, healer, on the torso
    carry(bm, "Spine", add_ring, (0, 0, 1.80), 0.12, 0.19, 0.03, BODY)


def add_blade(bm):  # skerrow, assassin, pointing forward from the right hand
    carry(bm, "Arm_R", common.add_box, (0.18, -0.34, 0.86), (0.28, 0.05, 0.10), BODY)


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
    rig = common.make_rig("Rig", BONES)
    mesh = common.new_object("Champion", bm, materials)
    common.skin_to_rig(mesh, rig, BONE_NAMES)
    common.set_scene_rate(FPS)
    for name, frames, loops, keys in CLIPS:
        common.key_clip(rig, name, frames, keys, loops)
    return rig


def main():
    parser = argparse.ArgumentParser(prog="gen_champion.py")
    parser.add_argument("--champion", required=True, choices=sorted(CUES))
    parser.add_argument("--out", required=True, help="path of the glb to write")
    args = parser.parse_args(common.script_args())

    common.clear_scene()
    build(args.champion)
    common.export_glb(args.out, rigged=True)


main()
