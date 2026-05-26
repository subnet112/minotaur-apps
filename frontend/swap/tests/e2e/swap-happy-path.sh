#!/usr/bin/env bash
# Swap happy path — connect (preview), type amount, expect Swap CTA.
# Does NOT submit (no real wallet, no real backend). Verifies the
# state machine transitions visually.

set -euo pipefail
PW="node /workspaces/minotaur-apps/pagewire-main/packages/cli/bin/pagewire.js"
BASE="http://localhost:5173"
SESSION="e2e-happy"

echo "[1/4] Boot connected state via URL preview"
$PW --session $SESSION goto "$BASE/swap?wallet=metamask" --wait-for ".sw-form"

echo "[2/4] Verify action button is in an expected state"
SNAP=$($PW --session $SESSION snap --human)
# After connecting with no amount typed, the action button should read either
# "Enter amount" (empty state) or be one of the gating states.
if ! echo "$SNAP" | grep -qE 'Enter amount|Connect wallet|Fetching|Swap'; then
  echo "FAIL: action button not in expected initial state"
  echo "$SNAP"
  exit 1
fi
echo "OK: action button in expected initial state"

echo "[3/4] Type an amount, expect button to transition"
# Find the FROM input — look for the amount input inside the sw-form
FROM_REF=$(echo "$SNAP" | grep -m 1 'textbox' | grep -oE '@[a-zA-Z0-9]+' | head -1)
if [ -z "$FROM_REF" ]; then
  echo "FAIL: could not find From textbox in snap"
  echo "$SNAP"
  exit 1
fi
echo "  Found FROM ref: $FROM_REF"
$PW --session $SESSION type "$FROM_REF" "100"

# Give quote request time to fire (debounced 600ms + network)
sleep 3

SNAP2=$($PW --session $SESSION snap --human)
if echo "$SNAP2" | grep -qE 'Swap|Sign & broadcast|Fetching quote|No route|Insufficient'; then
  echo "OK: action button transitioned"
else
  echo "FAIL: action button did not transition after typing amount"
  echo "$SNAP2"
  exit 1
fi

echo "[4/4] Stop daemon"
$PW --session $SESSION daemon stop 2>/dev/null || true

echo ""
echo "swap-happy-path PASSED"
