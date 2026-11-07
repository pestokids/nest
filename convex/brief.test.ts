// @vitest-environment edge-runtime
// PST-279: the morning brief, from fixture rows and a mocked Claude Haiku (fetch is
// faked; nothing here calls the API). Every investor and address below is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import crons from './crons'
import { costOf, HAIKU } from './lib/anthropic'
import { todayIST } from '../src/lib/dates'
import { briefStats } from '../src/lib/brief'

const modules = import.meta.glob('./**/*.ts')
const USAGE = { input_tokens: 1500, output_tokens: 120 }
const REASONS = ['They read the deck for four minutes, longest on page 6.', 'Their reply is waiting on you.', 'They asked for $93K more.']

type Body = { model: string; max_tokens: number; stream?: boolean; tools?: unknown; system: string; messages: { content: string }[] }
let claude: { bodies: Body[]; reply: () => Response }
const message = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: USAGE, stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } })

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://api.anthropic.com/v1/messages')) return new Response('{}', { status: 500 })
  claude.bodies.push(JSON.parse(String(init?.body)))
  return claude.reply()
}

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real')
  claude = { bodies: [], reply: () => message(JSON.stringify({ reasons: REASONS })) }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const base = { type: 'Angel' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, notes: '', source: '', updatedAt: 0 }
const H = 36e5

/** Since yesterday: Kite Angels and Antler India wrote back, Orchard Capital read deck v4, the Kite Angels meeting happened (notes read), 7 suggestions (4 safe). */
async function setup() {
  const t = convexTest(schema, modules)
  const now = Date.now()
  const today = todayIST(now)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const inv = (f: Partial<Doc<'investors'>> & Pick<Doc<'investors'>, 'name' | 'stage'>) =>
      ctx.db.insert('investors', { ...base, firm: f.name, nextStep: '', maxStage: f.stage as Doc<'investors'>['maxStage'], ...f })
    const kite = await inv({ name: 'Kite Angels', stage: 'm1', email: 'sam@kite.example.com', nextStep: 'Send week-8 retention', nextDate: today, expected: 50_000 })
    const antler = await inv({ name: 'Antler India', stage: 'intro', email: 'ria@antler.example.com', nextStep: 'Book a call', nextDate: today })
    const orchard = await inv({ name: 'Orchard Capital', stage: 'm2', nextStep: 'Send the data room', nextDate: today, expected: 100_000 })
    const lantern = await inv({ name: 'Lantern Ventures', stage: 'intro' })
    const thread = (threadId: string, investorIds: Id<'investors'>[], lastAt: number, lastFrom: 'us' | 'them') =>
      ctx.db.insert('emailTouches', { userId: dev, threadId, subject: 'Pesto', participants: [], lastAt, lastFrom, lastFromEmail: 'x@example.com', count: 2, link: 'https://mail.google.com/', investorIds })
    await thread('t1', [kite], now - 3 * H, 'them')
    await thread('t2', [antler], now - 20 * H, 'them')
    await thread('t3', [lantern], now - 2 * H, 'us')
    await thread('t4', [orchard], now - 30 * H, 'them')
    const deck = await ctx.db.insert('materials', { kind: 'deck', title: 'Pitch deck', createdAt: now, createdBy: dev })
    const v4 = await ctx.db.insert('materialVersions', { materialId: deck, n: 4, note: '', createdAt: now, createdBy: dev })
    await ctx.db.patch(deck, { currentVersionId: v4 })
    const options = { askEmail: true, allowDownload: false, watermark: true, notify: true, reply: true }
    const link = await ctx.db.insert('shareLinks', { token: 'a'.repeat(22), investorId: orchard, materialId: deck, versionId: 'current', options, createdBy: dev, createdAt: now - 48 * H })
    await ctx.db.insert('views', { linkId: link, sessionId: 's1', versionId: v4, startedAt: now - 2 * H, lastAt: now - 2 * H + 4 * 6e4, device: 'desktop', pages: [{ page: 1, ms: 30e3 }, { page: 6, ms: 210e3 }] })
    const met = await ctx.db.insert('meetings', { userId: dev, eventId: 'e1', title: 'Pesto × Kite Angels', start: now - 22 * H, end: now - 21 * H, people: [], investorIds: [kite] })
    const note = await ctx.db.insert('notes', { investorId: kite, meetingId: met, date: todayIST(now - 22 * H), text: 'Liked retention.' })
    await ctx.db.insert('noteReads', { noteId: note, investorId: kite, status: 'ready', auto: true, summary: ['Liked retention.'], proposals: [], costUsd: 0.02, startedAt: now - 20 * H })
    for (let i = 0; i < 7; i++)
      await ctx.db.insert('suggestions', { kind: 'missing_info', title: 'Fix ' + i, fix: 'Add a domain', patch: { op: 'domain', domain: `f${i}.example.com` }, source: 'rule', safe: i < 4, status: 'open', key: 'k' + i, createdAt: now })
    await ctx.db.insert('suggestions', { kind: 'missing_info', title: 'Old', fix: 'Done', patch: { op: 'domain', domain: 'old.example.com' }, source: 'rule', safe: true, status: 'accepted', key: 'old', createdAt: now })
    return { dev, kite, antler, orchard, lantern }
  })
  return { t, today, ...ids, as: t.withIdentity({ subject: ids.dev + '|s1' }) }
}

