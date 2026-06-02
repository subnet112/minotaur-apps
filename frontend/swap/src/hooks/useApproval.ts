import { useCallback, useEffect } from 'react'
import { useSwapStore } from '../store'
import { useToast } from '@/components/shell'
import { useWalletClient, usePublicClient } from 'wagmi'
import { erc20Abi, type Address } from 'viem'

/**
 * ERC-20 approval glue:
 *
 *  - Keeps `store.needsApproval` fresh by calling `store.checkAllowance()`
 *    whenever the wallet, input token, quote, or active address change.
 *  - Returns an `approve()` function the UI can wire to the WalletModeBlock
 *    (variant='approval') CTA. Sends a real `approve(spender, amount)` tx
 *    via the wagmi walletClient (works with every RainbowKit connector —
 *    MetaMask, Rabby, WalletConnect, Coinbase, Ledger via WC, etc.).
 *    Surfaces toasts using the sticky-loading-update idiom and re-checks
 *    allowance after the tx mines.
 *
 * No-op when:
 *  - walletMode !== 'external' (managed + bittensor don't use ERC-20 approvals)
 *  - inputToken is native (ETH/TAO — wrapped by the contract)
 *  - contractAddress is not yet known (app status not loaded)
 */
export function useApproval() {
  const toast = useToast()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()

  // Reactive slice — re-run the allowance probe on any of these changes.
  const walletMode = useSwapStore((s) => s.walletMode)
  const walletAddress = useSwapStore((s) => s.walletAddress)
  const inputToken = useSwapStore((s) => s.inputToken)
  const inputAmount = useSwapStore((s) => s.inputAmount)
  const contractAddress = useSwapStore((s) => s.contractAddress)
  const chainId = useSwapStore((s) => s.chainId)
  const quoteInputAmount = useSwapStore((s) => s.quote?.ready_params?.input_amount)

  useEffect(() => {
    // checkAllowance reads its own deps off the store; we just trigger it.
    void useSwapStore.getState().checkAllowance()
  }, [walletMode, walletAddress, inputToken, inputAmount, contractAddress, chainId, quoteInputAmount])

  const approve = useCallback(async () => {
    const store = useSwapStore.getState()

    if (store.walletMode !== 'external' || !walletClient) {
      toast.error({ title: 'Approval unavailable', message: 'Connect an EVM wallet to approve.' })
      return
    }
    if (!store.inputToken || store.inputToken.native) return
    const spender = store.contractAddress as Address
    if (!spender) {
      toast.error({ title: 'App not ready', message: 'Contract address missing — wait for the app to load.' })
      return
    }
    const amountStr = store.quote?.ready_params?.input_amount || store.inputAmount
    if (!amountStr || amountStr === '0') {
      toast.error({ title: 'Nothing to approve', message: 'Enter an amount and get a quote first.' })
      return
    }
    if (!walletClient.account) {
      toast.error({ title: 'Approval unavailable', message: 'Wallet client not ready — try again in a moment.' })
      return
    }

    const toastId = toast.loading({ title: `Approving ${store.inputToken.symbol}…` })
    store.setApproving(true)
    try {
      // Approve the exact required amount. Users wanting MAX can do it
      // manually; exact-amount approvals are safer and easier to revoke.
      const amount = BigInt(amountStr)
      const txHash = await walletClient.writeContract({
        address: store.inputToken.address as Address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [spender, amount],
      })

      // Wait for the receipt before refreshing allowance so the read sees
      // the new approval state. waitForTransactionReceipt resolves on
      // reverted txs too — the status field tells us the truth.
      let txSucceeded = true
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        txSucceeded = receipt.status === 'success'
      }

      if (!txSucceeded) {
        toast.update(toastId, {
          variant: 'error',
          title: 'Approval reverted',
          message: 'The approval transaction reverted on-chain.',
        })
        return
      }

      // Refresh allowance for accuracy, but force-clear `needsApproval`
      // afterwards: a load-balanced public RPC node can return the
      // pre-approval allowance for a short window after the tx mines
      // (the node we read from may lag the one we sent through), which
      // would otherwise leave the "Approve" button stuck on screen.
      // Force-clearing keeps the user unblocked; the next natural
      // refresh (amount/token/chain change) corrects the cached value
      // if anything's off.
      try {
        await store.checkAllowance()
      } catch {
        /* probe failed — fall through, the optimistic clear still applies */
      }
      store.setNeedsApproval(false)

      toast.update(toastId, {
        variant: 'success',
        title: `${store.inputToken.symbol} approved`,
        message: `Spender ${spender.slice(0, 6)}…${spender.slice(-4)}`,
      })
    } catch (err: any) {
      const message = err?.shortMessage ?? err?.message ?? 'Approval failed'
      toast.update(toastId, { variant: 'error', title: 'Approval failed', message })
    } finally {
      store.setApproving(false)
    }
  }, [toast, walletClient, publicClient])

  return { approve }
}
