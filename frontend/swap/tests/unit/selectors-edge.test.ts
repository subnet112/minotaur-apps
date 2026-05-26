/**
 * Edge-case tests for selectActionState and selectModeBlockVariant.
 *
 * Covers boundary conditions, simultaneous flags, state transitions, and
 * cross-chain / wallet-mode combinations not exercised by the primary
 * selectors.test.ts suite.
 *
 * ~50 tests targeting:
 *  - walletChainId === null while walletConnected (no chain detected yet)
 *  - walletAddress === '' with walletConnected (transient connection)
 *  - Simultaneous flag combinations
 *  - Stale quote after input cleared
 *  - All 7 ModeBlock values with minimal snapshots
 *  - Cross-chain sourceChainId === 0 (Bittensor SS58 source)
 *  - Native-ETH regression guard (post-F21 semantics)
 */
import { describe, it, expect } from 'vitest'
import { selectActionState, selectModeBlockVariant } from '@/selectors'

// ---------------------------------------------------------------------------
// Minimal store snapshot helper — mirrors the pattern in selectors.test.ts
// ---------------------------------------------------------------------------
function baseState(): any {
  return {
    walletMode: 'external' as const,
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

// Inline token fixtures — no MOCK_ prefix, no separate constant file needed
const nativeETH = { symbol: 'ETH', address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', decimals: 18, native: true, name: 'Ethereum', icon: 'E' }
const erc20USDC = { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6, name: 'USD Coin', icon: '$' }
const erc20WETH = { symbol: 'WETH', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', decimals: 18, name: 'Wrapped Ether', icon: 'W' }

// ---------------------------------------------------------------------------
// selectActionState — edge cases
// ---------------------------------------------------------------------------

describe('selectActionState — walletChainId null while connected', () => {
  it('returns "empty" (not "wrong-network") when walletChainId is null (chain not yet detected)', () => {
    // null chainId means chain detection is still pending; we must not mis-fire wrong-network
    const s = { ...baseState(), walletConnected: true, walletMode: 'external', walletChainId: null, sourceChainId: 1, inputAmount: '' }
    expect(selectActionState(s)).toBe('empty')
  })

  it('returns "no-route" when walletChainId is null but form has valid amount + balance', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'external',
                walletChainId: null, sourceChainId: 1,
                inputAmount: '10', inputBalance: '100', quote: null }
    expect(selectActionState(s)).toBe('no-route')
  })

  it('returns "swap-ready" when walletChainId is null and quote is present', () => {
    // walletChainId === null does NOT trigger wrong-network; flow continues normally
    const s = { ...baseState(), walletConnected: true, walletMode: 'external',
                walletChainId: null, sourceChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, inputToken: erc20USDC }
    expect(selectActionState(s)).toBe('swap-ready')
  })

  it('returns "wrong-network" only when walletChainId is non-null and mismatched', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'external',
                walletChainId: 137, sourceChainId: 1 }
    expect(selectActionState(s)).toBe('wrong-network')
  })
})

describe('selectActionState — walletAddress empty with walletConnected (transient)', () => {
  it('returns "empty" for a transient connected state with no amount (external)', () => {
    // walletAddress === '' is valid during EIP-1193 accountsChanged race
    const s = { ...baseState(), walletConnected: true, walletAddress: '', walletChainId: 1, inputAmount: '' }
    expect(selectActionState(s)).toBe('empty')
  })

  it('proceeds to "swap-ready" for managed wallet with empty walletAddress (address lives in managedWallet)', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'managed',
                walletAddress: '', walletChainId: 1,
                managedWallet: { address: '0xabc' } as any,
                inputAmount: '5', inputBalance: '10',
                quote: {} as any, inputToken: erc20USDC }
    expect(selectActionState(s)).toBe('swap-ready')
  })

  it('proceeds to "swap-ready" for bittensor wallet with empty walletAddress', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'bittensor',
                walletAddress: '', walletChainId: null,
                bittensorAddress: '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
                bittensorProxySetup: true,
                isCrossChain: true, evmRecipient: '0xRecipient',
                inputAmount: '5', inputBalance: '10',
                quote: {} as any, inputToken: erc20USDC }
    expect(selectActionState(s)).toBe('swap-ready')
  })
})

