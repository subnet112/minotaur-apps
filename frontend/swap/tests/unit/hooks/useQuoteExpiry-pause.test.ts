import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSwapStore } from '@/store'
import { useQuoteExpiry } from '@/hooks/useQuoteExpiry'

// ── helpers ──────────────────────────────────────────────────────────────────

function resetStore() {
  useSwapStore.setState({
    quote: null,
    quoteExpiry: null,
    activeOrder: null,
    submitting: false,
  })
}

const MOCK_QUOTE = { valid_for_seconds: 30 } as any

// ── F13 pause behavior ────────────────────────────────────────────────────────

describe('F13 pause behavior', () => {
  beforeEach(() => {
    resetStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    resetStore()
  })

  it('advances quoteExpiry normally when there is no active order', () => {
    useSwapStore.setState({ quote: MOCK_QUOTE })
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    // Initial tick fires synchronously — quoteExpiry should be 30
    expect(useSwapStore.getState().quoteExpiry).toBe(30)

    // Advance 5 seconds
    act(() => { vi.advanceTimersByTime(5000) })

    expect(useSwapStore.getState().quoteExpiry).toBe(25)
    expect(requestQuote).not.toHaveBeenCalled()
  })

  it('does NOT advance quoteExpiry while activeOrder is set', () => {
    useSwapStore.setState({ quote: MOCK_QUOTE })
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    // Confirm initial tick ran
    expect(useSwapStore.getState().quoteExpiry).toBe(30)

    // Set an active order — simulates order submission
    act(() => {
      useSwapStore.setState({ activeOrder: { orderId: 'test-order-1' } as any })
    })

    // Advance 10 seconds while active order is present
    act(() => { vi.advanceTimersByTime(10000) })

    // quoteExpiry must NOT have changed — timer was paused
    expect(useSwapStore.getState().quoteExpiry).toBe(30)
    expect(requestQuote).not.toHaveBeenCalled()
  })

  it('resumes countdown after activeOrder is cleared', () => {
    // Start with active order already set so initial tick is a no-op
    useSwapStore.setState({
      quote: MOCK_QUOTE,
      activeOrder: { orderId: 'test-order-2' } as any,
    })
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    // Initial tick: active order present → no-op; quoteExpiry remains null
    expect(useSwapStore.getState().quoteExpiry).toBeNull()

    // Advance 5 s while order is still active
    act(() => { vi.advanceTimersByTime(5000) })
    expect(useSwapStore.getState().quoteExpiry).toBeNull()

    // Clear the active order — next tick should write quoteExpiry
    act(() => {
      useSwapStore.setState({ activeOrder: null })
      vi.advanceTimersByTime(1000)
    })

    // Real time has advanced 6 s since startTime, so remaining ≤ 24
    const expiry = useSwapStore.getState().quoteExpiry
    expect(expiry).not.toBeNull()
    expect(expiry as number).toBeLessThanOrEqual(24)
  })
})
