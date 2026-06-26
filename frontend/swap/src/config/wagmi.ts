/**
 * wagmi + RainbowKit config.
 *
 * Single place to declare the EVM chains the swap UI supports, the
 * transports used to read from them, and which wallet connectors
 * RainbowKit's modal exposes.
 */

import { connectorsForWallets } from '@rainbow-me/rainbowkit'
import {
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets'
import { createConfig, http } from 'wagmi'
import { base } from 'wagmi/chains'

const PUBLIC_RPC_BASE = 'https://mainnet.base.org'

// ──────────────────────────────────────────────────────────────────────
// Chain list. Should match the DexAggregator's deployed chains. Today
// that's Base only. When a new deployment lands on
// /v1/apps/{id}/status.deployments, add the corresponding wagmi chain
// entry here AND a transport below.
// ──────────────────────────────────────────────────────────────────────
const chains = [base] as const

// ──────────────────────────────────────────────────────────────────────
// Wallet connectors.
//
// VITE_WC_PROJECT_ID gates the WalletConnect connector. Get one (free)
// at https://cloud.reown.com (formerly cloud.walletconnect.com). Without
// it the WC SDK 403s on its config endpoint and produces ugly console
// errors, so we just don't register the connector at all — the modal
// shows only injected wallets (MetaMask / Rabby / Brave / Frame /
// Coinbase Wallet's injected) which work without a project ID.
// ──────────────────────────────────────────────────────────────────────
const WC_PROJECT_ID =
  (import.meta.env.VITE_WC_PROJECT_ID as string | undefined)?.trim() ?? ''

// Wallet factories (CreateWalletFn) — let inference type the array so it
// matches connectorsForWallets' expected `wallets: CreateWalletFn[]`.
const baseWallets = [
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  coinbaseWallet,
]

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Popular',
      // walletConnectWallet bundles 600+ wallets (mobile + Ledger Live +
      // hardware via WC). Only include it when an ID is configured so we
      // don't spam the console with placeholder-id 403s.
      wallets: WC_PROJECT_ID
        ? [...baseWallets, walletConnectWallet]
        : baseWallets,
    },
  ],
  {
    appName: 'Minotaur Swap',
    // RainbowKit's lib still requires a string here even when WC is
    // disabled (the value is passed through to wagmi's createConfig).
    // Use a deterministic non-empty placeholder so the connector init
    // doesn't error — it's never sent to the WC servers when
    // walletConnectWallet is absent from the connectors list.
    projectId: WC_PROJECT_ID || 'minotaur-swap-no-walletconnect',
  },
)

export const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: {
    [base.id]: http(PUBLIC_RPC_BASE),
  },
  ssr: false,
})
