"""Tests for validate_glb.py.

Most tests build small glbs in memory, so they run without Blender. The tests
that read the committed models need `assets/models` to be generated first.
"""
import contextlib
import io
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import validate_glb

REPO = Path(__file__).resolve().parents[2]
ARENA_IDS = ("arena01", "arena02")
ARENAS_DIR = REPO / "assets" / "models" / "arenas"
ARENA_GLB = ARENAS_DIR / "arena01.glb"
CHAMPIONS_DIR = REPO / "assets" / "models" / "champions"

CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def load_arena(arena_id="arena01"):
    with open(REPO / "data" / "arenas" / ("%s.json" % arena_id)) as f:
        return json.load(f)


def pack_glb(doc, binary=None, magic=b"glTF", version=2, pad=True):
    """Build glb bytes. With pad=False the JSON chunk is left misaligned."""
    body = json.dumps(doc).encode()
    if pad:
        body += b" " * (-len(body) % 4)
    chunks = struct.pack("<II", len(body), CHUNK_JSON) + body
    if binary is not None:
        chunks += struct.pack("<II", len(binary), CHUNK_BIN) + binary
    return magic + struct.pack("<II", version, 12 + len(chunks)) + chunks


def arena_doc(arena, extra_nodes=(), drop=(), rename=None, animations=False):
    """A glTF document shaped like what gen_arena.py exports."""
    nodes = [
        {"name": "Floor", "mesh": 0},
        {"name": "Wall_N", "mesh": 0},
        {"name": "Wall_S", "mesh": 0},
        {"name": "Wall_E", "mesh": 0},
        {"name": "Wall_W", "mesh": 0},
    ]
    for i, ob in enumerate(arena["obstacles"]):
        nodes.append(
            {
                "name": "Obstacle_%d" % i,
                "mesh": 0,
                "translation": [ob["x"], 0, -ob["y"]],
            }
        )
    nodes = [n for n in nodes if n["name"] not in drop]
    if rename:
        for n in nodes:
            n["name"] = rename.get(n["name"], n["name"])
    nodes.extend(extra_nodes)
    doc = {
        "asset": {"version": "2.0", "generator": "test"},
        "scene": 0,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "nodes": nodes,
        "meshes": [{"primitives": []}],
    }
    if animations:
        doc["animations"] = [{"channels": [], "samplers": []}]
    return doc


# The rig and the clips, written out here on purpose: the validator's own
# constants and the tables in assets.md must both agree with these.
RIG_PARENTS = {
    "Hips": "Rig",
    "Spine": "Hips",
    "Arm_L": "Spine",
    "Arm_R": "Spine",
    "Leg_L": "Hips",
    "Leg_R": "Hips",
}
CLIP_TABLE = {"Idle": (60, 3), "Run": (20, 5), "Cast": (15, 4), "Death": (30, 4)}


def rigged_champion_doc(name="Champion"):
    """A glTF document shaped like what gen_champion.py exports, without data.

    Nodes: the six joints, the skinned mesh `Champion` and `Rig`, whose
    children are the mesh and Hips. Accessor 0 is the inverse bind matrices,
    1 to 3 are the Champion primitive's attributes, and every clip adds one
    input accessor, with a sampler per channel: a rotation for every joint and
    a translation for Hips.
    """
    joints = list(RIG_PARENTS)
    nodes = [{"name": joint} for joint in joints]
    index = {joint: i for i, joint in enumerate(joints)}
    for joint, parent in RIG_PARENTS.items():
        if parent != "Rig":
            nodes[index[parent]].setdefault("children", []).append(index[joint])
    nodes.append({"name": name, "mesh": 0, "skin": 0})
    nodes.append({"name": "Rig", "children": [len(nodes) - 1, index["Hips"]]})
    accessors = [
        {"componentType": 5126, "type": "MAT4", "count": len(joints)},
        {"componentType": 5126, "type": "VEC3", "count": 8},
        {"componentType": 5121, "type": "VEC4", "count": 8},
        {"componentType": 5126, "type": "VEC4", "count": 8},
    ]
    animations = []
    for clip, (frames, keys) in CLIP_TABLE.items():
        accessors.append(
            {
                "componentType": 5126,
                "type": "SCALAR",
                "count": keys,
                "min": [0],
                "max": [frames / 30],
            }
        )
        targets = [(index[j], "rotation") for j in joints] + [(index["Hips"], "translation")]
        animations.append(
            {
                "name": clip,
                "samplers": [
                    {"input": len(accessors) - 1, "interpolation": "LINEAR", "output": 1}
                    for _ in targets
                ],
                "channels": [
                    {"sampler": i, "target": {"node": node, "path": path}}
                    for i, (node, path) in enumerate(targets)
                ],
            }
        )
    return {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [len(nodes) - 1]}],
        "nodes": nodes,
        "meshes": [
            {"primitives": [{"attributes": {"POSITION": 1, "JOINTS_0": 2, "WEIGHTS_0": 3}}]}
        ],
        "skins": [{"inverseBindMatrices": 0, "joints": [index[j] for j in joints]}],
        "accessors": accessors,
        "animations": animations,
    }


class ValidatorCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)

    def write(self, category, name, data):
        folder = self.tmp / category
        folder.mkdir(exist_ok=True)
        path = folder / name
        path.write_bytes(data)
        return path

    def arena_glb(self, data, arena_id="arena01"):
        return self.write("arenas", "%s.glb" % arena_id, data)

    def assertRejected(self, path, reason):
        message = validate_glb.validate_file(path)
        self.assertIsNotNone(message, "validator accepted a bad file")
        self.assertIn(reason, message)


class StructureTests(ValidatorCase):
    def test_synthetic_arena_passes(self):
        for arena_id in ARENA_IDS:
            with self.subTest(arena=arena_id):
                path = self.arena_glb(pack_glb(arena_doc(load_arena(arena_id))), arena_id)
                self.assertIsNone(validate_glb.validate_file(path))

    def test_bin_chunk_is_accepted(self):
        path = self.arena_glb(pack_glb(arena_doc(load_arena()), binary=b"\0" * 8))
        self.assertIsNone(validate_glb.validate_file(path))

    def test_rejects_bad_magic(self):
        data = pack_glb(arena_doc(load_arena()), magic=b"glTX")
        self.assertRejected(self.arena_glb(data), "magic")

    def test_rejects_version_1(self):
        data = pack_glb(arena_doc(load_arena()), version=1)
        self.assertRejected(self.arena_glb(data), "version")

    def test_rejects_misaligned_chunk(self):
        doc = arena_doc(load_arena())
        doc["asset"]["generator"] = "x"
        # Pick a generator string that leaves the JSON length at 3 mod 4.
        while len(json.dumps(doc)) % 4 != 3:
            doc["asset"]["generator"] += "x"
        data = pack_glb(doc, pad=False)
        self.assertRejected(self.arena_glb(data), "multiple of 4")

    def test_rejects_trailing_bytes_after_chunks(self):
        data = pack_glb(arena_doc(load_arena()))
        # Fix the header length so only the chunk walk can notice.
        extra = b"\0\0\0\0"
        data = data[:8] + struct.pack("<I", len(data) + 4) + data[12:] + extra
        self.assertRejected(self.arena_glb(data), "chunk")

    def test_rejects_non_json_first_chunk(self):
        body = b"{}  "
        chunk = struct.pack("<II", len(body), CHUNK_BIN) + body
        data = b"glTF" + struct.pack("<II", 2, 12 + len(chunk)) + chunk
        self.assertRejected(self.arena_glb(data), "JSON")

    def test_rejects_invalid_json(self):
        body = b"{nope   "
        chunk = struct.pack("<II", len(body), CHUNK_JSON) + body
        data = b"glTF" + struct.pack("<II", 2, 12 + len(chunk)) + chunk
        self.assertRejected(self.arena_glb(data), "JSON")

    def test_rejects_asset_version_other_than_2_0(self):
        doc = arena_doc(load_arena())
        doc["asset"]["version"] = "1.0"
        self.assertRejected(self.arena_glb(pack_glb(doc)), "asset.version")

    def test_rejects_flat_colour_violations(self):
        for key in ("animations", "skins", "textures", "images"):
            doc = arena_doc(load_arena())
            doc[key] = [{}]
            with self.subTest(key=key):
                self.assertRejected(self.arena_glb(pack_glb(doc)), key)

    def test_rejects_unknown_category(self):
        path = self.write("props", "crate.glb", pack_glb(rigged_champion_doc()))
        self.assertRejected(path, "unknown category")


