import { useEffect, useCallback, useRef } from 'react'
import { useSwapStore } from '../store'
import { useToast } from '@/components/shell'
import { BITTENSOR_CHAIN_ID } from '@/config/chains'
import { parseAmount } from '../utils'
import * as api from '@/api/client'

/**
 * Quote fetching hook: handles EVM quotes, Bittensor same-chain sim_swap,
 * and Bittensor cross-chain synthetic quotes. Also auto-fetches on input changes.
 */
export function useQuoteRequest() {
  const store = useSwapStore()
  const toast = useToast()
  // F8: version counter — ignores stale responses when inputs change mid-flight
  const versionRef = useRef<number>(0)

  const requestQuote = useCallback(async () => {
    const addr = store.getActiveAddress()
    if (!store.inputToken || !store.outputToken || !store.inputAmount || !addr || !store.appId) return

    store.setLoading(true)
    store.setError(null)
    // Don't clear the old quote — keep it visible while the new one loads.
    // This prevents layout shift during quote refresh.

    // F8: increment version and capture local snapshot
    const myVersion = ++versionRef.current

    // F7: AbortController for this invocation
    const controller = new AbortController()
    const { signal } = controller

    try {
      const inputAmountWei = parseAmount(store.inputAmount, store.inputToken.decimals)

      // Format tokens as CAIP-10 interop addresses: eip155:chainId:0xaddress
      const inputAddr = store.inputToken.native ? 'WETH' : store.inputToken.address
      const outputAddr = store.outputToken.native
        ? (store.chainId === 964 ? '0x9Dc08C6e2BF0F1eeD1E00670f80Df39145529F81' : 'WETH')
        : store.outputToken.address

      const inputInterop = inputAddr.startsWith('0x')
        ? `eip155:${store.sourceChainId}:${inputAddr}` : inputAddr
      const outputInterop = outputAddr.startsWith('0x')
        ? `eip155:${store.chainId}:${outputAddr}` : outputAddr

      const params: Record<string, unknown> = {
        input_token: inputInterop,
        output_token: outputInterop,
        input_amount: inputAmountWei,
      }

      // Bittensor source: inject substrate-specific params
      if (store.sourceChainId === BITTENSOR_CHAIN_ID && store.bittensorConnected) {
        const alphaMatch = store.inputToken.address.match(/^alpha:(\d+)$/)
        const outputAlphaMatch = store.outputToken?.address.match(/^alpha:(\d+)$/)

        if (store.chainId === BITTENSOR_CHAIN_ID) {
          // Same-chain Bittensor swap (TAO <-> Alpha) -- use sim_swap for real rate
          const action = alphaMatch ? 'remove_stake' : 'add_stake'
          const netuid = alphaMatch ? alphaMatch[1] : outputAlphaMatch?.[1] || '0'
          const originNetuid = alphaMatch ? parseInt(alphaMatch[1]) : 0
          const destNetuid = alphaMatch ? 0 : parseInt(netuid)

          // Get real exchange rate from sim_swap
          let estimatedOutput = inputAmountWei
          try {
            console.log('[BT] sim_swap request:', { origin_netuid: originNetuid, destination_netuid: destNetuid, amount_rao: parseInt(inputAmountWei) })
            const simRes = await fetch('/api/v1/native-bittensor/sim-swap', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal,
              body: JSON.stringify({
                origin_netuid: originNetuid,
                destination_netuid: destNetuid,
                amount_rao: parseInt(inputAmountWei),
              }),
            })
            const sim = await simRes.json()
            console.log('[BT] sim_swap response:', sim)
            if (!sim.error) {
              estimatedOutput = String(destNetuid === 0 ? sim.tao_amount : sim.alpha_amount)
              console.log('[BT] estimatedOutput:', estimatedOutput)
            }
          } catch (e) { console.error('[BT] sim_swap failed:', e) }

          // F8: skip stale response
          if (versionRef.current !== myVersion) return

          store.setQuote({
            app_id: store.appId,
            estimated_output: estimatedOutput,
            suggested_min_output: '0',
            slippage_bps: 0,
            route_summary: `${action} on SN${netuid} (Bittensor AMM)`,
            gas_estimate: 0,
            valid_for_seconds: 300,
            chain_id: 0,
            intent_function: action,
            computed_params: {},
            ready_params: {
              action,
              owner_ss58: store.bittensorAddress,
              hotkey_ss58: store.bittensorAddress,
              netuid: parseInt(netuid),
              amount_rao: parseInt(inputAmountWei),
            },
          } as any)
          return
        } else {
          // Cross-chain: Bittensor -> EVM
          if (alphaMatch) {
            const evmAddr = store.evmRecipient
            if (!evmAddr) {
              store.setError('Connect MetaMask or paste an EVM address for the destination')
              return
            }

            // F8: skip stale response
            if (versionRef.current !== myVersion) return

            store.setQuote({
              app_id: store.appId,
              estimated_output: '0',
              suggested_min_output: '0',
              slippage_bps: 50,
              route_summary: `Alpha (SN${alphaMatch[1]}) → unstake → bridge → ${store.outputToken?.symbol || 'EVM token'}`,
              gas_estimate: 0,
              valid_for_seconds: 300,
              chain_id: store.chainId,
              intent_function: 'swap',
              computed_params: {},
              ready_params: {
                alpha_netuid: alphaMatch[1],
                owner_ss58: store.bittensorAddress,
                hotkey_ss58: store.bittensorAddress,
                alpha_amount_rao: inputAmountWei,
                output_token: store.outputToken?.address || '',
                min_output_amount: '1',
                dest_chain_id: String(store.chainId),
                recipient: evmAddr,
              },
            } as any)
            return
          } else if (store.inputToken.native) {
            // TAO -> EVM token: use wTAO address for the quote
            params.input_token = '0x77E06c9eCCf2E797fd462A92B6D7642EF85b0A44'
            params.input_amount = inputAmountWei
          }
        }
      }

      // Single quote path: CAIP-10 tokens carry chain context.
      const quoteChainId = store.isCrossChain ? store.sourceChainId : store.chainId
      const quote = await api.getQuote(store.appId, params, {
        intentFunction: 'swap',
        chainId: quoteChainId,
        slippageBps: store.slippageBps,
        signal,
      })

      // F8: discard if a newer request has been issued
      if (versionRef.current !== myVersion) return

      console.log('[swap] raw quote response:', JSON.stringify(quote))
      store.setQuote(quote)
    } catch (e) {
      if (signal.aborted) return
      const msg = (e as Error).message
      store.setError(msg)
      toast.error({ title: 'Quote unavailable', message: msg })
    } finally {
      store.setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.inputToken, store.outputToken, store.inputAmount, store.appId, store.chainId, store.walletAddress])

  // Auto-fetch quote when inputs change
  useEffect(() => {
    store.clearQuote()
    store.setActiveOrder(null)

    const addr = store.getActiveAddress()
    if (!store.inputToken || !store.outputToken || !store.inputAmount || !addr || !store.appId) return

    const numAmount = parseFloat(store.inputAmount)
    if (isNaN(numAmount) || numAmount <= 0) return

    // F7: AbortController for the debounced window; clears on re-render before timeout fires
    const controller = new AbortController()
    const timeoutId = setTimeout(() => { requestQuote() }, 600)
    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.inputToken, store.outputToken, store.inputAmount, store.walletAddress, store.chainId, store.appId])

  return { requestQuote }
}
