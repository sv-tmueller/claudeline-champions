"""Build a low-poly rigged champion glb with six animation clips.

Usage: tools/blender/run.sh tools/blender/gen_champion.py -- \
    --champion placeholder --out assets/models/champions/placeholder.glb

The ids are placeholder (the generic model), hargrim, quillon, lumeth, skerrow,
ondrel, brimwick and durnhal. They share the placeholder's body and accent and differ
only in the body colour and one silhouette cue, listed in
tools/blender/README.md.

The glb holds a node `Rig` with the six bones as joints and the skinned mesh
node `Champion`. The mesh origin is at the feet and it faces +X in both Blender
and glTF, so the client can set `rotation.y = aimAngle` directly. Every part
is rigid on one bone. The clips are Idle, Run, Attack, Cast, Hit and Death,
keyed at 30 fps from the pose tables below, each on only the channels it moves.
The bones, the keys, the channels and the contract are in
docs/architecture/assets.md.
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
    "ondrel": (0.03, 0.30, 0.03),  # moss green
    "brimwick": (0.74, 0.12, 0.00),  # burnt orange
    "durnhal": (0.19, 0.18, 0.00),  # olive brass
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
# outward. Nothing is random and nothing reads a clock. A clip keys only the
# channels it moves (CLIPS lists them), so the legs and Hips of Attack, Cast and
# Hit stay unkeyed and the client's mixer restores them to rest; key_clip asserts
# that an unkeyed channel is at rest at every key.
#
# The top of the model stays at or under 1.90 m at every key and between keys,
# and no vertex is below the floor (by more than 0.1 mm), at the keys and
# between them. test_champion_models.py checks all of it, sampling every key
# interval. Between keys three lerps Hips and slerps each turn, and a rigid 0.8 m
# leg with a 0.09 m half width lifts its lowest corner by 0.8 (1 - cos a) -
# 0.09 sin |a| at leg angle a. That lift is convex in a while Hips is linear, so
# a foot planted at both ends of a key interval sinks in between, by about
# 0.1 a^2 (a in radians). Two rules keep the floor at 0:
#   R1: no key interval has a foot planted at both ends while its leg turns.
#   R2: leaving or entering a planted key, Hips rises at least as fast as the
#       foot's corner sinks. For a vertical leg that is 0.09 m per radian (the
#       corner dips 5 mm by 6.4 degrees).
# The planted keys are the Run passing keys and the rest keys. Run lifts Hips
# 0.022 m over 13 degrees (0.097 m per radian) and Death lifts it 0.035 m over
# 20 degrees (0.100 m per radian), both at least 0.09. The rig has no knee, and
# the flight phase of Run is at the splits.


def pose(turns=None, move=(0.0, 0.0, 0.0)):
    """One key: {bone: (degrees, metres)}. A bone left out stays at rest."""
    key = {bone: (degrees, (0.0, 0.0, 0.0)) for bone, degrees in (turns or {}).items()}
    key["Hips"] = (key.get("Hips", ((0.0, 0.0, 0.0),))[0], move)
    return key


# The channels a clip keys, (bone, path) pairs. assets.md's Clips table lists
# the same sets and a unit test fails if they drift apart.
UPPER = (("Spine", "rotation"), ("Arm_L", "rotation"), ("Arm_R", "rotation"))
LEGS = (("Leg_L", "rotation"), ("Leg_R", "rotation"))
HIPS_MOVE = (("Hips", "translation"),)

# Run, 20 frames at 30 fps. Eight key intervals alternate the planted passing
# key M (legs and arms at 0, Hips at 0) with the split S (legs 35 degrees, arms
# 40, Hips +0.035 m, the flight phase: the feet are 0.128 m up) and the lift-off
# L (legs 13 degrees, arms 15, Hips +0.022 m, the feet 22 mm up). The
# order is S+ L+ M L- S- L- M L+ S+, the minus keys mirroring the plus keys, and
# only M is planted, so R1 holds. R2 at M: 0.022 m over 13 degrees (0.227 rad)
# is 0.097 m per radian. Past 13 degrees the corner is at or above the floor.


def run_pose(side, leg, arm, rise):
    """A Run key. `side` is 1 when Leg_L is forward and -1 when Leg_R is."""
    turns = {
        "Spine": (0, 10, 0),
        "Leg_L": (0, side * leg, 0),
        "Leg_R": (0, -side * leg, 0),
        "Arm_L": (0, -side * arm, 0),
        "Arm_R": (0, side * arm, 0),
    }
    return pose(turns, move=(0.0, 0.0, rise))


RUN_PASS = pose({"Spine": (0, 10, 0)})
RUN = {
    0: run_pose(1, 35, 40, 0.035),
    3: run_pose(1, 13, 15, 0.022),
    5: RUN_PASS,
    7: run_pose(-1, 13, 15, 0.022),
    10: run_pose(-1, 35, 40, 0.035),
    13: run_pose(-1, 13, 15, 0.022),
    15: RUN_PASS,
    17: run_pose(1, 13, 15, 0.022),
    20: run_pose(1, 35, 40, 0.035),
}

# Attack, 12 frames (0.4 s), once, rest to rest. It is built for the first
# slot's cast: the strike at 0.133 s falls between the 0.1 s and 0.15 s windups
# of M1, and the clip ends inside the shortest M1 cooldown. The staff and the
# blade ride Arm_R, which swings from +30 to -80 degrees about Y (turned past
# about 105 degrees from hanging, it would lift Quillon's staff over 1.90 m);
# the shoulder blocks and the halo ride Spine, which yaws. Legs and Hips stay at
# rest.
ATTACK_WIND = pose({"Spine": (0, 0, -25), "Arm_R": (-10, 30, 0), "Arm_L": (0, -20, 0)})
ATTACK_STRIKE = pose({"Spine": (0, 5, 30), "Arm_R": (0, -80, 0), "Arm_L": (0, 20, 0)})

# Hit, 9 frames (0.3 s), once, rest to rest: the spine leans back and the arms
# fly outward, which lifts the staff 25 degrees outward. Legs and Hips stay at
# rest.
HIT_FLINCH = pose({"Spine": (0, -15, 0), "Arm_L": (25, 0, 0), "Arm_R": (-25, 0, 0)})

# Death. Hips turns about Y and the body jolts up at key 10 (R2), sinks at key
# 20, and lies on its back at key 30, its lowest vertex 0.6 mm above the floor.
DEATH_FALL = {10: (0, -20, 0), 20: (0, -60, 0), 30: (0, -85, 0)}
DEATH_ARMS = {10: 20, 20: 40, 30: 40}
DEATH_DROP = {10: 0.035, 20: -0.15, 30: -0.64}
DEATH_SPINE = {10: (0, -10, 0), 20: (0, 0, 0), 30: (0, 0, 0)}


def death_pose(key):
    arms = {"Arm_L": (DEATH_ARMS[key], 0, 0), "Arm_R": (-DEATH_ARMS[key], 0, 0)}
    turns = {"Hips": DEATH_FALL[key], "Spine": DEATH_SPINE[key], **arms}
    return pose(turns, move=(0.0, 0.0, DEATH_DROP[key]))


IDLE_BREATH = pose(
    {"Spine": (0, 2, 0), "Arm_L": (3, 0, 0), "Arm_R": (-3, 0, 0)}, move=(0.0, 0.0, 0.01)
)

# (name, frames, loops, {frame: key}, channels). The frames are the clip length
# at 30 fps.
CLIPS = (
    ("Idle", 60, True, {0: pose(), 30: IDLE_BREATH, 60: pose()}, UPPER + HIPS_MOVE),
    ("Run", 20, True, RUN, UPPER + LEGS + HIPS_MOVE),
    (
        "Attack",
        12,
        False,
        {0: pose(), 2: ATTACK_WIND, 4: ATTACK_STRIKE, 12: pose()},
        UPPER,
    ),
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
        UPPER,
    ),
    ("Hit", 9, False, {0: pose(), 2: HIT_FLINCH, 9: pose()}, UPPER),
    (
        "Death",
        30,
        False,
        {0: pose(), 10: death_pose(10), 20: death_pose(20), 30: death_pose(30)},
        UPPER + (("Hips", "rotation"),) + HIPS_MOVE,
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


def add_reed_bundle(bm):  # ondrel, zone controller, on the back
    carry(bm, "Spine", common.add_box, (-0.16, 0, 1.56), (0.08, 0.16, 0.52), BODY)


def add_fuse_cap(bm):  # brimwick, burst caster, on top of the head
    carry(bm, "Spine", common.add_box, (-0.02, 0, 1.74), (0.22, 0.22, 0.16), BODY)


def add_shield_and_hammer(bm):  # durnhal, guardian tank, a shield and a hammer on the arms
    # The shield is a plate 2 cm off the left arm, below the shoulder. The hammer
    # hangs from the right fist, its head 0.22 m long (a longer head sinks under
    # the floor at Death key 30) and 7 cm outside the arm so it shows from above.
    carry(bm, "Arm_L", common.add_box, (0, 0.44, 1.04), (0.30, 0.04, 0.60), BODY)
    carry(bm, "Arm_R", common.add_box, (0, -0.41, 0.60), (0.05, 0.05, 0.40), BODY)  # haft
    carry(bm, "Arm_R", common.add_box, (0, -0.41, 0.33), (0.22, 0.14, 0.14), BODY)  # head


CUES = {
    "placeholder": None,
    "hargrim": add_shoulder_blocks,
    "quillon": add_staff,
    "lumeth": add_halo,
    "skerrow": add_blade,
    "ondrel": add_reed_bundle,
    "brimwick": add_fuse_cap,
    "durnhal": add_shield_and_hammer,
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
    for name, frames, loops, keys, channels in CLIPS:
        common.key_clip(rig, name, frames, keys, loops, channels)
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
