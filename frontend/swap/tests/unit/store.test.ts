import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import { useSwapStore } from '@/store'

let INITIAL_STATE: any

beforeAll(() => {
  // Snapshot the initial state from a fresh store import.
  // Zustand merges state, so we capture only the non-action keys.
  const s = useSwapStore.getState() as any
  INITIAL_STATE = {}
  for (const [k, v] of Object.entries(s)) {
    if (typeof v !== 'function') INITIAL_STATE[k] = v
  }
})

beforeEach(() => {
  // Reset to initial state. The `true` second arg replaces, but we
  // want to preserve actions (functions) — so spread current actions on top.
  const current = useSwapStore.getState() as any
  const actions: any = {}
  for (const [k, v] of Object.entries(current)) {
    if (typeof v === 'function') actions[k] = v
  }
  useSwapStore.setState({ ...INITIAL_STATE, ...actions }, true)
  localStorage.clear()
})

describe('useSwapStore', () => {
  it('setInputAmount updates inputAmount', () => {
    useSwapStore.getState().setInputAmount('123')
    expect(useSwapStore.getState().inputAmount).toBe('123')
  })

  it('setChainId clears quote', () => {
    useSwapStore.setState({ quote: { foo: 1 } as any })
    useSwapStore.getState().setChainId(8453)
    expect(useSwapStore.getState().quote).toBeNull()
  })

  it('setActiveChain keeps a swap on one chain and clears stale state', () => {
    useSwapStore.setState({
      chainId: 8453,
      sourceChainId: 8453,
      isCrossChain: false,
      inputAmount: '10',
      quote: { foo: 1 } as any,
      evmRecipient: '0x123',
      showDestNetworkSelector: true,
    })

    useSwapStore.getState().setActiveChain(1)

    const state = useSwapStore.getState()
    expect(state.chainId).toBe(1)
    expect(state.sourceChainId).toBe(1)
    expect(state.isCrossChain).toBe(false)
    expect(state.inputToken?.symbol).toBe('USDC')
    expect(state.outputToken?.symbol).toBe('WETH')
    expect(state.inputAmount).toBe('')
    expect(state.quote).toBeNull()
    expect(state.evmRecipient).toBe('')
    expect(state.showDestNetworkSelector).toBe(false)
  })

  it('swapTokens flips input/output and clears amount', () => {
    const tokenA = { symbol: 'A', address: '0xa', decimals: 18 }
    const tokenB = { symbol: 'B', address: '0xb', decimals: 18 }
    useSwapStore.setState({ inputToken: tokenA as any, outputToken: tokenB as any, inputAmount: '50' })
    useSwapStore.getState().swapTokens()
    const s = useSwapStore.getState()
    expect(s.inputToken?.symbol).toBe('B')
    expect(s.outputToken?.symbol).toBe('A')
    expect(s.inputAmount).toBe('')
  })

  it('addToHistory prepends and caps at 10 items', () => {
    const swap = (id: string) => ({ orderId: id, timestamp: Date.now(), chainId: 1 }) as any
    for (let i = 0; i < 12; i++) useSwapStore.getState().addToHistory(swap(`#${i}`))
    const hist = useSwapStore.getState().recentSwaps
    expect(hist.length).toBe(10)
    expect(hist[0].orderId).toBe('#11')
    expect(hist[9].orderId).toBe('#2')
  })

  it('addToHistory persists to localStorage', () => {
    useSwapStore.getState().addToHistory({ orderId: 'persist-test', timestamp: 1 } as any)
    // The localStorage key is 'minotaur_swap_history' (from store.ts addToHistory)
    const raw = localStorage.getItem('minotaur_swap_history')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)[0].orderId).toBe('persist-test')
  })

  it('loadHistory reads localStorage and hydrates state', () => {
    // Write to the same key that addToHistory uses
    localStorage.setItem('minotaur_swap_history', JSON.stringify([{ orderId: 'hydrated', timestamp: 1 }]))
    useSwapStore.getState().loadHistory()
    expect(useSwapStore.getState().recentSwaps[0].orderId).toBe('hydrated')
  })
})
