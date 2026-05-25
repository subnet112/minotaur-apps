/**
 * RevealPanel — 00.23 Inline reveal panel.
 *
 * Two role flavours under one chrome:
 *   - 'history' → Recent Swaps (list of past swap rows from mock data)
 *   - 'debug'   → Debug Info (4-field grid + Quote JSON / Order JSON disclosures)
 *
 * Lifted markup mirrors components.html section 00.23 (line 8635 + 8801).
 */
import { useState } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
import type { DesignWalletMode } from '@/types'
import {
  MOCK_RECENT_SWAPS,
  MOCK_DEBUG_INFO,
  MOCK_QUOTE_JSON,
  MOCK_ORDER_JSON,
  MOCK_WALLET_ADDR_EVM,
  MOCK_WALLET_ADDR_SS58,
} from '@/types'

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
          {role === 'history' && (
            <span className="ct-count">{String(MOCK_RECENT_SWAPS.length).padStart(2, '0')}&nbsp;TOTAL</span>
          )}
        </span>
        <span className="ln" aria-hidden="true" />
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

function HistoryBody() {
  if (MOCK_RECENT_SWAPS.length === 0) {
    return (
      <>
        <p className="app-rpanel-empty-title">No swaps yet.</p>
        <p className="app-rpanel-empty-msg">Past swaps for this wallet will appear here</p>
      </>
    )
  }
  return (
    <>
      {MOCK_RECENT_SWAPS.map((s, idx) => (
        <a key={idx} className="swap-row" href="#" onClick={(e) => e.preventDefault()}>
          <span className="swap-row-pair">
            <span className="swap-row-tok">
              <span className="swap-row-tok-mark">{s.fromGlyph}</span>
              <span className="swap-row-tok-amt">
                <span className="a">{s.fromAmount}</span>
                <span className="s">{s.fromSymbol}</span>
              </span>
            </span>
            <span className="swap-row-arr" aria-hidden="true">→</span>
            <span className="swap-row-tok">
              <span className="swap-row-tok-mark">{s.toGlyph}</span>
              <span className="swap-row-tok-amt">
                <span className="a">{s.toAmount}</span>
                <span className="s">{s.toSymbol}</span>
              </span>
            </span>
          </span>
          <span className="swap-row-ts">{s.timeAgo}</span>
          <span className={`swap-row-status is-${s.status}`}>
            <span className="d" aria-hidden="true" />
            {s.status[0].toUpperCase() + s.status.slice(1)}
          </span>
          <span className="swap-row-tx">
            <span className="hash">{s.txTruncated}</span>
            <span className="ext" aria-hidden="true">
              <ExternalGlyph />
            </span>
          </span>
        </a>
      ))}
    </>
  )
}

function DebugBody({ wallet }: { wallet: DesignWalletMode }) {
  const isConnected = wallet !== 'disconnected'
  const addrFull = wallet === 'bittensor' ? MOCK_WALLET_ADDR_SS58 : MOCK_WALLET_ADDR_EVM

  // Default both disclosures collapsed for the populated state; open with empty rows for disconnected.
  const [quoteOpen, setQuoteOpen] = useState(!isConnected)
  const [orderOpen, setOrderOpen] = useState(!isConnected)

  return (
    <>
      <div className="debug-grid">
        <div className="debug-field">
          <span className="k">App&nbsp;ID</span>
          <span className="v">{MOCK_DEBUG_INFO.appId}</span>
        </div>
        <div className="debug-field">
          <span className="k">Chain&nbsp;ID</span>
          <span className="v">{wallet === 'bittensor' ? 'bittensor' : MOCK_DEBUG_INFO.chainId}</span>
        </div>
        <div className="debug-field">
          <span className="k">Wallet&nbsp;mode</span>
          <span
            className={`v ${isConnected ? `is-${wallet}` : ''}`.trim()}
            style={!isConnected ? { color: 'var(--stone)' } : undefined}
          >
            {wallet}
          </span>
        </div>
        <div className="debug-field">
          <span className="k">Active&nbsp;address</span>
          {isConnected ? (
            <span className="v">{addrFull}</span>
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
        {isConnected ? (
          <pre className="app-rpanel-json">{MOCK_QUOTE_JSON}</pre>
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
        {isConnected ? (
          <pre className="app-rpanel-json">{MOCK_ORDER_JSON}</pre>
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
