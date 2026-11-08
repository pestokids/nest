// @vitest-environment edge-runtime
// PST-290: the writes behind instant changes (a logged touch and its Undo, parking
// with a date and its Undo) and the density preference.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { todayIST } from '../src/lib/dates'
import { addDays } from '../src/lib/today'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const base = { firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, notes: '', source: '', updatedAt: 0 }

async function setup() {
  const t = convexTest(schema, modules)
  const today = todayIST()
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const larch = await ctx.db.insert('investors', { ...base, name: 'Larch Ventures', stage: 'm1', maxStage: 'm1', lastTouch: addDays(today, -6), nextStep: 'Send the deck', nextDate: addDays(today, 2) })
    return { dev, larch }
  })
  const as = t.withIdentity({ subject: `${ids.dev}|s1` })
  const get = (id: Id<'investors'>) => t.run((ctx) => ctx.db.get(id))
  const notes = (id: Id<'investors'>) => t.run(async (ctx) => (await ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()).filter((a) => a.kind === 'note'))
  return { t, as, today, ...ids, get, notes }
}

describe('a logged touch, with Undo', () => {
  it('logs it, and Undo takes the activity and the fields back', async () => {
    const { as, today, larch, get, notes } = await setup()
    const before = (await get(larch))!
    const rec = await as.mutation(api.investors.logTouch, { id: larch, note: 'Call about the round', touch: 'call', next: { step: 'Send numbers', date: addDays(today, 4) } })
    expect(rec).toMatchObject({ id: larch, day: today, from: { lastTouch: before.lastTouch, nextStep: 'Send the deck', nextDate: before.nextDate }, set: { lastTouch: today, nextStep: 'Send numbers', nextDate: addDays(today, 4) } })
    expect((await get(larch))!).toMatchObject({ lastTouch: today, nextStep: 'Send numbers' })
    expect(await notes(larch)).toHaveLength(1)

    await as.mutation(api.investors.undoTouch, { id: larch, activityId: rec.activityId, from: rec.from, set: rec.set })
    expect((await get(larch))!).toMatchObject({ lastTouch: before.lastTouch, nextStep: 'Send the deck', nextDate: before.nextDate })
    expect(await notes(larch)).toHaveLength(0)
  })

  it('Undo keeps what changed again since', async () => {
    const { t, as, larch, get } = await setup()
    const rec = await as.mutation(api.investors.logTouch, { id: larch, note: 'Emailed', touch: 'email', next: { step: 'Wait for reply' } })
    await t.run((ctx) => ctx.db.patch(larch, { nextStep: 'Edited in another tab' }))
    await as.mutation(api.investors.undoTouch, { id: larch, activityId: rec.activityId, from: rec.from, set: rec.set })
    expect((await get(larch))!.nextStep).toBe('Edited in another tab')
  })

  it('logNote still resolves with the day', async () => {
    const { as, today, larch } = await setup()
    expect(await as.mutation(api.investors.logNote, { id: larch, note: 'Nudged', touch: 'nudge' })).toBe(today)
  })
})

describe('parking with a date, with Undo', () => {
  it('parks until the day, and Undo puts the stage back and clears the day', async () => {
    const { as, today, larch, get } = await setup()
    const until = addDays(today, 14)
    const r = await as.mutation(api.investors.move, { id: larch, stage: 'parked', parkedUntil: until })
    expect((await get(larch))!).toMatchObject({ stage: 'parked', parkedUntil: until })
    expect(r.from).toMatchObject({ stage: 'm1', parkedUntil: null })
    await as.mutation(api.investors.undoMove, { id: larch, to: 'parked', from: r.from, activityId: r.activityId })
    const back = (await get(larch))!
    expect(back.stage).toBe('m1')
    expect(back.parkedUntil).toBeUndefined()
  })

  it('changes the day while already parked, and Undo restores the old day', async () => {
    const { as, today, larch, get } = await setup()
    await as.mutation(api.investors.move, { id: larch, stage: 'parked', parkedUntil: addDays(today, 7) })
    const r = await as.mutation(api.investors.move, { id: larch, stage: 'parked', parkedUntil: addDays(today, 30) })
    expect((await get(larch))!.parkedUntil).toBe(addDays(today, 30))
    await as.mutation(api.investors.undoMove, { id: larch, to: 'parked', from: r.from, activityId: r.activityId })
    expect((await get(larch))!.parkedUntil).toBe(addDays(today, 7))
  })

  it('a plain move leaves the park day alone', async () => {
    const { t, as, larch, get } = await setup()
    await t.run((ctx) => ctx.db.patch(larch, { stage: 'parked', parkedUntil: '2031-01-01' }))
    const r = await as.mutation(api.investors.move, { id: larch, stage: 'parked' })
    expect(r.activityId).toBeNull()
    expect((await get(larch))!.parkedUntil).toBe('2031-01-01')
  })
})

describe('list density', () => {
  it('is per user, unset until chosen, and keeps sounds alone', async () => {
    const { as } = await setup()
    expect(await as.query(api.prefs.get, {})).toEqual({ sounds: null, density: null })
    await as.mutation(api.prefs.setDensity, { density: 'compact' })
    expect(await as.query(api.prefs.get, {})).toEqual({ sounds: null, density: 'compact' })
    await as.mutation(api.prefs.setSounds, { on: false })
    expect(await as.query(api.prefs.get, {})).toEqual({ sounds: false, density: 'compact' })
  })
})
