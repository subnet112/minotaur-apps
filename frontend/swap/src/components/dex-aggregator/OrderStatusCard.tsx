/**
 * OrderStatusCard — 00.29 Order status card.
 *
 * 6-state stepper across the top + 2-column detail grid + terminal
 * actions. When `autoAdvance` is true (default), the stepper marches
 * forward one node every ~2s for demo. When the parent passes an
 * explicit `step`, that wins and disables auto-advance.
 *
 * The lime fill segment under the rail extends from the first node to
 * the current node, drawing visual progress.
 *
 * Lifted markup mirrors components.html section 00.29 (line 10805 +).
 */
import { useEffect, useState } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
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

interface OrderStatusCardProps {
  /** Pin the current step (also disables auto-advance). */
  step?: OrderStep
  /** Demo mode: advances one node every ~2 s. Default true when step omitted. */
  autoAdvance?: boolean
  onNewSwap: () => void
}

export default function OrderStatusCard({ step, autoAdvance = true, onNewSwap }: OrderStatusCardProps) {
  // If the parent pinned a step, that's the source of truth. Otherwise
  // we drive our own counter and bump it every ~2 s.
  const isFailed = step === 'failed'
  const initial = step && step !== 'failed' ? STEPS.indexOf(step) : 0
  const [currentIdx, setCurrentIdx] = useState(initial)

  useEffect(() => {
    if (step && step !== 'failed') {
      setCurrentIdx(STEPS.indexOf(step))
    }
  }, [step])

  useEffect(() => {
    if (step) return // pinned
    if (!autoAdvance) return
    const id = window.setInterval(() => {
      setCurrentIdx((i) => Math.min(i + 1, STEPS.length - 1))
    }, 2000)
    return () => window.clearInterval(id)
  }, [step, autoAdvance])

  const isTerminal = isFailed || (step === 'filled' || (!step && currentIdx >= STEPS.length - 1))

  // Lime segment geometry. The 6 nodes sit at evenly-spaced positions
  // (12 columns, each node at 1/12 + idx*2/12 = 8.33% + idx*16.66%).
  // We draw a lime overlay from the first node's centre to the current
  // node's centre.
  const segStartPct = 8.33
  const segWidthPct = currentIdx === 0 ? 0 : currentIdx * 16.66

  // Detail rows that resolve as the order progresses.
  const showTxHash = currentIdx >= 1 || isFailed
  const showScore = currentIdx >= 3
  const showOutput = currentIdx >= 4
  const showSurplus = currentIdx >= 5
  const showFee = currentIdx >= 4
  const showGas = currentIdx >= 4

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
          #abc12
          {isTerminal && !isFailed && <span className="v">&nbsp;·&nbsp;0:08 total</span>}
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
            <span className={`v ${showTxHash ? '' : 'dim'}`.trim()}>
              {showTxHash ? (
                <span className="copy">
                  0x9a3f…e21c{' '}
                  <span className="ext" aria-hidden="true">
                    <ExternalGlyph />
                  </span>
                </span>
              ) : (
                '— pending'
              )}
            </span>
          </div>
          <div className="row">
            <span className="k">Score</span>
            <span className={`v ${showScore ? '' : 'dim'}`.trim()}>{showScore ? '0.984' : '—'}</span>
          </div>
          <div className="row">
            <span className="k">Output</span>
            <span className={`v ${showOutput ? '' : 'dim'}`.trim()}>{showOutput ? '0.3151 ETH' : '—'}</span>
          </div>
          <div className="row">
            <span className="k">Surplus</span>
            <span className={`v ${showSurplus ? 'lime' : 'dim'}`.trim()}>
              {showSurplus ? '+0.0057 · $18.20' : '—'}
            </span>
          </div>
          <div className="row">
            <span className="k">Fee</span>
            <span className={`v ${showFee ? '' : 'dim'}`.trim()}>{showFee ? '$ 0.40' : '—'}</span>
          </div>
          <div className="row">
            <span className="k">Gas</span>
            <span className={`v ${showGas ? '' : 'dim'}`.trim()}>{showGas ? '$ 2.18' : '—'}</span>
          </div>
        </div>

        {isTerminal && (
          <div className="sw-status-actions">
            <button className="a-ghost" type="button">
              View on explorer&nbsp;<span style={{ fontSize: '10px' }}>↗</span>
            </button>
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
