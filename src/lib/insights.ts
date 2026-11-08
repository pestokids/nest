// PST-284: Plan › Insights. What the round's own history says: when it reaches
// its target at this week's pace, where the funnel leaks, warm paths against
// cold ones, and how long conversations sit in each stage. Pure functions over
// the investors, their stage moves and the round; no AI and nothing made up.
import { dayDiff, isISODate } from './dates'
import { longDay } from './investorView'
import { money } from './money'
import { committedOf, maxIdx, withoutCorrections, type Activity, type Investor } from './pipeline'
import { isAwaiting, type ApplicationFields } from './applications' // PST-302
import type { Round } from './round'
import { COMMIT, IDX, STAGE_SHORT, type PipelineStage, type Stage } from './stages'
import { addDays } from './today'

type Inv = Pick<Investor, '_id' | 'name' | 'stage' | 'maxStage' | 'warmth' | 'path' | 'expected' | 'committed'> & ApplicationFields
type Act = Pick<Activity, 'investorId' | 'kind' | 'stage' | 'date'> & Partial<Pick<Activity, 'correction'>> & { _creationTime?: number }
type Move = { stage: Stage; date: string }

/** Each investor's stage moves, oldest first. PST-302: corrections, and the moves they took back, are left out. */
export function stageHistory(acts: readonly Act[]): Map<string, Move[]> {
  const by = new Map<string, Move[]>()
  const moves = withoutCorrections(acts)
    .filter((a) => a.kind === 'stage' && a.stage)
    .sort((a, b) => a.date.localeCompare(b.date) || (a._creationTime ?? 0) - (b._creationTime ?? 0))
  for (const a of moves) {
    const xs = by.get(a.investorId) ?? []
    xs.push({ stage: a.stage!, date: a.date })
    by.set(a.investorId, xs)
  }
  return by
}

/** The furthest pipeline stage an investor ever reached: their current and furthest stage, or any stage in their history. */
export function reachedIdx(i: Pick<Investor, 'stage' | 'maxStage'>, history: readonly Move[] = []): number {
  return history.reduce((ix, m) => Math.max(ix, IDX[m.stage] ?? -1), maxIdx(i))
}

/** A cold path with no introducer (an "applied" warm path included), as opposed to a warm intro. */
export const isColdPath = (i: Pick<Investor, 'warmth' | 'path'>) => i.warmth === 'cold' || /\b(cold|appl(y|ied|ication))\b/i.test(i.path ?? '')

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const inWeek = (d: string, today: string) => d <= today && dayDiff(today, d) < 7

/* ---------- where the funnel leaks ---------- */

export const FUNNEL_PAIRS = [
  { from: 'ask', to: 'intro', label: 'Asked → Intro', noun: ['ask', 'asks'], next: 'an intro' },
  { from: 'intro', to: 'booked', label: 'Intro → Booked', noun: ['intro', 'intros'], next: 'a booked call' },
  { from: 'booked', to: 'm1', label: 'Booked → 1st meeting', noun: ['booked call', 'booked calls'], next: 'a first meeting' },
  { from: 'm1', to: 'm2', label: '1st → 2nd meeting', noun: ['first meeting', 'first meetings'], next: 'a second' },
  { from: 'm2', to: 'dd', label: '2nd → Diligence', noun: ['second meeting', 'second meetings'], next: 'diligence' },
  { from: 'dd', to: 'verbal', label: 'Diligence → Verbal', noun: ['conversation in diligence', 'conversations in diligence'], next: 'a verbal yes' },
] as const satisfies readonly { from: PipelineStage; to: PipelineStage; label: string; noun: readonly [string, string]; next: string }[]

export type FunnelStep = (typeof FUNNEL_PAIRS)[number] & {
  /** Investors who ever reached `from`. */
  reached: number
  /** Of those, how many ever reached `to`. */
  moved: number
  /** moved / reached; null when nobody reached `from`. */
  share: number | null
}

/** A stage needs this many investors through it before it can be called the leak. */
export const LEAK_MIN = 3
/** A step that keeps at least this share isn't a leak. */
export const LEAK_BELOW = 0.75

