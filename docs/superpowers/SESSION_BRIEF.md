# Session brief — Minotaur swap consolidation

**Last updated:** 2026-05-26
**Branch:** `feat/dex-design-consolidation`
**Remote:** pushed to `origin` (https://github.com/soundyogi/minotaur-apps), NOT pushed to `upstream` (https://github.com/subnet112/minotaur-apps).
**Open PR URL:** https://github.com/soundyogi/minotaur-apps/pull/new/feat/dex-design-consolidation (not yet opened)

This brief is the entry point for the next session. Read me first, then read the specs.

## Roadmap (one-glance status)

| Phase | What | Status |
|---|---|---|
| 0-13 | Consolidation: scaffold → port → tests → docs | ✅ done (21 commits) |
| 12.5 | Hybrid rebase: 6 components rewritten with real store wiring | ✅ done (6 commits) |
| 12.6 | Functional parity audit vs archive (21 gaps found, fixed) | ✅ done |
| 12.7 | Open issues: chain picker, recipient MetaMask button, clear-history, visual baseline crop | ✅ done (3 commits) |
| 12.8 | **Correctness fixes** (8 critical bugs + 12 should-fix) — F1 hook tests, F7-F8 abort/race, F12 quote refetch, F14-F15 balances, F19 history load, F21 native-input removal | 🟡 NEXT — spec drafted at `docs/superpowers/specs/2026-05-26-phase-12.8-correctness-fixes-spec.md` |
| (later) | Contract upgrade — make `executeIntent` payable, add WETH wrapping (F21 long-term) | 🔵 deferred to contracts repo |
| (later) | Design-pending: wallet menu, full chain picker, mobile responsive, etc. | 🔵 separate phase |
| PR | Open PR to subnet112/minotaur-apps | 🟡 awaiting user (branch is on user's fork only) |

## Backlog

Tracked in `frontend/swap/KNOWN_ISSUES.md` — 35 items by severity:
- 🔴 8 critical (Phase 12.8 closes these)
- 🟡 12 should-fix
- 🟢 15 future-work / design-pending

## TL;DR

Phases 0-13 of the DEX design consolidation are **done**. 21 commits on the branch. 54/54 unit tests pass, 3/3 E2E pass, 20/20 visual regression pass. The app boots cleanly via `pnpm dev` and renders the design with real store wiring.

But a deep audit (run at end of last session) found **35 outstanding items**:
- 🔴 8 critical correctness bugs
- 🟡 12 should-fix UX/spec gaps
- 🟢 15 future-work items (design-pending + nice-to-haves)

The next session should brainstorm + plan + execute **Phase 12.8 — Correctness Fixes**. See the spec at `docs/superpowers/specs/2026-05-26-phase-12.8-correctness-fixes-spec.md`.

## What's done

| Phase | Work | Commits |
|---|---|---|
| 0 | Stripped Claude trailers from baseline commits | history rewrite |
| 1 | Vite scaffold (package.json, vite.config, tsconfig, env, gitignore) | 1 |
| 2 | Moved old `hooks/` + `swap.*.ts` into `src/` (preserved git history) | 1 |
| 3 | Archived old visual components to `archive/frontend-swap/components/` | 1 |
| 4 | Lifted design assets: 5 CSS files, BracketCorners, ToastViewport, public SVGs, api/client.ts, config/chains.ts | 1 |
| 5 | Lifted 12 design components verbatim | 1 |
| 6 | Selectors (12+7 cases) + mappers + vitest infrastructure | 1 |
| 7 | Toast refactor: sonner → useToast, sticky-loading-update idiom | 1 |
| 8 | main.tsx, App.tsx, useDevPreviewState, SwapPage.tsx orchestrator | 1 |
| 9 | First run + pagewire smoke (19 design elements rendered) | (no commit) |
| 10 | Critical unit tests: intent-params, allowance, store, components | 1 |
| 11 | Pagewire E2E flows (happy-path, wallet-modes, cross-chain) | 1 |
| 12 | Visual regression: matrix.json, capture scripts, pixelmatch diff | 1 |
| 12.5 | Hybrid rebase (Path C): 6 components rewritten with real store wiring | 6 |
| 12.6 | Functional parity audit vs archive | (research doc) |
| 12.7 | Open issues: chain picker, .sw-recipient-mm CSS, clear-history button, visual baseline crop | 3 |
| 13 | Docs: frontend README, root README, CLAUDE.md → AGENTS.md | 3 |
| (cleanup) | Removed design/ from history via git filter-branch | 1 |
| (cleanup) | Long-lived archive/ README clarification | 1 |

**Total: 21 commits on the branch.**

## Repo state

```
minotaur-apps/
├── AGENTS.md                      ← tool-agnostic agent guidance
├── README.md                      ← OSS quickstart
├── CONTRIBUTING.md, LICENSE, SECURITY.md  (unchanged)
├── .gitignore                     ← extended: design/, pagewire-main/, pagewire-main.zip
├── foundry.toml                   (unchanged)
├── contracts/                     (unchanged — Solidity)
├── lib/minotaur_contracts/        (unchanged — git submodule)
├── frontend/swap/                 ← THE OSS DEX APP
│   ├── package.json, vite.config.ts, tsconfig*.json, index.html
│   ├── .env.example
│   ├── src/
│   │   ├── main.tsx, App.tsx
│   │   ├── store.ts, selectors.ts, types.ts, utils.ts
│   │   ├── api/client.ts
│   │   ├── config/chains.ts
│   │   ├── pages/SwapPage.tsx, SwapPage.mappers.ts
│   │   ├── components/{primitives, shell, dex-aggregator}/
│   │   ├── hooks/ (7 hooks + useDevPreviewState)
│   │   └── styles/ (5 design CSS files, ~265 KB)
│   ├── tests/
│   │   ├── unit/ (7 test files, 54 tests)
│   │   ├── e2e/  (3 shell scripts)
│   │   └── visual/ (matrix.json, baseline/ 20 PNGs, capture/diff scripts)
│   └── README.md
├── archive/frontend-swap/         ← reference: old components + entry files
└── docs/superpowers/
    ├── specs/
    │   ├── 2026-05-25-dex-design-consolidation-design.md
    │   ├── 2026-05-25-phase-12.5-hybrid-rebase-spec.md
    │   └── 2026-05-26-phase-12.8-correctness-fixes-spec.md  ← NEXT WORK
    ├── plans/2026-05-25-dex-design-consolidation-plan.md
    └── SESSION_BRIEF.md  ← THIS FILE
```

## Local environment

- **Node** 20+, **pnpm** 10+. Lock files in `frontend/swap/`.
- **Pagewire** installed at `/workspaces/minotaur-apps/pagewire-main/` (gitignored). Built. Playwright Chromium installed system-wide via `playwright install-deps`.
- **Design tree** at `/workspaces/minotaur-apps/design/` (gitignored). Has its own `node_modules`. Used for re-capturing visual baselines on port 4324.
- **Branch state:** clean working tree (after .claude/ and tsconfig.tsbuildinfo are gitignored).

## How to verify state in the next session

```bash
cd /workspaces/minotaur-apps
git status                  # should be clean (excluding .claude/ + .tsbuildinfo)
git log --oneline main..HEAD | wc -l  # expect 21
ls frontend/swap/tests/visual/baseline/ | wc -l  # expect 20 PNGs
cd frontend/swap
pnpm exec vitest run 2>&1 | tail -3  # 54 tests pass
pnpm dev > /tmp/dev.log 2>&1 &
sleep 4
curl -s http://localhost:5173/swap | head -3  # HTML present
kill %1
```

## Next session — recommended path

1. **Read this brief.**
2. **Read** `docs/superpowers/specs/2026-05-26-phase-12.8-correctness-fixes-spec.md`.
3. **Read** the deep audit findings — the previous session's chat log had them in a wall-of-text Explore agent output. The spec doc summarizes them but the original was longer.
4. **Check F21 research outcome** in this same session's git log (the research subagent's findings should be in a commit or follow-up message).
5. **Invoke `superpowers:brainstorming`** to design Phase 12.8. Focus on:
   - Hook test strategy (Q1 in the spec)
   - Balance API contract (Q3) — may need empirical research
   - Coverage targets (Q4)
   - Native-input outcome from F21 research (Q2)
6. **Invoke `superpowers:writing-plans`** with the brainstorm output to produce a step-by-step plan.
7. **Invoke `superpowers:subagent-driven-development`** to execute.

## Open architectural questions (must resolve in brainstorm)

- **Q1:** Hook test strategy. MSW or manual mocks? `renderHook` or wrapper? How to mock `window.ethereum`?
- **Q2:** ✅ **RESOLVED.** Contract does NOT support msg.value for native input. `executeIntent` is not payable, no WETH wrapping, zero Foundry tests for the path. Action: REMOVE native-input flow from frontend (delete `isNativeInput` branch in `useOrderSubmission.ts`). Contract upgrade is a separate phase against contracts repo.
- **Q3:** Does the API accept SS58 addresses for balance queries? (Empirical curl test)
- **Q4:** What's the coverage target? Add `vitest --coverage` to CI?

## Out of scope for Phase 12.8

- New features not in the archive.
- Re-architecting hooks or store.
- Contract changes (unless F21 mandates).
- Touching design CSS.
- Wallet menu dropdown + chain picker (design-pending — separate phase).

## Tooling notes for the new session

- **Pagewire** for UI iteration: `node /workspaces/minotaur-apps/pagewire-main/packages/cli/bin/pagewire.js …`.
- **Vitest** for unit tests; existing infra at `frontend/swap/vitest.config.ts` + `tests/unit/setup.ts`.
- **Subagent-driven development** worked well in this session — small focused passes, two-stage review.
- **Avoid:** dispatching subagents with vague instructions; reactive tier-list execution (Phase 12.5 Tier 1 was killed mid-flight because the architecture was wrong).

## Critical invariants (do not break)

1. **No `Co-Authored-By: Claude` trailers** in commit messages. Standing repo rule.
2. **No `MOCK_*` data constants** anywhere in `frontend/swap/src/`. Production paths are mock-free.
3. **11-field SWAP intent encoding** in `useOrderSubmission` is locked by `tests/unit/intent-params.test.ts`. Field order: `[tokenIn, tokenOut, amountIn, minAmountOut, receiver, permitDeadline, permitV, permitR, permitS, platformFeeWei, unwrapOutput]`. Drift breaks on-chain.
4. **BigInt allowance comparison** uses `BigInt(String(amount))` to avoid 2^53 overflow. Locked by `tests/unit/allowance.test.ts`.
5. **`design/`, `pagewire-main/`, `*.zip`** all gitignored and not in commit history. Don't accidentally re-commit.
6. **AGENTS.md is tool-agnostic.** No `Claude Code` specific phrasing.
7. **Design components in `src/components/dex-aggregator/` are sacred:**
   - 6 verbatim: AppPageHeader, HeaderIconButton, WalletButton, WalletConnectPanel, WalletModeBlock, QuoteCard.
   - 6 rewritten from archive markup but design class names + structure preserved 1:1.
   - Don't modify markup unless adding a brand-new design-pending feature.

## How to pick up if context is hot vs cold

**Hot pickup (same day):** read spec doc § "Recommended execution order" → start at step 1.

**Cold pickup (different day or different model):** read this brief in full → read spec doc → read AGENTS.md → run the verify-state commands above → brainstorm Phase 12.8.

## Last context

The previous session ended with:
1. The deep audit completed (Explore agent output, ~4000 words; consolidated into the Phase 12.8 spec).
2. User decision to pause and plan Phase 12.8 properly.
3. F21 research subagent dispatched in background — **completed**. Verdict: native-input is broken on-chain. Findings integrated into Q2 above and into the F21 row of the spec doc.
4. Prep deliverables (spec + this brief) committed and pushed.
