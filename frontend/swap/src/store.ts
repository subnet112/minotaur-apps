import { create } from 'zustand'
import type { Token, QuoteResult, OrderResult, WalletInfo, WalletMode, SwapHistoryItem } from './types'
import { TOKENS, DEFAULT_CHAIN_ID } from '@/config/chains'

interface SwapState {
  // Wallet
  walletMode: WalletMode
  walletConnected: boolean
  walletAddress: string
  walletChainId: number | null
  managedWallet: WalletInfo | null

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
  unlimitedApproval: boolean
  slippageBps: number      // slippage tolerance in basis points (100 = 1%)

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
  executionDetails: {
    amountIn: string; amountOut: string; fee: string
    surplus: string; tokenIn: string; tokenOut: string; gasUsed?: string
  } | null

  // Approval
  needsApproval: boolean
  approving: boolean

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
  setManagedWallet: (wallet: WalletInfo | null) => void

  // Bittensor wallet
  setBittensorAddress: (address: string) => void
  setBittensorConnected: (connected: boolean) => void
  setBittensorProxySetup: (setup: boolean) => void

  // EVM recipient
  setEvmRecipient: (address: string, source: 'metamask' | 'manual') => void

  // App
  setAppId: (appId: string) => void
  setAppLoaded: (loaded: boolean) => void
  setContractAddress: (addr: string) => void
  setUnlimitedApproval: (v: boolean) => void
  setSlippageBps: (v: number) => void
  setSolverTokens: (chainId: number, tokens: Token[]) => void

  // Form
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
  setExecutionDetails: (details: { amountIn: string; amountOut: string; fee: string; surplus: string; tokenIn: string; tokenOut: string; gasUsed?: string } | null) => void

  // Approval
  setNeedsApproval: (v: boolean) => void
  setApproving: (v: boolean) => void
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
  managedWallet: null,

  bittensorAddress: '',
  bittensorConnected: false,
  bittensorProxySetup: false,

  evmRecipient: '',
  evmRecipientSource: '',

  appId: '',
  appLoaded: false,
  contractAddress: '',
  unlimitedApproval: false,
  slippageBps: 100,  // 1% default
  solverTokens: {},

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
  executionDetails: null,

  needsApproval: false,
  approving: false,

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
  setManagedWallet: (wallet) => set({ managedWallet: wallet }),

  // Bittensor wallet
  setBittensorAddress: (address) => set({ bittensorAddress: address }),
  setBittensorConnected: (connected) => set({ bittensorConnected: connected }),
  setBittensorProxySetup: (setup) => set({ bittensorProxySetup: setup }),

  // EVM recipient
  setEvmRecipient: (address, source) => set({ evmRecipient: address, evmRecipientSource: source }),

  // App
  setAppId: (appId) => set({ appId }),
  setAppLoaded: (loaded) => set({ appLoaded: loaded }),
  setContractAddress: (addr) => set({ contractAddress: addr }),
  setUnlimitedApproval: (v) => set({ unlimitedApproval: v }),
  setSlippageBps: (v) => set({ slippageBps: v }),
  setSolverTokens: (chainId, tokens) => set((s) => ({ solverTokens: { ...s.solverTokens, [chainId]: tokens } })),

  // Form
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
  setExecutionDetails: (details) => set({ executionDetails: details }),

  // Approval
  // Approval
  setNeedsApproval: (v) => set({ needsApproval: v }),
  setApproving: (v) => set({ approving: v }),
  checkAllowance: async () => {
    const s = get()
    if (s.walletMode !== 'external' || !window.ethereum || !s.inputToken || s.inputToken.native) {
      set({ needsApproval: false })
      return
    }
    const addr = s.getActiveAddress()
    const contract = s.contractAddress
    const amount = s.quote?.ready_params?.input_amount || s.inputAmount || '0'
    if (!addr || !contract || !amount || amount === '0') {
      set({ needsApproval: false })
      return
    }
    try {
      const { ethers } = await import('ethers')
      const provider = new ethers.BrowserProvider(window.ethereum)
      const erc20 = new ethers.Contract(s.inputToken.address, [
        'function allowance(address,address) view returns (uint256)',
      ], provider)
      const allowance = await erc20.allowance(addr, contract)
      set({ needsApproval: BigInt(allowance) < BigInt(String(amount)) })
    } catch {
      set({ needsApproval: false })
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
      if (saved) set({ recentSwaps: JSON.parse(saved).slice(0, 10) })
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
    if (s.walletMode === 'managed' && s.managedWallet) return s.managedWallet.address
    if (s.walletMode === 'bittensor' && s.bittensorAddress) return s.bittensorAddress
    return s.walletAddress
  },
}))
