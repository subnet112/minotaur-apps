/**
 * Canonical chain configuration — single source of truth for supported chains.
 *
 * All UI components that need chain metadata, token lists, or the set of
 * supported chain IDs should import from here.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChainConfig {
  name: string
  shortName: string
  icon: string
  color: string       // hex brand color (for inline styles)
  colorClass: string  // Tailwind bg class (for utility usage)
  explorer: string
  nativeSymbol?: string
  wrappedNative?: string  // WETH/WTAO address for auto-wrapping
}

export interface Token {
  symbol: string
  name: string
  address: string
  decimals: number
  icon: string
  native?: boolean
  logoURI?: string
}

// ---------------------------------------------------------------------------
// Supported Chains
// ---------------------------------------------------------------------------

export const SUPPORTED_CHAIN_IDS = [1, 8453, 964] as const

/** Networks where the deployed DEX Aggregator V2 is allowed to operate.
 * This is intentionally narrower than CHAIN_CONFIG: the catalog retains
 * Bittensor networks for the future cross-chain flow, while the current
 * single-chain swap UI only exposes its EVM deployments. */
export const DEX_DEPLOYED_EVM_CHAIN_IDS = [1, 8453] as const

// Bittensor chain ID (virtual — substrate, not EVM)
export const BITTENSOR_CHAIN_ID = 0

// Bittensor EVM chain ID
export const BITTENSOR_EVM_CHAIN_ID = 964

export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number]

// ---------------------------------------------------------------------------
// Chain Metadata
// ---------------------------------------------------------------------------

export const CHAIN_CONFIG: Record<number, ChainConfig> = {
  1: {
    name: 'Ethereum',
    shortName: 'ETH',
    icon: '\u27E0',
    color: '#627EEA',
    colorClass: 'bg-indigo-600',
    explorer: 'https://etherscan.io',
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  },
  8453: {
    name: 'Base',
    shortName: 'Base',
    icon: '\uD83D\uDD35',
    color: '#0052FF',
    colorClass: 'bg-blue-600',
    explorer: 'https://basescan.org',
    wrappedNative: '0x4200000000000000000000000000000000000006',
  },
  964: {
    name: 'Bittensor EVM',
    shortName: 'BT EVM',
    icon: '\u03C4',
    color: '#1E1E2E',
    colorClass: 'bg-slate-800',
    explorer: 'https://evm.taostats.io',
    wrappedNative: '0x9Dc08C6e2BF0F1eeD1E00670f80Df39145529F81',
  },
  0: {
    name: 'Bittensor',
    shortName: 'BT',
    icon: '\u03C4',
    color: '#1E1E2E',
    colorClass: 'bg-slate-800',
    explorer: 'https://taostats.io',
  },
}

// ---------------------------------------------------------------------------
// Token Lists (per chain)
// ---------------------------------------------------------------------------

export const TOKENS: Record<number, Token[]> = {
  1: [
    { symbol: 'ETH', name: 'Ethereum', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, icon: '\u27E0', native: true },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18, icon: '\u27E0' },
    { symbol: 'USDC', name: 'USD Coin', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, icon: '$' },
    { symbol: 'USDT', name: 'Tether USD', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, icon: '$' },
    { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18, icon: '$' },
    { symbol: 'WBTC', name: 'Wrapped Bitcoin', address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, icon: '\u20BF' },
    { symbol: 'wTAO', name: 'Wrapped TAO', address: '0x77E06c9eCCf2E797fd462A92B6D7642EF85b0A44', decimals: 9, icon: '\u03C4' },
    { symbol: 'LINK', name: 'Chainlink', address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimals: 18, icon: '\u26D3' },
    { symbol: 'UNI', name: 'Uniswap', address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimals: 18, icon: '\uD83E\uDD84' },
    { symbol: 'AAVE', name: 'Aave', address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9', decimals: 18, icon: '\uD83D\uDC7B' },
    { symbol: 'MKR', name: 'Maker', address: '0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2', decimals: 18, icon: '\u2666' },
    { symbol: 'SNX', name: 'Synthetix', address: '0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F', decimals: 18, icon: 'S' },
    { symbol: 'COMP', name: 'Compound', address: '0xc00e94Cb662C3520282E6f5717214004A7f26888', decimals: 18, icon: 'C' },
    { symbol: 'CRV', name: 'Curve DAO', address: '0xD533a949740bb3306d119CC777fa900bA034cd52', decimals: 18, icon: '\u27F0' },
    { symbol: 'LDO', name: 'Lido DAO', address: '0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32', decimals: 18, icon: '\u25B2' },
    { symbol: 'RPL', name: 'Rocket Pool', address: '0xD33526068D116cE69F19A9ee46F0bd304F21A51f', decimals: 18, icon: '\uD83D\uDE80' },
    { symbol: 'APE', name: 'ApeCoin', address: '0x4d224452801ACEd8B2F0aebE155379bb5D594381', decimals: 18, icon: '\uD83E\uDD8D' },
    { symbol: 'SHIB', name: 'Shiba Inu', address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', decimals: 18, icon: '\uD83D\uDC15' },
    { symbol: 'PEPE', name: 'Pepe', address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', decimals: 18, icon: '\uD83D\uDC38' },
    { symbol: 'FXS', name: 'Frax Share', address: '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0', decimals: 18, icon: 'F' },
    { symbol: 'FRAX', name: 'Frax', address: '0x853d955aCEf822Db058eb8505911ED77F175b99e', decimals: 18, icon: '$' },
    { symbol: 'stETH', name: 'Lido Staked ETH', address: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84', decimals: 18, icon: '\u27E0' },
    { symbol: 'rETH', name: 'Rocket Pool ETH', address: '0xae78736Cd615f374D3085123A210448E74Fc6393', decimals: 18, icon: '\u27E0' },
  ],
  8453: [
    { symbol: 'ETH', name: 'Ethereum', address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', decimals: 18, icon: '\u27E0', native: true },
    { symbol: 'WETH', name: 'Wrapped Ether', address: '0x4200000000000000000000000000000000000006', decimals: 18, icon: '\u27E0' },
    { symbol: 'USDC', name: 'USD Coin', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, icon: '$' },
  ],
  964: [
    { symbol: 'TAO', name: 'Bittensor TAO', address: '0x9Dc08C6e2BF0F1eeD1E00670f80Df39145529F81', decimals: 18, icon: '\u03C4', native: true },
    { symbol: 'USDC', name: 'USD Coin (Hyperlane)', address: '0xB833E8137FEDf80de7E908dc6fea43a029142F20', decimals: 6, icon: '$' },
  ],
  // Bittensor subnet tokens (chain 0 = Bittensor substrate)
  // Only show subnets with liquidity. On local testnet, only SN2 has staked TAO.
  0: [
    { symbol: 'TAO', name: 'Bittensor TAO', address: 'native', decimals: 9, icon: '\u03C4', native: true },
    { symbol: 'Alpha (SN2)', name: 'Local Testnet Alpha', address: 'alpha:2', decimals: 9, icon: '\u03B1' },
  ],
}

export const DEFAULT_CHAIN_ID: SupportedChainId = 8453
