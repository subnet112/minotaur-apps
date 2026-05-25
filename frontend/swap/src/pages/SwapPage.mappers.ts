/**
 * SwapPage prop mappers — translate functional types (QuoteResult, Token,
 * the store's SwapState) into the design components' prop shapes.
 *
 * This is the ONLY place where the design's prototype type names
 * (MockToken, MockQuote, ...) are consumed at runtime. Components stay
 * untouched; mappers do the translation. Tested in
 * tests/unit/mappers.test.ts.
 */
import type { Token, QuoteResult, MockQuote } from '@/types'
import { CHAIN_CONFIG } from '@/config/chains'

interface SwapFormStoreSlice {
  sourceChainId: number
  chainId: number
  isCrossChain: boolean
  inputToken: Token | null
  outputToken: Token | null
  inputAmount: string
  inputBalance: string | null
  outputBalance: string | null
  walletMode: 'external' | 'managed' | 'bittensor'
  walletConnected: boolean
  slippageBps: number
  loading: boolean
  quote: QuoteResult | null
  evmRecipient: string
}

export interface SwapFormProps {
  slippagePct: string
  deadlineMin: number
  fromChainName: string
  fromChainGlyph: string
  fromChainIconClass: string
  toChainName?: string
  toChainGlyph?: string
  toChainIconClass?: string
  fromBalance?: string
  toBalance?: string
  toIsLoading: boolean
  cross: boolean
}

/** Returns chain display name + 1-letter glyph + CSS icon class for a chain ID. */
function chainDisplay(chainId: number): { name: string; glyph: string; iconClass: string } {
  const cfg = CHAIN_CONFIG[chainId]
  if (cfg?.name) {
    return {
      name: cfg.name,
      glyph: cfg.name.charAt(0).toUpperCase(),
      iconClass: cfg.name.toLowerCase().split(' ')[0],
    }
  }
  return { name: `Chain ${chainId}`, glyph: '?', iconClass: 'unknown' }
}

export function mapStoreToSwapFormProps(s: SwapFormStoreSlice): SwapFormProps {
  const fromChain = chainDisplay(s.sourceChainId)
  const toChain = chainDisplay(s.chainId)
  const slippagePct = `${(s.slippageBps / 100).toFixed(2)}%`

  return {
    slippagePct,
    deadlineMin: 20,
    fromChainName: fromChain.name,
    fromChainGlyph: fromChain.glyph,
    fromChainIconClass: fromChain.iconClass,
    toChainName: s.isCrossChain ? toChain.name : undefined,
    toChainGlyph: s.isCrossChain ? toChain.glyph : undefined,
    toChainIconClass: s.isCrossChain ? toChain.iconClass : undefined,
    fromBalance: s.walletConnected ? (s.inputBalance ?? undefined) : undefined,
    toBalance: s.walletConnected ? (s.outputBalance ?? undefined) : undefined,
    toIsLoading: s.loading,
    cross: s.isCrossChain,
  }
}

/**
 * Maps a real QuoteResult into the shape design's QuoteCard expects.
 * Field names match what's declared in MockQuote in src/types.ts:
 *   fromSymbol, toSymbol, fromAmount, fromUsd, toAmount, toUsd,
 *   ttlSeconds, minReceived, slippagePct, gasUsd, feeUsd,
 *   routeSummary, comparison.
 */
export function mapQuoteResultToQuoteCardProps(
  q: QuoteResult,
  fromToken: Token,
  toToken: Token,
  fromAmount: string,
  ttlRemaining: number
): MockQuote {
  const gasUsd = typeof (q as any).gas_estimate === 'number'
    ? `$ ${((q as any).gas_estimate as number).toFixed(2)}`
    : typeof (q as any).gas_estimate === 'object' && (q as any).gas_estimate !== null
      ? `$ ${((q as any).gas_estimate as { usd: number }).usd.toFixed(2)}`
      : '$ 0.00'

  const feeWei = parseFloat(q.platform_fee_wei ?? '0')
  const feeUsd = feeWei > 0 ? `$ ${(feeWei / 1e18).toFixed(2)}` : '$ 0.00'

  const clampedTtl = Math.max(0, ttlRemaining)

  return {
    fromSymbol: fromToken.symbol,
    toSymbol: toToken.symbol,
    fromAmount,
    fromUsd: '',
    toAmount: q.estimated_output,
    toUsd: '',
    ttlSeconds: clampedTtl,
    minReceived: `${q.suggested_min_output} ${toToken.symbol}`,
    slippagePct: q.slippage_bps != null ? `${(q.slippage_bps / 100).toFixed(2)} %` : '0.50 %',
    gasUsd,
    feeUsd,
    routeSummary: q.route_summary ?? '',
    comparison: [],
  }
}
