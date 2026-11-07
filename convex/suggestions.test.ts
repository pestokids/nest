// @vitest-environment edge-runtime
// PST-275: Suggested fixes. The rule checks, the queue, accept and Undo, merge, and when the checks run.
import { convexTest } from 'convex-test'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import crons from './crons'
import schema from './schema'
import { todayIST } from '../src/lib/dates'
import { proposedDate } from '../src/lib/suggestions'
import { addDays } from '../src/lib/today'

const modules = import.meta.glob('./**/*.ts')
const H = 36e5
const D = 24 * H

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

type InvFields = Partial<Omit<Doc<'investors'>, '_id' | '_creationTime'>> & Pick<Doc<'investors'>, 'name' | 'stage'>
const base = { firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'intro' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: 'Follow up', notes: '', source: '', updatedAt: 0 }

/**
 * Made-up investors, one per rule (and a few that should stay quiet):
 * Kite (Booked, met yesterday), Orchard (no addresses, named in an invite), Fernhill (no addresses, nothing to go on),
 * Better Capital and "Better Cap." (the same firm), Larkspur (next step 9 days late), Wren (Verbal, no Expected).
 */
async function setup() {
  const t = convexTest(schema, modules)
  const now = Date.now()
  const today = todayIST(now)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const inv = (f: InvFields) => ctx.db.insert('investors', { ...base, maxStage: f.stage === 'passed' || f.stage === 'parked' ? 'ask' : (f.stage as Doc<'investors'>['maxStage']), ...f })
    const kite = await inv({ name: 'Kite Angels', firm: 'Kite Angels', stage: 'booked', email: 'sam@kite.example.com', nextStep: 'Meeting: Pesto × Kite', nextDate: addDays(today, -1), lastTouch: addDays(today, -3) })
    const orchard = await inv({ name: 'Orchard Capital', firm: 'Orchard Capital', stage: 'intro' })
    const fern = await inv({ name: 'Fernhill', firm: 'Fernhill', stage: 'ask' })
    const better = await inv({ name: 'Better Capital', firm: 'Better Capital', stage: 'intro', nextStep: '', email: 'asha@better.example.com', notes: 'Met at the summit.' })
    const betterCap = await inv({ name: 'Better Cap.', firm: 'Better Cap.', stage: 'todo', domains: ['bettercap.example.com'], notes: 'From the angel list.' })
    const lark = await inv({ name: 'Larkspur', firm: 'Larkspur', stage: 'm1', email: 'rowan@larkspur.example.com', nextStep: 'Send the deck', nextDate: addDays(today, -9) })
    const wren = await inv({ name: 'Wren Angels', firm: 'Wren Angels', stage: 'verbal', email: 'jo@wren.example.com' })
    const quiet = await inv({ name: 'Tidewater', firm: 'Tidewater', stage: 'todo', nextStep: '' })
    await ctx.db.insert('activities', { investorId: kite, kind: 'stage', stage: 'booked', date: addDays(today, -3), userId: dev })
    const meeting = (eventId: string, title: string, start: number, people: string[], investorIds: Id<'investors'>[]) =>
      ctx.db.insert('meetings', { userId: dev, eventId, title, start, end: start + H, people: people.map((email) => ({ email })), investorIds, touched: true })
    await meeting('kite-1', 'Pesto × Kite', now - D, ['sam@kite.example.com'], [kite])
    await meeting('orchard-1', 'Pesto × Orchard', now - 2 * D, ['maya@orchard.example.com', 'founder@pestokids.com'], [])
    return { dev, kite, orchard, fern, better, betterCap, lark, wren, quiet }
  })
  const rows = () => t.run((ctx) => ctx.db.query('suggestions').collect())
  const one = async (kind: Doc<'suggestions'>['kind'], investorId: Id<'investors'>) => (await rows()).find((r) => r.kind === kind && r.investorId === investorId)!
  const get = <T extends 'investors' | 'suggestions' | 'activities'>(id: Id<T>) => t.run((ctx) => ctx.db.get(id))
  return { t, now, today, ...ids, rows, one, get, as: t.withIdentity({ subject: `${ids.dev}|s1` }) }
}

