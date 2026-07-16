import { useEffect, useCallback } from 'react'
import { useToast } from '@/components/shell'
import { useSwapStore } from '../store'
import { BITTENSOR_CHAIN_ID } from '@/config/chains'
import { shorten } from '../utils'
import { useAccount, useChainId, useSwitchChain, useDisconnect } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'

/**
 * EVM wallet integration is now backed by wagmi + RainbowKit (see
 * src/config/wagmi.ts + src/main.tsx providers). This module is the thin
 * adapter that:
 *
 *   1. Mirrors wagmi's account / chain state into the Zustand store so the
 *      rest of the swap (which reads s.walletConnected / s.walletAddress /
 *      s.walletChainId) keeps working unchanged.
 *
 *   2. Exposes the same public API the page used pre-migration —
 *      connectExternalWallet, switchChain, connectBittensorWallet, etc. —
 *      so call sites don't churn. Internally:
 *        - connectExternalWallet now opens the RainbowKit connect modal
 *          (MetaMask + injected + WalletConnect + Coinbase + Ledger via WC).
 *        - switchChain delegates to wagmi's useSwitchChain.
 *        - Managed wallet + Bittensor wallet flows are unchanged.
 *
 * Window.ethereum is no longer touched directly anywhere in the swap.
 */

// ──────────────────────────────────────────────────────────────────────────
// Wallet state sync — wagmi → Zustand store
// ──────────────────────────────────────────────────────────────────────────

/**
 * Subscribes to wagmi's account/chain state and mirrors it into the store.
 * Mount once at the top of SwapPage (same place that used to call
 * `useMetaMaskListener`). All downstream code keeps reading the store.
 */
