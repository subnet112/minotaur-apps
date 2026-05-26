import { ArrowDownUp } from 'lucide-react'
import { useSwapStore } from '../swap.store'
import { formatAmount } from '../swap.utils'
import { TokenInput } from './TokenInput'

export function SwapForm() {
  const store = useSwapStore()

  return (
    <>
      {/* Input Token */}
      <TokenInput
        label="FROM"
        amount={store.inputAmount}
        onAmountChange={store.setInputAmount}
        token={store.inputToken}
        onTokenSelect={() => store.setTokenSelectorOpen('input')}
        balance={store.inputBalance}
        decimals={store.inputToken?.decimals}
        onMaxClick={() => {
          if (store.inputBalance && store.inputToken) {
            store.setInputAmount(formatAmount(store.inputBalance, store.inputToken.decimals, store.inputToken.decimals))
          }
        }}
      />

      {/* Swap Direction Button */}
      <div className="flex justify-center -my-2 relative z-10">
        <button type="button" onClick={store.swapTokens} className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors duration-200 bg-[var(--bg-card)]">
          <ArrowDownUp className="h-4 w-4" />
        </button>
      </div>

      {/* Output Token */}
      <TokenInput
        label="TO"
        amount={store.quote ? formatAmount(store.quote.estimated_output, store.outputToken?.decimals || 18) : ''}
        token={store.outputToken}
        onTokenSelect={() => store.setTokenSelectorOpen('output')}
        balance={store.outputBalance}
        decimals={store.outputToken?.decimals}
        readOnly
        loading={store.loading}
      />
    </>
  )
}
