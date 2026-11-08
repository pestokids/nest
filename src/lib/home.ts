// Home: greeting, the phase line, "Up next", the prep checklist rule, and (PST-289) the Raise card's counts and This week.
// Pure functions over plain data; times are Asia/Kolkata like the rest of Nest.
import { dayDiff, todayIST } from './dates'
import { dayOf, dedupeMeetings, timeOf, type SyncedMeeting } from './google'
import type { Investor } from './pipeline'
import type { Phase, Round } from './round'
import { ACTIVE, DONE } from './stages'

const IST_OFFSET_MS = 330 * 60 * 1000
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Hour of the day (0–23) in Asia/Kolkata. */
export const hourIST = (now: number) => new Date(now + IST_OFFSET_MS).getUTCHours()

export function partOfDay(now: number): 'Morning' | 'Afternoon' | 'Evening' | 'Up late' {
  const h = hourIST(now)
  if (h >= 4 && h < 12) return 'Morning'
  if (h >= 12 && h < 17) return 'Afternoon'
  if (h >= 17) return 'Evening'
  return 'Up late'
}

/** "Evening, Dev." First run says hello instead. */
export function greeting(now: number, firstName: string, firstRun = false): string {
  const name = firstName.trim() || 'there'
  return firstRun ? `Hi, ${name}.` : `${partOfDay(now)}, ${name}.`
}

