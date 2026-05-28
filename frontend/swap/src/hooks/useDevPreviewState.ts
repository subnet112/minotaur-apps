/**
 * Dev-only hook: when `import.meta.env.DEV` and certain URL params are
 * present, dispatch store actions to put the UI in a deterministic
 * preview state. This is how the design's _state.ts URL contract is
 * preserved for visual-regression and pagewire E2E tests.
 *
 * In production builds, the function body is fully inert — the
 * `if (!import.meta.env.DEV) return` early-exit allows Vite to tree-
 * shake the rest.
 *
 * Honored params:
 *   wallet  = disconnected | metamask | bittensor
 *   cross   = 1
 *   overlay = wallet-panel | token-from | token-to | settings
 *   history = 1
 *   debug   = 1
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useSwapStore } from '@/store'

export function useDevPreviewState() {
  const location = useLocation()
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const params = new URLSearchParams(location.search)
    if (params.size === 0) return

    const store = useSwapStore.getState()

    const wallet = params.get('wallet')
    if (wallet === 'disconnected') {
      store.setWalletConnected(false)
    } else if (wallet === 'metamask' || wallet === 'bittensor') {
      // 'metamask' in URL maps to store's 'external' walletMode.
      const mode = wallet === 'metamask' ? 'external' : wallet
      store.setWalletMode(mode as 'external' | 'bittensor')
      store.setWalletConnected(true)
      // Synthetic preview address — never used to sign.
      store.setWalletAddress('0x5a33Bf4A6c1Da92e0F2BcC1eDf8a4D33C8b9c108')
    }

    if (params.get('cross') === '1') {
      // setSourceChainId(0) sets isCrossChain=true when chainId != 0
      useSwapStore.setState({ isCrossChain: true })
    }

    const overlay = params.get('overlay')
    if (overlay === 'token-from') store.setTokenSelectorOpen('input')
    else if (overlay === 'token-to') store.setTokenSelectorOpen('output')
    else if (overlay === 'settings') store.setShowSettings(true)
    // overlay === 'wallet-panel' has no direct store action yet — see SwapPage

    if (params.get('history') === '1') store.setShowHistory(true)
    if (params.get('debug') === '1') store.setShowDebug(true)
  }, [location.search])
}
