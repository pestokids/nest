// PST-296: the fit score. Jev answers four Score questions about one investor
// against Pesto's round (stage fit, check-size fit, thesis fit, recent activity),
// and Nest weighs them into a score out of 100. Find more scores its candidates
// with it, and Investors › Sort: Priority uses the same score for investors already
// in Nest in place of the light Fit (src/lib/priority.ts). Jev reads facts only:
// the round's stage, size and check sizes, and the one investor's own facts, never
// another investor's name. Pure; shared by Convex and the app.
import { latestKept, type Fact } from './enrich'
import { JEV_MODEL, jevHash, score, type Answers } from './jev'
import type { Round } from './round'

/** How much each answer counts (they add up to 1). */
export const FIT_WEIGHTS = { stage: 0.3, check: 0.25, thesis: 0.3, activity: 0.15 } as const
export type FitPart = keyof typeof FIT_WEIGHTS
export const FIT_PARTS = Object.keys(FIT_WEIGHTS) as FitPart[]

/** Pesto raises pre-seed (the Raise header says so too); the rest comes from the round settings. */
export const ROUND_STAGE = 'Pre-seed'
/** What the round looks for beyond the settings (FIT_FOCUS in enrich.ts, in words). */
export const ROUND_FOCUS = ['kids', 'families and parents', 'learning and edtech', 'consumer']

/** The round as Jev reads it. Checks run from the minimum check to a quarter of the target, as the light Fit has it. */
export type RoundFacts = { stage: string; instrument: string; round_size_usd: number; check_min_usd: number | null; check_max_usd: number; focus: string[] }
export function roundFacts(r: Pick<Round, 'target' | 'minCheck' | 'instrument'>): RoundFacts {
  return { stage: ROUND_STAGE, instrument: r.instrument, round_size_usd: r.target, check_min_usd: r.minCheck ?? null, check_max_usd: Math.round(r.target * 0.25), focus: ROUND_FOCUS }
}

/** One investor's facts, from enrichment (kept fund facts) or Find more's search. Absent means unknown. */
export type InvestorFacts = {
  name: string
  type?: string
  stage?: string
  check?: string
  check_usd?: number
  leads?: string
  geography?: string
  thesis?: string
  recent_deals?: string
  deals_last_12_months?: number
  last_deal?: string
}
export type FitState = { round: RoundFacts; investor: InvestorFacts }

export const fitQuestions = () => ({
  stage: score('How well does the stage the investor in `investor` invests at match the round stage in `round.stage`?', [
    'Never invests at this stage',
    'Sometimes invests at this stage',
    'Mostly invests at this stage',
  ]),
  check: score('How well does the investor’s typical check size fit between `round.check_min_usd` and `round.check_max_usd` (US dollars)?', [
    'Far outside the range',
    'Near the edge of the range',
    'Inside the range',
  ]),
  thesis: score('How closely do the investor’s thesis and recent deals match the companies in `round.focus`?', [
    'Unrelated',
    'Loosely related',
    'Related',
    'A close match',
  ]),
  activity: score('How actively has the investor been investing over the last 12 months?', [
    'No deals in the last 12 months',
    'One or two deals',
    'Three to five deals',
    'Six or more deals',
  ]),
})
export type FitQuestions = ReturnType<typeof fitQuestions>
export type FitAnswers = Answers<FitQuestions>

export type JevFit = { score: number; parts: Record<FitPart, number> }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Each answer as 0 to 1 (its position over the top level), weighted into a score out of 100. */
export function fitScore(a: FitAnswers): JevFit {
  const q = fitQuestions()
  const parts = Object.fromEntries(FIT_PARTS.map((k) => [k, clamp01(a[k].score / (q[k].criteria.length - 1))])) as Record<FitPart, number>
  const total = FIT_PARTS.reduce((s, k) => s + FIT_WEIGHTS[k] * parts[k], 0)
  return { score: Math.round(100 * total), parts }
}

/** What Jev reads about an investor already in Nest: their latest kept fund facts. Null when none of them is kept yet. */
export function investorFacts(name: string, type: string, facts: readonly Fact[]): InvestorFacts | null {
  const get = (field: string) => latestKept(facts, field)?.value
  const check = latestKept(facts, 'check')
  const known: Omit<InvestorFacts, 'name' | 'type'> = {
    ...(get('stage') ? { stage: get('stage') } : {}),
    ...(check ? { check: check.value, ...(check.amount ? { check_usd: check.amount } : {}) } : {}),
    ...(get('leads') ? { leads: get('leads') } : {}),
    ...(get('geography') ? { geography: get('geography') } : {}),
    ...(get('thesis') ? { thesis: get('thesis') } : {}),
    ...(get('recentDeals') ? { recent_deals: get('recentDeals') } : {}),
  }
  return Object.keys(known).length ? { name, type: get('type') ?? type, ...known } : null
}

/**
 * The hash a Priority score is kept under: the facts Jev would read, with the
 * questions and the model. The same hash means the same answer, so Nest doesn't ask again.
 */
export const factsHash = (state: FitState) => jevHash(JEV_MODEL, state, fitQuestions())

/** Recompute only when the facts changed: no score yet, or one kept under another hash. */
export const needsRescore = (stored: { hash: string } | null | undefined, hash: string) => !stored || stored.hash !== hash
