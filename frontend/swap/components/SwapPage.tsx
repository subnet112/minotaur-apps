import { useEffect, useCallback } from 'react'
import { AlertCircle, Clock, Bug } from 'lucide-react'
// Badge moved to WalletStatusBar

import { useSwapStore } from '../swap.store'
import { TOKENS } from '../swap.config'
// shorten moved to WalletStatusBar

// Hooks
import { useAppBootstrap } from '../hooks/useAppBootstrap'
import { useMetaMaskListener, useWalletConnection } from '../hooks/useWalletConnection'
import { useWalletBalances } from '../hooks/useWalletBalances'
import { useQuoteRequest } from '../hooks/useQuoteRequest'
import { useOrderSubmission } from '../hooks/useOrderSubmission'
import { useQuoteExpiry } from '../hooks/useQuoteExpiry'

// Components
import { WalletSetupSection } from './WalletSetupSection'
import { ChainSelector } from './ChainSelector'
import { EvmRecipientInput } from './EvmRecipientInput'
import { SwapForm } from './SwapForm'
import { ActionButton } from './ActionButton'
import { WalletStatusBar } from './WalletStatusBar'
import { TokenSelectorDialog } from './TokenSelectorDialog'
import { SettingsDialog } from './SettingsDialog'
import { QuoteInfoCard } from './QuoteInfoCard'
import { OrderStatusCard } from './OrderStatusCard'
import { HistoryPanel } from './HistoryPanel'
import { DebugPanel } from './DebugPanel'

// ─── Main Component ──────────────────────────────────────────────────────────

export function SwapPage() {
  const store = useSwapStore()
  const tokens = store.solverTokens[store.chainId]?.length ? store.solverTokens[store.chainId] : (TOKENS[store.chainId] || [])
  const sourceTokens = store.solverTokens[store.sourceChainId]?.length ? store.solverTokens[store.sourceChainId] : (TOKENS[store.sourceChainId] || [])

  // All hooks must be called unconditionally and in the same order
  useAppBootstrap()
  useMetaMaskListener()
  useWalletBalances()
  const { requestQuote } = useQuoteRequest()
  const { submitSwap } = useOrderSubmission()
  const {
    connectExternalWallet,
    createManagedWallet,
    fundManagedWallet,
    connectBittensorWallet,
    setupBittensorProxy,
    hasMetaMask,
  } = useWalletConnection()
  useQuoteExpiry(requestQuote)

  // Check allowance when quote arrives
  useEffect(() => {
    if (store.quote) store.checkAllowance()
  }, [store.quote, store.contractAddress])

  // Approve handler
  const handleApprove = useCallback(async () => {
    if (!store.inputToken || !store.contractAddress) return
    store.setApproving(true)
    try {
      const { ethers } = await import('ethers')
      const provider = new ethers.BrowserProvider(window.ethereum!)
      const signer = await provider.getSigner()
      const erc20 = new ethers.Contract(store.inputToken.address, [
        'function approve(address,uint256) returns (bool)',
      ], signer)
      const amount = store.unlimitedApproval
        ? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
        : BigInt(String(store.quote?.ready_params?.input_amount || store.inputAmount || '0'))
      const tx = await erc20.approve(store.contractAddress, amount)
      await tx.wait()
      store.setNeedsApproval(false)
    } catch (err: any) {
      if (err?.code !== 'ACTION_REJECTED' && err?.code !== 4001) {
        store.setError('Approval failed: ' + (err?.message || String(err)))
      }
    } finally {
      store.setApproving(false)
    }
  }, [store.inputToken, store.contractAddress, store.unlimitedApproval, store.quote])

  return (
    <div className="flex flex-col items-center gap-5 p-6 min-h-[calc(100vh-4rem)]">
      {/* Main Swap Card */}
      <div className="glass-border rounded-[var(--radius-swap)] bg-swap-gradient backdrop-blur-[74px] p-6 w-full max-w-[560px] flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold font-display">Swap</h2>
          <SettingsDialog />
        </div>

        <WalletStatusBar />

        <WalletSetupSection
          createManagedWallet={createManagedWallet}
          fundManagedWallet={fundManagedWallet}
          connectBittensorWallet={connectBittensorWallet}
          setupBittensorProxy={setupBittensorProxy}
        />

        <ChainSelector />

        <EvmRecipientInput />

        <SwapForm />

        {/* Error */}
        {store.error && (
          <div className="flex items-center gap-2 p-4 rounded-[var(--radius-inner)] bg-destructive/10 border border-destructive/30 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {store.error}
          </div>
        )}

        <ActionButton
          onQuote={requestQuote}
          onSwap={submitSwap}
          onApprove={handleApprove}
          onConnect={connectExternalWallet}
          hasMetaMask={hasMetaMask}
        />

        {/* Wallet status is now in WalletStatusBar above */}
      </div>

      {/* Token Selector Dialog -- source chain tokens for input, dest chain tokens for output */}
      <TokenSelectorDialog tokens={store.tokenSelectorOpen === 'input' ? sourceTokens : tokens} />

      {/* Quote Info Card */}
      {store.quote && store.inputToken && store.outputToken && <QuoteInfoCard />}

      {/* Active Order Status */}
      {store.activeOrder && <OrderStatusCard />}

      {/* Toggle Buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => store.setShowHistory(!store.showHistory)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-inner)] text-sm transition-colors duration-200 ${
            store.showHistory ? 'bg-lime-gradient text-[var(--text-dark)]' : 'glass-border bg-white/10 hover:bg-white/15'
          }`}
        >
          <Clock className="h-4 w-4" />
          History {store.recentSwaps.length > 0 && `(${store.recentSwaps.length})`}
        </button>
        <button
          type="button"
          onClick={() => store.setShowDebug(!store.showDebug)}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-inner)] text-sm transition-colors duration-200 ${
            store.showDebug ? 'bg-lime-gradient text-[var(--text-dark)]' : 'glass-border bg-white/10 hover:bg-white/15'
          }`}
        >
          <Bug className="h-4 w-4" />
          Debug
        </button>
      </div>

      {/* History Panel */}
      {store.showHistory && <HistoryPanel />}

      {/* Debug Panel */}
      {store.showDebug && <DebugPanel />}
    </div>
  )
}

export default SwapPage
