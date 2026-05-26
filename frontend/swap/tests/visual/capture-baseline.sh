#!/usr/bin/env bash
# Capture PNGs from the design tree's apps/app dex-aggregator route
# (port 4324). One-time + on any design tree update.
set -euo pipefail
BASE_URL="http://localhost:4324/apps/dex-aggregator"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$SCRIPT_DIR/baseline"
mkdir -p "$OUT"
rm -f "$OUT"/*.png

# Verify design tree dev server is running
if ! curl -s --fail "$BASE_URL" > /dev/null 2>&1; then
  echo "ERROR: design tree dev server not running on :4324"
  echo "Run: cd /workspaces/minotaur-apps/design/dex/minotaur-mainapp-rebuild && pnpm install && pnpm -C apps/app dev"
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
echo "Captured $(ls -1 "$OUT"/*.png 2>/dev/null | wc -l)/$COUNT baseline PNGs."
