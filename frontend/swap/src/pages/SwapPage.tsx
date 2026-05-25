/**
 * SwapPage — /swap
 *
 * Real-data orchestrator that mirrors the design's DexAggregatorPage
 * line-by-line. Same JSX, same conditional rendering, same modal
 * mutual exclusion. Differences limited to:
 *   - hooks fire real side effects
 *   - props come from store selectors + mappers, not URL params + mocks
 *   - StateSwitcher is dropped (URL-state previewer is meaningless with
 *     real Zustand; useDevPreviewState handles URL-driven preview in dev)
 *
 * Spec: docs/superpowers/specs/2026-05-25-dex-design-consolidation-design.md §5.3
 */
import { useSwapStore } from '@/store'
import { selectActionState, selectModeBlockVariant } from '@/selectors'
import {
  mapStoreToSwapFormProps,
  mapQuoteResultToQuoteCardProps,
} from './SwapPage.mappers'
import type { Token, TokenDisplay, OrderStep } from '@/types'
import { CHAIN_CONFIG } from '@/config/chains'

import { useAppBootstrap } from '@/hooks/useAppBootstrap'
import { useDevPreviewState } from '@/hooks/useDevPreviewState'
import {
  useMetaMaskListener,
  useWalletConnection,
} from '@/hooks/useWalletConnection'
import { useWalletBalances } from '@/hooks/useWalletBalances'
import { useQuoteRequest } from '@/hooks/useQuoteRequest'
import { useQuoteExpiry } from '@/hooks/useQuoteExpiry'
import { useOrderSubmission } from '@/hooks/useOrderSubmission'

import AppPageHeader from '@/components/dex-aggregator/AppPageHeader'
import WalletButton from '@/components/dex-aggregator/WalletButton'
import HeaderIconButton from '@/components/dex-aggregator/HeaderIconButton'
import SwapForm from '@/components/dex-aggregator/SwapForm'
import TokenSelectorModal from '@/components/dex-aggregator/TokenSelectorModal'
import WalletModeBlock from '@/components/dex-aggregator/WalletModeBlock'
import QuoteCard from '@/components/dex-aggregator/QuoteCard'
import OrderStatusCard from '@/components/dex-aggregator/OrderStatusCard'
import SettingsSheet from '@/components/dex-aggregator/SettingsSheet'
import RevealPanel from '@/components/dex-aggregator/RevealPanel'
import type { ModeBlock } from '@/types'

/**
 * Synthesize a TokenDisplay shape from a functional Token for design components
 * that require TokenDisplay fields (glyph, iconClass). These fields don't exist
 * on the functional Token type — we derive them here rather than polluting Token.
 */
function toTokenDisplay(t: Token): TokenDisplay {
  const sym = t.symbol.toLowerCase()
  const iconMap: Record<string, TokenDisplay['iconClass']> = {
    usdc: 'usdc',
    usdt: 'usdt',
    eth: 'eth',
    weth: 'eth',
    wbtc: 'wbtc',
    tao: 'tao',
    dai: 'dai',
    arb: 'arb',
    link: 'link',
  }
  return {
    symbol: t.symbol,
    name: t.name ?? t.symbol,
    glyph: t.symbol.charAt(0).toUpperCase(),
    iconClass: iconMap[sym] ?? 'usdc',
    balance: '—',
    usd: '$0.00',
  }
}

/** Fallback TokenDisplay for when no token is selected yet. */
const PLACEHOLDER_TOKEN: TokenDisplay = {
  symbol: '—',
  name: 'Select token',
  glyph: '?',
  iconClass: 'usdc',
  balance: '—',
  usd: '$0.00',
}

