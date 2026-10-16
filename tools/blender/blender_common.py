"""Helpers shared by the generator scripts. Runs inside Blender only."""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


def script_args():
    """Arguments after the `--` separator that run.sh passes through."""
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def clear_scene():
    """Remove the factory Cube, Light and Camera so they stay out of the glb."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)
    for armature in list(bpy.data.armatures):
        bpy.data.armatures.remove(armature)
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)


def make_material(name, rgb):
    """Flat colour. A new material already has a Principled BSDF node."""
    material = bpy.data.materials.new(name)
    assert material.name == name, "material name clash: %s" % material.name
    bsdf = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    return material


def box_matrix(center, size):
    return Matrix.Translation(center) @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))


def add_box(bm, center, size, material_index=0):
    """Add a box to `bm`. `center` and `size` are (x, y, z) tuples."""
    start = len(bm.faces)
    bmesh.ops.create_cube(bm, size=1.0, matrix=box_matrix(center, size))
    for face in list(bm.faces)[start:]:
        face.material_index = material_index


def new_object(name, bm, materials, location=(0.0, 0.0, 0.0)):
    """Turn `bm` into a linked object. Blender renames on a clash, so assert."""
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for material in materials:
        mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    assert obj.name == name, "object name clash: %s" % obj.name
    return obj


def make_rig(name, bones):
    """Build an armature object at the origin from (name, parent, head, tail).

    Every bone has roll 0 and is not connected to its parent, and `bones` lists
    a parent before its children. The names are asserted because Blender
    renames on a clash.
    """
    armature = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, armature)
    bpy.context.scene.collection.objects.link(rig)
    assert rig.name == name, "object name clash: %s" % rig.name
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for bone_name, parent, head, tail in bones:
        edit_bone = armature.edit_bones.new(bone_name)
        assert edit_bone.name == bone_name, "bone name clash: %s" % edit_bone.name
        edit_bone.head = head
        edit_bone.tail = tail
        edit_bone.roll = 0.0
        if parent is not None:
            edit_bone.parent = created[parent]
        edit_bone.use_connect = False
        created[bone_name] = edit_bone
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def weight_vertices(bm, start, group_index):
    """Give the vertices from index `start` on a weight of 1.0 in one group."""
    deform = bm.verts.layers.deform.verify()
    for vert in list(bm.verts)[start:]:
        vert[deform][group_index] = 1.0


def skin_to_rig(obj, rig, group_names):
    """Parent `obj` to `rig` through an Armature modifier, groups in order."""
    for group_name in group_names:
        group = obj.vertex_groups.new(name=group_name)
        assert group.name == group_name, "group name clash: %s" % group.name
    obj.parent = rig
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig


def local_rotation(bone, degrees):
    """The local pose quaternion for an Euler (XYZ) turn in armature space."""
    rest = bone.matrix_local.to_3x3()
    turn = Euler([math.radians(d) for d in degrees], "XYZ").to_matrix()
    return (rest.inverted() @ turn @ rest).to_quaternion()


def local_offset(bone, metres):
    """The local pose location for a move in armature space."""
    return bone.matrix_local.to_3x3().inverted() @ Vector(metres)


def set_scene_rate(fps):
    scene = bpy.context.scene
    scene.render.fps = fps
    scene.render.fps_base = 1.0


def key_clip(rig, name, frames, key_poses, loops, channels):
    """Key exactly the `channels` at every frame of the clip.

    `channels` lists (bone name, path) pairs, the path being "rotation" or
    "translation". `key_poses` maps a frame to {bone name: (Euler degrees, move
    in metres)}. A bone missing there is at rest, and a channel that is not
    listed must be at rest at every key, which is asserted: an unkeyed channel
    is exported as nothing, and the client's mixer restores it to rest. The keys
    are set to LINEAR one by one: the factory default is BEZIER, which exports
    as CUBICSPLINE, and Python's `keyframe_insert` ignores the
    `keyframe_new_interpolation_type` preference. The action is kept alive by a
    fake user and unassigned afterwards, so the export finds it by ACTIONS mode.
    """
    assert frames == max(key_poses), "the last key must be the clip length"
    assert not loops or key_poses[0] == key_poses[frames], "a loop must close"
    channels = tuple(channels)
    assert len(set(channels)) == len(channels), "a channel is listed twice"
    bone_names = [pose_bone.name for pose_bone in rig.pose.bones]
    for bone, path in channels:
        assert bone in bone_names, "no bone %s" % bone
        assert path in ("rotation", "translation"), "bad path %s" % path
        assert path == "rotation" or bone == bone_names[0], "only the root translates"
    for frame, key in key_poses.items():
        unknown = sorted(set(key) - set(bone_names))
        assert not unknown, "frame %d poses bones the rig lacks: %s" % (frame, unknown)
        for bone in bone_names:
            degrees, metres = key.get(bone, ((0, 0, 0), (0, 0, 0)))
            for path, value in (("rotation", degrees), ("translation", metres)):
                if (bone, path) not in channels:
                    assert not any(value), "%s %s moves at frame %d but is not keyed" % (
                        bone,
                        path,
                        frame,
                    )
    action = bpy.data.actions.new(name)
    assert action.name == name, "action name clash: %s" % action.name
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame in sorted(key_poses):
        for pose_bone in rig.pose.bones:
            degrees, metres = key_poses[frame].get(pose_bone.name, ((0, 0, 0), (0, 0, 0)))
            pose_bone.rotation_mode = "QUATERNION"
            if (pose_bone.name, "rotation") in channels:
                pose_bone.rotation_quaternion = local_rotation(pose_bone.bone, degrees)
                pose_bone.keyframe_insert("rotation_quaternion", frame=frame)
            if (pose_bone.name, "translation") in channels:
                pose_bone.location = local_offset(pose_bone.bone, metres)
                pose_bone.keyframe_insert("location", frame=frame)
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                for fcurve in channelbag.fcurves:
                    for point in fcurve.keyframe_points:
                        point.interpolation = "LINEAR"
    rig.animation_data.action = None
    for pose_bone in rig.pose.bones:
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)


def export_glb(out, rigged=False):
    """Write a glb. Arenas pass `rigged=False`, which keeps their exact flags.

    A rigged export sets by name every skin and animation flag of Blender
    5.2.1's exporter that bears on the output (morph and image flags aside, as
    the models have none), so a changed default in a later Blender cannot move
    the bytes without a diff here. It writes the keys as authored
    (`export_force_sampling=False`): sampling writes every frame of every
    channel and would push the models over the size budget.
    """
    path = os.path.abspath(out)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    flags = dict(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_texcoords=False,
        export_normals=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
    )
    if rigged:
        flags.update(
            export_animations=True,
            export_skins=True,
            export_animation_mode="ACTIONS",
            export_anim_single_armature=True,
            export_force_sampling=False,
            export_reset_pose_bones=True,
            export_rest_position_armature=True,
            export_def_bones=False,
            export_leaf_bone=False,
            export_armature_object_remove=False,
            export_hierarchy_flatten_bones=False,
            export_frame_range=False,
            export_anim_slide_to_zero=False,
            export_bake_animation=False,
            export_current_frame=False,
            export_influence_nb=4,
            export_all_influences=False,
            # The rest of the animation flags, at their Blender 5.2 defaults
            # except the first. Optimising would drop keyframes it thinks are
            # duplicates, which the key counts in the validator forbid.
            export_optimize_animation_size=False,
            export_optimize_animation_keep_anim_armature=True,
            export_optimize_animation_keep_anim_object=False,
            export_optimize_disable_viewport=False,
            export_frame_step=1,
            export_sampling_interpolation_fallback="LINEAR",
            export_negative_frame="SLIDE",
            export_merge_animation="ACTION",
            export_nla_strips=True,
            export_nla_strips_merged_animation_name="Animation",
            export_extra_animations=False,
            export_action_filter=False,
            export_anim_scene_split_object=True,
            export_hierarchy_flatten_objs=False,
            export_pointer_animation=False,
            export_convert_animation_pointer=False,
        )
    result = bpy.ops.export_scene.gltf(**flags)
    if result != {"FINISHED"}:
        raise RuntimeError("glTF export failed: %s" % result)
    print("wrote %s" % path)
