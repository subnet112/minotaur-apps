import { useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { useSwapStore } from '../swap.store'
import { BITTENSOR_CHAIN_ID } from '@/config/chains'
import { formatAmount, shorten } from '../swap.utils'
import * as api from '@/api/client'

/**
 * Order submission hook: handles submit + ERC-20 approval + EIP-712 signing + polling.
 */
export function useOrderSubmission() {
  const store = useSwapStore()
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const pollOrderStatus = useCallback((orderId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    store.setPolling(true)

    pollRef.current = setInterval(async () => {
      try {
        const status = await api.getOrderStatus(orderId)
        store.setActiveOrder(status)

        const terminal = ['filled', 'failed', 'cancelled']
        if (terminal.includes(status.status)) {
          clearInterval(pollRef.current!)
          pollRef.current = null
          store.setPolling(false)

          if (status.status === 'filled') {
            toast.success(`Swap filled! Score: ${status.score ?? 'N/A'}`)
            // Fetch execution details from tx receipt
            if (status.tx_hash && window.ethereum) {
              try {
                const { ethers } = await import('ethers')
                const provider = new ethers.BrowserProvider(window.ethereum)
                const receipt = await provider.getTransactionReceipt(
                  status.tx_hash.startsWith('0x') ? status.tx_hash : '0x' + status.tx_hash
                )
                if (receipt) {
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
                    const surplus = BigInt(amountOut) - minOutput
                    store.setExecutionDetails({
                      amountIn: amountIn.toString(),
                      amountOut: amountOut.toString(),
                      fee: fee.toString(),
                      surplus: surplus > 0n ? surplus.toString() : '0',
                      tokenIn: tokenIn as string,
                      tokenOut: tokenOut as string,
                      gasUsed: receipt.gasUsed?.toString() || '0',
                    })
                  }
                }
              } catch (e) { console.warn('Failed to fetch execution details:', e) }
            }
          } else if (status.status === 'failed') {
            toast.error('Swap execution failed')
          }
        }
      } catch {
        // Polling errors are transient -- keep trying
      }
    }, 3000)
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
      toast.error(msg)
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

      // Same-chain Bittensor: call the stake endpoint directly
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
          toast.success(`${orderParams.action === 'add_stake' ? 'Staked' : 'Unstaked'} successfully!`)
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
          toast.error(stakeResult.error || 'Failed')
        }
        return
      }

      // NOTE: ERC-20 approval is handled by the ActionButton (Approve step).

      // Native ETH/TAO input: mark the order for user-direct-submit. The
      // relayer can't pull msg.value from an external wallet, so for native
      // input the user will send the executeIntent TX themselves (single
      // MetaMask popup). The contract wraps msg.value → WETH atomically
      // inside _fundAndExecute. For ERC-20 input, the standard relayer flow
      // stays unchanged.
      const isNativeInput = !!(
        store.walletMode === 'external' &&
        store.inputToken?.native &&
        window.ethereum
      )
      if (isNativeInput) {
        orderParams._user_submit = true
      }

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

      // Step 1: Submit order to get the server-assigned order_id
      const orderChainId = store.isCrossChain ? store.sourceChainId : store.chainId

      const order = await api.submitOrder(
        store.appId,
        orderParams,
        addr,
        {
          intentFunction: store.quote?.intent_function || 'swap',
          chainId: orderChainId,
        },
      )

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

          toast.info('Please sign the swap order in MetaMask...')
          const userSignature = await signer.signTypedData(domain, types, value)

          // Step 3: Attach signature via the API client (honours VITE_API_URL).
          // A hardcoded relative fetch here used to silently 404 in production
          // because CloudFront doesn't proxy /api/* to the backend.
          await api.attachSignature(order.order_id, userSignature)
          toast.success('Order signed!')
        } catch (sigErr: any) {
          if (sigErr?.code === 'ACTION_REJECTED' || sigErr?.code === 4001) {
            // For EVM external-wallet swaps the signature is mandatory —
            // the server needs it for consensus verification. Abort loudly
            // instead of shipping an unsigned order.
            const msg = 'Signature rejected — order cancelled'
            store.setError(msg)
            toast.error(msg)
            store.setSubmitting(false)
            return
          }
          // Any other signing failure (network, server error) is also fatal.
          console.error('EIP-712 signing/attach failed:', sigErr)
          const msg = 'Failed to attach signature: ' + (sigErr?.message || String(sigErr))
          store.setError(msg)
          toast.error(msg)
          store.setSubmitting(false)
          return
        }
      }

      store.setActiveOrder(order)
      toast.success(`Order submitted: ${shorten(order.order_id, 6)}`)

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

      // Native ETH input: user submits executeIntent directly with msg.value.
      // The relayer can't pull native tokens, only the account holder can
      // attach msg.value. The contract wraps it to WETH atomically inside
      // _fundAndExecute, so this ends up as a single MetaMask popup.
      if (isNativeInput) {
        try {
          toast.info('Waiting for validator consensus...')
          const prepared = await api.prepareDirectSubmit(order.order_id)

          const { ethers } = await import('ethers')
          const provider = new ethers.BrowserProvider(window.ethereum!)
          const signer = await provider.getSigner()

          toast.info('Submit the swap transaction in MetaMask...')
          const tx = await signer.sendTransaction({
            to: prepared.contract_address,
            data: prepared.calldata,
            value: BigInt(prepared.value),
          })
          toast.success(`TX sent: ${shorten(tx.hash, 6)}`)
          // Wait for the receipt, then finalize the order on the API.
          // The API doesn't watch IntentExecuted events on its own, so the
          // frontend is responsible for closing the loop for user-direct TXs.
          const receipt = await tx.wait()
          if (receipt && receipt.status === 1) {
            await api.confirmUserSubmittedTx(order.order_id, tx.hash)
          }
          // Poll picks up the FILLED status and fetches execution details.
          pollOrderStatus(order.order_id)
        } catch (txErr: any) {
          if (txErr?.code === 'ACTION_REJECTED' || txErr?.code === 4001) {
            store.setError('Transaction rejected')
            toast.error('Transaction rejected')
          } else {
            console.error('Direct-submit TX failed:', txErr)
            store.setError(txErr?.message || 'Direct submission failed')
            toast.error('Direct submission failed')
          }
        }
      } else {
        // ERC-20 input: relayer submits the TX (gasless UX preserved).
        pollOrderStatus(order.order_id)
      }
    } catch (e) {
      store.setError((e as Error).message)
      toast.error('Swap failed')
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
