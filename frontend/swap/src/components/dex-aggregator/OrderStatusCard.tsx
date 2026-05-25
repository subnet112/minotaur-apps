/**
 * OrderStatusCard — 00.29 Order status card.
 *
 * 6-state stepper across the top + 2-column detail grid + terminal
 * actions. Driven entirely by real store data:
 *   - step from activeOrder.status
 *   - orderId, txHash, score from activeOrder
 *   - output, surplus, fee, gas from executionDetails
 *
 * The lime fill segment under the rail extends from the first node to
 * the current node, drawing visual progress.
 *
 * Lifted markup mirrors components.html section 00.29 (line 10805 +).
 */
import BracketCorners from '@/components/primitives/BracketCorners'
import { useToast } from '@/components/shell'
import type { OrderStep } from '@/types'

const STEPS: ReadonlyArray<Exclude<OrderStep, 'failed'>> = [
  'pending',
  'open',
  'solved',
  'scored',
  'consensus',
  'filled',
]

const STEP_LABELS: Record<Exclude<OrderStep, 'failed'>, string> = {
  pending: 'Pending',
  open: 'Open',
  solved: 'Solved',
  scored: 'Scored',
  consensus: 'Consensus',
  filled: 'Filled',
}

export interface OrderStatusCardProps {
  /** Current step from store.activeOrder.status */
  step: OrderStep
  /** store.activeOrder.order_id */
  orderId: string
  /** store.activeOrder.tx_hash */
  txHash?: string
  /** store.activeOrder.score */
  score?: number
  /** store.executionDetails.amountOut (formatted string) */
  output?: string
  /** store.executionDetails.surplus (formatted string) */
  surplus?: string
  /** store.executionDetails.fee (formatted string) */
  fee?: string
  /** store.executionDetails.gasUsed (formatted string) */
  gas?: string
  /** CHAIN_CONFIG[chainId].explorer */
  explorerBaseUrl?: string
  onNewSwap: () => void
}

