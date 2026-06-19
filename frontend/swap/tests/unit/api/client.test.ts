/**
 * Unit tests for getChainTokens — the token catalog merges the Superchain Token
 * List (fetched, all chains) with a bundled snapshot of Aerodrome's whitelisted
 * Base tokens (AERODROME_BASE_TOKENS, no runtime fetch).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { getChainTokens, TOKEN_LIST_URL } from '@/api/client'
import { AERODROME_BASE_TOKENS } from '@/config/aerodrome-base-tokens'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // in BOTH the Superchain mock + the Aero list
const SUPRONLY = '0xF0000000000000000000000000000000000000F1' // Base, Superchain-only (not in Aero list)

const SUPERCHAIN = {
  name: 'Superchain Token List',
  tokens: [
    { chainId: 8453, address: USDC, symbol: 'USDC', decimals: 6, logoURI: 'usdc.png' },
    { chainId: 8453, address: SUPRONLY, symbol: 'SUPRONLY', decimals: 18 },
    { chainId: 1, address: '0xMAINNET', symbol: 'X', decimals: 18 }, // other chain
  ],
}

function mockSuperchain(resp: { ok?: boolean; status?: number; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
    ok: resp.ok ?? true,
    status: resp.status ?? 200,
    statusText: (resp.ok ?? true) ? 'OK' : 'Error',
    json: async () => resp.body,
  } as Response))
}

afterEach(() => vi.restoreAllMocks())

describe('AERODROME_BASE_TOKENS (bundled snapshot)', () => {
  it('is a non-empty, well-formed token list including AERO', () => {
    expect(AERODROME_BASE_TOKENS.length).toBeGreaterThan(100)
    for (const t of AERODROME_BASE_TOKENS) {
      expect(t.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(typeof t.symbol).toBe('string')
      expect(Number.isInteger(t.decimals)).toBe(true)
    }
    expect(AERODROME_BASE_TOKENS.some((t) => t.symbol === 'AERO')).toBe(true)
  })
})

describe('getChainTokens', () => {
  it('Base: merges Superchain + bundled Aerodrome, dedupes by address (Superchain wins)', async () => {
    mockSuperchain({ body: SUPERCHAIN })
    const res = await getChainTokens(8453)
    const symbols = res.tokens.map((t) => t.symbol)
    expect(symbols).toContain('SUPRONLY') // Superchain-only Base token
    expect(symbols).toContain('AERO')     // from the bundled Aerodrome list
    // USDC overlaps both lists → present once, Superchain entry wins (keeps logo)
    const usdcs = res.tokens.filter((t) => t.address.toLowerCase() === USDC.toLowerCase())
    expect(usdcs).toHaveLength(1)
    expect(usdcs[0].logoURI).toBe('usdc.png')
    // union = the Aero set (which includes USDC) + the one Superchain-only Base token
    expect(res.count).toBe(AERODROME_BASE_TOKENS.length + 1)
  })

  it('non-Base chain: Superchain only, no Aerodrome tokens merged', async () => {
    const spy = mockSuperchain({ body: SUPERCHAIN })
    const res = await getChainTokens(1)
    expect(res.tokens.map((t) => t.symbol)).toEqual(['X'])
    expect(res.tokens.some((t) => t.symbol === 'AERO')).toBe(false)
    expect(spy).toHaveBeenCalledWith(TOKEN_LIST_URL, expect.anything())
  })

  it('Base: a malformed Superchain list still yields the bundled Aerodrome set', async () => {
    mockSuperchain({ body: { name: 'broken' } })
    const res = await getChainTokens(8453)
    expect(res.count).toBe(AERODROME_BASE_TOKENS.length)
  })

  it('throws when the Superchain backbone fails (caller falls back to hardcoded TOKENS)', async () => {
    mockSuperchain({ ok: false, status: 503, body: null })
    await expect(getChainTokens(8453)).rejects.toThrow()
  })

  it('non-Base: malformed Superchain → empty (Aerodrome not merged)', async () => {
    mockSuperchain({ body: { name: 'broken' } })
    const res = await getChainTokens(1)
    expect(res.tokens).toEqual([])
  })
})
