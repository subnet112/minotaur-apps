/**
 * SettingsSheet — 00.30 Settings sheet.
 *
 * Modal with slippage slider + preset chips + custom field, App ID
 * override input, and two toggles (wallet mode + unlimited approval).
 * In managed-wallet mode the toggles hide (designer's call — neither
 * is meaningful without an external EVM signer).
 *
 * State is persisted via Zustand store — closing the sheet preserves
 * all settings. Slippage, App ID, wallet mode, and unlimited approval
 * are all live-synced with the store.
 *
 * Lifted markup mirrors components.html section 00.30 (line 11134 +).
 */
import { useEffect, useState } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
import { useSwapStore } from '@/store'
import { useToast } from '@/components/shell'
import type { DesignWalletMode } from '@/types'

interface SettingsSheetProps {
  wallet: DesignWalletMode
  onClose: () => void
}

const PRESETS = [0.5, 1, 2, 5] as const

export default function SettingsSheet({ wallet: _wallet, onClose }: SettingsSheetProps) {
  // Read from store
  const slippageBps = useSwapStore((s) => s.slippageBps)
  const unlimitedApproval = useSwapStore((s) => s.unlimitedApproval)

  // Actions
  const setSlippageBps = useSwapStore((s) => s.setSlippageBps)
  const setUnlimitedApproval = useSwapStore((s) => s.setUnlimitedApproval)

  const toast = useToast()

  // Local custom input state (controlled string for the text field)
  const [customSlippage, setCustomSlippage] = useState('')

  // Derived values
  const slippagePct = slippageBps / 100 // e.g. 100 bps → 1.00
  const isHighSlip = slippageBps > 500  // > 5%

  // Visual: map 10–5000 bps → 0–100% for slider fill/thumb
  // Ceiling at 5000 bps (50%) = 100% visual
  const slippageFillPct = Math.min(((slippageBps - 10) / (5000 - 10)) * 100, 100)

  // Esc dismisses.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function handlePresetClick(preset: number) {
    const bps = Math.round(preset * 100)
    setSlippageBps(bps)
    setCustomSlippage('')
  }

  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setCustomSlippage(raw)
    const parsed = parseFloat(raw)
    if (!Number.isNaN(parsed) && parsed > 0) {
      const bps = Math.round(parsed * 100)
      // Clamp to [10, 5000]
      setSlippageBps(Math.max(10, Math.min(5000, bps)))
    }
  }

  // Which preset (if any) is exactly selected; custom input clears selection
  function isPresetSelected(preset: number) {
    return slippageBps === Math.round(preset * 100) && customSlippage === ''
  }

  function handleDone() {
    toast.success({ title: 'Settings saved' })
    onClose()
  }

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
                {slippagePct.toFixed(2)} %
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
                {/* Invisible range input overlays the track for accessible drag interaction */}
                <input
                  type="range"
                  min="10"
                  max="5000"
                  step="1"
                  value={slippageBps}
                  onChange={(e) => {
                    setSlippageBps(Number(e.target.value))
                    setCustomSlippage('')
                  }}
                  aria-label="Slippage tolerance"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    opacity: 0,
                    cursor: 'pointer',
                    width: '100%',
                    height: '100%',
                    margin: 0,
                  }}
                />
              </div>
            </div>
            <div className="sw-settings-presets">
              {PRESETS.map((preset) => (
                <button
                  key={preset}
                  className={`sw-preset ${isPresetSelected(preset) ? 'is-selected' : ''}`.trim()}
                  type="button"
                  onClick={() => handlePresetClick(preset)}
                >
                  {preset} %
                </button>
              ))}
              <div className={`sw-custom${customSlippage !== '' ? ' is-custom' : ''}`} style={isHighSlip ? { borderColor: 'rgba(220,91,29,0.5)' } : undefined}>
                <input
                  type="text"
                  value={customSlippage}
                  onChange={handleCustomChange}
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

          {/* Managed/external sign-mode toggle retired with the managed-wallet
              flow removal. The unlimited-approval toggle below is independent
              and stays. */}
          <div className="sw-settings-sec">
            <button
              className={`sw-toggle ${unlimitedApproval ? 'is-on' : ''}`.trim()}
              type="button"
              onClick={() => setUnlimitedApproval(!unlimitedApproval)}
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
        </div>

        <div className="sw-settings-footer">
          <button className="sw-settings-done" type="button" onClick={handleDone}>
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