export default function SwapPage() {
  // Side-effect hooks
  useAppBootstrap()
  useMetaMaskListener()
  useWalletBalances()
  const { requestQuote } = useQuoteRequest()
  useQuoteExpiry(requestQuote)
  useDevPreviewState()

  const { submitSwap } = useOrderSubmission()
  const wallet = useWalletConnection()

  // Read slices from store
  const walletMode = useSwapStore((s) => s.walletMode)
  const walletConnected = useSwapStore((s) => s.walletConnected)
  const inputToken = useSwapStore((s) => s.inputToken)
  const outputToken = useSwapStore((s) => s.outputToken)
  const inputAmount = useSwapStore((s) => s.inputAmount)
  const quote = useSwapStore((s) => s.quote)
  const quoteExpiry = useSwapStore((s) => s.quoteExpiry)
  const activeOrder = useSwapStore((s) => s.activeOrder)
  const executionDetails = useSwapStore((s) => s.executionDetails)
  const showHistory = useSwapStore((s) => s.showHistory)
  const showDebug = useSwapStore((s) => s.showDebug)
  const tokenSelectorOpen = useSwapStore((s) => s.tokenSelectorOpen)
  const showSettings = useSwapStore((s) => s.showSettings)
  const isCrossChain = useSwapStore((s) => s.isCrossChain)
  const evmRecipient = useSwapStore((s) => s.evmRecipient)
  const setInputToken = useSwapStore((s) => s.setInputToken)
  const setOutputToken = useSwapStore((s) => s.setOutputToken)
  const setTokenSelectorOpen = useSwapStore((s) => s.setTokenSelectorOpen)
  const setShowSettings = useSwapStore((s) => s.setShowSettings)
  const setShowHistory = useSwapStore((s) => s.setShowHistory)
  const setShowDebug = useSwapStore((s) => s.setShowDebug)
  const setWalletConnected = useSwapStore((s) => s.setWalletConnected)
  const swapTokens = useSwapStore((s) => s.swapTokens)
  const sourceChainId = useSwapStore((s) => s.sourceChainId)
  const chainId = useSwapStore((s) => s.chainId)
  const inputBalance = useSwapStore((s) => s.inputBalance)
  const outputBalance = useSwapStore((s) => s.outputBalance)
  const slippageBps = useSwapStore((s) => s.slippageBps)
  const loading = useSwapStore((s) => s.loading)

  // Derived
  const actionState = useSwapStore(selectActionState as (s: Parameters<typeof selectActionState>[0]) => ReturnType<typeof selectActionState>)
  const modeBlockRaw = useSwapStore(selectModeBlockVariant as (s: Parameters<typeof selectModeBlockVariant>[0]) => ReturnType<typeof selectModeBlockVariant>)
  // Cast: null means don't render; non-null is always Exclude<ModeBlock,'none'>
  const modeBlockVariant = (modeBlockRaw && modeBlockRaw !== 'none')
    ? modeBlockRaw as Exclude<ModeBlock, 'none'>
    : null

  // Active address — derived from wallet mode + individual address fields
  const activeAddress = useSwapStore((s) => {
    if (s.walletMode === 'managed' && s.managedWallet) return s.managedWallet.address
    if (s.walletMode === 'bittensor' && s.bittensorAddress) return s.bittensorAddress
    return s.walletAddress
  })

  // Map store wallet mode (3 values + bool) into design's 4-value union
  const designWallet =
    !walletConnected
      ? ('disconnected' as const)
      : walletMode === 'external'
        ? ('metamask' as const)
        : walletMode

  // Single overlay slot — settings > token-from > token-to
  const overlay: 'settings' | 'token-from' | 'token-to' | null =
    showSettings
      ? 'settings'
      : tokenSelectorOpen === 'input'
        ? 'token-from'
        : tokenSelectorOpen === 'output'
          ? 'token-to'
          : null

  // SwapForm props via mapper
  const swapFormBase = mapStoreToSwapFormProps({
    sourceChainId,
    chainId,
    isCrossChain,
    inputToken,
    outputToken,
    inputAmount,
    inputBalance,
    outputBalance,
    walletMode,
    walletConnected,
    slippageBps,
    loading,
    quote,
    evmRecipient,
  })

  // TokenDisplay shapes for SwapForm's fromToken/toToken
  const fromTokenDisplay = inputToken ? toTokenDisplay(inputToken) : PLACEHOLDER_TOKEN
  const toTokenDisplay_ = outputToken ? toTokenDisplay(outputToken) : PLACEHOLDER_TOKEN

  function handleAction() {
    if (actionState === 'disconnected') {
      // Open wallet connect via external wallet as default
      wallet.connectExternalWallet?.()
      return
    }
    if (actionState === 'wrong-network') {
      // User needs to switch chain in their wallet — nothing to do here
      return
    }
    if (actionState === 'swap-ready' || actionState === 'sign-broadcast') {
      submitSwap()
    }
  }

  return (
    <>
      <AppPageHeader
        actions={
          <>
            <WalletButton
              mode={designWallet}
              address={activeAddress}
              onClick={() => {
                if (!walletConnected) {
                  wallet.connectExternalWallet?.()
                } else {
                  // Design pending per IMPL §3.2 — disconnect-on-click placeholder
                  setWalletConnected(false)
                }
              }}
            />
            <HeaderIconButton
              role="history"
              active={showHistory}
              onClick={() => setShowHistory(!showHistory)}
            />
            {import.meta.env.DEV && (
              <HeaderIconButton
                role="debug"
                active={showDebug}
                onClick={() => setShowDebug(!showDebug)}
              />
            )}
          </>
        }
      />

      <section className="dex-stage" aria-label="Swap content">
        <div className="dex-content">
          {modeBlockVariant && (
            <div className="sw-stack">
              <WalletModeBlock variant={modeBlockVariant} />
            </div>
          )}

          <SwapForm
            {...swapFormBase}
            fromToken={fromTokenDisplay}
            toToken={toTokenDisplay_}
            fromAmount={inputAmount}
            fromUsd={`$${inputAmount || '0.00'}`}
            toAmount={String(quote?.estimated_output ?? '')}
            toUsd={quote ? `$${quote.estimated_output ?? ''}` : '$0.00'}
            toIsQuoted={!!quote}
            cross={isCrossChain}
            onToggleCross={() => useSwapStore.setState({ isCrossChain: !isCrossChain })}
            showRecipient={isCrossChain && walletMode === 'bittensor'}
            recipientValid={
              isCrossChain && walletMode === 'bittensor'
                ? /^0x[a-fA-F0-9]{40}$/.test(evmRecipient)
                : true
            }
            recipientValue={evmRecipient}
            onSwapDirection={() => swapTokens()}
            onPickFromToken={() => setTokenSelectorOpen('input')}
            onPickToToken={() => setTokenSelectorOpen('output')}
            onOpenSettings={() => setShowSettings(true)}
            wallet={designWallet}
            actionState={actionState}
            onActionClick={handleAction}
          />

          {quote && !activeOrder && inputToken && outputToken && (
            <QuoteCard
              quote={mapQuoteResultToQuoteCardProps(
                quote,
                inputToken,
                outputToken,
                inputAmount,
                quoteExpiry ?? 0,
              )}
            />
          )}

          {activeOrder && (
            <OrderStatusCard
              step={activeOrder.status as OrderStep}
              orderId={activeOrder.order_id}
              txHash={activeOrder.tx_hash ?? undefined}
              score={activeOrder.score ?? undefined}
              output={executionDetails?.amountOut}
              surplus={executionDetails?.surplus}
              fee={executionDetails?.fee}
              gas={executionDetails?.gasUsed}
              explorerBaseUrl={CHAIN_CONFIG[chainId]?.explorer ?? ''}
              onNewSwap={() => {
                useSwapStore.getState().setActiveOrder(null)
                useSwapStore.getState().setInputAmount('')
              }}
            />
          )}

          {showHistory && (
            <RevealPanel
              role="history"
              wallet={designWallet}
              onClose={() => setShowHistory(false)}
            />
          )}

          {import.meta.env.DEV && showDebug && (
            <RevealPanel
              role="debug"
              wallet={designWallet}
              onClose={() => setShowDebug(false)}
            />
          )}
        </div>
      </section>

      {/* Modals (mutually exclusive at z=100) */}
      {overlay === 'token-from' && (
        <TokenSelectorModal
          oppositeSymbol={outputToken?.symbol ?? ''}
          onSelect={(t) => {
            // TokenSelectorModal deals in TokenDisplay; map back to a
            // functional Token by looking up by symbol in the store's
            // solver tokens, falling back to a minimal object.
            const solverTokens = useSwapStore.getState().solverTokens
            const chainTokens = solverTokens[sourceChainId] ?? solverTokens[chainId] ?? []
            const match = chainTokens.find(
              (tok) => tok.symbol.toUpperCase() === t.symbol.toUpperCase(),
            )
            setInputToken(match ?? tokenFromDisplay(t))
            setTokenSelectorOpen(null)
          }}
          onClose={() => setTokenSelectorOpen(null)}
        />
      )}
      {overlay === 'token-to' && (
        <TokenSelectorModal
          oppositeSymbol={inputToken?.symbol ?? ''}
          onSelect={(t) => {
            // TokenSelectorModal deals in TokenDisplay; map back to functional Token.
            const solverTokens = useSwapStore.getState().solverTokens
            const chainTokens = solverTokens[chainId] ?? solverTokens[sourceChainId] ?? []
            const match = chainTokens.find(
              (tok) => tok.symbol.toUpperCase() === t.symbol.toUpperCase(),
            )
            setOutputToken(match ?? tokenFromDisplay(t))
            setTokenSelectorOpen(null)
          }}
          onClose={() => setTokenSelectorOpen(null)}
        />
      )}
      {overlay === 'settings' && (
        <SettingsSheet
          wallet={designWallet}
          onClose={() => setShowSettings(false)}
        />
      )}
      {/* WalletConnectPanel is design-pending for the connected-state menu (IMPL §3.2).
          Wired later as a follow-up. */}
    </>
  )
}

/**
 * Last-resort fallback: construct a minimal functional Token from a TokenDisplay
 * when the solver token list doesn't contain a match. Used only if the modal
 * is opened before bootstrap has loaded solver tokens (rare edge case).
 */
function tokenFromDisplay(t: TokenDisplay): Token {
  return {
    symbol: t.symbol,
    name: t.name,
    address: `0x${'0'.repeat(40)}`,
    decimals: 18,
    icon: t.glyph,
  }
}
