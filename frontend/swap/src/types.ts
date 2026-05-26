import type { QuoteResult, OrderResult, WalletInfo, ChainInfo } from '@/api/client'

export type { ChainConfig, Token } from '@/config/chains'

export interface SwapHistoryItem {
  orderId: string
  timestamp: number
  chainId: number
  inputToken: string
  outputToken: string
  inputAmount: string
  outputAmount: string
  status: string
  score?: number | null
  txHash?: string | null
}

export type WalletMode = 'external' | 'managed' | 'bittensor'

export type OrderStatusValue =
  | 'pending'
  | 'open'
  | 'solved'
  | 'scored'
  | 'consensus'
  | 'filled'
  | 'failed'
  | 'cancelled'

export type { QuoteResult, OrderResult, WalletInfo, ChainInfo }

/** Toast variants emitted by the design's shell ToastProvider. */
export type ToastVariant = 'success' | 'error' | 'info' | 'loading' | 'transient'

// ── Design component type vocabulary ────────────────────────────────────────
// Re-exported here so the lifted design components in src/components/dex-
// aggregator/ can keep importing them from a stable path. The names match
// the design tree's _state.ts / _mock.ts type exports verbatim.

export type DesignWalletMode = 'disconnected' | 'managed' | 'metamask' | 'bittensor'
export type OrderStep = 'pending' | 'open' | 'solved' | 'scored' | 'consensus' | 'filled' | 'failed'
export type ActionState =
  | 'disconnected' | 'wrong-network' | 'empty' | 'insufficient'
  | 'fetching' | 'no-route' | 'approving' | 'swap-ready'
  | 'sign-broadcast' | 'submitting' | 'awaiting-sig' | 'enter-recipient'
export type ModeBlock =
  | 'none' | 'create-wallet' | 'fund-wallet' | 'approval'
  | 'approving' | 'native-eth' | 'setup-proxy'
export type Overlay = 'none' | 'wallet-panel' | 'token-from' | 'token-to' | 'settings'

// ── Display shapes (populated from real store data via mappers) ──────────────
// These are the shapes design components consume. Mappers in SwapPage.mappers.ts
// translate real store/API types into these shapes.

export interface TokenDisplay {
  symbol: string
  name: string
  glyph: string
  iconClass: 'usdc' | 'eth' | 'usdt' | 'wbtc' | 'tao' | 'dai' | 'arb' | 'link' | 'unknown'
  balance: string
  usd: string
  address?: string   // needed for filter dedup + custom import
  native?: boolean
}

export interface QuoteDisplay {
  fromSymbol: string
  toSymbol: string
  fromAmount: string
  fromUsd: string
  toAmount: string
  toUsd: string
  ttlSeconds: number
  minReceived: string
  slippagePct: string
  gasUsd: string
  feeUsd: string
  routeSummary: string
  comparison: ReadonlyArray<{
    /** Display name for the source (e.g. 'CoW Swap', 'Paraswap', 'Uniswap'). */
    dex: string
    glyph: string
    /** CSS class for the `.mark` badge color. Design ships `.uni`/`.crv`/`.bal`; unknown values render with the default badge color. */
    iconClass: string
    /** Human-readable output amount in destination token units. */
    outAmount: string
    deltaPct: string
    deltaDir: 'down' | 'up' | 'none'
    /** True for the row with the highest output amount among comparison quotes. */
    isBest?: boolean
  }>
}

export interface RecentSwapDisplay {
  fromAmount: string
  fromSymbol: string
  fromGlyph: string
  toAmount: string
  toSymbol: string
  toGlyph: string
  timeAgo: string
  status: 'confirmed' | 'pending' | 'failed'
  txTruncated: string
}

export interface DebugInfoDisplay {
  appId: string
  chainId: string
  walletMode: 'managed' | 'metamask' | 'bittensor' | 'disconnected'
  activeAddress: string
}
