"""Regenerating a committed model must give the same bytes every time.

These tests run the generators in Blender, so they skip when Blender is not
installed. They exist because `bmesh.ops.create_uvsphere` once gave a
different vertex order inside its faces on some runs, so one matching run
proved nothing. Each model is built several times: the placeholder, the four
roster champions and the two arenas, four runs each. The champion files are
rigged and carry clips, so these runs also prove the animation export is
stable; the arena runs prove the rigged export flags left the arenas alone.
The last two test classes need no Blender. They fail when a committed champion
or arena glb has no case here, or a case has no glb.
"""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RUN = REPO / "tools" / "blender" / "run.sh"
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")
RUNS = 4

CHAMPION_IDS = ("placeholder", "hargrim", "quillon", "lumeth", "skerrow")
CHAMPIONS_DIR = REPO / "assets" / "models" / "champions"

ARENA_IDS = ("arena01", "arena02")
ARENAS_DIR = REPO / "assets" / "models" / "arenas"
ARENA_DATA_DIR = REPO / "data" / "arenas"

CASES = {}
for arena_id in ARENA_IDS:
    CASES[arena_id] = (
        "gen_arena.py",
        ["--arena", str(ARENA_DATA_DIR / ("%s.json" % arena_id))],
        ARENAS_DIR / ("%s.glb" % arena_id),
    )
for champion_id in CHAMPION_IDS:
    CASES[champion_id] = (
        "gen_champion.py",
        ["--champion", champion_id],
        CHAMPIONS_DIR / ("%s.glb" % champion_id),
    )


@unittest.skipUnless(os.access(BLENDER, os.X_OK), "Blender is not installed")
class ExportDeterminismTests(unittest.TestCase):
    def regenerate(self, name, out_dir, run):
        script, args, _ = CASES[name]
        out = Path(out_dir) / ("%s.glb" % name)
        # Remove the previous run's file, so a run that writes nothing cannot
        # pass by leaving the old bytes in place.
        out.unlink(missing_ok=True)
        result = subprocess.run(
            [str(RUN), str(REPO / "tools" / "blender" / script), "--"] + args + ["--out", str(out)],
            capture_output=True,
            text=True,
            errors="replace",
        )
        output = "\n--- stdout ---\n%s\n--- stderr ---\n%s" % (result.stdout, result.stderr)
        self.assertEqual(
            result.returncode,
            0,
            "%s run %d: Blender exited %d%s" % (name, run, result.returncode, output),
        )
        self.assertTrue(
            out.is_file(),
            "%s run %d: Blender exited 0 but did not write %s%s" % (name, run, out, output),
        )
        return out.read_bytes()

    def check(self, name):
        committed = CASES[name][2].read_bytes()
        with tempfile.TemporaryDirectory() as tmp:
            for run in range(RUNS):
                self.assertEqual(
                    self.regenerate(name, tmp, run + 1),
                    committed,
                    "%s run %d differs from the committed glb" % (name, run + 1),
                )

    def test_champion_exports_match_committed_files_on_every_run(self):
        for champion_id in CHAMPION_IDS:
            with self.subTest(champion=champion_id):
                self.check(champion_id)

    def test_arena_exports_match_committed_files_on_every_run(self):
        for arena_id in ARENA_IDS:
            with self.subTest(arena=arena_id):
                self.check(arena_id)


class ChampionCoverageTests(unittest.TestCase):
    def test_every_committed_champion_glb_has_a_determinism_case(self):
        committed = {path.stem for path in CHAMPIONS_DIR.glob("*.glb")}
        self.assertEqual(committed, set(CHAMPION_IDS))


class ArenaCoverageTests(unittest.TestCase):
    def test_arena_glbs_arena_definitions_and_determinism_cases_are_the_same_set(self):
        glbs = {path.stem for path in ARENAS_DIR.glob("*.glb")}
        definitions = {path.stem for path in ARENA_DATA_DIR.glob("*.json")}
        self.assertEqual(glbs, set(ARENA_IDS))
        self.assertEqual(definitions, set(ARENA_IDS))


if __name__ == "__main__":
    unittest.main()
