import { Wallet, ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useSwapStore } from '../swap.store'
import { shorten } from '../swap.utils'

export function WalletSetupSection({
  createManagedWallet,
  fundManagedWallet,
  connectBittensorWallet,
  setupBittensorProxy,
}: {
  createManagedWallet: () => void
  fundManagedWallet: () => void
  connectBittensorWallet: () => void
  setupBittensorProxy: () => void
}) {
  const store = useSwapStore()

  return (
    <>
      {/* Wallet Mode Toggle */}
      <div className="flex gap-0 bg-white/5 rounded-[var(--radius-inner)] p-1">
        <button
          type="button"
          onClick={() => store.setWalletMode('managed')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-[var(--radius-inner)] text-[14px] font-normal transition-colors duration-200 ${
            store.walletMode === 'managed'
              ? 'bg-lime-gradient text-[var(--text-dark)]'
              : 'text-[var(--text-primary)] hover:bg-white/5'
          }`}
        >
          <Wallet className="h-4 w-4" /> Managed
        </button>
        <button
          type="button"
          onClick={() => store.setWalletMode('external')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-[var(--radius-inner)] text-[14px] font-normal transition-colors duration-200 ${
            store.walletMode === 'external'
              ? 'bg-lime-gradient text-[var(--text-dark)]'
              : 'text-[var(--text-primary)] hover:bg-white/5'
          }`}
        >
          <ExternalLink className="h-4 w-4" /> MetaMask
        </button>
        <button
          type="button"
          onClick={() => store.setWalletMode('bittensor')}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-[var(--radius-inner)] text-[14px] font-normal transition-colors duration-200 ${
            store.walletMode === 'bittensor'
              ? 'bg-lime-gradient text-[var(--text-dark)]'
              : 'text-[var(--text-primary)] hover:bg-white/5'
          }`}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none"/></svg>
          Bittensor
        </button>
      </div>

      {/* Managed Wallet Setup */}
      {store.walletMode === 'managed' && !store.managedWallet && (
        <div className="glass-border rounded-[var(--radius-inner)] bg-[var(--bg-input-field)] p-4 space-y-3 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            Create a managed wallet to swap without MetaMask. Auto-signs orders.
          </p>
          <button
            type="button"
            onClick={createManagedWallet}
            disabled={store.loading}
            className="w-full bg-lime-gradient rounded-[var(--radius-component)] py-3 text-btn text-[var(--text-dark)] text-center hover-lift disabled:opacity-50"
          >
            {store.loading ? 'Creating...' : 'Create Wallet'}
          </button>
        </div>
      )}

      {/* Managed Wallet Info */}
      {store.walletMode === 'managed' && store.managedWallet && (
        <div className="glass-border rounded-[var(--radius-inner)] bg-[var(--bg-input-field)] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <code className="text-sm">{shorten(store.managedWallet.address, 6)}</code>
            </div>
            <button
              type="button"
              onClick={fundManagedWallet}
              disabled={store.loading}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 transition-colors"
            >
              {store.loading ? 'Funding...' : 'Fund (Testnet)'}
            </button>
          </div>
        </div>
      )}

      {/* Bittensor Wallet Setup */}
      {store.walletMode === 'bittensor' && !store.bittensorConnected && (
        <div className="glass-border rounded-[var(--radius-inner)] bg-[var(--bg-input-field)] p-4 space-y-3 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            Connect your Bittensor wallet to swap Alpha tokens and TAO.
            Requires Polkadot.js, Talisman, or SubWallet browser extension.
          </p>
          <button
            type="button"
            onClick={connectBittensorWallet}
            disabled={store.loading}
            className="w-full bg-lime-gradient rounded-[var(--radius-component)] py-3 text-btn text-[var(--text-dark)] text-center hover-lift disabled:opacity-50"
          >
            {store.loading ? 'Connecting...' : 'Connect Bittensor Wallet'}
          </button>
        </div>
      )}

      {/* Bittensor Wallet Connected -- Proxy Setup */}
      {store.walletMode === 'bittensor' && store.bittensorConnected && !store.bittensorProxySetup && (
        <div className="glass-border rounded-[var(--radius-inner)] bg-[var(--bg-input-field)] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400" />
            <code className="text-sm">{shorten(store.bittensorAddress, 8)}</code>
            <Badge variant="outline" className="text-xs ml-auto">Bittensor</Badge>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            One-time setup: authorize Minotaur to unstake and bridge on your behalf.
            This creates a proxy delegation on the Bittensor chain.
          </p>
          <button
            type="button"
            onClick={setupBittensorProxy}
            disabled={store.loading}
            className="w-full bg-lime-gradient rounded-[var(--radius-component)] py-3 text-btn text-[var(--text-dark)] text-center hover-lift disabled:opacity-50"
          >
            {store.loading ? 'Setting up...' : 'Authorize Proxy Delegation'}
          </button>
        </div>
      )}

      {/* Bittensor Wallet Ready */}
      {store.walletMode === 'bittensor' && store.bittensorConnected && store.bittensorProxySetup && (
        <div className="glass-border rounded-[var(--radius-inner)] bg-[var(--bg-input-field)] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <code className="text-sm">{shorten(store.bittensorAddress, 8)}</code>
              <Badge variant="outline" className="text-xs">Bittensor</Badge>
            </div>
            <span className="text-xs text-green-400">Proxy Active</span>
          </div>
        </div>
      )}
    </>
  )
}