export function useWalletStateSync() {
  const store = useSwapStore()
  const { address, isConnected } = useAccount()
  const chainId = useChainId()

  useEffect(() => {
    if (store.walletMode !== 'external') return
    store.setWalletConnected(!!isConnected && !!address)
    store.setWalletAddress(address ?? '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected, store.walletMode])

  useEffect(() => {
    if (store.walletMode !== 'external') return
    store.setWalletChainId(chainId ?? null)
    // RainbowKit's chain modal changes wagmi state directly. Keep the swap
    // intent, tokens, balances, and contract on that selected deployed chain.
    if (chainId != null && store.appSupportedChains.includes(chainId) && store.chainId !== chainId) {
      store.setActiveChain(chainId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, store.walletMode, store.appSupportedChains])
}

/** Back-compat re-export — old import-site name. Behaviour is identical. */
export const useMetaMaskListener = useWalletStateSync

// ──────────────────────────────────────────────────────────────────────────
// Wallet actions
// ──────────────────────────────────────────────────────────────────────────

export function useWalletConnection() {
  const toast = useToast()
  const store = useSwapStore()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { disconnect } = useDisconnect()
  const { isConnected } = useAccount()

  // ── EVM wallet (any) ──────────────────────────────────────────────────

  const connectExternalWallet = useCallback(() => {
    if (isConnected) return
    openConnectModal?.()
  }, [isConnected, openConnectModal])

  const disconnectExternalWallet = useCallback(() => {
    disconnect()
  }, [disconnect])

  const switchChain = useCallback(async (targetChainId: number): Promise<boolean> => {
    try {
      await switchChainAsync({ chainId: targetChainId })
      return true
    } catch (e) {
      // wagmi throws on user rejection (UserRejectedRequestError) and on
      // chains the connected wallet doesn't know about. The injected
      // connector tries wallet_addEthereumChain when the chain is in our
      // wagmi config but missing from the wallet, so 4902 cases are
      console.warn('[wallet] switchChain failed:', e)
      toast.error({
        title: 'Network switch cancelled',
        message: 'Your wallet must be on the selected network to continue.',
      })
      return false
    }
  }, [switchChainAsync, toast])

  // Back-compat flag — every wagmi-supported wallet looks "connectable" to
  // the UI. Don't gate behaviour on this; gate on `s.walletConnected`.
  const hasMetaMask = true

  // ── Bittensor wallet (substrate) — unchanged ──────────────────────────

  // connectBittensorWallet: one-shot success/error toasts (not sticky — each
  // early-exit path is independent, no single async flow to wrap).
  const connectBittensorWallet = useCallback(async () => {
    try {
      store.setLoading(true)
      store.setError(null)

      const injectedWindow = window as any
      const extensions = injectedWindow.injectedWeb3

      if (!extensions || Object.keys(extensions).length === 0) {
        toast.error({ title: 'No Bittensor wallet found. Install Polkadot.js, Talisman, or SubWallet extension.' })
        return
      }

      const extensionName = Object.keys(extensions)[0]
      const extension = extensions[extensionName]
      const enabled = await extension.enable('Minotaur')

      if (!enabled || !enabled.accounts) {
        toast.error({ title: 'Wallet connection rejected' })
        return
      }

      const accounts = await enabled.accounts.get()
      if (!accounts || accounts.length === 0) {
        toast.error({ title: 'No Bittensor accounts found in wallet' })
        return
      }

      const account = accounts[0]
      store.setBittensorAddress(account.address)
      store.setBittensorConnected(true)
      store.setSourceChainId(BITTENSOR_CHAIN_ID)
      toast.success({ title: `Connected: ${shorten(account.address, 8)} (${extensionName})` })

      try {
        const res = await fetch(`/api/v1/native-bittensor/permissions?owner=${account.address}`)
        if (res.ok) {
          const data = await res.json()
          const permissions = data.permissions || []
          if (permissions.some((p: any) => p.status === 'active')) {
            store.setBittensorProxySetup(true)
            toast.success({ title: 'Proxy delegation already active' })
          }
        }
      } catch {
        // Permission check failed — user will need to set up proxy
      }
    } catch (e) {
      console.error('Bittensor wallet connect error:', e)
      toast.error({ title: 'Connection failed', message: (e as Error).message })
    } finally {
      store.setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sticky-loading-update: setupBittensorProxy uses a single loading toast
  // throughout the multi-step flow.
  const setupBittensorProxy = useCallback(async () => {
    if (!store.bittensorAddress) return

    // Pre-check — skip the full proxy setup if a permission is already active.
    try {
      const permCheckRes = await fetch(`/api/v1/native-bittensor/permissions?owner=${store.bittensorAddress}`)
      if (permCheckRes.ok) {
        const permCheckData = await permCheckRes.json()
        const permissions = permCheckData.permissions || []
        if (permissions.some((p: any) => p.status === 'active')) {
          store.setBittensorProxySetup(true)
          toast.success({ title: 'Proxy delegation already active' })
          return
        }
      }
    } catch {
      // Pre-check failure is non-fatal — proceed with the full setup flow.
    }

    const id = toast.loading({ title: 'Setting up Bittensor proxy…' })
    try {
      store.setLoading(true)
      store.setError(null)

      const healthRes = await fetch('/api/health')
      const health = await healthRes.json()
      const delegateHotkey = health.validator_hotkey || health.hotkey || health.solver_round_metagraph?.leader_hotkey || ''

      if (!delegateHotkey) {
        toast.update(id, { variant: 'error', title: 'Could not determine Minotaur delegate hotkey' })
        return
      }

      const injectedWindow = window as any
      const extensions = injectedWindow.injectedWeb3
      const extensionName = Object.keys(extensions)[0]
      const extension = extensions[extensionName]
      const enabled = await extension.enable('Minotaur')

      if (!enabled?.signer) {
        throw new Error('Wallet signer not available')
      }

      toast.update(id, { variant: 'loading', title: 'Please approve the proxy delegation in your wallet…' })

      const { ApiPromise, WsProvider } = await import('@polkadot/api')
      const wsUrl = 'ws://localhost:19944'
      const provider = new WsProvider(wsUrl)
      const polkadotApi = await ApiPromise.create({ provider })

      try {
        const tx = polkadotApi.tx.proxy.addProxy(delegateHotkey, 'Staking', 0)

        await new Promise<void>((resolve, reject) => {
          tx.signAndSend(
            store.bittensorAddress,
            { signer: enabled.signer },
            ({ status, dispatchError }: any) => {
              if (dispatchError) {
                if (dispatchError.isModule) {
                  const decoded = polkadotApi.registry.findMetaError(dispatchError.asModule)
                  reject(new Error(`${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`))
                } else {
                  reject(new Error(dispatchError.toString()))
                }
              }
              if (status.isInBlock || status.isFinalized) {
                resolve()
              }
            },
          )
        })

        toast.update(id, { variant: 'loading', title: 'On-chain confirmed, registering permission…' })
      } finally {
        await polkadotApi.disconnect()
      }

      const permRes = await fetch('/api/v1/native-bittensor/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_ss58: store.bittensorAddress,
          allowed_netuids: [2, 3, 4, 5],
          delegate_ss58: delegateHotkey,
          enable_remove_stake: true,
          policy_tier: 'hybrid',
        }),
      })

      if (permRes.ok) {
        const perm = await permRes.json()
        if (perm.permission_id) {
          await fetch(`/api/v1/native-bittensor/permissions/${perm.permission_id}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }

      store.setBittensorProxySetup(true)
      toast.update(id, { variant: 'success', title: `Proxy delegation active for delegate ${shorten(delegateHotkey, 8)}` })

    } catch (e) {
      console.error('Proxy setup error:', e)
      toast.update(id, { variant: 'error', title: 'Proxy setup failed', message: (e as Error).message })
    } finally {
      store.setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.bittensorAddress])

  return {
    connectExternalWallet,
    disconnectExternalWallet,
    connectBittensorWallet,
    setupBittensorProxy,
    switchChain,
    hasMetaMask,
  }
}
