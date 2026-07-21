/**
 * Wallet balances computed on-chain in a single Multicall3 round (viem), rather
 * than proxying the validator's slow per-token endpoint. Response shape matches
 * what the swap frontend's useWalletBalances reads: `native.balance` and
 * `tokens[].balance` / `.balance_raw`, matched by symbol or address.
 */
import {
  createPublicClient,
  http,
  erc20Abi,
  getAddress,
  isAddress,
  formatEther,
  formatUnits,
  type MulticallReturnType,
  type Chain,
} from 'viem'
import { mainnet, base } from 'viem/chains'
import { config } from './config.js'
import type { DiscoveryToken } from './tokens.js'

const VIEM_CHAINS: Record<number, Chain> = { 1: mainnet, 8453: base }

export interface BalancesResult {
  address: string
  chain_id: number
  native: { symbol: string; balance_wei: string; balance: string }
  tokens: Array<{ symbol: string; address: string; balance_raw: string; balance: string; decimals: number }>
}

class HttpError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

/** True when we can compute balances on-chain for this chain (viem chain + RPC). */
export function supportsChain(chainId: number): boolean {
  return !!VIEM_CHAINS[chainId] && !!config.rpcUrls[chainId]
}

function publicClient(chainId: number) {
  const auth = config.rpcAuth[chainId]
  return createPublicClient({
    chain: VIEM_CHAINS[chainId],
    transport: http(config.rpcUrls[chainId], {
      batch: true,
      ...(auth ? { fetchOptions: { headers: { Authorization: auth } } } : {}),
    }),
  })
}

/** Pure shaping of raw reads → API response. Separated for testability. */
export function shapeBalances(
  owner: string,
  chainId: number,
  nativeWei: bigint,
  results: MulticallReturnType,
  tokens: DiscoveryToken[],
): BalancesResult {
  const out: BalancesResult['tokens'] = []
  results.forEach((r, i) => {
    if (r.status === 'success' && typeof r.result === 'bigint' && r.result > 0n) {
      const t = tokens[i]
      out.push({
        symbol: t.symbol,
        address: t.address,
        balance_raw: r.result.toString(),
        balance: formatUnits(r.result, t.decimals),
        decimals: t.decimals,
      })
    }
  })
  out.sort((a, b) => a.symbol.localeCompare(b.symbol))
  return {
    address: owner,
    chain_id: chainId,
    native: { symbol: 'ETH', balance_wei: nativeWei.toString(), balance: formatEther(nativeWei) },
    tokens: out,
  }
}

export async function computeBalances(
  address: string,
  chainId: number,
  tokens: DiscoveryToken[],
): Promise<BalancesResult> {
  if (!isAddress(address)) throw new HttpError(400, 'invalid address')
  if (!supportsChain(chainId)) throw new HttpError(400, `unsupported or unconfigured chain_id ${chainId}`)

  const owner = getAddress(address)
  const client = publicClient(chainId)
  const valid = tokens.filter((t) => isAddress(t.address))

  const [nativeWei, results] = await Promise.all([
    client.getBalance({ address: owner }),
    client.multicall({
      allowFailure: true,
      batchSize: 2048,
      contracts: valid.map((t) => ({
        address: getAddress(t.address),
        abi: erc20Abi,
        functionName: 'balanceOf' as const,
        args: [owner] as const,
      })),
    }),
  ])

  return shapeBalances(owner, chainId, nativeWei, results, valid)
}
