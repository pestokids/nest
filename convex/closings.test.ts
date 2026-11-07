// @vitest-environment edge-runtime
// PST-283: closing records. Record SAFE sent, ticks that move the pipeline (and the ones that are refused), the cap table.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { todayIST } from '../src/lib/dates'
import { DEFAULT_ROUND } from '../src/lib/round'
import { addDays } from '../src/lib/today'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const base = { firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }
const terms = { amount: 50_000, instrument: 'post-money SAFE', cap: 16_000_000, proRata: true, mfn: false, signerName: 'Ria Marigold', signerEmail: 'ria@marigold.example.com' }

async function setup() {
  const t = convexTest(schema, modules)
  const today = todayIST()
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const inv = (name: string, stage: Doc<'investors'>['stage']) =>
      ctx.db.insert('investors', { ...base, name, stage, maxStage: stage as Doc<'investors'>['maxStage'], committed: 50_000, lastTouch: addDays(today, -5) })
    return { dev, marigold: await inv('Marigold Capital', 'verbal'), cobalt: await inv('Cobalt Angels', 'dd') }
  })
  const as = t.withIdentity({ subject: `${ids.dev}|s1` })
  const get = <T extends 'investors' | 'closings'>(id: Id<T>) => t.run((ctx) => ctx.db.get(id))
  const stageActs = (id: Id<'investors'>) => t.run(async (ctx) => (await ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()).map((a) => a.stage))
  return { t, as, today, ...ids, get, stageActs }
}

describe('closing records', () => {
  it('Record SAFE sent ticks "sent" and moves nothing', async () => {
    const { as, today, marigold, get } = await setup()
    const id = await as.mutation(api.closings.save, { investorId: marigold, terms: { ...terms, requestUrl: ' https://sign.example.com/r/1 ' }, sentAt: addDays(today, -2) })
    const c = (await get(id))!
    expect(c.steps).toEqual([{ key: 'sent', at: addDays(today, -2) }])
    expect(c.requestUrl).toBe('https://sign.example.com/r/1')
    expect((await get(marigold))!.stage).toBe('verbal')
    await as.mutation(api.closings.save, { investorId: marigold, terms: { ...terms, amount: 60_000 } })
    expect((await get(marigold))!.committed).toBe(60_000)
    expect((await get(id))!.steps).toHaveLength(1)
  })

  it('starts only at Verbal or later', async () => {
    const { as, cobalt } = await setup()
    await expect(as.mutation(api.closings.save, { investorId: cobalt, terms })).rejects.toThrow(/Move Cobalt Angels to Verbal first/)
  })

  it('rejects bad terms with field errors', async () => {
    const { as, marigold } = await setup()
    await expect(as.mutation(api.closings.save, { investorId: marigold, terms: { ...terms, amount: 0 } })).rejects.toThrow(/Fix the highlighted fields/)
  })

  it('ticks move the pipeline one stage at a time, and untick moves it back', async () => {
    const { as, today, marigold, get, stageActs } = await setup()
    const id = await as.mutation(api.closings.save, { investorId: marigold, terms, sentAt: addDays(today, -3) })
    await expect(as.mutation(api.closings.tick, { id, key: 'wired', at: today })).rejects.toThrow(/Tick “Countersigned” first/)
    expect(await as.mutation(api.closings.tick, { id, key: 'viewed', at: addDays(today, -2) })).toEqual({ to: null, firstMoney: false })
    expect(await as.mutation(api.closings.tick, { id, key: 'signed', at: addDays(today, -1) })).toEqual({ to: 'signed', firstMoney: false })
    const inv = (await get(marigold))!
    expect([inv.stage, inv.maxStage, inv.lastTouch]).toEqual(['signed', 'signed', today])
    await as.mutation(api.closings.tick, { id, key: 'countersigned', at: today })
    expect(await as.mutation(api.closings.tick, { id, key: 'wired', at: today })).toEqual({ to: 'wired', firstMoney: true })
    expect((await get(marigold))!.stage).toBe('wired')
    expect(await stageActs(marigold)).toEqual(['signed', 'wired'])

    expect(await as.mutation(api.closings.tick, { id, key: 'wired', at: null })).toEqual({ to: 'signed', firstMoney: false })
    expect((await get(marigold))!.maxStage).toBe('wired')
    // Money in again: no second confetti.
    expect(await as.mutation(api.closings.tick, { id, key: 'wired', at: today })).toEqual({ to: 'wired', firstMoney: false })
    await expect(as.mutation(api.closings.tick, { id, key: 'signed', at: null })).rejects.toThrow(/Untick “Countersigned” first/)
  })

  it('refuses a signed tick that would skip a stage on the pipeline', async () => {
    const { t, as, today, marigold, get } = await setup()
    const id = await as.mutation(api.closings.save, { investorId: marigold, terms, sentAt: today })
    await t.run((ctx) => ctx.db.patch(marigold, { stage: 'dd' }))
    await expect(as.mutation(api.closings.tick, { id, key: 'signed', at: today })).rejects.toThrow(/would skip a stage/)
    expect((await get(id))!.steps.map((s) => s.key)).toEqual(['sent'])
  })

  it('re-dating a ticked step moves nothing', async () => {
    const { as, today, marigold, get } = await setup()
    const id = await as.mutation(api.closings.save, { investorId: marigold, terms, sentAt: addDays(today, -3) })
    await as.mutation(api.closings.tick, { id, key: 'signed', at: addDays(today, -1) })
    expect(await as.mutation(api.closings.tick, { id, key: 'signed', at: addDays(today, -2) })).toEqual({ to: null, firstMoney: false })
    expect((await get(id))!.steps.find((s) => s.key === 'signed')!.at).toBe(addDays(today, -2))
  })

  it('goes when its investor is deleted', async () => {
    const { as, marigold, get } = await setup()
    const id = await as.mutation(api.closings.save, { investorId: marigold, terms })
    await as.mutation(api.investors.remove, { id: marigold })
    expect(await get(id)).toBeNull()
  })
})

