import { create } from 'zustand'
import type { Token, QuoteResult, OrderResult, WalletMode, SwapHistoryItem } from './types'
import { TOKENS, DEFAULT_CHAIN_ID, CHAIN_CONFIG } from '@/config/chains'

/** Cached solver-token list per chain. The validator's /v1/chains/{id}/tokens
 *  is ~400ms server-side and gated by a CORS preflight on first request, so
 *  without a cache the dropdowns stay empty for ~800ms on every refresh.
 *  Stale-while-revalidate: hydrate the store from this on init, then
 *  useAppBootstrap fetches fresh and the setter below writes through. */
const TOKENS_CACHE_KEY = 'minotaur:solver-tokens:v1'

function loadTokensCache(): Record<number, Token[]> {
  try {
    const raw = localStorage.getItem(TOKENS_CACHE_KEY)
    return raw ? (JSON.parse(raw) as Record<number, Token[]>) : {}
  } catch {
    return {}
  }
}

function saveTokensCache(t: Record<number, Token[]>): void {
  try {
    localStorage.setItem(TOKENS_CACHE_KEY, JSON.stringify(t))
  } catch {
    /* storage unavailable — fall back to in-memory only */
  }
}

interface SwapState {
  // Wallet
  walletMode: WalletMode
  walletConnected: boolean
  walletAddress: string
  walletChainId: number | null

  // Bittensor wallet (substrate)
  bittensorAddress: string
  bittensorConnected: boolean
  bittensorProxySetup: boolean

  // EVM recipient for cross-chain (MetaMask or manual input)
  evmRecipient: string
  evmRecipientSource: 'metamask' | 'manual' | ''

  // App
  appId: string
  appLoaded: boolean
  contractAddress: string  // on-chain contract for ERC-20 approvals
  appContracts: Record<number, string>
  unlimitedApproval: boolean
  slippageBps: number      // slippage tolerance in basis points (100 = 1%)

  /** Chain IDs where the active app has an order-ready deployment.
   *  Populated by useAppBootstrap from /v1/apps/{id}/status .deployments;
   *  filtered to status ∈ {'active','solved'}. Empty until first fetch. */
  appSupportedChains: number[]

  // Dynamic token lists from solver
  solverTokens: Record<number, Token[]>  // chain_id → tokens

  // Form
  chainId: number
  sourceChainId: number   // Where input tokens live (0 = Bittensor)
  isCrossChain: boolean
  inputToken: Token | null
  outputToken: Token | null
  inputAmount: string
  inputBalance: string | null
  outputBalance: string | null

  // Quote (new API)
  quote: QuoteResult | null
  quoteExpiry: number | null

  // Order
  activeOrder: OrderResult | null
  // Client-side stall flag: set when the active order sat in a non-terminal
  // state past ORDER_STALL_TIMEOUT_MS without progressing (e.g. validators
  // never scored it). The raw activeOrder.status is preserved so the card can
  // still show how far it got; this flag flips it to a failed treatment.
  orderStalled: boolean
  executionDetails: {
    amountIn: string; amountOut: string; fee: string
    surplus: string; tokenIn: string; tokenOut: string; gasUsed?: string
  } | null

  // Approval
  needsApproval: boolean
  approving: boolean
  // Wrap (native ETH input only). The relayer can't attach msg.value, so
  // native ETH must be wrapped to WETH and then approved before swapping.
  needsWrap: boolean
  wrapping: boolean

  // Status
  loading: boolean
  submitting: boolean
  polling: boolean
  error: string | null

  // History
  recentSwaps: SwapHistoryItem[]

  // UI
  showSettings: boolean
  showNetworkSelector: boolean
  showDestNetworkSelector: boolean
  tokenSelectorOpen: 'input' | 'output' | null
  showDebug: boolean
  showHistory: boolean
}

interface SwapActions {
  // Wallet
  setWalletMode: (mode: WalletMode) => void
  setWalletConnected: (connected: boolean) => void
  setWalletAddress: (address: string) => void
  setWalletChainId: (chainId: number | null) => void

  // Bittensor wallet
  setBittensorAddress: (address: string) => void
  setBittensorConnected: (connected: boolean) => void
  setBittensorProxySetup: (setup: boolean) => void

