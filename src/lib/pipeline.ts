// Pipeline maths, ported from the prototype. Pure functions over plain data,
// shared by the UI and Convex.
import { dayDiff, isISODate } from './dates'
import { currentPhase, targetValue, type Metric, type Phase, type Round } from './round'
import {
  ACTIVE, COMMIT, DONE, IDX, STAGES, TYPES,
  type Geo, type InvestorType, type PipelineStage, type Stage, type Tier, type TouchKind, type Warmth, type Wave,
} from './stages'

/** Editable investor fields (the drawer form and CSV import). */
export type InvestorFields = {
  name: string
  firm: string
  type: InvestorType
  geo: Geo
  warmth: Warmth
  path: string
  tier: Tier
  wave: Wave
  stage: Stage
  lead: boolean
  expected?: number
  committed?: number
  nextStep: string
  nextDate?: string
  lastTouch?: string
  notes: string
  source: string
  email?: string
  /** Set only while parked: the day they come back to Due today. */
  parkedUntil?: string
  /** PST-263: more addresses for this investor, and their firm's domains (Calendar and Gmail matching). */
  emails?: string[]
  domains?: string[]
}

/** PST-263, derived (never saved): the IST day of the latest email touch and of the latest past meeting. */
export type Contact = { email?: string; meeting?: string }

export type Investor = InvestorFields & { _id: string; maxStage: PipelineStage; slug?: string; updatedAt?: number; _creationTime?: number; contact?: Contact }

export type Activity = {
  _id: string
  investorId: string
  kind: 'stage' | 'note'
  stage?: Stage
  note?: string
  touch?: TouchKind
  /** PST-263: written by Calendar or Gmail sync rather than by hand. */
  source?: 'calendar' | 'gmail'
  date: string
  by?: string
  _creationTime?: number
}

/** Options for logging a touch: its kind, the day it happened, and optionally a new next step. */
export type TouchOptions = { touch?: TouchKind; date?: string; next?: { step: string; date?: string } }

/** Defaults for a new investor, as in the prototype's drawer. */
export const NEW_INVESTOR: InvestorFields = {
  name: '', firm: '', type: 'Angel', geo: 'India', warmth: 'intro', path: '', tier: 'B', wave: 2, stage: 'todo',
  lead: false, nextStep: '', notes: '', source: '',
}

/** Just the editable fields of a stored investor (drops ids and bookkeeping). */
export const fieldsOf = (i: InvestorFields): InvestorFields => ({
  name: i.name, firm: i.firm, type: i.type, geo: i.geo, warmth: i.warmth, path: i.path, tier: i.tier, wave: i.wave, stage: i.stage,
  lead: i.lead, expected: i.expected, committed: i.committed, nextStep: i.nextStep, nextDate: i.nextDate, lastTouch: i.lastTouch,
  notes: i.notes, source: i.source, email: i.email, parkedUntil: i.parkedUntil, emails: i.emails, domains: i.domains,
})

type Inv = Pick<InvestorFields, 'stage' | 'expected' | 'committed'> & { maxStage?: string }

export const committedOf = (i: Inv) => (COMMIT.has(i.stage) ? +(i.committed || i.expected || 0) : 0)

export const weightedOf = (i: Inv, odds: Round['odds']) =>
  COMMIT.has(i.stage) ? 0 : (+(i.expected || 0)) * (odds[i.stage as PipelineStage] ?? 0)

export function score(i: Pick<InvestorFields, 'warmth' | 'tier' | 'expected' | 'lead'>): number {
  const w = ({ existing: 40, warm: 30, intro: 20, cold: 5 } as Record<string, number>)[i.warmth] || 10
  const t = ({ A: 30, B: 20, C: 10 } as Record<string, number>)[i.tier] || 10
  const c = +(i.expected || 0) >= 250000 ? 15 : +(i.expected || 0) >= 100000 ? 10 : 5
  return Math.min(100, w + t + c + (i.lead ? 15 : 0))
}

export const maxIdx = (i: Inv) => Math.max(IDX[i.maxStage as Stage] ?? -1, IDX[i.stage] ?? -1)

