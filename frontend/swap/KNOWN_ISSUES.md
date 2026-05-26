# Known Issues

Tracked correctness gaps and incomplete behavior in `frontend/swap/`. Maintained as part of the consolidation; new issues added as they're discovered. Fixed issues are moved to a bottom section + dated rather than deleted.

> **For contributors:** before reporting a bug, check here. If your issue isn't listed, file it against the repo. The fix-tracking IDs (`F#`) match the Phase 12.8 spec at `docs/superpowers/specs/2026-05-26-phase-12.8-correctness-fixes-spec.md`.

## Severity legend

- 🔴 **Critical** — affects core swap correctness or breaks user flow silently.
- 🟡 **Important** — UX degradation or spec gap; not blocking but should fix.
- 🟢 **Future** — design-pending, nice-to-have, or low-impact.

---

## 🔴 Critical

### F1 — Zero hook unit tests

**Status:** Open. Phase 12.8 will add ~150 test cases.

**Where:** No tests at `src/hooks/*.test.ts`. All 7 hooks (`useAppBootstrap`, `useMetaMaskListener`, `useWalletBalances`, `useQuoteRequest`, `useQuoteExpiry`, `useWalletConnection`, `useOrderSubmission`) — ~1,200 LOC of side effects — have no unit coverage.

**Impact:** Bugs in debouncing, abort handling, error paths, polling cleanup, race conditions can land unnoticed. Current `54/54 tests pass` is misleading — pure functions only.

**Fix:** Add `tests/unit/hooks/` with one file per hook. Decide mock strategy in Phase 12.8 brainstorm (MSW vs manual; `renderHook` vs wrapper component; how to mock `window.ethereum`).

### F7 — No AbortController on quote / balance fetches

**Status:** Open.

**Where:** `src/hooks/useQuoteRequest.ts`, `src/hooks/useWalletBalances.ts`.

**Impact:** Rapid input changes spawn parallel fetches; stale responses can overwrite newer ones. Wasted network traffic. Slow / flaky networks can produce wrong UI.

**Fix:** Wrap fetches in `AbortController`; abort on dep change.

### F8 — Stale quote response can overwrite newer result

**Status:** Open.

**Where:** `src/hooks/useQuoteRequest.ts`.

**Impact:** Even with debounce, if request N's response arrives after N+1's, N's quote is stored. User sees the wrong quote for their current input.

**Fix:** Add a request-version counter; ignore responses for stale versions.

### F12 — Quote does not auto-refetch on TTL expiry

**Status:** Open.

**Where:** `src/hooks/useQuoteExpiry.ts`.

**Impact:** When `quoteExpiry` reaches zero, the visual countdown completes but no new quote is fetched. User sees a stale-but-displayed quote indefinitely.

**Fix:** Accept `requestQuote` callback in `useQuoteExpiry`; call it on expiry (gated to not fire while an order is active).

**IMPL guide reference:** §3.7 — "On expiry: trigger refetch, reset bar."

### F14 — Bittensor balance fetch likely broken (SS58 vs hex)

**Status:** Open. Requires empirical API check.

**Where:** `src/hooks/useWalletBalances.ts`. The hook calls `api.getWalletBalances(addr, chainId)` with the wallet's primary address. For Bittensor wallets, `addr` is an SS58 string (e.g. `5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY`).

**Impact:** Unverified whether the validator API at `api.minotaursubnet.com/v1/wallets/{addr}/balances` accepts SS58 addresses. If it expects only hex EVM addresses, Bittensor users see no balance.

**Fix:** Phase 12.8 will empirically test the API (`curl` against the public endpoint with each address format). Based on findings: either route through a separate Bittensor balance endpoint or convert/encode.

### F15 — Cross-chain swap fetches wrong-chain balance

**Status:** Open.

**Where:** `src/hooks/useWalletBalances.ts`. Hook fetches balances for `chainId` (the destination chain) instead of `sourceChainId` (where the FROM token actually lives) when `isCrossChain` is true.

