# Known Issues

Tracked correctness gaps and incomplete behavior in `frontend/swap/`. Maintained as part of the consolidation; new issues added as they're discovered. Fixed issues are moved to a bottom section + dated rather than deleted.

> **For contributors:** before reporting a bug, check here. If your issue isn't listed, file it against the repo. Fix-tracking IDs (`F#`) are internal references used in commit messages.

## Severity legend

- 🔴 **Critical** — affects core swap correctness or breaks user flow silently.
- 🟡 **Important** — UX degradation or spec gap; not blocking but should fix.
- 🟢 **Future** — design-pending, nice-to-have, or low-impact.

---

## 🔴 Critical

_All Phase 12.8 critical items resolved. See **Resolved** below._

## 🟡 Important

### F20 — `unwrapOutput` always false

Frontend currently uses static `unwrapOutput=false` in the 11-field intent params (or doesn't set it explicitly — verify in current `useOrderSubmission.ts`). When user selected native ETH as output, the contract's `auto-unwrap` semantics in `DexAggregatorApp.sol` aren't being exploited. Should set `unwrapOutput=true` when output token is native.

### F22 — Visual regression tolerances

Current per-state tolerances: 0.02–0.25. After Phase 12.8 + the cheap design wins land, tighten to 0.005–0.10. Some states (token-selector, history) can probably go lower.

### F23 — Dev preview state missing store-injection params

`useDevPreviewState` honors a small set of URL params; new E2E scripts need to inject deeper store state (`needsApproval`, `activeOrder.status`, `slippageBps`) and currently rely on `window.__DEV_SWAP_STORE__` which isn't exposed. Fix: expose `useSwapStore` getter on `window.__DEV_SWAP_STORE__` in dev builds.

### F24 — `slippageBps` not persisted to localStorage

Store's persist allowlist doesn't include `slippageBps`. The `settings-persistence.sh` E2E only confirms in-memory persistence. Fix: add to persist config in `store.ts`.

---

## 🟢 Future work / design-pending

### Wallet menu dropdown (connected state)

When user clicks a connected wallet button, design spec says: open a 280px menu with Copy address / Switch chain / Switch wallet / Disconnect. **Design pending** per IMPL guide §3.2. Currently a placeholder that just disconnects on click.

### Chain picker dropdown

`.sw-chain` button click should open a chain switcher. **Design pending** per IMPL guide §4.3. Phase 12.7 added a basic functional dropdown as a fallback.

### Mobile responsive TokenSelectorModal

CSS has a `<640px` full-screen rule (`.sw-mobile`) but the component renders at fixed 440px regardless of viewport. Add a `useMediaQuery` hook or CSS-only rule.

### WalletConnectPanel error variants

Design spec calls for Cretan-tinted error variants when `window.ethereum` is missing (EVM mode) or Polkadot extension is missing (Bittensor mode). Currently only a toast.error fires; the panel doesn't reflow.

### QuoteCard skeleton state

Initial fetch (`loading && !quote`) should render a `.sw-quote-skel` shimmer per IMPL §3.7. Currently QuoteCard simply doesn't render until quote arrives.

### QuoteCard comparison row loading

Per-row "FETCHING" state with shimmer while external DEX comparisons load. CSS exists; component renders final state only.

### OrderStatusCard error message block

Failed order doesn't show the API failure reason inline. IMPL §3.10 specifies a `.sw-status-err` block with `<p>{api_error_message}</p>`.

### RevealPanel count display

History eyebrow should show a `.ct-count` chip with `NN TOTAL` format (zero-padded). Currently no count is displayed in the header.

### SettingsSheet high-slippage warning

When slippage > 5%, design spec calls for Cretan tint on the section value, slider fill, custom input border, and rewritten helper text. CSS rules exist; component doesn't apply the modifier classes.

### ActionButton dynamic token labels

"Insufficient USDC" instead of "Insufficient balance". Requires the button to receive the current token symbol as a prop. Architectural change — ActionButton currently receives only an `ActionState` enum.

### Connect / disconnect / copy-address toasts

IMPL §5 firing checklist: connect success, connect failure, disconnect, copy-address (transient) toasts are missing. Wire them up in `useWalletConnection` and the WalletButton menu (once FW1 lands).

### Quote-fetch error toast

When `useQuoteRequest` catches an error, it sets `store.error` but doesn't fire `toast.error({ title: 'Quote unavailable', message: 'Try again or change tokens' })`. Add the toast.

### Approval flow toasts

ERC-20 approval (when allowance < amount) should fire sticky-loading-update toast pair. Currently silent.

### Settings saved toast

SettingsSheet's Done button should fire `toast.success({ title: 'Settings saved' })` per IMPL §5. Currently silent close.

---

## Resolved

(Entries move here once fixed, with the resolving commit SHA and date.)

### F21 — Native ETH input (resolved 2026-05-26, frontend only)

The broken native-ETH input flow has been removed from the frontend. The `isNativeInput` detection block, `_user_submit=true` flag, `prepareDirectSubmit` API call, and `signer.sendTransaction({value})` branch have been deleted from `useOrderSubmission.ts`. `selectActionState` no longer returns `'sign-broadcast'` for native input — native ETH now falls through to `'swap-ready'` (or `'insufficient'` if balance is low). `TokenSelectorModal` disables native ETH rows with a `(wrap first)` label when the INPUT side is open and WETH is available in the token list.

Contract upgrade tracked separately — make `executeIntent` payable + WETH wrapping: `executeIntent` in `AppIntentBase` must be made payable, and `_fundAndExecute` must call `IWETH.deposit{value: msg.value}()` to wrap native input atomically. Add Foundry tests for the native path and verify protocol fee handling when `msg.value > 0`.

### F1 — Hook unit tests (resolved 2026-05-26)

Added 7 hook test files at `tests/unit/hooks/*.test.ts` totaling 162 tests across the 7 hooks. Includes shared `fixtures.ts` (MOCK_TOKEN, MOCK_QUOTE, MOCK_ORDER, MOCK_BALANCES) and `test-utils.ts` (HookWrapper, resetStore, installEthereumStub). Strategy: `vi.spyOn(api, ...)` + global `window.ethereum` stub + `vi.mock('ethers'/'@polkadot/api')` at module level + `vi.useFakeTimers()` per test. `renderHook` from @testing-library/react.

### F2 — Selector edge-case tests (resolved 2026-05-26)

Added `tests/unit/selectors-edge.test.ts` with 52 tests covering null `walletChainId`, transient `walletAddress=''`, simultaneous flags, all 7 modeBlockVariant values, cross-chain SS58, and the F21 regression guard.

### F3 — E2E flows (resolved 2026-05-26)

Added 4 pagewire scripts at `tests/e2e/`: `approval-flow.sh`, `order-failure.sh`, `settings-persistence.sh`, `history-persistence.sh`. 7/7 E2E scripts now pass against a running dev server.

### F4 — `.sw-slip.is-custom` modifier (resolved 2026-05-26)

`SettingsSheet.tsx` now applies `is-custom` to the slippage chip container when `customSlippage !== ''`. Lime-tint visual feedback now fires when user types a custom slippage value.

### F5 — `.sw-cmp-row.is-best` comparison row (resolved 2026-05-26)

`SwapPage.mappers.ts:mapComparisonQuotes()` finds the highest-output row and flags `isBest: true`. `QuoteCard.tsx` applies `.sw-cmp-row.is-best` accordingly. (Mapper currently returns `[]` because `QuoteResult.comparison_quotes` is not populated by the API yet; structure is ready for when it is.)

### F6 — TokenSelectorModal disabled click guard (resolved earlier; verified)

Disabled rows already correctly suppress both click and keyboard handlers.

### F7 — AbortController on fetches (resolved 2026-05-26)

`useQuoteRequest.ts` and `useWalletBalances.ts` now use `AbortController`; abort fires on dep change. `api/client.ts` `getQuote` and `getWalletBalances` accept `signal: AbortSignal`.

### F8 — Stale-quote race (resolved 2026-05-26)

`useQuoteRequest.ts` uses a `useRef<number>(0)` request-version counter; stale responses are discarded.

### F10 — Order polling cadence (resolved 2026-05-26)

`useOrderSubmission.ts` polling interval changed from 3000 ms to 2000 ms per IMPL §4.8.

### F11 — SwapExecuted event ABI documented (resolved 2026-05-26)

`useOrderSubmission.ts:49` has an inline comment block matching the Solidity event signature.

### F12 — Quote TTL auto-refetch (resolved earlier; verified)

`useQuoteExpiry.ts` calls `requestQuote()` on TTL=0, gated by `!submitting && !activeOrder`.

### F13 — Pause quote expiry during active order (resolved 2026-05-26)

`useQuoteExpiry.ts` wraps the interval in `if (!store.activeOrder)`. Timer fully pauses while order is in flight. Switched to `useSwapStore.getState()` to avoid stale closures.

### F14 — Bittensor balance routing (resolved 2026-05-26)

`useWalletBalances.ts` forces `chain_id=0` when `walletMode === 'bittensor'`. Substrate path is correctly routed regardless of UI chain pick.

### F15 — Cross-chain output balance (resolved 2026-05-26)

`useWalletBalances.ts` now issues a second `api.getWalletBalances(outputAddr, chainId)` call for the output token in cross-chain mode (previously force-nulled the output balance).

### F16 — Chain switching with fallback (resolved 2026-05-26)

`switchChain(targetChainId)` exported from `useWalletConnection.ts`; falls back to `wallet_addEthereumChain` on error code 4902. `SwapPage.tsx` chain-pick handlers are one-liners.

### F18 — Bittensor proxy pre-check (resolved 2026-05-26)

`setupBittensorProxy()` checks `/api/v1/native-bittensor/permissions?owner=...` before launching the setup UI and short-circuits if an active permission already exists.

### F19 — Recent-swaps history load (resolved earlier; verified)

`useAppBootstrap.ts:15` calls `store.loadHistory()` on mount.

### API error-body handling (resolved 2026-05-26)

`api/client.ts` `getQuote` and `getWalletBalances` now throw when the JSON body contains an `error` field, even on HTTP 200. Calling hooks surface the error via `store.setError` + `toast.error(...)` instead of silently rendering zero balances.

### A1 — Selector `needsApproval` state semantics (resolved 2026-05-26)

`selectActionState` now returns `'awaiting-sig'` when `needsApproval && !approving` (instead of returning `'approving'` with a misleading spinner). The approval CTA itself lives in `WalletModeBlock` (variant `'approval'`); the ActionButton stays disabled with the "Awaiting approval" label until the user triggers the approval.

### D1 — TTL `.is-warn` modifier (resolved 2026-05-26)

`QuoteCard.tsx` now applies `.is-warn` (the modifier the design CSS actually defines) instead of the no-op `.is-expiring`. Threshold raised from 10s to 30s so the user has time to react before the auto-refetch.

---

## New issues found during Phase 12.8 audit

### F23 — Dev preview state missing store-injection params (🟡 should-fix)

`useDevPreviewState` honors only a small set of URL params (`wallet`, `cross`, `overlay`, etc.). The new E2E scripts (`approval-flow.sh`, `order-failure.sh`, `settings-persistence.sh`) need to inject deeper store state (`needsApproval`, `activeOrder.status`, `slippageBps`) and currently fall back to evaluating raw JS against `window.__DEV_SWAP_STORE__` — which is not exposed.

**Fix:** Either (a) expose `useSwapStore` (or a getter) on `window.__DEV_SWAP_STORE__` in dev builds, or (b) extend `useDevPreviewState` to honor the missing params. Option (a) is more flexible for E2E injection and lower-risk than expanding the URL-param contract.

### F24 — slippageBps not persisted to localStorage (🟡 should-fix)

The store's persist allowlist doesn't include `slippageBps`, so the `settings-persistence.sh` E2E only confirms the value remains in memory; on hard reload it resets to default. Audit and add to persist config in `store.ts`.

### F25 — ActionButton labels hard-coded to "USDC" (🟢 future)

`ActionButton.tsx` `STATE_CONFIG` has `'insufficient'` → "Insufficient USDC" and `'approving'` → "Approving USDC…" hardcoded. Should accept the current token symbol as a prop and interpolate. (Already noted as FW11 — keeping for promotion when desired.)

### D2/FW8 — QuoteCard skeleton state (🟡 medium effort, ~20 min)

CSS `.sw-quote-skel` shimmer exists but the component renders nothing during initial `loading && !quote`. Add a skeleton render path.

### D3/FW9 — Per-comparison-row "FETCHING" shimmer (🟡 medium effort, ~20 min)

CSS supports per-row shimmer but mapper doesn't surface loading state. Bind to a `loading` flag on each comparison row.

### D4/FW10 — High-slippage tint coverage (🟡 medium effort, ~15 min)

Currently the `.v` value changes color when slippage > 5%; the design also tints `.sw-settings-sec`, the slippage slider, and the custom-input border. Extend to all elements via a shared `is-warn` class on the section container.

### D5/FW13 — OrderStatusCard inline error message block (🟡 medium effort, ~20 min)

CSS `.sw-status-err` exists; when `activeOrder.status === 'failed'` the API failure reason should render inline below the stepper. Currently silent.

### D6/FW3 — Mobile-responsive TokenSelectorModal (🟡 medium effort, ~30 min)

CSS `.sw-mobile` rule for `<640px` exists but the modal renders at fixed 440px regardless. Needs viewport-based class toggle or pure-CSS layout adjustment.
