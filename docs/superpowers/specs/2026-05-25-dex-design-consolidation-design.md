# DEX Design Consolidation — Design Spec

**Date:** 2026-05-25
**Status:** Approved (pending user review of this written spec)
**Branch:** `feat/dex-design-consolidation`
**Scope owner:** This repo (`subnet112/minotaur-apps`)

---

## 1. Summary

Replace `frontend/swap/` with a clean, runnable, OSS-grade Vite + React DEX swap app. Visual contract is the designer's rebuild at `design/dex/minotaur-mainapp-rebuild/apps/app/src/pages/dex-aggregator/` (verbatim JSX + CSS). Functional contract is the existing `frontend/swap/` hooks/store/types/utils (full parity, all 3 wallet modes, cross-chain, native input, comparison quotes, Bittensor proxy delegation). Outcome: `pnpm install && pnpm dev` works from a clean clone, swap flow is fully functional against the public Minotaur API, and pagewire-driven visual regression proves zero drift from the design baseline.

---

## 2. Goals

1. A single self-contained Vite + React app at `frontend/swap/`, no submodule / host-app dependency.
2. Every visual surface (header, form, quote, status, modals, mode block, reveal panel, action button states) matches the design tree's JSX and CSS exactly.
3. Every functional behavior the existing code does still works: connect any of 3 wallet modes (managed / MetaMask / Bittensor), fetch quotes (incl. Bittensor `sim_swap` and CoW + Paraswap comparison), submit orders (incl. EIP-712 signing for external wallets and native-input direct-submit path), poll order status to terminal, persist recent swaps in localStorage.
4. OSS-grade tests: vitest unit tests for invariants, pagewire E2E flows, pixelmatch visual regression vs. design baseline.
5. Clear OSS conventions: `AGENTS.md` for agent guidance, no Claude attribution in commits, `.env.example` documenting required config.
6. Old `frontend/swap/` retired visual code preserved at `archive/frontend-swap/` for reference; design tree at `design/` kept until consolidation verified, then removed.

---

## 3. Non-goals

- The other six platform routes (marketplace, orders, miners, network, orders-create, apps-deploy). They belong to a separate platform repo per the design's own handoff.
- The platform shell chrome (`.app-h` top header, `.app-f` footer, Vestige background, `.app-callout`, ⌘K command palette). This repo owns `.app-ph` and below. Per HANDOFF_DEX_AGGREGATOR.md §1.
- Re-imagining or improving the design. Design is locked. If the design is wrong, raise it against the designer's rebuild — don't patch it here.
- New features the existing functional code does not already do. No scope creep mid-port.
- The wallet menu dropdown (connected-state menu) and chain picker dropdown — both flagged "design pending" in IMPL guide §3.2 + §4.3. Ship the prototype's disconnect-on-click placeholder for now; surface as a TODO.
- Wallet provider testnet broadcasts in CI. The order submission path is unit-tested via the intent-params encoding invariant; live wallet flows are manual-test territory.

---

## 4. Locked decisions

| Topic | Decision |
|---|---|
| **Scope cut** | Full functional parity with current `frontend/swap/`; nothing trimmed. |
| **Route** | `/swap` (with `/` → `<Navigate to="/swap" replace />`). |
| **Repo location** | New app stays at `frontend/swap/`. Old code archived (not deleted) at `archive/frontend-swap/`. |
| **API backend (default)** | Vite `/api` proxy → `https://api.minotaursubnet.com`. Overridable via `VITE_API_URL`. |
| **Toasts** | Full refactor: every `sonner` call site rewritten to design's `useToast()` with sticky-loading→update idiom (IMPL guide §5). |
| **Tests** | vitest (unit) + pagewire (E2E) + pixelmatch (visual diff). 20-state visual matrix. |
| **Docs** | `AGENTS.md` (tool-agnostic) replaces `CLAUDE.md` before merge. README rewritten for OSS quickstart. |
| **Commit attribution** | No `Co-Authored-By: Claude` trailers. Plain commit messages. |
| **Bittensor WS URL** | Default `wss://entrypoint-finney.opentensor.ai:443` (Finney mainnet), `VITE_BITTENSOR_WS_URL` override. |

---

## 5. Architecture

### 5.1 Target repo layout

