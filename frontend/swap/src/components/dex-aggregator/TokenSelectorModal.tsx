/**
 * TokenSelectorModal — 00.25 Token selector modal.
 *
 * Centered overlay that opens from either of the FROM/TO triggers.
 * Search bar at the top, scrollable list below with section dividers
 * (Your balances / Common).
 *
 * Visual-only:
 *   - Search filter is live (substring against symbol or name)
 *   - The opposite-side token renders muted with "ALREADY SELECTED"
 *   - Selection closes the modal and reports the choice to parent
 *
 * Lifted markup mirrors components.html section 00.25 (line 9690 +).
 */
import { useEffect, useMemo, useState } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
import { MOCK_TOKENS, type MockToken } from '@/types'

interface TokenSelectorModalProps {
  /** Token currently selected on the opposite side — rendered muted. */
  oppositeSymbol: string
  onSelect: (token: MockToken) => void
  onClose: () => void
}

export default function TokenSelectorModal({
  oppositeSymbol,
  onSelect,
  onClose,
}: TokenSelectorModalProps) {
  const [query, setQuery] = useState('')

  // Esc dismisses.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = useMemo(() => {
    if (!query.trim()) return MOCK_TOKENS
    const q = query.trim().toLowerCase()
    return MOCK_TOKENS.filter(
      (t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
    )
  }, [query])

  // Partition into "Your balances" (balance > 0) and "Common" (the rest).
  const withBalance = filtered.filter((t) => parseFloat(t.balance.replace(/,/g, '')) > 0)
  const common = filtered.filter((t) => parseFloat(t.balance.replace(/,/g, '')) === 0)

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="sw-tmod sw-card" role="dialog" aria-label="Select token" aria-modal="true">
        <BracketCorners />

        <div className="sw-card-head">
          <span className="eyebrow">
            <span className="glyph" aria-hidden="true" />
            Select token
          </span>
          <span className="ln" aria-hidden="true" />
          <button className="x" type="button" aria-label="Close" onClick={onClose}>
            <DismissGlyph />
          </button>
        </div>

        <div className="sw-tmod-search">
          <span className="ico" aria-hidden="true">
            <SearchGlyph />
          </span>
          <input
            type="text"
            placeholder="Search by name, symbol, or address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <span className="kbd">Esc</span>
        </div>

        <div className="sw-tmod-list">
          {filtered.length === 0 && (
            <div className="sw-tmod-empty">
              <p className="title">No matches.</p>
              <p className="helper">Try a different symbol, name, or paste an address</p>
            </div>
          )}

          {withBalance.length > 0 && (
            <>
              <div className="sw-tmod-section">
                <span>Your balances</span>
                <span className="ln" aria-hidden="true" />
              </div>
              {withBalance.map((t) => (
                <TokenRow
                  key={t.symbol}
                  token={t}
                  disabled={t.symbol === oppositeSymbol}
                  onClick={() => onSelect(t)}
                />
              ))}
            </>
          )}

          {common.length > 0 && (
            <>
              <div className="sw-tmod-section">
                <span>Common</span>
                <span className="ln" aria-hidden="true" />
              </div>
              {common.map((t) => (
                <TokenRow
                  key={t.symbol}
                  token={t}
                  disabled={t.symbol === oppositeSymbol}
                  onClick={() => onSelect(t)}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </ModalBackdrop>
  )
}

function TokenRow({
  token,
  disabled,
  onClick,
}: {
  token: MockToken
  disabled: boolean
  onClick: () => void
}) {
  // Renders as <div role="button"> — matches the prototype HTML which
  // uses <div class="sw-tmod-row">. A <button> here breaks the row's
  // CSS grid because of the browser-default `width: auto` +
  // `text-align: center` on buttons, which produces ragged-width rows.
  return (
    <div
      className={`sw-tmod-row ${disabled ? 'is-disabled' : ''}`.trim()}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <span className={`ico ${token.iconClass}`}>{token.glyph}</span>
      <span className="meta">
        <span className="sym">{token.symbol}</span>
        <span className="name">{token.name}</span>
      </span>
      <span className="right">
        {disabled ? (
          <span className="dis">Already selected</span>
        ) : (
          <>
            <span className="bal">{token.balance}</span>
            <span className="usd">{token.usd}</span>
          </>
        )}
      </span>
    </div>
  )
}

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.50)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      {children}
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

function SearchGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9 9 L 13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" />
    </svg>
  )
}
