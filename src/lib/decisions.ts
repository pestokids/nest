// PST-293: the decision on each investor, apart from their stage: a status
// (Interested, Maybe, Yes, No), a decide-by date, the calls so far and how long
// they've been a maybe. Pure functions over plain data, shared by Convex
// (convex/decisions.ts) and the UI.
import { dayDiff, formatDay, todayIST } from './dates'
import { addDays } from './today'

export const DECISION_STATUSES = ['interested', 'maybe', 'yes', 'no'] as const
export type DecisionStatus = (typeof DECISION_STATUSES)[number]
export const DECISION_LABEL: Record<DecisionStatus, string> = { interested: 'Interested', maybe: 'Maybe', yes: 'Yes', no: 'No' }
/** "is a maybe now", "is interested now". */
export const STATUS_PHRASE: Record<DecisionStatus, string> = { interested: 'interested', maybe: 'a maybe', yes: 'a yes', no: 'a no' }
export const isDecisionStatus = (s: unknown): s is DecisionStatus => typeof s === 'string' && (DECISION_STATUSES as readonly string[]).includes(s)

/** Nest's decide-by date: this many days after the 1st meeting (Dev, 8 Nov). */
export const DECIDE_BY_DAYS = 7
/** At this many calls it's time to ask for a yes or no, or drop them. */
export const ASK_OR_DROP_CALLS = 3
/** The reason a "come back when you have a lead" leaves on a Maybe. */
export const WANTS_LEAD = 'wants a lead'

/** What's stored per investor (convex/decisionsSchema.ts). Every field is optional. */
export type DecisionFields = {
  status?: DecisionStatus
  /** Why, in a few words ("wants a lead"). */
  reason?: string
  /** When the status became Maybe (ms); cleared when it leaves. */
  maybeSince?: number
  /** Dev's own decide-by date, when `decideByManual`. */
  decideBy?: string
  /** Dev set or cleared the date: it no longer follows the 1st meeting. */
  decideByManual?: boolean
}

/** One investor's decision as the app shows it: what's stored, plus the calls and the decide-by date in effect. */
export type Decision = Omit<DecisionFields, 'decideBy'> & {
  investorId: string
  /** The date in effect: Dev's, else 7 days after the 1st meeting. Absent when there's neither. */
  decideBy?: string
  /** Days with a meeting or a call (Calendar, logged touches, moves to 1st or 2nd meeting). */
  calls: number
  firstMeeting?: string
}

/** An investor's log as far as calls go: a touch, or a stage move. */
export type CallAct = { kind: 'stage' | 'note'; stage?: string; touch?: string; date: string }

/** Is this activity a call? Logged calls and meetings, and moves to the 1st or 2nd meeting (each means one happened). */
export const isCallAct = (a: CallAct) => (a.kind === 'stage' ? a.stage === 'm1' || a.stage === 'm2' : a.touch === 'call' || a.touch === 'meeting')

/**
 * The days an investor had a call, oldest first: past Calendar meetings and the
 * activities `isCallAct` counts. One a day at most, so a meeting that's on the
 * calendar and logged by hand (or moved to 1st meeting that day) counts once.
 */
export function callDays(meetings: readonly { start: number; end: number }[], acts: readonly CallAct[], now: number): string[] {
  const today = todayIST(now)
  const days = new Set<string>()
  for (const m of meetings) if (m.end <= now) days.add(todayIST(m.start))
  for (const a of acts) if (isCallAct(a) && a.date <= today) days.add(a.date)
  return [...days].sort()
}

/** The decide-by date in effect: Dev's (or none, if Dev cleared it), else 7 days after the 1st meeting. */
export function decideByOf(f: Pick<DecisionFields, 'decideBy' | 'decideByManual'> | undefined, firstMeeting: string | undefined): string | undefined {
  if (f?.decideByManual) return f.decideBy
  return firstMeeting ? addDays(firstMeeting, DECIDE_BY_DAYS) : undefined
}

