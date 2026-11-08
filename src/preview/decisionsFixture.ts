// PST-293 preview: made-up decisions, calls and signals over the fake investors
// (every name here is from src/preview/fixture.ts; nothing is real).
//   &drawer=decision   the drawer's decision on Orchard Capital (interested, 2 of 3 calls, read from notes)
//   &pipeline=maybes   Pipeline › Maybes: four maybes, the longest first
//   &signal=auto       a note arrives and Nest marks Kite Angels a maybe by itself: the toast with Undo, "Auto" in History
//   &signal=decide     unsure signals waiting on Dev (Decide rows) and a new ask from an email, on Today
import type { CallAct, DecisionFields, DecisionStatus } from '../lib/decisions'
import { WANTS_LEAD } from '../lib/decisions'
import type { Investor } from '../lib/pipeline'
import type { SignalView } from '../lib/signals'
import { addDays } from '../lib/today'

export const PREVIEW_SIGNAL = ['auto', 'decide'] as const
export type PreviewSignal = (typeof PREVIEW_SIGNAL)[number]

export type PreviewLogEntry = { _id: string; investorId: string; at: number; from?: DecisionStatus; to?: DecisionStatus; reason?: string; by?: string; auto: boolean; source?: 'email' | 'note'; day?: string; undoneAt?: number }

const D = 864e5

export function fixtureDecisions(investors: readonly Investor[], today: string, now: number, state: PreviewSignal | null) {
  const id = (name: string) => investors.find((i) => i.name === name)?._id
  const rows: (DecisionFields & { investorId: string })[] = []
  const acts: (CallAct & { investorId: string })[] = []
  const signals: SignalView[] = []
  const log: PreviewLogEntry[] = []
  const calls = (investorId: string, days: number[]) => days.forEach((n) => acts.push({ investorId, kind: 'note', touch: 'call', date: addDays(today, n) }))
  const add = (name: string, f: DecisionFields, days: number[]) => {
    const investorId = id(name)
    if (!investorId) return
    rows.push({ investorId, ...f })
    calls(investorId, days)
    if (f.status) log.push({ _id: 'pl-' + investorId, investorId, at: f.maybeSince ?? now - 3 * D, to: f.status, reason: f.reason, by: 'Dev', auto: false })
  }
  add('Orchard Capital', { status: 'interested', decideBy: addDays(today, 19), decideByManual: true }, [-1])
  add('Fernhill Fund', { status: 'maybe', maybeSince: now - 12 * D, decideBy: addDays(today, -1), decideByManual: true }, [-20, -15, -9])
  add('Saltmarsh Angels', { status: 'maybe', reason: WANTS_LEAD, maybeSince: now - 6 * D }, [-10, -6])
  add('Northwind Accelerator', { status: 'maybe', maybeSince: now - 9 * D, decideBy: addDays(today, 10), decideByManual: true }, [-9])
  add('Tidewater Angels', { status: 'maybe', maybeSince: now - 4 * D, decideBy: addDays(today, 12), decideByManual: true }, [-4])
  const orchard = id('Orchard Capital')
  if (orchard)
    signals.push({ _id: 'ps-orchard', investorId: orchard, source: 'note', day: addDays(today, -1), at: now - D, outcome: 'none', p: 0, status: 'interested', score: 4.2, lead: 0.4, comeback: 0.05 })
  const salt = id('Saltmarsh Angels')
  if (salt)
    signals.push({ _id: 'ps-salt', investorId: salt, source: 'note', day: addDays(today, -6), at: now - 6 * D, outcome: 'none', p: 0.91, status: 'maybe', score: 2.4, lead: 0.03, comeback: 0.91 })
  if (state === 'decide') {
    const juniper = id('Juniper Seed')
    const lantern = id('Lantern Ventures')
    const kite = id('Kite Angels')
    if (juniper) signals.push({ _id: 'ps-juniper', investorId: juniper, source: 'email', day: today, at: now - 2 * 36e5, outcome: 'decide', change: { to: 'no' }, p: 0.58, pass: 0.58, real: 0.1 })
    if (kite) signals.push({ _id: 'ps-kite', investorId: kite, source: 'note', day: addDays(today, -1), at: now - 20 * 36e5, outcome: 'decide', change: { to: 'maybe', reason: WANTS_LEAD }, p: 0.62, status: 'maybe', score: 2.8, lead: 0.05, comeback: 0.62 })
    if (lantern) signals.push({ _id: 'ps-lantern', investorId: lantern, source: 'email', day: today, at: now - 36e5, outcome: 'none', p: 0, asked: 'deck', pass: 0.02, real: 0.7 })
  }
  return { rows, acts, signals, log }
}

/** &signal=auto: the note that arrives a moment after load, and what Nest does with it by itself. */
export function fixtureAutoSignal(investors: readonly Investor[], today: string, now: number): SignalView | null {
  const kite = investors.find((i) => i.name === 'Kite Angels')
  if (!kite) return null
  return { _id: 'ps-auto', investorId: kite._id, source: 'note', day: today, at: now, outcome: 'auto', change: { to: 'maybe', reason: WANTS_LEAD }, p: 0.93, status: 'maybe', score: 2.6, lead: 0.04, comeback: 0.93 }
}
