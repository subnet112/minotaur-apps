/**
 * Unit tests for useWalletConnection hook.
 *
 * Covers 5 flows:
 *   1. connectExternalWallet  (~7 tests)
 *   2. createManagedWallet    (~5 tests)
 *   3. connectBittensorWallet (~7 tests)
 *   4. setupBittensorProxy    (~10 tests)
 *   5. switchChain            (~6 tests)
 */
import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSwapStore } from '@/store'
import { useWalletConnection, switchChain } from '@/hooks/useWalletConnection'
import * as api from '@/api/client'
import { HookWrapper, installEthereumStub } from './test-utils'
import type { EthereumStub } from './test-utils'
import { mockEvmAddress, mockBittensorAddress } from './fixtures'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('@polkadot/api', () => ({
  ApiPromise: { create: vi.fn() },
  WsProvider: vi.fn(),
}))

// Import the mocked module so we can access the mock fns via vi.mocked()
import * as polkadotApi from '@polkadot/api'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let INITIAL_STATE: Record<string, unknown>

beforeAll(() => {
  const s = useSwapStore.getState() as Record<string, unknown>
  INITIAL_STATE = {}
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'function') INITIAL_STATE[k] = v
  }
})

function resetStoreLocal() {
  const current = useSwapStore.getState() as Record<string, unknown>
  const actions: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(current)) {
    if (typeof v === 'function') actions[k] = v
  }
  useSwapStore.setState({ ...INITIAL_STATE, ...actions } as never, true)
}

// ---------------------------------------------------------------------------
// Per-test setup
// ---------------------------------------------------------------------------

let ethStub: EthereumStub

beforeEach(() => {
  resetStoreLocal()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  ethStub = installEthereumStub()
})

afterEach(() => {
  // Remove ethereum so it doesn't leak across describe blocks
  Object.defineProperty(window, 'ethereum', { configurable: true, value: undefined })
})

// ---------------------------------------------------------------------------
// 1. connectExternalWallet
// ---------------------------------------------------------------------------

describe('connectExternalWallet', () => {
  it('MetaMask request accepted → walletAddress set and walletConnected=true', async () => {
    ethStub.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return Promise.resolve([mockEvmAddress])
      if (method === 'eth_chainId') return Promise.resolve('0x1')
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectExternalWallet()
    })

    expect(useSwapStore.getState().walletAddress).toBe(mockEvmAddress)
    expect(useSwapStore.getState().walletConnected).toBe(true)
  })

  it('MetaMask request accepted → walletChainId set from eth_chainId', async () => {
    ethStub.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return Promise.resolve([mockEvmAddress])
      if (method === 'eth_chainId') return Promise.resolve('0x2105') // Base = 8453
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectExternalWallet()
    })

    expect(useSwapStore.getState().walletChainId).toBe(8453)
  })

  it('no window.ethereum → graceful no-op (no throw, no state change)', async () => {
    Object.defineProperty(window, 'ethereum', { configurable: true, value: undefined })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectExternalWallet()
    })

    expect(useSwapStore.getState().walletConnected).toBe(false)
    expect(useSwapStore.getState().walletAddress).toBe('')
  })

  it('request rejected → walletConnected stays false', async () => {
    ethStub.request.mockRejectedValue(new Error('User rejected'))

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectExternalWallet()
    })

    expect(useSwapStore.getState().walletConnected).toBe(false)
  })

  it('chain detection parses hex 0x3c4 → 964', async () => {
    ethStub.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return Promise.resolve([mockEvmAddress])
      if (method === 'eth_chainId') return Promise.resolve('0x3c4')
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectExternalWallet()
    })

    expect(useSwapStore.getState().walletChainId).toBe(964)
  })

  it('setWalletConnected fires before setWalletChainId (store update order)', async () => {
    const order: string[] = []
    const origSetConnected = useSwapStore.getState().setWalletConnected
    const origSetChainId = useSwapStore.getState().setWalletChainId

    vi.spyOn(useSwapStore.getState(), 'setWalletConnected').mockImplementation((v) => {
      order.push('setWalletConnected')
      origSetConnected(v)
    })
    vi.spyOn(useSwapStore.getState(), 'setWalletChainId').mockImplementation((v) => {
      order.push('setWalletChainId')
      origSetChainId(v)
    })

    ethStub.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return Promise.resolve([mockEvmAddress])
      if (method === 'eth_chainId') return Promise.resolve('0x1')
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectExternalWallet()
    })

    const connIdx = order.indexOf('setWalletConnected')
    const chainIdx = order.indexOf('setWalletChainId')
    expect(connIdx).toBeGreaterThanOrEqual(0)
    expect(chainIdx).toBeGreaterThan(connIdx)
  })

  it('empty accounts array → walletConnected stays false', async () => {
    ethStub.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_requestAccounts') return Promise.resolve([])
      return Promise.resolve(null)
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectExternalWallet()
    })

    expect(useSwapStore.getState().walletConnected).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. createManagedWallet
