import { useCallback } from 'react'
import { AlertTriangle, Wallet, ExternalLink } from 'lucide-react'
import { useSwapStore } from '../swap.store'
import { CHAIN_CONFIG } from '../swap.config'
import { shorten } from '../swap.utils'

const CHAIN_HEX: Record<number, string> = {
  1: '0x1',
  8453: '0x2105',
  964: '0x3c4',
}

export function WalletStatusBar() {
  const store = useSwapStore()
  const activeAddress = store.getActiveAddress()
  const appChainId = store.sourceChainId
  const walletChainId = store.walletChainId

  const switchChain = useCallback(async () => {
    if (!window.ethereum) return
    const hex = CHAIN_HEX[appChainId]
    if (!hex) return
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: hex }],
      })
    } catch (e: any) {
      if (e.code === 4902) {
        const chainData: Record<number, object> = {
          964: {
            chainId: '0x3c4',
            chainName: 'Bittensor EVM',
            nativeCurrency: { name: 'TAO', symbol: 'TAO', decimals: 18 },
            rpcUrls: ['https://lite.chain.opentensor.ai'],
            blockExplorerUrls: ['https://evm.taostats.io'],
          },
        }
        if (chainData[appChainId]) {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [chainData[appChainId]],
          })
        }
      }
    }
  }, [appChainId])

  // Early return AFTER all hooks
  if (store.walletMode !== 'external' || !activeAddress) return null

  const chainMismatch = walletChainId !== null && walletChainId !== appChainId
  const appChain = CHAIN_CONFIG[appChainId]
  const walletChain = walletChainId ? CHAIN_CONFIG[walletChainId] : null
  const explorerUrl = appChain?.explorer
    ? `${appChain.explorer}/address/${activeAddress}`
    : null

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-inner)] bg-white/[0.03] border border-white/[0.06]">
      <Wallet className="h-3.5 w-3.5 text-[var(--text-muted)]" />

      <span className="font-mono text-sm text-[var(--text-secondary)]">
        {shorten(activeAddress, 4)}
      </span>

      {explorerUrl && (
        <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      <div className="flex-1" />

      {chainMismatch ? (
        <button
          onClick={switchChain}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs hover:bg-yellow-500/20 transition-colors"
        >
          <AlertTriangle className="h-3 w-3" />
          <span>Switch to {appChain?.shortName || appChain?.name}</span>
        </button>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          {walletChain?.name || appChain?.name || `Chain ${walletChainId}`}
        </span>
      )}
    </div>
  )
}
