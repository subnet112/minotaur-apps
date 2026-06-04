/**
 * AppWalletButton — design 00.19 (.app-wallet + .app-wallet-menu).
 *
 * Replaces RainbowKit's default <ConnectButton> chrome with the design
 * system's three states:
 *   - Disconnected: ghost-hairline frame, label "Connect wallet", chevron.
 *     Click opens the RainbowKit connect modal (we keep that flow — it's
 *     where the user picks their wallet provider).
 *   - Connected · resting: lime mode dot + CHAIN + truncated address +
 *     chevron. Click opens the custom dropdown below (NOT RainbowKit's
 *     account modal).
 *   - Dropdown: account header, Copy address / Switch chain / Switch
 *     wallet, Recent swaps mini-feed, View all orders, Disconnect.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useDisconnect } from 'wagmi'
import { useToast } from '@/components/shell'
import { useSwapStore } from '@/store'
import { CHAIN_CONFIG } from '@/config/chains'
import { TERMINAL_FILLED, TERMINAL_FAILED } from '@/lib/orderStatus'
import type { SwapHistoryItem } from '@/types'

function shorten(addr: string, n = 4): string {
  if (!addr || addr.length <= n * 2 + 1) return addr
  return `${addr.slice(0, n + 2)}…${addr.slice(-n)}`
}

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

function statusBadge(status: string): 'confirmed' | 'pending' | 'failed' {
  if (TERMINAL_FILLED.has(status)) return 'confirmed'
  if (TERMINAL_FAILED.has(status)) return 'failed'
  return 'pending'
}

export default function AppWalletButton() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const toast = useToast()
  const { disconnect } = useDisconnect()
  const recentSwaps = useSwapStore((s) => s.recentSwaps)

  // Position the portal-rendered dropdown right under the button. Recomputed
  // on open and whenever the window resizes — we use fixed positioning, so
  // these coords are relative to the iframe viewport.
  useLayoutEffect(() => {
    if (!menuOpen) return
    const recompute = () => {
      const rect = btnRef.current?.getBoundingClientRect()
      if (!rect) return
      const vw = window.innerWidth
      setAnchor({ top: rect.bottom + 6, right: vw - rect.right })
    }
    recompute()
    window.addEventListener('resize', recompute)
    return () => window.removeEventListener('resize', recompute)
  }, [menuOpen])

  // Escape closes the menu.
  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openChainModal, mounted, authenticationStatus }) => {
        const ready = mounted && authenticationStatus !== 'loading'
        const connected = ready && !!account && !!chain
        return (
          <>
            {!connected ? (
              <button
                ref={btnRef}
                className="app-wallet"
                type="button"
                onClick={openConnectModal}
                disabled={!ready}
              >
                <span>Connect wallet</span>
                <span className="chev" aria-hidden="true" />
              </button>
            ) : (
              <button
                ref={btnRef}
                className="app-wallet is-connected is-metamask"
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="app-wallet-mode">
                  <span className="d" aria-hidden="true" />
                  {(chain.name || 'BASE').toUpperCase()}
                </span>
                <span className="app-wallet-addr">{shorten(account.address)}</span>
                <span className="chev" aria-hidden="true" />
              </button>
            )}

            {menuOpen && connected && anchor && createPortal(
              <>
                {/* Backdrop — full-viewport, sits at document.body level
                    so no ancestor styling (transform/filter/contain on a
                    parent) can break its hit target. */}
                <div
                  onClick={() => setMenuOpen(false)}
                  style={{
                    position: 'fixed',
                    top: 0, right: 0, bottom: 0, left: 0,
                    zIndex: 9998,
                    background: 'transparent',
                  }}
                  aria-hidden="true"
                />
                {/* Dropdown — also portalled and fixed-positioned, so it
                    can never be clipped by an ancestor and lives in a
                    clean stacking context above everything else. */}
                <div
                  className="app-wallet-menu is-floating"
                  role="menu"
                  style={{
                    position: 'fixed',
                    top: anchor.top,
                    right: anchor.right,
                    zIndex: 9999,
                  }}
                >
                  <DropdownBody
                    address={account.address}
                    chainName={chain.name || 'Base'}
                    recentSwaps={recentSwaps}
                    onCopy={() => {
                      navigator.clipboard.writeText(account.address)
                        .then(() => toast.transient({ title: 'Address copied' }))
                        .catch(() => toast.error({ title: 'Copy failed' }))
                      setMenuOpen(false)
                    }}
                    onSwitchChain={() => { openChainModal(); setMenuOpen(false) }}
                    onSwitchWallet={() => { openConnectModal(); setMenuOpen(false) }}
                    onDisconnect={() => { disconnect(); setMenuOpen(false) }}
                  />
                </div>
              </>,
              document.body,
            )}
          </>
        )
      }}
    </ConnectButton.Custom>
  )
}

interface DropdownBodyProps {
  address: string
  chainName: string
  recentSwaps: SwapHistoryItem[]
  onCopy: () => void
  onSwitchChain: () => void
  onSwitchWallet: () => void
  onDisconnect: () => void
}

