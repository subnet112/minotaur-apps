/**
 * HeaderIconButton — 00.22 App header icon button.
 *
 * 38 px hairline icon button living in the app-ph action slot. Two
 * variants ship with Minotaur Swap:
 *   - History (always visible) → toggles Recent Swaps panel
 *   - Debug   (?debug=1 only)  → toggles Debug Info panel
 *
 * `active` adds the lime-tint + halo treatment from 00.22 v3.
 * Lifted markup mirrors components.html section 00.22.
 */

export type HeaderIconRole = 'history' | 'debug'

interface HeaderIconButtonProps {
  role: HeaderIconRole
  active: boolean
  onClick: () => void
}

export default function HeaderIconButton({ role, active, onClick }: HeaderIconButtonProps) {
  const label = role === 'history' ? 'Recent swaps' : 'Debug info'
  return (
    <button
      className={`app-ph-icon ${active ? 'is-active' : ''}`.trim()}
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {role === 'history' ? <HistoryGlyph /> : <DebugGlyph />}
    </button>
  )
}

function HistoryGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path d="M8 4.5 V 8 L 10.4 9.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="square" fill="none" />
    </svg>
  )
}

function DebugGlyph() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="5.5" y="5.5" width="5" height="6.5" rx="2.4" stroke="currentColor" strokeWidth="1.2" fill="none" />
      <path
        d="M5.5 7.5 H 3 M10.5 7.5 H 13 M5.5 10 H 3 M10.5 10 H 13 M5.5 12 L 4 13.4 M10.5 12 L 12 13.4 M6.5 5.6 L 5.4 4.5 M9.5 5.6 L 10.6 4.5 M8 5.5 V 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="square"
      />
    </svg>
  )
}