/** "Friday 6 November" (rendered uppercase as the eyebrow). */
export function longDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** "Fri 4 Dec" */
export function dayMonth(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`
}

export const dateEyebrow = (now: number) => longDate(todayIST(now))

/** The phase that contains `today`, or undefined between/outside phases. */
export const phaseOn = (round: Round, today: string) => round.phases.find((p) => today >= p.from && today <= p.to)

/** The next phase that starts after `today`. */
export const nextPhase = (round: Round, today: string) =>
  [...round.phases].sort((a, b) => a.from.localeCompare(b.from)).find((p) => p.from > today)

/** Prep is done when the phase has to-dos and every one of them is ticked. */
export function isChecklistDone(todo: readonly string[], ticked: Iterable<number>): boolean {
  if (!todo.length) return false
  const set = new Set(ticked)
  return todo.every((_, i) => set.has(i))
}

/** The line under the greeting, from the round's current phase. */
export function phaseLine(round: Round, today: string, opts: { firstRun?: boolean; phaseDone?: boolean } = {}): string {
  if (opts.firstRun) return 'Welcome to the nest.'
  const ps = round.phases
  if (!ps.length) return 'Set up the round to get going.'
  if (today > round.deadline) return 'The round has closed.'
  const now = phaseOn(round, today)
  const next = nextPhase(round, today)
  if (!now) return next ? `${next.name} starts ${dayMonth(next.from)}.` : 'Every phase is behind you.'
  if (opts.phaseDone) return next ? `${now.name} is done. ${next.name} next.` : `${now.name} is done.`
  const week = dayDiff(now.to, now.from) <= 7 && !/week/i.test(now.name) ? ' week' : ''
  return `${now.name}${week} is on.`
}

export type UpNextItem = { date: string; text: string; kind: 'phase' | 'investor'; id: string }

/**
 * The next dated items, soonest first: investors' next steps and phase starts,
 * from today on. Ties: phase starts first, then by text.
 */
export function upNext(investors: Pick<Investor, '_id' | 'name' | 'nextStep' | 'nextDate' | 'stage'>[], phases: Phase[], today: string, limit = 3): UpNextItem[] {
  const items: UpNextItem[] = []
  for (const p of phases)
    if (p.from >= today) items.push({ date: p.from, kind: 'phase', id: p.k, text: p.todo[0] ? `${p.name}: ${p.todo[0]}` : `${p.name} starts` })
  for (const i of investors)
    if (i.nextDate && i.nextDate >= today && !DONE.has(i.stage))
      items.push({ date: i.nextDate, kind: 'investor', id: i._id, text: i.nextStep ? `${i.name}: ${i.nextStep}` : `${i.name}: next step` })
  const rank = { phase: 0, investor: 1 }
  return items.sort((a, b) => a.date.localeCompare(b.date) || rank[a.kind] - rank[b.kind] || a.text.localeCompare(b.text)).slice(0, limit)
}


/** "NOV 11" for the Up next list. */
export function monDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  return `${MONTHS[d.getUTCMonth()].slice(0, 3).toUpperCase()} ${d.getUTCDate()}`
}

/** Phase bar segments for the Raise card. Width follows phase length, within limits. */
export function phaseSegments(round: Round, today: string) {
  return round.phases.map((p) => ({
    key: p.k,
    name: p.name,
    state: today > p.to ? ('past' as const) : today >= p.from ? ('now' as const) : ('future' as const),
    grow: Math.min(14, Math.max(4, dayDiff(p.to, p.from) + 1)),
  }))
}

/* ---------- PST-289: the company overview ---------- */

/** The Raise card's counts: who you're talking to (intro made and on, before money in) and intros asked for. */
export function raiseStats(investors: readonly Pick<Investor, 'stage'>[]) {
  return {
    inConversation: investors.filter((i) => ACTIVE.has(i.stage) && i.stage !== 'ask').length,
    introsOut: investors.filter((i) => i.stage === 'ask').length,
  }
}

const addDay = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)

/** The next `n` working days (Monday to Friday), from today when it's one, else from the next. */
export function workingDays(today: string, n = 5): string[] {
  const out: string[] = []
  for (let d = today; out.length < n; d = addDay(d, 1)) {
    const wd = new Date(d + 'T00:00:00Z').getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d)
  }
  return out
}

/** "Wed 18" (rendered uppercase as the day's eyebrow). */
export const weekDay = (iso: string) => {
  const d = new Date(iso + 'T00:00:00Z')
  return `${WEEKDAYS[d.getUTCDay()].slice(0, 3)} ${d.getUTCDate()}`
}

export type WeekItem = { key: string; kind: 'meeting' | 'step' | 'phase'; text: string; investorId?: string }
export type WeekDay = { day: string; today: boolean; items: WeekItem[] }

/**
 * This week on Home: for each of the next five working days, investor meetings
 * (by time), then dated next steps on live conversations, then phases starting
 * or ending. A next step on a day its investor already has a meeting is left
 * out (the meeting says it). Pass no phases until the round is set up.
 */
export function thisWeek(
  src: { investors: readonly Pick<Investor, '_id' | 'name' | 'nextStep' | 'nextDate' | 'stage'>[]; meetings: readonly SyncedMeeting[]; phases: readonly Phase[]; today: string },
  n = 5,
): WeekDay[] {
  const byId = new Map(src.investors.map((i) => [i._id, i]))
  const meetings = dedupeMeetings(src.meetings).filter((m) => m.investorIds.some((id) => byId.has(id)))
  return workingDays(src.today, n).map((day) => {
    const met = new Set<string>()
    const items: WeekItem[] = []
    for (const m of meetings) {
      if (dayOf(m.start) !== day) continue
      const i = byId.get(m.investorIds.find((id) => byId.has(id))!)!
      m.investorIds.forEach((id) => met.add(id))
      items.push({ key: 'm:' + m._id, kind: 'meeting', investorId: i._id, text: `${i.name} · ${timeOf(m.start)}` })
    }
    const steps = src.investors
      .filter((i) => i.nextDate === day && !DONE.has(i.stage) && !met.has(i._id))
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const i of steps) items.push({ key: 's:' + i._id, kind: 'step', investorId: i._id, text: `${i.name} · ${i.nextStep.trim() || 'next step'}` })
    for (const p of src.phases) {
      if (p.from === day) items.push({ key: 'p:' + p.k + ':from', kind: 'phase', text: `${p.name} starts` })
      else if (p.to === day) items.push({ key: 'p:' + p.k + ':to', kind: 'phase', text: `${p.name} ends` })
    }
    return { day, today: day === src.today, items }
  })
}
