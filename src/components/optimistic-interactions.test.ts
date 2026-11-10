// PST-298: the optimistic updates behind the inbox, race, decisions and
// introducers changes: each shows at once, before the server answers. Every
// name is made up.
import type { OptimisticLocalStore } from 'convex/browser'
import { getFunctionName } from 'convex/server'
import { describe, expect, it } from 'vitest'
import { api } from '../../convex/_generated/api'
import {
  showDecisionBack, showDoneAsk, showIntroducer, showIntroducerEdit, showLink, showNudged, showResolve, showUndoSignal, showUpdateSent, showUpdateUndone,
} from './optimistic-interactions'

/** An in-memory stand-in for Convex's local query results. */
function fakeStore(seed: [unknown, Record<string, unknown>, unknown][]) {
  const m = new Map<string, unknown>()
  const key = (q: unknown, args: Record<string, unknown>) => getFunctionName(q as never) + JSON.stringify(args)
  for (const [q, args, v] of seed) m.set(key(q, args), v)
  const store = {
    getQuery: (q: unknown, args: Record<string, unknown>) => m.get(key(q, args)),
    setQuery: (q: unknown, args: Record<string, unknown>, v: unknown) => void m.set(key(q, args), v),
    getAllQueries: () => [],
  }
  return { store: store as unknown as OptimisticLocalStore, get: (q: unknown, args: Record<string, unknown> = {}) => m.get(key(q, args)) as never }
}

const NOW = Date.parse('2030-03-10T06:00:00Z')

describe('decisions', () => {
  const maybe = { investorId: 'inv1', status: 'maybe', reason: 'wants a lead', maybeSince: NOW - 5 * 864e5, calls: 2 }
  const signal = { _id: 's1', investorId: 'inv1', source: 'email', day: '2030-03-09', at: NOW - 1000, outcome: 'decide', p: 0.7, change: { to: 'no', reason: 'passed' } }

  it('Undo of Mark as no puts the maybe back, with its reason and days', () => {
    const { store, get } = fakeStore([[api.decisions.data, {}, { decisions: [{ investorId: 'inv1', status: 'no', calls: 2 }], signals: [] }]])
    showDecisionBack(store, maybe as never, 'no')
    expect((get(api.decisions.data) as { decisions: unknown[] }).decisions).toEqual([maybe])
  })

  it('Undo leaves a status that has changed again since', () => {
    const yes = { investorId: 'inv1', status: 'yes', calls: 2 }
    const { store, get } = fakeStore([[api.decisions.data, {}, { decisions: [yes], signals: [] }]])
    showDecisionBack(store, maybe as never, 'no')
    expect((get(api.decisions.data) as { decisions: unknown[] }).decisions).toEqual([yes])
  })

  it('taking a Decide row changes the status and the row leaves the Inbox', () => {
    const { store, get } = fakeStore([[api.decisions.data, {}, { decisions: [maybe], signals: [signal] }]])
    showResolve(store, { signalId: 's1', accept: true }, NOW)
    const data = get(api.decisions.data) as { decisions: { status: string; maybeSince?: number }[]; signals: { doneAt?: number }[] }
    expect(data.decisions[0]).toMatchObject({ status: 'no', reason: 'passed' })
    expect(data.decisions[0].maybeSince).toBeUndefined()
    expect(data.signals[0].doneAt).toBe(NOW)
  })

  it('leaving a Decide row as it is only takes the row away', () => {
    const { store, get } = fakeStore([[api.decisions.data, {}, { decisions: [maybe], signals: [signal] }]])
    showResolve(store, { signalId: 's1', accept: false }, NOW)
    const data = get(api.decisions.data) as { decisions: unknown[]; signals: { doneAt?: number }[] }
    expect(data.decisions).toEqual([maybe])
    expect(data.signals[0].doneAt).toBe(NOW)
  })

  it('Undo of a change Nest made puts the status it had back', () => {
    const auto = { ...signal, outcome: 'auto', change: { to: 'maybe', from: 'interested' } }
    const { store, get } = fakeStore([[api.decisions.data, {}, { decisions: [maybe], signals: [auto] }]])
    showUndoSignal(store, { signalId: 's1' }, NOW)
    const data = get(api.decisions.data) as { decisions: { status: string; maybeSince?: number }[]; signals: { undoneAt?: number }[] }
    expect(data.decisions[0]).toEqual({ investorId: 'inv1', status: 'interested', calls: 2 })
    expect(data.signals[0].undoneAt).toBe(NOW)
  })

  it('an answered ask leaves the Inbox at once', () => {
    const { store, get } = fakeStore([[api.decisions.data, {}, { decisions: [], signals: [signal] }]])
    showDoneAsk(store, { signalId: 's1' }, NOW)
    expect((get(api.decisions.data) as { signals: { askDoneAt?: number }[] }).signals[0].askDoneAt).toBe(NOW)
  })
})