```
minotaur-apps/
├── AGENTS.md                       (tool-agnostic, formerly CLAUDE.md)
├── README.md                       (rewritten for OSS quickstart)
├── CONTRIBUTING.md / LICENSE / SECURITY.md  (unchanged)
├── .gitignore                      (extended)
├── foundry.toml                    (unchanged)
├── contracts/                      (unchanged — Solidity)
├── lib/minotaur_contracts/         (unchanged — git submodule)
├── frontend/swap/                  ← THE OSS DEX APP
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── vite.config.ts              (alias @/ → src/, /api proxy)
│   ├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
│   ├── index.html
│   ├── .env.example                (VITE_API_URL + VITE_BITTENSOR_WS_URL)
│   ├── README.md                   (frontend quickstart)
│   ├── public/
│   │   ├── logo-minotaur.svg
│   │   └── lockup-minotaur.svg
│   ├── src/
│   │   ├── main.tsx                (StrictMode + BrowserRouter + ToastProvider)
│   │   ├── App.tsx                 (router: / → /swap; /swap → <SwapPage />)
│   │   ├── pages/
│   │   │   ├── SwapPage.tsx        (orchestrator, replaces design's DexAggregatorPage)
│   │   │   └── SwapPage.mappers.ts (QuoteResult → MockQuote etc.)
│   │   ├── components/
│   │   │   ├── primitives/
│   │   │   │   └── BracketCorners.tsx
│   │   │   ├── shell/
│   │   │   │   ├── ToastViewport.tsx
│   │   │   │   └── index.ts        (ToastProvider, useToast)
│   │   │   └── dex-aggregator/     ← 12 design components, 1:1 JSX/CSS
│   │   │       ├── AppPageHeader.tsx
│   │   │       ├── WalletButton.tsx
│   │   │       ├── WalletConnectPanel.tsx
│   │   │       ├── HeaderIconButton.tsx
│   │   │       ├── RevealPanel.tsx
│   │   │       ├── SwapForm.tsx
│   │   │       ├── TokenSelectorModal.tsx
│   │   │       ├── WalletModeBlock.tsx
│   │   │       ├── ActionButton.tsx
│   │   │       ├── QuoteCard.tsx
│   │   │       ├── OrderStatusCard.tsx
│   │   │       └── SettingsSheet.tsx
│   │   ├── hooks/                  (7 hooks, ported from frontend/swap/hooks/)
│   │   ├── api/client.ts           (lifted from design; superset of frontend/swap needs)
│   │   ├── config/chains.ts        (reconciled: design + frontend/swap extras)
│   │   ├── store.ts                (ex swap.store.ts — Zustand)
│   │   ├── selectors.ts            (NEW — derived selectors for design's union types)
│   │   ├── types.ts                (ex swap.types.ts + design's ToastVariant)
│   │   ├── utils.ts                (ex swap.utils.ts)
│   │   └── styles/
│   │       ├── tokens.css
│   │       ├── page.css
│   │       ├── components.css      (§00.18–00.23, .app-* family)
│   │       ├── components-swap.css (§00.24–00.30, .sw-* family)
│   │       └── extensions.css      (minus dex-stage prototype scaffolding)
│   └── tests/
│       ├── unit/                   (vitest)
│       ├── e2e/                    (pagewire shell scripts)
│       └── visual/                 (baseline/, current/, diff.sh)
├── archive/frontend-swap/          (retired visual components, kept for reference)
└── docs/superpowers/
    ├── specs/2026-05-25-dex-design-consolidation-design.md  (this file)
    └── plans/                       (writing-plans output lands here)
```

**Layout rationale:**
- `frontend/swap/` preserves the repo's existing path conventions; "swap" names what the app does.
- `src/` is standard Vite convention; separates project config from source.
- `components/dex-aggregator/` keeps the design's folder name (drop the design's `_components/` underscore — this is the production location now).
- `archive/` is at repo root, not nested under `frontend/`, so it's a clean signal of "not active code" and easy to delete in one motion once verified.
- Tests in `tests/` (not co-located with `src/`) keeps source clean and groups three test flavors (unit / e2e / visual) cleanly.
- Design tree's `_state.ts` + `_mock.ts` do not ship — replaced by real store + hooks.
- Design tree's `StateSwitcher.tsx` does not ship — URL-state previewer meaningless with real Zustand.

### 5.2 Build & run stack

