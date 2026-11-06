/**
 * Compact dollars, as in the prototype: $1M, $1.5M, $150K, $40.
 * One fix over the prototype: it stripped trailing zeros from whole millions
 * too, so $10M showed as "$1M". Only decimals are trimmed here.
 */
export function money(n: unknown): string {
  const x = Number(n) || 0
  if (x >= 1e6) {
    const s = (x / 1e6).toFixed(x % 1e6 === 0 ? 0 : 2)
    return '$' + (s.includes('.') ? s.replace(/\.?0+$/, '') : s) + 'M'
  }
  if (x >= 1e3) return '$' + Math.round(x / 1e3) + 'K'
  return '$' + Math.round(x)
}
