# Pagewire E2E flows

These shell scripts drive the dev server (`pnpm dev`) via pagewire — an
agent-first Playwright wrapper — to verify end-to-end behaviour. State
is driven by URL query params honored by `useDevPreviewState` (dev
builds only), so flows don't depend on real wallet providers or live
backends.

## Prereqs

- `pnpm install` inside `frontend/swap/`.
- pagewire installed at `/workspaces/minotaur-apps/pagewire-main/` and
  built (`pnpm install && pnpm build` inside that tree, plus
  `playwright install chromium && playwright install-deps chromium`).
- Dev server running: `pnpm dev` in another terminal.

## Run

From `frontend/swap/`:

```bash
bash tests/e2e/swap-happy-path.sh
bash tests/e2e/wallet-modes.sh
bash tests/e2e/cross-chain.sh
```

Or all at once:

```bash
pnpm test:e2e
```

## Driving state via URL params

The `useDevPreviewState` hook (`src/hooks/useDevPreviewState.ts`)
reads these params on mount and dispatches store actions:

| Param | Values | Effect |
|---|---|---|
| `wallet` | `disconnected` · `managed` · `metamask` · `bittensor` | Sets wallet mode + connection |
| `cross` | `1` | Toggles cross-chain |
| `overlay` | `token-from` · `token-to` · `settings` | Opens a modal |
| `history` | `1` | Shows Recent Swaps panel |
| `debug` | `1` | Surfaces the Debug icon + panel |

In production builds, the hook body is tree-shaken — URL params have
no effect.

## Tips

- Use `--no-daemon` for one-off CI runs; the kept-alive daemon is
  faster for interactive iteration. **Note:** with `--no-daemon`,
  React's Suspense lazy-load may show only the fallback if you snap
  too quickly — prefer the daemon mode for E2E tests.
- `pagewire snap --human` is the readable form; JSON is default.
- If a snap doesn't show what you expect, add
  `--wait-for "<selector>"` to wait for the right element.
