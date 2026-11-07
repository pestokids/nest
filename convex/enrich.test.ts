// @vitest-environment edge-runtime
// PST-274: investor enrichment against a mocked Anthropic API (fetch is faked; nothing here calls Claude).
// Every person, firm and address below is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { autoLookup, DAILY_AUTO_CAP } from './lib/enrichQueue'
import { costOf, NoAIKey, PRICES, research } from './lib/anthropic'
import { cardState, NO_AI_KEY } from '../src/lib/enrich'

const modules = import.meta.glob('./**/*.ts')
const D = 864e5

/* ---------- a fake Claude ---------- */

const F = (value: string, source: string, confidence = 0.9) => ({ value, source, confidence })
const ANSWER = {
  verdict: 'investor',
  summary: 'Partner at Kite Angels, an angel syndicate.',
  person: {
    name: F('Sam Okoye', 'https://www.linkedin.com/in/sam-okoye-example'),
    title: F('Partner, leads consumer deals', 'https://kite.example.com/team'),
    rank: F('Partner', 'https://kite.example.com/team'),
    covers: F('Kids, consumer, creator tools', 'https://kite.example.com/team'),
    location: F('Bengaluru', 'https://kite.example.com/team', 0.1),
    email: null,
    linkedin: F('linkedin.com/in/sam-okoye-example', 'https://www.linkedin.com/in/sam-okoye-example'),
    x: F('@samokoye', 'no source'),
  },
  fund: {
    name: F('Kite Angels', 'https://kite.example.com'),
    website: F('https://kite.example.com', 'https://kite.example.com'),
    domain: F('kite.example.com', 'https://kite.example.com'),
    type: F('Angel', 'https://kite.example.com'),
    size: { ...F('$12M across two syndicate funds', 'https://news.example.com/kite'), amount: 12_000_000 },
    vintage: null,
    stage: F('Pre-seed and seed', 'https://kite.example.com'),
    check: { ...F('$25K–$50K, about $35K', 'https://kite.example.com/faq'), amount: 35_000 },
    leads: F('Sometimes, in rounds under $500K', 'https://kite.example.com/faq'),
    geography: F('India and the US', 'https://kite.example.com'),
    thesis: F('Consumer and kids at pre-seed', 'https://kite.example.com'),
    recentDeals: F('Tinkerly (Aug), Little Lit (Jun)', 'https://deals.example.com/kite'),
  },
  partners: [
    { name: 'Rhea Lal', title: 'Principal', rank: 'principal', covers: 'edtech, does first calls', linkedin: null, source: 'https://kite.example.com/team', confidence: 0.8 },
    { name: 'No Source', title: null, rank: null, covers: null, linkedin: null, source: 'somewhere', confidence: 0.9 },
  ],
}
/** Facts ANSWER should become: the low-confidence location, the unsourced X and the unsourced partner are dropped. */
const EXPECTED_FACTS = 17
const USAGE = { input_tokens: 12_000, output_tokens: 2_000, cache_read_input_tokens: 4_000, server_tool_use: { web_search_requests: 3, web_fetch_requests: 2 } }

type Ev = Record<string, unknown>
const sse = (events: Ev[]) =>
  new Response(events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })

function answerEvents(answer: unknown, opts: { stop?: string; usage?: Ev } = {}): Ev[] {
  const text = (i: number, t: string): Ev[] => [
    { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } },
    // Split mid-line, the way a stream does.
    { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: t.slice(0, 7) } },
    { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: t.slice(7) } },
    { type: 'content_block_stop', index: i },
  ]
  const tool = (i: number, name: string, input: Ev): Ev[] => [
    { type: 'content_block_start', index: i, content_block: { type: 'server_tool_use', id: 'srvtoolu_' + i, name, input: {} } },
    { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
    { type: 'content_block_stop', index: i },
  ]
  return [
    { type: 'message_start', message: { usage: { input_tokens: USAGE.input_tokens, cache_read_input_tokens: USAGE.cache_read_input_tokens, output_tokens: 1 } } },
    ...tool(0, 'web_search', { query: 'Kite Angels partners' }),
    ...text(1, 'STEP 1 | Sam Okoye is a partner at Kite Angels | https://www.linkedin.com/in/x\n'),
    ...tool(2, 'web_fetch', { url: 'https://kite.example.com' }),
    ...text(3, 'STEP 2 | Angel syndicate, about $12M deployed | kite.example.com\nSTEP 3 | Tinkerly, Little Lit | deals.example.com\n'),
    ...text(4, 'STEP 4 | $25K–$50K, leads sometimes | kite.example.com\nSTEP 5 | Two more partners | -\n\n' + '```json\n' + JSON.stringify(answer) + '\n```'),
    { type: 'message_delta', delta: { stop_reason: opts.stop ?? 'end_turn' }, usage: opts.usage ?? { output_tokens: USAGE.output_tokens, server_tool_use: USAGE.server_tool_use } },
    { type: 'message_stop' },
  ]
}

