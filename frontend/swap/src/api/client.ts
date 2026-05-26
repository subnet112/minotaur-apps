/**
 * Minotaur API client.
 *
 * All methods hit the Vite dev proxy at /api which forwards to VITE_API_URL.
 * In production, configure the reverse proxy or set the base URL directly.
 */

import { DEFAULT_CHAIN_ID } from '@/config/chains'

const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}`
  : '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new ApiError(res.status, body.detail ?? body.error ?? JSON.stringify(body))
  }
  const data = await res.json()
  // Validator API returns HTTP 200 with { "error": "..." } on failures.
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    throw new ApiError(200, String(data.error))
  }
  return data as T
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

// ── Health ───────────────────────────────────────────────────────────────────

export function healthCheck(): Promise<{ status: string; [k: string]: unknown }> {
  return request('/health')
}

// ── Chains ───────────────────────────────────────────────────────────────────

export interface ChainInfo {
  chain_id: number
  name: string
  rpc_available: boolean
  registry_address: string | null
}

export function getChains(): Promise<{ chains: ChainInfo[] }> {
  return request('/v1/chains')
}

export interface SolverToken {
  address: string
  symbol: string
  decimals: number
  pool_count: number
}

export function getChainTokens(chainId: number): Promise<{ chain_id: number; tokens: SolverToken[]; count: number }> {
  return request(`/v1/chains/${chainId}/tokens`)
}

// ── Apps ─────────────────────────────────────────────────────────────────────

export interface AppSummary {
  app_id: string
  name: string
  description: string
  supported_chains: number[]
  deployer: string
  status?: string
  [k: string]: unknown
}

export function listApps(deployer?: string, status?: string): Promise<{ apps: AppSummary[] }> {
  const params = new URLSearchParams()
  if (deployer) params.set('deployer', deployer)
  if (status) params.set('status', status)
  const qs = params.toString() ? `?${params}` : ''
  return request(`/v1/apps/${qs}`)
}

export function getAppStatus(appId: string): Promise<Record<string, unknown>> {
  return request(`/v1/apps/${encodeURIComponent(appId)}/status`)
}

export function getAppManifest(appId: string): Promise<{ manifest: Record<string, unknown> | null; [k: string]: unknown }> {
  return request(`/v1/apps/${encodeURIComponent(appId)}/manifest`)
}

// ── App Management ──────────────────────────────────────────────────────────

export interface CreateAppResult {
  app_id: string
  name: string
  js_code_hash: string
  solidity_code_hash: string
  [k: string]: unknown
}

export function createApp(
  name: string,
  description: string,
  supportedChains: number[],
  jsCode: string,
  solidityCode: string,
  constructorArgs?: Array<{ abi_type: string; value: string }>,
  deployer?: string,
): Promise<CreateAppResult> {
  return request('/v1/apps/', {
    method: 'POST',
    body: JSON.stringify({
      name,
      description,
      supported_chains: supportedChains,
      js_code: jsCode,
      solidity_code: solidityCode,
      constructor_args: constructorArgs ?? [],
      deployer: deployer ?? '',
    }),
  })
}

export interface DeployAppResult {
  app_id: string
  status: string
  contract_address: string
  js_code_hash: string
  chain_id: number
  tx_hash: string
  abi: unknown
}

export function deployApp(appId: string, chainId?: number): Promise<DeployAppResult> {
  const qs = chainId != null ? `?chain_id=${chainId}` : ''
  return request(`/v1/apps/${encodeURIComponent(appId)}/deploy${qs}`, {
    method: 'POST',
  })
}

export interface UpdateScoringResult {
  js_code_hash: string
  version: number
  status: string
  message: string
}

export function updateScoring(appId: string, newJsCode: string, caller?: string): Promise<UpdateScoringResult> {
  return request(`/v1/apps/${encodeURIComponent(appId)}/scoring`, {
    method: 'PUT',
    body: JSON.stringify({
      new_js_code: newJsCode,
      caller: caller ?? '',
    }),
  })
}

export function listManifests(): Promise<{ manifests: Record<string, { manifest: Record<string, unknown> }> }> {
  return request('/v1/apps/manifests')
}

// ── Orders (prepare → quote → submit) ───────────────────────────────────────

export interface PrepareResult {
  app_id: string
  chain_id: number
  intent_function: string
  resolved_params: Record<string, unknown>
  user_nonce: number | null
  contract_address: string | null
  app_status: string
  next_steps: string[]
}

export function prepareOrder(
  appId: string,
  params: Record<string, unknown>,
  submittedBy?: string,
  intentFunction?: string,
  chainId?: number,
): Promise<PrepareResult> {
  return request(`/v1/apps/${encodeURIComponent(appId)}/prepare`, {
    method: 'POST',
    body: JSON.stringify({
      params,
      submitted_by: submittedBy ?? '',
      intent_function: intentFunction ?? 'execute',
      chain_id: chainId ?? DEFAULT_CHAIN_ID,
    }),
  })
}

export interface QuoteResult {
  app_id: string
  estimated_output: string
  suggested_min_output: string
  slippage_bps: number
  route_summary: string
  gas_estimate: number
  valid_for_seconds: number
  chain_id: number
  intent_function: string
  computed_params: Record<string, string>
  ready_params: Record<string, unknown>
  platform_fee_wei: string
  platform_fee_token: string
  platform_fee_symbol: string
}

export function getQuote(
  appId: string,
  params: Record<string, unknown>,
  opts?: { intentFunction?: string; chainId?: number; slippageBps?: number; signal?: AbortSignal },
): Promise<QuoteResult> {
  return request(`/v1/apps/${encodeURIComponent(appId)}/quote`, {
    method: 'POST',
    signal: opts?.signal,
    body: JSON.stringify({
      params,
      intent_function: opts?.intentFunction ?? 'execute',
      chain_id: opts?.chainId ?? DEFAULT_CHAIN_ID,
      slippage_bps: opts?.slippageBps ?? 50,
    }),
  })
}

export interface OrderResult {
  order_id: string
  app_id: string
  submitted_by: string
  status: string
  intent_function: string
  params: Record<string, unknown>
  plan: Record<string, unknown> | null
  score: number | null
  tx_hash: string | null
  chain_id: number
  [k: string]: unknown
}

export function submitOrder(
  appId: string,
  params: Record<string, unknown>,
  submittedBy: string,
  opts?: {
    intentFunction?: string
    chainId?: number
    deadline?: number
    perpetual?: boolean
    maxExecutions?: number
    cooldown?: number
    userSignature?: string
  },
): Promise<OrderResult> {
  return request(`/v1/apps/${encodeURIComponent(appId)}/orders`, {
    method: 'POST',
    body: JSON.stringify({
      params,
      submitted_by: submittedBy,
      intent_function: opts?.intentFunction ?? 'execute',
      chain_id: opts?.chainId ?? DEFAULT_CHAIN_ID,
      deadline: opts?.deadline ?? 0,
      perpetual: opts?.perpetual ?? false,
      max_executions: opts?.maxExecutions ?? 1,
      cooldown: opts?.cooldown ?? 0,
      user_signature: opts?.userSignature ?? '',
    }),
  })
}

export function getOrderStatus(orderId: string): Promise<OrderResult> {
  return request(`/v1/orders/${encodeURIComponent(orderId)}`)
}

export interface PrepareDirectResult {
  order_id: string
  contract_address: string
  chain_id: number
  calldata: string
  value: string  // wei as decimal string — msg.value for the TX
  status: string
}

/**
 * For native-ETH input orders: poll until consensus reached, then return
 * the fully-encoded executeIntent calldata so the user can send the TX
 * themselves with msg.value. Only the account holder can attach msg.value
 * to a TX, so the relayer can't do this for native input.
 */
export function prepareDirectSubmit(orderId: string): Promise<PrepareDirectResult> {
  return request(`/v1/orders/${encodeURIComponent(orderId)}/prepare-direct`, {
    method: 'POST',
  })
}

/**
 * Finalize a user-submitted order by attaching the on-chain tx_hash.
 * Called after the user's executeIntent TX confirms — transitions the
 * order from APPROVED to FILLED.
 */
export function confirmUserSubmittedTx(
  orderId: string,
  txHash: string,
): Promise<{ order_id: string; status: string; tx_hash: string }> {
  return request(`/v1/orders/${encodeURIComponent(orderId)}/tx-confirmed`, {
    method: 'PATCH',
    body: JSON.stringify({ tx_hash: txHash }),
  })
}

/**
 * Attach a user EIP-712 signature to an existing order. Called after the
 * frontend prompts MetaMask for a signature on the order's typed data.
 *
 * Goes through `request(...)` which honours VITE_API_URL — a hardcoded
 * `/api/v1/...` fetch would 404 in prod because CloudFront doesn't route
 * that path to the backend.
 *
 * M4 (subnet audit 2026-05-25): server also requires `owner_signature` —
 * an EIP-191 personal_sign over the AttachSig action payload binding
 * the user_signature being attached — and a `deadline` (unix seconds,
 * <24h in the future). Build both with `buildAttachSigOwnerSignature()`
 * in @/lib/orderOwnerSig.
 */
export function attachSignature(
  orderId: string,
  userSignature: string,
  ownerSignature: string,
  deadline: number,
): Promise<{ order_id: string; signature_attached: boolean }> {
  return request(`/v1/orders/${encodeURIComponent(orderId)}/signature`, {
    method: 'PATCH',
    body: JSON.stringify({
      user_signature: userSignature,
      owner_signature: ownerSignature,
      deadline,
    }),
  })
}

export function listOrders(appId?: string, status?: string): Promise<{ orders: OrderResult[]; count: number }> {
  const params = new URLSearchParams()
  if (appId) params.set('app_id', appId)
  if (status) params.set('status', status)
  const qs = params.toString()
  return request(`/v1/orders${qs ? '?' + qs : ''}`)
}

export function cancelOrder(orderId: string): Promise<{ order_id: string; status: string }> {
  return request(`/v1/orders/${encodeURIComponent(orderId)}`, { method: 'DELETE' })
}

// ── Bridge ───────────────────────────────────────────────────────────────────

export function getBridgeStatus(orderId: string): Promise<Record<string, unknown>> {
  return request(`/v1/orders/${encodeURIComponent(orderId)}/bridge`)
}

// ── Wallets ──────────────────────────────────────────────────────────────────

export interface WalletInfo {
  address: string
  type: string
  supported_chains: number[]
  created_at: string
  [k: string]: unknown
}

export function createWallet(chainIds: number[]): Promise<WalletInfo> {
  return request('/v1/wallets/', {
    method: 'POST',
    body: JSON.stringify({ chain_ids: chainIds }),
  })
}

export function listWallets(): Promise<{ wallets: WalletInfo[] }> {
  return request('/v1/wallets/')
}

export function getWallet(address: string): Promise<WalletInfo> {
  return request(`/v1/wallets/${encodeURIComponent(address)}`)
}

export interface BalancesResult {
  address: string
  chain_id: number
  eth_balance: string
  tokens: Record<string, { balance: string; symbol: string; decimals: number }>
  [k: string]: unknown
}

export function getWalletBalances(address: string, chainId: number = DEFAULT_CHAIN_ID, signal?: AbortSignal): Promise<BalancesResult> {
  return request(`/v1/wallets/${encodeURIComponent(address)}/balances?chain_id=${chainId}`, { signal })
}

// ── Testnet Faucet ───────────────────────────────────────────────────────────

export function faucetEth(address: string, amountEth: number = 10, chainId: number = 0): Promise<Record<string, unknown>> {
  return request('/v1/testnet/faucet', {
    method: 'POST',
    body: JSON.stringify({ address, amount_eth: amountEth, chain_id: chainId }),
  })
}

export function faucetErc20(
  token: string,
  address: string,
  amount: string,
  chainId: number = 0,
): Promise<Record<string, unknown>> {
  return request('/v1/testnet/faucet_erc20', {
    method: 'POST',
    body: JSON.stringify({ token, address, amount, chain_id: chainId }),
  })
}

// ── Monitoring ───────────────────────────────────────────────────────────────

export interface AppMonitor {
  app_id: string
  name: string
  best_scores: number[]
  recent_executions: {
    total: number
    successful: number
    avg_score: number
    last_triggered: number | null
  }
  solver_stats: Record<string, unknown>
}

export function monitorApp(appId: string): Promise<AppMonitor> {
  return request(`/v1/apps/${encodeURIComponent(appId)}/monitor`)
}

// ── App Status ──────────────────────────────────────────────────────────────

export interface AppStatusResult {
  app_id: string
  name: string
  status: string
  executions: number
  successful_executions: number
  avg_score: number
  best_score: number
  last_triggered: number | null
  contract_address: string | null
  chain_id: number
  deployments: Record<string, { contract_address: string; chain_id: number; status: string }>
}

export function getAppStatusTyped(appId: string): Promise<AppStatusResult> {
  return request(`/v1/apps/${encodeURIComponent(appId)}/status`)
}

// ── Submissions ─────────────────────────────────────────────────────────────

export interface SubmissionScreening {
  passed: boolean
  duration_ms: number
  error_code: string | null
}

export interface Submission {
  submission_id: string
  epoch: number
  hotkey: string
  repo_url: string
  commit_hash: string
  status: string
  created_at: number
  screening: {
    stage_1: SubmissionScreening | null
    stage_2: SubmissionScreening | null
    stage_3: SubmissionScreening | null
  }
  image_tag: string | null
  solver_name: string | null
  solver_version: string | null
  benchmark_score: number | null
  benchmark_rank: number | null
  rejection_reason: string | null
}

export function listSubmissions(epoch?: number, hotkey?: string): Promise<{ count: number; submissions: Submission[] }> {
  const params = new URLSearchParams()
  if (epoch != null) params.set('epoch', String(epoch))
  if (hotkey) params.set('hotkey', hotkey)
  const qs = params.toString()
  return request(`/v1/submissions${qs ? '?' + qs : ''}`)
}

// ── Block Loop ───────────────────────────────────────────────────────────────

export interface BlockLoopStatus {
  running: boolean
  tick_number: number
  tick_interval: number
  score_threshold: number
  last_tick: {
    tick_number: number
    orders_processed: number
    orders_approved: number
    orders_rejected: number
    orders_expired: number
    elapsed_ms: number
    timestamp: number
  } | null
  orderbook_stats: {
    open: number
    assigned: number
    solved: number
    scored: number
    approved: number
    submitted: number
    filled: number
    rejected: number
    expired: number
    cancelled: number
    bridging: number
    bridge_failed: number
  }
}

export function blockloopStatus(): Promise<BlockLoopStatus> {
  return request('/v1/blockloop/status')
}
