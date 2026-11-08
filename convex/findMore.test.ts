// @vitest-environment edge-runtime
// PST-296: Find more and Jev's fit scores against a mocked Anthropic API and a
// mocked TypeSafe API (fetch is faked; nothing here calls either). A run, the 30
// cap, dedupe, what Jev reads, the Jev null fallback, the real cost in the spend
// view, adding through Suggestions, and the enrichment-hash skip. Every investor,
// company, address and link below is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { rescoreLater } from './lib/fitScores'
import { todayIST } from '../src/lib/dates'
import { fallbackScore } from '../src/lib/findMore'
import { fitScore, type FitAnswers } from '../src/lib/fitScore'
import { mergeRound } from '../src/lib/round'

const modules = import.meta.glob('./**/*.ts')

type Ev = Record<string, unknown>
const sse = (events: Ev[]) =>
  new Response(events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })

/** YYYY-MM, this many months back from today. */
const month = (back: number) => {
  const t = todayIST()
  const m = Number(t.slice(0, 4)) * 12 + Number(t.slice(5, 7)) - 1 - back
  return Math.floor(m / 12) + '-' + String((m % 12) + 1).padStart(2, '0')
}

type Inv = { name: string; firm: string | null; domain: string | null; last: string; thesis?: string }
const answerOf = (xs: Inv[]) => ({
  investors: xs.map((x) => ({
    name: x.name, firm: x.firm, type: 'Seed fund', domain: x.domain, leads: true, stage: 'Pre-seed and seed', check: '$100K', check_usd: 100_000,
    thesis: x.thesis ?? 'Kids and consumer', geography: 'India', backed: [{ company: 'Puddlejump', round: 'pre-seed', date: x.last }], deals_last_12_months: 4, last_deal: x.last,
    co_invests_with: ['Orchard Capital'], sources: [{ url: 'https://deals.example.com/' + x.name.toLowerCase().replace(/\s+/g, '-'), title: null }],
  })),
})

