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
  /** Override the state-machine label entirely. Used by the form step in
   *  the 3-step flow to relabel ready states as "Review swap →" — the
   *  click still routes through to the page handler, which decides
   *  whether to transition or fire a disclaimer toast. */
  forceLabel?: string
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

export default function ActionButton({ state, onClick, forceDisabled = false, tokenSymbol, forceLabel }: ActionButtonProps) {
  const cfg = STATE_CONFIG[state]
  const label = forceLabel ?? cfg.label.replace('{token}', tokenSymbol || 'USDC')
  // `forceDisabled` (alpha-ack not ticked) renders the disabled look but keeps
  // the button clickable so the parent can fire a toast + flash the
  // disclaimer; `cfg.disabled` (in-flight / no-route / empty / etc.) is a
  // real disable since clicking would be meaningless.
  const looksDisabled = cfg.disabled || forceDisabled
  return (
    <button
      className={`sw-cta ${cfg.modifier} ${looksDisabled ? 'is-disabled' : ''}`.trim()}
      type="button"
      disabled={cfg.disabled}
      aria-disabled={looksDisabled}
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
