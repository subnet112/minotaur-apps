import { useCallback, useEffect } from 'react'
import { useSwapStore } from '../store'
import { useToast } from '@/components/shell'

/**
 * ERC-20 approval glue:
 *
 *  - Keeps `store.needsApproval` fresh by calling `store.checkAllowance()`
 *    whenever the wallet, input token, quote, or active address change.
 *  - Returns an `approve()` function the UI can wire to the WalletModeBlock
 *    (variant='approval') CTA. Sends a real `approve(spender, amount)` tx
 *    via `window.ethereum`, surfaces toasts using the sticky-loading-update
 *    idiom (KNOWN_ISSUES #91), and re-checks allowance after the tx mines.
 *
 * No-op when:
 *  - walletMode !== 'external' (managed + bittensor don't use ERC-20 approvals)
 *  - inputToken is native (ETH/TAO — wrapped by the contract)
 *  - contractAddress is not yet known (app status not loaded)
 */
export function useApproval() {
  const toast = useToast()

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

    if (store.walletMode !== 'external' || !window.ethereum) {
      toast.error({ title: 'Approval unavailable', message: 'Connect an EVM wallet (MetaMask) to approve.' })
      return
    }
    if (!store.inputToken || store.inputToken.native) return
    const spender = store.contractAddress
    if (!spender) {
      toast.error({ title: 'App not ready', message: 'Contract address missing — wait for the app to load.' })
      return
    }
    const amount = store.quote?.ready_params?.input_amount || store.inputAmount
    if (!amount || amount === '0') {
      toast.error({ title: 'Nothing to approve', message: 'Enter an amount and get a quote first.' })
      return
    }

    const toastId = toast.loading({ title: `Approving ${store.inputToken.symbol}…` })
    store.setApproving(true)
    try {
      const { ethers } = await import('ethers')
      const provider = new ethers.BrowserProvider(window.ethereum)
      const signer = await provider.getSigner()
      const erc20 = new ethers.Contract(
        store.inputToken.address,
        ['function approve(address,uint256) returns (bool)'],
        signer,
      )

      // Approve the exact required amount. Users wanting MAX can do it
      // manually; exact-amount approvals are safer and easier to revoke.
      const tx = await erc20.approve(spender, amount)
      await tx.wait()

      // Refresh allowance — needsApproval should flip to false.
      await store.checkAllowance()
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
  }, [toast])

  return { approve }
}
