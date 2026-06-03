/**
 * ActionButton — 00.27 Action button state machine.
 *
 * One element, twelve states. Each state has a label, an optional glyph
 * (arrow on affirmative actions, spinner on in-flight), and a CSS
 * modifier class that drives the colour family.
 *
 * Why a single component: the design centralises the contract — labels
 * never wrap, position never jitters between states, and the only thing
 * that changes is chrome + copy. The minotaur-apps team can re-derive
 * states from real conditions; this prototype just lets you pin one
 * via `?action=swap-ready` etc.
 *
 * Lifted markup mirrors components.html section 00.27 (line 10234 +).
 */
import type { ActionState } from '@/types'

interface ActionButtonProps {
  state: ActionState
  onClick: () => void
  /** Force the button disabled regardless of state — used to block
   *  funds-moving actions until the alpha disclaimer is acknowledged. */
  forceDisabled?: boolean
  /** Substituted into labels that mention the input token (approve /
   *  approving / insufficient). Falls back to "USDC" if unset, matching
   *  the original hardcoded copy. */
  tokenSymbol?: string
}

interface StateConfig {
  /** Modifier class appended after `sw-cta`. */
  modifier: string
  label: string
  /** True when the button should render `disabled`. */
  disabled: boolean
  /** Trailing glyph — 'arrow' (→) on affirmative states, 'spinner' on in-flight, 'none' otherwise. */
  glyph: 'arrow' | 'spinner' | 'none'
}

const STATE_CONFIG: Record<ActionState, StateConfig> = {
  disconnected:     { modifier: 'is-disconnected', label: 'Connect wallet',     disabled: false, glyph: 'none' },
  'wrong-network':  { modifier: 'is-wrong-net',    label: 'Switch to Ethereum', disabled: false, glyph: 'none' },
  empty:            { modifier: 'is-empty',        label: 'Enter amount',       disabled: true,  glyph: 'none' },
  insufficient:     { modifier: 'is-insufficient', label: 'Insufficient {token}', disabled: true,  glyph: 'none' },
  fetching:         { modifier: 'is-fetching',     label: 'Fetching quote…',     disabled: true,  glyph: 'spinner' },
  'no-route':       { modifier: 'is-no-route',     label: 'No route found',      disabled: true,  glyph: 'none' },
  approve:          { modifier: '',                label: 'Approve {token}',     disabled: false, glyph: 'arrow' },
  approving:        { modifier: 'is-approving',    label: 'Approving {token}…',  disabled: true,  glyph: 'spinner' },
  'swap-ready':     { modifier: '',                label: 'Swap',               disabled: false, glyph: 'arrow' },
  'sign-broadcast': { modifier: '',                label: 'Sign & broadcast',   disabled: false, glyph: 'arrow' },
  submitting:       { modifier: 'is-submitting',   label: 'Submitting…',        disabled: true,  glyph: 'spinner' },
  'awaiting-sig':   { modifier: 'is-disabled',     label: 'Awaiting approval',  disabled: true,  glyph: 'none' },
  'enter-recipient':{ modifier: 'is-empty',        label: 'Enter recipient',    disabled: true,  glyph: 'none' },
}

export default function ActionButton({ state, onClick, forceDisabled = false, tokenSymbol }: ActionButtonProps) {
  const cfg = STATE_CONFIG[state]
  const label = cfg.label.replace('{token}', tokenSymbol || 'USDC')
  return (
    <button
      className={`sw-cta ${cfg.modifier}`.trim()}
      type="button"
      disabled={cfg.disabled || forceDisabled}
      onClick={onClick}
    >
      {cfg.glyph === 'spinner' && <span className="spinner" aria-hidden="true" />}
      <span>{label}</span>
      {cfg.glyph === 'arrow' && (
        <span className="arr" aria-hidden="true">
          {' '}
          →
        </span>
      )}
    </button>
  )
}