export const isLate = (i: Pick<InvestorFields, 'nextDate' | 'stage'>, today: string) =>
  !!i.nextDate && i.nextDate < today && !DONE.has(i.stage)

/** Header, progress bar and KPI figures, all derived from the round row. */
export function totals(inv: Inv[], round: Round, today: string) {
  const committed = inv.reduce((a, i) => a + committedOf(i), 0)
  const weighted = inv.reduce((a, i) => a + weightedOf(i, round.odds), 0)
  const scale = Math.max(round.stretch, committed + weighted)
  const daysLeft = dayDiff(round.deadline, today)
  const need = Math.max(0, round.target - committed)
  return {
    committed,
    weighted,
    scale,
    committedPct: Math.min(100, (committed / scale) * 100),
    weightedPct: Math.min(100, ((committed + weighted) / scale) * 100),
    targetPct: (round.target / scale) * 100,
    daysLeft,
    need,
    perDay: need / Math.max(1, daysLeft),
    pctOfTarget: Math.round((committed / round.target) * 100),
  }
}

/** The day an investor is due on Today: their next-step date, or for a parked one the day they come back. */
export const dueDate = (i: Pick<InvestorFields, 'stage' | 'nextDate' | 'parkedUntil'>) =>
  i.stage === 'parked' ? i.parkedUntil : DONE.has(i.stage) ? undefined : i.nextDate

/**
 * Due today: a live next step dated today or earlier, or a parked investor whose
 * "park until" day has come. Passed and money-in never show. Oldest first.
 */
export const dueList = <T extends Investor>(inv: T[], today: string) =>
  inv
    .filter((i) => {
      const d = dueDate(i)
      return !!d && d <= today
    })
    .sort((a, b) => dueDate(a)!.localeCompare(dueDate(b)!) || a.name.localeCompare(b.name))

/**
 * The day of the last contact: the latest of Last touch, the latest email touch
 * and the latest past meeting (the last two come from Calendar and Gmail).
 */
export function lastContact(i: Pick<Investor, 'lastTouch' | 'contact'>): string | undefined {
  let d = i.lastTouch
  for (const x of [i.contact?.email, i.contact?.meeting]) if (x && (!d || x > d)) d = x
  return d
}

/**
 * The "Gone quiet" rule, used by Today, Pipeline, Investors, the palette and the
 * drawer: a live, uncommitted conversation with no contact (see `lastContact`)
 * in `quietDays`+ days. Returns how many days quiet (Infinity when never
 * touched), or null when it isn't quiet.
 */
export function quietFor(i: Pick<Investor, 'stage' | 'lastTouch' | 'contact'>, today: string, quietDays: number): number | null {
  if (!ACTIVE.has(i.stage) || COMMIT.has(i.stage)) return null
  const last = lastContact(i)
  if (!last) return Infinity
  const d = dayDiff(today, last)
  return d >= quietDays ? d : null
}

/** Live, uncommitted conversations with no contact in `quietDays`+ days, longest quiet first. */
export const quietList = <T extends Investor>(inv: T[], today: string, quietDays: number) =>
  inv
    .filter((i) => quietFor(i, today, quietDays) !== null)
    .sort((a, b) => (lastContact(a) || '').localeCompare(lastContact(b) || ''))

/** Top 10 not contacted / intro asked, by score then wave. */
export const nextList = <T extends Investor>(inv: T[]) =>
  inv
    .filter((i) => i.stage === 'todo' || i.stage === 'ask')
    .sort((a, b) => score(b) - score(a) || (a.wave || 9) - (b.wave || 9))
    .slice(0, 10)

/** "Reached stage" counts from maxStage, with conversion from the previous stage. */
export function funnel(inv: Inv[]) {
  const reached = STAGES.map((_, ix) => inv.filter((i) => maxIdx(i) >= ix).length)
  const max = Math.max(1, reached[0])
  return STAGES.map((st, ix) => ({
    k: st.k,
    l: st.l,
    n: reached[ix],
    pct: (reached[ix] / max) * 100,
    conv: ix > 0 && reached[ix - 1] ? Math.round((reached[ix] / reached[ix - 1]) * 100) : null,
  }))
}

