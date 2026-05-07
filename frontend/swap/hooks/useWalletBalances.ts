import { useEffect } from 'react'
import { useSwapStore } from '../swap.store'
import type { Token } from '../swap.types'
import * as api from '@/api/client'

/**
 * Fetches input/output token balances whenever the active address, tokens, or chain changes.
 */
export function useWalletBalances() {
  const store = useSwapStore()

  useEffect(() => {
    const addr = store.getActiveAddress()
    if (!addr) {
      store.setInputBalance(null)
      store.setOutputBalance(null)
      return
    }

    let cancelled = false

    // Fetch input balance from source chain
    const inputChainId = store.isCrossChain ? store.sourceChainId : store.chainId
    const inputAddr = inputChainId === 0 && store.bittensorAddress ? store.bittensorAddress : addr

    api.getWalletBalances(inputAddr, inputChainId).then((res: any) => {
      if (cancelled) return
      const nativeBal = res.native?.balance_wei || res.eth_balance || '0'
      const tokenList: any[] = Array.isArray(res.tokens) ? res.tokens : Object.values(res.tokens || {})

      const getBalance = (token: Token | null): string | null => {
        if (!token) return null
        if (token.native) return nativeBal
        for (const info of tokenList) {
          if (info.symbol?.toUpperCase() === token.symbol.toUpperCase()) return info.balance_raw || info.balance || '0'
          if (info.address?.toLowerCase() === token.address.toLowerCase()) return info.balance_raw || info.balance || '0'
        }
        return '0'
      }

      store.setInputBalance(getBalance(store.inputToken))

      // For cross-chain, output balance comes from dest chain (or show null)
      if (store.isCrossChain) {
        store.setOutputBalance(null)  // Can't easily query dest chain balance
      } else {
        store.setOutputBalance(getBalance(store.outputToken))
      }
    }).catch(() => {
      // API might not have balances -- that's fine
    })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.walletAddress, store.managedWallet, store.inputToken, store.outputToken, store.chainId, store.walletMode, store.sourceChainId, store.bittensorAddress, store.bittensorConnected])
}
