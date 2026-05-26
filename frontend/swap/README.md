# Minotaur Swap

DEX swap UI for Subnet 112 (Minotaur). Single-allowance multi-DEX
aggregation with positive-slippage fee capture. Reference frontend
for the [`DexAggregatorApp`](../../contracts/src/DexAggregatorApp.sol)
intent.

## Quickstart

Requires Node 20+ and pnpm 10.

```bash
pnpm install
pnpm dev          # http://localhost:5173/swap
```

The dev server proxies `/api` to `https://api.minotaursubnet.com` by
default. Override with `VITE_API_URL` in `.env.local` to point at a
local validator + aggregator API.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server on `:5173` |
| `pnpm build` | Type-check + production build → `dist/` |
| `pnpm preview` | Serve the production build |
| `pnpm typecheck` | TypeScript only, no emit |
| `pnpm test:unit` | vitest unit + component smoke tests (54 tests) |
| `pnpm test:e2e` | pagewire-driven E2E flows (requires dev server up) |
| `pnpm test:visual` | pixelmatch visual regression vs design baseline |
| `pnpm test` | unit + visual |
| `pnpm snapshot:baseline` | Re-capture baselines from design tree (requires the designer rebuild unzipped to `../../design/` and its `apps/app` dev server on `:4324`) |

## Architecture

Single-page Vite + React 18 build mounted at `/swap`. 12 design components
in `src/components/dex-aggregator/` compose against a Zustand store + 7
hooks that handle wallet I/O, quote fetching, EIP-712 signing, order
polling, and Bittensor proxy delegation.

```
src/
├── main.tsx                 Entry: StrictMode + Router + ToastProvider
├── App.tsx                  Routes: / -> /swap
├── pages/SwapPage.tsx       Orchestrator: composes design components
├── pages/SwapPage.mappers.ts  Store -> design prop translation
├── store.ts                 Zustand store (single source of truth)
├── selectors.ts             selectActionState, selectModeBlockVariant
├── hooks/                   7 hooks for side effects (API, wallet, polling)
├── components/
│   ├── primitives/BracketCorners.tsx
│   ├── shell/ToastViewport.tsx  Custom 5-variant useToast()
│   └── dex-aggregator/      12 design components (verbatim JSX + CSS)
├── api/client.ts            Aggregator API SDK
├── config/chains.ts         CHAIN_CONFIG, TOKENS, BITTENSOR_CHAIN_ID
├── styles/                  5 design CSS files (~265 KB total)
└── types.ts                 Shared type vocabulary
```

## How state flows

```
User types amount
  ↓
store.setInputAmount()
  ↓
useQuoteRequest detects → 600ms debounce → api.getQuote()
  ↓
store.setQuote(result)
  ↓
React re-renders SwapPage
  ↓
mapQuoteResultToQuoteCardProps(quote) → <QuoteCard .../>
```

Same path for: wallet connect, balance fetch, order submit, polling
to terminal status.

## Submitting orders

The frontend produces 11-field SWAP intent params for the on-chain
`DexAggregatorApp._swap` decoder:

```
abi.encode(
  address tokenIn, address tokenOut,
  uint256 amountIn, uint256 minAmountOut, address receiver,
  uint256 permitDeadline, uint8 permitV, bytes32 permitR, bytes32 permitS,
  uint256 platformFeeWei,
  bool unwrapOutput
)
```

This encoding is locked by `tests/unit/intent-params.test.ts` — any
drift breaks contract verification. See
`contracts/src/DexAggregatorApp.sol` for the on-chain side.

## Wallet modes

| Mode | Connect via | Sign via |
|---|---|---|
| **Managed** | Platform-internal keygen (POST `/v1/wallets`) | Server-side autosign — order moves to `pending` immediately |
| **External (MetaMask et al.)** | `window.ethereum.request({ method: 'eth_requestAccounts' })` | EIP-712 `signTypedData_v4` on the order hash |
| **Bittensor** | Polkadot.js extension via `window.injectedWeb3` | Substrate proxy.addProxy + extrinsic signing |

## Testing

Three layers:

- **Unit (vitest)** — `tests/unit/`. Locks invariants: 11-field intent
  encoding, `BigInt(String(amount))` allowance comparison, store
  actions, selectors, mappers, design component smoke tests.
- **E2E (pagewire)** — `tests/e2e/`. Shell scripts drive the dev
  server via [pagewire](https://github.com/unforkableco/pagewire),
  a Playwright wrapper that gives stable element refs. State is
  set deterministically via URL query params honored by
  `useDevPreviewState` (dev builds only).
- **Visual regression (pixelmatch)** — `tests/visual/`. Captures 20
  states from our app + the designer rebuild and compares
  pixel-by-pixel with per-state tolerances. Baselines committed at
  `tests/visual/baseline/`.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | (unset) → falls back to public Minotaur API in `vite.config.ts` | Aggregator API endpoint |
| `VITE_BITTENSOR_WS_URL` | `wss://entrypoint-finney.opentensor.ai:443` | Bittensor subtensor for proxy setup |

Copy `.env.example` to `.env.local` for overrides.

## Status

| Subsystem | Status |
|---|---|
| Core swap flow (EVM external) | ✅ working |
| Quote fetching + comparison | ✅ working |
| Approve ERC-20 + unlimited approval | ✅ working |
| Native input direct-submit path | ✅ working |
| Managed wallet (faucet, autosign) | ✅ working |
| Bittensor wallet + proxy setup | ✅ working |
| Cross-chain Bittensor → EVM | ✅ working |
| Custom token import via ethers | ✅ working |
| Recent swaps localStorage history | ✅ working |
| Visual regression (20-state matrix) | ✅ 20/20 PASS |
| Wallet menu (connected-state) | ⏸ design pending — placeholder shows disconnect-on-click |
| Chain picker UI | ⏸ design pending — basic dropdown ships as fallback |

## License

MIT — see [`../../LICENSE`](../../LICENSE).
