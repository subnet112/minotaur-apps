/**
 * Environment configuration. Every knob has a safe default so the service runs
 * with zero config against the public validator + public RPCs; override via env
 * (see .env.example) for production reliability.
 */

function str(key: string, def: string): string {
  const v = process.env[key]
  return v && v.trim() ? v.trim() : def
}

function num(key: string, def: number): number {
  const v = process.env[key]
  const n = v ? Number(v) : NaN
  return Number.isFinite(n) ? n : def
}

function list(key: string, def: string[]): string[] {
  const v = str(key, '')
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : def
}

export const config = {
  port: num('PORT', 8080),
  host: str('HOST', '0.0.0.0'),
  logLevel: str('LOG_LEVEL', 'info'),

  /** CORS allowlist. `['*']` → reflect any origin. */
  allowedOrigins: list('ALLOWED_ORIGINS', ['https://app.minotaursubnet.com']),

  validatorApiUrl: str('VALIDATOR_API_URL', 'https://api.minotaursubnet.com').replace(/\/+$/, ''),
  validatorTimeoutMs: num('VALIDATOR_TIMEOUT_MS', 25_000),

  /** Server-side RPC per chain, for the Multicall3 balances path. */
  rpcUrls: {
    1: str('ETH_RPC_URL', 'https://ethereum-rpc.publicnode.com'),
    8453: str('BASE_RPC_URL', 'https://mainnet.base.org'),
  } as Record<number, string>,
  balancesFallbackToValidator: str('BALANCES_FALLBACK_TO_VALIDATOR', 'false') === 'true',

  sharedTtlMs: num('SHARED_TTL_MS', 30_000),
  sharedStaleMs: num('SHARED_STALE_MS', 300_000),
  sharedRefreshMs: num('SHARED_REFRESH_MS', 60_000),

  tokenListTtlMs: num('TOKEN_LIST_TTL_MS', 3_600_000),
  superchainUrl: str('SUPERCHAIN_TOKEN_LIST_URL', 'https://static.optimism.io/optimism.tokenlist.json'),

  balancesTtlMs: num('BALANCES_TTL_MS', 15_000),
  balancesStaleMs: num('BALANCES_STALE_MS', 60_000),
} as const
