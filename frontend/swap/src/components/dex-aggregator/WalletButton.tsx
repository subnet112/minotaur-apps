/**
 * WalletButton — 00.19 Wallet button.
 *
 * Visual-only. Renders the four states from the prototype catalog:
 *   - disconnected (default) → "Connect wallet" + chevron
 *   - managed                → "MANAGED · 0x5a33…c108" (Bone dot)
 *   - metamask               → "BASE · 0x5a33…c108" (Lime dot)
 *   - bittensor              → "BITTENSOR · 5HpS…8YJ4" (Lime dot)
 *
 * Click opens the WalletConnectPanel — wired via parent through `onOpen`.
 * No real wallet provider integration — this is a prototype for the
 * platform repo. The minotaur-apps team wires `window.ethereum` etc.
 *
 * Lifted markup mirrors components.html section 00.19 (line 7396 +).
 */
import type { DesignWalletMode } from '@/types'

interface WalletButtonProps {
  mode: DesignWalletMode
  /** Opens the connect panel (when disconnected) or a menu (when connected). */
  onClick: () => void
  /**
   * Truncated address string to display when connected.
   * Pass A: defaults to '' until Pass C wires real address from store.
   */
  address?: string
}

export default function WalletButton({ mode, onClick, address = '' }: WalletButtonProps) {
  if (mode === 'disconnected') {
    return (
      <button
        className="app-wallet"
        type="button"
        onClick={onClick}
        aria-label="Connect wallet"
      >
        <span>Connect wallet</span>
        <span className="chev" aria-hidden="true" />
      </button>
    )
  }

  // Connected variants
  const { modifierClass, modeLabel } = (() => {
    switch (mode) {
      case 'managed':
        return { modifierClass: 'is-managed', modeLabel: 'MANAGED' }
      case 'metamask':
        return { modifierClass: 'is-metamask', modeLabel: 'BASE' }
      case 'bittensor':
        return { modifierClass: 'is-bittensor', modeLabel: 'BITTENSOR' }
    }
  })()

  return (
    <button
      className={`app-wallet is-connected ${modifierClass}`}
      type="button"
      onClick={onClick}
      aria-label={`Wallet menu · ${modeLabel}`}
    >
      <span className="app-wallet-mode">
        <span className="d" aria-hidden="true" />
        {modeLabel}
      </span>
      <span className="app-wallet-addr">{address}</span>
      <span className="chev" aria-hidden="true" />
    </button>
  )
}