let claude: { calls: { headers: Record<string, string>; body: { model: string; tools: { type: string }[]; messages: { role: string; content: unknown }[]; system: string } }[]; reply: () => Response; onCall?: () => Promise<void> }

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://api.anthropic.com/v1/messages')) return new Response('{}', { status: 500 })
  claude.calls.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) })
  await claude.onCall?.()
  return claude.reply()
}

/* ---------- setup ---------- */

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real')
  claude = { calls: [], reply: () => sse(answerEvents(ANSWER)) }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const base = { firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'intro' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0, stage: 'booked' as const, maxStage: 'booked' as const }
const fields = { name: '', firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'intro' as const, path: '', tier: 'B' as const, wave: 1 as const, stage: 'todo' as const, lead: false, nextStep: '', notes: '', source: '' }

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const kite = await ctx.db.insert('investors', { ...base, name: 'Kite Angels', firm: 'Kite Angels', email: 'sam@kite.example.com', notes: 'Likes consumer and kids.' })
    const typed = await ctx.db.insert('investors', { ...base, name: 'Kite Angels II', firm: 'Kite Angels', email: 'sam@kite.example.com', expected: 50_000 })
    return { dev, kite, typed }
  })
  return { t, ...ids, asDev: t.withIdentity({ subject: ids.dev + '|s1' }) }
}
type T = Awaited<ReturnType<typeof setup>>['t']

/** Run every scheduled function (queued runs and the ones they start). */
async function drain(t: T) {
  vi.useFakeTimers()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
}

const runsOf = (t: T) => t.run((ctx) => ctx.db.query('enrichRuns').collect())

/* ---------- tests ---------- */

