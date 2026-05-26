import { useState } from 'react'
import { Check, ChevronDown, ArrowRightLeft } from 'lucide-react'
import { useSwapStore } from '../swap.store'
import { CHAIN_CONFIG, SUPPORTED_CHAIN_IDS } from '../swap.config'
import { BITTENSOR_CHAIN_ID } from '@/config/chains'

export function ChainSelector() {
  const store = useSwapStore()
  const [open, setOpen] = useState(false)
  const [showCrossChain, setShowCrossChain] = useState(store.isCrossChain)

  const currentChain = CHAIN_CONFIG[store.sourceChainId]
  const destChain = CHAIN_CONFIG[store.chainId]

  const selectChain = async (id: number) => {
    store.setSourceChainId(id)
    // Same-chain mode: sync destination to source
    if (!showCrossChain) {
      store.setChainId(id)
    }
    setOpen(false)

    // Prompt MetaMask to switch chain
    if (store.walletMode === 'external' && window.ethereum) {
      const hexMap: Record<number, string> = { 1: '0x1', 8453: '0x2105', 964: '0x3c4' }
      const hex = hexMap[id]
      if (hex) {
        try {
          await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] })
        } catch { /* user rejected or chain not added */ }
      }
    }
  }

  const selectDestChain = (id: number) => {
    store.setChainId(id)
    store.setShowDestNetworkSelector(false)
  }

  const toggleCrossChain = () => {
    const next = !showCrossChain
    setShowCrossChain(next)
    if (!next) {
      // Collapse: sync dest to source
      store.setChainId(store.sourceChainId)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Main chain selector */}
      <div className="relative flex-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-[var(--radius-inner)] bg-white/5 hover:bg-white/10 border border-white/[0.06] transition-colors text-sm"
        >
          <span className="text-lg">{currentChain?.icon || '\u27E0'}</span>
          <span className="flex-1 text-left font-medium">{currentChain?.name || 'Select Chain'}</span>
          <ChevronDown className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute top-full left-0 right-0 mt-1 glass-border rounded-lg bg-[var(--bg-card)] backdrop-blur-[100px] p-1 z-50 shadow-xl">
            {store.walletMode === 'bittensor' && store.bittensorConnected && (
              <button type="button" className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md hover:bg-white/5 text-sm transition-colors"
                onClick={() => { store.setSourceChainId(BITTENSOR_CHAIN_ID); if (!showCrossChain) store.setChainId(BITTENSOR_CHAIN_ID); setOpen(false) }}>
                <span className="text-lg">{CHAIN_CONFIG[BITTENSOR_CHAIN_ID]?.icon}</span>
                <span className="flex-1 text-left">Bittensor</span>
                {store.sourceChainId === BITTENSOR_CHAIN_ID && <Check className="h-4 w-4 text-[var(--accent-lime)]" />}
              </button>
            )}
            {SUPPORTED_CHAIN_IDS.map((id) => {
              const cfg = CHAIN_CONFIG[id]
              if (!cfg) return null
              const selected = store.sourceChainId === id
              return (
                <button
                  key={id}
                  type="button"
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm transition-colors ${selected ? 'bg-white/5' : 'hover:bg-white/5'}`}
                  onClick={() => selectChain(id)}
                >
                  <span className="text-lg">{cfg.icon}</span>
                  <span className="flex-1 text-left">{cfg.name}</span>
                  {selected && <Check className="h-4 w-4 text-[var(--accent-lime)]" />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Cross-chain toggle */}
      <button
        type="button"
        onClick={toggleCrossChain}
        title={showCrossChain ? 'Switch to same-chain' : 'Enable cross-chain swap'}
        className={`p-2.5 rounded-[var(--radius-inner)] border transition-colors ${
          showCrossChain
            ? 'bg-[var(--accent-lime)]/10 border-[var(--accent-lime)]/30 text-[var(--accent-lime)]'
            : 'bg-white/5 border-white/[0.06] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-white/10'
        }`}
      >
        <ArrowRightLeft className="h-4 w-4" />
      </button>

      {/* Destination chain (only visible in cross-chain mode) */}
      {showCrossChain && (
        <div className="relative flex-1">
          <button
            type="button"
            onClick={() => store.setShowDestNetworkSelector(!store.showDestNetworkSelector)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 rounded-[var(--radius-inner)] bg-white/5 hover:bg-white/10 border border-[var(--accent-lime)]/20 transition-colors text-sm"
          >
            <span className="text-lg">{destChain?.icon || '\u27E0'}</span>
            <span className="flex-1 text-left font-medium">{destChain?.name || 'Destination'}</span>
            <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
          </button>
          {store.showDestNetworkSelector && (
            <div className="absolute top-full left-0 right-0 mt-1 glass-border rounded-lg bg-[var(--bg-card)] backdrop-blur-[100px] p-1 z-50 shadow-xl">
              {store.walletMode === 'bittensor' && store.bittensorConnected && (
                <button type="button" className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md hover:bg-white/5 text-sm transition-colors"
                  onClick={() => selectDestChain(BITTENSOR_CHAIN_ID)}>
                  <span className="text-lg">{CHAIN_CONFIG[BITTENSOR_CHAIN_ID]?.icon}</span>
                  <span className="flex-1 text-left">Bittensor</span>
                  {store.chainId === BITTENSOR_CHAIN_ID && <Check className="h-4 w-4 text-[var(--accent-lime)]" />}
                </button>
              )}
              {SUPPORTED_CHAIN_IDS.filter(id => id !== store.sourceChainId).map((id) => {
                const cfg = CHAIN_CONFIG[id]
                if (!cfg) return null
                return (
                  <button
                    key={id}
                    type="button"
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm transition-colors ${store.chainId === id ? 'bg-white/5' : 'hover:bg-white/5'}`}
                    onClick={() => selectDestChain(id)}
                  >
                    <span className="text-lg">{cfg.icon}</span>
                    <span className="flex-1 text-left">{cfg.name}</span>
                    {store.chainId === id && <Check className="h-4 w-4 text-[var(--accent-lime)]" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