/** Every investor's decision from the stored rows, their meetings and their activities. */
export function buildDecisions(
  investorIds: readonly string[],
  rows: readonly (DecisionFields & { investorId: string })[],
  meetings: readonly { start: number; end: number; investorIds: readonly string[] }[],
  acts: readonly (CallAct & { investorId: string })[],
  now: number,
): Decision[] {
  const byId = new Map(rows.map((r) => [r.investorId, r]))
  const ms = new Map<string, { start: number; end: number }[]>()
  for (const m of meetings) for (const id of m.investorIds) ms.set(id, [...(ms.get(id) ?? []), m])
  const as = new Map<string, CallAct[]>()
  for (const a of acts) as.set(a.investorId, [...(as.get(a.investorId) ?? []), a])
  return investorIds.map((investorId) => {
    const r = byId.get(investorId)
    const days = callDays(ms.get(investorId) ?? [], as.get(investorId) ?? [], now)
    const firstMeeting = days[0]
    const decideBy = decideByOf(r, firstMeeting)
    return {
      investorId,
      calls: days.length,
      ...(r?.status ? { status: r.status } : {}),
      ...(r?.reason ? { reason: r.reason } : {}),
      ...(r?.maybeSince !== undefined ? { maybeSince: r.maybeSince } : {}),
      ...(r?.decideByManual ? { decideByManual: true } : {}),
      ...(decideBy ? { decideBy } : {}),
      ...(firstMeeting ? { firstMeeting } : {}),
    }
  })
}

/** A status change's `maybeSince`: kept while it stays Maybe, set when it becomes one, cleared when it leaves. */
export function nextMaybeSince(prev: Pick<DecisionFields, 'status' | 'maybeSince'> | undefined, to: DecisionStatus | undefined, now: number): number | undefined {
  if (to !== 'maybe') return undefined
  return prev?.status === 'maybe' && prev.maybeSince !== undefined ? prev.maybeSince : now
}

/** A decision with a new status (what the app shows before the save lands). */
export function withStatus<D extends Pick<DecisionFields, 'status' | 'reason' | 'maybeSince'>>(d: D, to: DecisionStatus | undefined, reason: string | undefined, now: number): D {
  const { status: _s, reason: _r, maybeSince: _m, ...rest } = d
  const since = nextMaybeSince(d, to, now)
  return { ...rest, ...(to ? { status: to } : {}), ...(to && reason ? { reason } : {}), ...(since !== undefined ? { maybeSince: since } : {}) } as D
}

/** Whole days they've been a maybe. */
export const maybeDays = (maybeSince: number, now: number) => Math.max(0, dayDiff(todayIST(now), todayIST(maybeSince)))

/** The drawer's line next to the calls bar. */
export function callsLine(calls: number): string {
  if (calls >= ASK_OR_DROP_CALLS) return `${calls} calls · ask or drop`
  if (calls === ASK_OR_DROP_CALLS - 1) return `${calls} of ${ASK_OR_DROP_CALLS} · ask on the next call`
  if (calls === 0) return 'No calls yet'
  return `${calls} of ${ASK_OR_DROP_CALLS}`
}

/** "Decide-by passed yesterday", "Decide by today", "Decide by Wed 18 Nov". */
export function decideByLine(decideBy: string, today: string): string {
  const late = dayDiff(today, decideBy)
  if (late === 1) return 'Decide-by passed yesterday'
  if (late > 1) return `Decide-by passed ${late} days ago`
  if (late === 0) return 'Decide by today'
  return `Decide by ${formatDay(decideBy)}`
}

export const isDecideByPassed = (d: Pick<Decision, 'decideBy'>, today: string) => !!d.decideBy && d.decideBy < today

/** Still to decide: no Yes or No yet. */
export const undecided = (d: Pick<Decision, 'status'>) => d.status !== 'yes' && d.status !== 'no'

/* ---------- Pipeline › Maybes ---------- */

/** Every maybe, the longest one first. */
export function sortMaybes<T extends Pick<Decision, 'status' | 'maybeSince'> & { name?: string }>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => r.status === 'maybe' && r.maybeSince !== undefined)
    .sort((a, b) => a.maybeSince! - b.maybeSince! || (a.name ?? '').localeCompare(b.name ?? ''))
}

/**
 * The one button a maybe gets (pipeline-race.png): Mark as no for a polite no
 * ("wants a lead"), Set a date with no decide-by, Ask for a yes or no once it's
 * time (3 calls, the date has passed or is two days off, or a week quiet), else
 * Set a date.
 */
export function maybeAction(d: Pick<Decision, 'reason' | 'decideBy' | 'calls'>, today: string, quiet: number | null): 'no' | 'ask' | 'date' {
  if (d.reason === WANTS_LEAD) return 'no'
  if (!d.decideBy) return 'date'
  if (d.calls >= ASK_OR_DROP_CALLS || dayDiff(d.decideBy, today) <= 2 || (quiet !== null && quiet >= 7)) return 'ask'
  return 'date'
}

/** The date "Ask for a yes or no" asks them to decide by: the decide-by date if it's 3+ days off, else 5 days from today. */
export function askByDate(decideBy: string | undefined, today: string): string {
  return decideBy && dayDiff(decideBy, today) >= 3 ? decideBy : addDays(today, 5)
}
