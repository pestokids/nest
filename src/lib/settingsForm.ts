// The Settings form's rules: the shared round rules (also enforced by Convex),
// plus what only makes sense while editing, in the design's words.
import { dayDiff, isISODate } from './dates'
import { money } from './money'
import { parseMoney } from './csv'
import { validateRound, type Round, type RoundErrors } from './round'

/**
 * Errors keyed by field path (`target`, `stretch`, `deadline`, `phases.2.to`…).
 * `saved` is the round as stored: a close date already in the past isn't
 * flagged until someone changes it.
 */
export function validateRoundForm(draft: Round, today: string, saved?: Pick<Round, 'deadline'>): RoundErrors {
  const e = validateRound(draft)
  const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  if (num(draft.target) && draft.target > 0 && num(draft.stretch) && draft.stretch < draft.target) e.stretch = `Can’t be below the target of ${money(draft.target)}.`
  if (!num(draft.stretch) || draft.stretch <= 0) e.stretch = 'Enter the most you’d take.'
  if (!num(draft.target) || draft.target <= 0) e.target = 'Enter what you need to close.'
  if (isISODate(draft.deadline) && draft.deadline <= today && draft.deadline !== saved?.deadline) e.deadline = 'Pick a date after today.'
  return e
}

/** How many things are wrong, for "2 things to fix before saving". */
export const errorCount = (e: RoundErrors) => Object.keys(e).length

export const fixLine = (n: number) => (n === 1 ? '1 thing to fix before saving' : `${n} things to fix before saving`)

/** "$2,000,000", "2m", "$10M post", "250k" → dollars; undefined when empty; NaN when unreadable. */
export function parseAmount(s: string): number | undefined {
  const t = s.toLowerCase().replace(/\b(post|pre)(-money)?\b/g, '').replace(/[$,\s]/g, '')
  if (!t) return undefined
  const n = parseMoney(t)
  return n === null ? NaN : n
}

/** 2000000 → "$2,000,000". */
export const formatAmount = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '' : '$' + Math.round(n).toLocaleString('en-US'))

/** "28 days from today." under Close by. */
export function closeHint(deadline: string, today: string): string {
  if (!isISODate(deadline)) return 'The day the round closes.'
  const d = dayDiff(deadline, today)
  if (d === 0) return 'Today.'
  if (d === 1) return 'Tomorrow.'
  if (d > 1) return `${d} days from today.`
  return d === -1 ? 'Yesterday.' : `${-d} days ago.`
}