/** For each stage pair, the share of investors who reached the next stage (from their history, not just where they are now), and the worst one. */
export function funnelLeaks(inv: readonly Inv[], acts: readonly Act[]): { steps: FunnelStep[]; leak: FunnelStep | null } {
  const h = stageHistory(acts)
  const reached = inv.map((i) => reachedIdx(i, h.get(i._id)))
  const steps = FUNNEL_PAIRS.map((p) => {
    const from = reached.filter((x) => x >= IDX[p.from]!).length
    const moved = reached.filter((x) => x >= IDX[p.to]!).length
    return { ...p, reached: from, moved, share: from ? moved / from : null }
  })
  const leak = steps.filter((s) => s.reached >= LEAK_MIN && s.share! < LEAK_BELOW).sort((a, b) => a.share! - b.share! || b.reached - a.reached)[0] ?? null
  return { steps, leak }
}

/** "Biggest leak: only 3 of 9 first meetings led to a second." */
export function leakLine(s: FunnelStep): string {
  const noun = s.reached === 1 ? s.noun[0] : s.noun[1]
  return s.moved ? `Biggest leak: only ${s.moved} of ${s.reached} ${noun} led to ${s.next}.` : `Biggest leak: none of the ${s.reached} ${noun} led to ${s.next} yet.`
}

/** Investors who reached the step's first stage and never the next. PST-302: not while an application awaits their decision. */
export function stalledAt(s: Pick<FunnelStep, 'from' | 'to'>, inv: readonly Inv[], acts: readonly Act[]): string[] {
  const h = stageHistory(acts)
  return inv
    .filter((i) => {
      if (isAwaiting(i.application)) return false
      const r = reachedIdx(i, h.get(i._id))
      return r >= IDX[s.from]! && r < IDX[s.to]!
    })
    .map((i) => i._id)
}

export type LeakQuestions = { theme: string; askers: number; stalled: number }

/**
 * What the investors who stalled at the leak asked, from the Q&A bank: the theme
 * most of them asked about, when at least two did. Null otherwise, so the card
 * never points at the bank without real asks behind it.
 */
export function leakQuestions(
  s: Pick<FunnelStep, 'from' | 'to'>,
  inv: readonly Inv[],
  acts: readonly Act[],
  questions: readonly { theme: string; asks: readonly { investorId: string }[] }[],
): LeakQuestions | null {
  const stalled = new Set(stalledAt(s, inv, acts))
  if (!stalled.size) return null
  const by = new Map<string, Set<string>>()
  for (const q of questions) {
    const theme = q.theme.trim()
    if (!theme) continue
    for (const a of q.asks) if (stalled.has(a.investorId)) by.set(theme, (by.get(theme) ?? new Set()).add(a.investorId))
  }
  const best = [...by].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0]
  return best && best[1].size >= 2 ? { theme: best[0], askers: best[1].size, stalled: stalled.size } : null
}

/** "The Q&A bank shows 3 of them asked about market." */
export const leakQuestionsLine = (q: LeakQuestions) => `The Q&A bank shows ${q.askers} of them asked about ${q.theme.toLowerCase()}.`

/* ---------- warm vs cold ---------- */

export type PathShare = { asked: number; met: number; share: number | null }

/** The share of asks that reached a first meeting, warm intros against cold paths with no introducer. */
export function warmVsCold(inv: readonly Inv[], acts: readonly Act[]): { warm: PathShare; cold: PathShare } {
  const h = stageHistory(acts)
  const tally = (cold: boolean): PathShare => {
    const reached = inv.filter((i) => isColdPath(i) === cold).map((i) => reachedIdx(i, h.get(i._id)))
    const asked = reached.filter((x) => x >= IDX.ask!).length
    const met = reached.filter((x) => x >= IDX.m1!).length
    return { asked, met, share: asked ? met / asked : null }
  }
  return { warm: tally(false), cold: tally(true) }
}

/* ---------- days in each stage ---------- */

export const DWELL_STAGES = ['ask', 'intro', 'booked', 'm1', 'm2', 'dd'] as const satisfies readonly PipelineStage[]
export type DwellStage = (typeof DWELL_STAGES)[number]

/** One line under the tiles for the slowest stage. */
export const DWELL_TIP: Record<DwellStage, string> = {
  ask: 'Asks wait longest for an intro. Nudge the connector after three days.',
  intro: 'Intros wait longest for a call. Offer two times in your first reply.',
  booked: 'Booked calls take longest to happen. Offer an earlier slot when one opens.',
  m1: 'First meetings wait longest for a next step. Set one before you hang up.',
  m2: 'Second meetings take longest to reach diligence. Send the data room the same day.',
  dd: 'Diligence runs longest. Agree a decision date when they open the data room.',
}

export type Dwell = { stage: DwellStage; label: string; avg: number | null; n: number }

