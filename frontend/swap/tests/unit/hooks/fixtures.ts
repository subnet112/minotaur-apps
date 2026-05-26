/**
 * Shared typed mock data for hook unit tests.
 *
 * All shapes are verified against src/types.ts and src/api/client.ts.
 * Only test files may import MOCK_* constants.
 */
import type { Token } from '@/config/chains'
import type { QuoteResult, OrderResult, BalancesResult } from '@/api/client'

// ── Addresses ───────────────────────────────────────────────────────────────

export const mockEvmAddress = '0x5a33Bf4a6C1DA92e0f2bCc1edF8a4D33C8b9c108'
export const mockBittensorAddress = '5GrwvaEF5zXb26Fz9rcQkQxwZsEzYq67VjQgVL3Cv7jD'

// ── Token (Token shape from src/config/chains.ts) ───────────────────────────

export const MOCK_TOKEN: Token = {
  symbol: 'USDC',
  name: 'USD Coin',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  decimals: 6,
  icon: '$',
}

export const MOCK_NATIVE_TOKEN: Token = {
  symbol: 'ETH',
  name: 'Ethereum',
  address: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  decimals: 18,
  icon: '⟠',
  native: true,
}

export const MOCK_WETH_TOKEN: Token = {
  symbol: 'WETH',
  name: 'Wrapped Ether',
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  decimals: 18,
  icon: '⟠',
}

// ── Quote (QuoteResult shape from src/api/client.ts) ─────────────────────────

export const MOCK_QUOTE: QuoteResult = {
  app_id: 'test-app-001',
  estimated_output: '985000000000000000',  // ~0.985 ETH
  suggested_min_output: '975150000000000000',
  slippage_bps: 100,
  route_summary: 'USDC → WETH via Uniswap V3 (0.05%)',
  gas_estimate: 180000,
  valid_for_seconds: 30,
  chain_id: 8453,
  intent_function: 'execute',
  computed_params: {
    token_in: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    token_out: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    amount_in: '1000000000',
  },
  ready_params: {
    input_token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    output_token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    input_amount: '1000000000',
    min_output: '975150000000000000',
  },
  platform_fee_wei: '0',
  platform_fee_token: '0x0000000000000000000000000000000000000000',
  platform_fee_symbol: 'ETH',
}

// ── Order (OrderResult shape from src/api/client.ts) ─────────────────────────

export const MOCK_ORDER: OrderResult = {
  order_id: 'ord-test-abc123',
  app_id: 'test-app-001',
  submitted_by: mockEvmAddress,
  status: 'open',
  intent_function: 'execute',
  params: {
    token_in: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    token_out: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    amount_in: '1000000000',
    min_output: '975150000000000000',
    recipient: mockEvmAddress,
  },
  plan: null,
  score: null,
  tx_hash: null,
  chain_id: 8453,
}

// ── Balances (BalancesResult shape from src/api/client.ts) ──────────────────

export const MOCK_BALANCES: BalancesResult = {
  address: mockEvmAddress,
  chain_id: 8453,
  eth_balance: '1500000000000000000',  // 1.5 ETH
  tokens: {
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': {
      balance: '5000000000',  // 5000 USDC (6 decimals)
      symbol: 'USDC',
      decimals: 6,
    },
    '0x4200000000000000000000000000000000000006': {
      balance: '500000000000000000',  // 0.5 WETH
      symbol: 'WETH',
      decimals: 18,
    },
  },
}
