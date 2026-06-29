import { describe, it, expect } from 'vitest'
import {
  classifyOrderStatus,
  isOrderStalled,
  ORDER_STALL_TIMEOUT_MS,
  STALL_EXEMPT,
  TERMINAL_FAILED,
} from '@/lib/orderStatus'

describe('classifyOrderStatus', () => {
  it('treats solved as in-progress, not terminal', () => {
    const c = classifyOrderStatus('solved')
    expect(c.stepIdx).toBe(2)
    expect(c.isFailed).toBe(false)
    expect(c.isTerminal).toBe(false)
  })

  it('treats the synthetic "stalled" status as a terminal failure', () => {
    expect(TERMINAL_FAILED.has('stalled')).toBe(true)
    const c = classifyOrderStatus('stalled')
    expect(c.isFailed).toBe(true)
    expect(c.isTerminal).toBe(true)
  })
})

describe('isOrderStalled', () => {
  const overTimeout = ORDER_STALL_TIMEOUT_MS + 1
  const underTimeout = ORDER_STALL_TIMEOUT_MS - 1

  it('flags a non-terminal order that has not progressed past the timeout', () => {
    // The reported bug: validators never score a solved order.
    expect(isOrderStalled('solved', overTimeout)).toBe(true)
    expect(isOrderStalled('open', overTimeout)).toBe(true)
    expect(isOrderStalled('scored', overTimeout)).toBe(true)
  })

  it('does NOT flag before the timeout elapses', () => {
    expect(isOrderStalled('solved', underTimeout)).toBe(false)
    expect(isOrderStalled('solved', 0)).toBe(false)
  })

  it('never flags terminal statuses (filled / failed)', () => {
    expect(isOrderStalled('filled', overTimeout)).toBe(false)
    expect(isOrderStalled('rejected', overTimeout)).toBe(false)
    expect(isOrderStalled('stalled', overTimeout)).toBe(false)
  })

  it('exempts known-slow states (bridging, unstaking, executing_leg)', () => {
    for (const s of STALL_EXEMPT) {
      expect(isOrderStalled(s, overTimeout)).toBe(false)
    }
  })

  it('ignores empty / nullish status', () => {
    expect(isOrderStalled(null, overTimeout)).toBe(false)
    expect(isOrderStalled(undefined, overTimeout)).toBe(false)
    expect(isOrderStalled('', overTimeout)).toBe(false)
  })
})
