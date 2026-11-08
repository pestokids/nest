/**
 * Compact dollars, the one way Nest shows an amount: $40, $150K, $1.2M, $10M.
 * Millions keep at most one decimal and never a trailing zero; a figure that
 * rounds to 1,000K reads as $1M. Empty is $0; negatives read -$50K.
 */
export function money(n: unknown): string {
  const x = Number(n) || 0
  if (x < 0) return '-' + money(-x)
  if (Math.round(x) < 1e3) return '$' + Math.round(x)
  const k = Math.round(x / 1e3)
  if (k < 1e3) return '$' + k + 'K'
  return '$' + Math.round(x / 1e5) / 10 + 'M'
}

/**
 * Dollars to the dollar, "$150,000", for amounts that must read exactly: form
 * fields you edit and the words that go to investors. `cents` gives "$0.12"
 * for AI spend. Empty when there's no number.
 */
export function exactMoney(n: number | null | undefined, cents = false): string {
  if (n == null || !Number.isFinite(n)) return ''
  const digits = cents ? 2 : 0
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
