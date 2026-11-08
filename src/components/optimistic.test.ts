// PST-290: the optimistic updates behind instant changes: a logged touch shows
// at once, and its Undo takes it back, before the server answers.
import type { OptimisticLocalStore } from 'convex/browser'
import { getFunctionName } from 'convex/server'
import { describe, expect, it } from 'vitest'
import { api } from '../../convex/_generated/api'
import { hideTouch, showAdvance, showTouch } from './optimistic'

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

const T = '2030-03-10'
const inv = { _id: 'inv1', name: 'Made-up Capital', stage: 'm1', maxStage: 'm1', lastTouch: '2030-03-01', nextStep: 'Send the deck', nextDate: '2030-03-12' }
const old = { _id: 'act0', investorId: 'inv1', kind: 'note', note: 'Intro call', date: '2030-03-01', by: 'Dev' }

describe('optimistic touch with Undo', () => {
  it('shows the touch on the investor and in both activity lists at once', () => {
    const { store, get } = fakeStore([
      [api.investors.list, {}, [inv]],
      [api.activities.recent, {}, [old]],
      [api.activities.forInvestor, { investorId: 'inv1' }, [old]],
    ])
    showTouch(store, { id: 'inv1' as never, note: ' Called about the round ', touch: 'call', next: { step: 'Send numbers', date: '2030-03-14' } }, 'Dev', T)
    expect(get(api.investors.list)).toEqual([{ ...inv, lastTouch: T, nextStep: 'Send numbers', nextDate: '2030-03-14' }])
    const recent = get(api.activities.recent) as { note: string; touch: string; date: string; by: string }[]
    expect(recent).toHaveLength(2)
    expect(recent[0]).toMatchObject({ note: 'Called about the round', touch: 'call', date: T, by: 'Dev' })
    expect((get(api.activities.forInvestor, { investorId: 'inv1' }) as unknown[])[0]).toBe(recent[0])
  })

  it('Undo takes the row away and puts the fields back', () => {
    const touched = { ...inv, lastTouch: T, nextStep: 'Send numbers', nextDate: '2030-03-14' }
    const row = { ...old, _id: 'act1', note: 'Called', date: T }
    const { store, get } = fakeStore([
      [api.investors.list, {}, [touched]],
      [api.activities.recent, {}, [row, old]],
      [api.activities.forInvestor, { investorId: 'inv1' }, [row, old]],
    ])
    const from = { lastTouch: inv.lastTouch, nextStep: inv.nextStep, nextDate: inv.nextDate }
    const set = { lastTouch: T, nextStep: 'Send numbers', nextDate: '2030-03-14' }
    hideTouch(store, { id: 'inv1' as never, activityId: 'act1' as never, from, set })
    expect(get(api.investors.list)).toEqual([inv])
    expect(get(api.activities.recent)).toEqual([old])
    expect(get(api.activities.forInvestor, { investorId: 'inv1' })).toEqual([old])
  })

  it('does nothing before the list has loaded', () => {
    const { store, get } = fakeStore([])
    showTouch(store, { id: 'inv1' as never, note: 'x' }, 'Dev', T)
    expect(get(api.investors.list)).toBeUndefined()
  })
})

describe('optimistic stage move', () => {
  it('moves one stage on at once, with the next step', () => {
    const { store, get } = fakeStore([[api.investors.list, {}, [inv]]])
    showAdvance(store, { id: 'inv1' as never, next: { step: 'Partner call', date: '2030-03-20' } }, T)
    expect(get(api.investors.list)).toEqual([{ ...inv, stage: 'm2', maxStage: 'm2', lastTouch: T, nextStep: 'Partner call', nextDate: '2030-03-20' }])
  })
})
