import { Loader2, Lock, Unlock } from 'lucide-react'
import { useSwapStore } from '../swap.store'

export function ActionButton({
  onQuote,
  onSwap,
  onApprove,
  onConnect,
  hasMetaMask,
}: {
  onQuote: () => void
  onSwap: () => void
  onApprove: () => void
  onConnect: () => void
  hasMetaMask: boolean
}) {
  const store = useSwapStore()
  const activeAddress = store.getActiveAddress()
  const isReady = store.appLoaded && !!activeAddress
  const hasQuote = !!store.quote

  if (!isReady) {
    if (store.walletMode === 'external') {
      return (
        <button
          type="button"
          onClick={onConnect}
          disabled={!hasMetaMask}
          className="w-full bg-lime-gradient rounded-[var(--radius-component)] py-4 mt-2 text-btn-lg text-[var(--text-dark)] text-center hover-lift disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {hasMetaMask ? 'Connect Wallet' : 'Install MetaMask'}
        </button>
      )
    }
    return (
      <button
        type="button"
        disabled
        className="w-full bg-white/10 rounded-[var(--radius-component)] py-4 mt-2 text-btn-lg text-[var(--text-muted)] text-center cursor-not-allowed"
      >
        Create wallet above
      </button>
    )
  }

  if (!store.inputAmount || !store.inputToken || !store.outputToken) {
    return (
      <button type="button" disabled className="w-full bg-white/10 rounded-[var(--radius-component)] py-4 mt-2 text-btn-lg text-[var(--text-muted)] text-center cursor-not-allowed">
        Enter amount
      </button>
    )
  }

  if (store.loading && !hasQuote) {
    // Only show loading spinner for the initial quote fetch.
    // During refresh (hasQuote is true), keep showing Swap/Approve button.
    return (
      <button type="button" disabled className="w-full bg-white/10 rounded-[var(--radius-component)] py-4 mt-2 text-btn-lg text-[var(--text-muted)] text-center cursor-not-allowed flex items-center justify-center gap-2">
        <Loader2 className="h-5 w-5 animate-spin" /> Finding best price...
      </button>
    )
  }

  if (!hasQuote) {
    return (
      <button
        type="button"
        onClick={onQuote}
        className="w-full bg-lime-gradient rounded-[var(--radius-component)] py-4 mt-2 text-btn-lg text-[var(--text-dark)] text-center hover-lift"
      >
        Get Quote
      </button>
    )
  }

  // Approval needed — show Approve button with unlimited toggle
  if (store.needsApproval && store.walletMode === 'external') {
    return (
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={onApprove}
          disabled={store.approving}
          className="flex-1 bg-lime-gradient rounded-[var(--radius-component)] py-4 text-btn-lg text-[var(--text-dark)] text-center hover-lift disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {store.approving
            ? <><Loader2 className="h-5 w-5 animate-spin" /> Approving...</>
            : <><Lock className="h-5 w-5" /> Approve {store.inputToken?.symbol}</>
          }
        </button>
        <button
          type="button"
          onClick={() => {
            store.setUnlimitedApproval(!store.unlimitedApproval)
          }}
          title={store.unlimitedApproval ? 'Unlimited approval enabled' : 'Click to enable unlimited approval'}
          className={`px-4 rounded-[var(--radius-component)] py-4 text-sm border transition-colors ${
            store.unlimitedApproval
              ? 'bg-lime-gradient text-[var(--text-dark)] border-transparent'
              : 'bg-white/5 text-[var(--text-muted)] border-white/10 hover:border-white/20'
          }`}
        >
          <Unlock className="h-5 w-5" />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onSwap}
      disabled={store.submitting}
      className="w-full bg-lime-gradient rounded-[var(--radius-component)] py-4 mt-2 text-btn-lg text-[var(--text-dark)] text-center hover-lift disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {store.submitting ? 'Submitting...' : 'Swap'}
    </button>
  )
}