**Toolchain:** Node 20+, pnpm 10, TypeScript ~5.8.3, Vite 5 + `@vitejs/plugin-react`. No Tailwind.

**Runtime deps:**

```jsonc
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.1.1",
    "zustand": "^5.0.0",
    "ethers": "^6.13.0",
    "@polkadot/api": "^15.0.0"
  }
}
```

`ethers` and `@polkadot/api` are dynamic-imported by hooks/store but declared explicit so install-time resolution is deterministic.

**Dev deps:**

```jsonc
{
  "devDependencies": {
    "@types/react": "^18.3.22",
    "@types/react-dom": "^18.3.7",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "~5.8.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.0",
    "@vitest/ui": "^2.1.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "jsdom": "^25.0.0",
    "pixelmatch": "^6.0.0",
    "pngjs": "^7.0.0"
  }
}
```

Pagewire is **not** a dependency. It's an external CLI invoked via absolute path. Documented in `tests/e2e/README.md`.

**`vite.config.ts`:**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const PUBLIC_MINOTAUR_API = 'https://api.minotaursubnet.com'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || PUBLIC_MINOTAUR_API,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: { target: 'es2022', sourcemap: true },
})
```

**`.env.example`:**

```
# Aggregator API URL. Leave unset to use the public default
# (https://api.minotaursubnet.com configured in vite.config.ts).
# Override for local dev against a locally-running validator + API.
VITE_API_URL=

# Bittensor subtensor WS URL used by useWalletConnection.setupBittensorProxy.
# Default targets the public Finney mainnet endpoint.
VITE_BITTENSOR_WS_URL=wss://entrypoint-finney.opentensor.ai:443
```

**Scripts:**

```jsonc
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "test": "pnpm run test:unit && pnpm run test:visual",
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "test:e2e": "bash tests/e2e/swap-happy-path.sh",
    "test:visual": "bash tests/visual/diff.sh",
    "snapshot:baseline": "bash tests/visual/capture-baseline.sh",
    "snapshot:current": "bash tests/visual/capture-current.sh"
  }
}
```

**Routing:**
- `/` → `<Navigate to="/swap" replace />`
- `/swap` → `<SwapPage />`
- `*` → simple 404 placeholder

**Dev URLs:**
- App: `http://localhost:5173/swap`
- API proxy: `http://localhost:5173/api/v1/...` → `https://api.minotaursubnet.com/v1/...`

### 5.3 State + component composition

**Core principle:** design components don't change their prop signatures. SwapPage builds those props from the real Zustand store + hooks instead of from URL params + mocks. This is the boundary that protects the design from drift.

**Store (`src/store.ts`):** keeps existing `swap.store.ts` shape verbatim. Slices: wallet, app, form, quote, order, approval, status, history, ui. Same setters, same `getActiveAddress()`, same `checkAllowance()`, same `addToHistory()` / `loadHistory()` with localStorage key `recent-swaps:{walletAddress}` per IMPL guide §7.

**Selectors (`src/selectors.ts`, new):** two pure functions that translate raw store state into the design's union types. Skeleton:

```ts
// Maps store conditions → design's 12-state ActionState union (IMPL guide §3.9)
// Note: walletMode is always one of 'external' | 'managed' | 'bittensor'.
// "disconnected" is conveyed by !walletConnected, NOT by a walletMode value.
export function selectActionState(s: SwapState): ActionState {
  if (!s.walletConnected) return 'disconnected'
  if (s.walletMode === 'external' && s.walletChainId !== s.sourceChainId) return 'wrong-network'
  if (!s.inputAmount || parseFloat(s.inputAmount) === 0) return 'empty'
  if (s.isCrossChain && s.sourceChainId === BITTENSOR_CHAIN_ID
       && s.chainId !== BITTENSOR_CHAIN_ID && !s.evmRecipient) return 'enter-recipient'
  if (parseFloat(s.inputAmount) > parseFloat(s.inputBalance ?? '0')) return 'insufficient'
  if (s.loading) return 'fetching'
  if (!s.quote) return 'no-route'
  if (s.approving) return 'approving'
  if (s.needsApproval) return 'approving'
  if (s.submitting || (s.activeOrder &&
       !['filled','failed','cancelled'].includes(s.activeOrder.status))) return 'submitting'
  if (s.inputToken?.native && s.walletMode === 'external') return 'sign-broadcast'
  return 'swap-ready'
}

// Maps store conditions → which .sw-mode contextual block (if any) — IMPL guide §3.8
export function selectModeBlockVariant(s: SwapState): ModeBlock | null {
  if (s.walletMode === 'managed' && !s.managedWallet) return 'create-wallet'
  if (s.walletMode === 'managed' && parseFloat(s.inputBalance ?? '0') === 0) return 'fund-wallet'
  if (s.walletMode === 'external' && s.needsApproval && !s.approving) return 'approval'
  if (s.approving) return 'approving'
  if (s.inputToken?.native) return 'native-eth'
  if (s.walletMode === 'bittensor' && !s.bittensorProxySetup) return 'setup-proxy'
  return null
}
```

