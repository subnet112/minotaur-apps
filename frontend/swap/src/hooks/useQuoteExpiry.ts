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
    // Guard against malformed responses: never let validFor fall below 5 s,
    // otherwise the loop below would refetch every tick.
    const validFor = Math.max(5, store.quote.valid_for_seconds || 0)
    let startTime = Date.now()
    let lastTriggerAt = 0

    const updateExpiry = () => {
      // Read live store state so we don't act on a stale closure value.
      const { activeOrder, submitting, setQuoteExpiry } = useSwapStore.getState()

      // Pause the entire tick while an active order is in progress (F13).
      if (activeOrder) return

      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const remaining = Math.max(0, validFor - elapsed)
      setQuoteExpiry(remaining)
      if (remaining === 0 && !submitting && !activeOrder) {
        // Rate-limit the refetch trigger to at most once per validFor window.
        // Without this, a requestQuote() that fails or returns without
        // updating store.quote (e.g. 429 from the validator's quote
        // rate limit) leaves remaining at 0, and the 1 s interval ends
        // up calling requestQuote() every tick — which only generates
        // more 429s. Resetting startTime and recording lastTriggerAt
        // bounds retries to one per validFor period.
        const now = Date.now()
        if (now - lastTriggerAt < validFor * 1000) return
        lastTriggerAt = now
        startTime = now
        requestQuote()
      }
    }

    updateExpiry()
    const interval = setInterval(updateExpiry, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.quote])
}
