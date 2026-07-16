/**
 * AppPageHeader — 00.18 App page header.
 *
 * Embedded-app identity strip. Sits below the platform .app-h and
 * carries the per-app brand + wallet/action slots. This is the seam
 * where DexAggregator owns its own chrome.
 *
 * Per the design's three-header-layer model:
 *   .app-h  → platform (Marketplace · Skills · Miners · etc.)
 *   .app-ph → this layer, embedded-app identity (Minotaur · Swap)
 *   .page-h → per-route (not used by Swap — the swap content is the page)
 *
 * Lifted markup mirrors components.html section 00.18 (line 7054 +).
 */
import type { ReactNode } from 'react'
import BracketCorners from '@/components/primitives/BracketCorners'

interface AppPageHeaderProps {
  /** Wallet button + icon button slots (rendered right-aligned). */
  actions: ReactNode
}

export default function AppPageHeader({ actions }: AppPageHeaderProps) {
  return (
    <header className="app-ph" aria-label="App page header — Minotaur Swap">
      <BracketCorners />

      <div className="app-ph-id">
        <h1 className="app-ph-name">
          <span className="platform">Minotaur</span>
          <span className="sep">·</span>
          <span className="app">Swap</span>
        </h1>
        <p className="app-ph-tag">
          <span className="glyph" aria-hidden="true" />
          <span>DEX aggregation on Base &amp; Ethereum</span>
        </p>
      </div>

      <div className="app-ph-actions">{actions}</div>
    </header>
  )
}