describe('enrich', () => {
  it('asks Claude with web search, writes the steps as they land, and stores the facts as pending with their sources', async () => {
    const { t, asDev, kite } = await setup()
    const runId = await asDev.mutation(api.enrich.enrich, { investorId: kite })
    expect((await t.run((ctx) => ctx.db.get(runId)))?.status).toBe('running')
    await drain(t)

    const call = claude.calls[0]
    expect(call.headers['x-api-key']).toBe('test-key-not-real')
    expect(call.headers['anthropic-version']).toBeTruthy()
    expect(call.body.model).toBe('claude-sonnet-5-5')
    expect(call.body.tools.map((x) => x.type)).toEqual(['web_search_20260318', 'web_fetch_20260318'])
    expect(call.body.system).toContain('"additionalProperties":false')
    expect(String(call.body.messages[0].content)).toContain('Kite Angels')

    const { run, facts, people } = await asDev.query(api.enrich.forInvestor, { investorId: kite })
    expect(run?.status).toBe('done')
    expect(run?.steps.map((s) => [s.state, s.label, s.source])).toEqual([
      ['done', 'Sam Okoye is a partner at Kite Angels', 'linkedin.com'],
      ['done', 'Angel syndicate, about $12M deployed', 'kite.example.com'],
      ['done', 'Tinkerly, Little Lit', 'deals.example.com'],
      ['done', '$25K–$50K, leads sometimes', 'kite.example.com'],
      ['done', 'Two more partners', undefined],
    ])
    expect(run?.costUsd).toBeCloseTo(costOf(USAGE), 6)
    expect(run?.factCount).toBe(EXPECTED_FACTS)
    expect(facts).toHaveLength(EXPECTED_FACTS)
    expect(facts.every((f) => f.status === 'pending' && /^https:\/\//.test(f.source))).toBe(true)
    expect(facts.find((f) => f.field === 'rank')?.value).toBe('partner')
    expect(facts.find((f) => f.field === 'location')).toBeUndefined()
    expect(facts.find((f) => f.field === 'x')).toBeUndefined()
    expect(facts.filter((f) => f.field === 'partner').map((f) => f.person?.name)).toEqual(['Rhea Lal'])
    expect(people).toEqual([])
    // Nothing reached the investor yet.
    expect((await t.run((ctx) => ctx.db.get(kite)))?.expected).toBeUndefined()
  })

  it('carries on a turn the API paused, and adds up both requests', async () => {
    const { t, asDev, kite } = await setup()
    const replies = [
      sse([
        { type: 'message_start', message: { usage: { input_tokens: 5000, output_tokens: 1 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_a', name: 'web_search', input: {} } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"Kite"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'pause_turn' }, usage: { output_tokens: 100, server_tool_use: { web_search_requests: 1 } } },
      ]),
      sse(answerEvents(ANSWER)),
    ]
    claude.reply = () => replies.shift()!
    await asDev.mutation(api.enrich.enrich, { investorId: kite })
    await drain(t)
    expect(claude.calls).toHaveLength(2)
    const resumed = claude.calls[1].body.messages
    expect(resumed[1]).toMatchObject({ role: 'assistant', content: [{ type: 'server_tool_use', input: { query: 'Kite' } }] })
    const { run } = await asDev.query(api.enrich.forInvestor, { investorId: kite })
    expect(run?.costUsd).toBeCloseTo(costOf({ ...USAGE, input_tokens: USAGE.input_tokens + 5000, output_tokens: USAGE.output_tokens + 100, server_tool_use: { web_search_requests: 4 } }), 6)
  })

  it('keeps a fact into an empty field, and never overwrites a value Dev typed (a clash note instead)', async () => {
    const { t, asDev, kite, typed } = await setup()
    await asDev.mutation(api.enrich.enrich, { investorId: kite })
    await asDev.mutation(api.enrich.enrich, { investorId: typed })
    await drain(t)

    const check = (await asDev.query(api.enrich.forInvestor, { investorId: kite })).facts.find((f) => f.field === 'check')!
    expect(check.clash).toBeUndefined()
    expect(await asDev.mutation(api.enrich.keepFact, { factId: check._id })).toBeNull()
    expect((await t.run((ctx) => ctx.db.get(kite)))?.expected).toBe(35_000)

    const clash = (await asDev.query(api.enrich.forInvestor, { investorId: typed })).facts.find((f) => f.field === 'check')!
    expect(clash.clash).toBe('You wrote $50K as Expected. Keeping this won’t change it.')
    await asDev.mutation(api.enrich.keepFact, { factId: clash._id })
    expect((await t.run((ctx) => ctx.db.get(typed)))?.expected).toBe(50_000)
    expect((await t.run((ctx) => ctx.db.get(clash._id)))?.status).toBe('kept')

    // Person facts go to People; a partner becomes another person.
    const { facts } = await asDev.query(api.enrich.forInvestor, { investorId: kite })
    for (const k of ['title', 'rank', 'partner']) await asDev.mutation(api.enrich.keepFact, { factId: facts.find((f) => f.field === k)!._id })
    const { people } = await asDev.query(api.enrich.forInvestor, { investorId: kite })
    expect(people.map((p) => [p.name, p.title, p.rank, p.primary])).toEqual([
      ['Sam Okoye', 'Partner, leads consumer deals', 'partner', true],
      ['Rhea Lal', 'Principal', 'principal', false],
    ])
  })

  it('queues one review in Suggestions while facts wait, and takes it away once they are all decided', async () => {
    const { t, asDev, kite } = await setup()
    const runId = await asDev.mutation(api.enrich.enrich, { investorId: kite })
    await drain(t)
    const reviews = () => t.run((ctx) => ctx.db.query('suggestions').withIndex('by_key', (q) => q.eq('key', 'enrich:' + runId)).collect())
    expect(await reviews()).toMatchObject([{ kind: 'enrichment', source: 'enrich', investorId: kite, status: 'open', safe: false, patch: { op: 'review' }, title: 'Nest found ' + EXPECTED_FACTS + ' things about Kite Angels.' }])
    const [first, ...rest] = (await asDev.query(api.enrich.forInvestor, { investorId: kite })).facts
    await asDev.mutation(api.enrich.dismissFact, { factId: first._id })
    expect(await reviews()).toHaveLength(1)
    expect(await asDev.mutation(api.enrich.keepAll, { runId })).toBe(rest.length)
    expect(await reviews()).toEqual([])
    // Undo brings a fact back, and the review with it.
    await asDev.mutation(api.enrich.undoDismiss, { factId: first._id })
    expect(await reviews()).toHaveLength(1)
  })

  it('keeps everything at once, writing only the empty fields', async () => {
    const { t, asDev, kite } = await setup()
    const runId = await asDev.mutation(api.enrich.enrich, { investorId: kite })
    await drain(t)
    expect(await asDev.mutation(api.enrich.keepAll, { runId })).toBe(EXPECTED_FACTS)
    const inv = await t.run((ctx) => ctx.db.get(kite))
    expect(inv).toMatchObject({ expected: 35_000, domains: ['kite.example.com'], email: 'sam@kite.example.com', type: 'Angel', geo: 'Global' })
  })

  it('dismisses a fact, which never comes back on a refresh, and Undo brings it back', async () => {
    const { t, asDev, kite } = await setup()
    await asDev.mutation(api.enrich.enrich, { investorId: kite })
    await drain(t)
    const deals = (await asDev.query(api.enrich.forInvestor, { investorId: kite })).facts.find((f) => f.field === 'recentDeals')!
    await asDev.mutation(api.enrich.dismissFact, { factId: deals._id })
    expect((await asDev.query(api.enrich.forInvestor, { investorId: kite })).facts.some((f) => f.field === 'recentDeals')).toBe(false)

    await asDev.mutation(api.enrich.enrich, { investorId: kite })
    await drain(t)
    const after = await asDev.query(api.enrich.forInvestor, { investorId: kite })
    expect(after.facts.some((f) => f.field === 'recentDeals')).toBe(false)
    expect(after.facts).toHaveLength(EXPECTED_FACTS - 1)

    await asDev.mutation(api.enrich.undoDismiss, { factId: deals._id })
    expect((await t.run((ctx) => ctx.db.get(deals._id)))?.status).toBe('pending')

    const rest = (await asDev.query(api.enrich.forInvestor, { investorId: kite })).run!
    expect(await asDev.mutation(api.enrich.dismissAll, { runId: rest._id })).toBe(EXPECTED_FACTS - 1)
  })

  it('stops a run: nothing found is stored and the slot frees up', async () => {
    const { t, asDev, kite } = await setup()
    const runId = await asDev.mutation(api.enrich.enrich, { investorId: kite })
    claude.onCall = async () => {
      await t.run((ctx) => ctx.db.patch(runId, { status: 'stopped', finishedAt: Date.now() }))
    }
    await drain(t)
    const { run, facts } = await asDev.query(api.enrich.forInvestor, { investorId: kite })
    expect(run?.status).toBe('stopped')
    expect(facts).toEqual([])
  })
})

describe('automatic lookups', () => {
  const today = () => Date.now()

  it('enriches a new investor when it is added, up to the daily cap', async () => {
    const { t, asDev } = await setup()
    const first = await asDev.mutation(api.investors.upsert, { fields: { ...fields, name: 'Juniper Seed', email: 'ana@juniper.example.com' } })
    expect((await runsOf(t)).filter((r) => r.investorId === first)).toMatchObject([{ auto: true, status: 'running' }])

    await t.run(async (ctx) => {
      for (let i = 0; i < DAILY_AUTO_CAP; i++) await ctx.db.insert('enrichRuns', { email: 'x' + i + '@cap.example.com', auto: true, status: 'done', steps: [], costUsd: 0.03, startedAt: today() })
    })
    const second = await asDev.mutation(api.investors.upsert, { fields: { ...fields, name: 'Bluebird Seed', email: 'kai@bluebird.example.com' } })
    expect((await runsOf(t)).filter((r) => r.investorId === second)).toEqual([])

    // Turned off in Settings: nothing.
    await asDev.mutation(api.enrich.setAuto, { enrichNew: false })
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query('enrichRuns').collect()) if (r.email?.endsWith('@cap.example.com')) await ctx.db.delete(r._id)
    })
    const third = await asDev.mutation(api.investors.upsert, { fields: { ...fields, name: 'Morrow Ventures', email: 'lee@morrow.example.com' } })
    expect((await runsOf(t)).filter((r) => r.investorId === third)).toEqual([])
    await drain(t)
  })

  it('reuses a lookup of the same email from the last 30 days instead of asking again', async () => {
    const { t, asDev, kite } = await setup()
    await asDev.mutation(api.enrich.enrich, { investorId: kite })
    await drain(t)
    const calls = claude.calls.length

    const twin = await asDev.mutation(api.investors.upsert, { fields: { ...fields, name: 'Sam at Kite', email: 'sam@kite.example.com' } })
    await drain(t)
    expect(claude.calls.length).toBe(calls)
    const { run, facts } = await asDev.query(api.enrich.forInvestor, { investorId: twin })
    expect(run).toMatchObject({ cached: true, status: 'done', costUsd: 0 })
    expect(facts).toHaveLength(EXPECTED_FACTS)
    expect(facts.every((f) => f.status === 'pending')).toBe(true)

    // Older than 30 days: looked up again.
    await t.run(async (ctx) => {
      for (const r of await ctx.db.query('enrichRuns').collect()) await ctx.db.patch(r._id, { startedAt: Date.now() - 31 * D })
    })
    const late = await asDev.mutation(api.investors.upsert, { fields: { ...fields, name: 'Sam again', email: 'sam@kite.example.com' } })
    const fresh = (await runsOf(t)).find((r) => r.investorId === late)
    expect(fresh?.status).toBe('running')
    expect(fresh?.cached).toBeUndefined()
    await drain(t)
  })

  it('looks up a new person in Who’s this? once, and never our own people', async () => {
    const { t, asDev, dev } = await setup()
    const meeting = { eventId: 'e1', title: 'Intro call', start: Date.now() + 36e5, end: Date.now() + 72e5, people: [{ email: 'rowan@larkspur.example.com', name: 'Rowan Hale' }, { email: 'teammate@pestokids.com' }] }
    await t.mutation(internal.google.upsertMeetings, { userId: dev, self: 'founder@pestokids.com', items: [meeting], drops: [] })
    await t.mutation(internal.google.upsertMeetings, { userId: dev, self: 'founder@pestokids.com', items: [{ ...meeting, eventId: 'e2' }], drops: [] })
    const runs = await runsOf(t)
    expect(runs.map((r) => [r.email, r.auto, r.investorId])).toEqual([['rowan@larkspur.example.com', true, undefined]])
    await drain(t)
    const data = await asDev.query(api.enrich.data, {})
    expect(data.senders.map((s) => [s.email, s.run.status, s.run.verdict, s.facts.length])).toEqual([['rowan@larkspur.example.com', 'done', 'investor', EXPECTED_FACTS]])
    expect(String(claude.calls[0].body.messages[0].content)).toContain('Intro call')

    await asDev.mutation(api.enrich.setAuto, { lookups: false })
    await t.run((ctx) => autoLookup(ctx, ['mina@fieldnote.example.com']))
    expect((await runsOf(t)).some((r) => r.email === 'mina@fieldnote.example.com')).toBe(false)
  })

  it('adds a looked-up sender as an investor, with their facts waiting in its drawer', async () => {
    const { t, asDev } = await setup()
    await asDev.mutation(api.enrich.lookupSender, { email: 'rowan@larkspur.example.com' })
    await drain(t)
    const id = await asDev.mutation(api.enrich.addSender, { email: 'rowan@larkspur.example.com' })
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ name: 'Kite Angels', firm: 'Kite Angels', email: 'rowan@larkspur.example.com', source: 'Who’s this?' })
    const { facts, people } = await asDev.query(api.enrich.forInvestor, { investorId: id })
    expect(facts).toHaveLength(EXPECTED_FACTS)
    expect(people.map((p) => [p.name, p.email, p.primary])).toEqual([['Sam Okoye', 'rowan@larkspur.example.com', true]])
    expect((await asDev.query(api.enrich.data, {})).senders).toEqual([])
  })
})

