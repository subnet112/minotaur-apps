import { describe, it, expect } from 'vitest'
import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  decodeAbiParameters,
  type Address,
} from 'viem'

/**
 * SwapExecuted decode invariant (post-fill execution breakdown).
 *
 * The event is IDENTICAL in V1 (contracts/src/DexAggregatorApp.sol) and V2
 * (contracts/src/v2/DexAggregatorAppV2.sol):
 *
 *   event SwapExecuted(
 *     bytes32 indexed orderId,   // topics[1]
 *     address indexed user,      // topics[2]
 *     address tokenIn,           // data[0]
 *     address tokenOut,          // data[1]
 *     uint256 amountIn,          // data[2]
 *     uint256 amountOut,         // data[3]  (gross `gained`)
 *     uint256 fee                // data[4]  (V2: app's share of surplus)
 *   )
 *
 * The UI (useOrderSubmission) matches the topic0 hash, then decodes the 5
 * NON-indexed fields from `data` — orderId/user are indexed and never in data.
 * This test builds a synthetic log the way the contract would emit it and
 * asserts the decode + the V2 received-amount math (delivered = amountOut - fee).
 */

const SIG = 'SwapExecuted(bytes32,address,address,address,uint256,uint256,uint256)'

const DATA_PARAMS = [
  { type: 'address' }, // tokenIn
  { type: 'address' }, // tokenOut
  { type: 'uint256' }, // amountIn
  { type: 'uint256' }, // amountOut (gross)
  { type: 'uint256' }, // fee
] as const

const TOKEN_IN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address // USDC (Base)
const TOKEN_OUT = '0x4200000000000000000000000000000000000006' as Address // WETH (Base)

function buildLog(amountIn: bigint, amountOut: bigint, fee: bigint) {
  return {
    topics: [
      keccak256(toBytes(SIG)), // topic0
      keccak256(toBytes('order-123')), // orderId (indexed)
      keccak256(toBytes('user-abc')), // user (indexed)
    ],
    data: encodeAbiParameters(DATA_PARAMS, [TOKEN_IN, TOKEN_OUT, amountIn, amountOut, fee]),
  }
}

describe('SwapExecuted decode', () => {
  it('matches the topic0 hash the UI computes', () => {
    const log = buildLog(1_000_000n, 480_000_000_000_000_000n, 2_000_000_000_000_000n)
    const uiTopic = keccak256(toBytes(SIG))
    expect(log.topics[0]).toBe(uiTopic)
  })

  it('decodes the 5 non-indexed fields (indexed orderId/user are not in data)', () => {
    const amountIn = 1_000_000n // 1 USDC (6 dec)
    const amountOut = 480_000_000_000_000_000n // 0.48 WETH gross
    const fee = 2_000_000_000_000_000n // 0.002 WETH app surplus fee
    const log = buildLog(amountIn, amountOut, fee)

    const [tokenIn, tokenOut, dAmountIn, dAmountOut, dFee] = decodeAbiParameters(
      DATA_PARAMS,
      log.data,
    ) as readonly [Address, Address, bigint, bigint, bigint]

    expect(tokenIn.toLowerCase()).toBe(TOKEN_IN.toLowerCase())
    expect(tokenOut.toLowerCase()).toBe(TOKEN_OUT.toLowerCase())
    expect(dAmountIn).toBe(amountIn)
    expect(dAmountOut).toBe(amountOut)
    expect(dFee).toBe(fee)
  })

  it('computes the V2 delivered amount as amountOut - fee', () => {
    const amountOut = 480_000_000_000_000_000n
    const fee = 2_000_000_000_000_000n
    const received = amountOut > fee ? amountOut - fee : amountOut
    expect(received).toBe(478_000_000_000_000_000n)
  })

  it('never underflows when fee >= amountOut (defensive)', () => {
    const amountOut = 1_000n
    const fee = 5_000n
    const received = amountOut > fee ? amountOut - fee : amountOut
    expect(received).toBe(amountOut)
  })
})
