import { describe, it, expect } from 'vitest'
import type { Token } from '@/types'
import { selectActionState, selectModeBlockVariant } from '@/selectors'

// A minimal SwapState fixture matching the store's initial state shape.
// Tests override only the fields they exercise.
function baseState(): any {
  return {
    walletMode: 'external',
    walletConnected: false,
    walletAddress: '',
    walletChainId: null,
    managedWallet: null,
    bittensorAddress: '',
    bittensorConnected: false,
    bittensorProxySetup: false,
    evmRecipient: '',
    chainId: 1,
    sourceChainId: 1,
    isCrossChain: false,
    inputToken: null,
    outputToken: null,
    inputAmount: '',
    inputBalance: '0',
    quote: null,
    activeOrder: null,
    needsApproval: false,
    approving: false,
    loading: false,
    submitting: false,
  }
}

const nativeToken: Token = { symbol: 'ETH', address: 'native', decimals: 18, native: true, name: 'Ethereum', icon: 'E' }
const erc20Token: Token = { symbol: 'USDC', address: '0xa0b8...', decimals: 6, name: 'USD Coin', icon: '$' }

describe('selectActionState', () => {
  it('returns "disconnected" when walletConnected is false', () => {
    expect(selectActionState(baseState())).toBe('disconnected')
  })

  it('returns "wrong-network" when external wallet on wrong chain', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'external', walletChainId: 137, sourceChainId: 1 }
    expect(selectActionState(s)).toBe('wrong-network')
  })

  it('returns "empty" when amount is missing', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1, inputAmount: '' }
    expect(selectActionState(s)).toBe('empty')
  })

  it('returns "empty" when amount is "0"', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1, inputAmount: '0' }
    expect(selectActionState(s)).toBe('empty')
  })

  it('returns "enter-recipient" for cross-chain Bittensor->EVM without recipient', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'bittensor',
                isCrossChain: true, sourceChainId: 964, chainId: 1,
                inputAmount: '10', evmRecipient: '' }
    expect(selectActionState(s)).toBe('enter-recipient')
  })

  it('returns "insufficient" when amount > balance', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '100', inputBalance: '50' }
    expect(selectActionState(s)).toBe('insufficient')
  })

  it('returns "fetching" when loading', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100', loading: true }
    expect(selectActionState(s)).toBe('fetching')
  })

  it('returns "no-route" when quote is null after fetch', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100', quote: null }
    expect(selectActionState(s)).toBe('no-route')
  })

  it('returns "awaiting-sig" when needsApproval and not yet approving (approval CTA lives in WalletModeBlock)', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'external', walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, needsApproval: true, approving: false }
    expect(selectActionState(s)).toBe('awaiting-sig')
  })

  it('returns "approving" when approving is true', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, approving: true }
    expect(selectActionState(s)).toBe('approving')
  })

  it('returns "submitting" when submitting is true', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, submitting: true }
    expect(selectActionState(s)).toBe('submitting')
  })

  it('returns "submitting" when activeOrder is non-terminal', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, activeOrder: { status: 'open' } }
    expect(selectActionState(s)).toBe('submitting')
  })

  it('returns "swap-ready" for external wallet with native input token (F21: sign-broadcast removed)', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'external', walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, inputToken: nativeToken }
    expect(selectActionState(s)).toBe('swap-ready')
  })

  it('returns "swap-ready" for the happy path (external + erc20 + quote)', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'external', walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, inputToken: erc20Token }
    expect(selectActionState(s)).toBe('swap-ready')
  })

  it('returns "swap-ready" for managed wallet happy path', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'managed', walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, inputToken: erc20Token }
    expect(selectActionState(s)).toBe('swap-ready')
  })
})

describe('selectModeBlockVariant', () => {
  it('returns "create-wallet" for managed mode with no wallet', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'managed', managedWallet: null }
    expect(selectModeBlockVariant(s)).toBe('create-wallet')
  })

  it('returns "fund-wallet" for managed mode with zero balance', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'managed',
                managedWallet: { address: '0x123' } as any,
                inputBalance: '0' }
    expect(selectModeBlockVariant(s)).toBe('fund-wallet')
  })

  it('returns "approval" for external mode when allowance < amount', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'external',
                needsApproval: true, approving: false }
    expect(selectModeBlockVariant(s)).toBe('approval')
  })

  it('returns "approving" when approving is true', () => {
    const s = { ...baseState(), walletConnected: true, approving: true }
    expect(selectModeBlockVariant(s)).toBe('approving')
  })

  it('returns "native-eth" when input token is native', () => {
    const s = { ...baseState(), walletConnected: true,
                inputToken: { symbol: 'ETH', address: 'native', decimals: 18, native: true } }
    expect(selectModeBlockVariant(s)).toBe('native-eth')
  })

  it('returns "setup-proxy" for bittensor mode without proxy', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'bittensor',
                bittensorProxySetup: false }
    expect(selectModeBlockVariant(s)).toBe('setup-proxy')
  })

  it('returns null when no mode block applies', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'external',
                inputToken: erc20Token, inputBalance: '100',
                bittensorProxySetup: true }
    expect(selectModeBlockVariant(s)).toBeNull()
  })
})
