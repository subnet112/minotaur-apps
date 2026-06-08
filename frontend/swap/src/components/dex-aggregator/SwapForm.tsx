/**
 * SwapForm — 00.24 Swap form card.
 *
 * The central card. Header strip (slip readout + cog), chain selector
 * with cross-chain toggle, FROM/TO amount cells separated by the
 * direction-swap control, optional EVM recipient field (Bittensor →
 * EVM), and the action button.
 *
 * Visual-only:
 *   - Token symbols pre-filled from mock data; clicking the trigger
 *     opens the TokenSelectorModal via `onPickToken`.
 *   - Direction swap calls `onSwapDirection` (no-op in cross-chain).
 *   - Cross-chain toggle calls `onToggleCross`.
 *   - Cog calls `onOpenSettings`; slip readout pre-focuses slippage.
 *   - Chain pills open an inline dropdown listing chains from CHAIN_CONFIG.
 *     Selecting a chain calls `onPickFromChain(chainId)` / `onPickToChain(chainId)`.
 *
 * Lifted markup mirrors components.html section 00.24 (line 9245 +).
 */
import { useId, useState, useRef, useEffect } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
import type { ActionState, DesignWalletMode, TokenDisplay } from '@/types'
import ActionButton from './ActionButton'
import { CHAIN_CONFIG } from '@/config/chains'

interface SwapFormProps {
  /** Top-line slippage readout. */
  slippagePct: string
  deadlineMin: number

  /** Chain selector state. */
  fromChainName: string
  fromChainGlyph: string
  fromChainIconClass: string
  toChainName?: string
  toChainGlyph?: string
  toChainIconClass?: string

  /** Token selector triggers. */
  fromToken: TokenDisplay
  toToken: TokenDisplay

  /** Amount inputs. `toAmount` is read-only and shows `LOADING…` when fetching. */
  fromAmount: string
  fromUsd: string
  toAmount: string
  toUsd: string
  fromBalance?: string
  toBalance?: string

  /** `is-quoted` modifier on the TO cell — adds the lime border. */
  toIsQuoted: boolean
  /** Show "LOADING…" placeholder on the TO input instead of a number. */
  toIsLoading: boolean

  /** FROM amount input handler. */
  onChangeAmount: (value: string) => void
  /** MAX button — sets input to full balance. Only visible when fromBalance is truthy and > 0. */
  onMaxClick: () => void

  /** Cross-chain toggle. */
  cross: boolean
  onToggleCross: () => void
  /** When false (default) the cross-chain pill still renders but is disabled —
   *  greyed out, non-interactive, no toggle handler — so users can see the
   *  capability is on the roadmap without being able to enter a broken mode
   *  on Apps (like the DEX Aggregator) that haven't shipped the bridge legs. */
  crossChainEnabled?: boolean

  /** Chain pill clicks — opens inline chain dropdown; receives selected chainId. */
  onPickFromChain?: (chainId: number) => void
  onPickToChain?: (chainId: number) => void
  /** When provided, the chain dropdown lists only these chain IDs (intersected
   *  with CHAIN_CONFIG). Source: appSupportedChains in the store — populated
   *  from the active App's /v1/apps/{id}/status .deployments filtered by
   *  order-ready status. When undefined / empty, falls back to all configured
   *  chains (legacy behavior). */
  supportedChainIds?: readonly number[]

  /** Recipient field — surfaces when `cross && wallet==='bittensor'`. */
  showRecipient: boolean
  recipientValid: boolean
  recipientValue: string
  /** Recipient text input handler. */
  onChangeRecipient: (value: string) => void
  /** MetaMask button — requests eth_requestAccounts and sets recipient. */
  onMetaMaskRecipient?: () => void

  /** Direction-swap (disabled in cross-chain mode). */
  onSwapDirection: () => void

  /** Modal triggers. */
  onPickFromToken: () => void
  onPickToToken: () => void
  onOpenSettings: () => void

  /** Optional render slot on the right side of `.sw-form-head` (where the
   *  spacer used to live). The page mounts the history/debug toggles here
   *  so they sit next to the settings pill instead of the page header. */
  headerRight?: React.ReactNode

  /** Wallet context — feeds defaults for the action button label/glyph. */
  wallet: DesignWalletMode

  /** Action button state — driven from page state. */
  actionState: ActionState
  onActionClick: () => void

