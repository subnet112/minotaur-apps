/**
 * SwapPage prop mappers — translate functional types (QuoteResult, Token,
 * the store's SwapState) into the design components' prop shapes.
 *
 * This is the ONLY place where the design's display type shapes
 * (TokenDisplay, QuoteDisplay, ...) are produced at runtime. Components stay
 * untouched; mappers do the translation. Tested in
 * tests/unit/mappers.test.ts.
 */
import { formatUnits } from 'ethers'
import type { Token, QuoteResult, QuoteDisplay, TokenDisplay } from '@/types'
import { CHAIN_CONFIG } from '@/config/chains'

/**
 * Format a raw integer-string amount using a token's decimals, with up to
 * `maxFractionDigits` of precision and trailing-zero trim. Falls back to the
 * raw value on parse error so we never crash the UI on a malformed quote.
 */
export function formatTokenAmount(rawWei: string | null | undefined, decimals: number, maxFractionDigits = 8): string {
  if (rawWei == null) return '0'
  try {
    const formatted = formatUnits(rawWei, decimals)
    if (!formatted.includes('.')) return formatted
    const [whole, frac] = formatted.split('.')
    const trimmed = frac.slice(0, maxFractionDigits).replace(/0+$/, '')
    return trimmed.length === 0 ? whole : `${whole}.${trimmed}`
  } catch {
    return String(rawWei)
  }
}

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
  // The API returns `gas_estimate` in *gas units* (e.g. 550000), not USD.
  // Without a live gas-price + ETH/USD oracle we can't render dollars
  // honestly — show the unit count instead. When the API surfaces an
  // object with a `.usd` field we'll prefer that.
  const gasEstimate = (q as any).gas_estimate
  const gasUsd = typeof gasEstimate === 'object' && gasEstimate !== null && typeof gasEstimate.usd === 'number'
    ? `$ ${gasEstimate.usd.toFixed(2)}`
    : typeof gasEstimate === 'number'
      ? `~${gasEstimate.toLocaleString()} gas`
      : '—'

  // Platform fee is denominated in the chain's wrapped native token (18 dec
  // for ETH / wTAO), per AppIntentBase.wrappedNativeToken. No USD oracle
  // available — show the native amount with its symbol from the response.
  const feeSymbol = (q as any).platform_fee_symbol ?? 'ETH'
  const feeRaw = q.platform_fee_wei ?? '0'
  const feeFormatted = formatTokenAmount(feeRaw, 18)
  const feeUsd = feeFormatted === '0' ? '0' : `${feeFormatted} ${feeSymbol}`

  const clampedTtl = Math.max(0, ttlRemaining)

  return {
    fromSymbol: fromToken.symbol,
    toSymbol: toToken.symbol,
    fromAmount,
    fromUsd: '',
    // estimated_output / suggested_min_output are raw integer strings in
    // the destination token's smallest unit. Convert with toToken.decimals
    // so the user sees "0.000472 WETH" instead of "472838882988870".
    toAmount: formatTokenAmount(q.estimated_output, toToken.decimals),
    toUsd: '',
    ttlSeconds: clampedTtl,
    minReceived: `${formatTokenAmount(q.suggested_min_output, toToken.decimals)} ${toToken.symbol}`,
    slippagePct: q.slippage_bps != null ? `${(q.slippage_bps / 100).toFixed(2)} %` : '0.50 %',
    gasUsd,
    feeUsd,
    routeSummary: q.route_summary ?? '',
    // TODO: populate comparison when the API surfaces `comparison_quotes`.
    // Expected shape per quote object:
    //   comparison_quotes: Array<{ name: string; output_amount: string }>
    // where `name` is one of 'Uniswap' | 'Curve' | 'Balancer'. Raw integer
    // strings get formatted with toToken.decimals like the main output.
    comparison: mapComparisonQuotes((q as any).comparison_quotes, toToken.decimals),
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
  raw: Array<{ name: string; output_amount: string }> | null | undefined,
  toDecimals: number,
): QuoteDisplay['comparison'] {
  if (!raw || raw.length === 0) return []

  // Find the index of the row with the highest output_amount (raw integer
  // comparison is fine — same decimals across rows).
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
      outAmount: formatTokenAmount(row.output_amount, toDecimals),
      deltaPct: '',
      deltaDir: 'none' as const,
      isBest: idx === bestIdx,
    }
  })
}