// ---------------------------------------------------------------------------

describe('createManagedWallet', () => {
  it('API success → store.managedWallet set and walletConnected=true', async () => {
    const mockWallet = {
      address: mockEvmAddress,
      type: 'managed',
      supported_chains: [8453],
      created_at: '2026-01-01T00:00:00Z',
    }
    vi.spyOn(api, 'createWallet').mockResolvedValue(mockWallet)

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.createManagedWallet()
    })

    expect(useSwapStore.getState().managedWallet).toEqual(mockWallet)
    expect(useSwapStore.getState().walletConnected).toBe(true)
  })

  it('API success → loading transitions false→true→false', async () => {
    const loadingStates: boolean[] = []
    vi.spyOn(api, 'createWallet').mockImplementation(async () => {
      loadingStates.push(useSwapStore.getState().loading)
      return {
        address: mockEvmAddress,
        type: 'managed',
        supported_chains: [8453],
        created_at: '2026-01-01T00:00:00Z',
      }
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.createManagedWallet()
    })

    // loading was true when API was called
    expect(loadingStates).toContain(true)
    // loading is false after completion
    expect(useSwapStore.getState().loading).toBe(false)
  })

  it('API failure → error set in store', async () => {
    vi.spyOn(api, 'createWallet').mockRejectedValue(new Error('Server 500'))

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.createManagedWallet()
    })

    expect(useSwapStore.getState().error).toBe('Server 500')
    expect(useSwapStore.getState().walletConnected).toBe(false)
  })

  it('API failure → loading ends as false', async () => {
    vi.spyOn(api, 'createWallet').mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.createManagedWallet()
    })

    expect(useSwapStore.getState().loading).toBe(false)
  })

  it('API failure → managedWallet remains null', async () => {
    vi.spyOn(api, 'createWallet').mockRejectedValue(new Error('Unauthorized'))

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.createManagedWallet()
    })

    expect(useSwapStore.getState().managedWallet).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3. connectBittensorWallet
// ---------------------------------------------------------------------------

