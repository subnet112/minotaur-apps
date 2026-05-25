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
