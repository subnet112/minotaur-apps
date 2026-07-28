/**
 * Order status classifier — single source of truth that maps the subnet's
 * OrderStatus enum (see minotaur_subnet/orderbook/orderbook.py) into the
 * design's 6-node stepper + failure handling.
 *
 * The API state machine has more states than the design's stepper has
 * nodes — we bucket the live ones into the closest visual position and
 * collapse all failure-class states into a single is-failed treatment.
 */

/** The six progress nodes the design ships. Index = position in stepper. */
export const STEPS = [
  'pending',
  'open',
  'solved',
  'scored',
  'consensus',
  'filled',
] as const

export type StepName = (typeof STEPS)[number]

export const STEP_LABELS: Record<StepName, string> = {
  pending: 'Pending',
  open: 'Open',
  solved: 'Solved',
  scored: 'Scored',
  consensus: 'Consensus',
  filled: 'Filled',
}

/** API statuses that mean "terminal success". */
export const TERMINAL_FILLED = new Set<string>(['filled'])

/**
 * API statuses that mean "terminal failure". Anything in here:
 *   - stops polling
 *   - flips the card to is-failed visuals
 *   - surfaces order.error in a toast + in the card body
 *
 * Sourced from OrderStatus (orderbook.py) — keep in sync if new failure
 * variants land server-side.
 */
export const TERMINAL_FAILED = new Set<string>([
  'rejected',
  'failed',
  'cancelled',
  'expired',
  'bridge_failed',
  'rolled_back',
  'partial_rollback',
  // CLIENT-SIDE synthetic status (not a server enum): an order that sat in a
  // non-terminal state too long without progressing — see `isOrderStalled`.
  // The common case is validators never scoring a 'solved' order, so the
  // backend status never advances and the card would otherwise spin forever.
  'stalled',
])

/**
 * How long an order may sit in a non-terminal state WITHOUT its status
 * advancing before the UI gives up and treats it as failed ("stalled").
 *
 * The backend has no "scoring failed" status — when validators fail to score
 * a solved order it simply never leaves 'solved', so polling never stops and
 * the card freezes at SOLVED (this is the bug this guards against). 3 minutes
 * comfortably exceeds a healthy solved → scored → consensus → filled cycle.
 */
export const ORDER_STALL_TIMEOUT_MS = 3 * 60 * 1000

/**
 * Non-terminal statuses where a long, quiet wait is EXPECTED — cross-chain
 * bridge legs and substrate unstaking can legitimately take many minutes.
 * Exempt from the stall timer so a slow-but-healthy settlement isn't flagged.
 */
export const STALL_EXEMPT = new Set<string>([
  'bridging',
  'unstaking',
  'executing_leg',
  // Cross-chain parked/recovery states: the first two wait on the USER (a
  // wallet prompt has no deadline we should nag about), refreshing is the
  // platform re-quoting a failed leg. All are healthy long waits, not stalls.
  'awaiting_plan_set_signature',
  'awaiting_user_decision',
  'refreshing',
])

/**
 * Whether a still-polling order should be considered stalled (a client-side
 * failure): it's non-terminal, not in a known-slow state, and its status
 * hasn't changed for at least ``ORDER_STALL_TIMEOUT_MS``.
 */
export function isOrderStalled(
  status: string | null | undefined,
  msSinceLastChange: number,
): boolean {
  const s = String(status ?? '')
  if (!s || TERMINAL_STATUSES.has(s) || STALL_EXEMPT.has(s)) return false
  return msSinceLastChange >= ORDER_STALL_TIMEOUT_MS
}

/** Union of all terminal statuses — for "stop polling / lock active order" logic. */
export const TERMINAL_STATUSES = new Set<string>([
  ...TERMINAL_FILLED,
  ...TERMINAL_FAILED,
])

/**
 * Map an API status string to the index in STEPS the card should highlight.
 * Returns -1 for failure-class statuses (caller flips to is-failed visuals).
 * Unknown statuses are best-effort mapped to 'open' (idx 1) so the card
 * doesn't go blank on a server enum we haven't seen yet.
 */
export function statusToStepIdx(status: string | null | undefined): number {
  if (!status) return 0
  if (TERMINAL_FAILED.has(status)) return -1
  switch (status) {
    case 'pending':       return 0
    case 'open':          return 1
    case 'assigned':      return 1  // picked up by block loop tick
    case 'solved':        return 2
    case 'scored':        return 3
    case 'approved':      return 4  // passed consensus
    case 'submitted':     return 4  // sent to relayer — still "consensus" visually
    case 'bridging':      return 4  // cross-chain source leg done, awaiting bridge
    case 'unstaking':     return 4  // substrate unstake in progress
    case 'executing_leg': return 4  // multi-leg: processing a forward leg
    case 'rolling_back':  return -1 // multi-leg rollback in progress = failure path
    case 'filled':        return 5
    default:
      // Unknown — pin near the start so the user sees *something* moving
      // rather than an empty card.
      return 1
  }
}

export interface OrderClassification {
  stepIdx: number
  isFailed: boolean
  isFilled: boolean
  isTerminal: boolean
}

/** One-call helper: classify a status string into everything the UI needs. */
export function classifyOrderStatus(status: string | null | undefined): OrderClassification {
  const isFailed = TERMINAL_FAILED.has(String(status ?? ''))
  const isFilled = TERMINAL_FILLED.has(String(status ?? ''))
  return {
    stepIdx: statusToStepIdx(status),
    isFailed,
    isFilled,
    isTerminal: isFailed || isFilled,
  }
}
