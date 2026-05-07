import { useEffect, useState } from 'react'
import { useSwapStore } from '../swap.store'

interface ComparisonQuote {
  protocol: string
  output: string      // raw amount in smallest unit
  outputFormatted: string
  status: 'loading' | 'success' | 'error' | 'unsupported'
  error?: string
}

/**
 * Fetch comparison quotes from CoW Swap and Paraswap when a Minotaur quote exists.
 * No API keys needed — both are free public APIs.
 */
export function useComparisonQuotes() {
  const store = useSwapStore()
  const [quotes, setQuotes] = useState<ComparisonQuote[]>([])

  useEffect(() => {
    if (!store.quote || !store.inputToken || !store.outputToken) {
      setQuotes([])
      return
    }

    const inputAddr = store.inputToken.address
    const outputAddr = store.outputToken.address
    const amount = String(store.quote.ready_params?.input_amount || '0')
    const chainId = store.isCrossChain ? store.sourceChainId : store.chainId
    const outputDecimals = store.outputToken.decimals

    // Only fetch for supported chains
    if (![1, 8453, 42161, 10].includes(chainId)) {
      setQuotes([])
      return
    }

    const abortController = new AbortController()

    const formatOutput = (raw: string, decimals: number) => {
      const n = Number(raw) / (10 ** decimals)
      return n > 1 ? n.toFixed(2) : n.toFixed(6)
    }

    // Fetch CoW Swap quote
    const fetchCow = async (): Promise<ComparisonQuote> => {
      const chainMap: Record<number, string> = {
        1: 'mainnet', 8453: 'base', 42161: 'arbitrum_one', 10: 'optimism',
      }
      const cowChain = chainMap[chainId]
      if (!cowChain) return { protocol: 'CoW Swap', output: '0', outputFormatted: '-', status: 'unsupported' }

      try {
        const res = await fetch(`https://api.cow.fi/${cowChain}/api/v1/quote`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sellToken: inputAddr,
            buyToken: outputAddr,
            sellAmountBeforeFee: amount,
            from: '0x0000000000000000000000000000000000000001',
            kind: 'sell',
          }),
          signal: abortController.signal,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          return { protocol: 'CoW Swap', output: '0', outputFormatted: '-', status: 'error', error: err.description || `HTTP ${res.status}` }
        }
        const data = await res.json()
        const buyAmount = data.quote?.buyAmount || '0'
        const feeAmount = data.quote?.feeAmount || '0'
        const hasFee = BigInt(feeAmount) > BigInt(amount) / 10n // fee > 10% of input
        return {
          protocol: 'CoW Swap',
          output: buyAmount,
          outputFormatted: formatOutput(buyAmount, outputDecimals) + (hasFee ? ' (high fee)' : ''),
          status: 'success',
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return { protocol: 'CoW Swap', output: '0', outputFormatted: '-', status: 'loading' }
        return { protocol: 'CoW Swap', output: '0', outputFormatted: '-', status: 'error', error: e.message }
      }
    }

    // Fetch Paraswap quote
    const fetchParaswap = async (): Promise<ComparisonQuote> => {
      try {
        const url = new URL('https://apiv5.paraswap.io/prices')
        url.searchParams.set('srcToken', inputAddr)
        url.searchParams.set('destToken', outputAddr)
        url.searchParams.set('amount', amount)
        url.searchParams.set('srcDecimals', String(store.inputToken!.decimals))
        url.searchParams.set('destDecimals', String(outputDecimals))
        url.searchParams.set('side', 'SELL')
        url.searchParams.set('network', String(chainId))

        const res = await fetch(url.toString(), { signal: abortController.signal })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          return { protocol: 'Paraswap', output: '0', outputFormatted: '-', status: 'error', error: err.error || `HTTP ${res.status}` }
        }
        const data = await res.json()
        const destAmount = data.priceRoute?.destAmount || '0'
        return {
          protocol: 'Paraswap',
          output: destAmount,
          outputFormatted: formatOutput(destAmount, outputDecimals),
          status: 'success',
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return { protocol: 'Paraswap', output: '0', outputFormatted: '-', status: 'loading' }
        return { protocol: 'Paraswap', output: '0', outputFormatted: '-', status: 'error', error: e.message }
      }
    }

    // Set loading state
    setQuotes([
      { protocol: 'CoW Swap', output: '0', outputFormatted: '...', status: 'loading' },
      { protocol: 'Paraswap', output: '0', outputFormatted: '...', status: 'loading' },
    ])

    // Fetch in parallel
    Promise.all([fetchCow(), fetchParaswap()]).then(results => {
      if (!abortController.signal.aborted) {
        setQuotes(results)
      }
    })

    return () => abortController.abort()
  }, [store.quote, store.inputToken, store.outputToken, store.chainId, store.sourceChainId, store.isCrossChain])

  return quotes
}
