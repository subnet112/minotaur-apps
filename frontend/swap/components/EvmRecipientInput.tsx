import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { useSwapStore } from '../swap.store'
import { BITTENSOR_CHAIN_ID } from '@/config/chains'
import { shorten } from '../swap.utils'

export function EvmRecipientInput() {
  const store = useSwapStore()

  // Only show for cross-chain BT -> EVM
  if (!(store.isCrossChain && store.sourceChainId === BITTENSOR_CHAIN_ID && store.chainId !== BITTENSOR_CHAIN_ID)) {
    return null
  }

  return (
    <div className="glass-border rounded-[var(--radius-inner)] bg-[var(--bg-input-field)] p-3 space-y-2">
      <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Receive on EVM</div>
      {store.evmRecipient ? (
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          <code className="text-sm flex-1">{shorten(store.evmRecipient, 8)}</code>
          <span className="text-[10px] text-[var(--text-muted)]">{store.evmRecipientSource}</span>
          <button type="button" onClick={() => store.setEvmRecipient('', 'manual')} className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">change</button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-[var(--text-muted)]">Where should the output tokens be sent?</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!window.ethereum) { toast.error('MetaMask not found'); return }
                try {
                  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[]
                  if (accounts.length > 0) {
                    store.setEvmRecipient(accounts[0], 'metamask')
                    toast.success(`MetaMask: ${shorten(accounts[0], 6)}`)
                  }
                } catch { toast.error('MetaMask connection rejected') }
              }}
              className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs transition-colors"
            >
              <ExternalLink className="h-3 w-3 inline mr-1" />MetaMask
            </button>
            <button
              type="button"
              onClick={() => {
                const addr = prompt('Enter EVM address (0x...):')
                if (addr && addr.startsWith('0x') && addr.length === 42) {
                  store.setEvmRecipient(addr, 'manual')
                } else if (addr) {
                  toast.error('Invalid EVM address')
                }
              }}
              className="flex-1 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs transition-colors"
            >
              Paste Address
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