describe('race: Mark sent and its Undo', () => {
  const before = { _id: 'u1', sentOn: '2030-03-04', count: 12, by: 'Dev' }

  it('reads today at once', () => {
    const { store, get } = fakeStore([[api.race.data, {}, { leadId: null, lastUpdate: before }]])
    showUpdateSent(store, { count: 17 }, '2030-03-10')
    expect((get(api.race.data) as { lastUpdate: unknown }).lastUpdate).toMatchObject({ sentOn: '2030-03-10', count: 17 })
  })

  it('Undo puts the update before it back', () => {
    const { store, get } = fakeStore([[api.race.data, {}, { leadId: null, lastUpdate: { _id: 'u2', sentOn: '2030-03-10', count: 17, by: 'Dev' } }]])
    showUpdateUndone(store, { id: 'u2' }, before as never)
    expect((get(api.race.data) as { lastUpdate: unknown }).lastUpdate).toEqual(before)
    showUpdateUndone(store, { id: 'u9' }, null)
    expect((get(api.race.data) as { lastUpdate: unknown }).lastUpdate).toEqual(before)
  })
})

describe('introducers', () => {
  const ankur = { _id: 'pi1', name: 'Ankur Mehta', relation: 'founder', notes: 'Founder of Tinkerly', createdAt: 1 }
  const intro = { _id: 'pn1', investorId: 'inv1', introducerId: 'pi1', steps: { asked: '2030-03-01' }, createdAt: 1 }
  const seed = () => fakeStore([[api.introducers.list, {}, { introducers: [ankur], intros: [intro] }]])

  it('a new introducer shows at once, tidied; someone already there stays as they are', () => {
    const { store, get } = seed()
    showIntroducer(store, { name: '  Mira   Shah ', email: ' Mira@Example.com ', relation: 'friend', notes: ' College friend ' }, NOW)
    showIntroducer(store, { name: 'ankur mehta', relation: 'friend', notes: '' }, NOW)
    const list = (get(api.introducers.list) as { introducers: { name: string; email?: string; notes: string }[] }).introducers
    expect(list).toHaveLength(2)
    expect(list[1]).toMatchObject({ name: 'Mira Shah', email: 'mira@example.com', relation: 'friend', notes: 'College friend', createdAt: NOW })
  })

  it('Edit details shows at once', () => {
    const { store, get } = seed()
    showIntroducerEdit(store, { id: 'pi1', name: 'Ankur Mehta', relation: 'angel', notes: 'Angel now' })
    expect((get(api.introducers.list) as { introducers: unknown[] }).introducers[0]).toMatchObject({ relation: 'angel', notes: 'Angel now' })
  })

  it('a new intro shows at once, but not twice', () => {
    const { store, get } = seed()
    showLink(store, { investorId: 'inv1', introducerId: 'pi1' }, NOW)
    showLink(store, { investorId: 'inv2', introducerId: 'pi1' }, NOW)
    const intros = (get(api.introducers.list) as { intros: { investorId: string; steps: object }[] }).intros
    expect(intros.map((x) => x.investorId)).toEqual(['inv1', 'inv2'])
    expect(intros[1].steps).toEqual({})
  })

  it('a nudge starts the 3 days again today', () => {
    const { store, get } = seed()
    showNudged(store, { introId: 'pn1' }, '2030-03-10')
    expect((get(api.introducers.list) as { intros: { nudgedAt?: string }[] }).intros[0].nudgedAt).toBe('2030-03-10')
  })
})