// Just the inner contents of the dropdown. The outer .app-wallet-menu
// wrapper is rendered by AppWalletButton's portal so it can be portalled
// directly into document.body with its own fixed positioning.
function DropdownBody({ address, chainName, recentSwaps, onCopy, onSwitchChain, onSwitchWallet, onDisconnect }: DropdownBodyProps) {
  return (
    <>
      <span className="ct tl" aria-hidden="true" />
      <span className="ct tr" aria-hidden="true" />
      <span className="ct bl" aria-hidden="true" />
      <span className="ct br" aria-hidden="true" />

      <div className="app-wallet-menu-head">
        <span className="k">
          <span className="d" aria-hidden="true" />
          Wallet&nbsp;·&nbsp;<span className="v">{chainName}</span>
        </span>
        <span className="addr">{address}</span>
      </div>

      <div className="app-wallet-menu-list">
        <button className="item" type="button" onClick={onCopy} role="menuitem">
          <span className="ico"><CopyIcon /></span>
          <span>Copy address</span>
          <span className="kbd">⌘C</span>
        </button>
        <button className="item" type="button" onClick={onSwitchChain} role="menuitem">
          <span className="ico"><SwitchIcon /></span>
          <span>Switch chain</span>
          <span className="kbd">→</span>
        </button>
        <button className="item" type="button" onClick={onSwitchWallet} role="menuitem">
          <span className="ico"><WalletIcon /></span>
          <span>Switch wallet</span>
        </button>
      </div>

      {recentSwaps.length > 0 && (
        <div className="wm-recent">
          <div className="wm-recent-head">
            <span className="glyph" aria-hidden="true" />
            <span>Recent swaps</span>
            <span className="ct-count">{String(recentSwaps.length).padStart(2, '0')}&nbsp;TOTAL</span>
          </div>
          {recentSwaps.slice(0, 4).map((swap) => {
            const badge = statusBadge(swap.status)
            const explorer = CHAIN_CONFIG[swap.chainId]?.explorer
            const txHref = swap.txHash && explorer ? `${explorer}/tx/${swap.txHash}` : undefined
            return (
              <a
                key={swap.orderId}
                className="wm-swap"
                href={txHref || '#'}
                target={txHref ? '_blank' : undefined}
                rel="noopener noreferrer"
                onClick={txHref ? undefined : (e) => e.preventDefault()}
              >
                <span className="wm-swap-pair">
                  <b>{swap.inputAmount}</b>&nbsp;<span className="s">{swap.inputToken}</span>
                  &nbsp;<span className="arr">→</span>&nbsp;
                  <b>{swap.outputAmount}</b>&nbsp;<span className="s">{swap.outputToken}</span>
                </span>
                <span className="wm-swap-meta">
                  <span className={`wm-swap-status is-${badge}`}><span className="d" aria-hidden="true" /></span>
                  <span className="wm-swap-ts">{relTime(swap.timestamp)}</span>
                </span>
              </a>
            )
          })}
        </div>
      )}

      {/* The swap lives in an iframe at app.minotaursubnet.com/swap/; the
          orders page is at the outer app's /orders. target="_top" breaks
          out of the iframe — same origin so no x-frame issues. */}
      <a className="item wm-view-all" href="/orders" target="_top" rel="noopener">
        <span className="ico"><ArrowIcon /></span>
        <span>View all orders</span>
        <span className="kbd">↗</span>
      </a>

      <div className="app-wallet-menu-list">
        <button className="item is-danger" type="button" onClick={onDisconnect} role="menuitem">
          <span className="ico"><DisconnectIcon /></span>
          <span>Disconnect</span>
        </button>
      </div>
    </>
  )
}

// Inline 11×11 icons matching the design system's stroke conventions.
function CopyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="9" stroke="currentColor" strokeWidth="1.1" fill="none" />
      <path d="M5 3.5 L5 1.5 L12 1.5 L12 10.5 L10 10.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
    </svg>
  )
}
function SwitchIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 4 L10 4 M7 1.5 L10 4 L7 6.5 M10 8 L2 8 M5 5.5 L2 8 L5 10.5" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="square" />
    </svg>
  )
}
function WalletIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <rect x="1" y="3" width="10" height="7" stroke="currentColor" strokeWidth="1.1" fill="none" />
      <path d="M1 4.5 L8 4.5" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="8.5" cy="6.5" r="0.7" fill="currentColor" />
    </svg>
  )
}
function ArrowIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2 6 L10 6 M7 3 L10 6 L7 9" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="square" />
    </svg>
  )
}
function DisconnectIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M5 6 L11 6 M8.5 3.5 L11 6 L8.5 8.5 M5 1.5 L1.5 1.5 L1.5 10.5 L5 10.5" stroke="currentColor" strokeWidth="1.1" fill="none" strokeLinecap="square" />
    </svg>
  )
}
