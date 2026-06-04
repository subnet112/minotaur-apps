/**
 * SwapSuccessCard — Step 3 (filled variant) of the 3-step flow.
 *
 * Replaces OrderStatusCard when activeOrder.status reaches a terminal
 * filled state. Stripped-down celebration: big mono headline, output
 * amount in large display type, surplus call-out if any, tx + share +
 * "Swap again" actions. No stepper, no detail grid — the order is done.
 *
 * Failed orders STAY on OrderStatusCard so the user can see the stepper
 * frozen at the failure node + the reason string.
 *
 * Brand-consistent with the swap UI: brutalist mono, lime celebration
 * accents, no animated balloons / particles. The Minotaur lockup at the
 * top is the visual anchor.
 */
import BracketCorners from '@/components/primitives/BracketCorners'
import { useToast } from '@/components/shell'

interface SwapSuccessCardProps {
  orderId: string
  txHash?: string
  /** Formatted amount-out string (e.g. "1,234.56"). */
  output?: string
  /** Output token symbol (USDC / WETH / etc). */
  outputSymbol?: string
  /** Formatted surplus string — what the user got beyond the quoted minimum. */
  surplus?: string
  /** Formatted gas cost. */
  gas?: string
  /** CHAIN_CONFIG[chainId].explorer — used for the tx link. */
  explorerBaseUrl?: string
  onNewSwap: () => void
  /** Optional "view full details" — defaults to going to /orders inside
   *  the iframe so the user can see the stepper + detail grid. */
  onViewDetails?: () => void
}

export default function SwapSuccessCard({
  orderId,
  txHash,
  output,
  outputSymbol,
  surplus,
  gas,
  explorerBaseUrl = '',
  onNewSwap,
  onViewDetails,
}: SwapSuccessCardProps) {
  const toast = useToast()
  const txHref = txHash && explorerBaseUrl ? `${explorerBaseUrl}/tx/${txHash}` : undefined
  const txDisplay = txHash ? `${txHash.slice(0, 6)}…${txHash.slice(-4)}` : null
  const orderIdShort = orderId ? `#${orderId.slice(0, 8)}` : '#—'

  function handleCopyTx() {
    if (!txHash) return
    navigator.clipboard.writeText(txHash).then(
      () => toast.transient({ title: 'Tx hash copied' }),
      () => toast.error({ title: 'Copy failed' }),
    )
  }

  return (
    <section className="sw-success sw-card">
      <BracketCorners />

      <div className="sw-success-hero">
        {/* Lockup at hero size. Lives in /public so the iframe serves it
            from the same origin — no CSP / x-origin concerns. */}
        <img src="/swap/logo-minotaur.svg" alt="Minotaur" className="sw-success-mark" />
        <span className="sw-success-tag">
          <span className="d" aria-hidden="true" />
          Settled
        </span>
      </div>

      <h2 className="sw-success-title">
        Swap complete.
      </h2>

      {output && outputSymbol && (
        <div className="sw-success-out">
          <span className="n">{output}</span>
          <span className="s">{outputSymbol}</span>
        </div>
      )}

      <div className="sw-success-rows">
        {surplus && (
          <div className="row">
            <span className="k">Surplus</span>
            <span className="v lime">+{surplus}</span>
          </div>
        )}
        {gas && (
          <div className="row">
            <span className="k">Gas</span>
            <span className="v">{gas}</span>
          </div>
        )}
        <div className="row">
          <span className="k">Order</span>
          <span className="v mono">{orderIdShort}</span>
        </div>
        {txDisplay && (
          <div className="row">
            <span className="k">Tx</span>
            <span className="v mono">
              {txHref ? (
                <a href={txHref} target="_blank" rel="noopener noreferrer">
                  {txDisplay} <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <button
                  type="button"
                  className="sw-success-tx-copy"
                  onClick={handleCopyTx}
                  title="Copy tx hash"
                >
                  {txDisplay}
                </button>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="sw-success-actions">
        {onViewDetails && (
          <button type="button" className="a-ghost" onClick={onViewDetails}>
            View details <span aria-hidden="true">↗</span>
          </button>
        )}
        <button type="button" className="a-primary" onClick={onNewSwap}>
          Swap again <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  )
}
