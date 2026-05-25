# archive/frontend-swap

Old `frontend/swap/` visual components and submodule entry files, retired
during the DEX design consolidation. Kept for reference until the new
implementation in `frontend/swap/` is verified end-to-end.

| Original path | Why retired |
|---|---|
| `components/*.tsx` (14 files) | Replaced by design tree components in `frontend/swap/src/components/dex-aggregator/`. The new ones own the verbatim JSX + CSS contract from the designer's rebuild. |
| `index.tsx` | Was the submodule-export entry. The new app is standalone (Vite) and has its own `src/main.tsx`. |
| `loader.ts` | React Router data loader for the host app. Replaced by direct hook calls in `SwapPage`. |
| `swap.config.ts` | Re-exported `CHAIN_CONFIG` etc. from `@/config/chains` for submodule consumption. The new app imports directly from its own `src/config/chains.ts`. |

This whole directory can be deleted once `frontend/swap/` is shipped and the
team has signed off. Until then it stays here for diff-during-port reference.

The functional code (`hooks/`, `swap.store.ts`, `swap.types.ts`, `swap.utils.ts`)
is **not** here — it was moved into `frontend/swap/src/` in the same migration.
See `docs/superpowers/specs/2026-05-25-dex-design-consolidation-design.md` for
the full rationale.
