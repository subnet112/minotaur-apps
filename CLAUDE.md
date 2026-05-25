# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo purpose

App Intent implementations for [Subnet 112 (Minotaur)](https://github.com/subnet112/minotaur_subnet). Each app is a Solidity contract that inherits the platform's `AppIntentBase` plus a JS scoring module that runs in the validator's V8 sandbox. The Bittensor subnet's Solving Engine handles execution; this repo defines *outcome + scoring*, not routing.

The repo also vendors a React swap UI under `frontend/swap/` that the user-facing mainapp consumes as a git submodule (not a standalone package — see "Frontend" below).

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

There is no top-level frontend build — `frontend/swap/` has no `package.json` (see below).

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

**Not a standalone npm package.** No `package.json`, no `node_modules`, no build target. The directory exports React components that import from path-aliased locations (`@/config/chains`, `@/api/client`) which resolve only inside the host application's tsconfig.

`swap.config.ts` is the seam: it re-exports `CHAIN_CONFIG`, `TOKENS`, `DEFAULT_CHAIN_ID` from `@/config/chains` so swap-internal files can use a stable import path while the actual chain config lives in the host. When working in this directory, you cannot run or type-check it in isolation — you need the host app's tsconfig to provide `@/` aliases.

Stack: React + TanStack Query + zustand (`swap.store.ts`), wagmi/ethers v6 for wallet I/O.

## `design/dex/` (designer-prototype monorepo)

`design/dex/minotaur-mainapp-rebuild/` is the unzipped designer rebuild of the user-facing platform shell — an **Astro/Vite pnpm monorepo** (`apps/marketing`, `apps/app`, `apps/docs`, `packages/ui`). It is a **visual-only prototype**: design-locked CSS + JSX in `apps/app/src/pages/dex-aggregator/`, with no real API/wallet integration. See its `HANDOFF_DEX_AGGREGATOR.md` for the contract.

The split of responsibility is:
- `frontend/swap/` (this repo) — the functional implementation: real `/quote` + `/order` calls, wallet providers, store, polling, persistence.
- `design/dex/.../apps/app/src/pages/dex-aggregator/` — the visual contract: every component, class name, modal, and state variant the design owns.

Consolidation = port `frontend/swap/` to match the design's JSX/CSS contract while preserving its functional code.

## Conventions

- Solidity 0.8.24, `via_ir = true`, optimizer at 200 runs (`foundry.toml`).
- Remappings live in `foundry.toml`, not `remappings.txt`. `forge-std` and `@openzeppelin` resolve **through** the `minotaur_contracts` submodule's own libs — don't add a top-level `lib/forge-std`.
- Tests use Foundry's `Test`; mocks live in `contracts/test/mocks/` (currently just `MockToken.sol`; in-test mocks like `MockDex` live alongside the test file).
- New app = `contracts/src/YourApp.sol` + `contracts/scoring/your_app_scoring.js` + a deploy script + tests, plus a row in the README table.
