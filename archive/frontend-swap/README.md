# archive/frontend-swap

Old `frontend/swap/` visual components and submodule entry files, retired
during the DEX design consolidation. **Kept indefinitely as a reference**
for the pre-consolidation behavior — useful when porting new features
that need to match the original UX or when comparing what the old
unstyled-but-functional app did vs. the new design-driven one.

| Original path | Why retired |
|---|---|
| `components/*.tsx` (14 files) | Replaced by design tree components in `frontend/swap/src/components/dex-aggregator/`. The new ones own the verbatim JSX + CSS contract from the designer's rebuild. |
| `index.tsx` | Was the submodule-export entry. The new app is standalone (Vite) and has its own `src/main.tsx`. |
| `loader.ts` | React Router data loader for the host app. Replaced by direct hook calls in `SwapPage`. |
| `swap.config.ts` | Re-exported `CHAIN_CONFIG` etc. from `@/config/chains` for submodule consumption. The new app imports directly from its own `src/config/chains.ts`. |

The functional code (`hooks/`, `swap.store.ts`, `swap.types.ts`, `swap.utils.ts`)
is **not** here — it was moved into `frontend/swap/src/` in the same migration.
See `frontend/swap/README.md` for the active layout.

## When to consult this directory

- Adding a new feature to `frontend/swap/` and want to see how the original
  implementation handled it.
- Debugging a behavior gap — compare the new design-driven component to its
  archived counterpart.
- Auditing functional parity claims (the new app should do everything the
  archived components did, except where explicitly deferred — see the
  consolidation spec's "Future work" section).

## When NOT to touch

- This directory does not compile or run. It's reference text only.
- Do not import from `archive/` in `frontend/swap/src/` code — those imports
  will fail in production builds and pollute the source tree.
