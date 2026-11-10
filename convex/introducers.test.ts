// @vitest-environment edge-runtime
// PST-294: introducers, the warm path migration, intro steps and the
// forwardable intro draft, against a mocked Claude and a mocked Resend (fetch is
// faked; nothing here calls either). Every person, firm and address is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { todayIST } from '../src/lib/dates'
import { addDays } from '../src/lib/today'
import { DEFAULT_OPTIONS } from '../src/lib/materials'

const modules = import.meta.glob('./**/*.ts')
const FENCE = '\x60\x60\x60'
const base = { firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'intro' as const, tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const add = (name: string, path: string, o: Record<string, unknown> = {}) => ctx.db.insert('investors', { ...base, name, path, stage: 'todo', maxStage: 'todo', ...o })
    return {
      dev,
      lantern: await add('Lantern Ventures', 'Ankur Mehta (portfolio founder)'),
      kite: await add('Kite Angels', 'ankur  MEHTA'),
      orchard: await add('Orchard Capital', 'Ria / Ankur Mehta'),
      pebble: await add('Pebble Partners', 'cold'),
      sable: await add('Sable Fund', '', { stage: 'signed', maxStage: 'signed', committed: 25000, email: 'gp@sable.example' }),
    }
  })
  const as = t.withIdentity({ subject: ids.dev + '|s1' })
  const rows = () => t.run(async (ctx) => ({ introducers: await ctx.db.query('introducers').collect(), intros: await ctx.db.query('intros').collect() }))
  return { t, as, rows, ...ids }
}

describe('migrating the old warm paths', () => {
  it('turns them into people, the same person once, and keeps the text', async () => {
    const { t, as, rows, lantern, kite, orchard } = await setup()
    expect(await as.mutation(api.introducers.migrate, {})).toEqual({ created: 2, linked: 4 })
    const { introducers, intros } = await rows()
    expect(introducers.map((p) => [p.name, p.relation, p.notes]).sort()).toEqual([['Ankur Mehta', 'founder', 'portfolio founder'], ['Ria', 'other', '']])
    const ankur = introducers.find((p) => p.name === 'Ankur Mehta')!._id
    expect(intros.filter((x) => x.introducerId === ankur).map((x) => x.investorId).sort()).toEqual([lantern, kite, orchard].sort())
    expect(intros.every((x) => Object.keys(x.steps).length === 0)).toBe(true)
    // The text stays on the investor.
    expect((await t.run((ctx) => ctx.db.get(kite)))!.path).toBe('ankur  MEHTA')
  })

  it('is idempotent: running it again changes nothing', async () => {
    const { as, rows } = await setup()
    await as.mutation(api.introducers.migrate, {})
    const before = await rows()
    expect(await as.mutation(api.introducers.migrate, {})).toEqual({ created: 0, linked: 0 })
    const after = await rows()
    expect(after.introducers.length).toBe(before.introducers.length)
    expect(after.intros.map((x) => x._id)).toEqual(before.intros.map((x) => x._id))
  })

  it('links a changed warm path to the person already there, without a second intro', async () => {
    const { t, as, rows, kite } = await setup()
    await as.mutation(api.introducers.migrate, {})
    await t.run((ctx) => ctx.db.patch(kite, { path: 'Ankur Mehta (ex-colleague)' }))
    expect(await as.mutation(api.introducers.migrate, {})).toEqual({ created: 0, linked: 1 })
    const { introducers, intros } = await rows()
    expect(introducers.length).toBe(2)
    expect(intros.filter((x) => x.investorId === kite).length).toBe(1)
  })

  it('needs a signed-in teammate', async () => {
    const { t } = await setup()
    await expect(t.mutation(api.introducers.migrate, {})).rejects.toThrow(/Not signed in/)
  })
})