These translate to the design's exact 12 ActionState and 7 ModeBlock values per IMPL guide §3.8 / §3.9. Unit-tested in `tests/unit/selectors.test.ts`.

**Hooks:** the 7 existing hooks port verbatim with two mechanical adjustments:

1. **Path renames** — `'../swap.store'` → `'../store'`; `'../swap.utils'` → `'../utils'`; `'../swap.types'` → `'../types'`. `@/api/client` and `@/config/chains` imports stay (alias resolves to new location).
2. **Toast refactor** — every `sonner` call rewritten to `useToast()` (see §5.4).

No fetch logic changes. No signing flow changes. No polling cadence changes.

**SwapPage composition (`src/pages/SwapPage.tsx`):** mirrors design's `DexAggregatorPage.tsx` line-by-line — same JSX structure, same conditional rendering (`formShowQuote`, `formShowOrder`, `showRecipient`, modal mutual exclusion), same z-layer mounting. Differences limited to:

- Hooks fire side effects (`useAppBootstrap`, `useMetaMaskListener`, `useQuoteRequest`, `useQuoteExpiry`, `useWalletBalances`).
- Props sourced from store selectors instead of `usePrototypeState` + `_mock.ts`.
- `handleConnect` etc. become real wallet flows via `useWalletConnection`.
- `StateSwitcher` dropped.

**Mappers (`src/pages/SwapPage.mappers.ts`):** small pure functions that translate functional types into design component prop shapes. E.g., `mapQuoteResultToQuoteCardProps(quote: QuoteResult): MockQuote`. **These are the only place** the design's `MockToken` / `MockQuote` type names are re-exported and consumed. Real code doesn't pass `QuoteResult` directly into `<QuoteCard>` — it goes through the mapper. Keeps design components untouched.

**Data flow** (canonical user input → render path):

```
User types amount → store.setInputAmount()
                  ↓
useQuoteRequest detects change → 600ms debounce → api.getQuote()
                  ↓
store.setQuote(result)
                  ↓
React subscriber re-renders SwapPage
                  ↓
mapQuoteResultToQuoteCardProps(quote) → <QuoteCard quote={...} />
```

Same flow for: order submit → sign → poll → fill; wallet connect → token select → balance fetch.

### 5.4 Toast migration

Most invasive cross-cutting change. ~30 call sites across hooks and components.

**Provider placement:** `<ToastProvider>` wraps `<App />` inside `<BrowserRouter>` in `main.tsx`. Portal renders to `document.body`, z=120, bottom-right, max 3 visible.

**API mapping (mechanical rules):**

| Sonner | Design |
|---|---|
| `toast.success('Connected')` | `toast.success({ title: 'Connected' })` |
| `toast.error('Failed: ' + msg)` | `toast.error({ title: 'Failed', message: msg })` |
| `toast.info('Approving...')` | `toast.info({ title: 'Approving…' })` |
| `toast.loading('Submitting...')` | `const id = toast.loading({ title: 'Submitting…' })` (capture id) |
| (no analog) | `toast.transient({ title: 'Address copied' })` |

**Sticky-loading idiom** (only semantic change): async user-action handlers fire one loading toast then mutate it via `update(id, ...)` on resolve, instead of stacking separate loading + success toasts.

