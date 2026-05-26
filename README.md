# Minotaur Apps

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Solidity 0.8.24](https://img.shields.io/badge/solidity-0.8.24-363636.svg)](https://soliditylang.org/)
[![Subnet 112](https://img.shields.io/badge/bittensor-subnet112-purple)](https://github.com/subnet112/minotaur_subnet)

App Intent implementations for [Subnet 112 (Minotaur)](https://github.com/subnet112/minotaur_subnet) — the Bittensor subnet for distributed intent execution.

Each app defines an **outcome + scoring**. The network's Solving Engine (run by miners, validated by the subnet) figures out optimal execution.

## What's in this repo

| Path | Purpose |
|---|---|
| `contracts/src/` | Production Solidity App contracts (currently `DexAggregatorApp.sol`). Inherit `AppIntentBase` from the `minotaur_contracts` submodule. |
| `contracts/scoring/` | JS scoring modules paired 1:1 with each contract. Run in the validator's V8 sandbox. |
| `contracts/draft/` | Staging area for new apps (DCA, PortfolioRebalancer, YieldOptimizer, LPOptimizer). Not in foundry's build path. |
| `contracts/test/` + `contracts/script/` | Foundry tests + deploy scripts. |
| `frontend/swap/` | **Standalone DEX swap app** — Vite + React reference implementation for `DexAggregatorApp`. See [`frontend/swap/README.md`](frontend/swap/README.md). |
| `archive/` | Retired code, kept for reference until shipped. |
| `lib/minotaur_contracts/` | Platform contracts (`AppIntentBase`, `EphemeralProxy`, validator quorum) as a git submodule. |

## Apps

| App | Status | Contract | Description |
|---|---|---|---|
| **DexAggregator** | Production | `DexAggregatorApp.sol` | Multi-DEX token swaps with positive-slippage fee capture. Single-allowance flow — fee comes out of the swap output, never from a separate user pull. |
| DCA | Draft | `DCAApp.sol` | Dollar-cost averaging with a deposit model. Users pre-fund the contract; no per-execution approvals. |
| PortfolioRebalancer | Draft | `PortfolioRebalancerApp.sol` | Drift-based portfolio rebalancing. |
| YieldOptimizer | Draft | `YieldOptimizerApp.sol` | Aave V3 / Compound V3 yield optimisation. |
| LPOptimizer | Draft | `LPOptimizerApp.sol` | Liquidity-position optimisation. |

## Contracts — quickstart

```bash
git submodule update --init --recursive
forge build
forge test -v
forge test --match-contract DexAggregatorTest -vvv   # one suite
```

Solidity 0.8.24, optimizer 200 runs, `via_ir = true`. Remappings live in `foundry.toml`.

## Frontend (DEX swap UI) — quickstart

```bash
cd frontend/swap
pnpm install
pnpm dev      # http://localhost:5173/swap
```

Requires Node 20+, pnpm 10. Default API endpoint is `https://api.minotaursubnet.com`; override with `VITE_API_URL` in `.env.local`. See [`frontend/swap/README.md`](frontend/swap/README.md) for the architecture, scripts, and testing approach.

## Adding a new app

A new App is two files under `contracts/`:

- `contracts/src/YourApp.sol` — Solidity contract inheriting `AppIntentBase`, declaring intent functions (e.g. `swap`, `bridge`, `rebalance`), exposing `scoreIntent` for off-chain simulation.
- `contracts/scoring/your_app_scoring.js` — JS module exporting a `score(plan, state, context)` function that runs in the validator's V8 sandbox after on-chain simulation.

Plus a deploy script in `contracts/script/` and tests in `contracts/test/`. See `DexAggregatorApp` for the reference pattern.

## Deploying an app

App contracts deploy permissionlessly through the validator API rather than directly via `forge create`. The flow:

1. POST contract source + scoring module to `/v1/apps/`.
2. POST `/v1/apps/{app_id}/deploy?chain_id=…` to compile + deploy.
3. POST `/v1/apps/{app_id}/activate` to make it queryable for users.

The relayer pays gas. Developers pay zero on-chain cost to deploy.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security issues go through [SECURITY.md](SECURITY.md), not public issues.

## License

MIT — see [LICENSE](./LICENSE).