describe('connectBittensorWallet', () => {
  function installPolkadotExtension(
    opts: {
      accounts?: { address: string; meta?: { name: string } }[]
      enableReject?: boolean
      noAccounts?: boolean
    } = {},
  ) {
    const { accounts = [{ address: mockBittensorAddress }], enableReject = false, noAccounts = false } = opts

    const enabledMock = enableReject
      ? Promise.reject(new Error('Extension enable rejected'))
      : Promise.resolve({
          accounts: noAccounts
            ? null
            : {
                get: vi.fn().mockResolvedValue(accounts),
              },
        })

    const extensionMock = {
      enable: vi.fn().mockReturnValue(enabledMock),
    }
    ;(window as any).injectedWeb3 = { 'polkadot-js': extensionMock }
    return extensionMock
  }

  afterEach(() => {
    delete (window as any).injectedWeb3
  })

  it('Polkadot extension present → bittensorAddress set', async () => {
    installPolkadotExtension()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response)

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectBittensorWallet()
    })

    expect(useSwapStore.getState().bittensorAddress).toBe(mockBittensorAddress)
  })

  it('Polkadot extension present → bittensorConnected=true', async () => {
    installPolkadotExtension()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response)

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectBittensorWallet()
    })

    expect(useSwapStore.getState().bittensorConnected).toBe(true)
  })

  it('extension absent → toast.error (no crash)', async () => {
    delete (window as any).injectedWeb3

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectBittensorWallet()
    })

    // No extension → should not set bittensorConnected
    expect(useSwapStore.getState().bittensorConnected).toBe(false)
  })

  it('active permission check → bittensorProxySetup=true (F18 regression)', async () => {
    installPolkadotExtension()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ permissions: [{ status: 'active' }] }),
    } as Response)

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectBittensorWallet()
    })

    expect(useSwapStore.getState().bittensorProxySetup).toBe(true)
  })

  it('permission check failure → graceful fallback, bittensorConnected still true', async () => {
    installPolkadotExtension()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectBittensorWallet()
    })

    // Extension connected but proxy setup unknown
    expect(useSwapStore.getState().bittensorConnected).toBe(true)
    expect(useSwapStore.getState().bittensorProxySetup).toBe(false)
  })

  it('no accounts found → bittensorConnected stays false', async () => {
    installPolkadotExtension({ accounts: [] })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectBittensorWallet()
    })

    expect(useSwapStore.getState().bittensorConnected).toBe(false)
  })

  it('multiple accounts → first account used', async () => {
    const secondAddress = '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty'
    installPolkadotExtension({
      accounts: [
        { address: mockBittensorAddress },
        { address: secondAddress },
      ],
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: async () => ({}),
    } as Response)

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.connectBittensorWallet()
    })

    expect(useSwapStore.getState().bittensorAddress).toBe(mockBittensorAddress)
  })
})

// ---------------------------------------------------------------------------
// 4. setupBittensorProxy
// ---------------------------------------------------------------------------

