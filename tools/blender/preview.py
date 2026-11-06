"""Render the committed models to PNGs for local eyeballing.

Usage: tools/blender/run.sh tools/blender/preview.py -- \
    --out /tmp/champions-preview [--champion durnhal | --arena arena01]

With no selection flag it previews every `assets/models/champions/*.glb` and
every `assets/models/arenas/*.glb`; the file stems are the ids, so a new
champion or arena needs no change here. `--out` is required and must not be
under `assets/`: the tool never writes into the asset tree.

An arena gets two views: `<id>_top.png` mirrors the client camera's fit (55
degree tilt, 40 degree vertical field of view, a 1.06 margin over the arena
corners, 16:9), and `<id>_quarter.png` is a three-quarter view that frames the
whole arena. A champion gets `<id>_rest.png` in the bind pose and one
`<id>_<clip>.png` strip per clip, each strip holding every key of that clip at
a small square resolution, stitched left to right, so a cue can be checked at
the pose that moves it.

The renders come from the Workbench engine with material colours and no lights,
so nothing about them is baked into an asset. They are for the eye only: not
byte-deterministic, never run in CI, and never a picture the client ships.
"""
import argparse
import json
import math
import os
import sys
import tempfile

sys.dont_write_bytecode = True  # keep __pycache__ out of tools/blender
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy  # noqa: E402
import blender_common as common  # noqa: E402
from mathutils import Vector  # noqa: E402

TOOLS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(TOOLS_DIR)
CHAMPIONS_DIR = os.path.join(REPO, "assets", "models", "champions")
ARENAS_DIR = os.path.join(REPO, "assets", "models", "arenas")
ARENA_DATA_DIR = os.path.join(REPO, "data", "arenas")
ASSETS_DIR = os.path.join(REPO, "assets")

# The client's camera, copied from packages/client/src/camera.ts. The fit is
# repeated here so the top view lands where the browser's camera does.
CAMERA_TILT_DEG = 55
CAMERA_VERTICAL_FOV_DEG = 40
FIT_MARGIN = 1.06

FPS = 30  # the clip rate the generators key at

ARENA_RESOLUTION = (1280, 720)
CHAMPION_RESOLUTION = (720, 720)
KEY_RESOLUTION = (360, 360)

# The free three-quarter views: off the client's south axis by 35 degrees.
QUARTER_AZIMUTH_DEG = 35
QUARTER_ELEVATION_DEG = 40

# The champion's rest/keys camera: a three-quarter view of the ~1.9 m model.
CHAMPION_AZIMUTH_DEG = 35
CHAMPION_ELEVATION_DEG = 20
CHAMPION_DISTANCE = 3.6
CHAMPION_TARGET = (0.0, 0.0, 0.9)


def parse_args():
    parser = argparse.ArgumentParser(
        prog="preview.py",
        description="Render the committed models to PNGs for local eyeballing.",
    )
    parser.add_argument("--out", required=True, help="output directory, never under assets/")
    choice = parser.add_mutually_exclusive_group()
    choice.add_argument("--champion", help="render one assets/models/champions/<id>.glb")
    choice.add_argument("--arena", help="render one assets/models/arenas/<id>.glb")
    return parser.parse_args(common.script_args())


def check_out_dir(out):
    """Refuse an --out inside the repo's assets tree, so no render is committed."""
    resolved = os.path.realpath(out)
    assets = os.path.realpath(ASSETS_DIR)
    if resolved == assets or resolved.startswith(assets + os.sep):
        raise SystemExit("--out must not be under assets/: %s" % out)


def start_scene():
    """A cleared scene set up for Workbench renders, with the clip rate faked.

    The rate is set before the import: the glTF importer converts its times in
    seconds to frames with the scene's rate, so at 30 the fcurve keys land on
    the exact frames the generators authored rather than on 24 fps fractions.
    """
    common.clear_scene()
    for camera in list(bpy.data.cameras):
        bpy.data.cameras.remove(camera)
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    return scene


