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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSwapStore } from '@/store'
import { useToast } from '@/components/shell'
import { selectActionState, selectModeBlockVariant } from '@/selectors'
import {
  mapStoreToSwapFormProps,
  mapQuoteResultToQuoteCardProps,
  mapSolverTokensToDisplay,
  mapExternalComparisonToCardRows,
  formatTokenAmount,
} from './SwapPage.mappers'
import type { Token, TokenDisplay } from '@/types'
import { CHAIN_CONFIG } from '@/config/chains'
import { classifyOrderStatus } from '@/lib/orderStatus'

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
import { useComparisonQuotes } from '@/hooks/useComparisonQuotes'
import { useApproval } from '@/hooks/useApproval'
import { useWrap } from '@/hooks/useWrap'

import AppPageHeader from '@/components/dex-aggregator/AppPageHeader'
import AppWalletButton from '@/components/dex-aggregator/AppWalletButton'
import HeaderIconButton from '@/components/dex-aggregator/HeaderIconButton'
import SwapForm from '@/components/dex-aggregator/SwapForm'
import TokenSelectorModal from '@/components/dex-aggregator/TokenSelectorModal'
import WalletModeBlock from '@/components/dex-aggregator/WalletModeBlock'
import SwapReviewCard from '@/components/dex-aggregator/SwapReviewCard'
import SwapSuccessCard from '@/components/dex-aggregator/SwapSuccessCard'
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
    // Unknown tokens fall back to neutral grey ('unknown'), NOT 'usdc'.
    // Defaulting to 'usdc' made every unrecognised token (AERO, DEGEN,
    // BRETT, etc. on Base) look like the USDC icon, which was misleading.
    iconClass: iconMap[sym] ?? 'unknown',
    balance: '—',
    usd: '$0.00',
  }
}