describe('rule checks', () => {
  it('each rule makes the right suggestion, and running again adds nothing', async () => {
    const s = await setup()
    expect(await s.as.mutation(api.suggestions.run, {})).toEqual({ added: 7, updated: 0, withdrawn: 0 })
    const rows = await s.rows()

    expect(await s.one('stage', s.kite)).toMatchObject({
      title: 'Kite Angels: the 1st meeting happened yesterday, but the card is still in Booked.',
      fix: 'Move to 1st meeting', patch: { op: 'stage', from: 'booked', to: 'm1' }, source: 'calendar', safe: true, status: 'open',
    })
    expect(await s.one('missing_info', s.orchard)).toMatchObject({
      title: 'Orchard Capital has no email or domain, so meetings and emails can’t match.',
      fix: 'Add domain orchard.example.com (from a calendar invite)', patch: { op: 'domain', domain: 'orchard.example.com' }, source: 'calendar', safe: true,
    })
    expect(await s.one('missing_info', s.fern)).toMatchObject({ patch: { op: 'review' }, source: 'rule', safe: false })
    expect(await s.one('duplicate', s.better)).toMatchObject({
      otherInvestorId: s.betterCap, title: 'Better Capital and “Better Cap.” look like the same firm.',
      fix: 'Merge into Better Capital, keeping both histories', patch: { op: 'merge' }, safe: false,
    })
    expect(await s.one('next_step', s.better)).toMatchObject({
      title: 'Better Capital is in Intro with no next step.', patch: { op: 'next_step', step: 'Book the first call', date: proposedDate(s.today) }, safe: true,
    })
    expect(await s.one('next_step', s.lark)).toMatchObject({ title: 'Larkspur’s next step is 9 days late: “Send the deck”.', patch: { op: 'next_step', step: 'Send the follow-up and the data room' } })
    expect(await s.one('expected', s.wren)).toMatchObject({ title: 'Wren Angels is at Verbal with no Expected amount.', patch: { op: 'review' }, safe: false })
    // Not contacted yet, so no next step or address is expected of it.
    expect(rows.some((r) => r.investorId === s.quiet)).toBe(false)
    // Kite's next step is only a day late: not worth a suggestion.
    expect(rows.some((r) => r.kind === 'next_step' && r.investorId === s.kite)).toBe(false)

    // Again, from the cron's entry point: same rows, same ids.
    expect(await s.t.mutation(internal.suggestions.check, {})).toEqual({ added: 0, updated: 0, withdrawn: 0 })
    expect((await s.rows()).map((r) => r._id).sort()).toEqual(rows.map((r) => r._id).sort())
  })

  it('a stage suggestion never skips a stage, and ignores meetings from before the card reached Booked', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const old = await ctx.db.query('meetings').withIndex('by_event', (q) => q.eq('eventId', 'kite-1')).unique()
      await ctx.db.patch(old!._id, { start: s.now - 5 * D, end: s.now - 5 * D + H })
    })
    await s.t.mutation(internal.suggestions.check, {})
    expect((await s.rows()).some((r) => r.kind === 'stage')).toBe(false)
    // Two meetings since: still only to 1st meeting.
    await s.t.run(async (ctx) => {
      for (const n of [1, 2]) await ctx.db.insert('meetings', { userId: s.dev, eventId: `k${n}`, title: 'Call', start: s.now - n * H * 3, end: s.now - n * H * 3 + H, people: [], investorIds: [s.kite] })
    })
    await s.t.mutation(internal.suggestions.check, {})
    expect((await s.one('stage', s.kite)).patch).toEqual({ op: 'stage', from: 'booked', to: 'm1' })
  })

  it('a firm domain also turns up from an email thread, and shared domains count as duplicates', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      await ctx.db.insert('emailTouches', {
        userId: s.dev, threadId: 'th1', subject: 'Fernhill intro', participants: ['founder@pestokids.com', 'ana@fernhill.example.com', 'someone@gmail.com'],
        lastAt: s.now - D, lastFrom: 'them', lastFromEmail: 'ana@fernhill.example.com', count: 2, link: 'https://mail.example.com', investorIds: [s.lark],
      })
      await ctx.db.patch(s.wren, { domains: ['bettercap.example.com'] })
    })
    await s.t.mutation(internal.suggestions.check, {})
    expect(await s.one('missing_info', s.fern)).toMatchObject({ patch: { op: 'domain', domain: 'fernhill.example.com' }, source: 'gmail', fix: 'Add domain fernhill.example.com (from an email thread)' })
    // Wren is furthest along, so it's the one kept; Better Capital joins through the firm name.
    const dups = (await s.rows()).filter((r) => r.kind === 'duplicate')
    expect(dups.map((d) => [d.investorId, d.otherInvestorId])).toEqual(expect.arrayContaining([[s.wren, s.betterCap], [s.wren, s.better]]))
    expect(dups.find((d) => d.otherInvestorId === s.betterCap)!.title).toBe('Wren Angels and Better Cap. share the domain bettercap.example.com.')
  })

  it('withdraws an open suggestion once its rule stops firing', async () => {
    const s = await setup()
    await s.t.mutation(internal.suggestions.check, {})
    await s.t.run((ctx) => ctx.db.patch(s.lark, { nextDate: addDays(s.today, 3) }))
    expect(await s.t.mutation(internal.suggestions.check, {})).toMatchObject({ withdrawn: 1 })
    expect((await s.rows()).some((r) => r.investorId === s.lark)).toBe(false)
  })

  it('a dismissed suggestion never comes back', async () => {
    const s = await setup()
    await s.t.mutation(internal.suggestions.check, {})
    const fern = await s.one('missing_info', s.fern)
    await s.as.mutation(api.suggestions.dismiss, { id: fern._id })
    for (let k = 0; k < 2; k++) await s.t.mutation(internal.suggestions.check, {})
    expect((await s.rows()).filter((r) => r.key === fern.key)).toEqual([expect.objectContaining({ _id: fern._id, status: 'dismissed' })])
    expect((await s.as.query(api.suggestions.list, {})).some((r) => r._id === fern._id)).toBe(false)
    // Even when another feature tries the same key.
    expect(await s.t.mutation(internal.suggestions.addSuggestion, { kind: 'enrichment', investorId: s.fern, title: 'x', fix: 'y', patch: { op: 'review' }, source: 'enrich', key: 'enrich:fern' })).toBeTruthy()
    expect(await s.t.mutation(internal.suggestions.addSuggestion, { kind: 'enrichment', investorId: s.fern, title: 'x', fix: 'y', patch: { op: 'review' }, source: 'enrich', key: 'enrich:fern' })).toBeNull()
  })
})

