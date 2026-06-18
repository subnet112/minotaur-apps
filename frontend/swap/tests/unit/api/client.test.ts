/**
 * Unit tests for getChainTokens — the token catalog now comes from the
 * external Superchain Token List (keyless CDN), not the validator endpoint.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getChainTokens, TOKEN_LIST_URL } from '@/api/client'

const SAMPLE_LIST = {
  name: 'Superchain Token List',
  tokens: [
    { chainId: 8453, address: '0xUSDC', name: 'USD Coin', symbol: 'USDC', decimals: 6, logoURI: 'usdc.png' },
    { chainId: 8453, address: '0xWETH', name: 'Wrapped Ether', symbol: 'WETH', decimals: 18 },
    // duplicate address (different casing) → deduped
    { chainId: 8453, address: '0xusdc', name: 'dup', symbol: 'USDC', decimals: 6 },
    // other chain → filtered out
    { chainId: 1, address: '0xMAINNET', name: 'X', symbol: 'X', decimals: 18 },
  ],
}

function mockFetchOnce(value: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status,
    statusText: ok ? 'OK' : 'Service Unavailable',
    json: async () => value,
  } as Response)
}

afterEach(() => vi.restoreAllMocks())

describe('getChainTokens (Superchain token list)', () => {
  it('fetches the Superchain list, filters by chainId, dedupes, maps shape', async () => {
    const fetchSpy = mockFetchOnce(SAMPLE_LIST)

    const res = await getChainTokens(8453)

    expect(fetchSpy).toHaveBeenCalledWith(TOKEN_LIST_URL, expect.anything())
    expect(res.chain_id).toBe(8453)
    expect(res.count).toBe(2) // mainnet entry filtered, dup address removed
    expect(res.tokens.map((t) => t.symbol)).toEqual(['USDC', 'WETH'])
    expect(res.tokens.find((t) => t.symbol === 'USDC')?.decimals).toBe(6)
    expect(res.tokens.find((t) => t.symbol === 'USDC')?.logoURI).toBe('usdc.png')
    expect(res.tokens.find((t) => t.symbol === 'WETH')?.decimals).toBe(18)
  })

  it('returns only entries for the requested chain', async () => {
    mockFetchOnce(SAMPLE_LIST)
    const res = await getChainTokens(1)
    expect(res.count).toBe(1)
    expect(res.tokens[0].symbol).toBe('X')
  })

  it('throws on a non-ok response so the caller can fall back to hardcoded tokens', async () => {
    mockFetchOnce(null, false, 503)
    await expect(getChainTokens(8453)).rejects.toThrow()
  })

  it('tolerates a malformed list (no tokens array) by returning empty', async () => {
    mockFetchOnce({ name: 'broken' })
    const res = await getChainTokens(8453)
    expect(res.count).toBe(0)
    expect(res.tokens).toEqual([])
  })
})