def import_glb(path):
    """Import `path` with the glTF importer. Bone shapes are off: they are
    helper geometry in an excluded collection and would only pollute a render."""
    if hasattr(bpy.ops.import_scene, "gltf"):
        importer = bpy.ops.import_scene.gltf
    elif hasattr(bpy.ops.wm, "gltf_import"):
        importer = bpy.ops.wm.gltf_import
    else:
        raise RuntimeError("this Blender has no glTF importer")
    result = importer(filepath=path, disable_bone_shape=True)
    if "FINISHED" not in result:
        raise RuntimeError("glTF import failed for %s: %s" % (path, result))


def make_camera(scene):
    data = bpy.data.cameras.new("Preview")
    data.type = "PERSP"
    data.sensor_fit = "VERTICAL"
    data.angle = math.radians(CAMERA_VERTICAL_FOV_DEG)
    camera = bpy.data.objects.new("Preview", data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return camera


def place_camera(camera, location, target):
    camera.location = location
    direction = Vector(target) - Vector(location)
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def orbit(distance, azimuth_deg, elevation_deg, target):
    """A camera on a sphere around `target`. Azimuth 0 sits on the client's
    south side (-y); it swings towards +x as it grows."""
    azimuth = math.radians(azimuth_deg)
    elevation = math.radians(elevation_deg)
    return (
        target[0] + distance * math.cos(elevation) * math.sin(azimuth),
        target[1] - distance * math.cos(elevation) * math.cos(azimuth),
        target[2] + distance * math.sin(elevation),
    )


def fit_distance(half_width, half_depth, tilt_deg, aspect, margin):
    """`fitCameraDistance` of packages/client/src/camera.ts, in Python.

    The smallest distance from the origin at which every margin-expanded arena
    corner is inside the viewport of a camera tilted `tilt_deg` above the
    horizontal. Visually equivalent is enough here; this is not a bit-for-bit
    port.
    """
    tilt = math.radians(tilt_deg)
    t = math.tan(math.radians(CAMERA_VERTICAL_FOV_DEG) / 2.0)
    half_width *= margin
    half_depth *= margin
    distance = 0.0
    for sim_y in (-half_depth, half_depth):
        z = -sim_y  # simToThree(0, sim_y).z
        near_shift = z * math.cos(tilt)
        distance = max(
            distance,
            half_width / (t * aspect) + near_shift,
            abs(z) * math.sin(tilt) / t + near_shift,
        )
    return distance


def render(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        raise RuntimeError("the render wrote no file at %s" % path)
    print("wrote %s" % path)


def clip_frames(action):
    """The key frames of `action`, read from its fcurves so a moved key is
    followed rather than shadowed by a hardcoded list."""
    frames = set()
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                for fcurve in channelbag.fcurves:
                    for point in fcurve.keyframe_points:
                        frames.add(int(round(point.co[0])))
    return sorted(frames)


def reset_pose(armature):
    """Put every pose bone back at rest. A clip keys only the channels it
    moves, so a bone a previous clip left posed would otherwise stay posed."""
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        pose_bone.location = (0.0, 0.0, 0.0)
        pose_bone.scale = (1.0, 1.0, 1.0)


def stitch(paths, path):
    """Hstack rendered PNGs, left to right, into one strip image at `path`."""
    columns = []
    for source in paths:
        image = bpy.data.images.load(source)
        width, height = image.size
        pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
        columns.append(pixels.reshape(height, width, 4))
        bpy.data.images.remove(image)
    strip = numpy.concatenate(columns, axis=1)
    height, width = strip.shape[0], strip.shape[1]
    image = bpy.data.images.new("preview_strip", width=width, height=height, alpha=True)
    image.pixels.foreach_set(numpy.ascontiguousarray(strip).ravel())
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        raise RuntimeError("the strip wrote no file at %s" % path)
    print("wrote %s" % path)


def solo_camera(scene, resolution, location, target):
    camera = make_camera(scene)
    scene.render.resolution_x, scene.render.resolution_y = resolution
    place_camera(camera, location, target)


def render_arena(scene, arena_id, out_dir):
    definition = os.path.join(ARENA_DATA_DIR, "%s.json" % arena_id)
    with open(definition, encoding="utf-8") as handle:
        size = json.load(handle)["size"]
    half_width = size["width"] / 2.0
    half_depth = size["height"] / 2.0
    aspect = ARENA_RESOLUTION[0] / ARENA_RESOLUTION[1]

    import_glb(os.path.join(ARENAS_DIR, "%s.glb" % arena_id))

    tilt = math.radians(CAMERA_TILT_DEG)
    distance = fit_distance(half_width, half_depth, CAMERA_TILT_DEG, aspect, FIT_MARGIN)
    solo_camera(
        scene,
        ARENA_RESOLUTION,
        (0.0, -distance * math.cos(tilt), distance * math.sin(tilt)),
        (0.0, 0.0, 0.0),
    )
    render(scene, os.path.join(out_dir, "%s_top.png" % arena_id))

    # The diagonal is the widest thing a corner view can see, so fitting it at
    # the quarter view's own tilt frames the arena from any azimuth.
    diagonal = math.hypot(half_width, half_depth)
    quarter = fit_distance(diagonal, diagonal, QUARTER_ELEVATION_DEG, aspect, FIT_MARGIN)
    solo_camera(
        scene,
        ARENA_RESOLUTION,
        orbit(quarter, QUARTER_AZIMUTH_DEG, QUARTER_ELEVATION_DEG, (0.0, 0.0, 0.0)),
        (0.0, 0.0, 0.0),
    )
    render(scene, os.path.join(out_dir, "%s_quarter.png" % arena_id))


def render_champion(scene, champion_id, out_dir):
    import_glb(os.path.join(CHAMPIONS_DIR, "%s.glb" % champion_id))
    armature = next((obj for obj in bpy.data.objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise RuntimeError("%s has no armature" % champion_id)

    camera_location = orbit(
        CHAMPION_DISTANCE, CHAMPION_AZIMUTH_DEG, CHAMPION_ELEVATION_DEG, CHAMPION_TARGET
    )
    solo_camera(scene, CHAMPION_RESOLUTION, camera_location, CHAMPION_TARGET)

    # The rest render comes first, so the bind pose is what the import left.
    if armature.animation_data is not None:
        armature.animation_data.action = None
    reset_pose(armature)
    render(scene, os.path.join(out_dir, "%s_rest.png" % champion_id))

    scene.render.resolution_x, scene.render.resolution_y = KEY_RESOLUTION
    with tempfile.TemporaryDirectory() as keys_dir:
        for action in sorted(bpy.data.actions, key=lambda item: item.name):
            frames = clip_frames(action)
            if not frames:
                raise RuntimeError("%s clip %s has no keys" % (champion_id, action.name))
            armature.animation_data.action = action
            reset_pose(armature)
            paths = []
            for frame in frames:
                scene.frame_set(frame)
                path = os.path.join(keys_dir, "%s_%04d.png" % (action.name.lower(), frame))
                render(scene, path)
                paths.append(path)
            stitch(paths, os.path.join(out_dir, "%s_%s.png" % (champion_id, action.name.lower())))
    armature.animation_data.action = None


def select_models(args):
    """The (kind, id) pairs to render, from the flags or from the glb stems."""
    if args.champion:
        return [("champion", args.champion)]
    if args.arena:
        return [("arena", args.arena)]
    pairs = [("arena", path[:-4]) for path in sorted(os.listdir(ARENAS_DIR)) if path.endswith(".glb")]
    pairs += [
        ("champion", path[:-4])
        for path in sorted(os.listdir(CHAMPIONS_DIR))
        if path.endswith(".glb")
    ]
    if not pairs:
        raise SystemExit("no glb under assets/models to preview")
    return pairs


def main():
    args = parse_args()
    check_out_dir(args.out)
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)
    for kind, model_id in select_models(args):
        scene = start_scene()
        if kind == "arena":
            render_arena(scene, model_id, out_dir)
        else:
            render_champion(scene, model_id, out_dir)


if __name__ == "__main__":
    main()