describe('accept and Undo', () => {
  it('Move to 1st meeting: accept moves the card and logs it; Undo puts it back exactly', async () => {
    const s = await setup()
    await s.t.mutation(internal.suggestions.check, {})
    const before = await s.get(s.kite)
    const sg = await s.one('stage', s.kite)
    expect(await s.as.mutation(api.suggestions.accept, { id: sg._id })).toEqual({ applied: true })
    expect(await s.get(s.kite)).toMatchObject({ stage: 'm1', maxStage: 'm1', lastTouch: s.today })
    const acts = await s.as.query(api.activities.forInvestor, { investorId: s.kite })
    expect(acts[0]).toMatchObject({ kind: 'stage', stage: 'm1' })
    expect(await s.get(sg._id)).toMatchObject({ status: 'accepted', decidedBy: s.dev })
    expect((await s.as.query(api.suggestions.list, {})).some((r) => r._id === sg._id)).toBe(false)
    // The checks don't suggest it again while it's accepted.
    await s.t.mutation(internal.suggestions.check, {})
    expect((await s.rows()).filter((r) => r.kind === 'stage')).toHaveLength(1)

    await s.as.mutation(api.suggestions.undo, { ids: [sg._id] })
    const after = await s.get(s.kite)
    expect({ stage: after!.stage, maxStage: after!.maxStage, lastTouch: after!.lastTouch }).toEqual({ stage: before!.stage, maxStage: before!.maxStage, lastTouch: before!.lastTouch })
    expect((await s.as.query(api.activities.forInvestor, { investorId: s.kite })).some((a) => a.stage === 'm1')).toBe(false)
    expect(await s.get(sg._id)).toMatchObject({ status: 'open' })
    expect((await s.get(sg._id))!.undo).toBeUndefined()
  })

  it('a next step, an Expected amount and a domain each apply and undo', async () => {
    vi.useFakeTimers()
    const s = await setup()
    await s.t.mutation(internal.suggestions.check, {})
    const step = await s.one('next_step', s.better)
    await s.as.mutation(api.suggestions.accept, { id: step._id })
    expect(await s.get(s.better)).toMatchObject({ nextStep: 'Book the first call', nextDate: proposedDate(s.today) })
    await s.as.mutation(api.suggestions.undo, { ids: [step._id] })
    expect(await s.get(s.better)).toMatchObject({ nextStep: '' })
    expect((await s.get(s.better))!.nextDate).toBeUndefined()

    const amount = (await s.t.mutation(internal.suggestions.addSuggestion, {
      kind: 'expected', investorId: s.wren, title: 'Wren Angels said “around fifty” in yesterday’s call notes.', fix: 'Set Expected to $50K',
      patch: { op: 'expected', amount: 50000 }, source: 'notes', safe: true, key: 'notes:wren:1',
    }))!
    await s.as.mutation(api.suggestions.accept, { id: amount })
    expect((await s.get(s.wren))!.expected).toBe(50000)
    await s.as.mutation(api.suggestions.undo, { ids: [amount] })
    expect((await s.get(s.wren))!.expected).toBeUndefined()

    const domain = await s.one('missing_info', s.orchard)
    await s.as.mutation(api.suggestions.accept, { id: domain._id })
    expect((await s.get(s.orchard))!.domains).toEqual(['orchard.example.com'])
    await s.as.mutation(api.suggestions.undo, { ids: [domain._id] })
    expect((await s.get(s.orchard))!.domains).toBeUndefined()
    await s.t.finishAllScheduledFunctions(vi.runAllTimers)
  })

  it('an agent’s touch logs a note; Undo removes it', async () => {
    const s = await setup()
    const id = (await s.t.mutation(internal.suggestions.addSuggestion, {
      kind: 'touch', investorId: s.orchard, title: 'Grok Bot: you called Orchard Capital this morning (from your WhatsApp).', fix: 'Log a call · today',
      patch: { op: 'touch', touch: 'call', note: 'Call, logged by Grok Bot from WhatsApp.' }, source: 'agent', agentName: 'Grok Bot', safe: true, key: 'agent:grok:1',
    }))!
    // Agents are never safe to accept in bulk, whatever they say.
    expect(await s.get(id)).toMatchObject({ safe: false, agentName: 'Grok Bot', status: 'open' })
    await s.as.mutation(api.suggestions.accept, { id })
    expect((await s.as.query(api.activities.forInvestor, { investorId: s.orchard }))[0]).toMatchObject({ kind: 'note', touch: 'call' })
    expect((await s.get(s.orchard))!.lastTouch).toBe(s.today)
    await s.as.mutation(api.suggestions.undo, { ids: [id] })
    expect(await s.as.query(api.activities.forInvestor, { investorId: s.orchard })).toEqual([])
    expect((await s.get(s.orchard))!.lastTouch).toBeUndefined()
  })

  it('Undo brings back a dismissed one too', async () => {
    const s = await setup()
    await s.t.mutation(internal.suggestions.check, {})
    const sg = await s.one('expected', s.wren)
    await s.as.mutation(api.suggestions.dismiss, { id: sg._id })
    await s.as.mutation(api.suggestions.undo, { ids: [sg._id] })
    expect(await s.get(sg._id)).toMatchObject({ status: 'open' })
  })

  it('a suggestion that stopped fitting applies nothing and goes', async () => {
    const s = await setup()
    await s.t.mutation(internal.suggestions.check, {})
    const sg = await s.one('stage', s.kite)
    await s.t.run((ctx) => ctx.db.patch(s.kite, { stage: 'm2', maxStage: 'm2' }))
    expect(await s.as.mutation(api.suggestions.accept, { id: sg._id })).toEqual({ applied: false })
    expect(await s.get(s.kite)).toMatchObject({ stage: 'm2' })
    expect(await s.get(sg._id)).toBeNull()
  })

  it('a review only opens the drawer: accepting one is refused', async () => {
    const s = await setup()
    await s.t.mutation(internal.suggestions.check, {})
    await expect(s.as.mutation(api.suggestions.accept, { id: (await s.one('expected', s.wren))._id })).rejects.toThrow(/drawer/)
  })
})

