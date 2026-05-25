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
 *
 * Lifted markup mirrors components.html section 00.24 (line 9245 +).
 */
import { useId } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
import type { ActionState, DesignWalletMode } from '@/types'
import type { MockToken } from '@/types'
import ActionButton from './ActionButton'

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
  fromToken: MockToken
  toToken: MockToken

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

  /** Cross-chain toggle. */
  cross: boolean
  onToggleCross: () => void

  /** Recipient field — surfaces when `cross && wallet==='bittensor'`. */
  showRecipient: boolean
  recipientValid: boolean
  recipientValue?: string

  /** Direction-swap (disabled in cross-chain mode). */
  onSwapDirection: () => void

  /** Modal triggers. */
  onPickFromToken: () => void
  onPickToToken: () => void
  onOpenSettings: () => void

  /** Wallet context — feeds defaults for the action button label/glyph. */
  wallet: DesignWalletMode

  /** Action button state — driven from page state. */
  actionState: ActionState
  onActionClick: () => void
}

export default function SwapForm(props: SwapFormProps) {
  const fromInputId = useId()
  const toInputId = useId()

  return (
    <form className="sw-form sw-card" onSubmit={(e) => e.preventDefault()}>
      <BracketCorners />

      <div className="sw-form-head">
        <button
          className="sw-slip"
          type="button"
          aria-label="Slippage and deadline"
          onClick={props.onOpenSettings}
        >
          <span className="glyph" aria-hidden="true" />
          <span className="v">{props.slippagePct}</span>
          <span className="sep">/</span>
          <span className="v">{props.deadlineMin}m</span>
        </button>
        <span className="spacer" />
        <button className="sw-cog" type="button" aria-label="Settings" onClick={props.onOpenSettings}>
          <CogGlyph />
        </button>
      </div>

      <div className="sw-form-body">
        {/* Chain selector — single pill or x-chain pair */}
        <div className="sw-chains">
          <button className={`sw-chain ${props.cross ? '' : 'is-active'}`.trim()} type="button">
            <span className={`logo ${props.fromChainIconClass}`}>{props.fromChainGlyph}</span>
            <span className="name">{props.fromChainName}</span>
            <span className="chev" aria-hidden="true">
              <ChevronDown />
            </span>
          </button>
          {props.cross && props.toChainName && (
            <>
              <span className="sw-chain-route" aria-hidden="true">→</span>
              <button className="sw-chain" type="button">
                <span className={`logo ${props.toChainIconClass}`}>{props.toChainGlyph}</span>
                <span className="name">{props.toChainName}</span>
                <span className="chev" aria-hidden="true">
                  <ChevronDown />
                </span>
              </button>
            </>
          )}
          <button
            className={`sw-xchain ${props.cross ? 'is-on' : ''}`.trim()}
            type="button"
            aria-pressed={props.cross}
            onClick={props.onToggleCross}
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
            {props.fromBalance && (
              <>
                &nbsp;{props.fromToken.symbol}&nbsp;
                <button className="max" type="button">Max</button>
              </>
            )}
          </span>
          <input
            id={fromInputId}
            className={`input ${props.fromAmount ? '' : 'is-placeholder'}`.trim()}
            type="text"
            value={props.fromAmount}
            onChange={() => {}}
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
          <div className={`sw-recipient ${props.recipientValid ? 'is-valid' : 'is-invalid'}`}>
            <span className="eyebrow">
              <span className="glyph" aria-hidden="true" />
              EVM recipient
              <span className="req">*</span>
            </span>
            <input
              type="text"
              value={props.recipientValue ?? '0x5a33Bf4A6c1Da92e0F2BcC1eDf8a4D33C8b9c108'}
              onChange={() => {}}
            />
            {!props.recipientValid && (
              <span className="err">Not a valid checksum address</span>
            )}
          </div>
        )}

        {/* Action button (state machine — see 00.27) */}
        <ActionButton state={props.actionState} onClick={props.onActionClick} />
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
