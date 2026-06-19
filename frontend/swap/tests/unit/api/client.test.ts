/**
 * Unit tests for getChainTokens — the token catalog comes from keyless token
 * lists: the Superchain Token List (backbone, all chains) merged with
 * Aerodrome's /api/v1/assets (Base-only, best-effort) for the Aero long tail.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getChainTokens, TOKEN_LIST_URL, AERODROME_ASSETS_URL } from '@/api/client'

const SUPERCHAIN = {
  name: 'Superchain Token List',
  tokens: [
    { chainId: 8453, address: '0xUSDC', name: 'USD Coin', symbol: 'USDC', decimals: 6, logoURI: 'usdc.png' },
    { chainId: 8453, address: '0xWETH', name: 'Wrapped Ether', symbol: 'WETH', decimals: 18 },
    { chainId: 8453, address: '0xusdc', name: 'dup', symbol: 'USDC', decimals: 6 }, // dup addr → deduped
    { chainId: 1, address: '0xMAINNET', name: 'X', symbol: 'X', decimals: 18 },     // other chain
  ],
}

// Aerodrome returns { data: [...] }, addresses already lower-cased server-side.
const AERODROME = {
  data: [
    { address: '0xaero', symbol: 'AERO', decimals: 18, logoURI: 'aero.png' },  // Aero-native (new)
    { address: '0xusdc', symbol: 'USDC', decimals: 6 },                        // overlaps Superchain USDC
  ],
}

interface Resp { ok?: boolean; status?: number; body: unknown }

/** Mock global fetch, routing by URL to a Superchain / Aerodrome response. */
function mockFetch(routes: { superchain?: Resp; aerodrome?: Resp }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input)
    const r = url.includes('aerodrome') ? routes.aerodrome : routes.superchain
    if (!r) throw new Error(`unexpected fetch: ${url}`)
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: (r.ok ?? true) ? 'OK' : 'Error',
      json: async () => r.body,
    } as Response
  })
}

afterEach(() => vi.restoreAllMocks())

describe('getChainTokens', () => {
  it('Base: merges Superchain + Aerodrome, dedupes by address (Superchain wins)', async () => {
    mockFetch({ superchain: { body: SUPERCHAIN }, aerodrome: { body: AERODROME } })

    const res = await getChainTokens(8453)

    expect(res.chain_id).toBe(8453)
    expect(res.tokens.map((t) => t.symbol)).toEqual(['USDC', 'WETH', 'AERO'])
    // Overlapping USDC keeps the Superchain entry (checksummed addr + logo)
    const usdc = res.tokens.find((t) => t.symbol === 'USDC')!
    expect(usdc.address).toBe('0xUSDC')
    expect(usdc.logoURI).toBe('usdc.png')
    // Aero-native token surfaced
    expect(res.tokens.find((t) => t.symbol === 'AERO')?.address).toBe('0xaero')
  })

  it('Base: Aerodrome failure falls back to Superchain only (no throw)', async () => {
    mockFetch({ superchain: { body: SUPERCHAIN }, aerodrome: { ok: false, status: 503, body: null } })

    const res = await getChainTokens(8453)

    expect(res.tokens.map((t) => t.symbol)).toEqual(['USDC', 'WETH'])
    expect(res.tokens.some((t) => t.symbol === 'AERO')).toBe(false)
  })

  it('Base: malformed Aerodrome body (no data array) → Superchain only', async () => {
    mockFetch({ superchain: { body: SUPERCHAIN }, aerodrome: { body: { error: 'nope' } } })
    const res = await getChainTokens(8453)
    expect(res.count).toBe(2)
  })

  it('non-Base chain: only the Superchain list is fetched (Aerodrome skipped)', async () => {
    const fetchSpy = mockFetch({ superchain: { body: SUPERCHAIN } })

    const res = await getChainTokens(1)

    expect(res.tokens.map((t) => t.symbol)).toEqual(['X'])
    // Aerodrome endpoint must not be hit for non-Base chains
    const hitAero = fetchSpy.mock.calls.some((c) => String(c[0]).includes('aerodrome'))
    expect(hitAero).toBe(false)
    expect(fetchSpy).toHaveBeenCalledWith(TOKEN_LIST_URL, expect.anything())
  })

  it('throws when the Superchain backbone fails (caller falls back to hardcoded)', async () => {
    mockFetch({ superchain: { ok: false, status: 503, body: null }, aerodrome: { body: AERODROME } })
    await expect(getChainTokens(8453)).rejects.toThrow()
  })

  it('tolerates a malformed Superchain list (no tokens array) → empty', async () => {
    mockFetch({ superchain: { body: { name: 'broken' } }, aerodrome: { body: { data: [] } } })
    const res = await getChainTokens(8453)
    expect(res.tokens).toEqual([])
    expect(res.count).toBe(0)
  })

  it('exposes the token source URLs (Aerodrome via same-origin proxy path)', () => {
    expect(TOKEN_LIST_URL).toContain('optimism')
    expect(AERODROME_ASSETS_URL).toContain('aerodrome')
    // Same-origin (CloudFront proxy) by default, not a cross-origin URL — this
    // is what avoids the CORS block on api.aerodrome.finance.
    expect(AERODROME_ASSETS_URL.startsWith('http')).toBe(false)
  })
})
