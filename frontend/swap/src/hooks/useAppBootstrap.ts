import { useEffect } from 'react'
import { useSwapStore } from '../store'
import { TOKENS } from '@/config/chains'
import type { Token } from '../types'
import * as api from '@/api/client'

/**
 * The App Intent this UI serves. The validator can list several apps (V1 and
 * V2 DexAggregator during the migration); we serve exactly ONE, chosen
 * explicitly — never `apps[0]` — so which app is served is deterministic.
 *
 * Configure with `VITE_APP_ID`; defaults to the DEX Aggregator V2 app
 * (Base + Ethereum). A configured id that the validator doesn't list is a
 * hard error (surfaced to the user) — we never silently fall back to another
 * app, which would swap against the wrong contract.
 */
export const CONFIGURED_APP_ID: string =
  (import.meta.env.VITE_APP_ID as string | undefined)?.trim() || 'app_0867cdd4effd'

/**
 * Bootstrap hook: loads history, fetches solver tokens, discovers apps/contracts.
 * Runs once on mount.
 */
export function useAppBootstrap() {
  const store = useSwapStore()

  useEffect(() => {
    store.loadHistory()

    // Fetch the token catalog (Superchain Token List) for the current chain
    console.log('[swap] fetching token list for chain', store.chainId)
    api.getChainTokens(store.chainId).then((res) => {
      const solverTokens: Token[] = res.tokens.map((t) => ({
        symbol: t.symbol,
        name: t.symbol,
        address: t.address,
        decimals: t.decimals,
        icon: t.symbol === 'WETH' || t.symbol === 'ETH' ? '\u27E0' : t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'DAI' ? '$' : t.symbol[0],
        logoURI: t.logoURI,
      }))

      // The token list contains only ERC-20s. Inject the native token
      // (ETH/TAO) from the hardcoded config so users can swap native assets
      // seamlessly — the contract wraps msg.value internally via
      // _fundAndExecute.
      const hardcoded = TOKENS[store.chainId] || []
      const nativeToken = hardcoded.find((t) => t.native)
      const tokens = nativeToken && !solverTokens.some((t) => t.native || t.address === nativeToken.address)
        ? [nativeToken, ...solverTokens]
        : solverTokens

      console.log(`[swap] token list loaded for chain ${store.chainId}:`, tokens.length, tokens.map(t => t.symbol))
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
      // Serve the CONFIGURED app explicitly — not the list head. If the
      // validator doesn't list it, fail loud rather than swapping against
      // whatever app happens to come first.
      const chosen = apps.find((a) => a.app_id === CONFIGURED_APP_ID)
      if (!chosen) {
        const available = apps.map((a) => a.app_id).join(', ') || '(none)'
        const msg =
          `Configured app "${CONFIGURED_APP_ID}" is not served by the validator ` +
          `(available: ${available}). Set VITE_APP_ID to a listed app.`
        console.error('[swap]', msg)
        store.setError(msg)
        store.setAppLoaded(true)
        return
      }
      {
        const appId = chosen.app_id
        store.setAppId(appId)
        store.setAppLoaded(true)
        try {
          const status = await api.getAppStatus(appId) as any
          const deps = status?.deployments || {}
          const depValues = Array.isArray(deps) ? deps : Object.values(deps)

          // Surface the set of order-ready chain IDs so the chain selector
          // can restrict its options to where this App is actually deployed
          // (instead of every chain the validator knows about).
          const orderReadyChains = (depValues as any[])
            .filter((d) => d?.contract_address && ORDER_READY.has(d?.status))
            .map((d) => Number(d.chain_id))
            .filter((id) => Number.isFinite(id))
          const supported = Array.from(new Set(orderReadyChains))
          store.setAppSupportedChains(supported)
          console.log('[swap] app supported chains:', supported)

          // If the current chainId isn't in the supported set, snap to the
          // first supported one — otherwise the form sits with a chain the
          // app can't service.
          if (supported.length > 0 && !supported.includes(store.chainId)) {
            store.setChainId(supported[0])
            store.setSourceChainId(supported[0])
          }

          // Prefer a deployment on the (possibly newly-snapped) current chain;
          // fall back to the first order-ready deployment on any chain.
          const currentChainId = supported.includes(store.chainId)
            ? store.chainId
            : (supported[0] ?? store.chainId)
          const matching = (depValues as any[]).find(
            (d) => d?.contract_address && ORDER_READY.has(d?.status) && d?.chain_id === currentChainId,
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
