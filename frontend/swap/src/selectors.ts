/**
 * Derived selectors that translate raw SwapState into the design's union
 * types (ActionState — 12 values, ModeBlock — 7 values). These are the
 * only place functional code meets the design's prototype type
 * vocabulary. Tested exhaustively in tests/unit/selectors.test.ts.
 *
 * Spec: IMPL guide §3.8 (mode block), §3.9 (action button states).
 */
import type { ActionState, ModeBlock } from '@/types'
import { TERMINAL_STATUSES } from '@/lib/orderStatus'

// Minimal slice of the store we need. Avoids importing the store type to
// keep selectors usable with synthetic test fixtures.
interface SelectableState {
  walletMode: 'external' | 'bittensor'
  walletConnected: boolean
  walletChainId: number | null
  sourceChainId: number
  chainId: number
  isCrossChain: boolean
  inputAmount: string
  inputBalance: string | null
  inputToken: { native?: boolean } | null
  evmRecipient: string
  quote: unknown | null
  activeOrder: { status: string } | null
  needsApproval: boolean
  approving: boolean
  loading: boolean
  submitting: boolean
  bittensorProxySetup: boolean
}

// Imported from @/lib/orderStatus so this list stays in lockstep with the
// subnet's OrderStatus enum — earlier this only included three statuses
// and rejected/expired/bridge_failed orders left the action button stuck.
const TERMINAL_ORDER_STATUSES = TERMINAL_STATUSES

export function selectActionState(s: SelectableState): ActionState {
  if (!s.walletConnected) return 'disconnected'

  if (s.walletMode === 'external'
      && s.walletChainId !== null
      && s.walletChainId !== s.sourceChainId) {
    return 'wrong-network'
  }

  const amt = parseFloat(s.inputAmount || '')
  if (!amt) return 'empty'

  // Cross-chain from Bittensor to EVM requires an EVM recipient address
  if (s.isCrossChain
      && s.walletMode === 'bittensor'
      && !s.evmRecipient) {
    return 'enter-recipient'
  }

  if (amt > parseFloat(s.inputBalance ?? '0')) return 'insufficient'

  if (s.loading) return 'fetching'
  if (!s.quote) return 'no-route'

  if (s.approving) return 'approving'
  // Approval CTA lives in WalletModeBlock (variant='approval'). The action
  // button stays disabled and non-spinning while we wait for the user to
  // trigger the approval there. `awaiting-sig` matches that semantic
  // ("Awaiting approval", disabled, no glyph).
  if (s.needsApproval) return 'awaiting-sig'

  if (s.submitting) return 'submitting'
  if (s.activeOrder && !TERMINAL_ORDER_STATUSES.has(s.activeOrder.status)) {
    return 'submitting'
  }

  return 'swap-ready'
}

export function selectModeBlockVariant(s: SelectableState): ModeBlock | null {
  // 'create-wallet' / 'fund-wallet' variants retired with the managed-wallet
  // flow removal. External (RainbowKit) handles its own connect UX; bittensor
  // wallet still needs the substrate proxy banner.
  if (s.walletMode === 'external' && s.needsApproval && !s.approving) return 'approval'
  if (s.approving) return 'approving'
  if (s.inputToken?.native) return 'native-eth'
  if (s.walletMode === 'bittensor' && !s.bittensorProxySetup) return 'setup-proxy'
  return null
}
