#!/usr/bin/env bash
# Capture PNGs from the running frontend/swap dev server (port 5173).
# Output → tests/visual/current/.
set -euo pipefail
BASE_URL="http://localhost:5173/swap"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$SCRIPT_DIR/current"
mkdir -p "$OUT"
rm -f "$OUT"/*.png

if ! curl -s --fail "$BASE_URL" > /dev/null 2>&1; then
  echo "ERROR: frontend/swap dev server not running on :5173"
  echo "Run: cd /workspaces/minotaur-apps/frontend/swap && pnpm dev"
  exit 1
fi

MATRIX="$SCRIPT_DIR/matrix.json"
COUNT=$(jq length "$MATRIX")

for ((i=0; i<COUNT; i++)); do
  ID=$(jq -r ".[$i].id" "$MATRIX")
  PARAMS=$(jq -r ".[$i].params" "$MATRIX")
  echo "[$((i+1))/$COUNT] $ID"

  node "$SCRIPT_DIR/screenshot.mjs" \
    "$BASE_URL?$PARAMS" \
    "$OUT/$ID.png" \
    1440 900 2>&1 || true

  if [ ! -f "$OUT/$ID.png" ]; then
    echo "  WARN: no screenshot produced for $ID"
  fi
done

echo ""
echo "Captured $(ls -1 "$OUT"/*.png 2>/dev/null | wc -l)/$COUNT current PNGs."
