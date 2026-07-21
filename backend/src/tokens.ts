/**
 * Token discovery for the balances path. Mirrors the frontend's getChainTokens:
 * the Superchain Token List (fetched, cached) as the backbone, merged with the
 * bundled per-chain snapshots (Ethereum incl. wTAO, Aerodrome for Base). The
 * backend checks the SAME set the selector shows, so a held token's balance is
 * never missing from the UI.
 */
import { config } from './config.js'
import type { TtlCache } from './cache.js'
import { ETHEREUM_TOKENS } from './tokens/generated/ethereum-tokens.js'
import { AERODROME_BASE_TOKENS } from './tokens/generated/aerodrome-base-tokens.js'

export interface DiscoveryToken {
  address: string
  symbol: string
  decimals: number
}

interface SuperchainEntry {
  chainId: number
  address: string
  symbol: string
  decimals: number
}

async function fetchSuperchain(chainId: number): Promise<DiscoveryToken[]> {
  const res = await fetch(config.superchainUrl, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`superchain token list ${res.status}`)
  const data = (await res.json()) as { tokens?: SuperchainEntry[] }
  const list = Array.isArray(data.tokens) ? data.tokens : []
  return list
    .filter((t) => t.chainId === chainId && !!t.address)
    .map((t) => ({ address: t.address, symbol: t.symbol, decimals: t.decimals }))
}

function dedupeByAddress(tokens: DiscoveryToken[]): DiscoveryToken[] {
  const seen = new Set<string>()
  const out: DiscoveryToken[] = []
  for (const t of tokens) {
    if (!t.address) continue
    const key = t.address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** Cached, merged token set for a chain. Throws only if the Superchain backbone
 *  fails and there's no snapshot to fall back to. */
export async function getTokenList(chainId: number, cache: TtlCache): Promise<DiscoveryToken[]> {
  const snapshot: DiscoveryToken[] =
    chainId === 1 ? ETHEREUM_TOKENS : chainId === 8453 ? AERODROME_BASE_TOKENS : []
  let superchain: DiscoveryToken[] = []
  try {
    superchain = await cache.get(
      `superchain:${chainId}`,
      { ttlMs: config.tokenListTtlMs, staleMs: config.tokenListTtlMs },
      () => fetchSuperchain(chainId),
    )
  } catch (err) {
    if (snapshot.length === 0) throw err
    // Backbone down but we have a bundled snapshot — degrade gracefully.
  }
  return dedupeByAddress([...superchain, ...snapshot])
}