**Impact:** Cross-chain Bittensor → EVM swap: FROM balance shows the user's Ethereum balance instead of their Bittensor TAO balance. Wrong "Insufficient balance" or stale value.

**Fix:** When `isCrossChain`, fetch FROM balance from `sourceChainId`, TO balance from `chainId`.

### F19 — Recent-swaps history not loaded on app start

**Status:** Open. One-line fix.

**Where:** `src/hooks/useAppBootstrap.ts`. The hook handles solver tokens + app/contract discovery but never calls `store.loadHistory()`.

**Impact:** localStorage round-trip is broken. History is always empty at app start. Only new swaps submitted in the current session appear in the RevealPanel history view.

**Fix:** Add `store.loadHistory()` to `useAppBootstrap`'s mount effect.

---

## 🟡 Important

### F2 — Selector edge cases untested

`selectActionState` and `selectModeBlockVariant` cover the main 12+7 states but have no tests for:
- `walletChainId === null` (still external mode, no chain yet)
- `walletConnected=true && walletAddress=''`
- Simultaneous `needsApproval && approving`
- `quote != null && inputAmount === ''`

Fix: add `tests/unit/selectors-edge.test.ts` (~50 cases).

### F3 — Missing E2E flows

Current pagewire E2E: `swap-happy-path.sh`, `wallet-modes.sh`, `cross-chain.sh`. Missing: approval flow, order failure, settings persistence, history persistence, custom token import. Fix: add 4 new shell scripts.

### F4 — `.sw-slip.is-custom` modifier never applied

When user enters a non-preset slippage, the design's CSS expects `.sw-slip.is-custom` (lime tint + cretan glyph). Component leaves the chip Mist always. One-liner fix in `SettingsSheet.tsx`.

### F5 — `.sw-cmp-row.is-best` never applied

When a comparison DEX beats Minotaur on output, the design's `.sw-cmp-row.is-best` modifier (lime-tinted row + check glyph) never renders. Mappers don't track which result is best. Fix: in `mapQuoteResultToQuoteCardProps`, compute `bestIdx` and flag the winning comparison row.

### F6 — TokenSelectorModal disabled rows still clickable

Design's `.sw-tmod-row.is-disabled` modifier (for the opposite-side token) is applied visually, but the row's `onClick` still fires. Fix: guard the click handler when the row is disabled.

### F10 — Order polling cadence

Current: `setInterval(..., 3000)` in `pollOrderStatus`. IMPL guide §4.8 specifies 2s. Five-minute fix.

### F11 — `SwapExecuted` event ABI undocumented

`useOrderSubmission` decodes the contract's `SwapExecuted` event but the ABI is hardcoded with no comment. Future readers can't verify it matches the Solidity event signature without cross-referencing the contract.

### F13 — TTL countdown doesn't pause during active order

`useQuoteExpiry` decrements the countdown even while `activeOrder` is non-null + non-terminal. Semantically wrong (no quote in flight to expire) but not user-visible since QuoteCard isn't rendered during an active order.

### F16 — Chain switching not in `useWalletConnection`

`wallet_switchEthereumChain` is called inline in `SwapPage.tsx` rather than via the hook. No `wallet_addEthereumChain` fallback for chains the user hasn't added (e.g. Bittensor EVM 964). Fix: move chain switching to the hook + add fallback.

### F18 — Bittensor proxy setup doesn't check existing permissions

`setupBittensorProxy` always prompts. Should skip the prompt + immediately mark `proxySetup=true` if the API reports an active permission already.

### F20 — `unwrapOutput` always false

Frontend hardcodes `unwrapOutput=false` in the 11-field intent params. If user selected native ETH as output (i.e. wants ETH not WETH), the design's `auto-unwrap` semantics in `DexAggregatorApp.sol` aren't being exploited. Frontend could set `unwrapOutput=true` when output token is native.

### F22 — Visual regression tolerances are broad

Current per-state tolerances: 0.04 - 0.25. Many states pass partly because the tolerance hides real implementation differences (e.g. `.is-custom` not applied, no high-slippage warning). After F4 / F6 / FW10 land, tolerances should tighten to 0.005 - 0.05.

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
