# Minotaur Apps

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Solidity 0.8.24](https://img.shields.io/badge/solidity-0.8.24-363636.svg)](https://soliditylang.org/)
[![Subnet 112](https://img.shields.io/badge/bittensor-subnet112-purple)](https://github.com/subnet112/minotaur_subnet)

App Intent implementations for [Subnet 112 (Minotaur)](https://github.com/subnet112/minotaur_subnet) — the Bittensor subnet for distributed intent execution.

Each app defines an **outcome + scoring**. The network's Solving Engine (run by miners, validated by the subnet) figures out optimal execution.

## Apps

| App | Contract | Description |
|-----|----------|-------------|
| **DexAggregator** | `DexAggregatorApp.sol` | Multi-DEX token swaps with positive-slippage fee capture. Single-allowance flow — fee comes out of the swap output, never from a separate user pull. |
| **DCA** | `DCAApp.sol` | Dollar-cost averaging with a deposit model. Users pre-fund the contract, no per-execution approvals. |
| **PortfolioRebalancer** | `PortfolioRebalancerApp.sol` | Drift-based portfolio rebalancing. |
| **YieldOptimizer** | `YieldOptimizerApp.sol` | Aave V3 / Compound V3 yield optimisation. |
| **LPOptimizer** | `LPOptimizerApp.sol` | Liquidity-position optimisation. |

## Repository structure

```
contracts/
├── src/           App Solidity contracts (inherit AppIntentBase
│                  from subnet112/minotaur_contracts)
├── scoring/       JS scoring modules (deployed via the API's
│                  /v1/apps endpoint alongside the contract)
├── script/        Foundry deploy scripts
└── test/          Foundry tests
frontend/
└── swap/          DexAggregator swap UI (React) — consumed by
                   the user-facing mainapp via git submodule
```

### Frontend consumption model

`frontend/swap/` is **not a standalone npm package**. The TypeScript modules
import from path-aliased locations like `@/config/chains` and `@/api/client`
that resolve only inside the host application's `tsconfig` — the user-facing
mainapp consumes this directory as a git submodule and provides those aliases
through its own build.

If you want to use these components in a different host app, vendor the
directory and re-point the imports at your own chain config + API client. The
files are otherwise framework-agnostic React + TanStack Query + zustand and
have no other private dependencies.

## Building

```bash
# Install platform contracts (provides AppIntentBase) as a Foundry dependency
forge install subnet112/minotaur_contracts

# Build the app contracts
forge build

# Run tests
forge test -v
```

## Deploying an app

App contracts are deployed permissionlessly through the validator API rather
than directly via `forge create`. The submission flow is documented in the
[main subnet repo](https://github.com/subnet112/minotaur_subnet) under
`docs/`. In short:

1. POST the contract source + JS scoring module to `/v1/apps/`
2. POST `/v1/apps/{app_id}/deploy?chain_id=…` to compile + deploy
3. POST `/v1/apps/{app_id}/activate` to make it queryable for users

The relayer pays gas. Developers pay zero on-chain cost to deploy.

## Adding a new app

A new App is just two files under `contracts/`:

- `contracts/src/YourApp.sol` — Solidity contract inheriting `AppIntentBase`,
  declaring intent functions (e.g. `swap`, `bridge`, `rebalance`) and
  exposing `scoreIntent` for off-chain simulation.
- `contracts/scoring/your_app_scoring.js` — JS module exporting a
  `score(plan, state, context)` function that runs in the validator's
  V8 sandbox after on-chain simulation.

Both files together fully describe the app's outcome + scoring. The Solving
Engine handles execution.

## License

MIT — see [LICENSE](./LICENSE).