describe('missing key', () => {
  it('raises NoAIKey from the client, refuses to start, and a run records it so the UI shows the not-set-up state', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    await expect(research({ system: 's', prompt: 'p' })).rejects.toBeInstanceOf(NoAIKey)
    expect(claude.calls).toEqual([])

    const { t, asDev, kite } = await setup()
    await expect(asDev.mutation(api.enrich.enrich, { investorId: kite })).rejects.toMatchObject({ data: { code: NO_AI_KEY } })
    // A run that was already queued when the key went away.
    const runId = await t.run((ctx) =>
      ctx.db.insert('enrichRuns', { investorId: kite, auto: false, status: 'running', steps: [{ label: 'Who they are', state: 'running' }], costUsd: 0, startedAt: Date.now() }),
    )
    await t.action(internal.enrich.execute, { runId })
    const { run } = await asDev.query(api.enrich.forInvestor, { investorId: kite })
    expect(run).toMatchObject({ status: 'failed', error: NO_AI_KEY })
    expect((await asDev.query(api.enrich.data, {})).connected).toBe(false)
    expect(cardState({ connected: false, run, pending: 0, kept: 0 })).toBe('nokey')
    expect(cardState({ connected: true, run, pending: 0, kept: 0 })).toBe('nokey')
    // New investors aren't queued for a lookup that can't run.
    await asDev.mutation(api.investors.upsert, { fields: { ...fields, name: 'Juniper Seed' } })
    expect((await runsOf(t)).length).toBe(1)
  })
})