describe('merge', () => {
  it('keeps both histories: activities, meetings and threads move to the kept card; Undo splits them again', async () => {
    const s = await setup()
    const ids = await s.t.run(async (ctx) => {
      const keepAct = await ctx.db.insert('activities', { investorId: s.better, kind: 'note', note: 'Intro call', date: addDays(s.today, -4), userId: s.dev })
      const dropAct = await ctx.db.insert('activities', { investorId: s.betterCap, kind: 'note', note: 'Met at demo day', date: addDays(s.today, -10), userId: s.dev })
      const both = await ctx.db.insert('meetings', { userId: s.dev, eventId: 'both', title: 'Better sync', start: s.now - 3 * D, end: s.now - 3 * D + H, people: [], investorIds: [s.better, s.betterCap] })
      const meeting = await ctx.db.insert('meetings', { userId: s.dev, eventId: 'bc', title: 'Coffee', start: s.now - 4 * D, end: s.now - 4 * D + H, people: [{ email: 'li@bettercap.example.com' }], investorIds: [s.betterCap] })
      const thread = await ctx.db.insert('emailTouches', {
        userId: s.dev, threadId: 'bc-th', subject: 'Re: Pesto', participants: ['li@bettercap.example.com'], lastAt: s.now - 2 * D, lastFrom: 'them',
        lastFromEmail: 'li@bettercap.example.com', count: 3, link: 'https://mail.example.com', investorIds: [s.betterCap],
      })
      return { keepAct, dropAct, both, meeting, thread }
    })
    await s.t.mutation(internal.suggestions.check, {})
    const dup = await s.one('duplicate', s.better)
    expect(await s.as.mutation(api.suggestions.accept, { id: dup._id })).toEqual({ applied: true })

    expect(await s.get(s.betterCap)).toBeNull()
    expect((await s.as.query(api.activities.forInvestor, { investorId: s.better })).map((a) => a._id).sort()).toEqual([ids.keepAct, ids.dropAct].sort())
    const moved = await s.t.run(async (ctx) => ({ both: await ctx.db.get(ids.both), meeting: await ctx.db.get(ids.meeting), thread: await ctx.db.get(ids.thread) }))
    expect(moved.both!.investorIds).toEqual([s.better])
    expect(moved.meeting!.investorIds).toEqual([s.better])
    expect(moved.thread!.investorIds).toEqual([s.better])
    expect(await s.get(s.better)).toMatchObject({ name: 'Better Capital', stage: 'intro', domains: ['bettercap.example.com'], notes: 'Met at the summit.\n\nFrom the angel list.' })

    await s.as.mutation(api.suggestions.undo, { ids: [dup._id] })
    const back = await s.get(dup._id)
    expect(back).toMatchObject({ status: 'open' })
    const again = (await s.get(back!.otherInvestorId!))!
    expect(again).toMatchObject({ name: 'Better Cap.', domains: ['bettercap.example.com'], notes: 'From the angel list.' })
    expect((await s.as.query(api.activities.forInvestor, { investorId: again._id })).map((a) => a._id)).toEqual([ids.dropAct])
    const split = await s.t.run(async (ctx) => ({ both: await ctx.db.get(ids.both), meeting: await ctx.db.get(ids.meeting), thread: await ctx.db.get(ids.thread) }))
    expect(split.both!.investorIds).toEqual([s.better, again._id])
    expect(split.meeting!.investorIds).toEqual([again._id])
    expect(split.thread!.investorIds).toEqual([again._id])
    expect(await s.get(s.better)).toMatchObject({ notes: 'Met at the summit.' })
    expect((await s.get(s.better))!.domains).toBeUndefined()
  })
})

