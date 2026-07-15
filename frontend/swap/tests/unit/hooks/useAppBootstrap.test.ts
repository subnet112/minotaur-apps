/**
 * Unit tests for useAppBootstrap hook.
 *
 * Covers:
 *  - Solver tokens fetched on mount → store.solverTokens updated
 *  - Native token injection from hardcoded TOKENS config
 *  - Fallback token selection (USDC as input, WETH as output)
 *  - listApps → appId + appLoaded set
 *  - Deployment selection: chain-matching deployment preferred
 *  - store.loadHistory() called on mount (F19 regression guard)
 *  - Error path: api throws → falls back to hardcoded tokens (no store.error)
 *  - Unmount while fetch in-flight: no setState-after-unmount warning
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSwapStore } from '@/store'
import { useAppBootstrap, CONFIGURED_APP_ID } from '@/hooks/useAppBootstrap'
import * as api from '@/api/client'
import { HookWrapper, resetStore } from './test-utils'

// ── Test constants ───────────────────────────────────────────────────────────

const BASE_CHAIN_ID = 8453  // DEFAULT_CHAIN_ID from config/chains.ts

// The UI serves exactly the CONFIGURED app (VITE_APP_ID, default V2) — never
// the list head — so mocks must list that id for it to be chosen.
const APP_ID = CONFIGURED_APP_ID

const MOCK_SOLVER_TOKENS_RESPONSE = {
  chain_id: BASE_CHAIN_ID,
  count: 2,
  tokens: [
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, pool_count: 10 },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, pool_count: 8 },
  ],
}

const MOCK_APPS_RESPONSE = {
  apps: [
    {
      app_id: APP_ID,
      name: 'DexAggregatorApp',
      description: 'Test app',
      supported_chains: [BASE_CHAIN_ID],
      deployer: '0xdeployer',
      status: 'active',
    },
  ],
}

const MOCK_APP_STATUS = {
  app_id: APP_ID,
  deployments: {
    base: {
      contract_address: '0xContractOnBase',
      chain_id: BASE_CHAIN_ID,
      status: 'active',
    },
  },
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore()
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Helper: spy on the three main API calls ──────────────────────────────────

function mockApis(overrides: {
  getChainTokens?: ReturnType<typeof vi.spyOn>
  listApps?: ReturnType<typeof vi.spyOn>
  getAppStatus?: ReturnType<typeof vi.spyOn>
} = {}) {
  const getChainTokensSpy = overrides.getChainTokens
    ?? vi.spyOn(api, 'getChainTokens').mockResolvedValue(MOCK_SOLVER_TOKENS_RESPONSE)
  const listAppsSpy = overrides.listApps
    ?? vi.spyOn(api, 'listApps').mockResolvedValue(MOCK_APPS_RESPONSE)
  const getAppStatusSpy = overrides.getAppStatus
    ?? vi.spyOn(api, 'getAppStatus').mockResolvedValue(MOCK_APP_STATUS as any)
  return { getChainTokensSpy, listAppsSpy, getAppStatusSpy }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useAppBootstrap', () => {
  // ── Solver tokens ──────────────────────────────────────────────────────────

  it('fetches solver tokens on mount and updates store.solverTokens', async () => {
    mockApis()

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      const tokens = useSwapStore.getState().solverTokens[BASE_CHAIN_ID]
      expect(tokens).toBeDefined()
      // Hook injects native ETH from hardcoded config, so we get ≥2 tokens
      expect(tokens.length).toBeGreaterThanOrEqual(2)
    })

    const tokens = useSwapStore.getState().solverTokens[BASE_CHAIN_ID]
    const symbols = tokens.map((t) => t.symbol)
    expect(symbols).toContain('USDC')
    expect(symbols).toContain('WETH')
  })

  it('maps solver token decimals correctly', async () => {
    mockApis()

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().solverTokens[BASE_CHAIN_ID]).toBeDefined()
    })

    const tokens = useSwapStore.getState().solverTokens[BASE_CHAIN_ID]
    const usdc = tokens.find((t) => t.symbol === 'USDC')
    const weth = tokens.find((t) => t.symbol === 'WETH')
    expect(usdc?.decimals).toBe(6)
    expect(weth?.decimals).toBe(18)
  })

  it('calls getChainTokens with the store chainId', async () => {
    const { getChainTokensSpy } = mockApis()

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(getChainTokensSpy).toHaveBeenCalledWith(BASE_CHAIN_ID)
    })
  })

  // ── Native token injection ─────────────────────────────────────────────────

  it('injects native token when solver list omits it', async () => {
    // Solver returns only ERC-20s (USDC + WETH), no native ETH
    vi.spyOn(api, 'getChainTokens').mockResolvedValue({
      chain_id: BASE_CHAIN_ID,
      count: 2,
      tokens: [
        { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, pool_count: 10 },
        { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, pool_count: 8 },
      ],
    })
    vi.spyOn(api, 'listApps').mockResolvedValue(MOCK_APPS_RESPONSE)
    vi.spyOn(api, 'getAppStatus').mockResolvedValue(MOCK_APP_STATUS as any)

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      const tokens = useSwapStore.getState().solverTokens[BASE_CHAIN_ID]
      // ETH native token should be prepended from hardcoded TOKENS[8453]
      expect(tokens?.some((t) => t.native)).toBe(true)
    })

    const tokens = useSwapStore.getState().solverTokens[BASE_CHAIN_ID]
    expect(tokens[0].native).toBe(true)
    expect(tokens[0].symbol).toBe('ETH')
  })

  it('does not duplicate native token when solver already includes it', async () => {
    // Solver returns native ETH address among tokens
    vi.spyOn(api, 'getChainTokens').mockResolvedValue({
      chain_id: BASE_CHAIN_ID,
      count: 3,
      tokens: [
        // Native sentinel address already in solver result
        { address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', symbol: 'ETH', decimals: 18, pool_count: 0 },
        { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, pool_count: 10 },
        { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18, pool_count: 8 },
      ],
    })
    vi.spyOn(api, 'listApps').mockResolvedValue(MOCK_APPS_RESPONSE)
    vi.spyOn(api, 'getAppStatus').mockResolvedValue(MOCK_APP_STATUS as any)

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      const tokens = useSwapStore.getState().solverTokens[BASE_CHAIN_ID]
      expect(tokens).toBeDefined()
    })

    const tokens = useSwapStore.getState().solverTokens[BASE_CHAIN_ID]
    const ethCount = tokens.filter(
      (t) => t.address === '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    ).length
    expect(ethCount).toBe(1)
  })

  // ── Fallback token selection ───────────────────────────────────────────────

  it('sets inputToken to USDC and outputToken to WETH when nothing pre-selected', async () => {
    mockApis()

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().inputToken).not.toBeNull()
    })

    const state = useSwapStore.getState()
    expect(state.inputToken?.symbol).toBe('USDC')
    expect(state.outputToken?.symbol).toBe('WETH')
  })

  it('preserves pre-selected token if it appears in solver list', async () => {
    // Pre-select USDC as input token (address matches solver result)
    useSwapStore.getState().setInputToken({
      symbol: 'USDC',
      name: 'USD Coin (stale)',
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      decimals: 6,
      icon: '$',
    })

    mockApis()

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().solverTokens[BASE_CHAIN_ID]).toBeDefined()
    })

    // Should have been updated to the solver's version (same address, but
    // name comes from solver mapping: symbol is used as name)
    const state = useSwapStore.getState()
    expect(state.inputToken?.symbol).toBe('USDC')
    expect(state.inputToken?.address.toLowerCase()).toBe(
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'.toLowerCase(),
    )
  })

  // ── App discovery ──────────────────────────────────────────────────────────

  it('sets appId and appLoaded after listApps resolves', async () => {
    mockApis()

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().appLoaded).toBe(true)
    })

    expect(useSwapStore.getState().appId).toBe(APP_ID)
  })

  // ── Deployment selection ───────────────────────────────────────────────────

  it('sets contractAddress from a matching chain deployment', async () => {
    mockApis()

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().contractAddress).toBeTruthy()
    })

    expect(useSwapStore.getState().contractAddress).toBe('0xContractOnBase')
  })

  it('falls back to any order-ready deployment when none matches current chain', async () => {
    // Deployment is on mainnet (chain 1), but store chainId is 8453 (Base)
    vi.spyOn(api, 'listApps').mockResolvedValue(MOCK_APPS_RESPONSE)
    vi.spyOn(api, 'getAppStatus').mockResolvedValue({
      app_id: 'dex-app-mainnet-001',
      deployments: {
        mainnet: {
          contract_address: '0xContractOnMainnet',
          chain_id: 1,
          status: 'active',
        },
      },
    } as any)
    vi.spyOn(api, 'getChainTokens').mockResolvedValue(MOCK_SOLVER_TOKENS_RESPONSE)

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().contractAddress).toBeTruthy()
    })

    // Falls back to mainnet deployment even though chain doesn't match
    expect(useSwapStore.getState().contractAddress).toBe('0xContractOnMainnet')
  })

  it('prefers matching chain deployment over fallback deployment', async () => {
    vi.spyOn(api, 'listApps').mockResolvedValue(MOCK_APPS_RESPONSE)
    vi.spyOn(api, 'getAppStatus').mockResolvedValue({
      app_id: 'dex-app-mainnet-001',
      deployments: {
        mainnet: {
          contract_address: '0xContractOnMainnet',
          chain_id: 1,
          status: 'active',
        },
        base: {
          contract_address: '0xContractOnBase',
          chain_id: BASE_CHAIN_ID,
          status: 'active',
        },
      },
    } as any)
    vi.spyOn(api, 'getChainTokens').mockResolvedValue(MOCK_SOLVER_TOKENS_RESPONSE)

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().contractAddress).toBeTruthy()
    })

    expect(useSwapStore.getState().contractAddress).toBe('0xContractOnBase')
  })

  it('only exposes the V2 Base and Ethereum deployments', async () => {
    vi.spyOn(api, 'listApps').mockResolvedValue(MOCK_APPS_RESPONSE)
    vi.spyOn(api, 'getAppStatus').mockResolvedValue({
      app_id: APP_ID,
      deployments: {
        mainnet: { contract_address: '0xContractOnMainnet', chain_id: 1, status: 'active' },
        base: { contract_address: '0xContractOnBase', chain_id: 8453, status: 'solved' },
        bittensorEvm: { contract_address: '0xContractOnBtEvm', chain_id: 964, status: 'active' },
        bittensor: { contract_address: '0xContractOnBt', chain_id: 0, status: 'active' },
      },
    } as any)
    vi.spyOn(api, 'getChainTokens').mockResolvedValue(MOCK_SOLVER_TOKENS_RESPONSE)

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().appSupportedChains).toEqual([1, 8453])
    })

    expect(useSwapStore.getState().appContracts).toEqual({
      1: '0xContractOnMainnet',
      8453: '0xContractOnBase',
    })
  })

  it('uses legacy top-level contract_address when deployments have none', async () => {
    vi.spyOn(api, 'listApps').mockResolvedValue(MOCK_APPS_RESPONSE)
    vi.spyOn(api, 'getAppStatus').mockResolvedValue({
      app_id: 'dex-app-mainnet-001',
      contract_address: '0xLegacyContract',
      deployments: {},
    } as any)
    vi.spyOn(api, 'getChainTokens').mockResolvedValue(MOCK_SOLVER_TOKENS_RESPONSE)

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().contractAddress).toBeTruthy()
    })

    expect(useSwapStore.getState().contractAddress).toBe('0xLegacyContract')
  })

  // ── F19 regression guard: loadHistory() called on mount ───────────────────

  it('calls loadHistory on mount (F19 regression guard)', async () => {
    mockApis()

    // Pre-seed localStorage so loadHistory has something to load
    localStorage.setItem(
      'minotaur_swap_history',
      JSON.stringify([{ orderId: 'ord-history-test', timestamp: 1000, chainId: BASE_CHAIN_ID }]),
    )

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().recentSwaps.length).toBeGreaterThan(0)
    })

    expect(useSwapStore.getState().recentSwaps[0].orderId).toBe('ord-history-test')
  })

  it('does not throw if localStorage is empty on mount', async () => {
    mockApis()

    expect(() => {
      renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })
    }).not.toThrow()

    await waitFor(() => {
      expect(useSwapStore.getState().solverTokens[BASE_CHAIN_ID]).toBeDefined()
    })

    expect(useSwapStore.getState().recentSwaps).toHaveLength(0)
  })

  // ── Error paths ────────────────────────────────────────────────────────────

  it('falls back to hardcoded tokens when getChainTokens rejects', async () => {
    vi.spyOn(api, 'getChainTokens').mockRejectedValue(new Error('Network error'))
    vi.spyOn(api, 'listApps').mockResolvedValue(MOCK_APPS_RESPONSE)
    vi.spyOn(api, 'getAppStatus').mockResolvedValue(MOCK_APP_STATUS as any)

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      // After the catch branch runs, inputToken should be set from hardcoded TOKENS[8453]
      expect(useSwapStore.getState().inputToken).not.toBeNull()
    })

    // Hardcoded fallback: inputToken = ETH (first hardcoded token for 8453),
    // or USDC if ETH not found. Either way it should not be null.
    expect(useSwapStore.getState().inputToken).not.toBeNull()
    expect(useSwapStore.getState().outputToken).not.toBeNull()
  })

  it('does not set store.error when getChainTokens rejects (hook logs only)', async () => {
    vi.spyOn(api, 'getChainTokens').mockRejectedValue(new Error('Solver down'))
    vi.spyOn(api, 'listApps').mockResolvedValue(MOCK_APPS_RESPONSE)
    vi.spyOn(api, 'getAppStatus').mockResolvedValue(MOCK_APP_STATUS as any)

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      // Wait for the catch branch to have settled
      expect(useSwapStore.getState().inputToken).not.toBeNull()
    })

    // The hook does NOT set store.error — it only console.error and falls back
    expect(useSwapStore.getState().error).toBeNull()
  })

  it('does not throw when listApps rejects', async () => {
    vi.spyOn(api, 'getChainTokens').mockResolvedValue(MOCK_SOLVER_TOKENS_RESPONSE)
    vi.spyOn(api, 'listApps').mockRejectedValue(new Error('listApps failed'))

    expect(() => {
      renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })
    }).not.toThrow()

    // Token fetch should still succeed
    await waitFor(() => {
      expect(useSwapStore.getState().solverTokens[BASE_CHAIN_ID]).toBeDefined()
    })
  })

  it('fails loud (no appId, store.error set) when listApps returns empty apps array', async () => {
    vi.spyOn(api, 'getChainTokens').mockResolvedValue(MOCK_SOLVER_TOKENS_RESPONSE)
    vi.spyOn(api, 'listApps').mockResolvedValue({ apps: [] })

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().error).toBeTruthy()
    })

    // Configured app absent → never fall back to another app.
    expect(useSwapStore.getState().appId).toBe('')
    expect(useSwapStore.getState().error).toContain(CONFIGURED_APP_ID)
  })

  it('fails loud when the configured app is not among the listed apps', async () => {
    vi.spyOn(api, 'getChainTokens').mockResolvedValue(MOCK_SOLVER_TOKENS_RESPONSE)
    vi.spyOn(api, 'listApps').mockResolvedValue({
      apps: [
        { app_id: 'some-other-app', name: 'Other', description: '', supported_chains: [BASE_CHAIN_ID], deployer: '0x0', status: 'active' },
      ],
    })
    const getAppStatusSpy = vi.spyOn(api, 'getAppStatus')

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      expect(useSwapStore.getState().error).toBeTruthy()
    })

    // Never selects the list head, never fetches its status.
    expect(useSwapStore.getState().appId).toBe('')
    expect(getAppStatusSpy).not.toHaveBeenCalled()
  })

  // ── Unmount / cleanup ──────────────────────────────────────────────────────

  it('does not produce setState-after-unmount warning when unmounted before fetch resolves', async () => {
    // Use a never-resolving promise to keep fetch in-flight
    let resolveTokens!: (v: typeof MOCK_SOLVER_TOKENS_RESPONSE) => void
    const pendingTokens = new Promise<typeof MOCK_SOLVER_TOKENS_RESPONSE>((r) => { resolveTokens = r })

    vi.spyOn(api, 'getChainTokens').mockReturnValue(pendingTokens)
    vi.spyOn(api, 'listApps').mockResolvedValue({ apps: [] })

    const consoleError = vi.spyOn(console, 'error')

    const { unmount } = renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    // Unmount while fetch is in-flight
    act(() => { unmount() })

    // Resolve the fetch after unmount
    await act(async () => {
      resolveTokens(MOCK_SOLVER_TOKENS_RESPONSE)
      // Flush microtasks
      await Promise.resolve()
    })

    // React 18 in concurrent mode does not emit the act(...) warning for
    // state updates after unmount, but we still verify no unexpected errors
    const errorCalls = consoleError.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('unmounted component'),
    )
    expect(errorCalls).toHaveLength(0)

    consoleError.mockRestore()
  })

  // ── Bittensor EVM chain ────────────────────────────────────────────────────

  it('fetches tokens for Bittensor EVM chain (chain 964) when store is set to it', async () => {
    // Set store to Bittensor EVM chain before rendering
    useSwapStore.setState({ chainId: 964 })

    // Use a different address for WTAO so native TAO gets injected from
    // the hardcoded config. (When WTAO address matches the native token
    // address the hook skips injection — tested separately below.)
    vi.spyOn(api, 'getChainTokens').mockResolvedValue({
      chain_id: 964,
      count: 2,
      tokens: [
        { address: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', symbol: 'WTAO', decimals: 18, pool_count: 5 },
        { address: '0xB833E8137FEDf80de7E908dc6fea43a029142F20', symbol: 'USDC', decimals: 6, pool_count: 3 },
      ],
    })
    vi.spyOn(api, 'listApps').mockResolvedValue({ apps: [] })

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      const tokens = useSwapStore.getState().solverTokens[964]
      expect(tokens).toBeDefined()
    })

    expect(vi.mocked(api.getChainTokens)).toHaveBeenCalledWith(964)

    // Native TAO should be injected at index 0 (hardcoded TOKENS[964] has it)
    const tokens = useSwapStore.getState().solverTokens[964]
    expect(tokens[0].native).toBe(true)
    expect(tokens[0].symbol).toBe('TAO')
  })

  it('skips native injection when solver address matches hardcoded native address', async () => {
    // Solver returns WTAO with same address as hardcoded native TAO → no injection
    useSwapStore.setState({ chainId: 964 })

    vi.spyOn(api, 'getChainTokens').mockResolvedValue({
      chain_id: 964,
      count: 2,
      tokens: [
        // Same address as hardcoded TAO — injection skipped
        { address: '0x9Dc08C6e2BF0F1eeD1E00670f80Df39145529F81', symbol: 'WTAO', decimals: 18, pool_count: 5 },
        { address: '0xB833E8137FEDf80de7E908dc6fea43a029142F20', symbol: 'USDC', decimals: 6, pool_count: 3 },
      ],
    })
    vi.spyOn(api, 'listApps').mockResolvedValue({ apps: [] })

    renderHook(() => useAppBootstrap(), { wrapper: HookWrapper })

    await waitFor(() => {
      const tokens = useSwapStore.getState().solverTokens[964]
      expect(tokens).toBeDefined()
    })

    const tokens = useSwapStore.getState().solverTokens[964]
    // WTAO came from solver; no prepended native token
    expect(tokens).toHaveLength(2)
    expect(tokens[0].symbol).toBe('WTAO')
  })
})
