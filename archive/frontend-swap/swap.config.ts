/**
 * Swap dApp chain & token configuration.
 *
 * Re-exports from the canonical source at @/config/chains so that all
 * swap-internal imports continue to work without changing every file.
 */

export { CHAIN_CONFIG, TOKENS, SUPPORTED_CHAIN_IDS, DEFAULT_CHAIN_ID } from '@/config/chains'
export type { ChainConfig, Token } from '@/config/chains'
