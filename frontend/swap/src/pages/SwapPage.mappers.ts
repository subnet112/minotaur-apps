/**
 * SwapPage prop mappers — translate functional types (QuoteResult, Token,
 * the store's SwapState) into the design components' prop shapes.
 *
 * This is the ONLY place where the design's display type shapes
 * (TokenDisplay, QuoteDisplay, ...) are produced at runtime. Components stay
 * untouched; mappers do the translation. Tested in
 * tests/unit/mappers.test.ts.
 */
import type { Token, QuoteResult, QuoteDisplay, TokenDisplay } from '@/types'
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

const ICON_MAP: Record<string, TokenDisplay['iconClass']> = {
  usdc: 'usdc',
  usdt: 'usdt',
  eth: 'eth',
  weth: 'eth',
  wbtc: 'wbtc',
  tao: 'tao',
  dai: 'dai',
  arb: 'arb',
  link: 'link',
}

/**
 * Maps an array of functional Tokens (from solver) plus an optional balance
 * record into TokenDisplay shapes for the TokenSelectorModal.
 *
 * @param tokens     Solver token list for the active chain.
 * @param balances   Map of token address (lower-cased) → human-readable balance string.
 */
export function mapSolverTokensToDisplay(
  tokens: Token[],
  balances: Record<string, string> = {},
): TokenDisplay[] {
  return tokens.map((t) => {
    const sym = t.symbol.toLowerCase()
    const addrKey = t.address?.toLowerCase() ?? ''
    const balance = balances[addrKey] ?? '0'
    return {
      symbol: t.symbol,
      name: t.name ?? t.symbol,
      glyph: t.symbol.charAt(0).toUpperCase(),
      iconClass: ICON_MAP[sym] ?? 'unknown',
      balance,
      usd: '$0.00',
      address: t.address,
      native: t.native,
    } satisfies TokenDisplay
  })
}

/**
 * Maps a real QuoteResult into the shape design's QuoteCard expects.
 * Field names match what's declared in QuoteDisplay in src/types.ts:
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
): QuoteDisplay {
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
    // TODO: populate comparison when the API surfaces `comparison_quotes`.
    // Expected shape per quote object:
    //   comparison_quotes: Array<{ name: string; output_amount: string }>
    // where `name` is one of 'Uniswap' | 'Curve' | 'Balancer'.
    comparison: mapComparisonQuotes((q as any).comparison_quotes),
  }
}

/** Glyph + icon class lookup for known external DEX names. */
const DEX_META: Record<string, { glyph: string; iconClass: 'uni' | 'crv' | 'bal' }> = {
  Uniswap: { glyph: 'U', iconClass: 'uni' },
  Curve:   { glyph: 'C', iconClass: 'crv' },
  Balancer: { glyph: 'B', iconClass: 'bal' },
}

/**
 * Maps raw `comparison_quotes` from the QuoteResult API response into the
 * display shape `QuoteDisplay.comparison` expects.
 *
 * Returns `[]` when no comparison data is provided, ensuring backward
 * compat while the API field is not yet populated.
 */
function mapComparisonQuotes(
  raw: Array<{ name: string; output_amount: string }> | null | undefined
): QuoteDisplay['comparison'] {
  if (!raw || raw.length === 0) return []

  // Find the index of the row with the highest output_amount.
  let bestIdx = 0
  let bestVal = -Infinity
  raw.forEach((row, idx) => {
    const v = parseFloat(row.output_amount)
    if (!Number.isNaN(v) && v > bestVal) {
      bestVal = v
      bestIdx = idx
    }
  })

  return raw.map((row, idx) => {
    const meta = DEX_META[row.name] ?? { glyph: row.name.charAt(0).toUpperCase(), iconClass: 'uni' as const }
    return {
      dex: row.name as 'Uniswap' | 'Curve' | 'Balancer',
      glyph: meta.glyph,
      iconClass: meta.iconClass,
      outAmount: row.output_amount,
      deltaPct: '',
      deltaDir: 'none' as const,
      isBest: idx === bestIdx,
    }
  })
}