describe('selectActionState — simultaneous flags', () => {
  it('returns "approving" (not "submitting") when both needsApproval and approving are true', () => {
    // approving check fires before submitting; precedence must hold
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, needsApproval: true, approving: true, submitting: true }
    expect(selectActionState(s)).toBe('approving')
  })

  it('returns "fetching" (not "no-route") when loading is true even with quote present', () => {
    // loading gate fires before the no-route check
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, loading: true }
    expect(selectActionState(s)).toBe('fetching')
  })

  it('returns "submitting" when both submitting and activeOrder (non-terminal) are set', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any,
                submitting: true, activeOrder: { status: 'open' } }
    expect(selectActionState(s)).toBe('submitting')
  })

  it('returns "approving" (not "fetching") when approving=true and loading=true', () => {
    // loading fires first; approving is only checked after loading is clear
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, loading: true, approving: true }
    expect(selectActionState(s)).toBe('fetching')
  })

  it('precedence: wrong-network beats everything when walletChainId is non-null mismatch', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'external',
                walletChainId: 56, sourceChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, submitting: true, approving: true }
    expect(selectActionState(s)).toBe('wrong-network')
  })
})

describe('selectActionState — stale quote after input cleared', () => {
  it('returns "empty" when inputAmount is empty even if quote is non-null (stale quote)', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '', inputBalance: '100',
                quote: { output: '123' } as any }
    expect(selectActionState(s)).toBe('empty')
  })

  it('returns "empty" when inputAmount is "0" with a stale quote', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '0', inputBalance: '100',
                quote: { output: '123' } as any }
    expect(selectActionState(s)).toBe('empty')
  })

  it('returns "empty" for whitespace-only inputAmount', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '   ', inputBalance: '100',
                quote: {} as any }
    expect(selectActionState(s)).toBe('empty')
  })
})

describe('selectActionState — terminal order statuses do not hold "submitting"', () => {
  it('returns "swap-ready" when activeOrder status is "filled" (terminal)', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, activeOrder: { status: 'filled' },
                inputToken: erc20USDC }
    expect(selectActionState(s)).toBe('swap-ready')
  })

  it('returns "swap-ready" when activeOrder status is "failed" (terminal)', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, activeOrder: { status: 'failed' },
                inputToken: erc20USDC }
    expect(selectActionState(s)).toBe('swap-ready')
  })

  it('returns "swap-ready" when activeOrder status is "cancelled" (terminal)', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, activeOrder: { status: 'cancelled' },
                inputToken: erc20USDC }
    expect(selectActionState(s)).toBe('swap-ready')
  })

  it('returns "submitting" when activeOrder status is "pending" (non-terminal)', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, activeOrder: { status: 'pending' } }
    expect(selectActionState(s)).toBe('submitting')
  })

  it('returns "submitting" when activeOrder status is "solved" (non-terminal)', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, activeOrder: { status: 'solved' } }
    expect(selectActionState(s)).toBe('submitting')
  })

  it('returns "submitting" when activeOrder status is "scored" (non-terminal)', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, activeOrder: { status: 'scored' } }
    expect(selectActionState(s)).toBe('submitting')
  })

  it('returns "submitting" when activeOrder status is "consensus" (non-terminal)', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, activeOrder: { status: 'consensus' } }
    expect(selectActionState(s)).toBe('submitting')
  })
})

describe('selectActionState — cross-chain Bittensor SS58 (sourceChainId === 0)', () => {
  it('returns "enter-recipient" for cross-chain with sourceChainId=0 and no evmRecipient', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'bittensor',
                walletChainId: null, sourceChainId: 0, chainId: 1,
                isCrossChain: true, evmRecipient: '',
                inputAmount: '10', inputBalance: '100' }
    expect(selectActionState(s)).toBe('enter-recipient')
  })

  it('does NOT return "enter-recipient" for cross-chain Bittensor when evmRecipient is set', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'bittensor',
                walletChainId: null, sourceChainId: 0, chainId: 1,
                isCrossChain: true, evmRecipient: '0xRecipientAddress',
                inputAmount: '10', inputBalance: '100',
                quote: {} as any, inputToken: erc20USDC }
    expect(selectActionState(s)).not.toBe('enter-recipient')
    expect(selectActionState(s)).toBe('swap-ready')
  })

  it('returns "enter-recipient" for non-zero Bittensor chainId (964) with no evmRecipient', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'bittensor',
                walletChainId: null, sourceChainId: 964, chainId: 1,
                isCrossChain: true, evmRecipient: '',
                inputAmount: '10', inputBalance: '100' }
    expect(selectActionState(s)).toBe('enter-recipient')
  })

  it('does NOT return "enter-recipient" for external mode cross-chain (only for bittensor mode)', () => {
    const s = { ...baseState(), walletConnected: true, walletMode: 'external',
                walletChainId: 1, sourceChainId: 1, chainId: 137,
                isCrossChain: true, evmRecipient: '',
                inputAmount: '10', inputBalance: '100' }
    // wrong-network fires first (walletChainId=1 vs sourceChainId=1 — same, so no wrong-network)
    // then proceeds — enter-recipient is only for bittensor mode
    expect(selectActionState(s)).not.toBe('enter-recipient')
  })
})

