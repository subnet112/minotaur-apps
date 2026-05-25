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
export type FormState = 'idle' | 'quote-loading' | 'quoted' | 'order'
export type OrderStep = 'pending' | 'open' | 'solved' | 'scored' | 'consensus' | 'filled' | 'failed'
export type ActionState =
  | 'disconnected' | 'wrong-network' | 'empty' | 'insufficient'
  | 'fetching' | 'no-route' | 'approving' | 'swap-ready'
  | 'sign-broadcast' | 'submitting' | 'awaiting-sig' | 'enter-recipient'
export type ModeBlock =
  | 'none' | 'create-wallet' | 'fund-wallet' | 'approval'
  | 'approving' | 'native-eth' | 'setup-proxy'
export type Overlay = 'none' | 'wallet-panel' | 'token-from' | 'token-to' | 'settings'
export type WalletTab = 'managed' | 'metamask' | 'bittensor'

export interface MockToken {
  symbol: string
  name: string
  glyph: string
  iconClass: 'usdc' | 'eth' | 'usdt' | 'wbtc' | 'tao' | 'dai' | 'arb' | 'link'
  balance: string
  usd: string
}

export interface MockQuote {
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
    dex: 'Uniswap' | 'Curve' | 'Balancer'
    glyph: string
    iconClass: 'uni' | 'crv' | 'bal'
    outAmount: string
    deltaPct: string
    deltaDir: 'down' | 'up' | 'none'
  }>
}

export interface MockRecentSwap {
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

export interface MockDebugInfo {
  appId: string
  chainId: string
  walletMode: 'managed' | 'metamask' | 'bittensor' | 'disconnected'
  activeAddress: string
}

export interface MockChain {
  id: string
  name: string
  glyph: string
  iconClass: 'eth' | 'bittensor' | 'base' | 'arb'
}

// ── Mock constant values (re-exported so lifted components resolve @/types) ──

export const MOCK_WALLET_ADDR_EVM = '0x5a33b4f9e7c2d8a1c0e5f6a7b8c9d0e1f2c4c108'
export const MOCK_WALLET_ADDR_SS58 = '5HpS9bcF2Z73YEa1jW9Lq6TgUv4MnQpV8YJ4'
export const MOCK_WALLET_TRUNC_EVM = '0x5a33…c4c108'
export const MOCK_WALLET_TRUNC_SS58 = '5HpS…8YJ4'

export const MOCK_TOKENS: MockToken[] = [
  { symbol: 'USDC', name: 'USD Coin',    glyph: 'U', iconClass: 'usdc', balance: '1,248.40', usd: '$1,248.40' },
  { symbol: 'ETH',  name: 'Ether',       glyph: 'E', iconClass: 'eth',  balance: '0.0142',   usd: '$45.20' },
  { symbol: 'USDT', name: 'Tether USD',  glyph: 'T', iconClass: 'usdt', balance: '0.00',     usd: '$0.00' },
  { symbol: 'WBTC', name: 'Wrapped BTC', glyph: 'W', iconClass: 'wbtc', balance: '0.0110',   usd: '$1,184.02' },
  { symbol: 'TAO',  name: 'Bittensor',   glyph: 'τ', iconClass: 'tao',  balance: '42.000',   usd: '$13,440.00' },
]

export const MOCK_QUOTE_USDC_TO_ETH: MockQuote = {
  fromSymbol: 'USDC',
  toSymbol: 'ETH',
  fromAmount: '1,000',
  fromUsd: '$1,000.00',
  toAmount: '0.3142',
  toUsd: '$1,002.40',
  ttlSeconds: 42,
  minReceived: '0.3094 ETH',
  slippagePct: '1.50 %',
  gasUsd: '$ 2.18',
  feeUsd: '$ 0.40',
  routeSummary: 'USDC → WETH → ETH · 1 hop · Uni v3 + Curve',
  comparison: [
    { dex: 'Uniswap',  glyph: 'U', iconClass: 'uni', outAmount: '0.3138', deltaPct: '-0.12 %', deltaDir: 'down' },
    { dex: 'Curve',    glyph: 'C', iconClass: 'crv', outAmount: '0.3131', deltaPct: '-0.34 %', deltaDir: 'down' },
    { dex: 'Balancer', glyph: 'B', iconClass: 'bal', outAmount: '0.3129', deltaPct: '-0.41 %', deltaDir: 'down' },
  ],
}

export const MOCK_RECENT_SWAPS: MockRecentSwap[] = [
  { fromAmount: '1,000.00', fromSymbol: 'USDC', fromGlyph: 'U', toAmount: '0.3142',     toSymbol: 'ETH',   toGlyph: 'E', timeAgo: '2 min ago',  status: 'confirmed', txTruncated: '0x9a3f…e21c' },
  { fromAmount: '42.000',   fromSymbol: 'TAO',  fromGlyph: 'T', toAmount: '128.40',     toSymbol: 'Alpha', toGlyph: 'A', timeAgo: '18 min ago', status: 'pending',   txTruncated: '0x4b71…3df0' },
  { fromAmount: '0.1100',   fromSymbol: 'WBTC', fromGlyph: 'W', toAmount: '11,840.16',  toSymbol: 'USDC',  toGlyph: 'U', timeAgo: '1 h ago',    status: 'failed',    txTruncated: '0xc0fe…9100' },
]

export const MOCK_DEBUG_INFO: MockDebugInfo = {
  appId: '0xb9c1',
  chainId: '8453',
  walletMode: 'metamask',
  activeAddress: MOCK_WALLET_ADDR_EVM,
}

export const MOCK_QUOTE_JSON = `{
  "app_id": "0xb9c1",
  "from": { "symbol": "USDC", "amount": "1000" },
  "to":   { "symbol": "ETH",  "amount_est": "0.3142" },
  "ttl_s": 42,
  "route": ["USDC", "WETH", "ETH"],
  "venues": ["uni-v3", "curve"]
}`

export const MOCK_ORDER_JSON = `{
  "order_id": "ord_abc12",
  "status": "open",
  "submitted_at": "2026-05-25T12:08:41Z",
  "tx_hash": null
}`
