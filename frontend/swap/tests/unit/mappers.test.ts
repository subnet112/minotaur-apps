import { describe, it, expect } from 'vitest'
import { mapQuoteResultToQuoteCardProps, mapStoreToSwapFormProps } from '@/pages/SwapPage.mappers'
import type { QuoteResult, Token } from '@/types'

const usdc: Token = { symbol: 'USDC', address: '0xa0b8...', decimals: 6, name: 'USD Coin', icon: '$' }
const eth: Token = { symbol: 'ETH', address: 'native', decimals: 18, native: true, name: 'Ethereum', icon: 'E' }

describe('mapQuoteResultToQuoteCardProps', () => {
  it('maps a typical QuoteResult into MockQuote shape', () => {
    const q: QuoteResult = {
      estimated_output: '0.3142',
      suggested_min_output: '0.3094',
      ready_params: { input_amount: '1000000000', min_output_amount: '309400000000000000' } as any,
      platform_fee_wei: '0',
      valid_for_seconds: 60,
      route_summary: 'USDC → WETH → ETH · 1 hop · Uni v3',
      gas_estimate: 2.18,
    } as any
    const props = mapQuoteResultToQuoteCardProps(q, usdc, eth, '1000', 60)
    expect(props.fromAmount).toBe('1000')
    expect(props.toAmount).toBe('0.3142')
    expect(props.ttlSeconds).toBe(60)
    expect(props.fromSymbol).toBe('USDC')
    expect(props.toSymbol).toBe('ETH')
    expect(props.routeSummary).toBe('USDC → WETH → ETH · 1 hop · Uni v3')
    expect(props.minReceived).toContain('0.3094')
    expect(Array.isArray(props.comparison)).toBe(true)
  })

  it('clamps ttlSeconds to 0 when ttlRemaining is negative', () => {
    const q: QuoteResult = {
      estimated_output: '1.0', suggested_min_output: '0.9',
      ready_params: {} as any, platform_fee_wei: '0',
      valid_for_seconds: 60, route_summary: '',
      gas_estimate: 0,
    } as any
    const props = mapQuoteResultToQuoteCardProps(q, usdc, eth, '1', -5)
    expect(props.ttlSeconds).toBe(0)
  })

  it('computes a sensible TTL when mid-countdown', () => {
    const q: QuoteResult = {
      estimated_output: '1.0', suggested_min_output: '0.9',
      ready_params: {} as any, platform_fee_wei: '0',
      valid_for_seconds: 60, route_summary: '',
      gas_estimate: 0,
    } as any
    const props = mapQuoteResultToQuoteCardProps(q, usdc, eth, '1', 30)
    expect(props.ttlSeconds).toBe(30)
  })
})

function baseFormState() {
  return {
    sourceChainId: 1, chainId: 1, isCrossChain: false,
    inputToken: usdc, outputToken: eth, inputAmount: '', inputBalance: '500', outputBalance: '0.5',
    walletMode: 'external' as const, walletConnected: true,
    slippageBps: 100, loading: false, quote: null, evmRecipient: '',
  }
}

describe('mapStoreToSwapFormProps', () => {
  it('maps chain pill names + glyphs by chainId', () => {
    const s = baseFormState()
    const props = mapStoreToSwapFormProps(s as any)
    expect(props.fromChainName).toBe('Ethereum')
    expect(props.fromChainGlyph).toBe('E')
    expect(props.cross).toBe(false)
    expect(props.toChainName).toBeUndefined()
  })

  it('surfaces second chain pill when isCrossChain is true', () => {
    const s = { ...baseFormState(), sourceChainId: 964, chainId: 1, isCrossChain: true, walletMode: 'bittensor' as const }
    const props = mapStoreToSwapFormProps(s as any)
    expect(props.cross).toBe(true)
    expect(props.toChainName).toBe('Ethereum')
    expect(props.toChainGlyph).toBe('E')
  })

  it('shows balance as undefined when wallet disconnected', () => {
    const s = { ...baseFormState(), walletConnected: false }
    const props = mapStoreToSwapFormProps(s as any)
    expect(props.fromBalance).toBeUndefined()
  })

  it('toIsLoading mirrors the loading flag when there is no quote yet', () => {
    const s = { ...baseFormState(), loading: true, quote: null }
    expect(mapStoreToSwapFormProps(s as any).toIsLoading).toBe(true)
  })

  it('formats slippagePct from slippageBps (100bps = 1.00%)', () => {
    const s = { ...baseFormState(), slippageBps: 100 }
    expect(mapStoreToSwapFormProps(s as any).slippagePct).toBe('1.00%')
  })
})
