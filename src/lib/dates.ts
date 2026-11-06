// Dates are plain `YYYY-MM-DD` strings. "Today" is the calendar date in
// Asia/Kolkata (UTC+5:30, no DST), shared by the client and Convex.
const IST_OFFSET_MS = 330 * 60 * 1000

export const pad = (n: number) => String(n).padStart(2, '0')

export function todayIST(now: number = Date.now()): string {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10)
}

export const isISODate = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))

/** Whole days from b to a (a - b). */
export const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Nov 6"; "–" when empty. */
export function shortDate(s: string | null | undefined): string {
  if (!s || !isISODate(s)) return '–'
  const [, m, d] = s.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}`
}
