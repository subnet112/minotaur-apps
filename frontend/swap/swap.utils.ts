export function parseAmount(amount: string, decimals: number): string {
  if (!amount || isNaN(Number(amount))) return '0'
  const [whole, frac = ''] = amount.split('.')
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals)
  return (whole + paddedFrac).replace(/^0+/, '') || '0'
}

export function formatAmount(amountWei: string | null | undefined, decimals: number, maxDecimals = 6): string {
  if (!amountWei) return '0'
  const str = amountWei.toString().padStart(decimals + 1, '0')
  const whole = str.slice(0, -decimals) || '0'
  const frac = str.slice(-decimals)
  const trimmedFrac = frac.replace(/0+$/, '').slice(0, maxDecimals)
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole
}

export function shorten(addr: string | null | undefined, chars = 4): string {
  if (!addr) return ''
  return addr.slice(0, chars + 2) + '...' + addr.slice(-chars)
}

export function calculateRate(
  inputAmount: string,
  outputAmount: string,
  inputDecimals: number,
  outputDecimals: number,
): number | null {
  if (!inputAmount || !outputAmount || inputAmount === '0') return null
  try {
    const input = parseFloat(formatAmount(inputAmount, inputDecimals, 18))
    const output = parseFloat(formatAmount(outputAmount, outputDecimals, 18))
    if (input === 0) return null
    return output / input
  } catch {
    return null
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
