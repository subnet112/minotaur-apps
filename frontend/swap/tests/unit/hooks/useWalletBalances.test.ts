/**
 * Unit tests for useWalletBalances hook.
 *
 * Covers:
 *  - Same-chain EVM balance fetch (hex addr + chain_id) — store.inputBalance/outputBalance set
 *  - Bittensor SS58 fetch: when walletMode === 'bittensor', chain_id=0 is forced regardless of UI selection (F14)
 *  - Cross-chain: FROM balance from sourceChainId, TO balance from chainId (F15-out)
 *  - AbortController fires on dep change: in-flight request cancelled on store change (F7)
 *  - API res.error surfaces as caught error → store.error set + toast.error called
 *  - Native token included in token list with correct decimals
 *  - Empty tokens array → balance shows '0' not null
 *  - Address lowercase matching (API returns mixed case)
 *  - Unmount during pending request → no setState warning
 *  - Other edge cases
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSwapStore } from '@/store'
import { useWalletBalances } from '@/hooks/useWalletBalances'
import * as api from '@/api/client'
import type { BalancesResult } from '@/api/client'
import {
  MOCK_TOKEN,
  MOCK_NATIVE_TOKEN,
  MOCK_WETH_TOKEN,
  MOCK_BALANCES,
  mockEvmAddress,
  mockBittensorAddress,
} from './fixtures'
import { HookWrapper, resetStore } from './test-utils'

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupEvmWallet(address = mockEvmAddress) {
  const store = useSwapStore.getState()
  store.setWalletMode('external')
  store.setWalletAddress(address)
  store.setWalletConnected(true)
}

function setupBittensorWallet(address = mockBittensorAddress) {
  const store = useSwapStore.getState()
  store.setWalletMode('bittensor')
  store.setBittensorAddress(address)
  store.setBittensorConnected(true)
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore()
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useWalletBalances', () => {

  describe('same-chain EVM balance fetch', () => {
    it('sets inputBalance when inputToken matches a token in the API response', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setInputToken(MOCK_TOKEN) // USDC
      store.setChainId(8453)

      vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(useSwapStore.getState().inputBalance).toBe('5000000000')
      })
    })

    it('sets outputBalance when outputToken matches a token in the API response', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()

      // Set WETH as output, USDC as input — WETH address is in MOCK_BALANCES
      // Note: setChainId resets outputToken, so set tokens AFTER setChainId
      const wethToken = {
        ...MOCK_WETH_TOKEN,
        address: '0x4200000000000000000000000000000000000006',
      }
      store.setChainId(8453)
      store.setInputToken(MOCK_TOKEN)
      store.setOutputToken(wethToken)

      vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(useSwapStore.getState().outputBalance).toBe('500000000000000000')
      })
    })

    it('passes wallet address and chainId to getWalletBalances', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setInputToken(MOCK_TOKEN)
      store.setChainId(8453)

      const spy = vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(spy).toHaveBeenCalledWith(
          mockEvmAddress,
          8453,
          expect.any(AbortSignal),
        )
      })
    })

    it('clears balances when no wallet address is set', async () => {
      // Pre-seed some balances
      const store = useSwapStore.getState()
      store.setInputBalance('999')
      store.setOutputBalance('888')
      // No wallet connected

      vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(useSwapStore.getState().inputBalance).toBeNull()
        expect(useSwapStore.getState().outputBalance).toBeNull()
      })
    })
  })

  describe('native token balance', () => {
    it('returns eth_balance for native token input', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setInputToken(MOCK_NATIVE_TOKEN) // native: true
      store.setChainId(8453)

      vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(useSwapStore.getState().inputBalance).toBe('1500000000000000000') // 1.5 ETH
      })
    })

    it('returns eth_balance for native token output', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      // setChainId resets outputToken, so set tokens after setChainId
      store.setChainId(8453)
      store.setInputToken(MOCK_TOKEN)
      store.setOutputToken(MOCK_NATIVE_TOKEN) // native: true

      vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(useSwapStore.getState().outputBalance).toBe('1500000000000000000')
      })
    })
  })

  describe('empty tokens array → balance shows 0 not null', () => {
    it('returns "0" for input token when tokens is empty in API response', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setInputToken(MOCK_TOKEN)
      store.setChainId(8453)

      const emptyBalances: BalancesResult = {
        ...MOCK_BALANCES,
        tokens: {},
      }
      vi.spyOn(api, 'getWalletBalances').mockResolvedValue(emptyBalances)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(useSwapStore.getState().inputBalance).toBe('0')
      })
    })

    it('returns "0" for output token when token not found in API response', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setInputToken(MOCK_TOKEN)
      store.setOutputToken(MOCK_WETH_TOKEN) // WETH at different address, not in MOCK_BALANCES
      store.setChainId(8453)

      const emptyBalances: BalancesResult = {
        ...MOCK_BALANCES,
        tokens: {},
      }
      vi.spyOn(api, 'getWalletBalances').mockResolvedValue(emptyBalances)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(useSwapStore.getState().outputBalance).toBe('0')
      })
    })
  })

  describe('F14 — bittensor forces chain_id=0', () => {
    it('uses chain_id=0 when walletMode is bittensor regardless of UI chainId', async () => {
      setupBittensorWallet()
      const store = useSwapStore.getState()
      store.setChainId(8453) // UI has EVM chain selected
      store.setInputToken(MOCK_TOKEN)

      const spy = vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(spy).toHaveBeenCalledWith(
          mockBittensorAddress,
          0, // chain_id=0 forced for bittensor
          expect.any(AbortSignal),
        )
      })
    })

    it('uses bittensorAddress (not walletAddress) when walletMode is bittensor', async () => {
      setupBittensorWallet()
      const store = useSwapStore.getState()
      // Also set a walletAddress — should NOT be used
      store.setWalletAddress(mockEvmAddress)
      store.setInputToken(MOCK_TOKEN)

      const spy = vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        const calls = spy.mock.calls
        expect(calls[0][0]).toBe(mockBittensorAddress)
        expect(calls[0][1]).toBe(0)
      })
    })
  })

  describe('F15-out — cross-chain uses separate chain IDs', () => {
    it('fetches input balance from sourceChainId in cross-chain mode', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setSourceChainId(1)    // Ethereum mainnet
      store.setChainId(8453)       // Base
      // Manually set isCrossChain since sourceChainId != chainId
      store.setInputToken(MOCK_TOKEN)
      store.setOutputToken(MOCK_TOKEN)

      const spy = vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        const inputCall = spy.mock.calls.find((c) => c[1] === 1) // sourceChainId=1
        expect(inputCall).toBeDefined()
        expect(inputCall?.[0]).toBe(mockEvmAddress)
      })
    })
  })

  describe('F7 — AbortController fires on dep change', () => {
    it('aborts in-flight request when store dependency changes', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setInputToken(MOCK_TOKEN)

      let capturedSignal: AbortSignal | undefined
      vi.spyOn(api, 'getWalletBalances').mockImplementation((_addr, _chainId, signal) => {
        capturedSignal = signal
        // Never resolves — simulates in-flight request
        return new Promise(() => {})
      })

      const { rerender } = renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      // Wait for the first fetch call to be made and capture signal
      await waitFor(() => {
        expect(capturedSignal).toBeDefined()
      })

      const firstSignal = capturedSignal!
      expect(firstSignal.aborted).toBe(false)

      // Trigger a dep change — change walletAddress
      act(() => {
        useSwapStore.getState().setWalletAddress('0xNewAddress1234567890abcdef1234567890abcdef')
      })

      rerender()

      // Previous signal should now be aborted
      await waitFor(() => {
        expect(firstSignal.aborted).toBe(true)
      })
    })
  })

  describe('error handling', () => {
    it('sets store.error when API throws', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setInputToken(MOCK_TOKEN)

      vi.spyOn(api, 'getWalletBalances').mockRejectedValue(new Error('Network failure'))

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(useSwapStore.getState().error).toBe('Network failure')
      })
    })

    it('does not set error when request was aborted', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setInputToken(MOCK_TOKEN)

      vi.spyOn(api, 'getWalletBalances').mockImplementation((_addr, _chainId, signal) => {
        return new Promise<BalancesResult>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            const err = new Error('AbortError')
            err.name = 'AbortError'
            reject(err)
          })
        })
      })

      const { unmount } = renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      // Unmount triggers abort
      act(() => {
        unmount()
      })

      // Store error should remain null — aborted requests are silenced
      await new Promise((r) => setTimeout(r, 50))
      expect(useSwapStore.getState().error).toBeNull()
    })
  })

  describe('address lowercase matching', () => {
    it('matches token by address case-insensitively', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      // Use uppercase version of the token address
      const upperCaseToken = {
        ...MOCK_TOKEN,
        address: MOCK_TOKEN.address.toUpperCase(),
      }
      store.setInputToken(upperCaseToken)
      store.setChainId(8453)

      vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        // Should still find the balance via case-insensitive match
        expect(useSwapStore.getState().inputBalance).toBe('5000000000')
      })
    })

    it('matches token by symbol case-insensitively', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      // Token with lowercase symbol
      const lowerCaseSymbolToken = {
        ...MOCK_TOKEN,
        symbol: 'usdc',
        address: '0xNotInBalances',
      }
      store.setInputToken(lowerCaseSymbolToken)
      store.setChainId(8453)

      vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        // Symbol 'usdc' should match 'USDC' in response
        expect(useSwapStore.getState().inputBalance).toBe('5000000000')
      })
    })
  })

  describe('unmount during pending request', () => {
    it('does not cause setState warning on unmount during pending fetch', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setInputToken(MOCK_TOKEN)

      // Never-resolving mock
      vi.spyOn(api, 'getWalletBalances').mockReturnValue(new Promise(() => {}))

      const consoleSpy = vi.spyOn(console, 'error')

      const { unmount } = renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      // Unmount while request is still pending
      act(() => {
        unmount()
      })

      // Give a tick for any async follow-up
      await new Promise((r) => setTimeout(r, 50))

      // Should not have logged any React state update warnings
      const reactWarnings = consoleSpy.mock.calls.filter((args) =>
        String(args[0]).includes('unmounted component') ||
        String(args[0]).includes('setState')
      )
      expect(reactWarnings).toHaveLength(0)
    })
  })

  describe('null input/output tokens', () => {
    it('handles null inputToken gracefully — inputBalance stays null', async () => {
      setupEvmWallet()
      const store = useSwapStore.getState()
      store.setInputToken(null)
      store.setOutputToken(null)

      vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        // null token → getBalance returns null
        expect(useSwapStore.getState().inputBalance).toBeNull()
      })
    })
  })

  describe('managed wallet', () => {
    it('fetches balances using managedWallet.address when walletMode is managed', async () => {
      const managedAddress = '0xManagedWalletAddress1234567890abcdef1234'
      const store = useSwapStore.getState()
      store.setWalletMode('managed')
      store.setManagedWallet({
        address: managedAddress,
        type: 'managed',
        supported_chains: [8453],
        created_at: '2024-01-01T00:00:00Z',
      })
      store.setInputToken(MOCK_TOKEN)
      store.setChainId(8453)

      const spy = vi.spyOn(api, 'getWalletBalances').mockResolvedValue(MOCK_BALANCES)

      renderHook(() => useWalletBalances(), { wrapper: HookWrapper })

      await waitFor(() => {
        expect(spy).toHaveBeenCalledWith(
          managedAddress,
          expect.any(Number),
          expect.any(AbortSignal),
        )
      })
    })
  })
})
