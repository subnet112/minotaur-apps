/**
 * QuoteCard — 00.28 Quote info card.
 *
 * Renders the Minotaur quote (lime-tinted main block with metadata
 * rows) and a comparison panel showing 3 external DEXes with delta
 * vs Minotaur.
 *
 * TTL: a countdown ticks down from the mock quote's `ttlSeconds`. When
 * it hits zero the bar resets — in the real app this would refetch.
 * Here it's pure visual demo of the countdown.
 *
 * Lifted markup mirrors components.html section 00.28 (line 10474 +).
 */
import { useEffect, useState } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'
import type { QuoteDisplay } from '@/types'

interface QuoteCardProps {
  /** Real quote from the store, mapped via SwapPage.mappers. */
  quote: QuoteDisplay
}

export default function QuoteCard({ quote }: QuoteCardProps) {
  // TTL ticks down once per second. On zero we reset to `ttlSeconds`
  // to demo the "refetch" feel without doing an actual network call.
  const [secondsLeft, setSecondsLeft] = useState(quote.ttlSeconds)
  useEffect(() => {
    setSecondsLeft(quote.ttlSeconds)
  }, [quote.ttlSeconds])
  useEffect(() => {
    const id = window.setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? quote.ttlSeconds : s - 1))
    }, 1000)
    return () => window.clearInterval(id)
  }, [quote.ttlSeconds])

  const fillPct = (secondsLeft / quote.ttlSeconds) * 100
  const ttlExpiring = secondsLeft <= 10

  return (
    <section className="sw-quote sw-card">
      <BracketCorners />

      <div className="sw-card-head">
        <span className="eyebrow">
          <span className="glyph" aria-hidden="true" />
          Quote
        </span>
        <span className="ln" aria-hidden="true" />
        <span className={`r sw-quote-ttl ${ttlExpiring ? 'is-expiring' : ''}`.trim()}>
          <span>
            Valid&nbsp;<span className="v">{formatTtl(secondsLeft)}</span>
          </span>
          <span className="bar" aria-hidden="true">
            <i style={{ width: `${fillPct}%` }} />
          </span>
        </span>
      </div>

      <div className="sw-quote-body">
        <div className="sw-quote-main">
          <span className="chip">
            <span className="glyph" aria-hidden="true" />
            Minotaur
          </span>
          <div className="out">
            <span className="n">{quote.toAmount}</span>
            <span className="s">{quote.toSymbol}</span>
            <span className="usd">≈ {quote.toUsd.replace('$', '$ ')}</span>
          </div>
          <div className="sw-quote-rows">
            <div className="row">
              <span className="k">Min received</span>
              <span className="v">{quote.minReceived}</span>
            </div>
            <div className="row">
              <span className="k">Slippage</span>
              <span className="v">{quote.slippagePct}</span>
            </div>
            <div className="row">
              <span className="k">Gas</span>
              <span className="v">{quote.gasUsd}</span>
            </div>
            <div className="row">
              <span className="k">Fee</span>
              <span className="v">{quote.feeUsd}</span>
            </div>
            <div className="row is-route">
              <span className="k">Route</span>
              <span className="v">{quote.routeSummary}</span>
            </div>
          </div>
        </div>

        <div className="sw-cmp">
          <span className="sw-cmp-eyebrow">
            <span className="glyph" aria-hidden="true" />
            <span>Comparison</span>
            <span className="slash">/</span>
            <span>External DEXes</span>
          </span>
          {quote.comparison.map((row) => (
            <div key={row.dex} className={`sw-cmp-row${row.isBest ? ' is-best' : ''}`}>
              <span className="who">
                <span className={`mark ${row.iconClass}`}>{row.glyph}</span>
                <span>{row.dex}</span>
              </span>
              <span className="out">
                <span className="n">{row.outAmount}</span>
                <span className="s">{quote.toSymbol}</span>
              </span>
              <span className={`delta ${row.deltaDir}`}>
                {row.deltaDir === 'down' && '↓ '}
                {row.deltaDir === 'up' && '↑ '}
                {row.deltaPct}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function formatTtl(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
