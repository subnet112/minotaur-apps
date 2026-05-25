/**
 * SettingsSheet — 00.30 Settings sheet.
 *
 * Modal with slippage slider + preset chips + custom field, App ID
 * override input, and two toggles (wallet mode + unlimited approval).
 * In managed-wallet mode the toggles hide (designer's call — neither
 * is meaningful without an external EVM signer).
 *
 * Visual-only. State lives in component-local useState so the controls
 * actually move. None of it persists — the prototype is for layout
 * review only.
 *
 * Lifted markup mirrors components.html section 00.30 (line 11134 +).
 */
import { useEffect, useState } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
import type { DesignWalletMode } from '@/types'

interface SettingsSheetProps {
  wallet: DesignWalletMode
  onClose: () => void
}

const PRESETS = [0.5, 1, 2, 5] as const

export default function SettingsSheet({ wallet, onClose }: SettingsSheetProps) {
  const [slippage, setSlippage] = useState(1)
  const [customSlippage, setCustomSlippage] = useState('')
  const [appId, setAppId] = useState('app_4f3b9c2a8d1e')
  const [signWithExternal, setSignWithExternal] = useState(wallet === 'metamask' || wallet === 'bittensor')
  const [unlimitedApproval, setUnlimitedApproval] = useState(false)

  // Esc dismisses.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const isHighSlip = slippage > 5
  const slippagePct = `${slippage.toFixed(2)} %`
  const slippageFillPct = Math.min((slippage / 12.5) * 100, 100) // visual ceiling at 12.5% for the bar

  // Managed-only mode hides external toggles (matches v3 in the prototype).
  const showExternalToggles = wallet !== 'managed'

  return (
    <ModalBackdrop onClose={onClose}>
      <div className="sw-settings sw-card" role="dialog" aria-label="Settings" aria-modal="true">
        <BracketCorners />

        <div className="sw-card-head">
          <span className="eyebrow">
            <span className="glyph" aria-hidden="true" />
            Settings
          </span>
          <span className="ln" aria-hidden="true" />
          <button className="x" type="button" aria-label="Close" onClick={onClose}>
            <DismissGlyph />
          </button>
        </div>

        <div className="sw-settings-body">
          {/* Slippage */}
          <div className="sw-settings-sec">
            <div className="sw-settings-h">
              <span className="lbl">Slippage tolerance</span>
              <span className="v" style={isHighSlip ? { color: 'var(--cretan)' } : undefined}>
                {slippagePct}
              </span>
            </div>
            <div className="sw-slider">
              <div className="track">
                <div
                  className="fill"
                  style={{
                    width: `${slippageFillPct}%`,
                    ...(isHighSlip ? { background: 'var(--cretan)' } : undefined),
                  }}
                />
                <div
                  className="thumb"
                  style={{
                    left: `${slippageFillPct}%`,
                    ...(isHighSlip ? { borderColor: 'var(--cretan)' } : undefined),
                  }}
                />
              </div>
            </div>
            <div className="sw-settings-presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  className={`sw-preset ${slippage === preset && !customSlippage ? 'is-selected' : ''}`.trim()}
                  type="button"
                  onClick={() => {
                    setSlippage(preset)
                    setCustomSlippage('')
                  }}
                >
                  {preset} %
                </button>
              ))}
              <div className="sw-custom" style={isHighSlip ? { borderColor: 'rgba(220,91,29,0.5)' } : undefined}>
                <input
                  type="text"
                  value={customSlippage}
                  onChange={(e) => {
                    const raw = e.target.value
                    setCustomSlippage(raw)
                    const parsed = parseFloat(raw)
                    if (!Number.isNaN(parsed)) setSlippage(parsed)
                  }}
                  placeholder="Custom"
                  style={isHighSlip ? { color: 'var(--cretan)' } : undefined}
                />
                <span className="pct" style={isHighSlip ? { color: 'var(--cretan)' } : undefined}>
                  %
                </span>
              </div>
            </div>
            <p className="sw-settings-help" style={isHighSlip ? { color: 'var(--cretan)' } : undefined}>
              {isHighSlip ? (
                'High slippage exposes your trade to sandwich attacks. Set this only if a route is failing to fill.'
              ) : (
                <>
                  Higher slippage = <span className="b">more likely to fill</span>, but worse
                  price protection.
                </>
              )}
            </p>
          </div>

          {/* App ID */}
          <div className="sw-settings-sec">
            <div className="sw-settings-h">
              <span className="lbl">App ID override</span>
            </div>
            <div className="sw-input">
              <input
                type="text"
                placeholder="app_xxxxxxxxxxxx"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
              />
            </div>
            <p className="sw-settings-help">
              Override the target App Intent ID. <span className="b">Advanced / debug.</span>
            </p>
          </div>

          {showExternalToggles && (
            <>
              <div className="sw-settings-sec">
                <button
                  className={`sw-toggle ${signWithExternal ? 'is-on' : ''}`.trim()}
                  type="button"
                  onClick={() => setSignWithExternal((v) => !v)}
                >
                  <div className="name">Sign with external wallet</div>
                  <div className="sw" role="switch" aria-checked={signWithExternal}>
                    <span className="knob" />
                  </div>
                </button>
                <p className="sw-settings-help">
                  When on, Minotaur prompts your <span className="b">MetaMask</span> for every
                  order. When off, your managed wallet auto-signs.
                </p>
              </div>

              <div className="sw-settings-sec">
                <button
                  className={`sw-toggle ${unlimitedApproval ? 'is-on' : ''}`.trim()}
                  type="button"
                  onClick={() => setUnlimitedApproval((v) => !v)}
                >
                  <div className="name">Unlimited approval</div>
                  <div className="sw" role="switch" aria-checked={unlimitedApproval}>
                    <span className="knob" />
                  </div>
                </button>
                <p className="sw-settings-help">
                  <span className="b">On:</span> approve once, swap forever.{' '}
                  <span className="b">Off:</span> approve exact amount per swap.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="sw-settings-footer">
          <button className="sw-settings-done" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </ModalBackdrop>
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
