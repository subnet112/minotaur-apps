#!/usr/bin/env bash
# Capture current + diff against baseline. Assumes baseline already
# exists at tests/visual/baseline/ (run snapshot:baseline first).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.."

if [ ! -d tests/visual/baseline ] || [ -z "$(ls -A tests/visual/baseline 2>/dev/null)" ]; then
  echo "ERROR: no baseline PNGs at tests/visual/baseline/"
  echo "Run: pnpm snapshot:baseline   (with design tree dev server up on :4324)"
  exit 1
fi

# Boot dev server if not already running
DEV_PID=""
if ! curl -s --fail http://localhost:5173/swap > /dev/null 2>&1; then
  echo "Starting dev server..."
  pnpm dev > /tmp/swap-visual-dev.log 2>&1 &
  DEV_PID=$!
  trap "[ -n \"$DEV_PID\" ] && kill $DEV_PID 2>/dev/null" EXIT
  sleep 5
fi

bash tests/visual/capture-current.sh
node tests/visual/diff.mjs
