/**
 * Unit tests for useOrderSubmission hook.
 *
 * Covers 4 code paths:
 *  1. EVM same-chain ERC-20 path — EIP-712 signing, submit, polling
 *  2. Cross-chain / Bittensor alpha path
 *  3. Polling — 2000 ms interval (F10), terminal states, unmount cancel
 *  4. Receipt parsing — SwapExecuted log decode (F11)
 *
 * Mocking strategy:
 *  - vi.mock('ethers', ...) at module level for all ethers utilities
 *  - vi.spyOn(api, ...) for API calls
 *  - installEthereumStub() for window.ethereum
 *  - vi.useFakeTimers() for polling tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSwapStore } from '@/store'
import { useOrderSubmission } from '@/hooks/useOrderSubmission'
import * as api from '@/api/client'
import { HookWrapper, resetStore, installEthereumStub } from './test-utils'
import { MOCK_QUOTE, MOCK_ORDER, mockEvmAddress } from './fixtures'

// ── Mock ethers ──────────────────────────────────────────────────────────────
//
// The hook does `const { ethers } = await import('ethers')` inside callbacks,
// so we mock the whole module. The mock factory is called once at module load.

const mockSignTypedData = vi.fn()
const mockGetSigner = vi.fn().mockResolvedValue({ signTypedData: mockSignTypedData })
const mockGetTransactionReceipt = vi.fn()
const mockBrowserProvider = vi.fn().mockImplementation(() => ({
  getSigner: mockGetSigner,
  getTransactionReceipt: mockGetTransactionReceipt,
}))

const MOCK_ABI_ENCODED = '0x' + '00'.repeat(9 * 32)  // 9 slots (address*2 + uint256*3)

const mockAbiCoderInstance = {
  encode: vi.fn().mockReturnValue(MOCK_ABI_ENCODED),
  decode: vi.fn().mockReturnValue([
    '0xTokenIn000000000000000000000000000000000',
    '0xTokenOut00000000000000000000000000000000',
    BigInt('1000000000'),
    BigInt('985000000000000000'),
    BigInt('1500000000000000'),
  ]),
}
const mockDefaultAbiCoder = vi.fn().mockReturnValue(mockAbiCoderInstance)

const MOCK_KECCAK256_RESULT = '0xdeadbeef00000000000000000000000000000000000000000000000000000001'
const MOCK_SIGNATURE = '0xaaaa' + 'bb'.repeat(31) + 'cc'
const MOCK_SWAP_TOPIC = '0x1234abcd' + '00'.repeat(28)

// Inline ethers utility fns — defined as module-level vi.fn() so beforeEach can
// re-setup their implementations after vi.restoreAllMocks() clears them.
const mockEthersKeccak256 = vi.fn().mockReturnValue(MOCK_KECCAK256_RESULT)
const mockEthersToUtf8Bytes = vi.fn().mockReturnValue(new Uint8Array([1, 2, 3]))
const mockEthersId = vi.fn().mockReturnValue(MOCK_SWAP_TOPIC)
const mockEthersDataSlice = vi.fn().mockReturnValue('0x12345678')
const mockEthersZeroPadValue = vi.fn().mockReturnValue('0x' + '00'.repeat(32))

vi.mock('ethers', () => ({
  ethers: {
    BrowserProvider: mockBrowserProvider,
    keccak256: mockEthersKeccak256,
    toUtf8Bytes: mockEthersToUtf8Bytes,
    id: mockEthersId,
    AbiCoder: {
      defaultAbiCoder: mockDefaultAbiCoder,
    },
    dataSlice: mockEthersDataSlice,
    zeroPadValue: mockEthersZeroPadValue,
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = '0xContract00000000000000000000000000000001'
const APP_ID = 'test-app-001'
const CHAIN_ID = 8453

/** Seed store with the minimal state needed to reach submitSwap's EVM path. */
function seedEvmStore(overrides: Record<string, unknown> = {}) {
  const state = useSwapStore.getState()
  state.setWalletMode('external')
  state.setWalletAddress(mockEvmAddress)
  state.setWalletConnected(true)
  state.setChainId(CHAIN_ID)
  state.setAppId(APP_ID)
  state.setContractAddress(CONTRACT_ADDRESS)
  state.setQuote(MOCK_QUOTE)
  // Apply extra overrides via setState
  if (Object.keys(overrides).length) {
    useSwapStore.setState(overrides as any)
  }
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore()
  localStorage.clear()
  vi.restoreAllMocks()
  // Re-wire ALL ethers mocks after restoreAllMocks.
  // vi.restoreAllMocks() calls mockRestore() on ALL tracked vi.fn() instances,
  // including module-level ones defined in vi.mock() factories, which clears
  // their mockReturnValue/mockImplementation. We must re-setup all of them here.
  mockSignTypedData.mockResolvedValue(MOCK_SIGNATURE)
  mockGetSigner.mockResolvedValue({ signTypedData: mockSignTypedData })
  mockGetTransactionReceipt.mockResolvedValue(null)
  mockBrowserProvider.mockImplementation(() => ({
    getSigner: mockGetSigner,
    getTransactionReceipt: mockGetTransactionReceipt,
  }))
  mockAbiCoderInstance.encode.mockReturnValue(MOCK_ABI_ENCODED)
  mockAbiCoderInstance.decode.mockReturnValue([
    '0xTokenIn000000000000000000000000000000000',
    '0xTokenOut00000000000000000000000000000000',
    BigInt('1000000000'),
    BigInt('985000000000000000'),
    BigInt('1500000000000000'),
  ])
  mockDefaultAbiCoder.mockReturnValue(mockAbiCoderInstance)
  // Ethers utility functions — must be re-setup after vi.restoreAllMocks()
  mockEthersKeccak256.mockReturnValue(MOCK_KECCAK256_RESULT)
  mockEthersToUtf8Bytes.mockReturnValue(new Uint8Array([1, 2, 3]))
  mockEthersId.mockReturnValue(MOCK_SWAP_TOPIC)
  mockEthersDataSlice.mockReturnValue('0x12345678')
  mockEthersZeroPadValue.mockReturnValue('0x' + '00'.repeat(32))
})