describe('accept the safe ones', () => {
  it('accepts every safe one and skips merges, reviews, enrichment and agents; Undo reverts the batch', async () => {
    vi.useFakeTimers()
    const s = await setup()
    await s.t.mutation(internal.suggestions.check, {})
    const enrich = (await s.t.mutation(internal.suggestions.addSuggestion, { kind: 'enrichment', investorId: s.lark, title: '9 facts found for Larkspur.', fix: 'Review what Nest found', patch: { op: 'review' }, source: 'enrich', safe: true, key: 'enrich:lark:1' }))!
    const agent = (await s.t.mutation(internal.suggestions.addSuggestion, { kind: 'touch', investorId: s.wren, title: 'Grok Bot: a call.', fix: 'Log a call · today', patch: { op: 'touch', touch: 'call', note: 'Call' }, source: 'agent', agentName: 'Grok Bot', safe: true, key: 'agent:grok:2' }))!
    const { ids } = await s.as.mutation(api.suggestions.acceptSafe, {})
    const rows = await s.rows()
    const accepted = rows.filter((r) => r.status === 'accepted')
    expect(accepted.map((r) => r._id).sort()).toEqual([...ids].sort())
    expect(accepted.map((r) => `${r.kind}:${r.investorId}`).sort()).toEqual([`missing_info:${s.orchard}`, `next_step:${s.better}`, `next_step:${s.lark}`, `stage:${s.kite}`].sort())
    const open = rows.filter((r) => r.status === 'open')
    expect(open.map((r) => r.kind).sort()).toEqual(['duplicate', 'enrichment', 'expected', 'missing_info', 'touch'])
    expect(open.map((r) => r._id)).toEqual(expect.arrayContaining([enrich, agent]))
    expect(await s.get(s.betterCap)).not.toBeNull()

    await s.as.mutation(api.suggestions.undo, { ids })
    expect((await s.rows()).every((r) => r.status === 'open')).toBe(true)
    expect(await s.get(s.kite)).toMatchObject({ stage: 'booked' })
    expect(await s.get(s.lark)).toMatchObject({ nextStep: 'Send the deck', nextDate: addDays(s.today, -9) })
    await s.t.finishAllScheduledFunctions(vi.runAllTimers)
  })
})