describe('cap table', () => {
  const capTable = { founders: [{ name: ' Founder A ', shares: 4_500_000 }, { name: 'Founder B', shares: 4_500_000 }], optionPool: 1_000_000, safes: [] }

  it('needs the round saved first, then logs one change', async () => {
    const { t, as } = await setup()
    await expect(as.mutation(api.closings.setCapTable, { capTable })).rejects.toThrow(/Save the round first/)
    await t.run((ctx) => ctx.db.insert('settings', { key: 'round', ...DEFAULT_ROUND }))
    expect(await as.mutation(api.closings.setCapTable, { capTable })).toBe(1)
    expect(await as.mutation(api.closings.setCapTable, { capTable })).toBe(0)
    const d = await as.query(api.closings.data, {})
    expect(d.capTable).toEqual({ founders: [{ name: 'Founder A', shares: 4_500_000 }, { name: 'Founder B', shares: 4_500_000 }], optionPool: 1_000_000 })
    const log = await as.query(api.settings.log, {})
    expect(log.map((l) => [l.field, l.to])).toEqual([['capTable', '2 founders, 9,000,000 shares · pool 1,000,000']])
  })

  it('survives saving the round form, which never sends it', async () => {
    const { t, as } = await setup()
    await t.run((ctx) => ctx.db.insert('settings', { key: 'round', ...DEFAULT_ROUND }))
    await as.mutation(api.closings.setCapTable, { capTable })
    const { round } = await as.query(api.settings.get, {})
    expect(round).not.toHaveProperty('capTable')
    await as.mutation(api.settings.update, { round: { ...round, quietDays: 5 } })
    expect((await as.query(api.closings.data, {})).capTable?.optionPool).toBe(1_000_000)
  })
})

describe('Send by email', () => {
  const sendable = async (s: Awaited<ReturnType<typeof setup>>, signerEmail?: string) =>
    s.as.mutation(api.closings.save, { investorId: s.marigold, terms: { ...terms, signerEmail }, sentAt: addDays(s.today, -3) })

  it('is off without RESEND_API_KEY, and nothing is sent', async () => {
    const s = await setup()
    vi.stubEnv('RESEND_API_KEY', '')
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const id = await sendable(s, terms.signerEmail)
    expect((await s.as.query(api.closings.data, {})).emailReady).toBe(false)
    await expect(s.as.action(api.closings.emailReminder, { id, subject: 'The SAFE', text: 'Hi Ria' })).rejects.toThrow(/isn’t set up/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('emails the signer and logs an Email touch', async () => {
    const s = await setup()
    vi.stubEnv('RESEND_API_KEY', 're_test_made_up')
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const id = await sendable(s, ' Ria@Marigold.example.com ')
    expect((await s.as.query(api.closings.data, {})).emailReady).toBe(true)
    expect(await s.as.action(api.closings.emailReminder, { id, subject: ' Our SAFE ', text: ' Hi Ria, a gentle nudge. ' })).toEqual({ to: 'ria@marigold.example.com' })
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ to: ['ria@marigold.example.com'], subject: 'Our SAFE', text: 'Hi Ria, a gentle nudge.' })
    const acts = await s.t.run((ctx) => ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', s.marigold)).collect())
    expect(acts.map((a) => [a.note, a.touch])).toEqual([['Emailed a reminder to sign the SAFE', 'email']])
    expect((await s.get(s.marigold))!.lastTouch).toBe(s.today)
  })

  it('needs a signer email, and a refused send logs nothing', async () => {
    const s = await setup()
    vi.stubEnv('RESEND_API_KEY', 're_test_made_up')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'Domain not verified' }), { status: 403 })))
    const id = await sendable(s)
    await expect(s.as.action(api.closings.emailReminder, { id, subject: 'The SAFE', text: 'Hi' })).rejects.toThrow(/signer’s email/)
    await sendable(s, terms.signerEmail)
    await expect(s.as.action(api.closings.emailReminder, { id, subject: 'The SAFE', text: 'Hi' })).rejects.toThrow(/Domain not verified/)
    const acts = await s.t.run((ctx) => ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', s.marigold)).collect())
    expect(acts).toHaveLength(0)
  })
})
