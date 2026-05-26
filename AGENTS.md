# AGENTS.md

This file provides architectural guidance for AI coding agents working in this
repository. Tool-agnostic — compatible with Anthropic's CLI, Codex, Cursor,
and similar tools.

## Pick-up references (read these first if starting a new session)

- **`docs/superpowers/SESSION_BRIEF.md`** — current branch state, what's done, what's next, critical invariants. Read me first.
- **`docs/superpowers/specs/`** — design specs (one per phase).
- **`docs/superpowers/plans/`** — implementation plans.
- **`frontend/swap/KNOWN_ISSUES.md`** — open bugs + gaps with fix IDs (F1, F7, F8, F12, F14, F15, F19, F21 etc). Updated as issues are found.
- **Memory at `~/.claude/projects/-workspaces-minotaur-apps/memory/`** — durable facts that survive across sessions (OSS conventions, project-specific rules).

If a session is starting cold (no recent context), follow this order:
1. Read `SESSION_BRIEF.md`.
2. Read `KNOWN_ISSUES.md`.
3. Read the latest spec in `docs/superpowers/specs/`.
4. Run the verify-state commands from the session brief.
5. Then proceed.

## Repo purpose

App Intent implementations for [Subnet 112 (Minotaur)](https://github.com/subnet112/minotaur_subnet). Each app is a Solidity contract that inherits the platform's `AppIntentBase` plus a JS scoring module that runs in the validator's V8 sandbox. The Bittensor subnet's Solving Engine handles execution; this repo defines *outcome + scoring*, not routing.

`frontend/swap/` is a standalone Vite + React DEX swap app that is the reference implementation for `DexAggregatorApp`.

## Commands

```bash
# One-time: pull the platform contracts submodule (provides AppIntentBase et al.)
git submodule update --init --recursive

# Build / test contracts
forge build
forge test -v
forge test --match-test test_NameHere -vvv   # single test
forge test --match-contract DexAggregatorTest -vvv
```

`forge install` is also fine for the submodule on a fresh clone. CI (`.github/workflows/tests.yml`) runs `forge build --sizes` and `forge test -vvv`.

Frontend build lives entirely in `frontend/swap/` — run `pnpm install && pnpm dev` from that directory.

## Architecture

### Contract layout: `contracts/src` vs `contracts/draft`

- **`contracts/src/`** — production-track apps. Currently only `DexAggregatorApp.sol`. Everything here is covered by tests and deploy scripts.
- **`contracts/draft/`** — apps from the README table (`DCA`, `PortfolioRebalancer`, `YieldOptimizer`, `LPOptimizer`) plus example contracts (`SwapApp`, `ArbitrageApp`) that are **not** in the foundry build path (`foundry.toml` sets `src = "contracts/src"`). Treat `draft/` as a staging area; promoting an app means moving its `.sol` to `contracts/src/`, its scoring `.js` to `contracts/scoring/`, its test to `contracts/test/`, and its deploy script to `contracts/script/`.

Scoring modules under `contracts/scoring/` are paired 1:1 with a contract under `contracts/src/`; both files together fully describe the app.

### Platform inheritance — `AppIntentBase`

App contracts inherit `AppIntentBase` from the submodule at `lib/minotaur_contracts/`. The base class owns:
- Order verification, relayer auth, validator quorum (`quorumBps` is read live from `ValidatorRegistry`, **not** constructor-injected — recent refactor 03511f7).
- Protocol fee accounting (`platformFeeCollector`, `_clampFee`, `_calculateProtocolFee`).
- `EphemeralProxy` deployment + plan execution.
- Two fee modes:
  - `FeeMode.USER` — protocol fee pulled from the user up-front, before `_handleIntent` runs.
  - `FeeMode.APP` — app must deliver the fee in WETH to `platformFeeCollector` before `_handleIntent` returns. The base verifies the collector balance grew by `feeOwed` and reverts otherwise. **Silent skip is not an option.**

The app subclass only implements `_handleIntent(order, plan)` → dispatches on `intentSelector`, runs the plan via the proxy, captures app-specific revenue, returns `(score, valid)`.

### DexAggregator-specific architecture

`DexAggregatorApp` runs in `FeeMode.APP` by default. The fee-settlement contract is non-obvious:

1. **Single user allowance.** The user only approves `amountIn` of `tokenIn`. They never hold or approve WETH.
2. **Fee from output when possible.** If `tokenOut == WETH` and the swap surplus covers the fee, deduct in-place — no extra DEX hop, no paymaster touch.
3. **Paymaster fallback.** Otherwise, `safeTransferFrom(appPaymaster, platformFeeCollector, fee)` in WETH. The `appPaymaster` defaults to `feeCollector` if the constructor receives `address(0)` — so the same address (a) collects positive-slippage fees in `tokenOut` and (b) holds a WETH float to cover protocol fees. Operators wanting to split those roles pass a distinct `_appPaymaster`.
4. **Positive-slippage capture.** After fees, `((gained - minAmountOut) * feeBps) / 10000` of `tokenOut` goes to `feeCollector`; remainder to receiver.
5. **Auto-unwrap.** When `unwrapOutput && tokenOut == WETH`, the user portion is unwrapped to native ETH/TAO before delivery. The slippage fee stays in WETH.

The `_calculateProtocolFee` override matters: SWAP intent params have 11 fields with the fee at index 9 (`unwrapOutput` follows it), so the default "read trailing 32 bytes" decoder would return the bool. BRIDGE has 5 fields with the fee trailing, so the override delegates to the base helper.

### Intent params encoding (SWAP)

```solidity
abi.encode(
    address tokenIn, address tokenOut,
    uint256 amountIn, uint256 minAmountOut, address receiver,
    uint256 permitDeadline, uint8 permitV, bytes32 permitR, bytes32 permitS,
    uint256 platformFeeWei,
    bool unwrapOutput
)
```

Changing the field order or count requires re-checking `_calculateProtocolFee` and every test that calls `abi.encode` for params.

### Deployment

Apps deploy permissionlessly through the validator API, **not** via `forge create`. `contracts/script/DeployDexAggregator.s.sol` exists for direct deployment and documents the required env vars verbatim. The flow:

1. POST contract source + scoring module to `/v1/apps/`
2. POST `/v1/apps/{app_id}/deploy?chain_id=…`
3. POST `/v1/apps/{app_id}/activate`

The relayer pays gas.

## Frontend (`frontend/swap/`)

Standalone Vite + React 18 DEX swap app. **No submodule consumption** —
runs from a clean clone:

```bash
cd frontend/swap && pnpm install && pnpm dev
```

The design contract (visual JSX + CSS) was lifted from a designer's
rebuild — every class name, every BracketCorners span, every modal
z-layer matches the rebuild's prototype. Functional core is the 7 hooks
+ Zustand store + ethers v6 signing path. The 11-field SWAP intent
encoding is locked by `tests/unit/intent-params.test.ts`.

Hybrid composition per `docs/superpowers/specs/2026-05-25-phase-12.5-hybrid-rebase-spec.md`:
- 6 components kept verbatim from the design tree (chrome + simple
  display: AppPageHeader, HeaderIconButton, WalletConnectPanel,
  WalletModeBlock, QuoteCard, WalletButton).
- 6 components rewritten from `archive/frontend-swap/components/`
  using the design's JSX/CSS (ActionButton, OrderStatusCard,
  TokenSelectorModal, SettingsSheet, RevealPanel, SwapForm).

