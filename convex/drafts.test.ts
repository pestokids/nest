// @vitest-environment edge-runtime
// PST-278: Drafts against a mocked Claude and a mocked Resend (fetch is faked;
// nothing here calls either). Every person, firm and address below is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { AI_MODEL, costOf, HAIKU } from './lib/anthropic'
import { DEFAULT_OPTIONS, shareUrl } from '../src/lib/materials'
import { NO_AI_KEY } from '../src/lib/enrich'
import { todayIST } from '../src/lib/dates'
import { addDays } from '../src/lib/today'

const modules = import.meta.glob('./**/*.ts')
const USAGE = { input_tokens: 3_000, output_tokens: 250 }
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv'
const FENCE = '\x60\x60\x60'

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

type Call = { url: string; body: Record<string, unknown> }
const promptOf = (c: Call) => (c.body as { messages: { content: string }[] }).messages[0].content

/** A fake fetch: Claude answers with the draft as a fenced JSON block, Resend accepts. Records every call. */
function fakeFetch(answer: { subject: string; body: string }) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    if (url.startsWith('https://api.anthropic.com')) {
      const text = 'Here it is.\n' + FENCE + 'json\n' + JSON.stringify(answer) + '\n' + FENCE
      return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: USAGE }), { status: 200 })
    }
    if (url.startsWith('https://api.resend.com')) return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 })
    return new Response('{}', { status: 404 })
  })
  return calls
}

const base = { firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }

async function setup() {
  const t = convexTest(schema, modules)
  const today = todayIST()
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const kite = await ctx.db.insert('investors', {
      ...base, name: 'Kite Angels', firm: 'Kite Angels', stage: 'm1', maxStage: 'm1', lastTouch: addDays(today, -9), email: 'hello@kite.example.com',
      nextStep: 'Send week-8 retention', path: 'Ria (angel)', domains: ['kite.example.com'],
    })
    await ctx.db.insert('people', { investorId: kite, name: 'Sam Kapoor', email: 'sam@kite.example.com', primary: true })
    await ctx.db.insert('people', { investorId: kite, name: 'Rhea Lal', email: 'rhea@kite.example.com', primary: false })
    const run = await ctx.db.insert('enrichRuns', { investorId: kite, status: 'done', steps: [], costUsd: 0.04, startedAt: 1, auto: false })
    await ctx.db.insert('facts', { runId: run, investorId: kite, group: 'fund', field: 'thesis', value: 'Consumer and kids at pre-seed', source: 'https://kite.example.com', confidence: 0.9, status: 'kept' })
    await ctx.db.insert('facts', { runId: run, investorId: kite, group: 'fund', field: 'check', value: 'About $35K', source: 'https://kite.example.com', confidence: 0.9, status: 'dismissed' })
    const note = await ctx.db.insert('notes', { investorId: kite, date: addDays(today, -1), text: 'Sam asked about week-8 retention and content safety. I said I would send retention by Monday.', createdBy: dev })
    await ctx.db.insert('noteReads', { noteId: note, investorId: kite, status: 'ready', auto: true, summary: ['Wants week-8 retention by Monday'], proposals: [], costUsd: 0.01, startedAt: 1 })
    const q = await ctx.db.insert('questions', {
      text: 'How do you keep stories safe for kids?', theme: 'Product', bestAnswer: 'Every story is written and reviewed by our content team before it ships.',
      answerVersions: [], onDeck: false, askedCount: 1, createdAt: 1, updatedAt: 1,
    })
    await ctx.db.insert('questionAsks', { questionId: q, investorId: kite, date: addDays(today, -1), source: 'notes' })
    await ctx.db.insert('emailTouches', {
      userId: dev, threadId: 't1', subject: 'Pesto: notes from Friday', participants: ['sam@kite.example.com'], lastAt: Date.now() - 864e5 * 3, lastFrom: 'us',
      lastFromEmail: 'founder@pestokids.com', count: 2, link: 'https://mail.google.com/x', investorIds: [kite],
    })
    // Ria shows up in Calendar history: the warm path to Kite.
    await ctx.db.insert('meetings', {
      userId: dev, eventId: 'e1', title: 'Coffee', start: Date.now() - 864e5 * 20, end: Date.now() - 864e5 * 20 + 36e5, people: [{ email: 'ria.menon@orbit.example.com', name: 'Ria Menon' }], investorIds: [],
    })
    const deck = await ctx.db.insert('materials', { kind: 'deck', title: 'Pitch deck', createdAt: 1, createdBy: dev })
    const v3 = await ctx.db.insert('materialVersions', { materialId: deck, n: 3, url: 'https://docs.google.com/presentation/d/example', note: 'Week-8 retention added', createdAt: 1, createdBy: dev })
    await ctx.db.patch(deck, { currentVersionId: v3 })
    const lumen = await ctx.db.insert('investors', { ...base, name: 'Lumen Fund', stage: 'verbal', maxStage: 'verbal', email: 'ops@lumen.example.com' })
    return { dev, kite, deck, lumen }
  })
  const as = t.withIdentity({ subject: ids.dev + '|s1' })
  const touches = (id: Id<'investors'>) => t.run(async (ctx) => (await ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()).filter((a) => a.touch))
  const links = () => t.run((ctx) => ctx.db.query('shareLinks').collect())
  return { t, as, today, ...ids, touches, links }
}

