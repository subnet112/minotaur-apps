import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MulticallReturnType } from 'viem'
import { shapeBalances } from '../src/balances.js'
import { getTokenList } from '../src/tokens.js'
import { TtlCache } from '../src/cache.js'
import type { DiscoveryToken } from '../src/tokens.js'

const TOKENS: DiscoveryToken[] = [
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
  { address: '0x77E06c9eCCf2E797fd462A92B6D7642EF85b0A44', symbol: 'wTAO', decimals: 9 },
  { address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', symbol: 'AAVE', decimals: 18 },
]

describe('shapeBalances', () => {
  it('keeps only non-zero balances, formats decimals, and includes native', () => {
    const results = [
      { status: 'success', result: 6_250_020_350n },       // USDC 6250.02035
      { status: 'success', result: 7_270_254_055n },        // wTAO 7.270254055
      { status: 'success', result: 0n },                    // AAVE zero → dropped
    ] as unknown as MulticallReturnType

    const out = shapeBalances('0xOwner', 1, 394_556_593_182_315_480n, results, TOKENS)

    expect(out.chain_id).toBe(1)
    expect(out.native).toEqual({ symbol: 'ETH', balance_wei: '394556593182315480', balance: '0.39455659318231548' })
    expect(out.tokens.map((t) => t.symbol)).toEqual(['USDC', 'wTAO']) // AAVE dropped, sorted
    const wtao = out.tokens.find((t) => t.symbol === 'wTAO')!
    expect(wtao.balance).toBe('7.270254055')
    expect(wtao.balance_raw).toBe('7270254055')
    expect(wtao.decimals).toBe(9)
  })

  it('drops failed multicall entries', () => {
    const results = [
      { status: 'failure', error: new Error('reverted') },
      { status: 'success', result: 5n },
      { status: 'success', result: 0n },
    ] as unknown as MulticallReturnType
    const out = shapeBalances('0xOwner', 1, 0n, results, TOKENS)
    expect(out.tokens.map((t) => t.symbol)).toEqual(['wTAO'])
  })
})

describe('getTokenList', () => {
  afterEach(() => vi.restoreAllMocks())

  it('merges Superchain + the Ethereum snapshot incl. wTAO (chain 1)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ tokens: [{ chainId: 1, address: '0xAbc0000000000000000000000000000000000001', symbol: 'X', decimals: 18 }] }),
    } as Response)

    const list = await getTokenList(1, new TtlCache())
    expect(list.some((t) => t.symbol === 'X')).toBe(true)
    expect(list.some((t) => t.address.toLowerCase() === '0x77e06c9eccf2e797fd462a92b6d7642ef85b0a44')).toBe(true)
  })

  it('falls back to the bundled snapshot when the Superchain backbone fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response)
    const list = await getTokenList(1, new TtlCache())
    expect(list.some((t) => t.symbol === 'wTAO')).toBe(true)
  })
})
