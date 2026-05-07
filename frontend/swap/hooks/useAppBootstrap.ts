import { useEffect } from 'react'
import { useSwapStore } from '../swap.store'
import { TOKENS } from '../swap.config'
import type { Token } from '../swap.types'
import * as api from '@/api/client'

/**
 * Bootstrap hook: loads history, fetches solver tokens, discovers apps/contracts.
 * Runs once on mount.
 */
export function useAppBootstrap() {
  const store = useSwapStore()

  useEffect(() => {
    store.loadHistory()

    // Fetch solver tokens for the current chain
    console.log('[swap] fetching solver tokens for chain', store.chainId)
    api.getChainTokens(store.chainId).then((res) => {
      const solverTokens: Token[] = res.tokens.map((t) => ({
        symbol: t.symbol,
        name: t.symbol,
        address: t.address,
        decimals: t.decimals,
        icon: t.symbol === 'WETH' || t.symbol === 'ETH' ? '\u27E0' : t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'DAI' ? '$' : t.symbol[0],
      }))

      // Solver only discovers ERC-20s from Uniswap V3 pools. Inject the
      // native token (ETH/TAO) from the hardcoded config so users can
      // swap native assets seamlessly — the contract wraps msg.value
      // internally via _fundAndExecute.
      const hardcoded = TOKENS[store.chainId] || []
      const nativeToken = hardcoded.find((t) => t.native)
      const tokens = nativeToken && !solverTokens.some((t) => t.native || t.address === nativeToken.address)
        ? [nativeToken, ...solverTokens]
        : solverTokens

      console.log(`[swap] solver tokens loaded for chain ${store.chainId}:`, tokens.length, tokens.map(t => t.symbol))
      store.setSolverTokens(store.chainId, tokens)

      // Update selected tokens to matching solver token objects (preserves
      // address match but picks up correct decimals/symbol from solver)
      if (store.inputToken) {
        const match = tokens.find((x) => x.address.toLowerCase() === store.inputToken!.address.toLowerCase())
        if (match) store.setInputToken(match)
      }
      if (store.outputToken) {
        const match = tokens.find((x) => x.address.toLowerCase() === store.outputToken!.address.toLowerCase())
        if (match) store.setOutputToken(match)
      }
      // Fallback if nothing selected yet
      if (!store.inputToken) store.setInputToken(tokens.find((x) => x.symbol === 'USDC') || tokens[0] || null)
      if (!store.outputToken) store.setOutputToken(tokens.find((x) => x.symbol === 'WETH') || tokens[1] || null)
    }).catch((err) => {
      console.error('[swap] solver token fetch failed:', err)
      // Fallback to hardcoded tokens
      const t = TOKENS[store.chainId] || []
      if (!store.inputToken) store.setInputToken(t.find((x) => x.symbol === 'USDC') || t[0] || null)
      if (!store.outputToken) store.setOutputToken(t.find((x) => x.symbol === 'WETH' || x.symbol === 'ETH') || t[1] || null)
    })

    // Find the first order-ready app (DexAggregatorApp) and its contract address.
    //
    // Order-ready statuses are `solved` and `active` (see shared/types.py
    // AppStatus.is_order_ready). Pick a deployment matching the current chain
    // if possible, else fall back to any order-ready deployment.
    const ORDER_READY = new Set(['solved', 'active'])
    api.listApps().then(async (res) => {
      const apps = res.apps || []
      if (apps.length > 0) {
        const appId = apps[0].app_id
        store.setAppId(appId)
        store.setAppLoaded(true)
        try {
          const status = await api.getAppStatus(appId) as any
          const deps = status?.deployments || {}
          const depValues = Array.isArray(deps) ? deps : Object.values(deps)

          // Prefer a deployment on the current chain; fall back to the first
          // order-ready deployment on any chain.
          const matching = (depValues as any[]).find(
            (d) => d?.contract_address && ORDER_READY.has(d?.status) && d?.chain_id === store.chainId,
          )
          const fallback = (depValues as any[]).find(
            (d) => d?.contract_address && ORDER_READY.has(d?.status),
          )
          const pick = matching || fallback
          if (pick) {
            store.setContractAddress(pick.contract_address)
            console.log('[swap] contract address:', pick.contract_address, 'chain:', pick.chain_id, 'status:', pick.status)
          } else if (status?.contract_address) {
            // Legacy top-level fallback
            store.setContractAddress(status.contract_address)
            console.log('[swap] contract address (top-level fallback):', status.contract_address)
          } else {
            console.warn('[swap] no order-ready deployment found for app', appId, 'deployments:', depValues)
          }
        } catch (err) {
          console.error('[swap] failed to fetch app status:', err)
        }
      }
    }).catch((err) => {
      console.error('[swap] listApps failed:', err)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
