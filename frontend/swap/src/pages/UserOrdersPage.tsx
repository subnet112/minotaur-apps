/**
 * UserOrdersPage — /orders inside the swap iframe.
 *
 * Wallet-scoped order history. Polls /v1/orders and filters by
 * `submitted_by === walletAddress` (case-insensitive). Connected wallet is
 * read from the same zustand store the SwapPage uses, so navigating here
 * preserves the session — no re-auth, no re-connect.
 *
 * Top: "← Back to swap" link (react-router, stays inside the iframe).
 * Body: table with timestamp / status / from→to / tx-hash columns. Token
 * addresses are mapped to symbols via store.solverTokens; falls back to
 * truncated address when a token isn't in the cache.
 *
 * Empty state when the wallet has no orders. Disconnected-wallet state
 * shows a connect-prompt. Errors render inline (no toast) — this page is
 * not noisy.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSwapStore } from '@/store'
import { listOrders, type OrderResult } from '@/api/client'
import { CHAIN_CONFIG } from '@/config/chains'

const POLL_INTERVAL_MS = 10_000

export default function UserOrdersPage() {
  const walletAddress = useSwapStore((s) => s.walletAddress)
  const walletConnected = useSwapStore((s) => s.walletConnected)
  const solverTokens = useSwapStore((s) => s.solverTokens)
  const appId = useSwapStore((s) => s.appId)

  const [orders, setOrders] = useState<OrderResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOrders = useCallback(async () => {
    try {
      // The /v1/orders endpoint doesn't support a wallet filter, so we
      // fetch the recent slice and filter client-side. Fine for the UX
      // scale we care about today; revisit if a wallet has 1000+ orders.
      const res = await listOrders()
      setOrders(res.orders ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch orders')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOrders()
    const id = window.setInterval(fetchOrders, POLL_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [fetchOrders])

  // Filter to the connected wallet AND the app this UI serves (so V1/V2 orders
  // don't interleave once both are live), newest first. The per-row chain badge
  // then distinguishes Base vs Ethereum within the active app.
  const myOrders = useMemo(() => {
    if (!walletAddress) return []
    const addr = walletAddress.toLowerCase()
    return orders
      .filter((o) => o.submitted_by?.toLowerCase() === addr)
      .filter((o) => !appId || o.app_id === appId)
      .sort((a, b) => {
        const at = Number(a.created_at) || 0
        const bt = Number(b.created_at) || 0
        return bt - at
      })
  }, [orders, walletAddress, appId])

  return (
    <section className="dex-stage" aria-label="My orders">
      <div className="dex-content uord-content">

        <div className="uord-head">
          <Link to="/" className="uord-back" aria-label="Back to swap">
            <span aria-hidden="true">←</span>
            <span>Back to swap</span>
          </Link>
          <h1 className="uord-title">My orders</h1>
          {walletAddress && (
            <span className="uord-wallet mono">
              {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
            </span>
          )}
        </div>

        {!walletConnected && (
          <div className="uord-empty">
            <p>Connect your wallet to see your orders.</p>
            <Link to="/" className="uord-link">Go to swap →</Link>
          </div>
        )}

        {walletConnected && loading && orders.length === 0 && (
          <div className="uord-empty">Loading…</div>
        )}

        {walletConnected && error && (
          <div className="uord-empty is-error">{error}</div>
        )}

        {walletConnected && !loading && myOrders.length === 0 && !error && (
          <div className="uord-empty">
            <p>No orders yet.</p>
            <Link to="/" className="uord-link">Make your first swap →</Link>
          </div>
        )}

        {myOrders.length > 0 && (
          <div className="uord-table" role="table">
            <div className="uord-row uord-row-h" role="row">
              <span role="columnheader">When</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">From → To</span>
              <span role="columnheader">Tx</span>
            </div>
            {myOrders.map((o) => (
              <OrderRow key={o.order_id} order={o} solverTokens={solverTokens} />
            ))}
          </div>
        )}

      </div>
    </section>
  )
}

interface OrderRowProps {
  order: OrderResult
  solverTokens: ReturnType<typeof useSwapStore.getState>['solverTokens']
}

function OrderRow({ order, solverTokens }: OrderRowProps) {
  const chainCfg = CHAIN_CONFIG[order.chain_id]
  const params = (order.params ?? {}) as Record<string, unknown>
  const inAddr = String(params.input_token ?? '')
  const outAddr = String(params.output_token ?? '')
  const tokens = solverTokens[order.chain_id] ?? []
  const inTok = tokens.find((t) => t.address?.toLowerCase() === inAddr.toLowerCase())
  const outTok = tokens.find((t) => t.address?.toLowerCase() === outAddr.toLowerCase())
  const inSym = inTok?.symbol ?? truncAddr(inAddr)
  const outSym = outTok?.symbol ?? truncAddr(outAddr)

  const when = formatTimeAgo(Number(order.created_at) || 0)

  return (
    <div className="uord-row" role="row">
      <span role="cell" className="mono uord-when" title={new Date(Number(order.created_at) * 1000).toISOString()}>
        {when}
      </span>
      <span role="cell" className={`uord-status uord-status-${statusClass(order.status)}`}>
        {order.status}
      </span>
      <span role="cell" className="uord-pair">
        <span className="sym">{inSym}</span>
        <span className="arrow" aria-hidden="true">→</span>
        <span className="sym">{outSym}</span>
        <span
          className="uord-chain mono"
          title={chainCfg?.name ?? `chain ${order.chain_id}`}
          style={{ marginLeft: 8, padding: '1px 6px', border: '1px solid var(--hairline, rgba(255,255,255,0.14))', borderRadius: 4, fontSize: 10, opacity: 0.75 }}
        >
          {chainCfg?.shortName ?? order.chain_id}
        </span>
      </span>
      <span role="cell" className="mono uord-tx">
        {order.tx_hash && chainCfg?.explorer ? (
          <a href={`${chainCfg.explorer}/tx/${order.tx_hash}`} target="_blank" rel="noopener noreferrer">
            {order.tx_hash.slice(0, 6)}…{order.tx_hash.slice(-4)}
          </a>
        ) : (
          <span className="dim">—</span>
        )}
      </span>
    </div>
  )
}

function truncAddr(a: string): string {
  if (!a || a.length < 10) return a || '—'
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function formatTimeAgo(unixSec: number): string {
  if (!unixSec) return '—'
  const diffMs = Date.now() - unixSec * 1000
  const s = Math.floor(diffMs / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function statusClass(status: string): 'ok' | 'fail' | 'pending' {
  if (status === 'filled' || status === 'solved' || status === 'scored') return 'ok'
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return 'fail'
  return 'pending'
}
