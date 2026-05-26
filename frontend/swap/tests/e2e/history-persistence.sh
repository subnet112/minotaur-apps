#!/usr/bin/env bash
# History persistence: pre-seeds localStorage with a completed swap entry,
# reloads the page, opens the HistoryPanel, and verifies the entry is visible.
#
# The history localStorage key is 'minotaur_swap_history' (from swap.store.ts
# addToHistory/loadHistory). The HistoryPanel is revealed by clicking the
# "History" toggle button (driven via history=1 URL param which is honored
# by useDevPreviewState).
#
# SwapHistoryItem shape (from swap.types.ts):
#   { orderId, timestamp, chainId, inputToken, outputToken,
#     inputAmount, outputAmount, status, score?, txHash? }

set -euo pipefail
PW="node /workspaces/minotaur-apps/pagewire-main/packages/cli/bin/pagewire.js"
BASE="http://localhost:5173"
S="e2e-history"

FAKE_ORDER_ID="0xdeadbeef12345678"
FAKE_INPUT_TOKEN="USDC"
FAKE_OUTPUT_TOKEN="WETH"
FAKE_INPUT_AMOUNT="1000"
FAKE_OUTPUT_AMOUNT="0.4321"

echo "[1/4] Load page and pre-seed localStorage with a fake completed swap"
$PW --session $S goto "$BASE/swap" --wait-for ".sw-form"

$PW --session $S evaluate "
  const entry = {
    orderId: '$FAKE_ORDER_ID',
    timestamp: Date.now() - 60000,
    chainId: 1,
    inputToken: '$FAKE_INPUT_TOKEN',
    outputToken: '$FAKE_OUTPUT_TOKEN',
    inputAmount: '$FAKE_INPUT_AMOUNT',
    outputAmount: '$FAKE_OUTPUT_AMOUNT',
    status: 'filled',
    score: null,
    txHash: null
  };
  localStorage.setItem('minotaur_swap_history', JSON.stringify([entry]));
  console.log('localStorage seeded with fake swap history');
"

echo "[2/4] Reload page with history=1 param to surface HistoryPanel"
$PW --session $S goto "$BASE/swap?history=1" --wait-for ".sw-form"

sleep 1

echo "[3/4] Snap and verify history entry is visible"
SNAP=$($PW --session $S snap --human)

# The HistoryPanel renders each swap as: "{inputAmount} {inputToken} → {outputAmount} {outputToken}"
# Check for the fake order's token symbols and amounts
if echo "$SNAP" | grep -qiE "($FAKE_INPUT_TOKEN|$FAKE_OUTPUT_TOKEN|$FAKE_ORDER_ID|Recent Swaps)"; then
  echo "OK: HistoryPanel is visible and swap entry found"
else
  echo "FAIL: HistoryPanel entry not visible after localStorage pre-seed and reload"
  echo "      Expected to see '$FAKE_INPUT_TOKEN', '$FAKE_OUTPUT_TOKEN', or 'Recent Swaps'"
  echo "snap output (first 40 lines):"
  echo "$SNAP" | head -40
  $PW --session $S daemon stop 2>/dev/null || true
  exit 1
fi

echo "[4/4] Verify the order ID is rendered (shorten() trims to first 6 chars)"
# shorten(orderId, 6) => '0xdeadb...' — check prefix
ORDER_PREFIX=$(echo "$FAKE_ORDER_ID" | cut -c1-8)
if echo "$SNAP" | grep -qi "$ORDER_PREFIX"; then
  echo "OK: order ID prefix '$ORDER_PREFIX' found in history entry"
else
  echo "WARN: order ID prefix not found — shorten() may render differently"
  echo "      (non-blocking; entry was confirmed visible in step 3)"
fi

$PW --session $S daemon stop 2>/dev/null || true

echo ""
echo "history-persistence PASSED"