describe('cost', () => {
  it('prices tokens, cache reads and writes, and web searches (fetches are free)', () => {
    const p = PRICES['claude-sonnet-5-5']
    expect(costOf(USAGE)).toBeCloseTo((12_000 * p.input + 2_000 * p.output + 4_000 * p.cacheRead) / 1e6 + 3 * 0.01, 10)
    expect(costOf(USAGE)).toBeCloseTo(0.024 + 0.02 + 0.0004 + 0.03, 10)
    expect(costOf({ cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(2.5, 10)
    expect(costOf({ cache_creation: { ephemeral_1h_input_tokens: 1_000_000 }, cache_creation_input_tokens: 1_000_000 })).toBeCloseTo(4, 10)
    expect(costOf({ server_tool_use: { web_fetch_requests: 10 } })).toBe(0)
  })

  it('sums this month’s runs for Settings', async () => {
    const { t, asDev } = await setup()
    await t.run(async (ctx) => {
      await ctx.db.insert('enrichRuns', { email: 'a@x.example.com', auto: true, status: 'done', steps: [], costUsd: 0.03, startedAt: Date.now() })
      await ctx.db.insert('enrichRuns', { email: 'b@x.example.com', auto: false, status: 'done', steps: [], costUsd: 0.04, startedAt: Date.now() })
      await ctx.db.insert('enrichRuns', { email: 'c@x.example.com', auto: false, status: 'done', steps: [], costUsd: 9, startedAt: Date.now() - 40 * D })
    })
    expect((await asDev.query(api.enrich.data, {})).month).toMatchObject({ usd: expect.closeTo(0.07, 10), lookups: 2 })
  })
})

describe('enrichMany', () => {
  it('queues every investor and runs at most two at once', async () => {
    const { t, asDev } = await setup()
    const ids: Id<'investors'>[] = await t.run(async (ctx) =>
      Promise.all(['Orchard', 'Lantern', 'Juniper', 'Saltmarsh'].map((n) => ctx.db.insert('investors', { ...base, name: n + ' Capital' }))),
    )
    let most = 0
    claude.onCall = async () => {
      const running = await t.run((ctx) => ctx.db.query('enrichRuns').withIndex('by_status', (q) => q.eq('status', 'running')).collect())
      most = Math.max(most, running.length)
    }
    const runIds = await asDev.mutation(api.enrich.enrichMany, { ids })
    expect(runIds).toHaveLength(4)
    const statuses = (await runsOf(t)).map((r) => r.status).sort()
    expect(statuses).toEqual(['queued', 'queued', 'running', 'running'])
    await drain(t)
    expect((await runsOf(t)).map((r) => r.status)).toEqual(['done', 'done', 'done', 'done'])
    expect(claude.calls).toHaveLength(4)
    expect(most).toBeGreaterThan(0)
    expect(most).toBeLessThanOrEqual(2)
    // A second click while they run doesn't queue them twice.
    expect(await asDev.mutation(api.enrich.enrichMany, { ids })).toHaveLength(4)
  })
})
