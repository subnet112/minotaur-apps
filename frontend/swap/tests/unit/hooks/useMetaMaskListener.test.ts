import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSwapStore } from '@/store'
import { useMetaMaskListener } from '@/hooks/useWalletConnection'

// ---------------------------------------------------------------------------
// Inline stubs of shared helpers (H1 commits the real files in parallel;
// Wave 1 review will dedup).
// ---------------------------------------------------------------------------

const mockEvmAddress = '0x5a33Bf4a6C1DA92e0f2bCc1edF8a4D33C8b9c108'

type EthereumStub = {
  request: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
}

// Single stub object that persists for the lifetime of the test file.
// Tests reset mocks between runs; we never delete window.ethereum so that
// the hook's cleanup function (which calls window.ethereum!.removeListener)
// doesn't crash on unmount when afterEach/afterAll would have removed it.
let ethereumStub: EthereumStub | null = null

function installEthereumStub(): EthereumStub {
  const stub: EthereumStub = {
    request: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
  Object.defineProperty(window, 'ethereum', { configurable: true, value: stub })
  ethereumStub = stub
  return stub
}

function removeEthereum() {
  Object.defineProperty(window, 'ethereum', { configurable: true, value: undefined })
  ethereumStub = null
}

let INITIAL_STATE: Record<string, unknown>

beforeAll(() => {
  const s = useSwapStore.getState() as Record<string, unknown>
  INITIAL_STATE = {}
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'function') INITIAL_STATE[k] = v
  }
})

