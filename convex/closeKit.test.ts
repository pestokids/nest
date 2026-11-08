// @vitest-environment edge-runtime
// PST-291: the Close kit, allocation and tranche 2 on Convex. Resend is faked
// (fetch is stubbed; nothing is sent). Every name and address is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { confirmText } from '../src/lib/closeKit'
import { todayIST } from '../src/lib/dates'
import { DEFAULT_ROUND } from '../src/lib/round'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/** Resend accepts; every call is recorded. */
function fakeResend() {
  const calls: { url: string; body: Record<string, unknown> }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    return url.startsWith('https://api.resend.com') ? new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }) : new Response('{}', { status: 404 })
  })
  return calls
}

const base = { firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }

async function setup({ cap = 16_000_000 }: { cap?: number } = {}) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    await ctx.db.insert('settings', { key: 'round', ...DEFAULT_ROUND, cap })
    const inv = (name: string, stage: Doc<'investors'>['stage'], o: Partial<Doc<'investors'>> = {}) =>
      ctx.db.insert('investors', { ...base, name, stage, maxStage: stage as Doc<'investors'>['maxStage'], ...o })
    const heron = await inv('Heron Angels', 'verbal', { committed: 150_000, email: 'hello@heron.example.com' })
    await ctx.db.insert('people', { investorId: heron, name: 'Sam Heron', email: 'sam@heron.example.com', primary: true })
    return { dev, heron, wren: await inv('Wren Partners', 'm2', { expected: 125_000, email: 'deals@wren.example.com' }), alder: await inv('Alder Partners', 'verbal', { committed: 600_000 }) }
  })
  const as = t.withIdentity({ subject: `${ids.dev}|s1` })
  const closingOf = (investorId: (typeof ids)['heron']) => t.run((ctx) => ctx.db.query('closings').withIndex('by_investor', (q) => q.eq('investorId', investorId)).unique())
  const round = () => t.run(async (ctx) => (await ctx.db.query('settings').collect()).find((r) => r.key === 'round') as Doc<'settings'> & { tranche2?: { cap: number } })
  return { t, as, ...ids, closingOf, round }
}

const confirmDraft = (investorId: Id<'investors'>, now = Date.now()) => ({
  investorId, type: 'confirm' as const, to: 'sam@heron.example.com',
  ...confirmText({ investorName: 'Heron Angels', contactName: 'Sam Heron', terms: { amount: 150_000, instrument: 'post-money SAFE', cap: 16_000_000, tranche: 1 }, now, verbalToday: true, me: 'Dev' }),
})

describe('written confirmation', () => {
  it('sending it from nest@ stamps confirmationSentAt and makes the closing record from the commitment and the round', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    const calls = fakeResend()
    const { as, heron, closingOf } = await setup()
    const before = Date.now()
    const r = await as.action(api.drafts.send, confirmDraft(heron))
    expect(r.to).toBe('sam@heron.example.com')
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toMatchObject({ from: 'Dev at Pesto <nest@pestokids.com>', reply_to: 'dev@pestokids.com', subject: 'Confirming Heron Angels’ $150K in Pesto' })
    expect(String(calls[0].body.text)).toContain('This offer stands for 48 hours, until ')
    const c = (await closingOf(heron))!
    expect(c).toMatchObject({ amount: 150_000, instrument: 'post-money SAFE', cap: 16_000_000, steps: [] })
    expect(c.confirmationSentAt).toBeGreaterThanOrEqual(before)
    expect(c.tranche).toBeUndefined()
  })

  it('Copy then “I sent it” starts the clock too; Copy alone does not', async () => {
    const { as, heron, closingOf } = await setup()
    const { draftId } = await as.mutation(api.drafts.copied, { ...confirmDraft(heron), via: 'copy' })
    expect(await closingOf(heron)).toBeNull()
    await as.mutation(api.drafts.markSent, { draftId })
    expect((await closingOf(heron))!.confirmationSentAt).toBeGreaterThan(0)
  })

  it('refuses to send (before anything goes out) without a cap to state', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    const calls = fakeResend()
    const { as, heron, t } = await setup()
    await t.run(async (ctx) => {
      const row = (await ctx.db.query('settings').collect()).find((r) => r.key === 'round')!
      await ctx.db.patch(row._id, { cap: undefined })
    })
    await expect(as.action(api.drafts.send, confirmDraft(heron))).rejects.toThrow(/cap first/)
    expect(calls).toHaveLength(0)
  })

  it('is never written by Claude', async () => {
    const { as, heron } = await setup()
    await expect(as.action(api.drafts.generate, { investorId: heron, type: 'confirm' })).rejects.toThrow(/fills this one in from Close/)
  })

  it('a new commitment starts in tranche 2, at its cap, once tranche 2 is set up', async () => {
    const { as, heron, closingOf } = await setup()
    await as.mutation(api.closings.setTranche2, { cap: 20_000_000 })
    const { draftId } = await as.mutation(api.drafts.copied, { ...confirmDraft(heron), via: 'copy' })
    await as.mutation(api.drafts.markSent, { draftId })
    expect(await closingOf(heron)).toMatchObject({ tranche: 2, cap: 20_000_000 })
  })
})

