/**
 * Shared test utilities for hook unit tests.
 *
 * Exports:
 *  - HookWrapper: React wrapper providing BrowserRouter + ToastProvider context
 *  - resetStore():  restore Zustand store to initial state between tests
 *  - installEthereumStub(): install a configurable window.ethereum mock
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { ToastProvider } from '@/components/shell/ToastViewport'
import { useSwapStore } from '@/store'

// ── HookWrapper ──────────────────────────────────────────────────────────────

/**
 * Wrapper component for renderHook() calls.
 * Provides BrowserRouter + ToastProvider so hooks that call useToast() don't
 * throw. Mirrors the provider tree in main.tsx.
 */
export function HookWrapper({ children }: { children: ReactNode }) {
  return createElement(
    BrowserRouter,
    null,
    createElement(ToastProvider, null, children),
  )
}

// ── resetStore ───────────────────────────────────────────────────────────────

let _initialState: Record<string, unknown> | null = null

/**
 * Capture the Zustand store's initial state on first call, then restore it
 * in each subsequent call. Mirror the pattern from tests/unit/store.test.ts.
 *
 * Usage:
 *   beforeEach(() => {
 *     resetStore()
 *     localStorage.clear()
 *   })
 */
export function resetStore(): void {
  const current = useSwapStore.getState() as Record<string, unknown>

  if (_initialState === null) {
    // First call — snapshot only state values, not actions
    _initialState = {}
    for (const [k, v] of Object.entries(current)) {
      if (typeof v !== 'function') _initialState[k] = v
    }
  }

  // Collect current actions (functions) so they're preserved after reset
  const actions: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(current)) {
    if (typeof v === 'function') actions[k] = v
  }

  useSwapStore.setState({ ..._initialState, ...actions }, true)
}

// ── installEthereumStub ──────────────────────────────────────────────────────

export interface EthereumStub {
  request: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
}

/**
 * Install a minimal window.ethereum stub for tests that exercise wallet-
 * connected paths. Returns the stub object so individual tests can override
 * behavior with mockResolvedValueOnce / mockRejectedValueOnce.
 *
 * Usage:
 *   let eth: EthereumStub
 *   beforeEach(() => { eth = installEthereumStub() })
 *   afterEach(() => { delete (window as any).ethereum })
 */
export function installEthereumStub(): EthereumStub {
  const stub: EthereumStub = {
    request: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  }

  Object.defineProperty(window, 'ethereum', {
    configurable: true,
    writable: true,
    value: stub,
  })

  return stub
}
