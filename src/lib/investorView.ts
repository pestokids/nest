// How an investor reads in lists: quiet or not, "2 days ago", "Send deck · Thu 12".
import { dayDiff, isISODate } from './dates'
import { quietFor, type Investor } from './pipeline'

/** Today's "Gone quiet" rule (`quietFor` in pipeline.ts). */
export const isQuiet = (i: Pick<Investor, 'stage' | 'lastTouch' | 'contact'>, today: string, quietDays: number) => quietFor(i, today, quietDays) !== null

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const weekday = (iso: string) => WEEKDAYS[new Date(iso + 'T00:00:00Z').getUTCDay()]

/** "Thu 12" within a week either side, else "Nov 12". */
export function dayLabel(iso: string, today: string): string {
  if (!isISODate(iso)) return ''
  const [, m, d] = iso.split('-').map(Number)
  return Math.abs(dayDiff(iso, today)) <= 6 ? `${weekday(iso)} ${d}` : `${MONTHS[m - 1]} ${d}`
}

/** "Fri 4 Dec" (Plan and Settings). */
export function longDay(iso: string): string {
  if (!isISODate(iso)) return '–'
  const [, m, d] = iso.split('-').map(Number)
  return `${weekday(iso)} ${d} ${MONTHS[m - 1]}`
}

/** "today", "yesterday", "2 days ago", "–". */
export function agoLabel(iso: string | undefined, today: string): string {
  if (!iso || !isISODate(iso)) return '–'
  const n = dayDiff(today, iso)
  if (n <= 0) return n === 0 ? 'today' : 'upcoming'
  return n === 1 ? 'yesterday' : `${n} days ago`
}

/** "Send deck · Thu 12". */
export function nextLabel(i: Pick<Investor, 'nextStep' | 'nextDate'>, today: string): string {
  const d = i.nextDate ? dayLabel(i.nextDate, today) : ''
  return [i.nextStep, d].filter(Boolean).join(' · ') || '–'
}

/** "Angel · Orchard" under the name (the firm only when it isn't the name). */
export function subLine(i: Pick<Investor, 'type' | 'firm' | 'name'>): string {
  const firm = i.firm && i.firm.trim().toLowerCase() !== i.name.trim().toLowerCase() ? i.firm.trim() : ''
  return [i.type, firm].filter(Boolean).join(' · ')
}
