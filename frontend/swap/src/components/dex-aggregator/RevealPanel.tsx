/**
 * RevealPanel — 00.23 Inline reveal panel.
 *
 * Two role flavours under one chrome:
 *   - 'history' → Recent Swaps (list of past swap rows from store)
 *   - 'debug'   → Debug Info (4-field grid + Quote JSON / Order JSON disclosures)
 *
 * Lifted markup mirrors components.html section 00.23 (line 8635 + 8801).
 */
import { useState } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
import { useSwapStore } from '@/store'
import { useToast } from '@/components/shell/ToastViewport'
import { CHAIN_CONFIG } from '@/config/chains'
import { TERMINAL_FILLED, TERMINAL_FAILED } from '@/lib/orderStatus'
import type { DesignWalletMode, SwapHistoryItem } from '@/types'

type PanelRole = 'history' | 'debug'

interface RevealPanelProps {
  role: PanelRole
  /** Affects debug grid values (wallet mode display, active address). */
  wallet: DesignWalletMode
  onClose: () => void
}

export default function RevealPanel({ role, wallet, onClose }: RevealPanelProps) {
  return (
    <section className="app-rpanel" aria-label={role === 'history' ? 'Recent swaps' : 'Debug info'}>
      <BracketCorners />

      <div className="app-rpanel-head">
        <span className="eyebrow">
          <span className="glyph" aria-hidden="true" />
          <span>{role === 'history' ? 'Recent swaps' : 'Debug info'}</span>
          {role === 'history' && <HistoryCount />}
        </span>
        <span className="ln" aria-hidden="true" />
        {role === 'history' && <ClearHistoryButton />}
        <button className="x" type="button" aria-label="Close panel" onClick={onClose}>
          <DismissGlyph />
        </button>
      </div>

      <div className="app-rpanel-body">
        {role === 'history' ? <HistoryBody /> : <DebugBody wallet={wallet} />}
      </div>
    </section>
  )
}

/** Clear all history button — only renders when recentSwaps is non-empty. */
function ClearHistoryButton() {
  const count = useSwapStore((s) => s.recentSwaps.length)
  const toast = useToast()

  if (count === 0) return null

  function handleClear() {
    useSwapStore.getState().clearHistory()
    toast.transient({ title: 'History cleared' })
  }

  return (
    <button
      className="app-rpanel-clear"
      type="button"
      aria-label="Clear swap history"
      onClick={handleClear}
    >
      Clear
    </button>
  )
}

/** Count badge — reads recentSwaps.length from store reactively. */
function HistoryCount() {
  const count = useSwapStore((s) => s.recentSwaps.length)
  return (
    <span className="ct-count">{String(count).padStart(2, '0')}&nbsp;TOTAL</span>
  )
}

/** Map SwapHistoryItem.status → design badge modifier.
 *  Pulls the failure set from @/lib/orderStatus so rejected / expired /
 *  bridge_failed / rolled_back / partial_rollback show as failed instead
 *  of forever-pending. */
function statusToBadge(status: string): 'confirmed' | 'pending' | 'failed' {
  if (TERMINAL_FILLED.has(status)) return 'confirmed'
  if (TERMINAL_FAILED.has(status)) return 'failed'
  return 'pending'
}

/** Format a unix ms timestamp to a short relative label (e.g. "2h ago"). */
function timeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDy = Math.floor(diffHr / 24)
  return `${diffDy}d ago`
}

/** Truncate a hex hash to first 4 + last 4 chars for display. */
function truncateHash(hash: string): string {
  if (!hash || hash.length <= 10) return hash
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

function HistoryBody() {
  const recentSwaps = useSwapStore((s) => s.recentSwaps)
  const toast = useToast()

  if (recentSwaps.length === 0) {
    return (
      <>
        <p className="app-rpanel-empty-title">No swaps yet.</p>
        <p className="app-rpanel-empty-msg">Past swaps for this wallet will appear here</p>
      </>
    )
  }

  function handleCopyHash(swap: SwapHistoryItem) {
    const hash = swap.txHash || swap.orderId
    navigator.clipboard.writeText(hash).then(() => {
      toast.transient({ title: `Hash copied · ${truncateHash(hash)}` })
    }).catch(() => {
      toast.error({ title: 'Copy failed' })
    })
  }

  return (
    <>
      {recentSwaps.map((swap) => {
        const badge = statusToBadge(swap.status)
        const explorerUrl = CHAIN_CONFIG[swap.chainId]?.explorer ?? ''
        const txHash = swap.txHash || ''
        const explorerHref = txHash && explorerUrl
          ? `${explorerUrl}/tx/${txHash}`
          : '#'
        const hashDisplay = truncateHash(txHash || swap.orderId)

        return (
          <a
            key={swap.orderId}
            className="swap-row"
            href={explorerHref}
            target={explorerHref !== '#' ? '_blank' : undefined}
            rel="noopener noreferrer"
            onClick={explorerHref === '#' ? (e) => e.preventDefault() : undefined}
          >
            <span className="swap-row-pair">
              <span className="swap-row-tok">
                <span className="swap-row-tok-mark">{swap.inputToken.charAt(0)}</span>
                <span className="swap-row-tok-amt">
                  <span className="a">{swap.inputAmount}</span>
                  <span className="s">{swap.inputToken}</span>
                </span>
              </span>
              <span className="swap-row-arr" aria-hidden="true">→</span>
              <span className="swap-row-tok">
                <span className="swap-row-tok-mark">{swap.outputToken.charAt(0)}</span>
                <span className="swap-row-tok-amt">
                  <span className="a">{swap.outputAmount}</span>
                  <span className="s">{swap.outputToken}</span>
                </span>
              </span>
            </span>
            <span className="swap-row-ts">{timeAgo(swap.timestamp)}</span>
            <span className={`swap-row-status is-${badge}`}>
              <span className="d" aria-hidden="true" />
              {badge.charAt(0).toUpperCase() + badge.slice(1)}
            </span>
            <span
              className="swap-row-tx"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCopyHash(swap) }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopyHash(swap) } }}
              aria-label={`Copy hash ${hashDisplay}`}
            >
              <span className="hash">{hashDisplay}</span>
              <span className="ext" aria-hidden="true">
                <ExternalGlyph />
              </span>
            </span>
          </a>
        )
      })}
    </>
  )
}