/** Stage moves into `stage` logged within the phase's dates. */
export const stageMovesIn = (acts: Pick<Activity, 'kind' | 'stage' | 'date'>[], stage: string, p: Pick<Phase, 'from' | 'to'>) =>
  acts.filter((a) => a.kind === 'stage' && a.stage === stage && a.date >= p.from && a.date <= p.to).length

export function phaseActual(p: Phase, m: Metric, inv: (Inv & { path?: string })[], acts: Pick<Activity, 'kind' | 'stage' | 'date'>[], committed: number) {
  if (m === 'count') return inv.length
  if (m === 'pathed') return inv.filter((i) => i.path && i.path.toLowerCase() !== 'cold').length
  if (m === 'committed') return committed
  if (m === 'signed') return inv.filter((i) => i.stage === 'signed' || i.stage === 'wired').reduce((a, i) => a + committedOf(i), 0)
  return stageMovesIn(acts, m.split(':')[1], p)
}

/** The "1st meetings · <phase>" KPI. */
export function meetingsKpi(round: Round, acts: Pick<Activity, 'kind' | 'stage' | 'date'>[], today: string) {
  const ph = currentPhase(round, today)
  if (!ph) return null
  const m1 = stageMovesIn(acts, 'm1', ph)
  const tgt = ph.targets.find((x) => x.m === 'stage:m1')
  return { phase: ph, m1, target: tgt ? targetValue(round, tgt) : undefined }
}

export function warmPaths(inv: (Inv & { path: string })[]) {
  const by = new Map<string, { n: number; asked: number; met: number; c: number }>()
  for (const i of inv) {
    const k = (i.path || '(none)').trim()
    const o = by.get(k) || { n: 0, asked: 0, met: 0, c: 0 }
    o.n++
    if (maxIdx(i) >= IDX.ask!) o.asked++
    if (maxIdx(i) >= IDX.m1!) o.met++
    o.c += committedOf(i)
    by.set(k, o)
  }
  return [...by].sort((a, b) => b[1].n - a[1].n)
}

export const mixByType = (inv: (Inv & { type: string })[]) =>
  TYPES.map((ty) => {
    const xs = inv.filter((i) => i.type === ty)
    return { type: ty, n: xs.length, talking: xs.filter((i) => ACTIVE.has(i.stage)).length, c: xs.reduce((a, i) => a + committedOf(i), 0) }
  }).filter((r) => r.n > 0)

/**
 * The write rule for saving an investor (prototype `save()`): on a stage change
 * (other than to "Not contacted") set lastTouch to today and log a stage
 * activity; raise maxStage when the new stage is further along.
 */
export function applySave(prev: (Inv & { maxStage: PipelineStage }) | null, body: InvestorFields, today: string) {
  const stageChanged = !prev || prev.stage !== body.stage
  const logStage = stageChanged && body.stage !== 'todo'
  const lastTouch = logStage ? today : body.lastTouch
  const prevMax = prev ? maxIdx(prev) : -1
  let maxStage: PipelineStage
  if ((IDX[body.stage] ?? -1) > prevMax) maxStage = body.stage as PipelineStage
  else maxStage = prev?.maxStage ?? ((IDX[body.stage] !== undefined ? body.stage : 'todo') as PipelineStage)
  return { lastTouch, maxStage, logStage: logStage ? body.stage : null }
}

/** One stage forward (prototype `advance()`); null at "Money in" or a closed stage. */
export function applyAdvance(i: Inv, today: string) {
  const ix = IDX[i.stage]
  if (ix === undefined || ix >= STAGES.length - 1) return null
  const next = STAGES[ix + 1].k
  return { stage: next as PipelineStage, lastTouch: today, raiseMax: ix + 1 > maxIdx(i) }
}

/** The day a touch is logged on: the picked day, never in the future; today when missing or invalid. */
export const touchDay = (date: string | undefined, today: string) => (date && isISODate(date) && date <= today ? date : today)
