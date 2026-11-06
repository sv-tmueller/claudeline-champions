"""`preview.py` renders a committed champion glb to PNGs in `--out`.

The test drives the real script through Blender, so it skips when Blender is
not installed, the same way `test_export_determinism.py` does. It renders the
placeholder only: the file names and the clip set are the whole contract, and
rendering all eight champions would quadruple the cost for no new coverage.
The clips are the six of the Clips table in `docs/architecture/assets.md`; a
renamed or dropped clip fails here without the test hardcoding key frames.
"""
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RUN = REPO / "tools" / "blender" / "run.sh"
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")

CLIPS = ("Idle", "Run", "Attack", "Cast", "Hit", "Death")


@unittest.skipUnless(os.access(BLENDER, os.X_OK), "Blender is not installed")
class PreviewTests(unittest.TestCase):
    def test_champion_preview_writes_a_rest_png_and_one_strip_per_clip(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = subprocess.run(
                [
                    str(RUN),
                    str(REPO / "tools" / "blender" / "preview.py"),
                    "--",
                    "--champion",
                    "placeholder",
                    "--out",
                    tmp,
                ],
                capture_output=True,
                text=True,
                errors="replace",
            )
            output = "\n--- stdout ---\n%s\n--- stderr ---\n%s" % (result.stdout, result.stderr)
            self.assertEqual(
                result.returncode, 0, "preview.py exited %d%s" % (result.returncode, output)
            )
            expected = ["placeholder_rest.png"] + [
                "placeholder_%s.png" % clip.lower() for clip in CLIPS
            ]
            for name in expected:
                path = Path(tmp) / name
                self.assertTrue(path.is_file(), "preview.py did not write %s%s" % (name, output))
                self.assertGreater(
                    path.stat().st_size, 0, "%s is empty%s" % (name, output)
                )


if __name__ == "__main__":
    unittest.main()
