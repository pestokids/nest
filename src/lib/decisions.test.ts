// PST-293: the decision's pure parts: the default decide-by date, call counting,
// maybe-since, the Maybes sort and button, and the Inbox selectors. Made-up investors only.
import { describe, expect, it } from 'vitest'
import {
  askByDate, buildDecisions, callDays, callsLine, decideByLine, decideByOf, maybeAction, maybeDays, nextMaybeSince, sortMaybes, WANTS_LEAD, withStatus,
} from './decisions'
import { decideByPassedRows, decideRows, decisionInbox, newAskRows, thirdCallRows } from './inbox'
import type { SignalView } from './signals'

const NOW = Date.parse('2026-11-08T12:00:00+05:30')
const at = (day: string, hh = 11) => Date.parse(day + 'T' + String(hh).padStart(2, '0') + ':00:00+05:30')
const D = 864e5

describe('the decide-by date', () => {
  it('defaults to 7 days after the 1st meeting', () => {
    expect(decideByOf(undefined, '2026-11-02')).toBe('2026-11-09')
    expect(decideByOf({}, '2026-11-30')).toBe('2026-12-07')
  })
  it('is absent before any meeting', () => {
    expect(decideByOf(undefined, undefined)).toBeUndefined()
  })
  it('follows Dev once Dev sets it, and stays empty once Dev clears it', () => {
    expect(decideByOf({ decideBy: '2026-11-27', decideByManual: true }, '2026-11-02')).toBe('2026-11-27')
    expect(decideByOf({ decideByManual: true }, '2026-11-02')).toBeUndefined()
  })
  it('comes from the earliest call in buildDecisions', () => {
    const [d] = buildDecisions(['kite'], [], [{ start: at('2026-11-03'), end: at('2026-11-03', 12), investorIds: ['kite'] }], [{ investorId: 'kite', kind: 'note', touch: 'call', date: '2026-11-05' }], NOW)
    expect(d).toMatchObject({ investorId: 'kite', calls: 2, firstMeeting: '2026-11-03', decideBy: '2026-11-10' })
  })
})

describe('call counting', () => {
  const m = (day: string, hh = 11) => ({ start: at(day, hh), end: at(day, hh + 1) })
  it('counts past meetings, logged calls and meetings, and moves to the 1st and 2nd meeting', () => {
    const acts = [
      { kind: 'note' as const, touch: 'call', date: '2026-11-04' },
      { kind: 'note' as const, touch: 'meeting', date: '2026-11-05' },
      { kind: 'stage' as const, stage: 'm2', date: '2026-11-06' },
    ]
    expect(callDays([m('2026-11-02')], acts, NOW)).toEqual(['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-06'])
  })
  it('counts one a day, so the same meeting on the calendar and logged by hand is one call', () => {
    const acts = [{ kind: 'note' as const, touch: 'meeting', date: '2026-11-02' }, { kind: 'stage' as const, stage: 'm1', date: '2026-11-02' }]
    expect(callDays([m('2026-11-02'), m('2026-11-02', 15)], acts, NOW)).toHaveLength(1)
  })
  it('leaves out meetings still ahead, emails, notes and other stage moves', () => {
    const acts = [
      { kind: 'note' as const, touch: 'email', date: '2026-11-03' },
      { kind: 'note' as const, touch: 'note', date: '2026-11-03' },
      { kind: 'stage' as const, stage: 'booked', date: '2026-11-03' },
      { kind: 'note' as const, touch: 'call', date: '2026-11-12' },
    ]
    expect(callDays([m('2026-11-09')], acts, NOW)).toEqual([])
  })
  it('says ask on the next call at 2, and ask or drop from the 3rd', () => {
    expect(callsLine(0)).toBe('No calls yet')
    expect(callsLine(1)).toBe('1 of 3')
    expect(callsLine(2)).toBe('2 of 3 · ask on the next call')
    expect(callsLine(3)).toBe('3 calls · ask or drop')
    expect(callsLine(5)).toBe('5 calls · ask or drop')
  })
})

describe('maybe since', () => {
  it('is set when the status becomes Maybe, kept while it stays, and cleared when it leaves', () => {
    expect(nextMaybeSince({ status: 'interested' }, 'maybe', NOW)).toBe(NOW)
    expect(nextMaybeSince({ status: 'maybe', maybeSince: NOW - 3 * D }, 'maybe', NOW)).toBe(NOW - 3 * D)
    expect(nextMaybeSince({ status: 'maybe', maybeSince: NOW - 3 * D }, 'no', NOW)).toBeUndefined()
    expect(nextMaybeSince(undefined, undefined, NOW)).toBeUndefined()
  })
  it('counts whole days', () => {
    expect(maybeDays(NOW - 12 * D, NOW)).toBe(12)
    expect(maybeDays(NOW, NOW)).toBe(0)
  })
  it('withStatus drops the reason and maybe-since when the status changes', () => {
    expect(withStatus({ status: 'maybe' as const, reason: WANTS_LEAD, maybeSince: NOW - D }, 'no', undefined, NOW)).toEqual({ status: 'no' })
    expect(withStatus({}, 'maybe', WANTS_LEAD, NOW)).toEqual({ status: 'maybe', reason: WANTS_LEAD, maybeSince: NOW })
  })
})