describe('the close, step by step', () => {
  it('accepting needs the confirmation first; the questionnaire is tracked; saving terms keeps the kit', async () => {
    const { as, heron, closingOf } = await setup()
    const id = await as.mutation(api.closings.save, { investorId: heron, terms: { amount: 150_000, instrument: 'post-money SAFE', cap: 16_000_000, proRata: false, mfn: false } })
    await expect(as.mutation(api.closings.setKit, { id, accepted: true })).rejects.toThrow(/Send the written confirmation first/)
    const { draftId } = await as.mutation(api.drafts.copied, { ...confirmDraft(heron), via: 'copy' })
    await as.mutation(api.drafts.markSent, { draftId })
    await as.mutation(api.closings.setKit, { id, accepted: true, questionnaire: 'sent' })
    let c = (await closingOf(heron))!
    expect(c.acceptedAt).toBeGreaterThan(0)
    expect(c.questionnaire).toBe('sent')
    await as.mutation(api.closings.save, { investorId: heron, terms: { amount: 160_000, instrument: 'post-money SAFE', cap: 16_000_000, proRata: true, mfn: false }, sentAt: todayIST() })
    c = (await closingOf(heron))!
    expect(c).toMatchObject({ amount: 160_000, questionnaire: 'sent', steps: [{ key: 'sent', at: todayIST() }] })
    expect(c.acceptedAt).toBeGreaterThan(0)
    await as.mutation(api.closings.setKit, { id, questionnaire: 'received' })
    expect((await closingOf(heron))!.questionnaire).toBe('received')
    await as.mutation(api.closings.setKit, { id, questionnaire: 'none', accepted: false })
    c = (await closingOf(heron))!
    expect(c.questionnaire).toBeUndefined()
    expect(c.acceptedAt).toBeUndefined()
  })
})

