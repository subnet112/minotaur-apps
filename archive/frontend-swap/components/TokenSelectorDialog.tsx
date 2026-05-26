import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useSwapStore } from '../swap.store'
import { shorten } from '../swap.utils'
import type { Token } from '../swap.types'

export function TokenSelectorDialog({ tokens }: { tokens: Token[] }) {
  const store = useSwapStore()
  const [search, setSearch] = useState('')
  const [customLoading, setCustomLoading] = useState(false)

  const filtered = tokens.filter((t) => {
    if (!search) return true
    const q = search.toLowerCase()
    return t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase().includes(q)
  })

  // Check if search looks like an address (0x...)
  const isAddress = search.startsWith('0x') && search.length >= 10
  const addressNotInList = isAddress && !tokens.some(t => t.address.toLowerCase() === search.toLowerCase())

  const addCustomToken = async () => {
    if (!isAddress) return
    setCustomLoading(true)
    try {
      const { ethers } = await import('ethers')
      const provider = new ethers.BrowserProvider(window.ethereum!)
      const erc20 = new ethers.Contract(search, [
        'function symbol() view returns (string)',
        'function decimals() view returns (uint8)',
        'function name() view returns (string)',
      ], provider)
      const [symbol, decimals, name] = await Promise.all([
        erc20.symbol().catch(() => search.slice(0, 8) + '...'),
        erc20.decimals().catch(() => 18),
        erc20.name().catch(() => ''),
      ])
      const custom: Token = {
        symbol,
        name: name || symbol,
        address: ethers.getAddress(search),
        decimals: Number(decimals),
        icon: symbol[0] || '?',
      }
      if (store.tokenSelectorOpen === 'input') store.setInputToken(custom)
      else store.setOutputToken(custom)
      store.setTokenSelectorOpen(null)
      setSearch('')
      toast.success(`Added ${symbol}`)
    } catch (e) {
      toast.error('Failed to load token \u2014 check the address')
    } finally {
      setCustomLoading(false)
    }
  }

  return (
    <Dialog open={!!store.tokenSelectorOpen} onOpenChange={(open) => { if (!open) { store.setTokenSelectorOpen(null); setSearch('') } }}>
      <DialogContent className="bg-[var(--bg-card)] backdrop-blur-[100px] border border-white/[0.08]">
        <DialogHeader>
          <DialogTitle className="font-display">Select a token</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Search by name or paste address (0x...)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-2 bg-white/5 border-white/10"
        />
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {filtered.map((token) => {
            const isSelected = store.tokenSelectorOpen === 'input'
              ? store.inputToken?.address === token.address
              : store.outputToken?.address === token.address
            const isDisabled = store.tokenSelectorOpen === 'input'
              ? store.outputToken?.address === token.address
              : store.inputToken?.address === token.address

            return (
              <button
                key={token.address}
                type="button"
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/5 transition-colors duration-200 ${isSelected ? 'bg-white/10' : ''} ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                onClick={() => {
                  if (isDisabled) return
                  if (store.tokenSelectorOpen === 'input') store.setInputToken(token)
                  else store.setOutputToken(token)
                  store.setTokenSelectorOpen(null)
                  setSearch('')
                }}
                disabled={isDisabled}
              >
                <span className="text-2xl w-8 h-8 flex items-center justify-center rounded-full">{token.icon}</span>
                <div className="flex flex-col items-start flex-1">
                  <span className="text-base font-normal">{token.symbol}</span>
                  <span className="text-xs text-[var(--text-muted)]">{token.name}</span>
                </div>
                {isSelected && <Check className="h-5 w-5 text-[var(--accent-lime)]" />}
              </button>
            )
          })}
          {filtered.length === 0 && !addressNotInList && (
            <p className="text-center text-[var(--text-muted)] py-4 text-sm">No tokens found</p>
          )}
          {addressNotInList && (
            <button
              type="button"
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
              onClick={addCustomToken}
              disabled={customLoading}
            >
              {customLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <span className="text-2xl w-8 h-8 flex items-center justify-center rounded-full bg-white/10">+</span>
              )}
              <div className="flex flex-col items-start flex-1">
                <span className="text-sm font-normal">Use custom token</span>
                <span className="text-xs text-[var(--text-muted)]">{shorten(search, 8)}</span>
              </div>
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