```ts
const id = toast.loading({ title: 'Submitting order…' })
try {
  const result = await api.submitOrder(...)
  toast.update(id, { variant: 'success', title: 'Order open', message: `#${result.order_id}` })
} catch (e) {
  toast.update(id, { variant: 'error', title: 'Submit failed', message: e.message })
}
```

**Call-site checklist** (mirrors IMPL guide §5):

| Trigger | Owner | Pattern |
|---|---|---|
| Connect external | `useWalletConnection.connectExternalWallet` | one-shot success / error |
| Create managed wallet | `useWalletConnection.createManagedWallet` | sticky-loading → success |
| Fund managed wallet | `useWalletConnection.fundManagedWallet` | sticky-loading → success |
| Connect Bittensor | `useWalletConnection.connectBittensorWallet` | one-shot success / error |
| Setup Bittensor proxy | `useWalletConnection.setupBittensorProxy` | sticky-loading → success |
| Copy address | `WalletButton` menu | `transient` |
| Disconnect | `WalletButton` menu | one-shot info |
| Approve ERC-20 | `useOrderSubmission` approval branch | sticky-loading → success |
| Submit order | `useOrderSubmission.submitSwap` | sticky-loading → success |
| Order filled | `useOrderSubmission` poll-on-fill | one-shot success (with surplus body) |
| Order failed | `useOrderSubmission` poll-on-fail | one-shot error |
| Settings saved | `SettingsSheet.onDone` | one-shot success |
| Quote fetch failure | `useQuoteRequest` catch | one-shot error |

**Removal:** no `sonner` in `package.json`. Grep + replace `import { toast } from 'sonner'` across hooks and components.

**Verification:** `pnpm typecheck` catches leftover string-API calls; `tests/unit/toast-coverage.test.ts` scans hook sources and asserts zero sonner imports + every `toast.loading` capture is paired with `toast.update`.

### 5.5 Testing strategy

Three layers.

#### Layer 1 — vitest unit tests (`tests/unit/`)

| File | What it locks |
|---|---|
| `store.test.ts` | Zustand actions: setChainId clears quote, swapTokens flips + clears amount, addToHistory 10-item cap + localStorage, checkAllowance native/managed/bittensor skip. |
| `selectors.test.ts` | All 12 `selectActionState` outputs + all 7 `selectModeBlockVariant` outputs across input matrix. |
| `intent-params.test.ts` | **Critical invariant.** Encodes SWAP intent end-to-end and asserts the 11-field layout byte-for-byte (fields 5–8 permit zeros, field 10 `unwrapOutput` bool). Locks contract ↔ frontend ABI. |
| `allowance.test.ts` | `BigInt(allowance) < BigInt(String(amount))`. Test with amounts >2^53 to prove string coercion is load-bearing. |
| `mappers.test.ts` | `mapQuoteResultToQuoteCardProps`, `mapStoreToSwapFormProps`. Pure functions, easy fixtures. |
| `components/*.test.tsx` | Render-without-crash smoke tests per design component (RTL + jsdom). Asserts `<BracketCorners>` renders 4 spans, expected class names appear, modal mutex works. |
| `toast-coverage.test.ts` | Grep test: zero `from 'sonner'` imports remain; every async path with `toast.loading` calls `toast.update(id, ...)`. |

CI gate: all unit tests pass.

#### Layer 2 — Pagewire E2E (`tests/e2e/`)

Shell scripts driving the dev server via pagewire. State driven by URL params honored in `import.meta.env.DEV` mode via a `useDevPreviewState` hook that dispatches store actions when known URL params are present. Stripped from production builds.

Initial scripts:
- `swap-happy-path.sh` — connect → quote → submit → poll-to-filled (against stub backend, dev preview state).
- `wallet-modes.sh` — each of 3 wallet modes opens its connect tab, hits CTA, lands connected.
- `cross-chain.sh` — Bittensor source → EVM dest, recipient row appears, validation works.

Invocation: `node /workspaces/minotaur-apps/pagewire-main/packages/cli/bin/pagewire.js …` (absolute path; no global link required).

CI gate: each script exits 0.

#### Layer 3 — Visual regression (`tests/visual/`)

- `baseline/` — PNGs captured from design tree's `apps/app` dex-aggregator route (truth).
- `current/` — PNGs captured from our `frontend/swap`.
- `diff/` — pixelmatch outputs for any drifted state.
- `diff.sh` — drives both captures + pixelmatch comparison + exit non-zero on drift.

**20-state matrix:**

| # | URL params | Captures |
|---|---|---|
| 01 | `?wallet=disconnected&form=idle` | Default landing |
| 02 | `?wallet=metamask&form=idle` | Connected, no amount |
| 03 | `?wallet=metamask&form=quote-loading` | Skeleton quote |
| 04 | `?wallet=metamask&form=quoted` | Quote filled |
| 05 | `?wallet=metamask&form=order&order=pending` | Order stepper pending |
| 06 | `?wallet=metamask&form=order&order=filled` | Filled terminal |
| 07 | `?wallet=metamask&form=order&order=failed` | Failed terminal |
| 08 | `?wallet=managed&mode=create-wallet` | Mode: create wallet |
| 09 | `?wallet=managed&mode=fund-wallet&form=quoted` | Mode + quote |
| 10 | `?wallet=metamask&mode=approval&form=quoted` | Mode: approve |
| 11 | `?wallet=bittensor&mode=setup-proxy` | Mode: proxy setup |
| 12 | `?wallet=bittensor&cross=1&form=quoted` | Cross-chain + recipient |
| 13 | `?overlay=wallet-panel&tab=managed` | Connect modal: Managed |
| 14 | `?overlay=wallet-panel&tab=metamask` | MetaMask tab |
| 15 | `?overlay=wallet-panel&tab=bittensor` | Bittensor tab |
| 16 | `?overlay=token-from` | Token selector |
| 17 | `?overlay=settings` | Settings sheet |
| 18 | `?overlay=settings&slippage=10` | High-slippage warning |
| 19 | `?history=1` | Recent Swaps reveal panel |
| 20 | `?debug=1&debugPanel=1` | Debug Info panel |

Viewport 1440×900, dark color scheme. Pixelmatch tolerance 0.005 (0.5%) per state by default; tighter (0.001) on form-critical states.

**Capture mechanics:**
- `pnpm setup:baseline` — one-time `pnpm install` inside design tree.
- `pnpm snapshot:baseline` — boots design's apps/app on :4324, pagewire scripts iterate matrix, write PNGs to `tests/visual/baseline/`.
- `pnpm snapshot:current` — same but against `frontend/swap` on :5173, writes to `tests/visual/current/`.
- `pnpm test:visual` — runs current capture + pixelmatch diff vs. baseline.

CI gate: zero state failures.

**Out of scope for tests:** real on-chain submission (no testnet broadcasts in CI), wallet provider integration (`window.ethereum` stubbed in dev preview), network failure recovery (follow-up pass).

---

## 6. Migration order (high-level)

Detailed step-by-step lands in the implementation plan (writing-plans output). High-level pass:

1. **Pre-flight.** Amend baseline commit to strip Claude trailer. Add `pagewire-main/` to `.gitignore` (done). Verify pagewire smoke test (done).
2. **Vite scaffold.** Write `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `.env.example`, `.gitignore` for `frontend/swap/`.
3. **Copy CSS + primitives + shell.** From design tree: 5 CSS files → `src/styles/`; `BracketCorners.tsx` → `src/components/primitives/`; `ToastViewport.tsx` + `index.ts` → `src/components/shell/`; logo SVGs → `public/`.
4. **Copy + adjust design components.** 12 design `_components/*.tsx` → `src/components/dex-aggregator/`. Drop `StateSwitcher.tsx`. Adjust imports from `'../_state'` / `'../_mock'` → real types in `src/types.ts`.
5. **Lift API + chain config.** From design tree: `api/client.ts` + `config/chains.ts` → `src/api/` + `src/config/`. Reconcile with what existing hooks need (design's is a superset).
6. **Move functional code.** `git mv` `frontend/swap/hooks/` → `frontend/swap/src/hooks/`; `swap.store.ts` → `src/store.ts`; `swap.types.ts` → `src/types.ts`; `swap.utils.ts` → `src/utils.ts`. Path-rename imports inside.
7. **Archive retired code.** `git mv frontend/swap/components/ archive/frontend-swap/components/`; same for `index.tsx`, `loader.ts`, `swap.config.ts`.
8. **Write selectors + mappers.** `src/selectors.ts` and `src/pages/SwapPage.mappers.ts`.
9. **Refactor toasts.** Repo-wide sonner → useToast migration with sticky-loading-update idiom.
10. **Write SwapPage + entry files.** `src/pages/SwapPage.tsx`, `src/App.tsx`, `src/main.tsx`. Add `useDevPreviewState` hook (URL-param → store dispatch, DEV only).
11. **Install + first run.** `pnpm install`, `pnpm dev`. Open `/swap`. Pagewire snap to verify visual baseline reproduces.
12. **Write unit tests.** vitest config, then the seven test files in §5.5 Layer 1.
13. **Write E2E scripts.** `swap-happy-path.sh`, `wallet-modes.sh`, `cross-chain.sh`. Verify each passes.
14. **Capture visual baselines.** Boot design's apps/app, drive pagewire script through 20-state matrix, save PNGs. Then capture current, run diff. Iterate any failures to zero.
15. **Docs pass.** Write `frontend/swap/README.md`, rewrite root `README.md`, rename `CLAUDE.md` → `AGENTS.md` with tool-agnostic content.
16. **Cleanup.** Remove `design/` tree once verified. Delete `archive/frontend-swap/` only on explicit user approval.
17. **Final PR.** Single PR to main, all CI green.

---

## 7. Open items / risks

| Item | Status | Mitigation |
|---|---|---|
| Wallet menu dropdown (connected state) | Design pending per IMPL §3.2 + §4.1 | Ship prototype's disconnect-on-click as placeholder. Surface TODO. |
| Chain picker dropdown | Design pending per IMPL §4.3 | Auto-match wallet's chain; no manual picker. Surface TODO. |
| `api.minotaursubnet.com` availability/CORS | External dependency | Vite proxy avoids browser CORS. If endpoint unstable, `.env.local` lets user point at local validator. |
| Visual diff false positives | Real-world risk | Tolerance per state, manual override flag. Investigate font rendering / sub-pixel AA differences in CI. |
| `useDevPreviewState` accidentally shipping to prod | Risk | Guarded by `import.meta.env.DEV`; Vite tree-shakes in prod builds. Unit-tested for dead-code elimination. |
| Bittensor proxy on Finney mainnet (real funds) | Risk | `.env.example` documents the URL is mainnet. Bittensor users self-aware about WS endpoints. |
| Public Minotaur API authentication / rate limits | TBD | Confirm with backend team during implementation. May need `.env` API key field. |

---

## 8. Acceptance criteria

1. ✅ `cd frontend/swap && pnpm install && pnpm dev` succeeds on a fresh clone with no manual config.
2. ✅ Visiting `http://localhost:5173/swap` renders the design's dex-aggregator surface identically to the design tree's `apps/app` route at `/apps/dex-aggregator`.
3. ✅ Connecting MetaMask, fetching a quote, and submitting an order against the public Minotaur API completes the full happy-path (quote → sign → poll → filled toast).
4. ✅ All 3 wallet modes connect end-to-end (managed via `/createWallet`, MetaMask via `eth_requestAccounts`, Bittensor via Polkadot.js extension).
5. ✅ Cross-chain Bittensor → EVM surfaces recipient row, validates EIP-55 checksum.
6. ✅ `pnpm typecheck` clean. `pnpm test:unit` 100% pass. `pnpm test:e2e` 100% pass. `pnpm test:visual` zero state failures.
7. ✅ `AGENTS.md` present and tool-agnostic. No `Co-Authored-By: Claude` trailers in branch history.
8. ✅ Root `README.md` documents the OSS quickstart, the project's architecture, and the contract addresses + scoring relationship to `contracts/`.
9. ✅ `frontend/swap/README.md` covers `pnpm dev`, `pnpm test`, `.env.example` usage, and how to run pagewire against the dev server.
10. ✅ `design/` tree removed (or explicitly retained on user instruction). `archive/frontend-swap/` may be retained until user signals "ship it."

---

## 9. Future work (explicitly deferred)

- Wallet menu dropdown when design lands.
- Chain picker dropdown when design lands.
- Mobile / responsive breakpoints — IMPL guide implies desktop-first; mobile pattern not in design catalog.
- Network failure recovery / retry policies — current implementation surfaces errors via toast but doesn't retry. Confirm with product whether retry is desired.
- Order failure retry policy — IMPL §9.7 says "no retry, New swap only"; confirm.
- Auth/rate limits against public API — depends on backend team.
- Real on-chain E2E tests against testnet (broadcasts gated by CI cost / Sepolia faucet flakiness).