describe('setupBittensorProxy', () => {
  const delegateHotkey = '5GrwvaEF5zXb26Fz9rcQkQxwZsEzYq67VjQgVL3Cv7jD'

  function setupBittensorAddress() {
    useSwapStore.getState().setBittensorAddress(mockBittensorAddress)
  }

  function installPolkadotExtensionWithSigner(signerBehavior?: (resolve: () => void, reject: (e: Error) => void) => void) {
    const defaultSigner = {
      signPayload: vi.fn(),
    }

    // Capture the signAndSend mock so tests can override it
    const signAndSendMock = vi.fn().mockImplementation(
      (_addr: string, _opts: unknown, callback: (arg: { status: { isInBlock: boolean; isFinalized: boolean }; dispatchError: unknown }) => void) => {
        if (signerBehavior) {
          return new Promise<void>((res, rej) => signerBehavior(res, rej))
        }
        callback({ status: { isInBlock: true, isFinalized: false }, dispatchError: undefined })
        return Promise.resolve()
      }
    )

    const addProxyMock = vi.fn().mockReturnValue({ signAndSend: signAndSendMock })

    const mockApiInstance = {
      tx: { proxy: { addProxy: addProxyMock } },
      registry: {
        findMetaError: vi.fn().mockReturnValue({ section: 'proxy', name: 'Duplicate', docs: ['Duplicate'] }),
      },
      disconnect: vi.fn().mockResolvedValue(undefined),
    }

    // Override the module-level mock for this test
    vi.mocked(polkadotApi.ApiPromise.create).mockResolvedValue(mockApiInstance as any)

    const extensionMock = {
      enable: vi.fn().mockResolvedValue({
        signer: defaultSigner,
        accounts: { get: vi.fn().mockResolvedValue([{ address: mockBittensorAddress }]) },
      }),
    }
    ;(window as any).injectedWeb3 = { 'polkadot-js': extensionMock }
    return { extensionMock, signAndSendMock, mockApiInstance }
  }

  afterEach(() => {
    delete (window as any).injectedWeb3
  })

  it('pre-check active permission → skips signAndSend, sets bittensorProxySetup=true (F18 regression)', async () => {
    setupBittensorAddress()
    const { signAndSendMock } = installPolkadotExtensionWithSigner()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/v1/native-bittensor/permissions')) {
        return {
          ok: true,
          json: async () => ({ permissions: [{ status: 'active' }] }),
        } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.setupBittensorProxy()
    })

    // signAndSend should NOT have been called
    expect(signAndSendMock).not.toHaveBeenCalled()
    expect(useSwapStore.getState().bittensorProxySetup).toBe(true)
  })

  it('pre-check no active permission → proceeds with setup flow', async () => {
    setupBittensorAddress()
    const { mockApiInstance } = installPolkadotExtensionWithSigner()

    // Make signAndSend call the callback with isInBlock=true
    mockApiInstance.tx.proxy.addProxy.mockReturnValue({
      signAndSend: vi.fn().mockImplementation(
        (_addr: string, _opts: unknown, cb: (arg: any) => void) => {
          cb({ status: { isInBlock: true, isFinalized: false }, dispatchError: undefined })
          return Promise.resolve()
        }
      )
    })

    let callCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'GET') {
        // Pre-check: no active permissions
        return { ok: true, json: async () => ({ permissions: [] }) } as Response
      }
      if (url.includes('/api/health')) {
        return { ok: true, json: async () => ({ validator_hotkey: delegateHotkey }) } as Response
      }
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'POST') {
        return { ok: true, json: async () => ({ permission_id: 'perm-1' }) } as Response
      }
      if (url.includes('/activate')) {
        return { ok: true, json: async () => ({ status: 'active' }) } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.setupBittensorProxy()
    })

    // Should have attempted setup
    expect(useSwapStore.getState().bittensorProxySetup).toBe(true)
  })

  it('bittensorAddress empty → early return, no fetch', async () => {
    // Do NOT set bittensorAddress
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.setupBittensorProxy()
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('pre-check API failure → falls through to setup flow (non-fatal)', async () => {
    setupBittensorAddress()
    const { mockApiInstance } = installPolkadotExtensionWithSigner()

    mockApiInstance.tx.proxy.addProxy.mockReturnValue({
      signAndSend: vi.fn().mockImplementation(
        (_addr: string, _opts: unknown, cb: (arg: any) => void) => {
          cb({ status: { isInBlock: true, isFinalized: false }, dispatchError: undefined })
          return Promise.resolve()
        }
      )
    })

    let firstPermCall = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'GET' && firstPermCall) {
        firstPermCall = false
        throw new Error('Network error')
      }
      if (url.includes('/api/health')) {
        return { ok: true, json: async () => ({ validator_hotkey: delegateHotkey }) } as Response
      }
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'POST') {
        return { ok: true, json: async () => ({ permission_id: 'perm-2' }) } as Response
      }
      if (url.includes('/activate')) {
        return { ok: true, json: async () => ({ status: 'active' }) } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    // Should not throw
    await act(async () => {
      await result.current.setupBittensorProxy()
    })

    // Falls through to setup and completes
    expect(useSwapStore.getState().bittensorProxySetup).toBe(true)
  })

  it('signAndSend user rejection → toast error shown, bittensorProxySetup stays false', async () => {
    setupBittensorAddress()
    const { mockApiInstance } = installPolkadotExtensionWithSigner()

    mockApiInstance.tx.proxy.addProxy.mockReturnValue({
      signAndSend: vi.fn().mockImplementation(
        (_addr: string, _opts: unknown, _cb: unknown) => {
          // Throw synchronously — this escapes the outer new Promise() and
          // causes the Promise to reject, which is caught by the try/catch.
          throw new Error('User rejected')
        }
      )
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'GET') {
        return { ok: true, json: async () => ({ permissions: [] }) } as Response
      }
      if (url.includes('/api/health')) {
        return { ok: true, json: async () => ({ validator_hotkey: delegateHotkey }) } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.setupBittensorProxy()
    })

    expect(useSwapStore.getState().bittensorProxySetup).toBe(false)
  })

  it('dispatchError in callback → error parsed via registry.findMetaError', async () => {
    setupBittensorAddress()
    const { mockApiInstance } = installPolkadotExtensionWithSigner()

    const mockDispatchError = {
      isModule: true,
      asModule: { index: 30, error: [3, 0, 0, 0] },
      toString: () => 'DispatchError',
    }

    mockApiInstance.tx.proxy.addProxy.mockReturnValue({
      signAndSend: vi.fn().mockImplementation(
        (_addr: string, _opts: unknown, cb: (arg: any) => void) => {
          cb({ status: { isInBlock: false, isFinalized: false }, dispatchError: mockDispatchError })
          return new Promise(() => {}) // Never resolves — the reject path handles completion
        }
      )
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'GET') {
        return { ok: true, json: async () => ({ permissions: [] }) } as Response
      }
      if (url.includes('/api/health')) {
        return { ok: true, json: async () => ({ validator_hotkey: delegateHotkey }) } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.setupBittensorProxy()
    })

    // registry.findMetaError should have been called
    expect(mockApiInstance.registry.findMetaError).toHaveBeenCalledWith(mockDispatchError.asModule)
    expect(useSwapStore.getState().bittensorProxySetup).toBe(false)
  })

  it('success path → polkadotApi.disconnect() called (teardown)', async () => {
    setupBittensorAddress()
    const { mockApiInstance } = installPolkadotExtensionWithSigner()

    mockApiInstance.tx.proxy.addProxy.mockReturnValue({
      signAndSend: vi.fn().mockImplementation(
        (_addr: string, _opts: unknown, cb: (arg: any) => void) => {
          cb({ status: { isInBlock: true, isFinalized: false }, dispatchError: undefined })
          return Promise.resolve()
        }
      )
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'GET') {
        return { ok: true, json: async () => ({ permissions: [] }) } as Response
      }
      if (url.includes('/api/health')) {
        return { ok: true, json: async () => ({ validator_hotkey: delegateHotkey }) } as Response
      }
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'POST') {
        return { ok: true, json: async () => ({ permission_id: 'perm-3' }) } as Response
      }
      if (url.includes('/activate')) {
        return { ok: true, json: async () => ({ status: 'active' }) } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.setupBittensorProxy()
    })

    expect(mockApiInstance.disconnect).toHaveBeenCalled()
  })

  it('missing delegateHotkey → early error toast, no signAndSend', async () => {
    setupBittensorAddress()
    const { signAndSendMock } = installPolkadotExtensionWithSigner()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/api/v1/native-bittensor/permissions')) {
        return { ok: true, json: async () => ({ permissions: [] }) } as Response
      }
      if (url.includes('/api/health')) {
        // Return empty health — no hotkey
        return { ok: true, json: async () => ({}) } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.setupBittensorProxy()
    })

    expect(signAndSendMock).not.toHaveBeenCalled()
    expect(useSwapStore.getState().bittensorProxySetup).toBe(false)
  })

  it('WsProvider is constructed with local subtensor URL', async () => {
    setupBittensorAddress()
    installPolkadotExtensionWithSigner()
    const { WsProvider } = await import('@polkadot/api')

    const { mockApiInstance } = installPolkadotExtensionWithSigner()
    mockApiInstance.tx.proxy.addProxy.mockReturnValue({
      signAndSend: vi.fn().mockImplementation(
        (_addr: string, _opts: unknown, cb: (arg: any) => void) => {
          cb({ status: { isInBlock: true, isFinalized: false }, dispatchError: undefined })
          return Promise.resolve()
        }
      )
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'GET') {
        return { ok: true, json: async () => ({ permissions: [] }) } as Response
      }
      if (url.includes('/api/health')) {
        return { ok: true, json: async () => ({ validator_hotkey: delegateHotkey }) } as Response
      }
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'POST') {
        return { ok: true, json: async () => ({ permission_id: 'perm-4' }) } as Response
      }
      if (url.includes('/activate')) {
        return { ok: true, json: async () => ({ status: 'active' }) } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.setupBittensorProxy()
    })

    expect(WsProvider).toHaveBeenCalledWith('ws://localhost:19944')
  })

  it('loading ends as false after success', async () => {
    setupBittensorAddress()
    const { mockApiInstance } = installPolkadotExtensionWithSigner()

    mockApiInstance.tx.proxy.addProxy.mockReturnValue({
      signAndSend: vi.fn().mockImplementation(
        (_addr: string, _opts: unknown, cb: (arg: any) => void) => {
          cb({ status: { isInBlock: true, isFinalized: false }, dispatchError: undefined })
          return Promise.resolve()
        }
      )
    })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'GET') {
        return { ok: true, json: async () => ({ permissions: [] }) } as Response
      }
      if (url.includes('/api/health')) {
        return { ok: true, json: async () => ({ validator_hotkey: delegateHotkey }) } as Response
      }
      if (url.includes('/api/v1/native-bittensor/permissions') && method === 'POST') {
        return { ok: true, json: async () => ({ permission_id: 'perm-5' }) } as Response
      }
      if (url.includes('/activate')) {
        return { ok: true, json: async () => ({ status: 'active' }) } as Response
      }
      return { ok: false, json: async () => ({}) } as Response
    })

    const { result } = renderHook(() => useWalletConnection(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.setupBittensorProxy()
    })

    expect(useSwapStore.getState().loading).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. switchChain (exported standalone function — F16 regression)