const briefs = (t: Awaited<ReturnType<typeof setup>>['t']) => t.run((ctx) => ctx.db.query('briefs').collect())

describe('the morning brief', () => {
  it('runs at 08:00 IST', () => {
    expect((crons as unknown as { crons: Record<string, { schedule: unknown }> }).crons['morning brief'].schedule).toMatchObject({ type: 'daily', hourUTC: 2, minuteUTC: 30 })
  })

  it('is built from the day’s data, with the right counts and names', async () => {
    const s = await setup()
    const id = await s.t.action(internal.brief.run, {})
    const b = (await s.as.query(api.brief.today, {}))!
    expect(b._id).toBe(id)
    expect(b.day).toBe(s.today)
    expect(b.since.replies.map((r) => r.name)).toEqual(['Kite Angels', 'Antler India'])
    expect(b.since.opens).toEqual([{ investorId: s.orchard, name: 'Orchard Capital', material: 'Pitch deck v4', kind: 'deck', ms: 240e3, page: 6 }])
    expect(b.since.meetings).toEqual([{ investorId: s.kite, name: 'Kite Angels', title: 'Pesto × Kite Angels', notes: 'read' }])
    expect(b.since.suggestions).toEqual({ open: 7, safe: 4 })
    expect(briefStats(b.since).map((x) => `${x.n} ${x.label}: ${x.sub}`)).toEqual([
      '2 replies: Kite Angels, Antler India',
      '1 deck opened: Orchard Capital · 4 min · p6',
      '1 meeting done: Kite Angels · notes read',
      '7 suggestions: 4 safe to accept',
    ])
  })

  it('reuses today’s moves and adds Haiku’s reasons, dropping one with a number the facts don’t have', async () => {
    const s = await setup()
    await s.t.action(internal.brief.run, {})
    const b = (await s.as.query(api.brief.today, {}))!
    expect(b.moves).toHaveLength(3)
    expect(b.moves.map((m) => m.reason)).toEqual([REASONS[0], REASONS[1], undefined])
    expect(b.moves.every((m) => m.title && m.why)).toBe(true)
    const [call] = claude.bodies
    expect(claude.bodies).toHaveLength(1)
    expect(call.model).toBe(HAIKU)
    expect(call.max_tokens).toBe(400)
    expect(call.tools).toBeUndefined()
    // Only the facts: the moves, the investors' fields and what happened since yesterday.
    const prompt = call.messages[0].content
    for (const m of b.moves) expect(prompt).toContain(m.title)
    expect(prompt).toContain('Opened Pitch deck v4 for 4 min, longest on page 6')
  })

  it('costs under a cent, and the cost is logged on the brief, in the log line and in Settings › AI', async () => {
    const s = await setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await s.t.action(internal.brief.run, {})
    const b = (await s.as.query(api.brief.today, {}))!
    const cost = costOf(USAGE, HAIKU)
    expect(b.costUsd).toBeCloseTo(cost, 12)
    expect(b.costUsd).toBeLessThan(0.01)
    expect(log.mock.calls.flat().join('\n')).toContain(`reasons=2/3 cost=$${cost.toFixed(5)}`)
    const ai = await s.as.query(api.enrich.data, {})
    expect(ai.recent[0]).toMatchObject({ kind: 'brief', moves: 3 })
    expect(ai.recent[0].costUsd).toBeCloseTo(cost, 12)
    expect(ai.month.usd).toBeCloseTo(0.02 + cost, 10)
  })

  it('is written once a day: a second run keeps the first and asks Claude nothing', async () => {
    const s = await setup()
    const first = await s.t.action(internal.brief.run, {})
    const second = await s.t.action(internal.brief.run, {})
    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(await briefs(s.t)).toHaveLength(1)
    expect(claude.bodies).toHaveLength(1)
    // Two runs racing past the check still store one.
    const again = await s.t.mutation(internal.brief.save, { day: s.today, builtAt: Date.now(), since: { replies: [], opens: [], meetings: [], suggestions: { open: 0, safe: 0 } }, moves: [], costUsd: 0 })
    expect(again).toBe(first)
    expect(await briefs(s.t)).toHaveLength(1)
  })

  it('without a key, comes anyway with Today’s own reasons and costs nothing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const s = await setup()
    await s.t.action(internal.brief.run, {})
    const b = (await s.as.query(api.brief.today, {}))!
    expect(claude.bodies).toHaveLength(0)
    expect(b.costUsd).toBe(0)
    expect(b.moves).toHaveLength(3)
    expect(b.moves.every((m) => m.reason === undefined && m.why)).toBe(true)
    expect(b.since.suggestions.open).toBe(7)
  })

  it('falls back the same way when Claude fails or answers nonsense', async () => {
    const s = await setup()
    claude.reply = () => new Response(JSON.stringify({ error: { type: 'overloaded_error' } }), { status: 529 })
    await s.t.action(internal.brief.run, {})
    expect((await s.as.query(api.brief.today, {}))!.moves.every((m) => !m.reason)).toBe(true)
    await s.t.run(async (ctx) => {
      for (const b of await ctx.db.query('briefs').collect()) await ctx.db.delete(b._id)
    })
    claude.reply = () => message('Sure! Here are some thoughts.')
    await s.t.action(internal.brief.run, {})
    expect((await s.as.query(api.brief.today, {}))!.moves.every((m) => !m.reason)).toBe(true)
  })

  it('doesn’t come with the toggle off', async () => {
    const s = await setup()
    expect((await s.as.query(api.enrich.data, {})).settings.morningBrief).toBe(true)
    await s.as.mutation(api.enrich.setAuto, { morningBrief: false })
    expect(await s.t.action(internal.brief.run, {})).toBeNull()
    expect(await briefs(s.t)).toHaveLength(0)
    expect(claude.bodies).toHaveLength(0)
  })

  it('collapses when dismissed and opens again', async () => {
    const s = await setup()
    const id = (await s.t.action(internal.brief.run, {}))!
    await s.as.mutation(api.brief.setDismissed, { id, dismissed: true })
    expect((await s.as.query(api.brief.today, {}))!.dismissedAt).toEqual(expect.any(Number))
    await s.as.mutation(api.brief.setDismissed, { id, dismissed: false })
    expect((await s.as.query(api.brief.today, {}))!.dismissedAt).toBeUndefined()
  })
})