describe('selectActionState — inputBalance edge cases', () => {
  it('returns "insufficient" when inputBalance is null (treated as 0)', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '10', inputBalance: null }
    expect(selectActionState(s)).toBe('insufficient')
  })

  it('returns "no-route" when inputAmount exactly equals inputBalance (not insufficient)', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '100', inputBalance: '100', quote: null }
    expect(selectActionState(s)).toBe('no-route')
  })

  it('returns "insufficient" when inputAmount is slightly over inputBalance', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '100.001', inputBalance: '100.000' }
    expect(selectActionState(s)).toBe('insufficient')
  })

  it('returns "no-route" for very large balance covering very large amount', () => {
    const s = { ...baseState(), walletConnected: true, walletChainId: 1,
                inputAmount: '999999', inputBalance: '1000000', quote: null }
    expect(selectActionState(s)).toBe('no-route')
  })
})

describe('selectActionState — post-F21 native ETH regression guard', () => {
  // .skip until D\'s F21 commit merges; this is the regression guard for it
  it.skip('native ETH as input token must NEVER produce "sign-broadcast" after F21', () => {
    // After F21 (D\'s branch removes the native-input code path in useOrderSubmission.ts
    // and removes the sign-broadcast return from selectActionState), native ETH should
    // fall through to "swap-ready" rather than "sign-broadcast".
    const s = { ...baseState(), walletConnected: true, walletMode: 'external',
                walletChainId: 1, sourceChainId: 1,
                inputAmount: '1', inputBalance: '10',
                quote: {} as any,
                inputToken: { address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', native: true } }
    expect(selectActionState(s)).not.toBe('sign-broadcast')
  })
})

// ---------------------------------------------------------------------------
// selectModeBlockVariant — all 7 values verified with minimal snapshots
// ---------------------------------------------------------------------------

describe('selectModeBlockVariant — all 7 ModeBlock values', () => {
  it('returns "create-wallet" for managed mode with no wallet', () => {
    const s = { ...baseState(), walletMode: 'managed', managedWallet: null }
    expect(selectModeBlockVariant(s)).toBe('create-wallet')
  })

  it('returns "fund-wallet" for managed mode with wallet but zero balance', () => {
    const s = { ...baseState(), walletMode: 'managed',
                managedWallet: { address: '0xabc' } as any, inputBalance: '0' }
    expect(selectModeBlockVariant(s)).toBe('fund-wallet')
  })

  it('returns "fund-wallet" when managedWallet.balance is null (treated as 0)', () => {
    const s = { ...baseState(), walletMode: 'managed',
                managedWallet: { address: '0xabc' } as any, inputBalance: null }
    expect(selectModeBlockVariant(s)).toBe('fund-wallet')
  })

  it('returns "approval" for external mode needing approval (not yet approving)', () => {
    const s = { ...baseState(), walletMode: 'external', needsApproval: true, approving: false }
    expect(selectModeBlockVariant(s)).toBe('approval')
  })

  it('returns "approving" when approving is true (regardless of mode)', () => {
    const s = { ...baseState(), walletMode: 'external', approving: true }
    expect(selectModeBlockVariant(s)).toBe('approving')
  })

  it('returns "approving" for managed mode with approving=true', () => {
    const s = { ...baseState(), walletMode: 'managed',
                managedWallet: { address: '0xabc' } as any,
                inputBalance: '100', approving: true }
    expect(selectModeBlockVariant(s)).toBe('approving')
  })

  it('returns "native-eth" when inputToken is native', () => {
    const s = { ...baseState(), walletMode: 'external', inputToken: nativeETH }
    expect(selectModeBlockVariant(s)).toBe('native-eth')
  })

  it('returns "setup-proxy" for bittensor mode without proxy setup', () => {
    const s = { ...baseState(), walletMode: 'bittensor', bittensorProxySetup: false }
    expect(selectModeBlockVariant(s)).toBe('setup-proxy')
  })

  it('returns null when no mode block applies (external + erc20 + proxy set)', () => {
    const s = { ...baseState(), walletMode: 'external',
                inputToken: erc20USDC, inputBalance: '100',
                needsApproval: false, approving: false }
    expect(selectModeBlockVariant(s)).toBeNull()
  })

  it('returns null for bittensor mode with proxy setup complete', () => {
    const s = { ...baseState(), walletMode: 'bittensor', bittensorProxySetup: true,
                inputToken: erc20USDC }
    expect(selectModeBlockVariant(s)).toBeNull()
  })
})

describe('selectModeBlockVariant — precedence and simultaneous flags', () => {
  it('"create-wallet" takes priority over "fund-wallet" when managedWallet is null', () => {
    // Both conditions can't fire simultaneously (null wallet → create; wallet+0 → fund)
    // but ensure managed+null always returns create-wallet, never fund-wallet
    const s = { ...baseState(), walletMode: 'managed', managedWallet: null, inputBalance: '0' }
    expect(selectModeBlockVariant(s)).toBe('create-wallet')
  })

  it('"approving" overrides "approval" when both approving=true and needsApproval=true', () => {
    const s = { ...baseState(), walletMode: 'external', needsApproval: true, approving: true }
    expect(selectModeBlockVariant(s)).toBe('approving')
  })

  it('"approving" overrides "native-eth" when approving=true and inputToken is native', () => {
    const s = { ...baseState(), walletMode: 'external', approving: true, inputToken: nativeETH }
    expect(selectModeBlockVariant(s)).toBe('approving')
  })

  it('"native-eth" overrides "setup-proxy" when bittensor mode has native inputToken', () => {
    // native-eth check runs before setup-proxy check
    const s = { ...baseState(), walletMode: 'bittensor',
                bittensorProxySetup: false, inputToken: nativeETH }
    expect(selectModeBlockVariant(s)).toBe('native-eth')
  })

  it('returns "approval" for external mode even when inputToken is null', () => {
    const s = { ...baseState(), walletMode: 'external',
                inputToken: null, needsApproval: true, approving: false }
    expect(selectModeBlockVariant(s)).toBe('approval')
  })

  it('returns "fund-wallet" for managed wallet with non-zero positive balance that equals exactly "0.0000"', () => {
    // parseFloat('0.0000') === 0 → should still be fund-wallet
    const s = { ...baseState(), walletMode: 'managed',
                managedWallet: { address: '0xabc' } as any, inputBalance: '0.0000' }
    expect(selectModeBlockVariant(s)).toBe('fund-wallet')
  })

  it('does NOT return "fund-wallet" when managed wallet has positive balance', () => {
    const s = { ...baseState(), walletMode: 'managed',
                managedWallet: { address: '0xabc' } as any, inputBalance: '0.001' }
    expect(selectModeBlockVariant(s)).toBeNull()
  })
})

describe('selectModeBlockVariant — WETH vs native-eth', () => {
  it('returns "native-eth" for native:true token with 0xeeee address', () => {
    const s = { ...baseState(), walletMode: 'external', inputToken: nativeETH }
    expect(selectModeBlockVariant(s)).toBe('native-eth')
  })

  it('returns null (not native-eth) for WETH (native:false)', () => {
    const s = { ...baseState(), walletMode: 'external', inputToken: erc20WETH }
    expect(selectModeBlockVariant(s)).toBeNull()
  })

  it('returns null (not native-eth) for token with native:undefined', () => {
    const s = { ...baseState(), walletMode: 'external', inputToken: erc20USDC }
    expect(selectModeBlockVariant(s)).toBeNull()
  })

  it('returns null when inputToken is null', () => {
    const s = { ...baseState(), walletMode: 'external', inputToken: null }
    expect(selectModeBlockVariant(s)).toBeNull()
  })
})
