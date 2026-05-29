/**
 * WalletModeBlock — 00.26 Wallet-mode contextual block.
 *
 * Surfaces above the action button when the swap surface needs a setup
 * step before proceeding: approve an external token, set up a Bittensor
 * proxy, or just inform about a native-ETH broadcast.
 *
 * Managed-wallet variants (create-wallet / fund-wallet) retired with
 * the managed-wallet flow removal.
 *
 * Lifted markup mirrors components.html section 00.26 (line 10001 +).
 */
import BracketCorners from '@/components/primitives/BracketCorners'
import type { ModeBlock } from '@/types'

interface WalletModeBlockProps {
  variant: Exclude<ModeBlock, 'none'>
  /** Called when the block's CTA is clicked. Visual-only — no real wiring. */
  onCtaClick?: () => void
  /** Disable the CTA (e.g. Approve) until the alpha disclaimer is acknowledged. */
  disabled?: boolean
}

interface BlockConfig {
  /** Modifier class on .sw-mode (`is-pending`, `is-note`, ...). */
  modifier: string
  eyebrowMode: string
  eyebrowAction: string
  body: React.ReactNode
  /** CTA — omit for 'note' variants (informational only, no action). */
  cta?: { label: string; ghost: boolean }
}

const CONFIG: Record<Exclude<ModeBlock, 'none'>, BlockConfig> = {
  approval: {
    modifier: '',
    eyebrowMode: 'External',
    eyebrowAction: 'Approval',
    body: (
      <>
        One-time approval for <span className="b">USDC</span>. Enable{' '}
        <span className="b">Unlimited&nbsp;Approval</span> in settings to skip this on
        future swaps.
      </>
    ),
    cta: { label: 'Approve USDC', ghost: false },
  },
  approving: {
    modifier: 'is-pending',
    eyebrowMode: 'External',
    eyebrowAction: 'Approval pending',
    body: (
      <>
        Approval submitted · <code>0x4b71…3df0</code>. Wait for the transaction to
        confirm before swapping. Cancel from your wallet to release the slot.
      </>
    ),
  },
  'native-eth': {
    modifier: 'is-note',
    eyebrowMode: 'Native ETH',
    eyebrowAction: 'Broadcast required',
    body: (
      <>
        Native ETH swaps require you to broadcast the transaction. Sign in{' '}
        <span className="b">MetaMask</span> when prompted — gas is paid from the same
        account.
      </>
    ),
  },
  'setup-proxy': {
    modifier: '',
    eyebrowMode: 'Bittensor',
    eyebrowAction: 'Setup proxy',
    body: (
      <>
        Configure a permissionless proxy so Minotaur can submit orders on your behalf.
        Revocable any time from your Bittensor wallet.
      </>
    ),
    cta: { label: 'Setup proxy', ghost: false },
  },
}

export default function WalletModeBlock({ variant, onCtaClick, disabled = false }: WalletModeBlockProps) {
  const cfg = CONFIG[variant]
  return (
    <div className={`sw-mode ${cfg.modifier}`.trim()}>
      <BracketCorners />
      <span className="sw-mode-eyebrow">
        <span className="glyph" aria-hidden="true" />
        <span className="v">{cfg.eyebrowMode}</span>
        <span className="slash">/</span>
        <span>{cfg.eyebrowAction}</span>
      </span>
      <p>{cfg.body}</p>
      {cfg.cta && (
        <button
          className={`sw-mode-btn ${cfg.cta.ghost ? '' : 'is-primary'}`.trim()}
          type="button"
          onClick={onCtaClick}
          disabled={disabled}
          style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
        >
          <span>{cfg.cta.label}</span>
          <span className="arr" aria-hidden="true">→</span>
        </button>
      )}
    </div>
  )
}