const ANSWER = {
  subject: 'Pesto · week-8 retention, as promised',
  body: 'Hi Sam,\n\nI hope this finds you well.\nThanks again for Friday. As promised, here’s week-8 retention: [ __ ]% of the families who started in September are still playing weekly, up from [___]% at week 4.\n\nOn your safety question: every story is written and reviewed by our content team before it ships.\n\nHappy to walk you through it this week?\n\nDev',
}

describe('writing a draft', () => {
  it('keeps the [__] placeholders, and the prompt says never invent and carries what Nest knows', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const calls = fakeFetch(ANSWER)
    const { t, as, kite } = await setup()
    const r = await as.action(api.drafts.generate, { investorId: kite, type: 'followup' })
    expect(r.body).toContain('[__]% of the families')
    expect(r.body).toContain('up from [__]% at week 4')
    expect(r.body).not.toMatch(/hope this finds you well/i)
    expect(r.subject).toBe(ANSWER.subject)
    expect(r.costUsd).toBeCloseTo(costOf(USAGE, AI_MODEL), 8)

    expect(calls).toHaveLength(1)
    const req = calls[0].body as { model: string; system: string; tools?: unknown }
    expect(req.model).toBe(HAIKU)
    expect(req.tools).toBeUndefined()
    expect(req.system).toMatch(/Never invent numbers, names or commitments/)
    expect(req.system).toContain('write [__] exactly')
    expect(req.system).toMatch(/One clear ask/)
    const prompt = promptOf(calls[0])
    expect(prompt).toContain('Thesis: Consumer and kids at pre-seed')
    expect(prompt).not.toContain('About $35K')
    expect(prompt).toContain('- Wants week-8 retention by Monday')
    expect(prompt).toContain('I said I would send retention by Monday')
    expect(prompt).toContain('Every story is written and reviewed by our content team')
    expect(prompt).toContain('Pitch deck v3 (Week-8 retention added)')
    expect(prompt).toContain('They have no link yet: write [deck link]')
    expect(prompt).toContain('Pesto: notes from Friday')

    const row = await t.run((ctx) => ctx.db.get(r.draftId))
    expect(row).toMatchObject({ investorId: kite, type: 'followup', status: 'draft', body: r.body, model: HAIKU, usage: { input: 3_000, output: 250, cacheRead: 0, cacheWrite: 0, webSearches: 0 } })

    // A tweak rewrites the same row and adds up the cost.
    const again = await as.action(api.drafts.generate, { investorId: kite, type: 'followup', draftId: r.draftId, tweak: 'shorter', current: { subject: r.subject, body: r.body } })
    expect(again.draftId).toBe(r.draftId)
    expect(again.costUsd).toBeCloseTo(2 * costOf(USAGE, AI_MODEL), 8)
    expect((await t.run((ctx) => ctx.db.get(r.draftId)))?.usage).toMatchObject({ input: 6_000, output: 500 })
    expect(promptOf(calls[1])).toMatch(/Make it shorter[\s\S]*The current draft/)
  })

  it('says AI isn’t set up without ANTHROPIC_API_KEY and calls nothing', async () => {
    const calls = fakeFetch(ANSWER)
    const { as, kite } = await setup()
    expect((await as.query(api.drafts.forInvestor, { investorId: kite }))?.aiReady).toBe(false)
    await expect(as.action(api.drafts.generate, { investorId: kite, type: 'nudge' })).rejects.toMatchObject({ data: { code: NO_AI_KEY } })
    expect(calls).toHaveLength(0)
  })
})

