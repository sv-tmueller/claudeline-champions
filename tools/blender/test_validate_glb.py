"""Tests for validate_glb.py.

Most tests build small glbs in memory, so they run without Blender. The tests
that read the committed models need `assets/models` to be generated first.
"""
import contextlib
import io
import json
import struct
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import validate_glb

REPO = Path(__file__).resolve().parents[2]
ARENA_JSON = REPO / "data" / "arenas" / "arena01.json"
ARENA_GLB = REPO / "assets" / "models" / "arenas" / "arena01.glb"
CHAMPION_GLB = REPO / "assets" / "models" / "champions" / "placeholder.glb"

CHUNK_JSON = 0x4E4F534A
CHUNK_BIN = 0x004E4942


def load_arena():
    with open(ARENA_JSON) as f:
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


def champion_doc(name="Champion"):
    return {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"name": name, "mesh": 0}],
        "meshes": [{"primitives": []}],
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

    def arena_glb(self, data):
        return self.write("arenas", "arena01.glb", data)

    def assertRejected(self, path, reason):
        message = validate_glb.validate_file(path)
        self.assertIsNotNone(message, "validator accepted a bad file")
        self.assertIn(reason, message)


class StructureTests(ValidatorCase):
    def test_synthetic_arena_passes(self):
        path = self.arena_glb(pack_glb(arena_doc(load_arena())))
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
        path = self.write("props", "crate.glb", pack_glb(champion_doc()))
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
        doc = arena_doc(load_arena())
        for node in doc["nodes"]:
            if node["name"] == "Obstacle_7":
                node["translation"] = [0, 0, 7]  # the JSON says y = 7, so z = -7
        self.assertRejected(self.arena_glb(pack_glb(doc)), "does not match")

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
    def test_champion_node_passes(self):
        path = self.write("champions", "p.glb", pack_glb(champion_doc()))
        self.assertIsNone(validate_glb.validate_file(path))

    def test_rejects_champion_without_champion_node(self):
        path = self.write("champions", "p.glb", pack_glb(champion_doc("Body")))
        self.assertRejected(path, "Champion")

    def test_rejects_non_dict_node(self):
        doc = champion_doc()
        doc["nodes"].insert(0, 5)
        path = self.write("champions", "p.glb", pack_glb(doc))
        self.assertRejected(path, "nodes[0] must be an object")

    def test_rejects_unhashable_node_name(self):
        doc = champion_doc()
        doc["nodes"].insert(0, {"name": ["x"]})
        path = self.write("champions", "p.glb", pack_glb(doc))
        self.assertRejected(path, "nodes[0].name must be a string")


class ArenaJsonTests(unittest.TestCase):
    def check(self, mutate):
        arena = load_arena()
        mutate(arena)
        return validate_glb.validate_arena_json(arena, "arena01")

    def assertJsonRejected(self, mutate, reason):
        message = self.check(mutate)
        self.assertIsNotNone(message, "validator accepted a bad arena")
        self.assertIn(reason, message)

    def test_arena01_passes(self):
        self.assertIsNone(self.check(lambda a: None))

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


class CommittedModelTests(unittest.TestCase):
    def test_committed_arena_glb_passes(self):
        self.assertIsNone(validate_glb.validate_file(ARENA_GLB))

    def test_committed_champion_glb_passes(self):
        self.assertIsNone(validate_glb.validate_file(CHAMPION_GLB))


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
        self.write("champions", "bad.glb", pack_glb(champion_doc("Body")))
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
            doc["nodes"][5]["translation"] = ["a", 0, 0]

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
        good = self.write("champions", "good.glb", pack_glb(champion_doc()))
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
        good = self.write("champions", "good.glb", pack_glb(champion_doc()))
        with mock.patch.dict(validate_glb.CATEGORY_RULES, {"arenas": boom}):
            code, out = self.run_main([arena, good])
        lines = out.splitlines()
        self.assertEqual(code, 1)
        self.assertIn("validator error: RuntimeError: boom", lines[0])
        self.assertEqual(lines[1], "OK %s" % good)


if __name__ == "__main__":
    unittest.main()
