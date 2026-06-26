import { useCallback } from 'react'
import { useSwapStore } from '../store'
import { useToast } from '@/components/shell'
import { useWalletClient, usePublicClient, useSwitchChain } from 'wagmi'
import { base } from 'wagmi/chains'
import { type Address } from 'viem'
import { CHAIN_CONFIG } from '@/config/chains'

/**
 * Native-ETH wrap glue.
 *
 * The relayer submits executeIntent on the user's behalf and cannot attach
 * msg.value, so the contract's native-ETH branch (which wraps msg.value) is
 * unreachable in the gasless flow. Instead, native ETH is settled as WETH:
 * the user wraps ETH→WETH here, then approves WETH (useApproval), then the
 * relayer pulls WETH via transferFrom like any other ERC-20.
 *
 * Returns a `wrap()` the action button (state='wrap') can call. Sends a real
 * `WETH.deposit{value: amount}()` via the wagmi walletClient (works with every
 * RainbowKit connector) and re-probes balance/allowance after the tx mines so
 * the flow advances to the Approve step.
 *
 * No-op when walletMode !== 'external', the input token isn't native, or the
 * wrapped-native address / contract isn't known yet.
 */
const WETH_DEPOSIT_ABI = [
  { type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] },
] as const

export function useWrap() {
  const toast = useToast()
  // Bind the wallet client to the app's chain — see useApproval for why an
  // unbound useWalletClient() causes a wallet-side "null has no properties".
  const chainId = useSwapStore((s) => s.chainId)
  const { data: walletClient } = useWalletClient({ chainId })
  const publicClient = usePublicClient()
  const { switchChainAsync } = useSwitchChain()

  const wrap = useCallback(async () => {
    const store = useSwapStore.getState()

    if (store.walletMode !== 'external' || !walletClient) {
      toast.error({ title: 'Wrap unavailable', message: 'Connect an EVM wallet to wrap ETH.' })
      return
    }
    if (!store.inputToken || !store.inputToken.native) return
    const weth = CHAIN_CONFIG[store.chainId]?.wrappedNative as Address | undefined
    if (!weth) {
      toast.error({ title: 'Wrap unavailable', message: 'No wrapped-native token configured for this chain.' })
      return
    }
    const amountStr = store.quote?.ready_params?.input_amount || store.inputAmount
    if (!amountStr || amountStr === '0') {
      toast.error({ title: 'Nothing to wrap', message: 'Enter an amount and get a quote first.' })
      return
    }
    if (!walletClient.account) {
      toast.error({ title: 'Wrap unavailable', message: 'Wallet client not ready — try again in a moment.' })
      return
    }
    // Ensure the wallet is on the app's chain before sending (see useApproval).
    if (store.walletChainId != null && store.walletChainId !== store.chainId) {
      try {
        await switchChainAsync({ chainId: store.chainId })
      } catch {
        toast.error({
          title: 'Wrong network',
          message: `Switch your wallet to chain ${store.chainId} and try again.`,
        })
        return
      }
    }

    const toastId = toast.loading({ title: 'Wrapping ETH → WETH…' })
    store.setWrapping(true)
    try {
      // Wrap exactly the swap amount. The user keeps the rest of their ETH
      // for gas (the wrap + approve txs they sign).
      const amount = BigInt(String(amountStr))
      const txHash = await walletClient.writeContract({
        chain: base,
        address: weth,
        abi: WETH_DEPOSIT_ABI,
        functionName: 'deposit',
        value: amount,
        args: [],
      })

      // waitForTransactionReceipt resolves on reverted txs too — the status
      // field tells us the truth.
      let txSucceeded = true
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
        txSucceeded = receipt.status === 'success'
      }

      if (!txSucceeded) {
        toast.update(toastId, {
          variant: 'error',
          title: 'Wrap reverted',
          message: 'The wrap transaction reverted on-chain.',
        })
        return
      }

      // Re-probe balance + allowance so the flow advances to Approve (or
      // straight to Sign if WETH is already approved).
      try {
        await store.checkAllowance()
      } catch {
        /* probe failed — the next natural refresh corrects it */
      }
      store.setNeedsWrap(false)

      toast.update(toastId, {
        variant: 'success',
        title: 'Wrapped ETH → WETH',
        message: 'Approve WETH next to continue.',
      })
    } catch (err: any) {
      const message = err?.shortMessage ?? err?.message ?? 'Wrap failed'
      toast.update(toastId, { variant: 'error', title: 'Wrap failed', message })
    } finally {
      store.setWrapping(false)
    }
  }, [toast, walletClient, publicClient, switchChainAsync])

  return { wrap }
}
