import { describe, it, expect } from 'vitest'
import { ethers } from 'ethers'

/**
 * SWAP intent params encoding invariant.
 *
 * The DexAggregatorApp.sol contract expects exactly this 11-field layout
 * (see contracts/src/DexAggregatorApp.sol _swap). Drift here breaks
 * on-chain order verification.
 *
 *   abi.encode(
 *     address tokenIn,            // 0
 *     address tokenOut,           // 1
 *     uint256 amountIn,           // 2
 *     uint256 minAmountOut,       // 3
 *     address receiver,           // 4
 *     uint256 permitDeadline,     // 5  (hardcoded 0 — no permit)
 *     uint8   permitV,            // 6  (hardcoded 0)
 *     bytes32 permitR,            // 7  (hardcoded 0x0)
 *     bytes32 permitS,            // 8  (hardcoded 0x0)
 *     uint256 platformFeeWei,     // 9
 *     bool    unwrapOutput        // 10
 *   )
 *
 * The contract's _calculateProtocolFee override reads the second-to-last
 * 32-byte word to extract the fee at index 9 (because index 10 is the
 * unwrap bool). Any reorder or field-count drift breaks the fee read.
 * Lock the layout here.
 */

const SWAP_INTENT_TYPES = [
  'address', 'address', 'uint256', 'uint256', 'address',
  'uint256', 'uint8', 'bytes32', 'bytes32',
  'uint256',
  'bool',
]

describe('SWAP intent params encoding', () => {
  it('encodes 11 fields in the contract-expected order', () => {
    const coder = ethers.AbiCoder.defaultAbiCoder()
    const encoded = coder.encode(SWAP_INTENT_TYPES, [
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // tokenIn (USDC)
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // tokenOut (WETH)
      1000n * 10n ** 6n,                              // amountIn — 1000 USDC
      30n * 10n ** 16n,                                // minAmountOut — 0.3 ETH
      '0x5a33Bf4a6C1DA92e0f2bCc1edF8a4D33C8b9c108',  // receiver
      0n,                                              // permitDeadline
      0,                                               // permitV
      '0x' + '0'.repeat(64),                           // permitR
      '0x' + '0'.repeat(64),                           // permitS
      42n * 10n ** 15n,                                // platformFeeWei — 0.042 ETH
      false,                                           // unwrapOutput
    ])

    // 11 fields, each 32 bytes (bytes32/uint256 packed). Total 352 bytes hex = 704 chars.
    expect(encoded.length).toBe(2 + 11 * 64)

    // Field 9 (platformFeeWei) is the second-to-last 32-byte word.
    const feeHex = '0x' + encoded.slice(-128, -64)
    expect(BigInt(feeHex)).toBe(42n * 10n ** 15n)

    // Field 10 (unwrapOutput=false) is the last 32-byte word = all zeros.
    const unwrapHex = '0x' + encoded.slice(-64)
    expect(BigInt(unwrapHex)).toBe(0n)
  })

  it('encodes unwrapOutput=true at the trailing slot', () => {
    const coder = ethers.AbiCoder.defaultAbiCoder()
    const encoded = coder.encode(SWAP_INTENT_TYPES, [
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      1n, 1n,
      '0x5a33Bf4a6C1DA92e0f2bCc1edF8a4D33C8b9c108',
      0n, 0, '0x' + '0'.repeat(64), '0x' + '0'.repeat(64),
      0n,
      true,
    ])
    const unwrapHex = '0x' + encoded.slice(-64)
    expect(BigInt(unwrapHex)).toBe(1n)
  })

  it('preserves the permit-zero invariant when no permit is used', () => {
    const coder = ethers.AbiCoder.defaultAbiCoder()
    const encoded = coder.encode(SWAP_INTENT_TYPES, [
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      1n, 1n,
      '0x5a33Bf4a6C1DA92e0f2bCc1edF8a4D33C8b9c108',
      0n, 0, '0x' + '0'.repeat(64), '0x' + '0'.repeat(64),
      0n, false,
    ])
    // Fields 5,6,7,8 = permitDeadline, permitV, permitR, permitS — all zero.
    // Slots are 5 (32B), 6 (32B), 7 (32B), 8 (32B).
    // Position in hex: 0x prefix + slot * 64 chars per slot.
    for (const slotIdx of [5, 6, 7, 8]) {
      const slot = encoded.slice(2 + slotIdx * 64, 2 + (slotIdx + 1) * 64)
      expect(BigInt('0x' + slot), `slot ${slotIdx} should be zero`).toBe(0n)
    }
  })
})