export default function OrderStatusCard({
  step,
  orderId,
  txHash,
  score,
  output,
  surplus,
  fee,
  gas,
  explorerBaseUrl = '',
  onNewSwap,
}: OrderStatusCardProps) {
  const toast = useToast()
  const isFailed = step === 'failed'

  // Map step → index into STEPS array
  // For 'failed', treat as if stopped at 'open' (idx 1) per prototype v4
  const currentIdx = isFailed ? 1 : STEPS.indexOf(step as Exclude<OrderStep, 'failed'>)

  const isTerminal = step === 'filled' || step === 'failed'

  // Lime segment geometry. The 6 nodes sit at evenly-spaced positions
  // (12 columns, each node at 1/12 + idx*2/12 = 8.33% + idx*16.66%).
  // We draw a lime overlay from the first node's centre to the current
  // node's centre.
  const segStartPct = 8.33
  const segWidthPct = currentIdx === 0 ? 0 : currentIdx * 16.66

  // Visibility gates — items reveal as the order progresses
  const showTxHash = currentIdx >= 1 || isFailed
  const showScore = score != null && currentIdx >= 3
  const showOutput = output != null && currentIdx >= 4
  const showSurplus = surplus != null && currentIdx >= 5
  const showFee = fee != null && currentIdx >= 4
  const showGas = gas != null && currentIdx >= 4

  // Short display of order ID for the header (#xxxxx)
  const orderIdShort = orderId ? `#${orderId.slice(0, 5)}` : '#—'

  function handleCopyOrderId() {
    if (!orderId) return
    navigator.clipboard.writeText(orderId).then(() => {
      toast.transient({ title: 'Order ID copied' })
    }).catch(() => {
      toast.error({ title: 'Copy failed' })
    })
  }

  const txHref = txHash && explorerBaseUrl ? `${explorerBaseUrl}/tx/${txHash}` : undefined
  const txDisplay = txHash ? `${txHash.slice(0, 6)}…${txHash.slice(-4)}` : null

  return (
    <section className={`sw-status sw-card ${isFailed ? 'is-failed' : ''}`.trim()}>
      <BracketCorners />

      <div className="sw-card-head">
        <span className="eyebrow">
          <span className="glyph" aria-hidden="true" />
          Order status
        </span>
        <span className="ln" aria-hidden="true" />
        <span className="r">
          <button
            type="button"
            className="copy"
            onClick={handleCopyOrderId}
            aria-label="Copy order ID"
            title="Copy full order ID"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {orderIdShort}
          </button>
          {isTerminal && !isFailed && <span className="v">&nbsp;·&nbsp;filled</span>}
        </span>
      </div>

      <div className="sw-status-body">
        <div className="sw-prog">
          {!isFailed && segWidthPct > 0 && (
            <div className="seg" style={{ left: `${segStartPct}%`, width: `${segWidthPct}%` }} />
          )}
          {STEPS.map((s, idx) => {
            const cls = isFailed
              ? idx === 1
                ? 'is-failed' // mark "open" as the failed node per prototype v4
                : idx === 0
                ? 'is-done'
                : ''
              : idx < currentIdx
              ? 'is-done'
              : idx === currentIdx
              ? 'is-current'
              : ''
            return (
              <div key={s} className={`node ${cls}`.trim()}>
                <span className="d" aria-hidden="true" />
                <span className="lbl">{STEP_LABELS[s]}</span>
              </div>
            )
          })}
        </div>

        <div className="sw-status-rows">
          <div className="row">
            <span className="k">Tx hash</span>
            <span className={`v ${showTxHash && txDisplay ? '' : 'dim'}`.trim()}>
              {showTxHash && txDisplay ? (
                txHref ? (
                  <a className="copy" href={txHref} target="_blank" rel="noopener noreferrer">
                    {txDisplay}{' '}
                    <span className="ext" aria-hidden="true">
                      <ExternalGlyph />
                    </span>
                  </a>
                ) : (
                  <span className="copy">{txDisplay}</span>
                )
              ) : (
                showTxHash ? '—' : '— pending'
              )}
            </span>
          </div>
          <div className="row">
            <span className="k">Score</span>
            <span className={`v ${showScore ? '' : 'dim'}`.trim()}>
              {showScore && score != null ? score.toFixed(4) : '—'}
            </span>
          </div>
          <div className="row">
            <span className="k">Output</span>
            <span className={`v ${showOutput ? '' : 'dim'}`.trim()}>
              {showOutput && output ? output : '—'}
            </span>
          </div>
          <div className="row">
            <span className="k">Surplus</span>
            <span className={`v ${showSurplus ? 'lime' : 'dim'}`.trim()}>
              {showSurplus && surplus ? `+${surplus}` : '—'}
            </span>
          </div>
          <div className="row">
            <span className="k">Fee</span>
            <span className={`v ${showFee ? '' : 'dim'}`.trim()}>
              {showFee && fee ? fee : '—'}
            </span>
          </div>
          <div className="row">
            <span className="k">Gas</span>
            <span className={`v ${showGas ? '' : 'dim'}`.trim()}>
              {showGas && gas ? gas : '—'}
            </span>
          </div>
        </div>

        {isTerminal && (
          <div className="sw-status-actions">
            {txHref && (
              <a
                className="a-ghost"
                href={txHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on explorer&nbsp;<span style={{ fontSize: '10px' }}>↗</span>
              </a>
            )}
            {!txHref && (
              <button className="a-ghost" type="button" disabled>
                View on explorer&nbsp;<span style={{ fontSize: '10px' }}>↗</span>
              </button>
            )}
            <button className="a-primary" type="button" onClick={onNewSwap}>
              New swap&nbsp;<span style={{ fontSize: '10px' }}>→</span>
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

function ExternalGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M5 1 H 11 V 7 M11 1 L 5.5 6.5 M11 6 V 11 H 1 V 1 H 6"
        stroke="currentColor"
        strokeWidth="1.05"
        fill="none"
        strokeLinecap="square"
      />
    </svg>
  )
}