describe('sending', () => {
  const draft = (kite: Id<'investors'>) => ({ investorId: kite, type: 'followup' as const, to: 'Sam@Kite.example.com ', subject: 'Pesto · week-8 retention', body: 'Hi Sam,\n\nWeek-8 retention is 41%.\n\nDev' })

  it('sends from Nest and logs exactly one email touch', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    const calls = fakeFetch(ANSWER)
    const { t, as, kite, today, touches } = await setup()
    const r = await as.action(api.drafts.send, draft(kite))
    expect(r.to).toBe('sam@kite.example.com')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.resend.com/emails')
    expect(calls[0].body).toMatchObject({ from: 'Dev at Pesto <nest@pestokids.com>', reply_to: 'dev@pestokids.com', to: ['sam@kite.example.com'], subject: 'Pesto · week-8 retention' })

    const ts = await touches(kite)
    expect(ts).toHaveLength(1)
    expect(ts[0]).toMatchObject({ touch: 'email', note: 'Pesto · week-8 retention', date: today })
    expect((await t.run((ctx) => ctx.db.get(kite)))!.lastTouch).toBe(today)
    expect(await t.run((ctx) => ctx.db.get(r.draftId))).toMatchObject({ status: 'sent', via: 'nest', to: 'sam@kite.example.com' })

    // The same draft can't go twice, and ticking "I sent it" on it logs nothing more.
    await expect(as.action(api.drafts.send, { ...draft(kite), draftId: r.draftId })).rejects.toThrow(/already gone/)
    expect(await as.mutation(api.drafts.markSent, { draftId: r.draftId })).toEqual({ logged: false })
    expect(await touches(kite)).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })

  it('hides Send without RESEND_API_KEY, and refuses to send', async () => {
    const calls = fakeFetch(ANSWER)
    const { as, kite, touches } = await setup()
    expect((await as.query(api.drafts.forInvestor, { investorId: kite }))?.emailReady).toBe(false)
    await expect(as.action(api.drafts.send, draft(kite))).rejects.toThrow(/Email isn’t set up here/)
    expect(calls).toHaveLength(0)
    expect(await touches(kite)).toHaveLength(0)
  })

  it('won’t send with blanks left to fill', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test')
    const calls = fakeFetch(ANSWER)
    const { as, kite } = await setup()
    await expect(as.action(api.drafts.send, { ...draft(kite), body: 'Retention is [__]% and [__]%.' })).rejects.toThrow(/Fill in the 2 blanks/)
    expect(calls).toHaveLength(0)
  })

  it('Copy and WhatsApp log nothing until “I sent it”, which logs the one touch', async () => {
    const { as, kite, touches } = await setup()
    const c = await as.mutation(api.drafts.copied, { ...draft(kite), via: 'copy' })
    await as.mutation(api.drafts.copied, { ...draft(kite), draftId: c.draftId, via: 'whatsapp' })
    expect(await touches(kite)).toHaveLength(0)
    expect(await as.mutation(api.drafts.markSent, { draftId: c.draftId })).toEqual({ logged: true })
    expect(await as.mutation(api.drafts.markSent, { draftId: c.draftId })).toEqual({ logged: false })
    const ts = await touches(kite)
    expect(ts).toHaveLength(1)
    expect(ts[0].note).toBe('On WhatsApp: Pesto · week-8 retention')
  })
})