class TruncationTests(ValidatorCase):
    def committed_bytes(self):
        return ARENA_GLB.read_bytes()

    def test_rejects_file_cut_at_10_bytes(self):
        path = self.arena_glb(self.committed_bytes()[:10])
        self.assertRejected(path, "too short")

    def test_rejects_file_cut_at_half_length(self):
        data = self.committed_bytes()
        path = self.arena_glb(data[: len(data) // 2])
        self.assertRejected(path, "length")

    def test_rejects_file_missing_last_byte(self):
        path = self.arena_glb(self.committed_bytes()[:-1])
        self.assertRejected(path, "length")


class ArenaNodeTests(ValidatorCase):
    def test_rejects_renamed_wall(self):
        doc = arena_doc(load_arena(), rename={"Wall_N": "Wall_X"})
        message = validate_glb.validate_file(self.arena_glb(pack_glb(doc)))
        self.assertIsNotNone(message)
        self.assertIn("Wall_N", message)
        self.assertIn("Wall_X", message)

    def test_rejects_extra_obstacle(self):
        arena = load_arena()
        extra = [{"name": "Obstacle_%d" % len(arena["obstacles"]), "mesh": 0}]
        doc = arena_doc(arena, extra_nodes=extra)
        path = self.arena_glb(pack_glb(doc))
        self.assertRejected(path, "Obstacle_%d" % len(arena["obstacles"]))

    def test_rejects_missing_obstacle(self):
        arena = load_arena()
        last = "Obstacle_%d" % (len(arena["obstacles"]) - 1)
        doc = arena_doc(arena, drop=(last,))
        self.assertRejected(self.arena_glb(pack_glb(doc)), last)

    def test_rejects_duplicate_node_name(self):
        doc = arena_doc(load_arena(), extra_nodes=[{"name": "Floor", "mesh": 0}])
        self.assertRejected(self.arena_glb(pack_glb(doc)), "duplicate")

    def test_rejects_obstacle_translation_that_disagrees_with_json(self):
        # Obstacle_7 has y = 7 in arena01 and y = -7.5 in arena02, so the z flip changes both.
        def flip_z(translation):
            translation[2] = -translation[2]  # sim y maps to z = -y

        def shift_x(translation):
            translation[0] += 1  # the JSON x moved by a metre

        for arena_id in ARENA_IDS:
            for label, change in (("z flipped", flip_z), ("x shifted", shift_x)):
                with self.subTest(arena=arena_id, change=label):
                    doc = arena_doc(load_arena(arena_id))
                    for node in doc["nodes"]:
                        if node["name"] == "Obstacle_7":
                            change(node["translation"])
                    self.assertRejected(self.arena_glb(pack_glb(doc), arena_id), "does not match")

    def test_rejects_malformed_nodes_and_translations(self):
        def with_node(extra):
            return arena_doc(load_arena(), extra_nodes=[extra])

        def with_bad_nodes_value(value):
            doc = arena_doc(load_arena())
            doc["nodes"] = value
            return doc

        def with_translation(index, value):
            doc = arena_doc(load_arena())
            for node in doc["nodes"]:
                if node["name"] == "Obstacle_%d" % index:
                    node["translation"] = value
            return doc

        cases = {
            "non-dict node": (with_node(5), "must be an object"),
            "list name": (with_node({"name": ["Floor"], "mesh": 0}), "name must be a string"),
            "nodes is a dict": (with_bad_nodes_value({"a": 1}), "nodes must be a list"),
            "nodes is null": (with_bad_nodes_value(None), "nodes must be a list"),
            "string component": (with_translation(1, ["-8", 0, 0]), "translation must be"),
            "scalar translation": (with_translation(1, 5), "translation must be"),
            "two components": (with_translation(1, [-8, 0]), "translation must be"),
            "nan component": (with_translation(1, [float("nan"), 0, 0]), "translation must be"),
            "bool components": (with_translation(0, [False, 0, False]), "translation must be"),
            "huge int component": (with_translation(1, [10**400, 0, 0]), "translation must be"),
        }
        for label, (doc, reason) in cases.items():
            with self.subTest(case=label):
                self.assertRejected(self.arena_glb(pack_glb(doc)), reason)

    def test_missing_translation_counts_as_zero(self):
        doc = arena_doc(load_arena())
        for node in doc["nodes"]:
            if node["name"] == "Obstacle_0":  # the pillar sits at (0, 0)
                del node["translation"]
        self.assertIsNone(validate_glb.validate_file(self.arena_glb(pack_glb(doc))))

    def test_rejects_arena_without_matching_json(self):
        path = self.write("arenas", "arena99.glb", pack_glb(arena_doc(load_arena())))
        self.assertRejected(path, "arena99.json")


class ChampionTests(ValidatorCase):
    def champion_glb(self, doc):
        return self.write("champions", "p.glb", pack_glb(doc))

    def test_rigged_champion_passes(self):
        path = self.champion_glb(rigged_champion_doc())
        self.assertIsNone(validate_glb.validate_file(path))

    def test_rejects_champion_without_champion_node(self):
        path = self.champion_glb(rigged_champion_doc("Body"))
        self.assertRejected(path, "Champion")

    def test_rejects_non_dict_node(self):
        doc = rigged_champion_doc()
        doc["nodes"].insert(0, 5)
        self.assertRejected(self.champion_glb(doc), "nodes[0] must be an object")

    def test_rejects_unhashable_node_name(self):
        doc = rigged_champion_doc()
        doc["nodes"].insert(0, {"name": ["x"]})
        self.assertRejected(self.champion_glb(doc), "nodes[0].name must be a string")

    def test_rejects_textures_and_images(self):
        for key in ("textures", "images"):
            doc = rigged_champion_doc()
            doc[key] = [{}]
            with self.subTest(key=key):
                self.assertRejected(self.champion_glb(doc), key)

    def test_arena_glbs_still_reject_skins_and_animations(self):
        for key in ("skins", "animations"):
            doc = arena_doc(load_arena())
            doc[key] = rigged_champion_doc()[key]
            with self.subTest(key=key):
                self.assertRejected(self.arena_glb(pack_glb(doc)), key)


def node_named(doc, name):
    return next(n for n in doc["nodes"] if n["name"] == name)


def joint_index(doc, name):
    return doc["nodes"].index(node_named(doc, name))


class RigRuleTests(ValidatorCase):
    """One rejection per rule of the rig and the clips, against the synthetic document."""

    def rejects(self, mutate, reason):
        doc = rigged_champion_doc()
        mutate(doc)
        self.assertRejected(self.write("champions", "p.glb", pack_glb(doc)), reason)

    def test_rejects_a_champion_without_a_skin(self):
        self.rejects(lambda d: node_named(d, "Champion").pop("skin"), "skin")

    def test_rejects_a_champion_without_a_mesh(self):
        self.rejects(lambda d: node_named(d, "Champion").pop("mesh"), "mesh")

    def test_rejects_two_skins(self):
        self.rejects(lambda d: d["skins"].append(dict(d["skins"][0])), "exactly one skin")

    def test_rejects_a_renamed_bone(self):
        self.rejects(lambda d: node_named(d, "Spine").update(name="Torso"), "joints")

    def test_rejects_a_missing_bone(self):
        self.rejects(lambda d: d["skins"][0]["joints"].pop(), "joints")

    def test_rejects_an_extra_bone(self):
        def mutate(d):
            d["nodes"].append({"name": "Tail"})
            d["skins"][0]["joints"].append(len(d["nodes"]) - 1)

        self.rejects(mutate, "joints")

    def test_rejects_a_duplicate_joint(self):
        def mutate(d):
            joints = d["skins"][0]["joints"]
            joints.append(joints[0])

        self.rejects(mutate, "joints")

    def test_rejects_a_bone_with_the_wrong_parent(self):
        def mutate(d):
            node_named(d, "Spine")["children"].remove(joint_index(d, "Arm_L"))
            node_named(d, "Hips")["children"].append(joint_index(d, "Arm_L"))

        self.rejects(mutate, "Arm_L")

    def test_rejects_hips_that_is_not_under_rig(self):
        def mutate(d):
            node_named(d, "Rig")["children"].remove(joint_index(d, "Hips"))

        self.rejects(mutate, "Hips")

    def test_rejects_a_skin_without_inverse_bind_matrices(self):
        self.rejects(lambda d: d["skins"][0].pop("inverseBindMatrices"), "inverseBindMatrices")

    def test_rejects_inverse_bind_matrices_of_the_wrong_count(self):
        self.rejects(lambda d: d["accessors"][0].update(count=5), "inverseBindMatrices")

    def test_rejects_inverse_bind_matrices_of_the_wrong_type(self):
        self.rejects(lambda d: d["accessors"][0].update(type="MAT3"), "inverseBindMatrices")

    def test_rejects_inverse_bind_matrices_that_are_not_float(self):
        self.rejects(lambda d: d["accessors"][0].update(componentType=5123), "inverseBindMatrices")

    def test_rejects_a_primitive_without_joints_or_weights(self):
        for attribute in ("JOINTS_0", "WEIGHTS_0"):
            with self.subTest(attribute=attribute):
                self.rejects(
                    lambda d: d["meshes"][0]["primitives"][0]["attributes"].pop(attribute),
                    attribute,
                )

    def test_rejects_a_missing_clip(self):
        self.rejects(lambda d: d["animations"].pop(), "animations")

    def test_rejects_an_extra_clip(self):
        def mutate(d):
            d["animations"].append(dict(d["animations"][0], name="Dance"))

        self.rejects(mutate, "animations")

    def test_rejects_a_renamed_clip(self):
        self.rejects(lambda d: d["animations"][1].update(name="Walk"), "animations")

    def test_rejects_a_duplicate_clip(self):
        self.rejects(lambda d: d["animations"].append(dict(d["animations"][0])), "animations")

    def test_rejects_a_clip_one_frame_too_long(self):
        def mutate(d):
            run = next(a for a in d["animations"] if a["name"] == "Run")
            accessor = d["accessors"][run["samplers"][0]["input"]]
            accessor["max"] = [21 / 30]

        self.rejects(mutate, "Run")

    def test_rejects_a_clip_that_does_not_start_at_zero(self):
        def mutate(d):
            idle = next(a for a in d["animations"] if a["name"] == "Idle")
            d["accessors"][idle["samplers"][0]["input"]]["min"] = [1 / 30]

        self.rejects(mutate, "Idle")

    def test_rejects_channels_that_do_not_share_their_key_times(self):
        def mutate(d):
            cast = next(a for a in d["animations"] if a["name"] == "Cast")
            shifted = dict(d["accessors"][cast["samplers"][0]["input"]])
            d["accessors"].append(shifted)
            cast["samplers"][2]["input"] = len(d["accessors"]) - 1

        self.rejects(mutate, "share")

    def test_rejects_a_key_count_that_is_off(self):
        def mutate(d):
            cast = next(a for a in d["animations"] if a["name"] == "Cast")
            d["accessors"][cast["samplers"][0]["input"]]["count"] = 3

        self.rejects(mutate, "Cast")

    def test_rejects_a_channel_that_targets_the_champion(self):
        def mutate(d):
            channel = d["animations"][0]["channels"][0]
            channel["target"]["node"] = d["nodes"].index(node_named(d, "Champion"))

        self.rejects(mutate, "joints")

    def test_rejects_a_channel_that_scales(self):
        def mutate(d):
            d["animations"][0]["channels"][0]["target"]["path"] = "scale"

        self.rejects(mutate, "path")

    def test_rejects_cubic_spline_interpolation(self):
        def mutate(d):
            d["animations"][2]["samplers"][3]["interpolation"] = "CUBICSPLINE"

        self.rejects(mutate, "LINEAR")

    def test_rejects_step_interpolation(self):
        def mutate(d):
            d["animations"][2]["samplers"][3]["interpolation"] = "STEP"

        self.rejects(mutate, "LINEAR")

    def test_rejects_a_joint_without_a_rotation_channel(self):
        def mutate(d):
            arm = joint_index(d, "Arm_R")
            for animation in d["animations"]:
                animation["channels"] = [
                    c
                    for c in animation["channels"]
                    if not (c["target"]["node"] == arm and c["target"]["path"] == "rotation")
                ]

        self.rejects(mutate, "Arm_R")

    def test_rejects_hips_without_a_translation_channel(self):
        def mutate(d):
            hips = joint_index(d, "Hips")
            d["animations"][3]["channels"] = [
                c
                for c in d["animations"][3]["channels"]
                if not (c["target"]["node"] == hips and c["target"]["path"] == "translation")
            ]

        self.rejects(mutate, "translation")

    def test_rejects_a_sampler_that_does_not_exist(self):
        def mutate(d):
            d["animations"][0]["channels"][0]["sampler"] = 99

        self.rejects(mutate, "sampler")

    def test_a_malformed_document_fails_with_a_reason_not_a_crash(self):
        for label, mutate in {
            "skins is not a list": lambda d: d.update(skins=5),
            "no accessors": lambda d: d.pop("accessors"),
            "animation is not an object": lambda d: d["animations"].__setitem__(0, 7),
            "no meshes": lambda d: d.pop("meshes"),
        }.items():
            doc = rigged_champion_doc()
            mutate(doc)
            path = self.write("champions", "p.glb", pack_glb(doc))
            with self.subTest(case=label):
                message = validate_glb.validate_file(path)
                self.assertIsNotNone(message)
                self.assertNotIn("validator error", message)


ASSETS_MD = REPO / "docs" / "architecture" / "assets.md"


def table_rows(text, header):
    """The cells of each body row of the markdown table whose header row starts with `header`."""
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(header))
    rows = []
    for line in lines[start + 2 :]:
        if not line.startswith("|"):
            break
        rows.append([cell.strip().strip("`") for cell in line.strip().strip("|").split("|")])
    return rows


class ContractDriftTests(unittest.TestCase):
    """assets.md's rig and clip tables and the validator's constants must agree."""

    def setUp(self):
        self.text = ASSETS_MD.read_text()

    def test_the_rig_table_matches_the_validator_constant(self):
        rows = table_rows(self.text, "| Bone | Parent |")
        parents = {row[0]: row[1].replace("node ", "").strip("`") for row in rows}
        self.assertEqual(parents, validate_glb.RIG)
        self.assertEqual(list(parents), list(validate_glb.RIG))

    def test_the_clip_table_matches_the_validator_constant(self):
        rows = table_rows(self.text, "| Clip | Frames |")
        clips = {row[0]: (int(row[1]), len(row[3].split(","))) for row in rows}
        self.assertEqual(clips, validate_glb.CLIPS)
        for row in rows:
            self.assertAlmostEqual(float(row[2]), int(row[1]) / validate_glb.FPS, places=3)
            keys = [int(k) for k in row[3].split(",")]
            self.assertEqual((keys[0], keys[-1]), (0, int(row[1])))

    def test_the_validator_constants_match_the_tests_literals(self):
        self.assertEqual(validate_glb.RIG, RIG_PARENTS)
        self.assertEqual(validate_glb.CLIPS, CLIP_TABLE)
        self.assertEqual(validate_glb.FPS, 30)


class ArenaJsonTests(unittest.TestCase):
    def check(self, mutate):
        arena = load_arena()
        mutate(arena)
        return validate_glb.validate_arena_json(arena, "arena01")

    def assertJsonRejected(self, mutate, reason):
        message = self.check(mutate)
        self.assertIsNotNone(message, "validator accepted a bad arena")
        self.assertIn(reason, message)

    def test_committed_arena_jsons_pass(self):
        for arena_id in ARENA_IDS:
            with self.subTest(arena=arena_id):
                self.assertIsNone(validate_glb.validate_arena_json(load_arena(arena_id), arena_id))

    def test_rejects_id_that_differs_from_file_name(self):
        arena = load_arena()
        message = validate_glb.validate_arena_json(arena, "arena02")
        self.assertIn("id", message)

    def test_rejects_asymmetric_obstacles(self):
        def mutate(a):
            a["obstacles"][2]["x"] = 7.5

        self.assertJsonRejected(mutate, "symmetr")

    def test_rejects_obstacle_with_different_height_than_its_mirror(self):
        def mutate(a):
            a["obstacles"][2]["height"] = 1.6

        self.assertJsonRejected(mutate, "symmetr")

    def test_rejects_asymmetric_spawns(self):
        def mutate(a):
            a["spawns"]["teamB"][0] = [12, 1]

        self.assertJsonRejected(mutate, "symmetr")

    def test_rejects_missing_key(self):
        self.assertJsonRejected(lambda a: a.pop("ring"), "ring")

    def test_rejects_extra_top_level_key(self):
        def mutate(a):
            a["colour"] = "red"

        self.assertJsonRejected(mutate, "colour")

    def test_rejects_extra_obstacle_key(self):
        def mutate(a):
            a["obstacles"][0]["spin"] = 1

        self.assertJsonRejected(mutate, "spin")

    def test_rejects_extra_ring_key(self):
        def mutate(a):
            a["ring"]["pulse"] = 1

        self.assertJsonRejected(mutate, "pulse")

    def test_rejects_bool_used_as_number(self):
        def mutate(a):
            a["obstacles"][0]["r"] = True

        self.assertJsonRejected(mutate, "number")

    def test_rejects_number_used_as_bool(self):
        def mutate(a):
            a["obstacles"][0]["blocksProjectiles"] = 1

        self.assertJsonRejected(mutate, "blocksProjectiles")

    def test_rejects_non_positive_size(self):
        def mutate(a):
            a["size"]["width"] = 0

        self.assertJsonRejected(mutate, "width")

    def test_rejects_obstacle_out_of_bounds(self):
        def mutate(a):
            a["obstacles"][7]["y"] = 9.8  # a 1 m deep rect centred here crosses y = 10
            a["obstacles"][8]["y"] = -9.8

        self.assertJsonRejected(mutate, "bounds")

    def test_rejects_spawn_out_of_bounds(self):
        def mutate(a):
            a["spawns"]["teamA"][0] = [-14.8, 2]
            a["spawns"]["teamB"][0] = [14.8, 2]

        self.assertJsonRejected(mutate, "bounds")

    def test_rejects_spawn_inside_obstacle(self):
        def mutate(a):
            a["spawns"]["teamA"][2] = [-8, 0]  # inside the rect at (-8, 0)
            a["spawns"]["teamB"][2] = [8, 0]

        self.assertJsonRejected(mutate, "touches")

    def test_rejects_too_few_spawns(self):
        def mutate(a):
            a["spawns"]["teamA"] = a["spawns"]["teamA"][:1]
            a["spawns"]["teamB"] = a["spawns"]["teamB"][:1]

        self.assertJsonRejected(mutate, "spawns")

    def test_rejects_ring_that_grows(self):
        def mutate(a):
            a["ring"]["endRadius"] = 20

        self.assertJsonRejected(mutate, "ring")

    def test_rejects_zero_ring_damage(self):
        def mutate(a):
            a["ring"]["damagePerSecond"] = 0

        self.assertJsonRejected(mutate, "damagePerSecond")

    def test_rejects_unknown_obstacle_type(self):
        def mutate(a):
            a["obstacles"][0]["type"] = "triangle"

        self.assertJsonRejected(mutate, "type")


class Arena01ContentTests(unittest.TestCase):
    def setUp(self):
        self.arena = load_arena()

    def test_playable_area_is_30_by_20(self):
        self.assertEqual(self.arena["size"], {"width": 30, "height": 20})

    def test_spawns_sit_at_x_plus_and_minus_12(self):
        for point in self.arena["spawns"]["teamA"]:
            self.assertEqual(point[0], -12)
        for point in self.arena["spawns"]["teamB"]:
            self.assertEqual(point[0], 12)

    def test_has_blocking_central_pillar(self):
        pillar = self.arena["obstacles"][0]
        self.assertEqual(pillar["type"], "circle")
        self.assertEqual((pillar["x"], pillar["y"]), (0, 0))
        self.assertTrue(pillar["blocksProjectiles"])

    def test_has_two_mirrored_pairs_of_blocking_cover_besides_the_pillar(self):
        blockers = [
            o for o in self.arena["obstacles"][1:] if o["blocksProjectiles"]
        ]
        pairs = 0
        for o in blockers:
            mirror = dict(o, x=-o["x"])
            if o["x"] < 0 and mirror in blockers:
                pairs += 1
        self.assertGreaterEqual(pairs, 2)

    def test_has_a_non_blocking_obstacle(self):
        self.assertTrue(
            any(not o["blocksProjectiles"] for o in self.arena["obstacles"])
        )


class NumberTests(unittest.TestCase):
    def test_accepts_finite_numbers_up_to_the_float_range(self):
        for value in (0, -8, 7.5, int(sys.float_info.max)):
            with self.subTest(value=value):
                self.assertTrue(validate_glb.is_finite_number(value))

    def test_rejects_non_finite_and_non_numbers(self):
        cases = {
            "huge int": 10**400,
            "huge negative int": -(10**400),
            "nan": float("nan"),
            "infinity": float("inf"),
            "bool": True,
            "string": "1",
        }
        for label, value in cases.items():
            with self.subTest(case=label):
                self.assertFalse(validate_glb.is_finite_number(value))


class CommittedModelTests(unittest.TestCase):
    def test_committed_arena_glbs_are_exactly_the_known_arenas(self):
        self.assertEqual(tuple(sorted(p.stem for p in ARENAS_DIR.glob("*.glb"))), ARENA_IDS)

    def test_committed_arena_glbs_pass(self):
        for arena_id in ARENA_IDS:
            with self.subTest(arena=arena_id):
                self.assertIsNone(validate_glb.validate_file(ARENAS_DIR / ("%s.glb" % arena_id)))

    def test_committed_champion_glbs_pass(self):
        paths = sorted(CHAMPIONS_DIR.glob("*.glb"))
        self.assertTrue(paths, "no champion glb under %s" % CHAMPIONS_DIR)
        for path in paths:
            with self.subTest(file=path.name):
                self.assertIsNone(validate_glb.validate_file(path))


class CommandLineTests(ValidatorCase):
    def run_main(self, args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = validate_glb.main([str(a) for a in args])
        return code, out.getvalue()

    def test_exits_1_on_a_renamed_node(self):
        doc = arena_doc(load_arena(), rename={"Wall_N": "Wall_X"})
        path = self.arena_glb(pack_glb(doc))
        code, out = self.run_main([path])
        self.assertEqual(code, 1)
        self.assertIn("FAIL %s" % path, out)

    def test_exits_0_and_prints_ok_for_a_good_file(self):
        path = self.arena_glb(pack_glb(arena_doc(load_arena())))
        code, out = self.run_main([path])
        self.assertEqual(code, 0)
        self.assertIn("OK %s" % path, out)

    def test_exits_1_when_a_directory_has_no_glb(self):
        code, _ = self.run_main([self.tmp])
        self.assertEqual(code, 1)

    def test_exits_1_when_one_file_in_a_directory_fails(self):
        self.arena_glb(pack_glb(arena_doc(load_arena())))
        self.write("champions", "bad.glb", pack_glb(rigged_champion_doc("Body")))
        code, out = self.run_main([self.tmp])
        self.assertEqual(code, 1)
        self.assertIn("OK", out)
        self.assertIn("FAIL", out)

    def test_malformed_file_does_not_stop_the_remaining_files(self):
        def bad_doc(mutate):
            doc = arena_doc(load_arena())
            mutate(doc)
            return doc

        def set_translation(doc):
            for node in doc["nodes"]:
                if node["name"] == "Obstacle_0":
                    node["translation"] = ["a", 0, 0]

        cases = {
            "non-dict node": (
                lambda doc: doc["nodes"].append(5),
                "must be an object",
            ),
            "list name": (
                lambda doc: doc["nodes"].append({"name": ["Floor"]}),
                "name must be a string",
            ),
            "non-numeric translation": (set_translation, "translation must be"),
        }
        good = self.write("champions", "good.glb", pack_glb(rigged_champion_doc()))
        for label, (mutate, reason) in cases.items():
            with self.subTest(case=label):
                bad = self.arena_glb(pack_glb(bad_doc(mutate)))
                code, out = self.run_main([bad, good])
                lines = out.splitlines()
                self.assertEqual(code, 1)
                self.assertTrue(lines[0].startswith("FAIL %s: " % bad), lines[0])
                self.assertIn(reason, lines[0])
                self.assertEqual(lines[1], "OK %s" % good)

    def test_unexpected_validator_error_becomes_a_fail_line(self):
        def boom(path, doc):
            raise RuntimeError("boom")

        arena = self.arena_glb(pack_glb(arena_doc(load_arena())))
        good = self.write("champions", "good.glb", pack_glb(rigged_champion_doc()))
        with mock.patch.dict(validate_glb.CATEGORY_RULES, {"arenas": boom}):
            code, out = self.run_main([arena, good])
        lines = out.splitlines()
        self.assertEqual(code, 1)
        self.assertIn("validator error: RuntimeError: boom", lines[0])
        self.assertEqual(lines[1], "OK %s" % good)


if __name__ == "__main__":
    unittest.main()