/**
 * The average days spent in each stage so far: from the move into it to the next
 * move, or to today while they're still there. A stay with no known end (the
 * investor moved on without a logged move) is left out.
 */
export function daysInStage(inv: readonly Inv[], acts: readonly Act[], today: string): { stages: Dwell[]; slowest: Dwell | null } {
  const h = stageHistory(acts)
  const days = new Map<string, number[]>(DWELL_STAGES.map((s) => [s, []]))
  for (const i of inv) {
    const moves = h.get(i._id) ?? []
    moves.forEach((m, k) => {
      const xs = days.get(m.stage)
      if (!xs) return
      // PST-302: a stay that's still open while an application awaits their decision isn't slow on Dev's side.
      const end = moves[k + 1]?.date ?? (i.stage === m.stage && !isAwaiting(i.application) ? today : null)
      if (end) xs.push(Math.max(0, dayDiff(end, m.date)))
    })
  }
  const stages = DWELL_STAGES.map((stage): Dwell => {
    const xs = days.get(stage)!
    return { stage, label: STAGE_SHORT[stage]!, avg: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, n: xs.length }
  })
  const slowest = stages.filter((s) => s.avg !== null).sort((a, b) => b.avg! - a.avg!)[0] ?? null
  return { stages, slowest }
}

/* ---------- projected close ---------- */

/** Days of activity Nest needs before it projects a close. */
export const MIN_HISTORY_DAYS = 14
/** Further out than this, there's no date worth showing. */
const MAX_PROJECTION_DAYS = 730

export type Pace = {
  kind: 'pace'
  status: 'on' | 'behind'
  /** The day the round reaches its target at this pace; null when there's no pace. */
  projected: string | null
  deadline: string
  /** Days from the target date to the projected one (negative: early). */
  days: number | null
  /** What the pace is made of: committed dollars, or (nothing committed this week) asks turned into dollars. */
  basis: 'committed' | 'asks'
  /** Dollars a week at this pace. */
  weekly: number
  /** Dollars a week it takes from here to make the target date. */
  needed: number
  committedThisWeek: number
  asksThisWeek: number
  /** More asks this week that would close the gap; null when on track or asks can't be turned into dollars. */
  extraAsks: number | null
  /** The furthest-along conversations whose verbals would close this week's gap. */
  convert: string[]
}

export type Projection =
  | { kind: 'empty'; noTarget: boolean; noHistory: boolean; days: number }
  | { kind: 'reached'; committed: number; target: number }
  | Pace

/**
 * When the round reaches its target at the last 7 days' pace: committed dollars
 * a week, or when nothing was committed this week, asks a week times what an ask
 * has been worth (committed so far over asks so far; before any commitment, the
 * average Expected times the round's odds at the ask stage).
 */
