import { useEffect } from 'react'
import { useSwapStore } from '../store'

/**
 * Countdown timer for quote expiry. Triggers re-quote when timer hits 0.
 *
 * The timer is fully paused while an active order is in progress (F13) so
 * that an in-flight order never races with an automatic re-quote and the
 * expiry countdown shown to the user does not advance during order execution.
 */
export function useQuoteExpiry(requestQuote: () => void) {
  const store = useSwapStore()

  useEffect(() => {
    if (!store.quote) {
      store.setQuoteExpiry(null)
      return
    }
    const validFor = store.quote.valid_for_seconds
    const startTime = Date.now()

    const updateExpiry = () => {
      // Read live store state so we don't act on a stale closure value.
      const { activeOrder, submitting, setQuoteExpiry } = useSwapStore.getState()

      // Pause the entire tick while an active order is in progress (F13).
      if (activeOrder) return

      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const remaining = Math.max(0, validFor - elapsed)
      setQuoteExpiry(remaining)
      // Don't re-quote while submitting or processing an active order
      if (remaining === 0 && !submitting && !activeOrder) {
        requestQuote()
      }
    }

    updateExpiry()
    const interval = setInterval(updateExpiry, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.quote])
}