  /** Alpha-risk acknowledgement. The Swap/Sign action is blocked until the
   *  user ticks the disclaimer; the page shares this with the Approve CTA so
   *  neither funds-moving action can fire without consent. */
  acknowledged?: boolean
  onAcknowledgedChange?: (v: boolean) => void

  /** When true, briefly applies `.is-flash` to the disclaimer aside so users
   *  who clicked the disabled action button see what they need to tick. The
   *  page (SwapPage) drives the timing — this prop is only the visual hook. */
  disclaimerFlash?: boolean

  /** Override the action button's label. Used in the 3-step flow so the
   *  form's button says "Review swap →" instead of "Approve" / "Swap" /
   *  "Sign & broadcast" — those happen on step 2. */
  forceActionLabel?: string
}

export default function SwapForm(props: SwapFormProps) {
  const fromInputId = useId()
  const toInputId = useId()

  const [showFromDropdown, setShowFromDropdown] = useState(false)
  const [showToDropdown, setShowToDropdown] = useState(false)
  const fromDropdownRef = useRef<HTMLDivElement>(null)
  const toDropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (fromDropdownRef.current && !fromDropdownRef.current.contains(e.target as Node)) {
        setShowFromDropdown(false)
      }
      if (toDropdownRef.current && !toDropdownRef.current.contains(e.target as Node)) {
        setShowToDropdown(false)
      }
    }
    if (showFromDropdown || showToDropdown) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showFromDropdown, showToDropdown])

  return (
    <form className="sw-form sw-card" onSubmit={(e) => e.preventDefault()}>
      <BracketCorners />

      {/* Beta tag + alpha-risk acknowledgement. Visual matches the design
          system's sw-beta aside (section 00.31 in the component catalogue);
          the embedded checkbox is our addition so Approve / Swap / Sign are
          force-disabled until the user opts in. Acknowledgement persists
          in localStorage via the store. */}
      <aside className={`sw-beta ${props.disclaimerFlash ? 'is-flash' : ''}`.trim()} role="note">
        <span className="sw-beta-tag">
          <span className="dot" aria-hidden="true" />
          <span className="v">Beta</span>
        </span>
        <label className="sw-beta-msg">
          <input
            type="checkbox"
            checked={!!props.acknowledged}
            onChange={(e) => props.onAcknowledgedChange?.(e.target.checked)}
            aria-label="Acknowledge alpha risk"
          />
          <span>
            <span className="b">DEX Aggregator App currently in BETA</span>{' '}
            <span className="ref">— swap at your own risk and keep amounts small until the app is stable. I accept these risks.</span>
          </span>
        </label>
      </aside>

      <div className="sw-form-head">
        {/* Single settings entrypoint — slippage label + cog merged into one
            clickable pill. Used to be two buttons (slip pill + standalone cog)
            that both opened the same SettingsSheet; consolidated for clarity. */}
        <button
          className="sw-slip"
          type="button"
          aria-label="Open settings — slippage and deadline"
          onClick={props.onOpenSettings}
        >
          <span className="glyph" aria-hidden="true" />
          <span className="v">{props.slippagePct}</span>
          <span className="sep">/</span>
          <span className="v">{props.deadlineMin}m</span>
          <span className="sw-slip-cog" aria-hidden="true" style={{ display: 'inline-flex', marginLeft: 8, opacity: 0.7 }}>
            <CogGlyph />
          </span>
        </button>
        <span className="spacer" />
        {props.headerRight}
      </div>

      <div className="sw-form-body">
        {/* Chain selector — single pill or x-chain pair */}
        <div className="sw-chains">
          <div ref={fromDropdownRef} style={{ position: 'relative', flex: 1 }}>
            <button
              className={`sw-chain ${props.cross ? '' : 'is-active'}`.trim()}
              style={{ width: '100%' }}
              type="button"
              onClick={() => setShowFromDropdown((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={showFromDropdown}
            >
              <span className={`logo ${props.fromChainIconClass}`}>{props.fromChainGlyph}</span>
              <span className="name">{props.fromChainName}</span>
              <span className="chev" aria-hidden="true">
                <ChevronDown />
              </span>
            </button>
            {showFromDropdown && (
              <div className="sw-chain-dropdown" role="listbox" aria-label="Select source chain">
                {Object.entries(CHAIN_CONFIG)
                  .filter(([id]) => !props.supportedChainIds || props.supportedChainIds.length === 0 || props.supportedChainIds.includes(Number(id)))
                  .map(([id, cfg]) => (
                    <button
                      key={id}
                      className="sw-chain-dropdown-item"
                      role="option"
                      type="button"
                      onClick={() => {
                        props.onPickFromChain?.(Number(id))
                        setShowFromDropdown(false)
                      }}
                    >
                      {cfg.name}
                    </button>
                  ))}
              </div>
            )}
          </div>
          {props.cross && props.toChainName && (
            <>
              <span className="sw-chain-route" aria-hidden="true">→</span>
              <div ref={toDropdownRef} style={{ position: 'relative', flex: 1 }}>
                <button
                  className="sw-chain"
                  style={{ width: '100%' }}
                  type="button"
                  onClick={() => setShowToDropdown((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={showToDropdown}
                >
                  <span className={`logo ${props.toChainIconClass}`}>{props.toChainGlyph}</span>
                  <span className="name">{props.toChainName}</span>
                  <span className="chev" aria-hidden="true">
                    <ChevronDown />
                  </span>
                </button>
                {showToDropdown && (
                  <div className="sw-chain-dropdown" role="listbox" aria-label="Select destination chain">
                    {Object.entries(CHAIN_CONFIG)
                      .filter(([id]) => !props.supportedChainIds || props.supportedChainIds.length === 0 || props.supportedChainIds.includes(Number(id)))
                      .map(([id, cfg]) => (
                        <button
                          key={id}
                          className="sw-chain-dropdown-item"
                          role="option"
                          type="button"
                          onClick={() => {
                            props.onPickToChain?.(Number(id))
                            setShowToDropdown(false)
                          }}
                        >
                          {cfg.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </>
          )}
          <button
            className={`sw-xchain ${props.cross ? 'is-on' : ''}`.trim()}
            type="button"
            aria-pressed={props.cross}
            aria-disabled={!props.crossChainEnabled}
            disabled={!props.crossChainEnabled}
            onClick={props.crossChainEnabled ? props.onToggleCross : undefined}
            title={props.crossChainEnabled ? undefined : 'Cross-chain swaps coming soon'}
            style={
              !props.crossChainEnabled
                ? { opacity: 0.45, cursor: 'not-allowed' }
                : undefined
            }
          >
            <span className="glyph" aria-hidden="true" />
            {!props.cross && <span>Cross-chain</span>}
          </button>
        </div>

        {/* FROM */}
        <div className="sw-amt">
          <label htmlFor={fromInputId} className="eyebrow">
            <span className="glyph" aria-hidden="true" />
            From
          </label>
          <span className="bal">
            Bal&nbsp;<span className="v">{props.fromBalance ?? '—'}</span>
            {props.fromBalance && props.fromBalance !== '0' && (
              <>
                &nbsp;{props.fromToken.symbol}&nbsp;
                <button className="max" type="button" onClick={props.onMaxClick}>Max</button>
              </>
            )}
          </span>
          <input
            id={fromInputId}
            className={`input ${props.fromAmount ? '' : 'is-placeholder'}`.trim()}
            type="text"
            value={props.fromAmount}
            onChange={(e) => props.onChangeAmount(e.target.value)}
            placeholder="0.00"
          />
          <button className="sw-tok" type="button" onClick={props.onPickFromToken}>
            <span className={`ico ${props.fromToken.iconClass}`}>{props.fromToken.glyph}</span>
            <span className="sym">{props.fromToken.symbol}</span>
            <span className="chev" aria-hidden="true">
              <ChevronDown />
            </span>
          </button>
          <span className="usd">{props.fromUsd}</span>
        </div>

        {/* Direction swap */}
        <div className="sw-dir-wrap">
          <button
            className={`sw-dir ${props.cross ? 'is-disabled' : ''}`.trim()}
            type="button"
            disabled={props.cross}
            aria-label={props.cross ? 'Direction swap disabled in cross-chain mode' : 'Swap direction'}
            onClick={props.cross ? undefined : props.onSwapDirection}
          >
            <DirectionGlyph />
          </button>
        </div>

        {/* TO */}
        <div className={`sw-amt ${props.toIsQuoted ? 'is-quoted' : ''}`.trim()}>
          <label htmlFor={toInputId} className="eyebrow">
            <span className="glyph" aria-hidden="true" />
            To
          </label>
          <span className="bal">
            Bal&nbsp;<span className="v">{props.toBalance ?? '—'}</span>
            {props.toBalance && <>&nbsp;{props.toToken.symbol}</>}
          </span>
          {props.toIsLoading ? (
            <input
              id={toInputId}
              className="input is-placeholder"
              type="text"
              value="LOADING…"
              readOnly
            />
          ) : (
            <input
              id={toInputId}
              className={`input ${props.toIsQuoted ? 'is-lime' : 'is-placeholder'}`.trim()}
              type="text"
              value={props.toAmount}
              onChange={() => {}}
              placeholder="0.00"
              readOnly
            />
          )}
          <button className="sw-tok" type="button" onClick={props.onPickToToken}>
            <span className={`ico ${props.toToken.iconClass}`}>{props.toToken.glyph}</span>
            <span className="sym">{props.toToken.symbol}</span>
            <span className="chev" aria-hidden="true">
              <ChevronDown />
            </span>
          </button>
          <span className="usd">{props.toUsd}</span>
        </div>

        {/* Recipient (Bittensor → EVM) */}
        {props.showRecipient && (
          <div className={`sw-recipient ${props.recipientValue ? (props.recipientValid ? 'is-valid' : 'is-invalid') : ''}`.trim()}>
            <span className="eyebrow">
              <span className="glyph" aria-hidden="true" />
              EVM recipient
              <span className="req">*</span>
            </span>
            <input
              type="text"
              value={props.recipientValue}
              onChange={(e) => props.onChangeRecipient(e.target.value)}
              placeholder="0x…"
            />
            {props.onMetaMaskRecipient && (
              <button
                className="sw-recipient-mm"
                type="button"
                onClick={props.onMetaMaskRecipient}
                title="Import address from MetaMask"
              >
                MetaMask
              </button>
            )}
            {props.recipientValue && !props.recipientValid && (
              <span className="err">Not a valid EVM address</span>
            )}
          </div>
        )}

        {/* Action button (state machine — see 00.27). Blocked on the
            sw-beta acknowledgement at the top of the form for the
            funds-moving states (Approve / Swap / Sign). In the 3-step
            flow, props.forceActionLabel overrides the label so the
            button reads "Review swap →" on step 1; the actual approve /
            submit happens on step 2 (SwapReviewCard). */}
        <ActionButton
          state={props.actionState}
          onClick={props.onActionClick}
          tokenSymbol={props.fromToken?.symbol}
          forceLabel={props.forceActionLabel}
          forceDisabled={
            !props.acknowledged && (
              props.actionState === 'wrap' ||
              props.actionState === 'approve' ||
              props.actionState === 'swap-ready' ||
              props.actionState === 'sign-broadcast'
            )
          }
        />

        {/* Approval help text moved to SwapReviewCard — the form's button
            now says "Review swap →" for the approve/swap-ready/sign-broadcast
            states, so a "One-time approval for USDC…" line beneath it would
            be misleading. SwapPage passes the same copy to the review card
            via the `helpText` prop where the actual Approve / Confirm button
            lives. */}
      </div>
    </form>
  )
}

function ChevronDown() {
  return (
    <svg width="9" height="6" viewBox="0 0 9 6" fill="none" aria-hidden="true">
      <path d="M1 1 L4.5 4.5 L8 1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="square" />
    </svg>
  )
}

function DirectionGlyph() {
  return (
    <svg width="11" height="13" viewBox="0 0 11 13" fill="none" aria-hidden="true">
      <path
        d="M3 1 V 11 M3 11 L 1 8.5 M3 11 L 5 8.5 M8 12 V 2 M8 2 L 6 4.5 M8 2 L 10 4.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="square"
      />
    </svg>
  )
}

function CogGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="2.2" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M6.5 1 V 3 M6.5 10 V 12 M1 6.5 H 3 M10 6.5 H 12 M2.6 2.6 L 4 4 M9 9 L 10.4 10.4 M10.4 2.6 L 9 4 M4 9 L 2.6 10.4"
        stroke="currentColor"
        strokeWidth="1.05"
        strokeLinecap="square"
      />
    </svg>
  )
}