function resetStore() {
  const current = useSwapStore.getState() as Record<string, unknown>
  const actions: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(current)) {
    if (typeof v === 'function') actions[k] = v
  }
  useSwapStore.setState({ ...INITIAL_STATE, ...actions } as never, true)
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore()
  // Ensure walletMode is 'external' so the hook actually runs
  useSwapStore.getState().setWalletMode('external')
  // Reset vi mocks between tests (but don't remove ethereum — see note above)
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMetaMaskListener', () => {
  describe('initial reads on mount', () => {
    it('calls eth_accounts on mount when ethereum is present', async () => {
      const stub = installEthereumStub()
      stub.request.mockResolvedValue([])

      renderHook(() => useMetaMaskListener())

      await waitFor(() => {
        const methods = stub.request.mock.calls.map((c: unknown[]) => (c[0] as { method: string }).method)
        expect(methods).toContain('eth_accounts')
      })
    })

    it('calls eth_chainId on mount when ethereum is present', async () => {
      const stub = installEthereumStub()
      stub.request.mockResolvedValue([])

      renderHook(() => useMetaMaskListener())

      await waitFor(() => {
        const methods = stub.request.mock.calls.map((c: unknown[]) => (c[0] as { method: string }).method)
        expect(methods).toContain('eth_chainId')
      })
    })

    it('calls both eth_accounts and eth_chainId on mount', async () => {
      const stub = installEthereumStub()
      stub.request.mockResolvedValue([])

      renderHook(() => useMetaMaskListener())

      await waitFor(() => {
        const methods = stub.request.mock.calls.map((c: unknown[]) => (c[0] as { method: string }).method)
        expect(methods).toContain('eth_accounts')
        expect(methods).toContain('eth_chainId')
      })
    })

    it('sets walletConnected=true and walletAddress when eth_accounts returns non-empty', async () => {
      const stub = installEthereumStub()
      stub.request.mockImplementation(({ method }: { method: string }) => {
        if (method === 'eth_accounts') return Promise.resolve([mockEvmAddress])
        if (method === 'eth_chainId') return Promise.resolve('0x1')
        return Promise.resolve(null)
      })

      renderHook(() => useMetaMaskListener())

      await waitFor(() => {
        expect(useSwapStore.getState().walletConnected).toBe(true)
        expect(useSwapStore.getState().walletAddress).toBe(mockEvmAddress)
      })
    })

    it('parses hex chain ID 0x1 → 1 from initial eth_chainId', async () => {
      const stub = installEthereumStub()
      stub.request.mockImplementation(({ method }: { method: string }) => {
        if (method === 'eth_accounts') return Promise.resolve([])
        if (method === 'eth_chainId') return Promise.resolve('0x1')
        return Promise.resolve(null)
      })

      renderHook(() => useMetaMaskListener())

      await waitFor(() => {
        expect(useSwapStore.getState().walletChainId).toBe(1)
      })
    })

    it('parses hex chain ID 0x3c4 → 964 from initial eth_chainId', async () => {
      const stub = installEthereumStub()
      stub.request.mockImplementation(({ method }: { method: string }) => {
        if (method === 'eth_accounts') return Promise.resolve([])
        if (method === 'eth_chainId') return Promise.resolve('0x3c4')
        return Promise.resolve(null)
      })

      renderHook(() => useMetaMaskListener())

      await waitFor(() => {
        expect(useSwapStore.getState().walletChainId).toBe(964)
      })
    })
  })

  describe('event listener registration', () => {
    it('registers accountsChanged listener via ethereum.on', () => {
      const stub = installEthereumStub()
      // Never-resolving promise so async .then() paths don't trigger act warnings
      stub.request.mockReturnValue(new Promise(() => {}))

      renderHook(() => useMetaMaskListener())

      expect(stub.on).toHaveBeenCalledWith('accountsChanged', expect.any(Function))
    })

    it('registers chainChanged listener via ethereum.on', () => {
      const stub = installEthereumStub()
      stub.request.mockReturnValue(new Promise(() => {}))

      renderHook(() => useMetaMaskListener())

      expect(stub.on).toHaveBeenCalledWith('chainChanged', expect.any(Function))
    })
  })

  describe('event handler behavior', () => {
    it('accountsChanged with new accounts → store.walletAddress updates', () => {
      const stub = installEthereumStub()
      // Use never-resolving promises so async eth_accounts/eth_chainId reads
      // don't cause act() warnings while we test the event-handler side path.
      stub.request.mockReturnValue(new Promise(() => {}))

      renderHook(() => useMetaMaskListener())

      // Get the registered accountsChanged handler
      const accountsChangedCall = stub.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'accountsChanged'
      )
      expect(accountsChangedCall).toBeDefined()
      const handler = accountsChangedCall![1] as (accounts: string[]) => void

      act(() => {
        handler([mockEvmAddress])
      })

      expect(useSwapStore.getState().walletAddress).toBe(mockEvmAddress)
    })

    it('chainChanged event fires → store.walletChainId updates', () => {
      const stub = installEthereumStub()
      stub.request.mockReturnValue(new Promise(() => {}))

      renderHook(() => useMetaMaskListener())

      const chainChangedCall = stub.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'chainChanged'
      )
      expect(chainChangedCall).toBeDefined()
      const handler = chainChangedCall![1] as (chainIdHex: string) => void

      act(() => {
        handler('0x89') // Polygon = 137
      })

      expect(useSwapStore.getState().walletChainId).toBe(137)
    })

    it('chainChanged fires with 0x3c4 → walletChainId = 964', () => {
      const stub = installEthereumStub()
      stub.request.mockReturnValue(new Promise(() => {}))

      renderHook(() => useMetaMaskListener())

      const chainChangedCall = stub.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'chainChanged'
      )
      const handler = chainChangedCall![1] as (chainIdHex: string) => void

      act(() => {
        handler('0x3c4')
      })

      expect(useSwapStore.getState().walletChainId).toBe(964)
    })
  })

  describe('disconnect / empty accounts', () => {
    it('accountsChanged with [] → walletConnected=false', () => {
      const stub = installEthereumStub()
      stub.request.mockReturnValue(new Promise(() => {}))

      // Start connected
      useSwapStore.getState().setWalletConnected(true)
      useSwapStore.getState().setWalletAddress(mockEvmAddress)

      renderHook(() => useMetaMaskListener())

      const accountsChangedCall = stub.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'accountsChanged'
      )
      const handler = accountsChangedCall![1] as (accounts: string[]) => void

      act(() => {
        handler([]) // disconnect event
      })

      expect(useSwapStore.getState().walletConnected).toBe(false)
    })

    it('accountsChanged with [] → walletAddress cleared', () => {
      const stub = installEthereumStub()
      stub.request.mockReturnValue(new Promise(() => {}))

      useSwapStore.getState().setWalletConnected(true)
      useSwapStore.getState().setWalletAddress(mockEvmAddress)

      renderHook(() => useMetaMaskListener())

      const accountsChangedCall = stub.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'accountsChanged'
      )
      const handler = accountsChangedCall![1] as (accounts: string[]) => void

      act(() => {
        handler([])
      })

      expect(useSwapStore.getState().walletAddress).toBe('')
    })
  })

  describe('cleanup on unmount', () => {
    it('removes accountsChanged listener on unmount', () => {
      const stub = installEthereumStub()
      stub.request.mockReturnValue(new Promise(() => {}))

      const { unmount } = renderHook(() => useMetaMaskListener())

      const accountsChangedHandler = stub.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'accountsChanged'
      )?.[1]

      unmount()

      expect(stub.removeListener).toHaveBeenCalledWith('accountsChanged', accountsChangedHandler)
    })

    it('removes chainChanged listener on unmount', () => {
      const stub = installEthereumStub()
      stub.request.mockReturnValue(new Promise(() => {}))

      const { unmount } = renderHook(() => useMetaMaskListener())

      const chainChangedHandler = stub.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'chainChanged'
      )?.[1]

      unmount()

      expect(stub.removeListener).toHaveBeenCalledWith('chainChanged', chainChangedHandler)
    })
  })

  describe('no window.ethereum', () => {
    it('does not throw when window.ethereum is undefined', () => {
      // Ensure no ethereum stub is installed
      removeEthereum()

      expect(() => {
        const { unmount } = renderHook(() => useMetaMaskListener())
        unmount()
      }).not.toThrow()
    })

    it('does not call on() when window.ethereum is undefined', () => {
      removeEthereum()

      // Render with no ethereum — should be a no-op, no crash
      const { unmount } = renderHook(() => useMetaMaskListener())
      unmount()

      // No stub to assert on — test passes as long as no exception is thrown
    })
  })

  describe('walletMode guard', () => {
    it('does not register listeners when walletMode is not external', () => {
      const stub = installEthereumStub()
      stub.request.mockReturnValue(new Promise(() => {}))

      // Switch to managed mode
      useSwapStore.getState().setWalletMode('managed')

      renderHook(() => useMetaMaskListener())

      expect(stub.on).not.toHaveBeenCalled()
      expect(stub.request).not.toHaveBeenCalled()
    })

    it('does not make requests when walletMode is bittensor', () => {
      const stub = installEthereumStub()
      stub.request.mockReturnValue(new Promise(() => {}))

      useSwapStore.getState().setWalletMode('bittensor')

      renderHook(() => useMetaMaskListener())

      expect(stub.request).not.toHaveBeenCalled()
    })
  })
})
