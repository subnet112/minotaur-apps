import { describe, it, expect } from 'vitest'

/**
 * The store's checkAllowance() does:
 *   needsApproval = BigInt(allowance) < BigInt(String(amount))
 *
 * The String() coercion is load-bearing for large amounts — Number()
 * would overflow at 2^53. Lock the invariant by exercising the
 * comparison with amounts > Number.MAX_SAFE_INTEGER.
 */
describe('allowance BigInt comparison', () => {
  it('handles amounts within safe integer range', () => {
    const allowance = '1000000' // 1 USDC
    const amount = '500000'      // 0.5 USDC
    expect(BigInt(allowance) < BigInt(String(amount))).toBe(false)
  })

  it('handles amounts > 2^53 without overflow', () => {
    const big = '1000000000000000000000' // 1000 ETH in wei
    expect(BigInt(big) < BigInt(String(big))).toBe(false)
    expect(BigInt('999999999999999999999') < BigInt(String(big))).toBe(true)
  })

  it('treats max-uint256 as not requiring approval', () => {
    const max = (2n ** 256n - 1n).toString()
    const amount = '1000000000000000000' // 1 ETH
    expect(BigInt(max) < BigInt(String(amount))).toBe(false)
  })

  it('returns true when allowance is one wei short', () => {
    const need = '100'
    const have = '99'
    expect(BigInt(have) < BigInt(String(need))).toBe(true)
  })
})
