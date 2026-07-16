import { useEffect } from 'react'
import { useSwapStore } from '../store'
import { useToast } from '@/components/shell'
import type { Token } from '../types'
import * as api from '@/api/client'

/**
 * Fetches input/output token balances whenever the active address, tokens, or chain changes.
 */
export function useWalletBalances() {
  const store = useSwapStore()
  const toast = useToast()

  useEffect(() => {
    const addr = store.getActiveAddress()
    if (!addr) {
      store.setInputBalance(null)
      store.setOutputBalance(null)
      return
    }

    // F7: AbortController per effect run
    const controller = new AbortController()
    const { signal } = controller

    // F14: Force chain_id=0 for bittensor wallets.
    // chain_id=0 routes to substrate path; 964 routes to EVM RPC. Force 0 for SS58 wallets.
    let inputChainId = store.isCrossChain ? store.sourceChainId : store.chainId
    if (store.walletMode === 'bittensor') inputChainId = 0

    const inputAddr = inputChainId === 0 && store.bittensorAddress ? store.bittensorAddress : addr

    api.getWalletBalances(inputAddr, inputChainId, signal).then((res: any) => {
      if (signal.aborted) return
      // Prefer the human-readable `balance` (e.g. "953.860753") over the raw
      // integer (`balance_wei` / `balance_raw`). The UI renders this string
      // verbatim — using the raw integer shows "953860753 USDC" instead of
      // "953.860753 USDC". API returns both fields per chain.
      const nativeBal = res.native?.balance ?? res.eth_balance ?? '0'
      const tokenList: any[] = Array.isArray(res.tokens) ? res.tokens : Object.values(res.tokens || {})

      const getBalance = (token: Token | null): string | null => {
        if (!token) return null
        if (token.native) return nativeBal
        for (const info of tokenList) {
          if (info.symbol?.toUpperCase() === token.symbol.toUpperCase()) return info.balance ?? info.balance_raw ?? '0'
          if (info.address?.toLowerCase() === token.address.toLowerCase()) return info.balance ?? info.balance_raw ?? '0'
        }
        return '0'
      }

      store.setInputBalance(getBalance(store.inputToken))

      if (store.isCrossChain) {
        // F15-out: fetch output balance from destination chain instead of nulling it
        // F14: Force chain_id=0 on the output side when walletMode is bittensor
        // chain_id=0 routes to substrate path; 964 routes to EVM RPC. Force 0 for SS58 wallets.
        let outputChainId = store.chainId
        if (store.walletMode === 'bittensor') outputChainId = 0
        const outputAddr = store.chainId === 0 ? store.bittensorAddress : store.walletAddress

        if (outputAddr) {
          api.getWalletBalances(outputAddr, outputChainId, signal).then((outRes: any) => {
            if (signal.aborted) return
            const outNativeBal = outRes.native?.balance ?? outRes.eth_balance ?? '0'
            const outTokenList: any[] = Array.isArray(outRes.tokens) ? outRes.tokens : Object.values(outRes.tokens || {})

            const getOutBalance = (token: Token | null): string | null => {
              if (!token) return null
              if (token.native) return outNativeBal
              for (const info of outTokenList) {
                if (info.symbol?.toUpperCase() === token.symbol.toUpperCase()) return info.balance ?? info.balance_raw ?? '0'
                if (info.address?.toLowerCase() === token.address.toLowerCase()) return info.balance ?? info.balance_raw ?? '0'
              }
              return '0'
            }

            store.setOutputBalance(getOutBalance(store.outputToken))
          }).catch((err: Error) => {
            if (signal.aborted) return
            store.setError(err.message)
            toast.error({ title: 'Balance unavailable', message: err.message })
          })
        } else {
          store.setOutputBalance(null)
        }
      } else {
        store.setOutputBalance(getBalance(store.outputToken))
      }
    }).catch((err: Error) => {
      if (signal.aborted) return
      store.setError(err.message)
      toast.error({ title: 'Balance unavailable', message: err.message })
    })

    // F7: Abort in-flight fetch on cleanup
    return () => { controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.walletAddress, store.inputToken, store.outputToken, store.chainId, store.walletMode, store.sourceChainId, store.isCrossChain, store.bittensorAddress, store.bittensorConnected])
}
