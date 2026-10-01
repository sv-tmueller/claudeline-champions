"""Regenerating a committed model must give the same bytes every time.

These tests run the generators in Blender, so they skip when Blender is not
installed. They exist because `bmesh.ops.create_uvsphere` once gave a
different vertex order inside its faces on some runs, so one matching run
proved nothing. Each model is built several times.
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

CASES = {
    "champion": (
        "gen_champion.py",
        ["--champion", "placeholder"],
        REPO / "assets" / "models" / "champions" / "placeholder.glb",
    ),
    "arena": (
        "gen_arena.py",
        ["--arena", str(REPO / "data" / "arenas" / "arena01.json")],
        REPO / "assets" / "models" / "arenas" / "arena01.glb",
    ),
}


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

    def test_champion_export_matches_committed_file_on_every_run(self):
        self.check("champion")

    def test_arena_export_matches_committed_file_on_every_run(self):
        self.check("arena")


if __name__ == "__main__":
    unittest.main()
