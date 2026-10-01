#!/usr/bin/env bash
# Run a Blender script in background mode.
# Usage: tools/blender/run.sh <script.py> -- <script args>
set -euo pipefail

BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"

if [ "$#" -lt 1 ]; then
  echo "usage: run.sh <script.py> -- <script args>" >&2
  exit 2
fi

if [ ! -x "$BLENDER" ]; then
  echo "Blender not found or not executable at $BLENDER." >&2
  echo "Install Blender or set the BLENDER environment variable." >&2
  exit 1
fi

script="$1"
shift

# --python-exit-code makes a crashing script fail the command. Without it
# Blender exits 0 after a Python exception. --factory-startup keeps user
# preferences out of the exported files.
exec "$BLENDER" --background --factory-startup --python-exit-code 1 --python "$script" "$@"
