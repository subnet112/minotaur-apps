/**
 * TokenSelectorModal — 00.25 Token selector modal.
 *
 * Centered overlay that opens from either of the FROM/TO triggers.
 * Search bar at the top, scrollable list below with section dividers
 * (Your balances / Common).
 *
 * Behaviors:
 *   - Receives real tokens via props.tokens (no fallback / no empty list).
 *   - Search filters by symbol, name, or address (substring, case-insensitive).
 *   - If the query matches /^0x[a-fA-F0-9]{40}$/ and no existing token has
 *     that address, an "Import token: 0x…" row is shown (requires canImport).
 *   - The opposite-side token renders muted with "Already selected".
 *   - Selection closes the modal and reports the choice to parent via onSelect.
 *
 * Lifted markup mirrors components.html section 00.25 (line 9690 +).
 */
import { useEffect, useMemo, useState } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
import TokenIcon from './TokenIcon'
import type { TokenDisplay } from '@/types'

interface TokenSelectorModalProps {
  /** Real token list for the active chain — no fallback, prop-driven. */
  tokens: TokenDisplay[]
  /** Token currently selected on the opposite side — rendered muted. */
  oppositeSymbol: string
  onSelect: (token: TokenDisplay) => void
  onClose: () => void
  /**
   * Called when the user clicks the "Import token" row. Parent handles the
   * ethers contract reads and store persistence; this component handles UI
   * state (pending spinner, error message). Returns the new TokenDisplay, or
   * null on failure.
   */
  onCustomImport?: (address: string) => Promise<TokenDisplay | null>
  /** When false (or omitted), the import row is never shown. */
  canImport?: boolean
  /**
   * Which token slot is being selected. Kept for layout signaling — the
   * native-ETH "wrap first" disable that used to live here was retired
   * once the DexAggregator contract gained auto-wrap support: the
   * validator's prepareDirectSubmit endpoint returns the right
   * `value` (msg.value), AppIntentBase._fundAndExecute wraps to WETH on
   * the user's behalf, and useOrderSubmission sends the TX with
   * msg.value set. Selecting native ETH on input is now seamless.
   */
  sideOpen?: 'input' | 'output'
}

export default function TokenSelectorModal({
  tokens,
  oppositeSymbol,
  onSelect,
  onClose,
  onCustomImport,
  canImport = false,
  sideOpen: _sideOpen,
}: TokenSelectorModalProps) {
  const [query, setQuery] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  // Esc dismisses.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tokens
    return tokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        (t.name?.toLowerCase() ?? '').includes(q) ||
        (t.address?.toLowerCase() ?? '').includes(q),
    )
  }, [tokens, query])

  // Custom-token import detection
  const trimmedQuery = query.trim()
  const isAddrQuery = /^0x[a-fA-F0-9]{40}$/.test(trimmedQuery)
  const existingAddrMatch = isAddrQuery
    ? tokens.some(
        (t) => t.address?.toLowerCase() === trimmedQuery.toLowerCase(),
      )
    : false
  const showImportRow =
    isAddrQuery && !existingAddrMatch && canImport && !!onCustomImport

  // Partition into "Your balances" (balance > 0) and "Common" (the rest).
  const withBalance = filtered.filter(
    (t) => parseFloat((t.balance ?? '0').replace(/,/g, '')) > 0,
  )
  const common = filtered.filter(
    (t) => parseFloat((t.balance ?? '0').replace(/,/g, '')) <= 0,
  )

  async function handleImport() {
    if (!onCustomImport || importing) return
    setImporting(true)
    setImportError(null)
    try {
      const result = await onCustomImport(trimmedQuery)
      if (result) {
        onSelect(result)
        onClose()
      } else {
        setImportError('Failed to load token — check the address')
      }
    } catch {
      setImportError('Failed to load token — check the address')
    } finally {
      setImporting(false)
    }
  }

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
            onChange={(e) => {
              setQuery(e.target.value)
              setImportError(null)
            }}
            autoFocus
          />
          <span className="kbd">Esc</span>
        </div>

        <div className="sw-tmod-list">
          {/* Import row — shown when query is a full address not in the list */}
          {showImportRow && (
            <div
              className={`sw-tmod-row sw-tmod-import${importing ? ' is-pending' : ''}`}
              role="button"
              tabIndex={0}
              onClick={importing ? undefined : handleImport}
              onKeyDown={(e) => {
                if (importing) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleImport()
                }
              }}
            >
              <span className="ico unknown">
                {importing ? <SpinnerGlyph /> : '+'}
              </span>
              <span className="meta">
                <span className="sym">Import token</span>
                <span className="name">
                  {trimmedQuery.slice(0, 10)}…{trimmedQuery.slice(-8)}
                </span>
              </span>
              <span className="right">
                {importing && <span className="bal">Loading…</span>}
              </span>
            </div>
          )}

          {/* Error from failed import */}
          {importError && (
            <div className="sw-tmod-empty">
              <p className="title">Import failed.</p>
              <p className="helper">{importError}</p>
            </div>
          )}

          {/* Empty state — shown when no import row and no filtered results */}
          {!showImportRow && filtered.length === 0 && !importError && (
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
                  key={t.address ?? t.symbol}
                  token={t}
                  disabled={t.symbol === oppositeSymbol}
                  onClick={() => {
                    onSelect(t)
                    onClose()
                  }}
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
                  key={t.address ?? t.symbol}
                  token={t}
                  disabled={t.symbol === oppositeSymbol}
                  onClick={() => {
                    onSelect(t)
                    onClose()
                  }}
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
  token: TokenDisplay
  disabled: boolean
  onClick: () => void
}) {
  // F21 "wrap first" disable retired with the contract's auto-wrap
  // support — only the "already selected" disable remains.
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
      <TokenIcon glyph={token.glyph} iconClass={token.iconClass} logoUri={token.logoUri} alt={token.symbol} />
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

function SpinnerGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 10" />
    </svg>
  )
}
