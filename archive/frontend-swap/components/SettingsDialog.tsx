import { Settings } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { useSwapStore } from '../swap.store'

export function SettingsDialog() {
  const store = useSwapStore()

  return (
    <Dialog open={store.showSettings} onOpenChange={store.setShowSettings}>
      <DialogTrigger asChild>
        <button type="button" className="p-2 hover:bg-white/10 rounded-lg transition-colors duration-200">
          <Settings className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[var(--bg-card)] backdrop-blur-[100px] border border-white/[0.08]">
        <DialogHeader>
          <DialogTitle className="font-display">Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Slippage Tolerance</Label>
            <div className="flex items-center gap-2">
              {[50, 100, 200, 500].map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => store.setSlippageBps(bps)}
                  className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${store.slippageBps === bps ? 'bg-[var(--accent-lime)] text-[var(--text-dark)] font-semibold' : 'bg-white/5 hover:bg-white/10'}`}
                >
                  {bps / 100}%
                </button>
              ))}
              <Input
                type="number"
                value={store.slippageBps / 100}
                onChange={(e) => store.setSlippageBps(Math.round(parseFloat(e.target.value || '1') * 100))}
                className="w-20 bg-white/5 border-white/10 text-right"
                step="0.1"
                min="0.1"
                max="50"
              />
              <span className="text-sm text-[var(--text-muted)]">%</span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">Higher slippage = more likely to fill, but worse price protection</p>
          </div>
          <div className="space-y-2">
            <Label>App ID</Label>
            <Input
              value={store.appId}
              onChange={(e) => store.setAppId(e.target.value)}
              placeholder="Auto-detected from API"
              className="glass-border bg-[var(--bg-input-field)] border-0"
            />
            <p className="text-xs text-[var(--text-muted)]">Override the target App Intent ID</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Wallet Mode</Label>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {store.walletMode === 'managed' ? 'API creates & signs for you' : 'Sign with MetaMask'}
              </p>
            </div>
            <Switch
              checked={store.walletMode === 'managed'}
              onCheckedChange={(checked) => store.setWalletMode(checked ? 'managed' : 'external')}
            />
          </div>
          {store.walletMode === 'external' && (
            <div className="flex items-center justify-between">
              <div>
                <Label>Unlimited Approval</Label>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {store.unlimitedApproval ? 'Approve max uint256 (skip future approvals)' : 'Approve exact amount each swap'}
                </p>
              </div>
              <Switch
                checked={store.unlimitedApproval}
                onCheckedChange={(checked) => store.setUnlimitedApproval(checked)}
              />
            </div>
          )}
          <button
            type="button"
            onClick={() => store.setShowSettings(false)}
            className="w-full bg-lime-gradient rounded-[var(--radius-component)] py-3 text-btn text-[var(--text-dark)] text-center hover-lift"
          >
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
