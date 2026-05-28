import { useEffect, useCallback, useRef } from 'react'
import { useToast } from '@/components/shell'
import { useSwapStore } from '../store'
import { BITTENSOR_CHAIN_ID, TOKENS } from '@/config/chains'
import { formatAmount, shorten } from '../utils'
import { classifyOrderStatus } from '@/lib/orderStatus'
import * as api from '@/api/client'
import { useWalletClient, usePublicClient } from 'wagmi'
import { keccak256, toBytes, encodeAbiParameters, slice, type Address } from 'viem'

/**
 * Order submission hook: handles submit + ERC-20 approval + EIP-712 signing + polling.
 */
export function useOrderSubmission() {
  const toast = useToast()
  const store = useSwapStore()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()

  const pollOrderStatus = useCallback((orderId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    store.setPolling(true)

    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getOrderStatus(orderId)
        store.setActiveOrder(status)

        // Keep the matching history row in sync so the RevealPanel shows
        // the order's *current* state instead of whatever it was at submit
        // time (always 'open'). Without this rejections / fills / expiries
        // are invisible in history.
        store.updateHistoryItem(orderId, {
          status: status.status,
          score: status.score ?? null,
          txHash: (status as Record<string, unknown>).tx_hash as string | null | undefined ?? null,
        })

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
            // Fetch execution details from tx receipt via viem's public client
            // (wagmi-injected — same RPC the rest of the app uses).
            if (status.tx_hash && publicClient) {
              try {
                const txHash = (status.tx_hash.startsWith('0x')
                  ? status.tx_hash
                  : '0x' + status.tx_hash) as `0x${string}`
                const receipt = await publicClient.getTransactionReceipt({ hash: txHash })
                if (receipt) {
                  // SwapExecuted event ABI — keep in sync with contracts/src/DexAggregatorApp.sol:
                  //   event SwapExecuted(bytes32 indexed orderId, address tokenIn, address tokenOut,
                  //     uint256 amountIn, uint256 amountOut, uint256 fee)
                  const swapTopic = keccak256(toBytes(
                    'SwapExecuted(bytes32,address,address,address,uint256,uint256,uint256)'
                  ))
                  const swapLog = receipt.logs.find((l) => l.topics[0] === swapTopic)
                  if (swapLog) {
                    // Decode the non-indexed fields (tokenIn, tokenOut, amountIn, amountOut, fee)
                    // — see solver_guide.md §SwapExecuted for the indexed/non-indexed split.
                    const { decodeAbiParameters } = await import('viem')
                    const decoded = decodeAbiParameters(
                      [
                        { type: 'address' }, { type: 'address' },
                        { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' },
                      ],
                      swapLog.data,
                    ) as readonly [Address, Address, bigint, bigint, bigint]
                    const [tokenIn, tokenOut, amountIn, amountOut, fee] = decoded
                    const minOutput = BigInt(String(
                      status.params?.min_output_amount
                      || store.quote?.ready_params?.min_output_amount
                      || '0'
                    ))
                    const surplusWei = amountOut - minOutput

                    // Format raw wei → "0.0481 USDC". Decimals + symbol come
                    // from the chain's TOKENS list; unknown tokens fall back
                    // to 18 decimals + shortened address. Fee is denominated
                    // in the output token per the SwapExecuted ABI.
                    const tokens = TOKENS[store.chainId] || []
                    const inMeta = tokens.find((t) => t.address.toLowerCase() === tokenIn.toLowerCase())
                    const outMeta = tokens.find((t) => t.address.toLowerCase() === tokenOut.toLowerCase())
                    const inDec = inMeta?.decimals ?? 18
                    const outDec = outMeta?.decimals ?? 18
                    const inSym = inMeta?.symbol ?? shorten(tokenIn, 4)
                    const outSym = outMeta?.symbol ?? shorten(tokenOut, 4)
                    const fmt = (wei: bigint, dec: number, sym: string) =>
                      `${formatAmount(wei.toString(), dec, 6)} ${sym}`

                    store.setExecutionDetails({
                      amountIn: fmt(amountIn, inDec, inSym),
                      amountOut: fmt(amountOut, outDec, outSym),
                      fee: fmt(fee, outDec, outSym),
                      surplus: surplusWei > 0n ? fmt(surplusWei, outDec, outSym) : '0',
                      tokenIn: tokenIn,
                      tokenOut: tokenOut,
                      // Gas is an integer count of gas units, not wei — no
                      // decimal formatting; just thousands-separators for
                      // legibility.
                      gasUsed: receipt.gasUsed != null
                        ? Number(receipt.gasUsed).toLocaleString()
                        : '0',
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

      // Step 2: EIP-712 user signature for external wallets (any wagmi connector).
      if (store.walletMode === 'external' && walletClient && store.contractAddress && order.order_id) {
        try {
          // Hash inputs to the IntentOrder typehash. paramsHash + orderId are
          // keccak256 of variable-length bytes; viem's keccak256 takes a hex
          // string or bytes, so we encode strings as utf-8 first.
          const orderIdHash = keccak256(toBytes(order.order_id))

          const intentParamsHex = order.params?.intent_params_hex
            ? ('0x' + (order.params.intent_params_hex as string)) as `0x${string}`
            : encodeAbiParameters(
                [
                  { type: 'address' }, { type: 'address' },
                  { type: 'uint256' }, { type: 'uint256' },
                  { type: 'address' }, { type: 'uint256' },
                  { type: 'uint8' }, { type: 'bytes32' }, { type: 'bytes32' },
                ],
                [
                  orderParams.input_token as Address,
                  orderParams.output_token as Address,
                  BigInt(orderParams.input_amount || '0'),
                  BigInt(orderParams.min_output_amount || '0'),
                  addr as Address,
                  0n, 0,
                  ('0x' + '00'.repeat(32)) as `0x${string}`,
                  ('0x' + '00'.repeat(32)) as `0x${string}`,
                ],
              )

          const paramsHash = keccak256(intentParamsHex)
          const intentSelector = (order.params?.intent_selector
            ? ('0x' + order.params.intent_selector) as `0x${string}`
            : slice(keccak256(toBytes('swap(address,address,uint256,uint256,address)')), 0, 4))

          // 2^256 - 1 — matches the canonical sentinel-nonce convention used
          // by the relayer (skips on-chain nonce verification) and the new
          // server-side EIP-712 recovery in api/routes/_signature_verify.py.
          const SENTINEL_NONCE = (1n << 256n) - 1n

          const domain = {
            name: 'MinotaurAppIntent',
            version: '1',
            chainId: store.chainId,
            verifyingContract: store.contractAddress as Address,
          } as const
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
          } as const
          const message = {
            orderId: orderIdHash,
            app: store.contractAddress as Address,
            intentSelector,
            paramsHash,
            submittedBy: addr as Address,
            chainId: BigInt(store.chainId),
            deadline: BigInt(Math.floor(Number(order.deadline ?? 0) || Date.now() / 1000 + 3600)),
            nonce: SENTINEL_NONCE,
            perpetual: false,
            maxExecutions: 1n,
            cooldown: 0n,
          }

          // Update the sticky loading toast to prompt the user — keep variant
          // 'loading' so the toast stays pinned while the wallet popup is open.
          toast.update(submitId, { variant: 'loading', title: 'Please sign the swap order in your wallet…' })
          const userSignature = await walletClient.signTypedData({
            account: addr as Address,
            domain,
            types,
            primaryType: 'IntentOrder',
            message,
          })

          // Single signature flow per subnet PR #55 (api: drop EIP-191
          // owner_signature on attach_signature, server-side ECDSA-recovers
          // the EIP-712 IntentOrder sig and checks the recovered address
          // equals submitted_by). The /cancel + /tx-confirmed flows still
          // need the EIP-191 helper (@/lib/orderOwnerSig is kept for them).
          //
          // Step 3: Attach signature via the API client (honours VITE_API_URL).
          // A hardcoded relative fetch here used to silently 404 in production
          // because CloudFront doesn't proxy /api/* to the backend.
          await api.attachSignature(order.order_id, userSignature)
          // Signature attached — update back to generic "submitting" while the
          // relayer picks up the order. The success transition happens below
          // once store.setActiveOrder is called.
          toast.update(submitId, { variant: 'loading', title: 'Order signed, waiting for relayer…' })
        } catch (sigErr: any) {
          // viem throws UserRejectedRequestError on user-reject (code 4001
          // preserved per EIP-1193). Keep the legacy ACTION_REJECTED check
          // for any signer that still returns ethers-shaped errors.
          if (
            sigErr?.code === 'ACTION_REJECTED'
            || sigErr?.code === 4001
            || sigErr?.name === 'UserRejectedRequestError'
          ) {
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
