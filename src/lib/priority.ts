// PST-284: Investors › Sort: Priority. One score out of 100 per investor from
// four things Nest already knows: the Fit score (enrich.ts, from kept fund
// facts), warmth (the path), check size (Expected against the round's average
// Expected) and recent activity (the latest touch, email or meeting). Each is a
// factor from 0 to 1 and the score is their weighted product, so a weak factor
// pulls the score down without zeroing it. Pure; shared by Investors and the
// MCP read tools.
import { dayDiff } from './dates'
import { fit as fitOf, type Fact, type Fit } from './enrich'
import { isColdPath } from './insights'
import { money } from './money'
import { lastContact, type Investor } from './pipeline'
import type { Round } from './round'
import { DONE } from './stages'

export const PRIORITY_FORMULA = 'Priority = fit × warmth × check size × recent activity'
/** How much each factor counts (the exponents of the product; they add up to 1). */
export const PRIORITY_WEIGHTS = { fit: 0.35, warmth: 0.3, check: 0.2, activity: 0.15 } as const

type PInv = Pick<Investor, 'stage' | 'warmth' | 'path' | 'expected' | 'lastTouch' | 'contact'>
export type PriorityChip = { label: string; tone: 'why' | 'cold' | 'conflict' }
export type Priority = { score: number; chips: PriorityChip[] }
export type PriorityFactors = Record<keyof typeof PRIORITY_WEIGHTS, number>

/** A Fit reason that flags a conflict (a competitor in their portfolio). */
export const isConflict = (reason: string) => /conflict/i.test(reason)

/** The round's average check: the mean Expected across investors that have one. */
export function averageCheck(inv: readonly Pick<Investor, 'expected'>[]): number | null {
  const xs = inv.map((i) => +(i.expected || 0)).filter((x) => x > 0)
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

/** Each factor, 0 to 1. Unknowns (no Fit yet, no Expected) sit in the middle rather than at the bottom. */
export function priorityFactors(i: PInv, fit: Fit | null | undefined, avgCheck: number | null, today: string): PriorityFactors {
  const warmth = isColdPath(i) ? 0.3 : i.warmth === 'existing' ? 1 : i.warmth === 'warm' ? 0.9 : 0.6
  const exp = +(i.expected || 0)
  const check = exp > 0 && avgCheck ? 0.4 + 0.6 * (Math.min(exp / avgCheck, 2) / 2) : 0.5
  const last = lastContact(i)
  const quiet = last ? dayDiff(today, last) : null
  const activity = DONE.has(i.stage) ? 0.1 : quiet === null ? (i.stage === 'todo' ? 0.55 : 0.4) : quiet <= 3 ? 1 : quiet <= 7 ? 0.85 : quiet <= 14 ? 0.65 : 0.45
  return { fit: fit ? Math.max(0.05, fit.score / 100) : 0.55, warmth, check, activity }
}

/** The score and 2–3 chips saying why (plus a conflict chip when the Fit reasons flag one). */
export function priority(i: PInv, fit: Fit | null | undefined, avgCheck: number | null, today: string): Priority {
  const f = priorityFactors(i, fit, avgCheck, today)
  const score = Math.round(100 * (Object.keys(PRIORITY_WEIGHTS) as (keyof PriorityFactors)[]).reduce((p, k) => p * Math.pow(f[k], PRIORITY_WEIGHTS[k]), 1))
  const reasons = fit?.reasons ?? []
  const chips: PriorityChip[] = reasons.filter((r) => !isConflict(r)).slice(0, 2).map((label) => ({ label, tone: 'why' }))
  if (isColdPath(i)) chips.push({ label: 'Cold', tone: 'cold' })
  else if (i.warmth === 'existing') chips.push({ label: 'Existing investor', tone: 'why' })
  else if (i.warmth === 'warm') chips.push({ label: 'Warm', tone: 'why' })
  const exp = +(i.expected || 0)
  if (avgCheck && exp >= 1.5 * avgCheck && !reasons.some((r) => r.startsWith('Checks'))) chips.push({ label: `${money(exp)} check`, tone: 'why' })
  if (f.activity === 1) chips.push({ label: 'Active this week', tone: 'why' })
  const why = chips.slice(0, 3)
  if (reasons.some(isConflict)) why.push({ label: 'Possible conflict', tone: 'conflict' })
  return { score: Math.min(100, Math.max(0, score)), chips: why }
}

/** Score bands for the pill: dark from 80, green from 55, grey below. */
export const scoreBand = (score: number): 'high' | 'mid' | 'low' => (score >= 80 ? 'high' : score >= 55 ? 'mid' : 'low')

/** PST-296: an investor's Jev fit score (src/lib/fitScore.ts) stands in for the light Fit's score; the Fit's reasons still make the chips. */
export function withJev(fit: Fit | undefined, jev: number | undefined): Fit | undefined {
  if (jev === undefined) return fit
  return { score: jev, headline: fit?.headline ?? '', reasons: fit?.reasons ?? [] }
}

/** Every investor's priority, against the round's average check. PST-296: `jev` holds the Jev fit scores by id (without one, the light Fit as before). */
export function priorities<T extends PInv & { _id: string }>(inv: readonly T[], fits: Readonly<Record<string, Fit>>, today: string, jev: Readonly<Record<string, number>> = {}): Map<string, Priority> {
  const avg = averageCheck(inv)
  return new Map(inv.map((i) => [i._id, priority(i, withJev(fits[i._id], jev[i._id]), avg, today)]))
}

/** Each investor's Fit from their kept fund facts (investors with too little known have none). */
export function fitsByInvestor(facts: readonly Fact[], round: Pick<Round, 'minCheck' | 'target'>): Record<string, Fit> {
  const by = new Map<string, Fact[]>()
  for (const f of facts) if (f.investorId && f.status === 'kept') by.set(f.investorId, [...(by.get(f.investorId) ?? []), f])
  const out: Record<string, Fit> = {}
  for (const [id, xs] of by) {
    const f = fitOf(xs, round)
    if (f) out[id] = f
  }
  return out
}