function findEvents(answer: unknown): Ev[] {
  const text = '```json\n' + JSON.stringify(answer) + '\n```'
  return [
    { type: 'message_start', message: { usage: { input_tokens: 40_000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_0', name: 'web_search', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"Puddlejump investors"}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3_000, server_tool_use: { web_search_requests: 3 } } },
    { type: 'message_stop' },
  ]
}

type JevBody = { model: string; state: { round: unknown; investor: { name: string } }; questions: Record<string, { type: string; criteria: string[] }> }
let claude: { calls: { tools: { type: string; max_uses?: number }[]; messages: { content: unknown }[] }[]; answer: unknown }
let jev: { calls: JevBody[]; at: Record<string, number> }

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith('https://api.anthropic.com/v1/messages')) {
    claude.calls.push(JSON.parse(String(init?.body)))
    return sse(findEvents(claude.answer))
  }
  if (url === 'https://api.typesafe.ai/v1/systemone') {
    const body = JSON.parse(String(init?.body)) as JevBody
    jev.calls.push(body)
    const answers = Object.fromEntries(Object.keys(body.questions).map((id) => [id, { type: 'score', score: jev.at[id] ?? 1, confidence: 0.6, legend: {}, probabilities: { 0: 0, 1: 1 } }]))
    return new Response(JSON.stringify({ model: 'jev-1.14.0', answers, usage: { input_tokens: 600, output_tokens: 20 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('{}', { status: 404 })
}

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real')
  vi.stubEnv('TYPESAFE_API_KEY', 'ts-test-key-not-real')
  claude = { calls: [], answer: answerOf([]) }
  jev = { calls: [], at: { stage: 2, check: 2, thesis: 3, activity: 2 } }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const base = { type: 'Seed fund' as const, geo: 'India' as const, warmth: 'warm' as const, path: 'Ria', tier: 'A' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0, stage: 'm1' as const, maxStage: 'm1' as const, expected: 100_000 }

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const orchard = await ctx.db.insert('investors', { ...base, name: 'Orchard Capital', firm: 'Orchard Capital', domains: ['orchard.example.com'] })
    const kite = await ctx.db.insert('investors', { ...base, name: 'Kite Angels', firm: 'Kite Angels', email: 'sam@kite.example.com', stage: 'todo', maxStage: 'todo' })
    await ctx.db.insert('settings', { key: 'round', ...mergeRound({ target: 1_000_000, minCheck: 25_000 }) })
    await ctx.db.insert('findSettings', { companies: ['Puddlejump', 'Storyloft'], updatedAt: 0 })
    // Dev emailed someone at Brightpath last week (a warm path).
    await ctx.db.insert('emailTouches', { userId: dev, threadId: 't1', subject: 'Hello', participants: ['tara@brightpath.example.com'], lastAt: Date.now() - 7 * 864e5, lastFrom: 'us', lastFromEmail: 'founder@pestokids.com', count: 2, link: 'https://mail.example.com/t1', investorIds: [] })
    return { dev, orchard, kite }
  })
  return { t, ...ids, as: t.withIdentity({ subject: ids.dev + '|s1' }) }
}
type S = Awaited<ReturnType<typeof setup>>

async function drain(t: S['t']) {
  vi.useFakeTimers()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
}

async function runOnce(s: S) {
  await s.as.mutation(api.findMore.start, {})
  await drain(s.t)
  return await s.as.query(api.findMore.state, {})
}

const FIVE: Inv[] = [
  { name: 'Brightpath Ventures', firm: 'Brightpath Ventures', domain: 'brightpath.example.com', last: month(1) },
  { name: 'Pinecone Capital', firm: 'Pinecone Capital', domain: 'pinecone.example.com', last: month(4), thesis: 'Edtech' },
  // Already in Nest by domain, and by name.
  { name: 'Orchard Partners', firm: 'Orchard Partners', domain: 'orchard.example.com', last: month(2) },
  { name: 'Kite Angels', firm: null, domain: null, last: month(2) },
  // Last deal 14 months ago.
  { name: 'Dusty Fund', firm: 'Dusty Fund', domain: 'dusty.example.com', last: month(14) },
]

describe('a Find more run', () => {
  it('shows the estimate first, then keeps active investors new to Nest, scored by Jev, with warm paths and sources', async () => {
    const s = await setup()
    const before = await s.as.query(api.findMore.state, {})
    expect(before.run).toBeNull()
    expect(before.companies).toEqual(['Puddlejump', 'Storyloft'])
    expect([...before.investors].sort()).toEqual(['Kite Angels', 'Orchard Capital'])
    expect(before.estimateUsd).toBeGreaterThan(0)
    expect(claude.calls).toHaveLength(0)

    claude.answer = answerOf(FIVE)
    const after = await runOnce(s)
    expect(after.run).toMatchObject({ status: 'done', inactive: 1, already: 2, found: 2 })
    expect(after.candidates.map((c) => c.name)).toEqual(['Brightpath Ventures', 'Pinecone Capital'])
    const bp = after.candidates[0]
    const expected = fitScore({ stage: { score: 2 }, check: { score: 2 }, thesis: { score: 3 }, activity: { score: 2 } } as FitAnswers).score
    expect(bp).toMatchObject({ scoredBy: 'jev', score: expected, sources: [{ url: 'https://deals.example.com/brightpath-ventures' }] })
    expect(bp.warmPath).toMatch(/^Dev emailed them in /)
    expect(after.candidates[1].warmPath).toBeUndefined()

    // Haiku got web search only, capped at about a search a seed; the prompt names the companies.
    expect(claude.calls[0].tools).toEqual([{ type: 'web_search_20260318', name: 'web_search', max_uses: 4 }])
    expect(JSON.stringify(claude.calls[0].messages)).toContain('Puddlejump')
  })

  it('takes a warm path from Introducers first, and Gmail and Calendar when no introducer knows them', async () => {
    const s = await setup()
    await s.t.run((ctx) => ctx.db.insert('introducers', { name: 'Ankur Vale', key: 'ankur vale', relation: 'friend', notes: 'Was at Pinecone Capital until 2025', createdAt: 0 }))
    claude.answer = answerOf(FIVE)
    const after = await runOnce(s)
    expect(after.candidates.map((c) => [c.name, c.warmPath])).toEqual([
      ['Brightpath Ventures', expect.stringMatching(/^Dev emailed them in /)],
      ['Pinecone Capital', 'Ankur knows them'],
    ])
  })

  it('asks Jev four Score questions per candidate with the round’s facts and no other investor’s name', async () => {
    const s = await setup()
    claude.answer = answerOf(FIVE)
    await runOnce(s)
    expect(jev.calls).toHaveLength(2)
    const call = jev.calls[0]
    expect(Object.keys(call.questions)).toEqual(['stage', 'check', 'thesis', 'activity'])
    expect(call.state.round).toMatchObject({ stage: 'Pre-seed', round_size_usd: 1_000_000, check_min_usd: 25_000, check_max_usd: 250_000 })
    const sent = JSON.stringify(call.state)
    expect(sent).not.toContain('Orchard')
    expect(sent).not.toContain('Kite')
    expect(sent).toContain(call.state.investor.name)
  })

  it('keeps at most 30 candidates a run, so at most 30 Jev calls', async () => {
    const s = await setup()
    claude.answer = answerOf(Array.from({ length: 42 }, (_, k) => ({ name: 'Fund ' + k, firm: 'Fund ' + k, domain: 'fund' + k + '.example.com', last: month(k % 6) })))
    const after = await runOnce(s)
    expect(after.candidates).toHaveLength(30)
    expect(jev.calls).toHaveLength(30)
  })

  it('falls back to Nest’s own Priority score when Jev can’t answer (null)', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '')
    const s = await setup()
    claude.answer = answerOf(FIVE)
    const after = await runOnce(s)
    expect(jev.calls).toHaveLength(0)
    expect(after.candidates).toHaveLength(2)
    expect(after.candidates.every((c) => c.scoredBy === 'nest' && c.parts === undefined)).toBe(true)
    const round = { minCheck: 25_000, target: 1_000_000 }
    for (const c of after.candidates) expect(c.score).toBe(fallbackScore(c, round, todayIST()))
  })

  it('records the real cost and shows it in the spend view under Find more', async () => {
    const s = await setup()
    claude.answer = answerOf(FIVE)
    await runOnce(s)
    const run = await s.t.run(async (ctx) => (await ctx.db.query('findRuns').collect())[0])
    // 40K in and 3K out on Haiku, plus three searches at $10 per 1,000.
    expect(run.costUsd).toBeCloseTo((40_000 * 0.1 + 3_000 * 0.5) / 1e6 + 0.03, 10)
    expect(run.usage).toMatchObject({ input: 40_000, output: 3_000, webSearches: 3 })
    const ai = await s.as.query(api.enrich.data, {})
    expect(ai.spend.byFeature.find).toBeCloseTo(run.costUsd, 10)
    expect(ai.month.usd).toBeGreaterThanOrEqual(run.costUsd)
  })

  it('refuses to start without the AI key, and never twice at once', async () => {
    const s = await setup()
    const a = await s.as.mutation(api.findMore.start, {})
    expect(await s.as.mutation(api.findMore.start, {})).toBe(a)
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    await s.t.run((ctx) => ctx.db.patch(a, { status: 'done' }))
    await expect(s.as.mutation(api.findMore.start, {})).rejects.toThrow()
  })
})

describe('adding', () => {
  it('puts candidates in Suggestions only; accepting adds them as Not contacted in Wave 2 with their Jev score', async () => {
    const s = await setup()
    claude.answer = answerOf(FIVE)
    const st = await runOnce(s)
    const before = await s.t.run((ctx) => ctx.db.query('investors').collect())
    const r = await s.as.mutation(api.findMore.add, { ids: st.candidates.map((c) => c._id as Id<'findCandidates'>), wave: 2 })
    expect(r.added).toBe(2)
    expect(await s.t.run((ctx) => ctx.db.query('investors').collect())).toHaveLength(before.length)
    expect((await s.as.query(api.findMore.state, {})).candidates).toHaveLength(0)

    const sug = (await s.as.query(api.suggestions.list, {})).find((x) => x.source === 'find_more' && x.patch.op === 'new_investor' && x.patch.name === 'Brightpath Ventures')!
    expect(sug).toMatchObject({ kind: 'new_investor', key: 'find:brightpath.example.com', patch: { wave: 2, domain: 'brightpath.example.com', type: 'Seed fund' } })
    expect(sug.fix).toBe('Add Brightpath Ventures as Not contacted in Wave 2')

    await s.as.mutation(api.suggestions.accept, { id: sug._id as Id<'suggestions'> })
    const added = (await s.t.run((ctx) => ctx.db.query('investors').collect())).find((i) => i.name === 'Brightpath Ventures')!
    expect(added).toMatchObject({ stage: 'todo', wave: 2, domains: ['brightpath.example.com'] })
    const scores = await s.as.query(api.findMore.priorityScores, {})
    expect(scores[added._id]).toBe(st.candidates[0].score)

    // A second run doesn't offer them again: one is in Nest now, the other is already suggested.
    const again = await runOnce(s)
    expect(again.candidates).toHaveLength(0)
  })
})

describe('Priority’s Jev scores', () => {
  const pending = (s: S, investorId: Id<'investors'>, group: 'fund' | 'person', field: string, value: string, amount?: number) =>
    s.t.run(async (ctx) => {
      const runId = await ctx.db.insert('enrichRuns', { investorId, status: 'done', steps: [], costUsd: 0, startedAt: 1, auto: false })
      return await ctx.db.insert('facts', { runId, investorId, group, field, value, source: 'https://orchard.example.com', confidence: 0.9, status: 'pending', ...(amount ? { amount } : {}) })
    })

  it('scores an investor when enrichment keeps a fund fact, and skips when the facts Jev reads are unchanged', async () => {
    const s = await setup()
    await s.as.mutation(api.enrich.keepFact, { factId: await pending(s, s.orchard, 'fund', 'stage', 'Pre-seed and seed') })
    await drain(s.t)
    expect(jev.calls).toHaveLength(1)
    expect(jev.calls[0].state.investor).toMatchObject({ name: 'Orchard Capital', stage: 'Pre-seed and seed' })
    expect((await s.as.query(api.findMore.priorityScores, {}))[s.orchard]).toBeGreaterThan(0)

    // Same facts: nothing scheduled, no call.
    expect(await s.t.run((ctx) => rescoreLater(ctx, s.orchard))).toBe('unchanged')
    // A person fact doesn't touch what Jev reads.
    await s.as.mutation(api.enrich.keepFact, { factId: await pending(s, s.orchard, 'person', 'title', 'Partner') })
    await drain(s.t)
    expect(jev.calls).toHaveLength(1)

    // A new check size changes the facts: one more call, and the new score.
    jev.at = { stage: 2, check: 0, thesis: 0, activity: 0 }
    await s.as.mutation(api.enrich.keepFact, { factId: await pending(s, s.orchard, 'fund', 'check', '$1M+', 1_000_000) })
    await drain(s.t)
    expect(jev.calls).toHaveLength(2)
    expect((await s.as.query(api.findMore.priorityScores, {}))[s.orchard]).toBe(30)
  })

  it('without Jev keeps no score, so Priority stays as it was', async () => {
    vi.stubEnv('TYPESAFE_API_KEY', '')
    const s = await setup()
    await s.as.mutation(api.enrich.keepFact, { factId: await pending(s, s.orchard, 'fund', 'stage', 'Pre-seed') })
    await drain(s.t)
    expect(await s.t.run((ctx) => rescoreLater(ctx, s.orchard))).toBe('off')
    expect(await s.as.query(api.findMore.priorityScores, {})).toEqual({})
    // The action itself gives up quietly on a null from Jev.
    await s.t.action(internal.findMore.scorePriority, { investorId: s.orchard })
    expect(await s.as.query(api.findMore.priorityScores, {})).toEqual({})
  })
})
