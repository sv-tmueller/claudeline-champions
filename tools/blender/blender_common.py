"""Helpers shared by the generator scripts. Runs inside Blender only."""
import os
import sys

import bmesh
import bpy
from mathutils import Matrix


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


def export_glb(out):
    path = os.path.abspath(out)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    result = bpy.ops.export_scene.gltf(
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
    if result != {"FINISHED"}:
        raise RuntimeError("glTF export failed: %s" % result)
    print("wrote %s" % path)