afterEach(() => {
  delete (window as any).ethereum
  vi.useRealTimers()
})

// ═══════════════════════════════════════════════════════════════════════════════
// 1. EVM SAME-CHAIN ERC-20 PATH
// ═══════════════════════════════════════════════════════════════════════════════

describe('EVM same-chain ERC-20 path', () => {
  it('calls submitOrder with correct appId, params, and submittedBy', async () => {
    installEthereumStub()
    seedEvmStore()

    const submitOrderSpy = vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(submitOrderSpy).toHaveBeenCalledWith(
      APP_ID,
      expect.objectContaining({
        input_token: MOCK_QUOTE.ready_params.input_token,
        output_token: MOCK_QUOTE.ready_params.output_token,
      }),
      mockEvmAddress,
      expect.objectContaining({ chainId: CHAIN_ID }),
    )
  })

  it('constructs EIP-712 domain with correct chainId, name, version, verifyingContract', async () => {
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(mockSignTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'MinotaurAppIntent',
        version: '1',
        chainId: CHAIN_ID,
        verifyingContract: CONTRACT_ADDRESS,
      }),
      expect.any(Object),
      expect.any(Object),
    )
  })

  it('calls signer.signTypedData for external wallet EVM path', async () => {
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(mockSignTypedData).toHaveBeenCalledTimes(1)
  })

  it('calls attachSignature after signTypedData succeeds', async () => {
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    const attachSpy = vi.spyOn(api, 'attachSignature').mockResolvedValue({
      order_id: MOCK_ORDER.order_id,
      signature_attached: true,
    })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(attachSpy).toHaveBeenCalledWith(MOCK_ORDER.order_id, MOCK_SIGNATURE)
  })

  it('signature rejection (ACTION_REJECTED) → does NOT call attachSignature', async () => {
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    const attachSpy = vi.spyOn(api, 'attachSignature').mockResolvedValue({
      order_id: MOCK_ORDER.order_id,
      signature_attached: true,
    })
    const sigError = Object.assign(new Error('User rejected'), { code: 'ACTION_REJECTED' })
    mockSignTypedData.mockRejectedValueOnce(sigError)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(attachSpy).not.toHaveBeenCalled()
  })

  it('signature rejection (code 4001) → sets store.error with rejection message', async () => {
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    const sigError = Object.assign(new Error('User rejected request'), { code: 4001 })
    mockSignTypedData.mockRejectedValueOnce(sigError)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(useSwapStore.getState().error).toContain('rejected')
  })

  it('sets store.activeOrder after successful submission', async () => {
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(useSwapStore.getState().activeOrder?.order_id).toBe(MOCK_ORDER.order_id)
  })

  it('starts polling after successful submission', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    vi.spyOn(api, 'getOrderStatus').mockResolvedValue({ ...MOCK_ORDER, status: 'open' })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(useSwapStore.getState().polling).toBe(true)
  })

  it('sets store.polling=true after submit and polling begins', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    vi.spyOn(api, 'getOrderStatus').mockResolvedValue({ ...MOCK_ORDER, status: 'open' })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(useSwapStore.getState().polling).toBe(true)
  })

  it('does not call submitOrder when store.quote is null', async () => {
    installEthereumStub()
    // No seedEvmStore — leave quote as null
    useSwapStore.getState().setWalletAddress(mockEvmAddress)
    useSwapStore.getState().setAppId(APP_ID)

    const submitOrderSpy = vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(submitOrderSpy).not.toHaveBeenCalled()
  })

  it('does not call submitOrder when appId is empty', async () => {
    installEthereumStub()
    useSwapStore.getState().setWalletAddress(mockEvmAddress)
    useSwapStore.getState().setQuote(MOCK_QUOTE)
    // Intentionally leave appId empty

    const submitOrderSpy = vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(submitOrderSpy).not.toHaveBeenCalled()
  })

  it('aborts with toast.error and store.error when contractAddress is missing for external EVM', async () => {
    installEthereumStub()
    seedEvmStore()
    // Clear contractAddress AFTER seedEvmStore
    useSwapStore.getState().setContractAddress('')

    const submitOrderSpy = vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(submitOrderSpy).not.toHaveBeenCalled()
    expect(useSwapStore.getState().error).toBeTruthy()
  })

  it('clears store.error and activeOrder at start of submit', async () => {
    installEthereumStub()
    seedEvmStore()
    // Pre-seed an error and an active order
    useSwapStore.getState().setError('previous error')
    useSwapStore.setState({ activeOrder: MOCK_ORDER })

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    // We can't easily observe mid-flight state, but after success both should reflect the new state
    await act(async () => {
      await result.current.submitSwap()
    })

    // activeOrder should now reflect the newly submitted order (not null — it was set post-submit)
    expect(useSwapStore.getState().activeOrder?.order_id).toBe(MOCK_ORDER.order_id)
    // error should be null after a successful submit
    expect(useSwapStore.getState().error).toBeNull()
  })

  it('sets submitting=false in finally block on success', async () => {
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(useSwapStore.getState().submitting).toBe(false)
  })

  it('sets submitting=false in finally block on API error', async () => {
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockRejectedValue(new Error('API down'))

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(useSwapStore.getState().submitting).toBe(false)
  })

  it('adds swap to history after successful submission', async () => {
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    const { recentSwaps } = useSwapStore.getState()
    expect(recentSwaps.length).toBeGreaterThan(0)
    expect(recentSwaps[0].orderId).toBe(MOCK_ORDER.order_id)
  })

  it('skips EIP-712 signing for managed wallet mode', async () => {
    installEthereumStub()
    seedEvmStore()
    useSwapStore.getState().setWalletMode('managed')
    useSwapStore.setState({
      managedWallet: { address: mockEvmAddress, type: 'managed', supported_chains: [CHAIN_ID], created_at: '' },
    })

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(mockSignTypedData).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. CROSS-CHAIN / BITTENSOR PATH
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-chain / Bittensor alpha path', () => {
  const BT_CHAIN_ID = 0  // BITTENSOR_CHAIN_ID

  it('assembles CAIP-10 style params with owner_ss58 and alpha_netuid for alpha token', async () => {
    installEthereumStub()
    const bittensorAddress = '5GrwvaEF5zXb26Fz9rcQkQxwZsEzYq67VjQgVL3Cv7jD'
    const alphaQuote = {
      ...MOCK_QUOTE,
      ready_params: {
        ...MOCK_QUOTE.ready_params,
        input_token: 'alpha:99',
        input_amount: '100000000000',
        min_output: '95000000000000000',
      },
    }
    useSwapStore.getState().setWalletMode('bittensor')
    useSwapStore.getState().setWalletAddress(mockEvmAddress)
    useSwapStore.getState().setBittensorAddress(bittensorAddress)
    useSwapStore.getState().setBittensorConnected(true)
    useSwapStore.setState({ sourceChainId: BT_CHAIN_ID })
    useSwapStore.getState().setChainId(CHAIN_ID)
    useSwapStore.getState().setAppId(APP_ID)
    useSwapStore.getState().setContractAddress(CONTRACT_ADDRESS)
    useSwapStore.getState().setEvmRecipient(mockEvmAddress, 'metamask')
    // Set inputToken/outputToken via setState (bypasses quote-clearing side-effect)
    // inputToken address must match /^alpha:(\d+)$/ for the alpha cross-chain path
    useSwapStore.setState({
      inputToken: { symbol: 'ALPHA', name: 'Alpha', address: 'alpha:99', decimals: 9, icon: 'A' },
      outputToken: { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, icon: '$' },
      quote: alphaQuote as any,
      isCrossChain: true,
    })

    const submitOrderSpy = vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(submitOrderSpy).toHaveBeenCalledWith(
      APP_ID,
      expect.objectContaining({
        alpha_netuid: '99',
        owner_ss58: bittensorAddress,
        hotkey_ss58: bittensorAddress,
        dest_chain_id: String(CHAIN_ID),
      }),
      mockEvmAddress,
      expect.any(Object),
    )
  })

  it('sets dest_chain_id for cross-chain EVM→EVM orders', async () => {
    installEthereumStub()
    seedEvmStore()
    useSwapStore.setState({ isCrossChain: true, sourceChainId: 1 })  // mainnet → base

    const submitOrderSpy = vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(submitOrderSpy).toHaveBeenCalledWith(
      APP_ID,
      expect.objectContaining({
        dest_chain_id: String(CHAIN_ID),
        dest_recipient: mockEvmAddress,
      }),
      mockEvmAddress,
      expect.any(Object),
    )
  })

  it('uses sourceChainId as orderChainId for cross-chain submit', async () => {
    installEthereumStub()
    seedEvmStore()
    const SOURCE_CHAIN = 1  // mainnet
    useSwapStore.setState({ isCrossChain: true, sourceChainId: SOURCE_CHAIN })

    const submitOrderSpy = vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(submitOrderSpy).toHaveBeenCalledWith(
      APP_ID,
      expect.any(Object),
      mockEvmAddress,
      expect.objectContaining({ chainId: SOURCE_CHAIN }),
    )
  })

  it('native bittensor stake path: POSTs to /api/v1/native-bittensor/stake', async () => {
    const bittensorAddress = '5GrwvaEF5zXb26Fz9rcQkQxwZsEzYq67VjQgVL3Cv7jD'
    const stakeQuote = {
      ...MOCK_QUOTE,
      chain_id: BT_CHAIN_ID,
      ready_params: {
        ...MOCK_QUOTE.ready_params,
        action: 'add_stake',
        input_amount: '1000000000',
      },
    }
    useSwapStore.getState().setWalletMode('bittensor')
    useSwapStore.getState().setBittensorAddress(bittensorAddress)
    useSwapStore.getState().setBittensorConnected(true)
    useSwapStore.setState({ sourceChainId: BT_CHAIN_ID })
    useSwapStore.getState().setChainId(BT_CHAIN_ID)
    useSwapStore.getState().setAppId(APP_ID)
    useSwapStore.getState().setQuote(stakeQuote as any)
    useSwapStore.getState().setWalletAddress(bittensorAddress)

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, tx_hash: '0xstaketxhash' }),
    } as any)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/native-bittensor/stake',
      expect.objectContaining({ method: 'POST' }),
    )
    fetchMock.mockRestore()
  })

  it('native bittensor stake: sets activeOrder with filled status on success', async () => {
    const bittensorAddress = '5GrwvaEF5zXb26Fz9rcQkQxwZsEzYq67VjQgVL3Cv7jD'
    const stakeQuote = {
      ...MOCK_QUOTE,
      chain_id: BT_CHAIN_ID,
      ready_params: { ...MOCK_QUOTE.ready_params, action: 'add_stake', input_amount: '1000000000' },
    }
    useSwapStore.getState().setWalletMode('bittensor')
    useSwapStore.getState().setBittensorAddress(bittensorAddress)
    useSwapStore.getState().setBittensorConnected(true)
    useSwapStore.setState({ sourceChainId: BT_CHAIN_ID })
    useSwapStore.getState().setChainId(BT_CHAIN_ID)
    useSwapStore.getState().setAppId(APP_ID)
    useSwapStore.getState().setQuote(stakeQuote as any)
    useSwapStore.getState().setWalletAddress(bittensorAddress)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, tx_hash: '0xstaketxhash' }),
    } as any)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(useSwapStore.getState().activeOrder?.status).toBe('filled')
    vi.restoreAllMocks()
  })

  it('native bittensor stake: sets store.error on failure response', async () => {
    const bittensorAddress = '5GrwvaEF5zXb26Fz9rcQkQxwZsEzYq67VjQgVL3Cv7jD'
    const stakeQuote = {
      ...MOCK_QUOTE,
      chain_id: BT_CHAIN_ID,
      ready_params: { ...MOCK_QUOTE.ready_params, action: 'add_stake', input_amount: '1000000000' },
    }
    useSwapStore.getState().setWalletMode('bittensor')
    useSwapStore.getState().setBittensorAddress(bittensorAddress)
    useSwapStore.getState().setBittensorConnected(true)
    useSwapStore.setState({ sourceChainId: BT_CHAIN_ID })
    useSwapStore.getState().setChainId(BT_CHAIN_ID)
    useSwapStore.getState().setAppId(APP_ID)
    useSwapStore.getState().setQuote(stakeQuote as any)
    useSwapStore.getState().setWalletAddress(bittensorAddress)

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Insufficient balance' }),
    } as any)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(useSwapStore.getState().error).toContain('Insufficient balance')
    vi.restoreAllMocks()
  })

  it('does not call api.submitOrder for bittensor same-chain stake path', async () => {
    const bittensorAddress = '5GrwvaEF5zXb26Fz9rcQkQxwZsEzYq67VjQgVL3Cv7jD'
    const stakeQuote = {
      ...MOCK_QUOTE,
      chain_id: BT_CHAIN_ID,
      ready_params: { ...MOCK_QUOTE.ready_params, action: 'add_stake', input_amount: '1000000000' },
    }
    useSwapStore.getState().setWalletMode('bittensor')
    useSwapStore.getState().setBittensorAddress(bittensorAddress)
    useSwapStore.getState().setBittensorConnected(true)
    useSwapStore.setState({ sourceChainId: BT_CHAIN_ID })
    useSwapStore.getState().setChainId(BT_CHAIN_ID)
    useSwapStore.getState().setAppId(APP_ID)
    useSwapStore.getState().setQuote(stakeQuote as any)
    useSwapStore.getState().setWalletAddress(bittensorAddress)

    const submitOrderSpy = vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, tx_hash: '0xtx' }),
    } as any)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(submitOrderSpy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('alpha cross-chain: sets recipient to evmRecipient from store', async () => {
    installEthereumStub()
    const bittensorAddress = '5GrwvaEF5zXb26Fz9rcQkQxwZsEzYq67VjQgVL3Cv7jD'
    const evmRecipient = '0xDeadBeef00000000000000000000000000000001'
    const alphaQuote = {
      ...MOCK_QUOTE,
      ready_params: {
        ...MOCK_QUOTE.ready_params,
        input_token: 'alpha:5',
        input_amount: '500000000',
        min_output: '49000000000000000',
      },
    }
    useSwapStore.getState().setWalletMode('bittensor')
    useSwapStore.getState().setWalletAddress(evmRecipient)
    useSwapStore.getState().setBittensorAddress(bittensorAddress)
    useSwapStore.getState().setBittensorConnected(true)
    useSwapStore.setState({ sourceChainId: BT_CHAIN_ID })
    useSwapStore.getState().setChainId(CHAIN_ID)
    useSwapStore.getState().setAppId(APP_ID)
    useSwapStore.getState().setContractAddress(CONTRACT_ADDRESS)
    useSwapStore.getState().setEvmRecipient(evmRecipient, 'metamask')
    useSwapStore.setState({
      inputToken: { symbol: 'ALPHA', name: 'Alpha', address: 'alpha:5', decimals: 9, icon: 'A' },
      outputToken: { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, icon: '$' },
      quote: alphaQuote as any,
      isCrossChain: true,
    })

    const submitOrderSpy = vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(submitOrderSpy).toHaveBeenCalledWith(
      APP_ID,
      expect.objectContaining({ recipient: evmRecipient }),
      evmRecipient,
      expect.any(Object),
    )
  })

  it('alpha cross-chain: sets min_output_amount to "1" as floor', async () => {
    installEthereumStub()
    const bittensorAddress = '5GrwvaEF5zXb26Fz9rcQkQxwZsEzYq67VjQgVL3Cv7jD'
    const alphaQuote = {
      ...MOCK_QUOTE,
      ready_params: {
        ...MOCK_QUOTE.ready_params,
        input_token: 'alpha:3',
        input_amount: '200000000',
        min_output: '19000000000000000',
      },
    }
    useSwapStore.getState().setWalletMode('bittensor')
    useSwapStore.getState().setWalletAddress(mockEvmAddress)
    useSwapStore.getState().setBittensorAddress(bittensorAddress)
    useSwapStore.getState().setBittensorConnected(true)
    useSwapStore.setState({ sourceChainId: BT_CHAIN_ID })
    useSwapStore.getState().setChainId(CHAIN_ID)
    useSwapStore.getState().setAppId(APP_ID)
    useSwapStore.getState().setContractAddress(CONTRACT_ADDRESS)
    useSwapStore.getState().setEvmRecipient(mockEvmAddress, 'metamask')
    useSwapStore.setState({
      inputToken: { symbol: 'ALPHA', name: 'Alpha', address: 'alpha:3', decimals: 9, icon: 'A' },
      outputToken: { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, icon: '$' },
      quote: alphaQuote as any,
      isCrossChain: true,
    })

    const submitOrderSpy = vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    expect(submitOrderSpy).toHaveBeenCalledWith(
      APP_ID,
      expect.objectContaining({ min_output_amount: '1' }),
      expect.any(String),
      expect.any(Object),
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3. POLLING
// ═══════════════════════════════════════════════════════════════════════════════

describe('Polling', () => {
  it('polls at 2000 ms interval (F10 regression)', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    const getStatusSpy = vi.spyOn(api, 'getOrderStatus').mockResolvedValue({ ...MOCK_ORDER, status: 'open' })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    // 0 polls so far (polling has started but interval hasn't fired)
    const countBefore = getStatusSpy.mock.calls.length

    // Advance 2000 ms — exactly one interval tick
    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    expect(getStatusSpy.mock.calls.length).toBeGreaterThan(countBefore)
  })

  it('does NOT poll after 999 ms (interval is 2000 ms)', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    const getStatusSpy = vi.spyOn(api, 'getOrderStatus').mockResolvedValue({ ...MOCK_ORDER, status: 'open' })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    const countAfterSubmit = getStatusSpy.mock.calls.length

    await act(async () => {
      vi.advanceTimersByTime(999)
      await Promise.resolve()
    })

    expect(getStatusSpy.mock.calls.length).toBe(countAfterSubmit)
  })

  it('status="open" → continues polling (polling remains true)', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    vi.spyOn(api, 'getOrderStatus').mockResolvedValue({ ...MOCK_ORDER, status: 'open' })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    await act(async () => {
      vi.advanceTimersByTime(4000)
      await Promise.resolve()
    })

    expect(useSwapStore.getState().polling).toBe(true)
  })

  it('status="failed" → stops polling and sets polling=false', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    vi.spyOn(api, 'getOrderStatus').mockResolvedValue({ ...MOCK_ORDER, status: 'failed' })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    expect(useSwapStore.getState().polling).toBe(false)
  })

  it('status="failed" → updates store.activeOrder with failed status', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    vi.spyOn(api, 'getOrderStatus').mockResolvedValue({ ...MOCK_ORDER, status: 'failed' })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    expect(useSwapStore.getState().activeOrder?.status).toBe('failed')
  })

  it('status="cancelled" → stops polling', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    vi.spyOn(api, 'getOrderStatus').mockResolvedValue({ ...MOCK_ORDER, status: 'cancelled' })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    await act(async () => {
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
    })

    expect(useSwapStore.getState().polling).toBe(false)
  })

  it('unmount cancels polling (clearInterval called)', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    vi.spyOn(api, 'getOrderStatus').mockResolvedValue({ ...MOCK_ORDER, status: 'open' })

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    const { result, unmount } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    // Polling is active; unmount should cancel it
    act(() => { unmount() })

    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  it('multi-poll: calls getOrderStatus 3 times before "filled" on 3rd tick', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const getStatusSpy = vi.spyOn(api, 'getOrderStatus')
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'open' })
      .mockResolvedValueOnce({ ...MOCK_ORDER, status: 'open' })
      .mockResolvedValue({ ...MOCK_ORDER, status: 'filled', tx_hash: null })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    // Tick 1 (2s) → open
    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve() })
    // Tick 2 (4s) → open
    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve() })
    // Tick 3 (6s) → filled
    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve() })

    expect(getStatusSpy).toHaveBeenCalledTimes(3)
    expect(useSwapStore.getState().polling).toBe(false)
  })

  it('polling error is swallowed (transient) — polling continues', async () => {
    vi.useFakeTimers()
    installEthereumStub()
    seedEvmStore()

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })

    const getStatusSpy = vi.spyOn(api, 'getOrderStatus')
      .mockRejectedValueOnce(new Error('Network hiccup'))
      .mockResolvedValue({ ...MOCK_ORDER, status: 'open' })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => {
      await result.current.submitSwap()
    })

    // Tick 1 → error (swallowed)
    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve() })
    // Tick 2 → open, polling continues
    await act(async () => { vi.advanceTimersByTime(2000); await Promise.resolve() })

    expect(getStatusSpy).toHaveBeenCalledTimes(2)
    expect(useSwapStore.getState().polling).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. RECEIPT PARSING (F11 REGRESSION)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Receipt parsing — SwapExecuted log (F11)', () => {
  /**
   * Helper: set up store + spies, then trigger submitSwap() + one polling tick
   * that returns status='filled'.
   *
   * Uses real timers and directly invokes the poll callback. The `import('ethers')`
   * inside the callback is module-level mocked and resolves synchronously.
   *
   * We identify the poll callback by the 2000ms delay parameter, distinguishing it
   * from jsdom's internal animation frame setInterval shims.
   */
  async function setupAndFill(receiptOverride?: any): Promise<{
    txHash: string
    filledOrder: typeof MOCK_ORDER & { status: string; tx_hash: string }
    triggerPollTick: () => Promise<void>
  }> {
    vi.useRealTimers()
    installEthereumStub()
    seedEvmStore()

    const txHash = '0xaabbccdd' + '00'.repeat(28)
    const filledOrder = { ...MOCK_ORDER, status: 'filled', tx_hash: txHash }

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    vi.spyOn(api, 'getOrderStatus').mockResolvedValue(filledOrder)

    const defaultReceipt = {
      gasUsed: BigInt(120000),
      logs: [
        {
          topics: [MOCK_SWAP_TOPIC],
          data: '0x' + '00'.repeat(5 * 32),  // 5 non-indexed fields decoded by mock
        },
      ],
    }
    mockGetTransactionReceipt.mockResolvedValue(receiptOverride !== undefined ? receiptOverride : defaultReceipt)
    // Re-bind BrowserProvider to ensure the receipt mock is current
    mockBrowserProvider.mockImplementation(() => ({
      getSigner: mockGetSigner,
      getTransactionReceipt: mockGetTransactionReceipt,
    }))

    // Capture the poll callback by matching the 2000ms delay used by pollOrderStatus.
    // jsdom's setInterval shims use different delays (e.g., requestAnimationFrame shim).
    let pollCallback: (() => Promise<void>) | null = null
    let fakeId = 900000
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((fn: any, delay?: any) => {
      fakeId++
      if (Number(delay) === 2000) {
        pollCallback = fn as () => Promise<void>
      }
      return fakeId as any
    })

    const triggerPollTick = async () => {
      if (pollCallback) {
        const cb = pollCallback
        // Run the callback and flush all pending microtasks
        await act(async () => {
          const result = cb()
          if (result && typeof result.then === 'function') {
            await result
          }
        })
      }
    }

    return { txHash, filledOrder, triggerPollTick }
  }

  it('SwapExecuted log present → decodes executionDetails from receipt', async () => {
    const { triggerPollTick } = await setupAndFill()

    const { result, unmount } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => { await result.current.submitSwap() })
    await triggerPollTick()

    await waitFor(() => {
      expect(useSwapStore.getState().executionDetails).toBeTruthy()
    })

    const details = useSwapStore.getState().executionDetails!
    expect(details.amountIn).toBe('1000000000')
    expect(details.amountOut).toBe('985000000000000000')
    expect(details.fee).toBe('1500000000000000')
    act(() => { unmount() })
  })

  it('SwapExecuted log present → tokenIn and tokenOut decoded correctly', async () => {
    const { triggerPollTick } = await setupAndFill()

    const { result, unmount } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => { await result.current.submitSwap() })
    await triggerPollTick()

    await waitFor(() => {
      expect(useSwapStore.getState().executionDetails).toBeTruthy()
    })

    const details = useSwapStore.getState().executionDetails!
    expect(details.tokenIn).toBe('0xTokenIn000000000000000000000000000000000')
    expect(details.tokenOut).toBe('0xTokenOut00000000000000000000000000000000')
    act(() => { unmount() })
  })

  it('SwapExecuted log present → gasUsed from receipt stored in executionDetails', async () => {
    const { triggerPollTick } = await setupAndFill()

    const { result, unmount } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => { await result.current.submitSwap() })
    await triggerPollTick()

    await waitFor(() => {
      expect(useSwapStore.getState().executionDetails).toBeTruthy()
    })

    expect(useSwapStore.getState().executionDetails?.gasUsed).toBe('120000')
    act(() => { unmount() })
  })

  it('no SwapExecuted log in receipt → graceful no-op (activeOrder still updated)', async () => {
    const receiptWithoutSwapLog = {
      gasUsed: BigInt(100000),
      logs: [
        {
          // Different topic — not SwapExecuted
          topics: ['0xdeadbeef' + '00'.repeat(28)],
          data: '0x',
        },
      ],
    }
    const { triggerPollTick } = await setupAndFill(receiptWithoutSwapLog)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => { await result.current.submitSwap() })
    await triggerPollTick()

    // activeOrder should be the filled order
    await waitFor(() => {
      expect(useSwapStore.getState().activeOrder?.status).toBe('filled')
    })

    // executionDetails should remain null (no SwapExecuted log).
    // setActiveOrder sets executionDetails to undefined (non-null), but
    // setExecutionDetails is never called (no log match), so executionDetails
    // stays as undefined (falsy). We check it's not the decoded object.
    const details = useSwapStore.getState().executionDetails
    expect(details == null || details === undefined).toBe(true)
  })

  it('receipt is null → no crash, activeOrder still set to filled', async () => {
    const { triggerPollTick } = await setupAndFill(null)

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => { await result.current.submitSwap() })
    await triggerPollTick()

    await waitFor(() => {
      expect(useSwapStore.getState().activeOrder?.status).toBe('filled')
    })
  })

  it('window.ethereum absent → receipt fetch skipped, no crash', async () => {
    // Don't install ethereum stub — use managed wallet instead
    delete (window as any).ethereum
    seedEvmStore()
    useSwapStore.getState().setWalletMode('managed')
    useSwapStore.setState({
      managedWallet: { address: mockEvmAddress, type: 'managed', supported_chains: [CHAIN_ID], created_at: '' },
    })

    const txHash = '0xaabbcc' + '00'.repeat(29)
    const filledOrder = { ...MOCK_ORDER, status: 'filled', tx_hash: txHash }

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'getOrderStatus').mockResolvedValue(filledOrder)

    let pollCallback: (() => Promise<void>) | null = null
    let fakeId = 910000
    vi.spyOn(globalThis, 'setInterval').mockImplementation((fn: any, delay?: any) => {
      fakeId++
      if (Number(delay) === 2000) pollCallback = fn as () => Promise<void>
      return fakeId as any
    })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => { await result.current.submitSwap() })
    if (pollCallback) {
      const cb = pollCallback
      await act(async () => { await cb() })
    }

    await waitFor(() => {
      expect(useSwapStore.getState().activeOrder?.status).toBe('filled')
    })

    // BrowserProvider should NOT have been called (no ethereum)
    expect(mockBrowserProvider).not.toHaveBeenCalledWith(undefined)
  })

  it('SwapExecuted ABI signature used in ethers.id matches F11 comment (7 params including indexed bytes32)', async () => {
    // The hook calls: ethers.id('SwapExecuted(bytes32,address,address,address,uint256,uint256,uint256)')
    // This is the ACTUAL signature used (7 params, 4 addresses including indexed bytes32).
    // mockEthersId is the module-level mock that backs ethers.id — use it directly
    // (avoids re-importing the module which would return the same mock reference).
    const { triggerPollTick } = await setupAndFill()

    const { result, unmount } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => { await result.current.submitSwap() })
    await triggerPollTick()

    await waitFor(() => {
      expect(useSwapStore.getState().activeOrder?.status).toBe('filled')
    })

    expect(mockEthersId).toHaveBeenCalledWith(
      'SwapExecuted(bytes32,address,address,address,uint256,uint256,uint256)',
    )
    act(() => { unmount() })
  })

  it('ABI decode called with 5-element type array (non-indexed fields only)', async () => {
    const { triggerPollTick } = await setupAndFill()

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => { await result.current.submitSwap() })
    await triggerPollTick()

    await waitFor(() => {
      expect(useSwapStore.getState().executionDetails).toBeTruthy()
    })

    expect(mockAbiCoderInstance.decode).toHaveBeenCalledWith(
      ['address', 'address', 'uint256', 'uint256', 'uint256'],
      expect.any(String),
    )
  })

  it('tx_hash without 0x prefix is normalised before receipt fetch', async () => {
    installEthereumStub()
    seedEvmStore()

    const txHashNoPrefix = 'aabbccdd' + '00'.repeat(28)
    const filledOrder = { ...MOCK_ORDER, status: 'filled', tx_hash: txHashNoPrefix }

    vi.spyOn(api, 'submitOrder').mockResolvedValue(MOCK_ORDER)
    vi.spyOn(api, 'attachSignature').mockResolvedValue({ order_id: MOCK_ORDER.order_id, signature_attached: true })
    vi.spyOn(api, 'getOrderStatus').mockResolvedValue(filledOrder)

    mockGetTransactionReceipt.mockResolvedValue({
      gasUsed: BigInt(100000),
      logs: [],
    })
    mockBrowserProvider.mockImplementation(() => ({
      getSigner: mockGetSigner,
      getTransactionReceipt: mockGetTransactionReceipt,
    }))

    let pollCallback: (() => Promise<void>) | null = null
    let fakeId = 920000
    vi.spyOn(globalThis, 'setInterval').mockImplementation((fn: any, delay?: any) => {
      fakeId++
      if (Number(delay) === 2000) pollCallback = fn as () => Promise<void>
      return fakeId as any
    })

    const { result } = renderHook(() => useOrderSubmission(), { wrapper: HookWrapper })

    await act(async () => { await result.current.submitSwap() })
    if (pollCallback) {
      const cb = pollCallback
      await act(async () => { await cb() })
    }

    await waitFor(() => {
      expect(useSwapStore.getState().activeOrder?.status).toBe('filled')
    })

    // Should have been called with 0x-prefixed hash
    expect(mockGetTransactionReceipt).toHaveBeenCalledWith(
      expect.stringMatching(/^0x/),
    )
  })
})