  // EVM recipient
  setEvmRecipient: (address: string, source: 'metamask' | 'manual') => void

  // App
  setAppId: (appId: string) => void
  setAppLoaded: (loaded: boolean) => void
  setAppSupportedChains: (chainIds: number[]) => void
  setAppContracts: (contracts: Record<number, string>) => void
  setContractAddress: (addr: string) => void
  setUnlimitedApproval: (v: boolean) => void
  setSlippageBps: (v: number) => void
  setSolverTokens: (chainId: number, tokens: Token[]) => void

  // Form
  setActiveChain: (chainId: number) => void
  setChainId: (chainId: number) => void
  setSourceChainId: (chainId: number) => void
  setInputToken: (token: Token | null) => void
  setOutputToken: (token: Token | null) => void
  setInputAmount: (amount: string) => void
  setInputBalance: (balance: string | null) => void
  setOutputBalance: (balance: string | null) => void
  swapTokens: () => void

  // Quote
  setQuote: (quote: QuoteResult | null) => void
  setQuoteExpiry: (expiry: number | null) => void
  clearQuote: () => void

  // Order
  setActiveOrder: (order: OrderResult | null) => void
  setOrderStalled: (stalled: boolean) => void
  setExecutionDetails: (details: { amountIn: string; amountOut: string; fee: string; surplus: string; tokenIn: string; tokenOut: string; gasUsed?: string } | null) => void

  // Approval
  setNeedsApproval: (v: boolean) => void
  setApproving: (v: boolean) => void
  setNeedsWrap: (v: boolean) => void
  setWrapping: (v: boolean) => void
  checkAllowance: () => Promise<void>

  // Status
  setLoading: (loading: boolean) => void
  setSubmitting: (submitting: boolean) => void
  setPolling: (polling: boolean) => void
  setError: (error: string | null) => void

  // History
  addToHistory: (swap: SwapHistoryItem) => void
  /** Patch the row matching `orderId` in place — used by the polling loop
   *  so terminal states (filled / rejected / cancelled / …) and tx hashes
   *  flow into the history panel instead of staying stuck at 'open'. */
  updateHistoryItem: (orderId: string, patch: Partial<SwapHistoryItem>) => void
  clearHistory: () => void
  loadHistory: () => void

  // UI
  setShowSettings: (show: boolean) => void
  setShowNetworkSelector: (show: boolean) => void
  setShowDestNetworkSelector: (show: boolean) => void
  setTokenSelectorOpen: (open: 'input' | 'output' | null) => void
  setShowDebug: (show: boolean) => void
  setShowHistory: (show: boolean) => void

  // Derived
  getActiveAddress: () => string
}

const initialState: SwapState = {
  walletMode: 'external',
  walletConnected: false,
  walletAddress: '',
  walletChainId: null,

  bittensorAddress: '',
  bittensorConnected: false,
  bittensorProxySetup: false,

  evmRecipient: '',
  evmRecipientSource: '',

  appId: '',
  appLoaded: false,
  contractAddress: '',
  appContracts: {},
  unlimitedApproval: false,
  slippageBps: 100,  // 1% default
  appSupportedChains: [],
  solverTokens: loadTokensCache(),

  chainId: DEFAULT_CHAIN_ID,
  sourceChainId: DEFAULT_CHAIN_ID,
  isCrossChain: false,
  inputToken: null,
  outputToken: null,
  inputAmount: '',
  inputBalance: null,
  outputBalance: null,

  quote: null,
  quoteExpiry: null,

  activeOrder: null,
  orderStalled: false,
  executionDetails: null,

  needsApproval: false,
  approving: false,
  needsWrap: false,
  wrapping: false,

  loading: false,
  submitting: false,
  polling: false,
  error: null,

  recentSwaps: [],

  showSettings: false,
  showNetworkSelector: false,
  showDestNetworkSelector: false,
  tokenSelectorOpen: null,
  showDebug: false,
  showHistory: false,
}