describe('tranche 2', () => {
  it('needs a higher cap; moving a commitment in sets its cap; changing it moves everyone in it; it goes only when empty', async () => {
    const { as, alder, closingOf, round, t } = await setup()
    await expect(as.mutation(api.closings.setTranche2, { cap: 12_000_000 })).rejects.toThrow(/Fix the highlighted fields/)
    expect(await as.mutation(api.closings.setTranche2, { cap: 20_000_000 })).toBe(1)
    expect((await round()).tranche2).toEqual({ cap: 20_000_000 })
    const id = await as.mutation(api.closings.save, { investorId: alder, terms: { amount: 600_000, instrument: 'post-money SAFE', cap: 16_000_000, proRata: false, mfn: false } })
    await as.mutation(api.closings.setKit, { id, tranche: 2 })
    expect(await closingOf(alder)).toMatchObject({ tranche: 2, cap: 20_000_000 })
    await as.mutation(api.closings.setTranche2, { cap: 24_000_000 })
    expect((await closingOf(alder))!.cap).toBe(24_000_000)
    await expect(as.mutation(api.closings.setTranche2, { cap: null })).rejects.toThrow(/back to tranche 1 first/)
    await as.mutation(api.closings.setKit, { id, tranche: 1 })
    expect((await closingOf(alder))!.cap).toBe(16_000_000)
    expect((await closingOf(alder))!.tranche).toBeUndefined()
    await as.mutation(api.closings.setTranche2, { cap: null })
    expect((await round()).tranche2).toBeUndefined()
    const log = await t.run((ctx) => ctx.db.query('settingsLog').collect())
    expect(log.filter((l) => l.field === 'tranche2').map((l) => [l.from, l.to])).toEqual([['', '$20M post'], ['$20M post', '$24M post'], ['$24M post', '']])
  })

  it('survives saving the round in Settings, and never leaks into the round form', async () => {
    const { as, round } = await setup()
    await as.mutation(api.closings.setTranche2, { cap: 20_000_000 })
    const { round: r } = await as.query(api.settings.get, {})
    expect('tranche2' in r).toBe(false)
    await as.mutation(api.settings.update, { round: { ...r, stretch: 1_600_000 } })
    expect((await round()).tranche2).toEqual({ cap: 20_000_000 })
  })
})

describe('allocation', () => {
  it('saves what each investor gets and why, back to the suggestion with null, and Close reads it', async () => {
    const { as, wren } = await setup()
    await as.mutation(api.closings.setAllocation, { investorId: wren, gets: 70_000.4, why: '  Strategic: parent network ' })
    await as.mutation(api.closings.setAllocation, { investorId: wren, why: 'Strategic: parent network' })
    let d = await as.query(api.closings.data, {})
    expect(d.allocations).toEqual([{ investorId: wren, gets: 70_000, why: 'Strategic: parent network' }])
    await as.mutation(api.closings.setAllocation, { investorId: wren, gets: null })
    d = await as.query(api.closings.data, {})
    expect(d.allocations[0].gets).toBeUndefined()
    await expect(as.mutation(api.closings.setAllocation, { investorId: wren, gets: -1 })).rejects.toThrow(/Fix the highlighted fields/)
  })

  it('drafts one allocation email per investor to their main contact, sends nothing, and refuses to send with the SAFE link blank', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    const calls = fakeResend()
    const { as, t, heron, wren } = await setup()
    const ids = await as.mutation(api.drafts.saveMany, {
      drafts: [
        { investorId: heron, type: 'allocation', to: '', subject: 'Your allocation in Pesto: $150K', body: 'Hi Sam,\n\nYour SAFE: [SAFE link]' },
        { investorId: wren, type: 'allocation', to: '', subject: 'Your allocation in Pesto: $70K', body: 'Hi there,\n\nYour SAFE: [SAFE link]' },
      ],
    })
    const rows = await t.run((ctx) => Promise.all(ids.map((id) => ctx.db.get(id))))
    expect(rows.map((r) => [r!.type, r!.status, r!.to])).toEqual([
      ['allocation', 'draft', 'sam@heron.example.com'],
      ['allocation', 'draft', 'deals@wren.example.com'],
    ])
    await expect(as.action(api.drafts.send, { draftId: ids[0], investorId: heron, type: 'allocation', to: 'sam@heron.example.com', subject: 'Your allocation', body: 'Your SAFE: [SAFE link]' })).rejects.toThrow(/Paste the SAFE link/)
    expect(calls).toHaveLength(0)
  })

  it('goes with the investor', async () => {
    const { as, t, wren } = await setup()
    await as.mutation(api.closings.setAllocation, { investorId: wren, gets: 50_000 })
    await as.mutation(api.investors.remove, { id: wren })
    expect(await t.run((ctx) => ctx.db.query('allocations').collect())).toEqual([])
  })
})