/** localStorage key for the persisted alpha-risk acknowledgement. */
const ALPHA_ACK_KEY = 'minotaur:alpha-acknowledged'

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
  // External CoW Swap + Paraswap quotes for the QuoteCard's comparison panel.
  const externalQuotes = useComparisonQuotes()
  // ERC-20 approval flow: refreshes needsApproval and exposes the approve TX.
  const { approve } = useApproval()
  // Native-ETH wrap flow: exposes the ETH→WETH deposit TX for the 'wrap' state.
  const { wrap } = useWrap()
  // Toast surface — used to nudge users who try to swap without ticking the
  // alpha-risk box. The button stays clickable in that state so the toast
  // has a chance to fire and explain why nothing happened.
  const toast = useToast()
  const flashTimerRef = useRef<number | null>(null)
  const [betaFlash, setBetaFlash] = useState(false)
  const flashDisclaimer = useCallback(() => {
    setBetaFlash(true)
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setBetaFlash(false), 1500)
    // Scroll the disclaimer aside into view so the user sees what they need
    // to tick. Falls back to top-of-form if the ref hasn't mounted yet.
    requestAnimationFrame(() => {
      const el = document.querySelector('.sw-beta') as HTMLElement | null
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }, [])

  // 3-step flow: form → review → status. Only one card renders at a time.
  // Status engages automatically when an order lands; "New swap" on the
  // status card clears the order and brings us back to form.
  const [flowStep, setFlowStep] = useState<'form' | 'review' | 'status'>('form')

  // Alpha-risk acknowledgement. Gates both funds-moving actions (Approve in
  // the mode block + Swap/Sign in the action button) until the user ticks the
  // disclaimer. Persisted in localStorage so consent survives reloads; the
  // try/catch covers private-mode / storage-disabled browsers.
  const [accepted, setAcceptedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ALPHA_ACK_KEY) === '1'
    } catch {
      return false
    }
  })
  const setAccepted = (v: boolean) => {
    setAcceptedState(v)
    try {
      if (v) localStorage.setItem(ALPHA_ACK_KEY, '1')
      else localStorage.removeItem(ALPHA_ACK_KEY)
    } catch {
      /* storage unavailable — fall back to in-memory only */
    }
  }

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
  const showDebug = useSwapStore((s) => s.showDebug)
  const tokenSelectorOpen = useSwapStore((s) => s.tokenSelectorOpen)
  const showSettings = useSwapStore((s) => s.showSettings)
  const isCrossChain = useSwapStore((s) => s.isCrossChain)
  const appSupportedChains = useSwapStore((s) => s.appSupportedChains)
  const evmRecipient = useSwapStore((s) => s.evmRecipient)
  const setInputToken = useSwapStore((s) => s.setInputToken)
  const setOutputToken = useSwapStore((s) => s.setOutputToken)
  const setTokenSelectorOpen = useSwapStore((s) => s.setTokenSelectorOpen)
  const setShowSettings = useSwapStore((s) => s.setShowSettings)
  const setShowDebug = useSwapStore((s) => s.setShowDebug)
  const setWalletConnected = useSwapStore((s) => s.setWalletConnected)
  const swapTokens = useSwapStore((s) => s.swapTokens)
  const sourceChainId = useSwapStore((s) => s.sourceChainId)
  const chainId = useSwapStore((s) => s.chainId)
  const inputBalance = useSwapStore((s) => s.inputBalance)
  const outputBalance = useSwapStore((s) => s.outputBalance)
  const slippageBps = useSwapStore((s) => s.slippageBps)
  const loading = useSwapStore((s) => s.loading)
  const solverTokens = useSwapStore((s) => s.solverTokens)

  // Map solver tokens for active source chain into TokenDisplay for the modal
  const modalTokens = useMemo(
    () =>
      mapSolverTokensToDisplay(
        solverTokens[sourceChainId] ?? solverTokens[chainId] ?? [],
      ),
    [solverTokens, sourceChainId, chainId],
  )

  // Derived
  const actionState = useSwapStore(selectActionState as (s: Parameters<typeof selectActionState>[0]) => ReturnType<typeof selectActionState>)
  const modeBlockRaw = useSwapStore(selectModeBlockVariant as (s: Parameters<typeof selectModeBlockVariant>[0]) => ReturnType<typeof selectModeBlockVariant>)
  // Cast: null means don't render; non-null is always Exclude<ModeBlock,'none'>
  const modeBlockVariant = (modeBlockRaw && modeBlockRaw !== 'none')
    ? modeBlockRaw as Exclude<ModeBlock, 'none'>
    : null

  // Active address — derived from wallet mode + individual address fields
  const activeAddress = useSwapStore((s) => {
    if (s.walletMode === 'bittensor' && s.bittensorAddress) return s.bittensorAddress
    return s.walletAddress
  })

  // Map store wallet mode into design's 3-value union ('managed' retired).
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

  // ── 3-step flow handlers ────────────────────────────────────────────────
  // The form step's button shows "Review swap →" for any funds-ready state
  // (approve / swap-ready / sign-broadcast); clicking it transitions to
  // step 2 (SwapReviewCard) where the actual approve + submit happen.
  // Non-funds states (disconnected / wrong-network) still act in-place
  // because there's nothing to review.
  const isFundsAction =
    actionState === 'wrap' ||
    actionState === 'approve' ||
    actionState === 'swap-ready' ||
    actionState === 'sign-broadcast'

  function handleFormAction() {
    if (isFundsAction && !accepted) {
      toast.info({
        title: 'Please acknowledge the beta disclaimer',
        message: 'Tick the checkbox at the top of the form to enable swaps.',
      })
      flashDisclaimer()
      return
    }
    if (actionState === 'disconnected') {
      wallet.connectExternalWallet?.()
      return
    }
    if (actionState === 'wrong-network') {
      // Wallet handles chain switching — nothing to do here
      return
    }
    if (isFundsAction) {
      // Transition to review step. The real approve + submit happens there.
      setFlowStep('review')
      return
    }
  }

  function handleReviewAction() {
    if (isFundsAction && !accepted) {
      // Defense in depth — review shouldn't be reachable without ack, but
      // if the user unticked after landing here we still gate.
      toast.info({
        title: 'Please acknowledge the beta disclaimer',
        message: 'Go back to the form and tick the checkbox to continue.',
      })
      flashDisclaimer()
      return
    }
    if (actionState === 'wrap') {
      wrap()
      return
    }
    if (actionState === 'approve') {
      approve()
      return
    }
    if (actionState === 'swap-ready' || actionState === 'sign-broadcast') {
      submitSwap()
    }
  }

  // Auto-transition: activeOrder appearing means submitSwap landed. Move
  // to status step. Disappearing (after onNewSwap clears it) means user
  // wants to start over — back to form step.
  useEffect(() => {
    if (activeOrder) {
      setFlowStep('status')
    } else if (flowStep === 'status') {
      setFlowStep('form')
    }
  }, [activeOrder, flowStep])

  // If the user navigates to review but the quote evaporates (expired,
  // input cleared, etc.), bounce back to form so they're not staring at
  // an empty review card.
  useEffect(() => {
    if (flowStep === 'review' && !quote) {
      setFlowStep('form')
    }
  }, [flowStep, quote])

  // Build the QuoteDisplay shape the review card consumes — only when
  // we actually have a quote and both tokens (mappers crash otherwise).
  const reviewQuoteDisplay = useMemo(() => {
    if (!quote || !inputToken || !outputToken) return null
    return {
      ...mapQuoteResultToQuoteCardProps(
        quote,
        inputToken,
        outputToken,
        inputAmount,
        quoteExpiry ?? 0,
      ),
      comparison: mapExternalComparisonToCardRows(
        externalQuotes,
        quote.estimated_output,
        outputToken.decimals,
      ),
    }
  }, [quote, inputToken, outputToken, inputAmount, quoteExpiry, externalQuotes])

  // Approve-state explainer copy mirrored across form + review steps so
  // the user sees the same help regardless of where they happen to be.
  const approveHelpText: React.ReactNode = (
    actionState === 'wrapping' ? (
      <>
        Wrap submitted — waiting for the transaction to confirm. You'll approve{' '}
        <span className="b">WETH</span> next.
      </>
    ) : actionState === 'wrap' ? (
      <>
        Native ETH settles as <span className="b">WETH</span>: one wrap, then a
        one-time approval, then the relayer handles the swap gaslessly.
      </>
    ) : actionState === 'approving' ? (
      <>
        Approval submitted — waiting for the transaction to confirm. Cancel from
        your wallet to release the slot.
      </>
    ) : actionState === 'approve' ? (
      <>
        One-time approval for{' '}
        <span className="b">{inputToken?.native ? 'WETH' : (inputToken?.symbol || 'this token')}</span>. Enable{' '}
        <span className="b">Unlimited Approval</span> in settings to skip this on
        future swaps.
      </>
    ) : null
  )

  // What label does the form button show? In funds-ready states we say
  // "Review swap →"; otherwise the state's own label (e.g. "Enter amount",
  // "Insufficient USDC", "Fetching quote…") wins.
  const formActionLabel = isFundsAction ? 'Review swap' : undefined

  return (
    <>
      <AppPageHeader
        actions={
          // Design-system wallet button (00.19). Uses RainbowKit's connect
          // modal + chain modal under the hood but renders the connected
          // state as a custom dropdown (account header, Copy / Switch
          // chain / Switch wallet, Recent swaps, View all orders,
          // Disconnect) instead of RainbowKit's default centred account
          // modal. History panel toggle stays in the swap-form header.
          <AppWalletButton />
        }
      />

      <section className="dex-stage" aria-label="Swap content">
        <div className="dex-content" data-flow-step={flowStep}>
          {/* WalletModeBlock — 'native-eth' / 'setup-proxy' contextual
              notices. Only relevant during input editing, so we pin it
              to the form step. (Approval mode block was dropped earlier;
              that lives on the action button now.) */}
          {flowStep === 'form' && modeBlockVariant && (
            <div className="sw-stack">
              <WalletModeBlock variant={modeBlockVariant} />
            </div>
          )}

          {flowStep === 'form' && (
            <SwapForm
              {...swapFormBase}
              supportedChainIds={appSupportedChains}
              crossChainEnabled={false}
              headerRight={
                import.meta.env.DEV ? (
                  <HeaderIconButton
                    role="debug"
                    active={showDebug}
                    onClick={() => setShowDebug(!showDebug)}
                  />
                ) : undefined
              }
              fromToken={fromTokenDisplay}
              toToken={toTokenDisplay_}
              fromAmount={inputAmount}
              fromUsd=""
              toAmount={
                quote && outputToken
                  ? formatTokenAmount(quote.estimated_output, outputToken.decimals)
                  : ''
              }
              toUsd=""
              toIsQuoted={!!quote && !loading}
              cross={isCrossChain}
              onToggleCross={() => useSwapStore.setState({ isCrossChain: !isCrossChain })}
              onChangeAmount={(v) => useSwapStore.getState().setInputAmount(v)}
              onMaxClick={() => {
                const bal = useSwapStore.getState().inputBalance
                if (bal && bal !== '0') useSwapStore.getState().setInputAmount(bal)
              }}
              onPickFromChain={(id) => { useSwapStore.getState().setSourceChainId(id); void wallet.switchChain(id) }}
              onPickToChain={(id) => { useSwapStore.setState({ chainId: id }); void wallet.switchChain(id) }}
              showRecipient={isCrossChain && walletMode === 'bittensor'}
              recipientValid={
                isCrossChain && walletMode === 'bittensor'
                  ? /^0x[a-fA-F0-9]{40}$/.test(evmRecipient)
                  : true
              }
              recipientValue={evmRecipient}
              onChangeRecipient={(v) => useSwapStore.getState().setEvmRecipient(v, 'manual')}
              onMetaMaskRecipient={async () => {
                const { walletAddress, walletConnected } = useSwapStore.getState()
                if (walletConnected && walletAddress) {
                  useSwapStore.getState().setEvmRecipient(walletAddress, 'metamask')
                } else {
                  wallet.connectExternalWallet?.()
                }
              }}
              onSwapDirection={() => swapTokens()}
              onPickFromToken={() => setTokenSelectorOpen('input')}
              onPickToToken={() => setTokenSelectorOpen('output')}
              onOpenSettings={() => setShowSettings(true)}
              wallet={designWallet}
              actionState={actionState}
              onActionClick={handleFormAction}
              acknowledged={accepted}
              onAcknowledgedChange={setAccepted}
              disclaimerFlash={betaFlash}
              forceActionLabel={formActionLabel}
            />
          )}

          {flowStep === 'review' && reviewQuoteDisplay && (
            <SwapReviewCard
              quote={reviewQuoteDisplay}
              actionState={actionState}
              onActionClick={handleReviewAction}
              onBack={() => setFlowStep('form')}
              // Native ETH is approved as WETH post-wrap; the review card only
              // ever shows approve/wrap/sign labels (never 'insufficient'), so
              // relabeling to WETH here is safe and accurate.
              tokenSymbol={inputToken?.native ? 'WETH' : inputToken?.symbol}
              forceDisabled={
                !accepted && (
                  actionState === 'wrap' ||
                  actionState === 'approve' ||
                  actionState === 'swap-ready' ||
                  actionState === 'sign-broadcast'
                )
              }
              helpText={approveHelpText}
            />
          )}

          {flowStep === 'status' && activeOrder && (() => {
            const { isFilled } = classifyOrderStatus(activeOrder.status)
            const onNewSwap = () => {
              useSwapStore.getState().setActiveOrder(null)
              useSwapStore.getState().setInputAmount('')
              setFlowStep('form')
            }
            // Filled → celebration card. Anything else (pending / open /
            // failed / cancelled) → the stepper card so the user can see
            // progress or the failure reason.
            if (isFilled) {
              return (
                <SwapSuccessCard
                  orderId={activeOrder.order_id}
                  txHash={activeOrder.tx_hash ?? undefined}
                  output={executionDetails?.amountOut}
                  outputSymbol={outputToken?.symbol}
                  surplus={executionDetails?.surplus}
                  gas={executionDetails?.gasUsed}
                  explorerBaseUrl={CHAIN_CONFIG[chainId]?.explorer ?? ''}
                  onNewSwap={onNewSwap}
                />
              )
            }
            return (
              <OrderStatusCard
                step={activeOrder.status}
                orderId={activeOrder.order_id}
                txHash={activeOrder.tx_hash ?? undefined}
                score={activeOrder.score ?? undefined}
                output={executionDetails?.amountOut}
                surplus={executionDetails?.surplus}
                fee={executionDetails?.fee}
                gas={executionDetails?.gasUsed}
                errorMessage={(activeOrder as Record<string, unknown>).error as string | undefined}
                explorerBaseUrl={CHAIN_CONFIG[chainId]?.explorer ?? ''}
                onNewSwap={onNewSwap}
              />
            )
          })()}

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
          tokens={modalTokens}
          oppositeSymbol={outputToken?.symbol ?? ''}
          sideOpen="input"
          canImport={true}
          onCustomImport={makeCustomImportHandler(sourceChainId)}
          onSelect={(t) => {
            // TokenSelectorModal deals in TokenDisplay; map back to a
            // functional Token by looking up by address or symbol in the
            // store's solver tokens, falling back to a minimal object.
            const storeTokens = useSwapStore.getState().solverTokens
            const chainTokens = storeTokens[sourceChainId] ?? storeTokens[chainId] ?? []
            setInputToken(resolveToken(t, chainTokens) ?? tokenFromDisplay(t))
            setTokenSelectorOpen(null)
          }}
          onClose={() => setTokenSelectorOpen(null)}
        />
      )}
      {overlay === 'token-to' && (
        <TokenSelectorModal
          tokens={modalTokens}
          oppositeSymbol={inputToken?.symbol ?? ''}
          sideOpen="output"
          canImport={true}
          onCustomImport={makeCustomImportHandler(sourceChainId)}
          onSelect={(t) => {
            // TokenSelectorModal deals in TokenDisplay; map back to functional Token.
            const storeTokens = useSwapStore.getState().solverTokens
            const chainTokens = storeTokens[chainId] ?? storeTokens[sourceChainId] ?? []
            setOutputToken(resolveToken(t, chainTokens) ?? tokenFromDisplay(t))
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
    address: t.address ?? `0x${'0'.repeat(40)}`,
    decimals: 18,
    icon: t.glyph,
    native: t.native,
  }
}

/**
 * Resolves a TokenDisplay back to a functional Token from the solver list.
 * Prefers address match (exact, case-insensitive), then falls back to symbol.
 */
function resolveToken(t: TokenDisplay, chainTokens: Token[]): Token | undefined {
  if (t.address) {
    const byAddr = chainTokens.find(
      (tok) => tok.address?.toLowerCase() === t.address!.toLowerCase(),
    )
    if (byAddr) return byAddr
  }
  return chainTokens.find(
    (tok) => tok.symbol.toUpperCase() === t.symbol.toUpperCase(),
  )
}

/**
 * Returns an onCustomImport handler bound to a specific chainId.
 * Lazy-loads ethers, reads symbol + decimals from the ERC-20 contract,
 * persists the new token into store.solverTokens, then returns the
 * TokenDisplay shape for immediate selection.
 */
function makeCustomImportHandler(
  chainId: number,
): (addr: string) => Promise<TokenDisplay | null> {
  return async (addr: string): Promise<TokenDisplay | null> => {
    try {
      // Custom-token import reads ERC-20 metadata over RPC — no wallet
      // signature needed. Use viem's public client (configured against the
      // chain's transport in wagmiConfig) so this works regardless of
      // whether the user has a wallet connected.
      const [{ getPublicClient }, { erc20Abi, getAddress }, { wagmiConfig }] = await Promise.all([
        import('wagmi/actions'),
        import('viem'),
        import('@/config/wagmi'),
      ])
      const client = getPublicClient(wagmiConfig, { chainId })
      if (!client) return null

      const tokenAddr = getAddress(addr) as `0x${string}`
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address: tokenAddr, abi: erc20Abi, functionName: 'decimals' }),
      ]) as [string, number]

      // Persist into solverTokens so the next open shows it
      const newToken: Token = {
        symbol,
        name: symbol,
        address: tokenAddr,
        decimals: Number(decimals),
        icon: symbol.charAt(0),
      }
      const existing = useSwapStore.getState().solverTokens[chainId] ?? []
      useSwapStore.getState().setSolverTokens(chainId, [...existing, newToken])

      // Return display shape for immediate selection
      const sym = symbol.toLowerCase()
      const iconMap: Record<string, TokenDisplay['iconClass']> = {
        usdc: 'usdc', usdt: 'usdt', eth: 'eth', weth: 'eth',
        wbtc: 'wbtc', tao: 'tao', dai: 'dai', arb: 'arb', link: 'link',
      }
      return {
        symbol,
        name: symbol,
        glyph: symbol.charAt(0).toUpperCase(),
        iconClass: iconMap[sym] ?? 'unknown',
        balance: '0',
        usd: '$0.00',
        address: tokenAddr,
      }
    } catch (e) {
      console.error('Custom token import failed:', e)
      return null
    }
  }
}