// ---------------------------------------------------------------------------

describe('switchChain', () => {
  it('wallet_switchEthereumChain success → resolves without calling addEthereumChain', async () => {
    ethStub.request.mockResolvedValue(null)

    await switchChain(1)

    const calls = ethStub.request.mock.calls.map((c: unknown[]) => (c[0] as { method: string }).method)
    expect(calls).toContain('wallet_switchEthereumChain')
    expect(calls).not.toContain('wallet_addEthereumChain')
  })

  it('code 4902 error → wallet_addEthereumChain fallback fires', async () => {
    ethStub.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'wallet_switchEthereumChain') {
        return Promise.reject({ code: 4902 })
      }
      return Promise.resolve(null)
    })

    await switchChain(8453)

    const calls = ethStub.request.mock.calls.map((c: unknown[]) => (c[0] as { method: string }).method)
    expect(calls).toContain('wallet_addEthereumChain')
  })

  it('code 4902 → wallet_addEthereumChain called with ADD_CHAIN_PARAMS for chainId 8453', async () => {
    ethStub.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'wallet_switchEthereumChain') {
        return Promise.reject({ code: 4902 })
      }
      return Promise.resolve(null)
    })

    await switchChain(8453)

    const addCall = ethStub.request.mock.calls.find(
      (c: unknown[]) => (c[0] as { method: string }).method === 'wallet_addEthereumChain'
    )
    expect(addCall).toBeDefined()
    const params = (addCall![0] as { params: unknown[] }).params
    expect(params[0]).toMatchObject({ chainId: '0x2105', chainName: 'Base' })
  })

  it('no window.ethereum → graceful no-op', async () => {
    Object.defineProperty(window, 'ethereum', { configurable: true, value: undefined })

    // Should not throw
    await switchChain(1)
  })

  it('unknown chainId (not in CHAIN_CONFIG) → early return, no request', async () => {
    await switchChain(99999)

    expect(ethStub.request).not.toHaveBeenCalled()
  })

  it('switch fails with non-4902 error → silently ignored, no addEthereumChain', async () => {
    ethStub.request.mockImplementation(({ method }: { method: string }) => {
      if (method === 'wallet_switchEthereumChain') {
        return Promise.reject({ code: 4001 }) // user rejection
      }
      return Promise.resolve(null)
    })

    // Should not throw
    await switchChain(1)

    const calls = ethStub.request.mock.calls.map((c: unknown[]) => (c[0] as { method: string }).method)
    expect(calls).not.toContain('wallet_addEthereumChain')
  })
})
