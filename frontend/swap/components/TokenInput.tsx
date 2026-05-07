import { ChevronDown } from 'lucide-react'
import { formatAmount } from '../swap.utils'
import type { Token } from '../swap.types'

export function TokenInput({
  label,
  amount,
  onAmountChange,
  token,
  onTokenSelect,
  balance,
  decimals = 18,
  onMaxClick,
  readOnly = false,
  loading = false,
}: {
  label: string
  amount: string
  onAmountChange?: (value: string) => void
  token: Token | null
  onTokenSelect: () => void
  balance: string | null
  decimals?: number
  onMaxClick?: () => void
  readOnly?: boolean
  loading?: boolean
}) {
  return (
    <div className="glass-border rounded-[var(--radius-swap)] bg-[var(--bg-input-field)] p-5 flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <span className="text-tag text-[13px] tracking-[2px] text-[var(--text-muted)] uppercase">{label}</span>
        {balance !== null && (
          <span className="text-xs text-[var(--text-muted)]">
            Balance: {formatAmount(balance, decimals, 4)} {token?.symbol}
            {onMaxClick && (
              <button type="button" onClick={onMaxClick} className="ml-2 text-xs text-[var(--accent-lime)] hover:underline">MAX</button>
            )}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-4">
        {readOnly ? (
          <div className="flex-1 text-[36px] lg:text-[42px] font-normal leading-[1.2] text-[var(--accent-lime)]">
            {loading ? <span className="text-[var(--text-muted)]">Loading...</span> : amount || '0.000000'}
          </div>
        ) : (
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.000000"
            value={amount}
            onChange={(e) => onAmountChange?.(e.target.value)}
            className="bg-transparent text-[36px] lg:text-[42px] font-normal leading-[1.2] w-full outline-none placeholder-white/20"
          />
        )}
        <button type="button" onClick={onTokenSelect} className="flex items-center gap-2 flex-shrink-0">
          {token && <span className="text-2xl w-8 h-8 flex items-center justify-center">{token.icon}</span>}
          <span className="text-base font-normal whitespace-nowrap">{token?.symbol || 'Select'}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
