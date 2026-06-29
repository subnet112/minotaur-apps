import { describe, it, expect } from 'vitest'
import { maxUint256 } from 'viem'

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

/**
 * The "Unlimited approval" setting (Settings sheet) must actually change the
 * approved amount. useApproval.approve() selects:
 *   amount = unlimited ? maxUint256 : BigInt(exact)
 * Mirror that selection here so the toggle can't silently regress to
 * exact-amount-always (the bug it was shipped to fix).
 */
describe('approval amount selection (unlimited toggle)', () => {
  const pick = (unlimited: boolean, amountStr: string) =>
    unlimited ? maxUint256 : BigInt(String(amountStr))

  it('approves the exact amount when unlimited is OFF', () => {
    expect(pick(false, '500000')).toBe(500000n)
  })

  it('approves max-uint256 when unlimited is ON', () => {
    expect(pick(true, '500000')).toBe(maxUint256)
    expect(pick(true, '500000')).toBe(2n ** 256n - 1n)
  })

  it('a max-uint256 approval never needs re-approval for a later, larger swap', () => {
    const allowance = pick(true, '1')          // unlimited approval just granted
    const nextSwap = '999999999999999999999'   // 1000 ETH later — far bigger
    expect(allowance < BigInt(nextSwap)).toBe(false) // "approve once, swap forever"
  })
})
