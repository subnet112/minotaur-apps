import { useEffect, useCallback } from 'react'
import { useToast } from '@/components/shell'
import { useSwapStore } from '../store'
import { BITTENSOR_CHAIN_ID } from '@/config/chains'
import { shorten } from '../utils'
import type { Token } from '../types'
import * as api from '@/api/client'

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
      on: (event: string, handler: (...args: unknown[]) => void) => void
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void
    }
  }
}

/**
 * Listens for MetaMask account/chain change events and auto-connects if already approved.
 */
export function useMetaMaskListener() {
  const store = useSwapStore()
  const hasMetaMask = typeof window !== 'undefined' && !!window.ethereum

  useEffect(() => {
    if (!hasMetaMask || store.walletMode !== 'external') return

    const handleAccountsChanged = (accounts: unknown) => {
      const accs = accounts as string[]
      if (accs.length === 0) {
        store.setWalletConnected(false)
        store.setWalletAddress('')
      } else {
        store.setWalletAddress(accs[0])
      }
    }

    const handleChainChanged = (chainIdHex: unknown) => {
      const newChainId = parseInt(chainIdHex as string, 16)
      store.setWalletChainId(newChainId)
    }

    window.ethereum!.on('accountsChanged', handleAccountsChanged)
    window.ethereum!.on('chainChanged', handleChainChanged)

    // Check if already connected
    window.ethereum!.request({ method: 'eth_accounts' }).then((accounts) => {
      const accs = accounts as string[]
      if (accs.length > 0) {
        store.setWalletConnected(true)
        store.setWalletAddress(accs[0])
      }
    }).catch(() => {})

    window.ethereum!.request({ method: 'eth_chainId' }).then((hex) => {
      store.setWalletChainId(parseInt(hex as string, 16))
    }).catch(() => {})

    return () => {
      window.ethereum!.removeListener('accountsChanged', handleAccountsChanged)
      window.ethereum!.removeListener('chainChanged', handleChainChanged)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMetaMask, store.walletMode])
}

/**
 * Wallet connection actions: MetaMask, managed wallet, Bittensor.
 */
export function useWalletConnection() {
  const toast = useToast()
  const store = useSwapStore()
  const hasMetaMask = typeof window !== 'undefined' && !!window.ethereum

  const connectExternalWallet = useCallback(async () => {
    if (!hasMetaMask) return
    try {
      const accounts = await window.ethereum!.request({ method: 'eth_requestAccounts' }) as string[]
      if (accounts.length > 0) {
        store.setWalletConnected(true)
        store.setWalletAddress(accounts[0])
        const hex = await window.ethereum!.request({ method: 'eth_chainId' }) as string
        store.setWalletChainId(parseInt(hex, 16))
      }
    } catch (e) {
      console.error('Wallet connect error:', e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMetaMask])

  // Sticky-loading-update: createManagedWallet fires a loading toast and
  // transitions it to success or error. One toast.update per id.
  const createManagedWallet = useCallback(async () => {
    const id = toast.loading({ title: 'Creating managed wallet…' })
    try {
      store.setLoading(true)
      const wallet = await api.createWallet([store.chainId])
      store.setManagedWallet(wallet)
      store.setWalletConnected(true)
      toast.update(id, { variant: 'success', title: `Wallet created: ${shorten(wallet.address)}` })
    } catch (e) {
      store.setError((e as Error).message)
      toast.update(id, { variant: 'error', title: 'Failed to create wallet', message: (e as Error).message })
    } finally {
      store.setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.chainId])

  // Sticky-loading-update: fundManagedWallet fires a loading toast and
  // transitions it to success or error. Balance refresh happens inside the
  // same try block — if it throws the error branch handles it.
  const fundManagedWallet = useCallback(async () => {
    const wallet = store.managedWallet
    if (!wallet) return
    const id = toast.loading({ title: 'Funding wallet…' })
    try {
      store.setLoading(true)
      await api.faucetEth(wallet.address, 10, store.chainId)
      await api.faucetErc20('USDC', wallet.address, '10000000000', store.chainId) // 10k USDC
      toast.update(id, { variant: 'success', title: 'Wallet funded with 10 ETH + 10k USDC' })
      // Refresh balances
      const res: any = await api.getWalletBalances(wallet.address, store.chainId)
      const ethBal = res.native?.balance_wei || res.eth_balance || '0'
      const tokenList: any[] = Array.isArray(res.tokens) ? res.tokens : Object.values(res.tokens || {})
      const getBalance = (token: Token | null): string | null => {
        if (!token) return null
        if (token.native) return ethBal
        for (const info of tokenList) {
          if (info.symbol?.toUpperCase() === token.symbol.toUpperCase()) return info.balance_raw || info.balance || '0'
          if (info.address?.toLowerCase() === token.address.toLowerCase()) return info.balance_raw || info.balance || '0'
        }
        return '0'
      }
      store.setInputBalance(getBalance(store.inputToken))
      store.setOutputBalance(getBalance(store.outputToken))
    } catch (e) {
      store.setError((e as Error).message)
      toast.update(id, { variant: 'error', title: 'Faucet failed', message: (e as Error).message })
    } finally {
      store.setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.managedWallet, store.chainId])

  // connectBittensorWallet: one-shot success/error toasts (not sticky — each
  // early-exit path is independent, no single async flow to wrap).
  const connectBittensorWallet = useCallback(async () => {
    try {
      store.setLoading(true)
      store.setError(null)

      // Check for Polkadot.js or compatible extension
      const injectedWindow = window as any
      const extensions = injectedWindow.injectedWeb3

      if (!extensions || Object.keys(extensions).length === 0) {
        toast.error({ title: 'No Bittensor wallet found. Install Polkadot.js, Talisman, or SubWallet extension.' })
        return
      }

      // Try to enable the first available extension
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

      // Use the first account
      const account = accounts[0]
      store.setBittensorAddress(account.address)
      store.setBittensorConnected(true)
      // Auto-set Bittensor as source chain for cross-chain swaps
      store.setSourceChainId(BITTENSOR_CHAIN_ID)
      toast.success({ title: `Connected: ${shorten(account.address, 8)} (${extensionName})` })

      // Check if proxy is already set up via API
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
        // Permission check failed -- user will need to set up proxy
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
  // throughout the multi-step flow. Mid-flow progress is communicated by
  // updating the loading toast title (keeping variant: 'loading'). The final
  // transition lands on success or error. One id — one terminal update.
  const setupBittensorProxy = useCallback(async () => {
    if (!store.bittensorAddress) return
    const id = toast.loading({ title: 'Setting up Bittensor proxy…' })
    try {
      store.setLoading(true)
      store.setError(null)

      // Step 1: Get Minotaur's delegate hotkey from the API
      const healthRes = await fetch('/api/health')
      const health = await healthRes.json()
      const delegateHotkey = health.validator_hotkey || health.hotkey || health.solver_round_metagraph?.leader_hotkey || ''

      if (!delegateHotkey) {
        toast.update(id, { variant: 'error', title: 'Could not determine Minotaur delegate hotkey' })
        return
      }

      // Step 2: Sign the on-chain proxy.addProxy() extrinsic
      const injectedWindow = window as any
      const extensions = injectedWindow.injectedWeb3
      const extensionName = Object.keys(extensions)[0]
      const extension = extensions[extensionName]
      const enabled = await extension.enable('Minotaur')

      if (!enabled?.signer) {
        throw new Error('Wallet signer not available')
      }

      // Inform user they need to approve in their wallet — keep toast sticky
      // (loading variant) while waiting for the wallet popup.
      toast.update(id, { variant: 'loading', title: 'Please approve the proxy delegation in your wallet…' })

      // Connect to the local subtensor and submit proxy.addProxy
      const { ApiPromise, WsProvider } = await import('@polkadot/api')
      const wsUrl = 'ws://localhost:19944' // Local subtensor websocket port
      const provider = new WsProvider(wsUrl)
      const polkadotApi = await ApiPromise.create({ provider })

      try {
        // proxy.addProxy(delegate, proxyType, delay)
        // proxyType: 'Staking' allows stake/unstake operations
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

        // On-chain confirmed — still more work to do (permission registration),
        // so keep the toast loading with an updated title rather than resolving.
        toast.update(id, { variant: 'loading', title: 'On-chain confirmed, registering permission…' })
      } finally {
        await polkadotApi.disconnect()
      }

      // Step 3: Create permission via API
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
    createManagedWallet,
    fundManagedWallet,
    connectBittensorWallet,
    setupBittensorProxy,
    hasMetaMask,
  }
}