function DebugBody({ wallet }: { wallet: DesignWalletMode }) {
  const isConnected = wallet !== 'disconnected'
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [orderOpen, setOrderOpen] = useState(false)

  const appId = useSwapStore((s) => s.appId)
  const chainId = useSwapStore((s) => s.chainId)
  const walletMode = useSwapStore((s) => s.walletMode)
  const quote = useSwapStore((s) => s.quote)
  const activeOrder = useSwapStore((s) => s.activeOrder)

  // Active address: read individual fields for selector compatibility.
  // Managed-wallet branch removed; external (RainbowKit) writes walletAddress.
  const activeAddress = useSwapStore((s) => {
    if (s.walletMode === 'bittensor' && s.bittensorAddress) return s.bittensorAddress
    return s.walletAddress
  })

  const quoteJson = quote ? JSON.stringify(quote, null, 2) : null
  const orderJson = activeOrder ? JSON.stringify(activeOrder, null, 2) : null

  return (
    <>
      <div className="debug-grid">
        <div className="debug-field">
          <span className="k">App&nbsp;ID</span>
          <span className="v">{appId || '—'}</span>
        </div>
        <div className="debug-field">
          <span className="k">Chain&nbsp;ID</span>
          <span className="v">{chainId || '—'}</span>
        </div>
        <div className="debug-field">
          <span className="k">Wallet&nbsp;mode</span>
          <span
            className={`v ${isConnected ? `is-${wallet}` : ''}`.trim()}
            style={!isConnected ? { color: 'var(--stone)' } : undefined}
          >
            {walletMode}
          </span>
        </div>
        <div className="debug-field">
          <span className="k">Active&nbsp;address</span>
          {activeAddress ? (
            <span className="v">{activeAddress}</span>
          ) : (
            <span className="v is-empty">—</span>
          )}
        </div>
      </div>

      <Disclosure
        title="Quote JSON"
        meta="Last quote"
        open={quoteOpen}
        onToggle={() => setQuoteOpen((v) => !v)}
      >
        {quoteJson ? (
          <pre>{quoteJson}</pre>
        ) : (
          <p className="app-rpanel-empty-line">
            No data&nbsp;<span className="v">·&nbsp;—</span>
          </p>
        )}
      </Disclosure>

      <Disclosure
        title="Order JSON"
        meta="Last order"
        open={orderOpen}
        onToggle={() => setOrderOpen((v) => !v)}
      >
        {orderJson ? (
          <pre>{orderJson}</pre>
        ) : (
          <p className="app-rpanel-empty-line">
            No data&nbsp;<span className="v">·&nbsp;—</span>
          </p>
        )}
      </Disclosure>
    </>
  )
}

function Disclosure({
  title,
  meta,
  open,
  onToggle,
  children,
}: {
  title: string
  meta: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className={`app-rpanel-disclose ${open ? 'is-open' : ''}`.trim()}>
      <button
        className="app-rpanel-disclose-head"
        type="button"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="glyph" aria-hidden="true" />
        <span>{title}</span>
        <span className="ln" aria-hidden="true" />
        <span className="meta">{meta}</span>
        <span className="chev" aria-hidden="true" />
      </button>
      {open && <div className="app-rpanel-disclose-body">{children}</div>}
    </div>
  )
}

function DismissGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
    </svg>
  )
}

function ExternalGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M5 1 H 11 V 7 M11 1 L 5.5 6.5 M11 6 V 11 H 1 V 1 H 6"
        stroke="currentColor"
        strokeWidth="1.1"
        fill="none"
        strokeLinecap="square"
      />
    </svg>
  )
}
