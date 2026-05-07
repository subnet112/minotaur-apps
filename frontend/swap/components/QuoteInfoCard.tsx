import { useEffect, useState } from 'react'
import { useSwapStore } from '../swap.store'
import { parseAmount, formatAmount, calculateRate } from '../swap.utils'
import { useComparisonQuotes } from '../hooks/useComparisonQuotes'

// CoinGecko IDs for native tokens per chain
const CHAIN_NATIVE: Record<number, { coingeckoId: string; symbol: string }> = {
  1: { coingeckoId: 'ethereum', symbol: 'ETH' },
  8453: { coingeckoId: 'ethereum', symbol: 'ETH' },
  964: { coingeckoId: 'bittensor', symbol: 'TAO' },
}

// RPC endpoints for live gas price
const CHAIN_RPC: Record<number, string> = {
  1: 'https://eth.llamarpc.com',
  8453: 'https://mainnet.base.org',
  964: 'https://lite.chain.opentensor.ai',
}

function useGasCostEstimate(gasUnits: number, chainId: number): string | null {
  const [costUsd, setCostUsd] = useState<string | null>(null)

  useEffect(() => {
    if (!gasUnits || !chainId) { setCostUsd(null); return }

    const info = CHAIN_NATIVE[chainId]
    const rpc = CHAIN_RPC[chainId]
    if (!info || !rpc) { setCostUsd(null); return }

    let cancelled = false

    async function fetchLive() {
      try {
        // Fetch gas price and native token USD price in parallel
        const [gasPriceRes, priceRes] = await Promise.all([
          fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_gasPrice', params: [], id: 1 }),
          }),
          fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${info.coingeckoId}&vs_currencies=usd`),
        ])

        const gasData = await gasPriceRes.json()
        const priceData = await priceRes.json()

        const gasPriceWei = parseInt(gasData.result, 16)
        const nativeUsd = priceData[info.coingeckoId]?.usd || 0

        if (cancelled || !gasPriceWei || !nativeUsd) return

        const costNative = gasUnits * gasPriceWei / 1e18
        const usd = costNative * nativeUsd

        if (usd < 0.001) setCostUsd('< $0.01')
        else if (usd < 1) setCostUsd(`~$${usd.toFixed(3)}`)
        else setCostUsd(`~$${usd.toFixed(2)}`)
      } catch {
        // Silent fail — gas cost is optional info
      }
    }

    fetchLive()
    return () => { cancelled = true }
  }, [gasUnits, chainId])

  return costUsd
}

function formatFeeEth(weiStr: string): string {
  const wei = BigInt(weiStr || '0')
  if (wei === 0n) return '0'
  const eth = Number(wei) / 1e18
  if (eth < 0.000001) return '< 0.000001'
  if (eth < 0.001) return eth.toFixed(6)
  return eth.toFixed(4)
}

export function QuoteInfoCard() {
  const store = useSwapStore()
  const quote = store.quote
  const comparisons = useComparisonQuotes()
  const chainId = store.isCrossChain ? store.sourceChainId : store.chainId
  const gasCostUsd = useGasCostEstimate(quote?.gas_estimate || 0, chainId)

  // Loading skeleton while refreshing
  if (!quote || !store.inputToken || !store.outputToken) {
    return (
      <div className="glass-border rounded-[var(--radius-card)] bg-[var(--bg-card)] backdrop-blur-[100px] p-6 w-full max-w-[560px] space-y-3 animate-pulse">
        <div className="flex justify-between">
          <div className="h-4 w-16 bg-white/10 rounded" />
          <div className="h-4 w-32 bg-white/10 rounded" />
        </div>
        <div className="flex justify-between">
          <div className="h-4 w-24 bg-white/10 rounded" />
          <div className="h-4 w-28 bg-white/10 rounded" />
        </div>
        <div className="flex justify-between">
          <div className="h-4 w-20 bg-white/10 rounded" />
          <div className="h-4 w-20 bg-white/10 rounded" />
        </div>
      </div>
    )
  }

  const inputAmountWei = store.inputAmount ? parseAmount(store.inputAmount, store.inputToken.decimals) : '0'

  // Determine if Minotaur is the best quote
  const minotaurOutput = BigInt(quote.estimated_output || '0')
  const bestExternal = comparisons
    .filter(c => c.status === 'success' && BigInt(c.output) > 0n)
    .reduce((best, c) => BigInt(c.output) > best ? BigInt(c.output) : best, 0n)

  return (
    <div className="glass-border rounded-[var(--radius-card)] bg-[var(--bg-card)] backdrop-blur-[100px] p-6 w-full max-w-[560px] space-y-3">
      <div className="flex justify-between text-sm">
        <span className="text-[var(--text-muted)]">Rate</span>
        <span>
          1 {store.inputToken!.symbol} ={' '}
          {(() => {
            const rate = calculateRate(inputAmountWei, quote.estimated_output, store.inputToken!.decimals, store.outputToken!.decimals)
            return rate ? rate.toFixed(6) : '\u2014'
          })()}{' '}
          {store.outputToken!.symbol}
        </span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-[var(--text-muted)]">Estimated Output</span>
        <span className="font-mono">{formatAmount(quote.estimated_output, store.outputToken!.decimals, 8)} {store.outputToken!.symbol}</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-[var(--text-muted)]">Min Output (slippage)</span>
        <span className="font-mono text-xs">{formatAmount(quote.suggested_min_output, store.outputToken!.decimals, 8)}</span>
      </div>
      {quote.route_summary && (
        <div className="flex justify-between text-sm">
          <span className="text-[var(--text-muted)]">Route</span>
          <span>{quote.route_summary}</span>
        </div>
      )}
      {quote.gas_estimate > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-[var(--text-muted)]">Gas Estimate</span>
          <span>
            {quote.gas_estimate.toLocaleString()} units
            {gasCostUsd && <span className="text-[var(--text-muted)] ml-1">({gasCostUsd})</span>}
          </span>
        </div>
      )}
      {quote.platform_fee_wei && BigInt(quote.platform_fee_wei || '0') > 0n && (
        <div className="flex justify-between text-sm">
          <span
            className="text-[var(--text-muted)] cursor-help"
            title="Gas reimbursement to the relayer. The relayer submits your transaction on-chain and pays ETH gas; this fee repays that cost (plus a small operating margin). Skipped when you submit the transaction yourself (e.g. native ETH swaps)."
          >
            Relayer Fee
          </span>
          <span className="font-mono">
            {formatFeeEth(quote.platform_fee_wei)} {quote.platform_fee_symbol || 'ETH'}
          </span>
        </div>
      )}
      {store.quoteExpiry !== null && (
        <div className="flex justify-between text-sm">
          <span className="text-[var(--text-muted)]">Quote expires in</span>
          <span className={store.quoteExpiry < 10 ? 'text-destructive' : ''}>{store.quoteExpiry}s</span>
        </div>
      )}

      {/* Comparison quotes */}
      {comparisons.length > 0 && (
        <>
          <div className="border-t border-white/10 my-1" />
          <p className="text-xs text-[var(--text-muted)] uppercase tracking-wider">Compare</p>
          <div className="flex justify-between text-sm">
            <span className="font-medium">Minotaur</span>
            <span className={`font-mono ${minotaurOutput >= bestExternal ? 'text-green-400' : ''}`}>
              {formatAmount(quote.estimated_output, store.outputToken!.decimals, 6)} {store.outputToken!.symbol}
              {minotaurOutput >= bestExternal && bestExternal > 0n && ' \u2714'}
            </span>
          </div>
          {comparisons.map(c => {
            const isBest = c.status === 'success' && BigInt(c.output) > 0n && BigInt(c.output) > minotaurOutput
            return (
              <div key={c.protocol} className="flex justify-between text-sm">
                <span className="text-[var(--text-muted)]">{c.protocol}</span>
                <span className={`font-mono ${c.status === 'loading' ? 'text-[var(--text-muted)] animate-pulse' : ''} ${isBest ? 'text-green-400' : ''}`}>
                  {c.status === 'loading' ? '...'
                    : c.status === 'error' ? <span className="text-xs text-[var(--text-muted)]">no route</span>
                    : c.status === 'unsupported' ? <span className="text-xs text-[var(--text-muted)]">n/a</span>
                    : <>{c.outputFormatted} {store.outputToken!.symbol}{isBest && ' \u2714'}</>
                  }
                </span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
