/**
 * WalletConnectPanel — 00.20 Wallet connect panel.
 *
 * Modal popover with a 3-tab segmented control (Managed / MetaMask /
 * Bittensor). Each tab swaps the explainer card and the CTA verb.
 *
 * Visual-only — clicking the CTA in this prototype just closes the
 * panel and sets the wallet mode. The minotaur-apps team wires
 * window.ethereum / Polkadot.js / managed-wallet keygen.
 *
 * Lifted markup mirrors components.html section 00.20 (line 7692 +).
 */
import { useEffect } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
import type { DesignWalletMode } from '@/types'

type Tab = 'managed' | 'metamask' | 'bittensor'

const COPY: Record<Tab, { eyebrow: string; body: React.ReactNode; cta: string; resultingMode: DesignWalletMode }> = {
  managed: {
    eyebrow: 'Managed',
    body: (
      <>
        Create a managed wallet to swap without a browser extension.{' '}
        <span className="b">Auto-signs orders</span> through the platform — no signing
        prompt per trade. Useful for high-frequency intents and headless agents.
      </>
    ),
    cta: 'Create wallet',
    resultingMode: 'managed',
  },
  metamask: {
    eyebrow: 'MetaMask',
    body: (
      <>
        Connect <span className="b">MetaMask</span>, <span className="b">Rabby</span>, or{' '}
        <span className="b">Coinbase Wallet</span> to swap on EVM chains. Each order
        prompts your wallet for a signature.
      </>
    ),
    cta: 'Connect MetaMask',
    resultingMode: 'metamask',
  },
  bittensor: {
    eyebrow: 'Bittensor',
    body: (
      <>
        Connect <span className="b">Polkadot.js</span>, <span className="b">Talisman</span>, or{' '}
        <span className="b">SubWallet</span> to swap on Bittensor. Same signing flow,
        SS58 address format.
      </>
    ),
    cta: 'Connect Bittensor wallet',
    resultingMode: 'bittensor',
  },
}

interface WalletConnectPanelProps {
  activeTab: Tab
  onTabChange: (tab: Tab) => void
  onClose: () => void
  /** Called when the CTA is clicked — passes the resulting wallet mode. */
  onConnect: (mode: DesignWalletMode) => void
}

export default function WalletConnectPanel({
  activeTab,
  onTabChange,
  onClose,
  onConnect,
}: WalletConnectPanelProps) {
  // Esc dismisses, matching the dialog convention used elsewhere in the app.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const tab = COPY[activeTab]

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="app-wcp" role="dialog" aria-label="Connect wallet" aria-modal="true">
        <BracketCorners />

        <div className="app-wcp-head">
          <span className="t">
            <span className="glyph" aria-hidden="true" />
            Connect wallet
          </span>
          <button className="x" type="button" aria-label="Close" onClick={onClose}>
            <DismissGlyph />
          </button>
        </div>

        <div className="app-wcp-modes" role="tablist">
          {(['managed', 'metamask', 'bittensor'] as Tab[]).map((t) => (
            <button
              key={t}
              className={`app-wcp-mode ${t === activeTab ? 'is-active' : ''}`.trim()}
              type="button"
              role="tab"
              aria-selected={t === activeTab}
              onClick={() => onTabChange(t)}
            >
              {t === 'managed' ? 'Managed' : t === 'metamask' ? 'MetaMask' : 'Bittensor'}
            </button>
          ))}
        </div>

        <div className="app-wcp-body">
          <div className="app-wcp-explainer">
            <BracketCorners />
            <div className="app-wcp-eyebrow">
              <span className="glyph" aria-hidden="true" />
              <span>Mode</span>
              <span className="slash">/</span>
              <span className="v">{tab.eyebrow}</span>
            </div>
            <p>{tab.body}</p>
          </div>

          <button
            className="app-wcp-cta"
            type="button"
            onClick={() => onConnect(tab.resultingMode)}
          >
            <span>{tab.cta}</span>
            <span className="arr">→</span>
          </button>
        </div>
      </div>
    </ModalBackdrop>
  )
}

function ModalBackdrop({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // Lightweight backdrop — clicking outside the panel closes. No CSS rule
  // for this class in components.css, just inline so the overlay reads
  // visually (low-opacity scrim, centered).
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