describe('intro steps', () => {
  it('ticks in order with their days, and unticks the steps after', async () => {
    const { as, lantern } = await setup()
    const { id } = await as.mutation(api.introducers.add, { name: 'Mira Shah', email: 'Mira@Shah.example', relation: 'angel', notes: '' })
    const introId = await as.mutation(api.introducers.link, { investorId: lantern, introducerId: id as Id<'introducers'> })
    expect(await as.mutation(api.introducers.link, { investorId: lantern, introducerId: id as Id<'introducers'> })).toBe(introId)
    expect(await as.mutation(api.introducers.setStepDay, { introId, step: 'made', day: '2026-11-05' })).toEqual({ asked: '2026-11-05', yes: '2026-11-05', sent: '2026-11-05', made: '2026-11-05' })
    expect(await as.mutation(api.introducers.setStepDay, { introId, step: 'asked', day: '2026-11-02' })).toEqual({ asked: '2026-11-02', yes: '2026-11-05', sent: '2026-11-05', made: '2026-11-05' })
    expect(await as.mutation(api.introducers.setStepDay, { introId, step: 'sent', day: null })).toEqual({ asked: '2026-11-02', yes: '2026-11-05' })
    await expect(as.mutation(api.introducers.setStepDay, { introId, step: 'sent', day: 'Tuesday' })).rejects.toThrow(/isn’t a date/)
  })

  it('adds the same person once, and committed investors make intros without a row of their own', async () => {
    const { t, as, rows, kite, sable } = await setup()
    const a = await as.mutation(api.introducers.add, { name: 'Dana Lee', relation: 'friend', notes: '' })
    const b = await as.mutation(api.introducers.add, { name: '  dana   LEE ', email: 'dana@lee.example', relation: 'friend', notes: 'Founder friend' })
    expect(b).toEqual({ id: a.id, existed: true })
    await expect(as.mutation(api.introducers.add, { name: 'Sable Fund', relation: 'committed', notes: '' })).rejects.toThrow(/come from the investor list/)
    const introId = await as.mutation(api.introducers.link, { investorId: kite, viaInvestorId: sable })
    expect((await rows()).introducers.map((p) => [p.name, p.email, p.notes])).toEqual([['Dana Lee', 'dana@lee.example', 'Founder friend']])
    // Deleting the committed investor takes the intros they were making.
    await as.mutation(api.investors.remove, { id: sable })
    expect(await t.run((ctx) => ctx.db.get(introId))).toBeNull()
  })
})

/* ---------- the forwardable intro draft ---------- */

type Call = { url: string; body: Record<string, unknown> }
function fakeFetch(answer: Record<string, string>) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    if (url.startsWith('https://api.anthropic.com')) {
      const text = FENCE + 'json\n' + JSON.stringify(answer) + '\n' + FENCE
      return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 2500, output_tokens: 300 } }), { status: 200 })
    }
    if (url.startsWith('https://api.resend.com')) return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 })
    return new Response('{}', { status: 404 })
  })
  return calls
}

const ANSWER = {
  subject: 'Intro to Lantern Ventures?',
  body: 'Hi Ankur,\n\nWould you be up for introducing me to Lantern Ventures? Pesto has 12,000 families and grew 3x last quarter.\n\nIf yes, I’ll send a note you can forward.\n\nDev',
  forwardSubject: 'Intro request: Pesto → Lantern Ventures',
  forwardBody: 'Hi Ankur,\n\nAs promised, here’s a note you can forward to Lantern Ventures.\n\nWhat just happened: [ __ ] families joined the beta, and 41% still play weekly at week 4. We’re raising $2M at a $12M cap.\n\nDeck: [deck link]\n\nWould Lantern be up for a 30-minute call next week?\n\nDev',
}

async function forwardable() {
  const s = await setup()
  const { id } = await s.as.mutation(api.introducers.add, { name: 'Ankur Mehta', email: 'ankur@tinkerly.example', relation: 'founder', notes: 'Founder of Tinkerly' })
  const introId = await s.as.mutation(api.introducers.link, { investorId: s.lantern, introducerId: id as Id<'introducers'> })
  const deck = await s.t.run(async (ctx) => {
    const m = await ctx.db.insert('materials', { kind: 'deck', title: 'Pitch deck', createdAt: 1, createdBy: s.dev })
    const v = await ctx.db.insert('materialVersions', { materialId: m, n: 2, url: 'https://docs.google.com/presentation/d/example', note: '', createdAt: 1, createdBy: s.dev })
    await ctx.db.patch(m, { currentVersionId: v })
    return m
  })
  return { ...s, introId, deck }
}

