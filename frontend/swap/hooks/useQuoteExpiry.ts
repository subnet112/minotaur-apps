import { useEffect } from 'react'
import { useSwapStore } from '../swap.store'

/**
 * Countdown timer for quote expiry. Triggers re-quote when timer hits 0.
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
      const elapsed = Math.floor((Date.now() - startTime) / 1000)
      const remaining = Math.max(0, validFor - elapsed)
      store.setQuoteExpiry(remaining)
      // Don't re-quote while submitting or processing an active order
      if (remaining === 0 && !store.submitting && !store.activeOrder) {
        requestQuote()
      }
    }

    updateExpiry()
    const interval = setInterval(updateExpiry, 1000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.quote])
}
