/**
 * Unit tests for useQuoteExpiry hook.
 *
 * Covers:
 *  - Countdown ticks down 1 second at a time
 *  - At expiry (remaining === 0): calls requestQuote() when no submitting/activeOrder
 *  - At expiry: does NOT call requestQuote when submitting === true
 *  - At expiry: does NOT call requestQuote when activeOrder !== null
 *  - F13 regression: timer fully pauses while activeOrder !== null (3 tests from B)
 *  - Timer resumes after activeOrder clears
 *  - Cleanup: interval cleared on unmount
 *  - quoteExpiry changes mid-flight → countdown resets
 *  - No timer started when store has no quote
 */
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

// ── main suite ────────────────────────────────────────────────────────────────

describe('useQuoteExpiry', () => {
  beforeEach(() => {
    resetStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    resetStore()
  })

  // ── initial tick ─────────────────────────────────────────────────────────

  it('sets quoteExpiry to full valid_for_seconds on initial tick', () => {
    useSwapStore.setState({ quote: MOCK_QUOTE })
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    expect(useSwapStore.getState().quoteExpiry).toBe(30)
    expect(requestQuote).not.toHaveBeenCalled()
  })

  // ── countdown ticks ───────────────────────────────────────────────────────

  it('decrements quoteExpiry by 1 each second', () => {
    useSwapStore.setState({ quote: MOCK_QUOTE })
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    expect(useSwapStore.getState().quoteExpiry).toBe(30)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(useSwapStore.getState().quoteExpiry).toBe(29)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(useSwapStore.getState().quoteExpiry).toBe(28)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(useSwapStore.getState().quoteExpiry).toBe(27)

    expect(requestQuote).not.toHaveBeenCalled()
  })

  // ── expiry behavior ───────────────────────────────────────────────────────

  it('calls requestQuote when countdown reaches 0 and no submitting/activeOrder', () => {
    useSwapStore.setState({ quote: MOCK_QUOTE })
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    // Advance past full expiry
    act(() => { vi.advanceTimersByTime(30000) })

    expect(useSwapStore.getState().quoteExpiry).toBe(0)
    expect(requestQuote).toHaveBeenCalledTimes(1)
  })

  it('does NOT call requestQuote at expiry when submitting === true', () => {
    useSwapStore.setState({ quote: MOCK_QUOTE, submitting: true })
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    // Advance past full expiry
    act(() => { vi.advanceTimersByTime(30000) })

    expect(requestQuote).not.toHaveBeenCalled()
  })

  it('does NOT call requestQuote at expiry when activeOrder !== null', () => {
    useSwapStore.setState({
      quote: MOCK_QUOTE,
      activeOrder: { orderId: 'test-order-x' } as any,
    })
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    // All ticks are no-ops while activeOrder set; time passes but requestQuote never fires
    act(() => { vi.advanceTimersByTime(30000) })

    expect(requestQuote).not.toHaveBeenCalled()
  })

  // ── cleanup on unmount ────────────────────────────────────────────────────

  it('clears the interval on unmount and stops updating quoteExpiry', () => {
    useSwapStore.setState({ quote: MOCK_QUOTE })
    const requestQuote = vi.fn()

    const { unmount } = renderHook(() => useQuoteExpiry(requestQuote))

    act(() => { vi.advanceTimersByTime(2000) })
    expect(useSwapStore.getState().quoteExpiry).toBe(28)

    act(() => { unmount() })

    // After unmount, time advancing should not change quoteExpiry
    act(() => { vi.advanceTimersByTime(5000) })
    expect(useSwapStore.getState().quoteExpiry).toBe(28)
  })

  // ── quote change mid-flight ───────────────────────────────────────────────

  it('resets countdown when quote changes to a new object mid-flight', () => {
    useSwapStore.setState({ quote: MOCK_QUOTE })
    const requestQuote = vi.fn()

    const { rerender } = renderHook(() => useQuoteExpiry(requestQuote))

    act(() => { vi.advanceTimersByTime(10000) })
    expect(useSwapStore.getState().quoteExpiry).toBe(20)

    // Simulate receiving a fresh quote — setting a new object reference triggers the effect
    const NEW_QUOTE = { valid_for_seconds: 60 } as any
    act(() => {
      useSwapStore.setState({ quote: NEW_QUOTE })
      rerender()
    })

    // After re-render with new quote object the effect re-runs; initial tick fires immediately
    expect(useSwapStore.getState().quoteExpiry).toBe(60)
  })

  // ── no quote → no timer ───────────────────────────────────────────────────

  it('sets quoteExpiry to null and does not call requestQuote when quote is null', () => {
    // quote remains null (default)
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    act(() => { vi.advanceTimersByTime(5000) })

    expect(useSwapStore.getState().quoteExpiry).toBeNull()
    expect(requestQuote).not.toHaveBeenCalled()
  })

  // ── submitting set mid-countdown → suppresses re-quote ───────────────────

  it('suppresses requestQuote at expiry when submitting becomes true mid-countdown', () => {
    useSwapStore.setState({ quote: MOCK_QUOTE })
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    // Advance partway
    act(() => { vi.advanceTimersByTime(15000) })

    // Mark as submitting before expiry
    act(() => {
      useSwapStore.setState({ submitting: true })
    })

    // Advance past expiry
    act(() => { vi.advanceTimersByTime(15000) })

    expect(requestQuote).not.toHaveBeenCalled()
  })

  // ── resuming after submitting clears ─────────────────────────────────────

  it('allows requestQuote after submitting flag clears and countdown reaches 0', () => {
    useSwapStore.setState({ quote: MOCK_QUOTE, submitting: true })
    const requestQuote = vi.fn()

    act(() => {
      renderHook(() => useQuoteExpiry(requestQuote))
    })

    // Advance to expiry while submitting — no call expected
    act(() => { vi.advanceTimersByTime(30000) })
    expect(requestQuote).not.toHaveBeenCalled()

    // Clear submitting; on the very next tick (elapsed still >= 30) remaining is still 0
    act(() => {
      useSwapStore.setState({ submitting: false })
      vi.advanceTimersByTime(1000)
    })

    expect(requestQuote).toHaveBeenCalledTimes(1)
  })
})

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