describe('the forwardable intro', () => {
  it('writes two emails on Haiku and never lets a made-up number through', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const calls = fakeFetch(ANSWER)
    const { as, lantern, introId } = await forwardable()
    const r = await as.action(api.drafts.generate, { investorId: lantern, type: 'forwardable', introId })
    expect(calls).toHaveLength(1)
    const req = calls[0].body as { model: string; messages: { content: string }[] }
    expect(req.model).toMatch(/haiku/)
    const prompt = req.messages[0].content
    expect(prompt).toContain('Ankur Mehta (Founder): Founder of Tinkerly')
    expect(prompt).toContain('Never invent traction, terms or numbers')
    expect(prompt).toContain('write [deck link] where it goes')
    expect(r.body).toContain('Pesto has [__] families and grew [__]x last quarter.')
    expect(r.forward?.subject).toBe('Intro request: Pesto → Lantern Ventures')
    expect(r.forward?.body).toContain('[__] families joined the beta, and [__]% still play weekly at week 4.')
    expect(r.forward?.body).toContain('raising [__] at a [__] cap')
    expect(r.forward?.body).toContain('Deck: [deck link]')
    expect(r.forward?.body).toContain('a 30-minute call')
    expect(r.forward?.body).not.toMatch(/\$2M|\$12M|41%|12,000|3x/)
  })

  it('needs an introducer', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    fakeFetch(ANSWER)
    const { as, lantern } = await forwardable()
    await expect(as.action(api.drafts.generate, { investorId: lantern, type: 'forwardable' })).rejects.toThrow(/Pick who makes the intro/)
  })

  it('uses the tracked deck link Nest already has for the investor', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const calls = fakeFetch(ANSWER)
    const { t, as, dev, lantern, introId, deck } = await forwardable()
    await t.run((ctx) => ctx.db.insert('shareLinks', { token: 'AbCdEfGhIjKlMnOpQrStUv', investorId: lantern, materialId: deck, versionId: 'current', options: DEFAULT_OPTIONS, createdBy: dev, createdAt: 1 }))
    await as.action(api.drafts.generate, { investorId: lantern, type: 'forwardable', introId })
    const prompt = (calls[0].body as { messages: { content: string }[] }).messages[0].content
    expect(prompt).toContain('use their link exactly as given')
    expect(prompt).toContain('/d/AbCdEfGhIjKlMnOpQrStUv')
  })

  it('Copy both fills the deck link in the note to forward; sending the ask ticks Asked', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    const calls = fakeFetch(ANSWER)
    const { t, as, lantern, introId } = await forwardable()
    const r = await as.action(api.drafts.generate, { investorId: lantern, type: 'forwardable', introId })
    const input = { draftId: r.draftId, investorId: lantern, type: 'forwardable' as const, to: 'ankur@tinkerly.example', subject: r.subject, body: r.body.replace(/\[__\]/g, 'many'), introId, forward: r.forward }
    const c = await as.mutation(api.drafts.copied, { ...input, via: 'copy' })
    expect(c.forward?.body).toMatch(/Deck: https?:\/\/\S+\/d\/[\w-]{22}/)
    expect(c.forward?.body).toContain('[__]')
    await as.action(api.drafts.send, input)
    const email = calls.find((x) => x.url.startsWith('https://api.resend.com'))!.body as { to: string[]; reply_to: string; text: string }
    expect(email.to).toEqual(['ankur@tinkerly.example'])
    expect(email.reply_to).toBe('dev@pestokids.com')
    expect(email.text).not.toContain('As promised')
    const intro = await t.run((ctx) => ctx.db.get(introId))
    expect(intro!.steps).toEqual({ asked: todayIST() })
    // A second send of the same draft is refused; Asked keeps its day.
    await t.run((ctx) => ctx.db.patch(introId, { steps: { asked: addDays(todayIST(), -1) } }))
    await expect(as.action(api.drafts.send, input)).rejects.toThrow(/already gone/)
    expect((await t.run((ctx) => ctx.db.get(introId)))!.steps.asked).toBe(addDays(todayIST(), -1))
  })
})