describe('deck links', () => {
  it('reuses the investor’s existing share link', async () => {
    const { t, as, kite, deck, dev, links } = await setup()
    await t.run((ctx) => ctx.db.insert('shareLinks', { token: TOKEN, investorId: kite, materialId: deck, versionId: 'current', options: DEFAULT_OPTIONS, createdBy: dev, createdAt: 1 }))
    expect((await as.query(api.drafts.forInvestor, { investorId: kite }))?.hasDeck).toBe(true)
    const r = await as.mutation(api.drafts.copied, { investorId: kite, type: 'followup', to: '', subject: 'Deck', body: 'Here’s the updated deck: [deck link]\n\nDev', via: 'copy' })
    expect(r.body).toBe('Here’s the updated deck: ' + shareUrl(TOKEN) + '\n\nDev')
    expect(await links()).toHaveLength(1)
  })

  it('makes one link when they have none, then reuses it; a revoked link doesn’t count', async () => {
    const { t, as, lumen, deck, dev, links } = await setup()
    await t.run((ctx) => ctx.db.insert('shareLinks', { token: TOKEN, investorId: lumen, materialId: deck, versionId: 'current', options: DEFAULT_OPTIONS, createdBy: dev, createdAt: 1, revokedAt: 2 }))
    const a = await as.mutation(api.drafts.copied, { investorId: lumen, type: 'thanks', to: '', subject: 'Thanks', body: 'Deck: [deck link]', via: 'copy' })
    const made = (await links()).filter((l) => l.revokedAt === undefined)
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ investorId: lumen, materialId: deck, versionId: 'current' })
    expect(a.body).toBe('Deck: ' + shareUrl(made[0].token))
    const b = await as.mutation(api.drafts.copied, { investorId: lumen, type: 'thanks', to: '', subject: 'Thanks', body: 'Again: [deck link]', via: 'copy' })
    expect(b.body).toBe('Again: ' + shareUrl(made[0].token))
    expect(await links()).toHaveLength(2)
  })

  it('passes an existing link to Claude as it is', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const calls = fakeFetch(ANSWER)
    const { t, as, kite, deck, dev } = await setup()
    await t.run((ctx) => ctx.db.insert('shareLinks', { token: TOKEN, investorId: kite, materialId: deck, versionId: 'current', options: DEFAULT_OPTIONS, createdBy: dev, createdAt: 1 }))
    await as.action(api.drafts.generate, { investorId: kite, type: 'followup', tweak: 'deck' })
    expect(promptOf(calls[0])).toContain('Their link: ' + shareUrl(TOKEN))
  })
})

describe('who it goes to', () => {
  it('the main contact, and the warm-path person from Calendar for an intro ask', async () => {
    const { as, kite, lumen } = await setup()
    const k = await as.query(api.drafts.forInvestor, { investorId: kite })
    expect(k?.contact).toEqual({ name: 'Sam Kapoor', email: 'sam@kite.example.com' })
    expect(k?.warm).toEqual({ name: 'Ria Menon', email: 'ria.menon@orbit.example.com' })
    const l = await as.query(api.drafts.forInvestor, { investorId: lumen })
    expect(l?.contact).toEqual({ email: 'ops@lumen.example.com' })
    expect(l?.warm).toBeNull()
  })

  it('an intro ask with no warm path writes a forwardable blurb', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
    const calls = fakeFetch(ANSWER)
    const { as, lumen } = await setup()
    await as.action(api.drafts.generate, { investorId: lumen, type: 'intro' })
    expect(promptOf(calls[0])).toMatch(/forwardable intro blurb[\s\S]*why it’s a fit in exactly two lines/)
  })
})
