import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useSwapStore } from '../swap.store'
import { CHAIN_CONFIG, TOKENS } from '../swap.config'
import { shorten, copyToClipboard } from '../swap.utils'

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'text-yellow-300' },
  open: { label: 'Open', color: 'text-blue-300' },
  solved: { label: 'Solved', color: 'text-purple-300' },
  scored: { label: 'Scored', color: 'text-indigo-300' },
  consensus: { label: 'Consensus', color: 'text-cyan-300' },
  filled: { label: 'Filled', color: 'text-white font-bold' },
  rejected: { label: 'Rejected', color: 'text-red-300 font-bold' },
  failed: { label: 'Failed', color: 'text-red-300' },
  cancelled: { label: 'Cancelled', color: 'text-gray-300' },
}

export function OrderStatusCard() {
  const store = useSwapStore()
  const order = store.activeOrder!
  const statusInfo = STATUS_LABELS[order.status] || { label: order.status, color: 'text-white' }

  return (
    <div className="glass-border rounded-[var(--radius-card)] bg-[var(--bg-card)] backdrop-blur-[100px] p-6 w-full max-w-[560px]">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold font-display">Order Status</h3>
        <div className="flex items-center gap-2">
          {store.polling && <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />}
          <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
        </div>
      </div>

      {/* Status progression */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto">
        {['pending', 'open', 'solved', 'scored', 'consensus', 'filled'].map((step, idx) => {
          const steps = ['pending', 'open', 'solved', 'scored', 'consensus', 'filled']
          const currentIdx = steps.indexOf(order.status)
          const isActive = idx <= currentIdx
          const isCurrent = step === order.status
          return (
            <div key={step} className="flex items-center gap-1">
              <div className={`h-2 w-8 rounded-full ${isActive ? 'bg-[var(--accent-lime)]' : 'bg-white/10'} ${isCurrent ? 'animate-pulse' : ''}`} />
            </div>
          )
        })}
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-[var(--text-muted)]">Order ID</span>
          <div className="flex items-center gap-1">
            <a href={`/orders/${order.order_id}`} className="text-xs hover:text-[var(--accent-lime)] underline underline-offset-2">
              <code>{shorten(order.order_id, 8)}</code>
            </a>
            <button type="button" onClick={() => copyToClipboard(order.order_id)} className="p-1 hover:bg-white/10 rounded">
              <Copy className="h-3 w-3" />
            </button>
          </div>
        </div>
        {order.score != null && (
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Score</span>
            <span className="font-mono">{typeof order.score === 'number' ? order.score.toFixed(4) : order.score}</span>
          </div>
        )}
        {order.tx_hash && (
          <div className="flex justify-between">
            <span className="text-[var(--text-muted)]">Tx Hash</span>
            <div className="flex items-center gap-1">
              <code className="text-xs">{shorten(order.tx_hash.startsWith('0x') ? order.tx_hash : '0x' + order.tx_hash, 8)}</code>
              {CHAIN_CONFIG[store.chainId]?.explorer && (
                <a
                  href={`${CHAIN_CONFIG[store.chainId].explorer}/tx/${order.tx_hash.startsWith('0x') ? order.tx_hash : '0x' + order.tx_hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent-lime)]"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        )}
        {store.executionDetails && (() => {
          // Look up the actual output token from the execution, not the dropdown.
          // When the contract auto-unwraps WETH → native ETH, the on-chain
          // tokenOut is still WETH but the user received native ETH. Show
          // "ETH" (or the native symbol) when the user originally selected
          // the native token, even though the on-chain address is WETH.
          const solverToks = store.solverTokens[store.chainId] || []
          const fallbackToks = TOKENS[store.chainId] || []
          const allTokens = [...solverToks, ...fallbackToks]
          const outAddr = store.executionDetails!.tokenOut.toLowerCase()
          const userPickedNative = store.outputToken?.native === true
          const nativeToken = allTokens.find(t => t.native)
          const outToken = userPickedNative && nativeToken
            ? nativeToken
            : allTokens.find(t => t.address.toLowerCase() === outAddr) || store.outputToken
          const d = outToken?.decimals ?? 18
          const sym = outToken?.symbol ?? shorten(outAddr, 4)
          const fmt = (v: string) => (Number(v) / 10 ** d).toFixed(Math.min(d, 8))
          return (
            <>
              <div className="border-t border-white/10 my-2" />
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Output</span>
                <span className="font-mono">{fmt(store.executionDetails.amountOut)} {sym}</span>
              </div>
              {BigInt(store.executionDetails.surplus) > 0n && (
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Surplus</span>
                  <span className="font-mono text-green-400">+{fmt(store.executionDetails.surplus)} {sym}</span>
                </div>
              )}
              {BigInt(store.executionDetails.fee) > 0n && (
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Protocol Fee</span>
                  <span className="font-mono text-yellow-400">{fmt(store.executionDetails.fee)} {sym}</span>
                </div>
              )}
              {store.executionDetails.gasUsed && BigInt(store.executionDetails.gasUsed) > 0n && (
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Gas Used</span>
                  <span className="font-mono text-[var(--text-secondary)]">{Number(store.executionDetails.gasUsed).toLocaleString()}</span>
                </div>
              )}
            </>
          )
        })()}
      </div>
    </div>
  )
}