describe('Pipeline › Maybes', () => {
  it('sorts the maybes by how long each has been one, the longest first, and leaves the rest out', () => {
    const rows = [
      { name: 'Tidewater Angels', status: 'maybe' as const, maybeSince: NOW - 4 * D },
      { name: 'Fernhill Fund', status: 'maybe' as const, maybeSince: NOW - 12 * D },
      { name: 'Orchard Capital', status: 'interested' as const },
      { name: 'Northwind Accelerator', status: 'maybe' as const, maybeSince: NOW - 9 * D },
      { name: 'Bluebird Seed', status: 'maybe' as const, maybeSince: NOW - 9 * D },
    ]
    expect(sortMaybes(rows).map((r) => r.name)).toEqual(['Fernhill Fund', 'Bluebird Seed', 'Northwind Accelerator', 'Tidewater Angels'])
  })
  it('picks one button: Mark as no for a polite no, Set a date without one, Ask once it is time', () => {
    const today = '2026-11-08'
    expect(maybeAction({ reason: WANTS_LEAD, decideBy: '2026-11-07', calls: 3 }, today, 1)).toBe('no')
    expect(maybeAction({ calls: 1 }, today, 1)).toBe('date')
    expect(maybeAction({ decideBy: '2026-11-07', calls: 1 }, today, 1)).toBe('ask')
    expect(maybeAction({ decideBy: '2026-11-20', calls: 3 }, today, 1)).toBe('ask')
    expect(maybeAction({ decideBy: '2026-11-18', calls: 1 }, today, 7)).toBe('ask')
    expect(maybeAction({ decideBy: '2026-11-20', calls: 1 }, today, 2)).toBe('date')
  })
  it('asks for a decision by the decide-by date, or in 5 days when that is too close', () => {
    expect(askByDate('2026-11-20', '2026-11-08')).toBe('2026-11-20')
    expect(askByDate('2026-11-09', '2026-11-08')).toBe('2026-11-13')
    expect(askByDate(undefined, '2026-11-08')).toBe('2026-11-13')
  })
  it('words the decide-by date', () => {
    expect(decideByLine('2026-11-07', '2026-11-08')).toBe('Decide-by passed yesterday')
    expect(decideByLine('2026-11-05', '2026-11-08')).toBe('Decide-by passed 3 days ago')
    expect(decideByLine('2026-11-08', '2026-11-08')).toBe('Decide by today')
    expect(decideByLine('2026-11-18', '2026-11-08')).toBe('Decide by Wed 18 Nov')
  })
})

describe('Inbox selectors (PST-297)', () => {
  const investors = [
    { _id: 'fern', name: 'Fernhill Fund', stage: 'm2' as const },
    { _id: 'kite', name: 'Kite Angels', stage: 'm1' as const },
    { _id: 'peb', name: 'Pebble Partners', stage: 'passed' as const },
    { _id: 'orch', name: 'Orchard Capital', stage: 'dd' as const },
  ]
  const decisions = [
    { investorId: 'fern', status: 'maybe' as const, calls: 3, decideBy: '2026-11-07' },
    { investorId: 'kite', calls: 1, decideBy: '2026-11-12' },
    { investorId: 'peb', calls: 4, decideBy: '2026-11-01' },
    { investorId: 'orch', status: 'yes' as const, calls: 3, decideBy: '2026-11-02' },
  ]
  const sig = (s: Partial<SignalView> & Pick<SignalView, '_id' | 'investorId'>): SignalView => ({ source: 'email', day: '2026-11-08', at: NOW, outcome: 'none', p: 0, ...s })
  const signals = [
    sig({ _id: 's1', investorId: 'kite', asked: 'deck', at: NOW - 1000 }),
    sig({ _id: 's2', investorId: 'kite', asked: 'numbers', askDoneAt: NOW }),
    sig({ _id: 's3', investorId: 'fern', outcome: 'decide', change: { to: 'no' }, p: 0.6 }),
    sig({ _id: 's4', investorId: 'orch', outcome: 'decide', change: { to: 'no' }, p: 0.5, doneAt: NOW }),
  ]
  const src = { investors, decisions, signals, today: '2026-11-08' }
  it('decide-by passed: only open decisions of live investors', () => {
    expect(decideByPassedRows(src).map((r) => r.investorId)).toEqual(['fern'])
  })
  it('the 3rd call done: ask or drop, never for a Yes or a passed investor', () => {
    expect(thirdCallRows(src)).toEqual([expect.objectContaining({ investorId: 'fern', detail: '3 calls · ask or drop' })])
  })
  it('new asks from emails that are not done', () => {
    expect(newAskRows(src)).toEqual([expect.objectContaining({ investorId: 'kite', detail: 'Asked for the deck', signalId: 's1' })])
  })
  it('Decide rows still waiting', () => {
    expect(decideRows(src)).toEqual([expect.objectContaining({ kind: 'decide', investorId: 'fern', signalId: 's3', change: { to: 'no' } })])
  })
  it('all of them, an investor once between decide-by and the 3rd call', () => {
    expect(decisionInbox(src).map((r) => r.kind + ':' + r.investorId)).toEqual(['decide:fern', 'ask:kite', 'decide_by:fern'])
  })
})
