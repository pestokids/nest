// Home: greeting, the phase line, "Up next" and the prep checklist rule.
// Pure functions over plain data; times are Asia/Kolkata like the rest of Nest.
import { dayDiff, todayIST } from './dates'
import type { Investor } from './pipeline'
import type { Phase, Round } from './round'
import { DONE } from './stages'

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