export const useSwapStore = create<SwapState & SwapActions>((set, get) => ({
  ...initialState,

  // Wallet
  setWalletMode: (mode) => set({ walletMode: mode }),
  setWalletConnected: (connected) => set({ walletConnected: connected }),
  setWalletAddress: (address) => set({ walletAddress: address }),
  setWalletChainId: (chainId) => set({ walletChainId: chainId }),

  // Bittensor wallet
  setBittensorAddress: (address) => set({ bittensorAddress: address }),
  setBittensorConnected: (connected) => set({ bittensorConnected: connected }),
  setBittensorProxySetup: (setup) => set({ bittensorProxySetup: setup }),

  // EVM recipient
  setEvmRecipient: (address, source) => set({ evmRecipient: address, evmRecipientSource: source }),

  // App
  setAppId: (appId) => set({ appId }),
  setAppLoaded: (loaded) => set({ appLoaded: loaded }),
  setAppSupportedChains: (chainIds) => set({ appSupportedChains: Array.from(new Set(chainIds)) }),
  setAppContracts: (appContracts) => set({ appContracts }),
  setContractAddress: (addr) => set({ contractAddress: addr }),
  setUnlimitedApproval: (v) => set({ unlimitedApproval: v }),
  setSlippageBps: (v) => set({ slippageBps: v }),
  setSolverTokens: (chainId, tokens) => set((s) => {
    const next = { ...s.solverTokens, [chainId]: tokens }
    saveTokensCache(next)
    return { solverTokens: next }
  }),

  // Form
  setActiveChain: (chainId) => {
    const tokens = TOKENS[chainId] || []
    set({
      chainId,
      sourceChainId: chainId,
      isCrossChain: false,
      inputToken: tokens.find((t) => t.symbol === 'USDC') || tokens[0] || null,
      outputToken: tokens.find((t) => t.symbol === 'WETH') || tokens.find((t) => t.symbol === 'ETH') || tokens[1] || tokens[0] || null,
      inputAmount: '',
      inputBalance: null,
      outputBalance: null,
      quote: null,
      quoteExpiry: null,
      evmRecipient: '',
      evmRecipientSource: '',
      needsApproval: false,
      needsWrap: false,
      showDestNetworkSelector: false,
    })
  },
  setChainId: (chainId) => {
    const tokens = TOKENS[chainId] || []
    set({
      chainId,
      isCrossChain: chainId !== get().sourceChainId,
      outputToken: tokens.find((t) => t.symbol === 'USDC') || tokens[0] || null,
      quote: null,
      quoteExpiry: null,
      showDestNetworkSelector: false,
    })
  },
  setSourceChainId: (sourceChainId) => {
    const tokens = TOKENS[sourceChainId] || []
    set({
      sourceChainId,
      isCrossChain: sourceChainId !== get().chainId,
      inputToken: tokens[0] || null,
      quote: null,
      quoteExpiry: null,
    })
  },
  setInputToken: (token) => set({ inputToken: token, quote: null }),
  setOutputToken: (token) => set({ outputToken: token, quote: null }),
  setInputAmount: (amount) => set({ inputAmount: amount }),
  setInputBalance: (balance) => set({ inputBalance: balance }),
  setOutputBalance: (balance) => set({ outputBalance: balance }),
  swapTokens: () => {
    const { inputToken, outputToken } = get()
    set({
      inputToken: outputToken,
      outputToken: inputToken,
      inputAmount: '',
      quote: null,
    })
  },

  // Quote
  setQuote: (quote) => set({ quote }),
  setQuoteExpiry: (expiry) => set({ quoteExpiry: expiry }),
  clearQuote: () => set({ quote: null, quoteExpiry: null }),

  // Order
  setActiveOrder: (order) => set({ activeOrder: order, executionDetails: order ? undefined : null }),
  setOrderStalled: (stalled) => set({ orderStalled: stalled }),
  setExecutionDetails: (details) => set({ executionDetails: details }),

  // Approval
  // Approval
  setNeedsApproval: (v) => set({ needsApproval: v }),
  setApproving: (v) => set({ approving: v }),
  setNeedsWrap: (v) => set({ needsWrap: v }),
  setWrapping: (v) => set({ wrapping: v }),
  checkAllowance: async () => {
    const s = get()
    if (s.walletMode !== 'external' || !s.inputToken) {
      set({ needsApproval: false, needsWrap: false })
      return
    }
    const addr = s.getActiveAddress()
    const contract = s.contractAddress
    const amount = s.quote?.ready_params?.input_amount || s.inputAmount || '0'
    if (!addr || !contract || !amount || amount === '0') {
      set({ needsApproval: false, needsWrap: false })
      return
    }
    // Native ETH can't ride along as msg.value through the relayer, so we
    // settle it as WETH: the user wraps ETH→WETH, then approves WETH. Both
    // the allowance probe and the wrap-needed probe therefore target the
    // wrapped-native token, not the 0xEeee… native sentinel.
    const isNative = !!s.inputToken.native
    const tokenAddr = isNative
      ? CHAIN_CONFIG[s.chainId]?.wrappedNative
      : s.inputToken.address
    if (!tokenAddr) {
      set({ needsApproval: false, needsWrap: false })
      return
    }
    try {
      // Use viem's read path via the wagmi-config public client — same
      // RPC as the rest of the swap, works regardless of which connector
      // (MetaMask, Rabby, WalletConnect, Coinbase, …) is active.
      const [{ getPublicClient }, { erc20Abi }, { wagmiConfig }] = await Promise.all([
        import('wagmi/actions'),
        import('viem'),
        import('@/config/wagmi'),
      ])
      // getPublicClient narrows chainId to the union of configured chains
      // (Base 8453 + Ethereum 1). store.chainId is snapped to a supported
      // deployment chain at bootstrap, so this cast is safe at runtime.
      const client = getPublicClient(wagmiConfig, { chainId: s.chainId as 8453 | 1 })
      if (!client) { set({ needsApproval: false, needsWrap: false }); return }
      const want = BigInt(String(amount))
      // Native input: does the user hold enough WETH yet, or must they wrap?
      if (isNative) {
        const wethBal = await client.readContract({
          address: tokenAddr as `0x${string}`,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [addr as `0x${string}`],
        })
        set({ needsWrap: BigInt(wethBal as bigint) < want })
      } else {
        set({ needsWrap: false })
      }
      const allowance = await client.readContract({
        address: tokenAddr as `0x${string}`,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [addr as `0x${string}`, contract as `0x${string}`],
      })
      set({ needsApproval: BigInt(allowance as bigint) < want })
    } catch {
      set({ needsApproval: false, needsWrap: false })
    }
  },

  // Status
  setLoading: (loading) => set({ loading }),
  setSubmitting: (submitting) => set({ submitting }),
  setPolling: (polling) => set({ polling }),
  setError: (error) => set({ error }),

  // History
  addToHistory: (swap) => {
    const history = [swap, ...get().recentSwaps].slice(0, 10)
    localStorage.setItem('minotaur_swap_history', JSON.stringify(history))
    set({ recentSwaps: history })
  },
  updateHistoryItem: (orderId, patch) => {
    const current = get().recentSwaps
    let changed = false
    const next = current.map((s) => {
      if (s.orderId !== orderId) return s
      changed = true
      return { ...s, ...patch }
    })
    if (!changed) return
    localStorage.setItem('minotaur_swap_history', JSON.stringify(next))
    set({ recentSwaps: next })
  },
  clearHistory: () => {
    localStorage.removeItem('minotaur_swap_history')
    set({ recentSwaps: [] })
  },
  loadHistory: () => {
    try {
      const saved = localStorage.getItem('minotaur_swap_history')
      if (!saved) return
      const items = JSON.parse(saved).slice(0, 10)
      // Auto-open the Recent Swaps panel on boot whenever the user has at
      // least one persisted swap — they came back to see their history,
      // make it visible without an extra click. The header icon still
      // toggles it closed if they prefer the focused single-card layout.
      set({ recentSwaps: items, showHistory: items.length > 0 })
    } catch {
      /* ignore */
    }
  },

  // UI
  setShowSettings: (show) => set({ showSettings: show }),
  setShowNetworkSelector: (show) => set({ showNetworkSelector: show, showDestNetworkSelector: false }),
  setShowDestNetworkSelector: (show) => set({ showDestNetworkSelector: show, showNetworkSelector: false }),
  setTokenSelectorOpen: (open) => set({ tokenSelectorOpen: open }),
  setShowDebug: (show) => set({ showDebug: show }),
  setShowHistory: (show) => set({ showHistory: show }),

  // Derived
  getActiveAddress: () => {
    const s = get()
    if (s.walletMode === 'bittensor' && s.bittensorAddress) return s.bittensorAddress
    return s.walletAddress
  },
}))