Toasts use a custom 5-variant `useToast()` from
`src/components/shell/ToastViewport.tsx` (no sonner). Async flows
follow the sticky-loading-update idiom — fire `toast.loading({...})`,
capture the id, transition with `toast.update(id, {...})` on resolve.

Visual regression (`pnpm test:visual`) runs pixelmatch against a 20-state
baseline captured from the designer rebuild (clipped to the
swap-surface region). Drift fails CI. Pagewire (`tests/e2e/*.sh`)
drives the running dev server through deterministic states via URL
params honored by `useDevPreviewState` (DEV builds only).

## Designer rebuild reference (`design/`)

The designer's rebuild — an Astro/Vite pnpm monorepo — was the visual
source-of-truth during the DEX consolidation. It lives **outside the
repo** (gitignored at `design/`). Unzip the rebuild locally if you need
to re-capture visual regression baselines (run `pnpm install` inside
`design/dex/minotaur-mainapp-rebuild/`, then `pnpm -C apps/app dev`
to serve it on port 4324, then `pnpm snapshot:baseline` from
`frontend/swap/`).

The 20 baseline PNGs are committed at `frontend/swap/tests/visual/baseline/`
so the regression suite works without the source tree.

## Conventions

- Solidity 0.8.24, `via_ir = true`, optimizer at 200 runs (`foundry.toml`).
- Remappings live in `foundry.toml`, not `remappings.txt`. `forge-std` and `@openzeppelin` resolve **through** the `minotaur_contracts` submodule's own libs — don't add a top-level `lib/forge-std`.
- Tests use Foundry's `Test`; mocks live in `contracts/test/mocks/` (currently just `MockToken.sol`; in-test mocks like `MockDex` live alongside the test file).
- New app = `contracts/src/YourApp.sol` + `contracts/scoring/your_app_scoring.js` + a deploy script + tests, plus a row in the README table.
