import { useEffect, useCallback, useRef } from 'react'
import { useToast } from '@/components/shell'
import { useSwapStore } from '../store'
import { BITTENSOR_CHAIN_ID } from '@/config/chains'
import { formatAmount, shorten } from '../utils'
import { classifyOrderStatus } from '@/lib/orderStatus'
import * as api from '@/api/client'

/**
 * Order submission hook: handles submit + ERC-20 approval + EIP-712 signing + polling.
 */
export function useOrderSubmission() {
  const toast = useToast()
  const store = useSwapStore()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pollOrderStatus = useCallback((orderId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    store.setPolling(true)

    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getOrderStatus(orderId)
        store.setActiveOrder(status)

        // Match the subnet's full OrderStatus enum — 'rejected' / 'expired'
        // / 'bridge_failed' etc. were missing here, so polling never stopped
        // and the failure toast never fired on real production rejections.
        const { isFailed, isFilled, isTerminal } = classifyOrderStatus(status.status)
        if (isTerminal) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          store.setPolling(false)

          if (isFilled) {
            // One-shot toast for terminal filled state (separate from submit flow).
            // Use score as a proxy for surplus display — execution details may not
            // be available yet (they're fetched from the tx receipt below).
            const scoreStr = status.score != null ? `Score: ${status.score}` : undefined
            toast.success({
              title: 'Swap filled',
              message: scoreStr,
            })
            // Fetch execution details from tx receipt
            if (status.tx_hash && window.ethereum) {
              try {
                const { ethers } = await import('ethers')
                const provider = new ethers.BrowserProvider(window.ethereum)
                const receipt = await provider.getTransactionReceipt(
                  status.tx_hash.startsWith('0x') ? status.tx_hash : '0x' + status.tx_hash
                )
                if (receipt) {
                  // SwapExecuted event ABI — keep in sync with contracts/src/DexAggregatorApp.sol:
                  //   event SwapExecuted(
                  //     bytes32 indexed orderId,
                  //     address tokenIn,
                  //     address tokenOut,
                  //     uint256 amountIn,
                  //     uint256 amountOut,
                  //     uint256 fee
                  //   )
                  const swapTopic = ethers.id('SwapExecuted(bytes32,address,address,address,uint256,uint256,uint256)')
                  const swapLog = receipt.logs.find(l => l.topics[0] === swapTopic)
                  if (swapLog) {
                    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
                      ['address', 'address', 'uint256', 'uint256', 'uint256'],
                      swapLog.data
                    )
                    const [tokenIn, tokenOut, amountIn, amountOut, fee] = decoded
                    const minOutput = BigInt(String(
                      status.params?.min_output_amount
                      || store.quote?.ready_params?.min_output_amount
                      || '0'
                    ))
                    const surplusWei = BigInt(amountOut) - minOutput
                    store.setExecutionDetails({
                      amountIn: amountIn.toString(),
                      amountOut: amountOut.toString(),
                      fee: fee.toString(),
                      surplus: surplusWei > 0n ? surplusWei.toString() : '0',
                      tokenIn: tokenIn as string,
                      tokenOut: tokenOut as string,
                      gasUsed: receipt.gasUsed?.toString() || '0',
                    })
                  }
                }
              } catch (e) { console.warn('Failed to fetch execution details:', e) }
            }
          } else if (isFailed) {
            // One-shot toast for any terminal failure (rejected / failed /
            // cancelled / expired / bridge_failed / rolled_back / partial_rollback).
            // Surface the server's `error` field — it carries the actionable
            // reason ("Relayer submission failed: invalid EIP-712 signature
            // from 0x…", "deadline expired", etc). Falling back to a generic
            // string only when the server didn't attach one.
            const reason =
              (status as Record<string, unknown>).error as string | undefined
            toast.error({
              title: `Order ${status.status}`,
              message: reason || 'See order receipt for details',
            })
          }
        }
      } catch {
        // Polling errors are transient -- keep trying
      }
    }, 2000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submitSwap = useCallback(async () => {
    let addr = store.getActiveAddress()
    if (!store.quote || !addr || !store.appId) return

    // Hard guard: for external-wallet EVM swaps we MUST know the contract
    // address so we can sign EIP-712. If we don't, the submit loop would
    // silently skip the signing block and ship an unsigned order that gets
    // rejected on-chain (or worse, raw-submitted without authorisation).
    // Better to fail loudly here — usually a bootstrap race, retry after a
    // second typically fixes it.
    const isEvmExternalSwap = (
      store.walletMode === 'external' &&
      store.sourceChainId !== BITTENSOR_CHAIN_ID &&
      store.chainId !== BITTENSOR_CHAIN_ID
    )
    if (isEvmExternalSwap && !store.contractAddress) {
      const msg = 'App contract address not loaded yet — try again in a moment'
      console.error('[swap] aborting submit:', msg, {
        appId: store.appId,
        chainId: store.chainId,
        walletMode: store.walletMode,
      })
      store.setError(msg)
      toast.error({ title: 'Submit blocked', message: msg })
      return
    }

    store.setSubmitting(true)
    store.setError(null)
    store.setActiveOrder(null)

    try {
      const orderParams = { ...store.quote.ready_params }

      // Cross-chain EVM->EVM: ensure dest_chain_id is in order params
      if (store.isCrossChain && store.sourceChainId !== BITTENSOR_CHAIN_ID) {
        orderParams.dest_chain_id = String(store.chainId)
        orderParams.dest_recipient = addr
      }

      console.log('[swap] orderParams:', JSON.stringify(orderParams))

      // Same-chain Bittensor: call the stake endpoint directly (one-shot toasts,
      // not sticky — this is a synchronous API response path, not a long wait).
      if (
        store.sourceChainId === BITTENSOR_CHAIN_ID &&
        store.chainId === BITTENSOR_CHAIN_ID &&
        store.bittensorConnected &&
        orderParams.action
      ) {
        const stakeRes = await fetch('/api/v1/native-bittensor/stake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderParams),
        })
        const stakeResult = await stakeRes.json()

        if (stakeResult.success) {
          store.setActiveOrder({
            order_id: stakeResult.tx_hash || 'bt-' + Date.now(),
            status: 'filled',
            score: 1.0,
            tx_hash: stakeResult.tx_hash,
          } as any)
          toast.success({
            title: `${orderParams.action === 'add_stake' ? 'Staked' : 'Unstaked'} successfully!`,
          })
          store.addToHistory({
            orderId: stakeResult.tx_hash || '',
            timestamp: Date.now(),
            chainId: 0,
            inputToken: store.inputToken?.symbol || '',
            outputToken: store.outputToken?.symbol || '',
            inputAmount: store.inputAmount,
            outputAmount: store.inputAmount,
            status: 'filled',
            score: 1.0,
            txHash: stakeResult.tx_hash,
          })
        } else {
          store.setError(stakeResult.error || 'Stake operation failed')
          toast.error({ title: 'Stake failed', message: stakeResult.error || 'Failed' })
        }
        return
      }

      // NOTE: ERC-20 approval is handled by the ActionButton (Approve step).

      // Cross-chain or EVM: use the standard order flow
      if (store.sourceChainId === BITTENSOR_CHAIN_ID && store.bittensorConnected) {
        const alphaMatch = store.inputToken?.address.match(/^alpha:(\d+)$/)
        if (alphaMatch) {
          const evmAddr = store.evmRecipient || addr
          orderParams.alpha_netuid = alphaMatch[1]
          orderParams.owner_ss58 = store.bittensorAddress
          orderParams.hotkey_ss58 = store.bittensorAddress
          orderParams.alpha_amount_rao = orderParams.input_amount || orderParams.alpha_amount_rao
          orderParams.dest_chain_id = String(store.chainId)
          orderParams.recipient = evmAddr
          orderParams.output_token = store.outputToken?.address || ''
          orderParams.min_output_amount = '1'
          // Use EVM address as submitted_by for the order
          addr = evmAddr
        }
      }

      // Sticky-loading-update: submit flow.
      // Capture id here — all downstream transitions (signing, success, error)
      // call toast.update(id, ...) exactly once at their terminal point.
      const submitId = toast.loading({ title: 'Submitting order…' })

      // Step 1: Submit order to get the server-assigned order_id
      const orderChainId = store.isCrossChain ? store.sourceChainId : store.chainId

      let order: any
      try {
        order = await api.submitOrder(
          store.appId,
          orderParams,
          addr,
          {
            intentFunction: store.quote?.intent_function || 'swap',
            chainId: orderChainId,
          },
        )
      } catch (submitErr: any) {
        toast.update(submitId, { variant: 'error', title: 'Submit failed', message: submitErr?.message })
        throw submitErr
      }

      // Step 2: EIP-712 user signature for external wallets (MetaMask)
      if (store.walletMode === 'external' && window.ethereum && store.contractAddress && order.order_id) {
        try {
          const { ethers } = await import('ethers')
          const provider = new ethers.BrowserProvider(window.ethereum)
          const signer = await provider.getSigner()

          const orderIdHash = ethers.keccak256(ethers.toUtf8Bytes(order.order_id))

          const intentParamsHex = order.params?.intent_params_hex
            ? '0x' + order.params.intent_params_hex
            : ethers.AbiCoder.defaultAbiCoder().encode(
                ['address', 'address', 'uint256', 'uint256', 'address', 'uint256', 'uint8', 'bytes32', 'bytes32'],
                [orderParams.input_token, orderParams.output_token,
                 orderParams.input_amount || '0', orderParams.min_output_amount || '0',
                 addr, 0, 0, ethers.zeroPadValue('0x', 32), ethers.zeroPadValue('0x', 32)]
              )

          const paramsHash = ethers.keccak256(intentParamsHex)
          const intentSelector = order.params?.intent_selector
            ? '0x' + order.params.intent_selector
            : ethers.dataSlice(ethers.keccak256(ethers.toUtf8Bytes('swap(address,address,uint256,uint256,address)')), 0, 4)

          const SENTINEL_NONCE = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'

          const domain = {
            name: 'MinotaurAppIntent',
            version: '1',
            chainId: store.chainId,
            verifyingContract: store.contractAddress,
          }
          const types = {
            IntentOrder: [
              { name: 'orderId', type: 'bytes32' },
              { name: 'app', type: 'address' },
              { name: 'intentSelector', type: 'bytes4' },
              { name: 'paramsHash', type: 'bytes32' },
              { name: 'submittedBy', type: 'address' },
              { name: 'chainId', type: 'uint256' },
              { name: 'deadline', type: 'uint256' },
              { name: 'nonce', type: 'uint256' },
              { name: 'perpetual', type: 'bool' },
              { name: 'maxExecutions', type: 'uint256' },
              { name: 'cooldown', type: 'uint256' },
            ],
          }
          const value = {
            orderId: orderIdHash,
            app: store.contractAddress,
            intentSelector,
            paramsHash,
            submittedBy: addr,
            chainId: store.chainId,
            deadline: Math.floor(Number(order.deadline ?? 0) || Date.now() / 1000 + 3600),
            nonce: SENTINEL_NONCE,
            perpetual: false,
            maxExecutions: 1,
            cooldown: 0,
          }

          // Update the sticky loading toast to prompt the user — keep variant
          // 'loading' so the toast stays pinned while the wallet popup is open.
          toast.update(submitId, { variant: 'loading', title: 'Please sign the swap order in MetaMask…' })
          const userSignature = await signer.signTypedData(domain, types, value)

          // M4 (subnet audit 2026-05-25): PATCH /orders/{id}/signature now
          // requires a SECOND signature — owner_signature — proving the
          // caller controls order.submitted_by. Build the digest the server
          // expects and personal_sign it. Same signer prompts twice in
          // MetaMask: once for the EIP-712 IntentOrder, once for the
          // EIP-191 AttachSig action.
          toast.update(submitId, { variant: 'loading', title: 'Confirm the ownership signature in MetaMask…' })
          const { buildAttachSigOwnerSignature } = await import('@/lib/orderOwnerSig')
          const { ownerSignature, deadline: ownerSigDeadline } = await buildAttachSigOwnerSignature(signer, {
            orderId: order.order_id,
            userSignature,
            chainId: store.chainId,
          })

          // Step 3: Attach signature via the API client (honours VITE_API_URL).
          // A hardcoded relative fetch here used to silently 404 in production
          // because CloudFront doesn't proxy /api/* to the backend.
          await api.attachSignature(order.order_id, userSignature, ownerSignature, ownerSigDeadline)
          // Signature attached — update back to generic "submitting" while the
          // relayer picks up the order. The success transition happens below
          // once store.setActiveOrder is called.
          toast.update(submitId, { variant: 'loading', title: 'Order signed, waiting for relayer…' })
        } catch (sigErr: any) {
          if (sigErr?.code === 'ACTION_REJECTED' || sigErr?.code === 4001) {
            // For EVM external-wallet swaps the signature is mandatory —
            // the server needs it for consensus verification. Abort loudly
            // instead of shipping an unsigned order.
            const msg = 'Signature rejected — order cancelled'
            store.setError(msg)
            toast.update(submitId, { variant: 'error', title: 'Signature rejected', message: 'Order cancelled' })
            store.setSubmitting(false)
            return
          }
          // Any other signing failure (network, server error) is also fatal.
          console.error('EIP-712 signing/attach failed:', sigErr)
          const msg = 'Failed to attach signature: ' + (sigErr?.message || String(sigErr))
          store.setError(msg)
          toast.update(submitId, { variant: 'error', title: 'Signing failed', message: sigErr?.message || String(sigErr) })
          store.setSubmitting(false)
          return
        }
      }

      store.setActiveOrder(order)
      // Terminal success transition for the submit loading toast
      toast.update(submitId, { variant: 'success', title: 'Order open', message: `#${shorten(order.order_id, 6)}` })

      // Add to history
      store.addToHistory({
        orderId: order.order_id,
        timestamp: Date.now(),
        chainId: store.chainId,
        inputToken: store.inputToken?.symbol || '',
        outputToken: store.outputToken?.symbol || '',
        inputAmount: store.inputAmount,
        outputAmount: store.quote.estimated_output
          ? formatAmount(store.quote.estimated_output, store.outputToken?.decimals || 18, 6)
          : '?',
        status: order.status,
      })

      // ERC-20 input: relayer submits the TX (gasless UX preserved).
      pollOrderStatus(order.order_id)
    } catch (e) {
      store.setError((e as Error).message)
      // Only reached for errors not already handled in the submit/signing
      // sub-blocks (e.g. orderParams setup, cross-chain logic). Fire a
      // one-shot error since there may be no loading toast in scope.
      toast.error({ title: 'Swap failed', message: (e as Error).message })
    } finally {
      store.setSubmitting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.quote, store.appId, store.chainId])

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  return { submitSwap }
}
