/**
 * SwapReviewCard — Step 2 of the 3-step swap flow.
 *
 * Shows the quote details (QuoteCard) plus:
 *   - "← Back to edit" link at the top
 *   - ActionButton driven by the real state machine — first an approve
 *     (if allowance is missing), then "Confirm swap" / "Sign & broadcast"
 *
 * The component does NOT own state; it receives the same actionState +
 * onActionClick the form would have, plus an onBack callback so the page
 * can transition back to step 1.
 *
 * Layout mirrors SwapForm (.sw-card + BracketCorners + same 580 px max
 * width via .dex-content) so step 1 → step 2 swap looks like a panel
 * change, not a layout reflow.
 */
import BracketCorners from '@/components/primitives/BracketCorners'
import type { ActionState, QuoteDisplay } from '@/types'
import ActionButton from './ActionButton'
import QuoteCard from './QuoteCard'

interface SwapReviewCardProps {
  quote: QuoteDisplay
  actionState: ActionState
  onActionClick: () => void
  onBack: () => void
  /** Symbol for {token} substitution in Approve/Insufficient labels. */
  tokenSymbol?: string
  /** Force the button disabled until the disclaimer is ticked. The page
   *  shares the same flag with SwapForm so step 2's confirm can't fire
   *  without consent either. */
  forceDisabled?: boolean
  /** Optional help line under the button — page renders the approve copy
   *  here just like it does in step 1, so users see the same explainer
   *  on whichever screen they happen to be on. */
  helpText?: React.ReactNode
}

export default function SwapReviewCard(props: SwapReviewCardProps) {
  return (
    <section className="sw-review sw-card">
      <BracketCorners />

      <header className="sw-review-head">
        <button
          type="button"
          className="sw-review-back"
          onClick={props.onBack}
          aria-label="Back to edit"
        >
          <span aria-hidden="true">←</span>
          <span>Back to edit</span>
        </button>
        <span className="sw-review-title">Review swap</span>
      </header>

      <div className="sw-review-body">
        <QuoteCard quote={props.quote} />

        <div className="sw-review-action">
          <ActionButton
            state={props.actionState}
            onClick={props.onActionClick}
            forceDisabled={props.forceDisabled}
            tokenSymbol={props.tokenSymbol}
          />
          {props.helpText && (
            <p className="sw-action-help">{props.helpText}</p>
          )}
        </div>
      </div>
    </section>
  )
}
