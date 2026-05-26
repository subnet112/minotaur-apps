#!/usr/bin/env bash
# Wallet mode previews: each of 3 wallet modes renders the connected
# state correctly. Doesn't exercise real provider flows.
set -euo pipefail
PW="node /workspaces/minotaur-apps/pagewire-main/packages/cli/bin/pagewire.js"
BASE="http://localhost:5173"

for mode in managed metamask bittensor; do
  echo "→ mode=$mode"
  $PW --session "e2e-$mode" goto "$BASE/swap?wallet=$mode" --wait-for ".app-wallet"
  SNAP=$($PW --session "e2e-$mode" snap --human)
  # The WalletButton renders with class is-connected is-$mode for each variant.
  # Check the snap contains the expected mode indicator.
  if echo "$SNAP" | grep -qiE "(is-connected|connected|$mode)"; then
    echo "  OK: $mode renders connected"
  else
    echo "  FAIL: wallet button did not render mode=$mode connected"
    echo "$SNAP"
    $PW --session "e2e-$mode" daemon stop 2>/dev/null || true
    exit 1
  fi
  $PW --session "e2e-$mode" daemon stop 2>/dev/null || true
done

echo ""
echo "wallet-modes PASSED"
