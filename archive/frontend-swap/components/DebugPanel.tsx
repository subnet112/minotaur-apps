import { useSwapStore } from '../swap.store'
import { shorten } from '../swap.utils'

export function DebugPanel() {
  const store = useSwapStore()

  return (
    <div className="glass-border rounded-[var(--radius-card)] bg-[var(--bg-card)] backdrop-blur-[100px] p-6 w-full max-w-[560px]">
      <h3 className="text-base font-semibold font-display mb-4">Debug Info</h3>
      <div className="space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[var(--text-muted)]">App ID:</span>
            <div className="font-mono break-all">{store.appId || '\u2014'}</div>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Chain ID:</span>
            <div className="font-mono">{store.chainId}</div>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Wallet Mode:</span>
            <div>{store.walletMode}</div>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Active Address:</span>
            <div className="font-mono break-all">{shorten(store.getActiveAddress(), 8) || '\u2014'}</div>
          </div>
        </div>
        {store.quote && (
          <details className="border-t border-white/10 pt-3">
            <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)]">Quote JSON</summary>
            <pre className="mt-2 p-2 bg-white/5 rounded-[var(--radius-inner)] text-[10px] overflow-x-auto max-h-40">
              {JSON.stringify(store.quote, null, 2)}
            </pre>
          </details>
        )}
        {store.activeOrder && (
          <details className="border-t border-white/10 pt-3">
            <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)]">Order JSON</summary>
            <pre className="mt-2 p-2 bg-white/5 rounded-[var(--radius-inner)] text-[10px] overflow-x-auto max-h-40">
              {JSON.stringify(store.activeOrder, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}