export function projectClose(o: {
  investors: readonly Inv[]
  acts: readonly Act[]
  round: Pick<Round, 'target' | 'deadline' | 'odds'>
  today: string
  /** False until the round settings exist (only placeholder dates). */
  hasTarget: boolean
}): Projection {
  const { investors: inv, round, today } = o
  const ids = new Set(inv.map((i) => i._id))
  const acts = o.acts.filter((a) => ids.has(a.investorId) && a.date <= today)
  const first = acts.reduce<string | null>((m, a) => (!m || a.date < m ? a.date : m), null)
  const days = first ? dayDiff(today, first) : 0
  const noTarget = !o.hasTarget || !isISODate(round.deadline) || !(round.target > 0)
  const committed = inv.reduce((a, i) => a + committedOf(i), 0)
  if (!noTarget && committed >= round.target) return { kind: 'reached', committed, target: round.target }
  if (noTarget || days < MIN_HISTORY_DAYS) return { kind: 'empty', noTarget, noHistory: days < MIN_HISTORY_DAYS, days }

  const h = stageHistory(acts)
  let committedThisWeek = 0
  let asksThisWeek = 0
  for (const i of inv) {
    const moves = h.get(i._id) ?? []
    const into = moves.find((m) => COMMIT.has(m.stage))
    if (COMMIT.has(i.stage) && into && inWeek(into.date, today)) committedThisWeek += committedOf(i)
    if (moves.some((m) => m.stage === 'ask' && inWeek(m.date, today))) asksThisWeek++
  }
  const asksEver = inv.filter((i) => reachedIdx(i, h.get(i._id)) >= IDX.ask!).length
  const amounts = inv.map((i) => +(i.expected || 0)).filter((x) => x > 0)
  const avg = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0
  const perAsk = committed > 0 && asksEver > 0 ? committed / asksEver : avg * (round.odds.ask ?? 0)
  const basis = committedThisWeek > 0 ? 'committed' : 'asks'
  const weekly = basis === 'committed' ? committedThisWeek : asksThisWeek * perAsk

  const remaining = round.target - committed
  const ahead = weekly > 0 ? Math.ceil((remaining / weekly) * 7) : Infinity
  const projected = ahead <= MAX_PROJECTION_DAYS ? addDays(today, ahead) : null
  const status = projected && projected <= round.deadline ? 'on' : 'behind'
  const needed = remaining / Math.max(1, dayDiff(round.deadline, today) / 7)
  const gap = Math.max(0, needed - weekly)

  const convert: string[] = []
  if (status === 'behind') {
    const near = inv
      .filter((i) => (i.stage === 'dd' || i.stage === 'm2' || i.stage === 'm1') && +(i.expected || 0) > 0)
      .sort((a, b) => IDX[b.stage]! - IDX[a.stage]! || +(b.expected || 0) - +(a.expected || 0) || a.name.localeCompare(b.name))
    let sum = 0
    for (const i of near.slice(0, 3)) {
      if (sum >= gap) break
      convert.push(i.name)
      sum += +(i.expected || 0)
    }
    if (sum < gap) convert.length = 0
  }
  return {
    kind: 'pace',
    status,
    projected,
    deadline: round.deadline,
    days: projected ? dayDiff(projected, round.deadline) : null,
    basis,
    weekly,
    needed,
    committedThisWeek,
    asksThisWeek,
    extraAsks: status === 'behind' && perAsk > 0 ? Math.max(1, Math.ceil(gap / perAsk)) : null,
    convert,
  }
}

const andList = (xs: readonly string[]) => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

function recovery(p: Pace): string {
  const ways = [
    p.extraAsks ? `${plural(p.extraAsks, 'more ask')} this week` : '',
    p.convert.length ? `turn ${andList(p.convert)} into ${p.convert.length === 1 ? 'a verbal' : 'verbals'}` : '',
  ].filter(Boolean)
  return ways.length ? `To get back on track: ${ways.join(', or ')}.` : `To get back on track: about ${money(p.needed)} committed a week from here.`
}

/** The projected-close card's words: the big line, the sentence beside it, and what it takes. */
export function projectionCopy(p: Projection): { title: string; line: string; next: string } {
  const how = 'The projection uses the last 7 days of commitments and asks.'
  if (p.kind === 'empty') {
    const history = p.days
      ? `Only ${plural(p.days, 'day')} of activity so far. Two weeks is enough to project a close.`
      : 'Nothing logged yet. Two weeks of asks and stage moves is enough to project a close.'
    if (p.noTarget && p.noHistory) return { title: 'Not enough to go on yet', line: 'Set the round’s target and close date in Settings.', next: history }
    if (p.noTarget) return { title: 'No target date yet', line: 'Set the round’s target and close date in Settings to compare against.', next: how }
    return { title: 'Not enough to go on yet', line: history, next: how }
  }
  if (p.kind === 'reached') return { title: 'Target reached', line: `${money(p.committed)} committed against your ${money(p.target)} target.`, next: 'Now get the SAFEs signed and the money in.' }
  if (!p.projected)
    return {
      title: 'No pace yet',
      line: p.asksThisWeek ? 'This week’s asks aren’t worth enough yet to project a close.' : 'Nothing was committed or asked for in the last 7 days, so there’s no pace to project.',
      next: recovery(p),
    }
  const pace = p.basis === 'committed' ? 'at this week’s pace' : 'at this week’s pace of asks'
  const target = `your ${longDay(p.deadline)} target`
  const d = p.days ?? 0
  const line = d === 0 ? `Right on ${target}, ${pace}.` : `${plural(Math.abs(d), 'day')} ${d > 0 ? 'after' : 'before'} ${target}, ${pace}.`
  if (p.status === 'behind') return { title: longDay(p.projected), line, next: recovery(p) }
  const did = [p.asksThisWeek ? plural(p.asksThisWeek, 'ask') : '', p.committedThisWeek ? `${money(p.committedThisWeek)} committed` : ''].filter(Boolean).join(' and ')
  return { title: longDay(p.projected), line, next: did ? `On track: ${did} in the last 7 days.` : 'On track. Keep the asks going.' }
}
