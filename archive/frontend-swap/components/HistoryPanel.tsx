import { Copy } from 'lucide-react'
import { useSwapStore } from '../swap.store'
import { CHAIN_CONFIG } from '../swap.config'
import { shorten, copyToClipboard } from '../swap.utils'

export function HistoryPanel() {
  const store = useSwapStore()

  return (
    <div className="glass-border rounded-[var(--radius-card)] bg-[var(--bg-card)] backdrop-blur-[100px] p-6 w-full max-w-[560px]">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-base font-semibold font-display">Recent Swaps</h3>
        {store.recentSwaps.length > 0 && (
          <button type="button" onClick={store.clearHistory} className="text-sm text-destructive hover:underline">Clear</button>
        )}
      </div>
      {store.recentSwaps.length === 0 ? (
        <p className="text-center text-[var(--text-muted)] py-4">No swaps yet</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {store.recentSwaps.map((swap, idx) => (
            <div key={swap.orderId || idx} className="p-4 rounded-[var(--radius-inner)] bg-white/5">
              <div className="flex justify-between items-center mb-1">
                <span className="font-medium">
                  {swap.inputAmount} {swap.inputToken} &rarr; {swap.outputAmount} {swap.outputToken}
                </span>
                <span className="text-lg">{CHAIN_CONFIG[swap.chainId]?.icon}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span>{new Date(swap.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <code className="bg-[var(--accent-lime)]/10 text-[var(--accent-lime)] px-1.5 py-0.5 rounded">{shorten(swap.orderId, 6)}</code>
                <button type="button" onClick={() => copyToClipboard(swap.orderId)} className="p-1 hover:bg-white/10 rounded transition-colors duration-200">
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
