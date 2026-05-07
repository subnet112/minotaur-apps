import { TOKENS, DEFAULT_CHAIN_ID } from './swap.config'
import type { Token } from './swap.types'

export interface SwapLoaderData {
  tokens: Token[]
  defaultPair: { from: string; to: string }
}

export async function swapLoader(): Promise<SwapLoaderData> {
  const tokens = TOKENS[DEFAULT_CHAIN_ID] || []

  return {
    tokens,
    defaultPair: { from: 'USDC', to: 'WETH' },
  }
}