describe('when the checks run', () => {
  it('the cron runs them every morning at 09:00 IST', async () => {
    const job = (crons as unknown as { crons: Record<string, { name: string; schedule: unknown; args: unknown[] }> }).crons['suggestion checks']
    expect(job.schedule).toEqual({ type: 'daily', hourUTC: 3, minuteUTC: 30 })
    expect(job.name).toBe(getFunctionName(internal.suggestions.check))
    // 03:30 UTC is 09:00 in Asia/Kolkata.
    expect(todayIST(Date.UTC(2026, 10, 7, 3, 30)) + ' ' + new Date(Date.UTC(2026, 10, 7, 3, 30) + 330 * 6e4).toISOString().slice(11, 16)).toBe('2026-11-07 09:00')
    const s = await setup()
    await s.t.mutation(internal.suggestions.check, {})
    expect((await s.rows()).length).toBe(7)
  })

  it('only people on the access list can see or run them', async () => {
    const s = await setup()
    await expect(s.t.query(api.suggestions.list, {})).rejects.toThrow(/Not signed in/)
    await expect(s.t.mutation(api.suggestions.run, {})).rejects.toThrow(/Not signed in/)
    await expect(s.t.mutation(api.suggestions.acceptSafe, {})).rejects.toThrow(/Not signed in/)
  })

  it('addSuggestion keeps the check: keys for the rule checks', async () => {
    const s = await setup()
    await expect(s.t.mutation(internal.suggestions.addSuggestion, { kind: 'touch', title: 'x', fix: 'y', patch: { op: 'review' }, source: 'agent', key: 'check:stage:x' })).rejects.toThrow(/rule checks/)
  })
})
