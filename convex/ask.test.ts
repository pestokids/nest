// @vitest-environment edge-runtime
// PST-279: Ask Nest against a mocked Claude (fetch is faked; nothing here calls
// the API): the tool loop and its limit of six, citations, that Ask only reads,
// no key, and what it costs. Every investor and address below is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { AI_MODEL, costOf, HAIKU, OPUS, SONNET } from './lib/anthropic'
import { toolsFor } from '../src/lib/agents'
import { DONT_KNOW, MAX_TOOL_CALLS, parseAnswer } from '../src/lib/ask'
import { todayIST } from '../src/lib/dates'
import { NO_AI_KEY } from '../src/lib/enrich'

const modules = import.meta.glob('./**/*.ts')

type Ev = Record<string, unknown>
const sse = (events: Ev[]) =>
  new Response(events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
/** Each turn costs this much: 2,000 tokens in, 100 out. */
const TURN_USAGE = { input_tokens: 2000, output_tokens: 100 }
type Part = { text: string } | { tool: string; input?: Ev }

/** One streamed turn: text and tool_use blocks, the way the API sends them. */
function turn(parts: Part[]): Response {
  const events: Ev[] = [{ type: 'message_start', message: { usage: { input_tokens: TURN_USAGE.input_tokens, output_tokens: 1 } } }]
  parts.forEach((p, i) => {
    if ('text' in p)
      events.push(
        { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: p.text.slice(0, 9) } },
        { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: p.text.slice(9) } },
        { type: 'content_block_stop', index: i },
      )
    else
      events.push(
        { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `toolu_${calls()}_${i}`, name: p.tool, input: {} } },
        { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(p.input ?? {}) } },
        { type: 'content_block_stop', index: i },
      )
  })
  const stop = parts.some((p) => 'tool' in p) ? 'tool_use' : 'end_turn'
  events.push({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: TURN_USAGE.output_tokens } }, { type: 'message_stop' })
  return sse(events)
}

type Body = { model: string; stream: boolean; tools: { name: string; cache_control?: unknown }[]; tool_choice: { type: string }; system: { text: string; cache_control?: unknown }[]; messages: { role: string; content: unknown }[] }
let claude: { bodies: Body[]; reply: (body: Body, n: number) => Response }
const calls = () => claude.bodies.length

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://api.anthropic.com/v1/messages')) return new Response('{}', { status: 500 })
  const body = JSON.parse(String(init?.body)) as Body
  claude.bodies.push(body)
  return claude.reply(body, claude.bodies.length)
}

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com,sam@pestokids.com')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real')
  claude = { bodies: [], reply: () => turn([{ text: DONT_KNOW }]) }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const base = { type: 'Angel' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }
type InvFields = Partial<Omit<Doc<'investors'>, '_id' | '_creationTime'>> & Pick<Doc<'investors'>, 'name' | 'stage'>

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const sam = await ctx.db.insert('users', { email: 'sam@pestokids.com', name: 'Sam', emailVerificationTime: 1 })
    const inv = (f: InvFields) => ctx.db.insert('investors', { ...base, firm: f.name, maxStage: f.stage as Doc<'investors'>['maxStage'], ...f })
    const kite = await inv({ name: 'Kite Angels', stage: 'm1', email: 'sam@kite.example.com', expected: 50_000, nextStep: 'Send week-8 retention' })
    const orchard = await inv({ name: 'Orchard Capital', stage: 'verbal', expected: 100_000 })
    const rowan = await inv({ name: 'Rowan Operator', stage: 'signed', committed: 25_000 })
    return { dev, sam, kite, orchard, rowan }
  })
  return { t, ...ids, as: t.withIdentity({ subject: ids.dev + '|s1' }), asSam: t.withIdentity({ subject: ids.sam + '|s1' }) }
}
type S = Awaited<ReturnType<typeof setup>>

/** Run what's scheduled (the action). */
async function drain(t: S['t']) {
  vi.useFakeTimers()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
}

async function ask(s: S, question: string, model?: typeof HAIKU | typeof SONNET | typeof OPUS) {
  const id = await s.as.mutation(api.ask.start, { question, model })
  await drain(s.t)
  return { id, run: (await s.as.query(api.ask.get, { id }))! }
}

const snapshot = (s: S) =>
  s.t.run(async (ctx) => ({
    investors: await ctx.db.query('investors').collect(),
    activities: await ctx.db.query('activities').collect(),
    suggestions: await ctx.db.query('suggestions').collect(),
    enrichRuns: await ctx.db.query('enrichRuns').collect(),
    notes: await ctx.db.query('notes').collect(),
  }))

/** The tool results Claude was sent back in one request. */
const resultsIn = (b: Body) => (b.messages[b.messages.length - 1].content as { type: string; tool_use_id: string; content: string; is_error?: boolean }[]).filter((x) => x.type === 'tool_result')

describe('the tool loop', () => {
  it('loops on tool_use and stops at six tool calls, then makes Claude answer', async () => {
    const s = await setup()
    claude.reply = (b) => (b.tool_choice.type === 'none' ? turn([{ text: 'Chase [[investor:' + s.kite + '|Kite Angels]].' }]) : turn([{ tool: 'todays_moves' }]))
    const { run } = await ask(s, 'Who should I chase today?')
    expect(run.status).toBe('done')
    expect(run.tools).toEqual(Array(MAX_TOOL_CALLS).fill('todays_moves'))
    expect(claude.bodies).toHaveLength(MAX_TOOL_CALLS + 1)
    expect(claude.bodies.map((b) => b.tool_choice.type)).toEqual([...Array(MAX_TOOL_CALLS).fill('auto'), 'none'])
    expect(run.text).toBe('Chase [[investor:' + s.kite + '|Kite Angels]].')
    // Haiku (the default), streamed, with no web tools; the tools and the system prompt cached through the system prompt's mark.
    for (const b of claude.bodies) {
      expect(b.model).toBe(AI_MODEL)
      expect(b.model).toBe(HAIKU)
      expect(b.stream).toBe(true)
      expect(b.tools.some((x) => /web_/.test(x.name))).toBe(false)
      expect(b.system[0].cache_control).toEqual({ type: 'ephemeral' })
      expect(b.tools.some((x) => x.cache_control)).toBe(false)
    }
  })

  it('counts parallel calls against the six: the extra ones are refused', async () => {
    const s = await setup()
    claude.reply = (b) => (b.tool_choice.type === 'none' ? turn([{ text: DONT_KNOW }]) : turn([0, 1, 2, 3].map(() => ({ tool: 'list_questions' }))))
    const { run } = await ask(s, 'What do investors ask most?')
    expect(run.tools).toHaveLength(MAX_TOOL_CALLS)
    expect(claude.bodies).toHaveLength(3)
    const second = resultsIn(claude.bodies[2])
    expect(second.map((r) => !!r.is_error)).toEqual([false, false, true, true])
    expect(second[3].content).toMatch(/answer with what you have/)
  })

  it('still ends if Claude keeps asking after the last call', async () => {
    const s = await setup()
    claude.reply = () => turn([{ tool: 'search_investors', input: { query: 'kite' } }])
    const { run } = await ask(s, 'Tell me everything')
    expect(run.status).toBe('done')
    expect(run.tools).toHaveLength(MAX_TOOL_CALLS)
    expect(claude.bodies).toHaveLength(MAX_TOOL_CALLS + 1)
    expect(run.text).toBe(DONT_KNOW)
  })

  it('drops a turn’s preamble once it turns out to be calling tools', async () => {
    const s = await setup()
    claude.reply = (_b, n) => (n === 1 ? turn([{ text: 'Let me check Nest.' }, { tool: 'round_totals' }]) : turn([{ text: '**$100K** is verbal.' }]))
    const { run } = await ask(s, 'How much is verbal but not signed?')
    expect(run.text).toBe('**$100K** is verbal.')
  })
})

describe('answers', () => {
  it('cites investors as [[investor:id|Name]], which read as chips, with what it read', async () => {
    const s = await setup()
    claude.reply = (_b, n) =>
      n === 1
        ? turn([{ tool: 'search_investors', input: { query: 'kite' } }])
        : n === 2
          ? turn([{ tool: 'get_investor', input: { id: s.kite } }])
          : turn([{ text: `1. [[investor:${s.kite}|Kite Angels]] is waiting on week-8 retention.\n[[action:open|${s.kite}]]` }])
    const { run } = await ask(s, 'Who is waiting on me?')
    // Claude was given the ids it cites.
    expect(resultsIn(claude.bodies[1])[0].content).toContain(s.kite)
    const { blocks, actions } = parseAnswer(run.text)
    expect(blocks[0]).toMatchObject({ kind: 'ol', items: [[{ kind: 'investor', id: s.kite, name: 'Kite Angels' }, { kind: 'text' }]] })
    expect(actions).toEqual([{ kind: 'open', id: s.kite }])
    expect(run.sources).toEqual({ investors: 1, threads: 0, meetings: 0 })
  })

  it('tells Claude to cite, never to invent numbers, and to say when it doesn’t know', async () => {
    const s = await setup()
    await ask(s, 'What’s our churn?')
    const sys = claude.bodies[0].system[0].text
    expect(sys).toContain('[[investor:<id>|<name>]]')
    expect(sys).toContain(DONT_KNOW)
    expect(sys).toMatch(/Never estimate, round up or invent/)
    expect(sys).toContain(todayIST())
  })

  it('only you can read your question', async () => {
    const s = await setup()
    const { id } = await ask(s, 'Who should I chase today?')
    expect(await s.asSam.query(api.ask.get, { id })).toBeNull()
  })
})

describe('read only', () => {
  it('gives Claude the read tools only, and refuses any write it asks for', async () => {
    const s = await setup()
    const before = await snapshot(s)
    claude.reply = (_b, n) =>
      n === 1
        ? turn([
            { tool: 'log_touch', input: { investorId: s.kite, kind: 'call', date: todayIST(), note: 'Called Sam' } },
            { tool: 'suggest_change', input: { investorId: s.kite, kind: 'stage', value: 'm2', why: 'Went well' } },
            { tool: 'add_investor', input: { name: 'Larkspur', firm: 'Larkspur' } },
            { tool: 'enrich', input: { investorId: s.kite } },
            { tool: 'add_meeting_notes', input: { meetingTitle: 'Kite', date: todayIST(), text: 'Notes' } },
            { tool: 'delete_investor', input: { id: s.kite } },
          ])
        : turn([{ text: 'I can only read, so I didn’t change anything.' }])
    const { run } = await ask(s, 'Log a call with Kite and move them to 2nd meeting')
    expect(claude.bodies[0].tools.map((x) => x.name)).toEqual(toolsFor('read').map((x) => x.name))
    const results = resultsIn(claude.bodies[1])
    expect(results).toHaveLength(6)
    expect(results.every((r) => r.is_error && /Ask only reads/.test(r.content))).toBe(true)
    expect(await snapshot(s)).toEqual(before)
    expect(run.status).toBe('done')
    expect(run.tools).toEqual([])
  })

  it('reads through the MCP read handler: the same tools and answers agents get', async () => {
    const s = await setup()
    claude.reply = (_b, n) => (n === 1 ? turn([{ tool: 'round_totals' }]) : turn([{ text: 'Done.' }]))
    await ask(s, 'How much is verbal but not signed?')
    const viaAsk = JSON.parse(resultsIn(claude.bodies[1])[0].content)
    const viaMcp = await s.t.query(internal.mcp.read, { tool: 'round_totals', args: {} })
    expect(viaMcp.ok && viaMcp.data).toEqual(viaAsk)
    expect(viaAsk.verbalNotSigned).toEqual({ amount: 100_000, count: 1 })
    expect(viaAsk.signed).toMatchObject({ amount: 25_000, count: 1, investors: [{ id: s.rowan, name: 'Rowan Operator', amount: 25_000 }] })
  })
})

describe('without a key', () => {
  it('says AI isn’t set up here and asks nothing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const s = await setup()
    await expect(s.as.mutation(api.ask.start, { question: 'Who should I chase today?' })).rejects.toMatchObject({ data: { code: NO_AI_KEY } })
    expect(await s.t.run((ctx) => ctx.db.query('askRuns').collect())).toEqual([])
    expect(claude.bodies).toHaveLength(0)
    expect((await s.as.query(api.enrich.data, {})).connected).toBe(false)
  })
})

describe('costs', () => {
  it('logs what each run cost, on the run, in the log line and in Settings › AI', async () => {
    const s = await setup()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    claude.reply = (_b, n) => (n === 1 ? turn([{ tool: 'todays_moves' }]) : turn([{ text: 'Kite Angels.' }]))
    const { id, run } = await ask(s, 'Who should I chase today?')
    const cost = 2 * costOf(TURN_USAGE, AI_MODEL)
    expect(run.costUsd).toBeCloseTo(cost, 10)
    expect(run.model).toBe(HAIKU)
    // PST-273: the row keeps what the run used, both turns added up.
    const row = await s.t.run((ctx) => ctx.db.get(id))
    expect(row?.usage).toEqual({ input: 4000, output: 200, cacheRead: 0, cacheWrite: 0, webSearches: 0 })
    expect(log.mock.calls.flat().join('\n')).toMatch(new RegExp(`ask run=${id} status=done tools=todays_moves cost=\\$${cost.toFixed(4).replace('.', '\\.')}`))
    // The log line never carries the question or the answer.
    expect(log.mock.calls.flat().join('\n')).not.toMatch(/chase|Kite/)
    const ai = await s.as.query(api.enrich.data, {})
    expect(ai.month.usd).toBeCloseTo(cost, 10)
    expect(ai.month.asks).toBe(1)
    expect(ai.recent[0]).toMatchObject({ kind: 'ask', question: 'Who should I chase today?', tools: 1, status: 'done', model: HAIKU })
    expect(ai.spend.byModel[HAIKU]).toBeCloseTo(cost, 10)
    expect(ai.spend.byFeature.ask).toBeCloseTo(cost, 10)
    expect(ai.features.ask.month).toBe(1)
    expect(ai.recent[0].costUsd).toBeCloseTo(cost, 10)
    // Sam sees the run and its cost, not the question.
    const sams = await s.asSam.query(api.enrich.data, {})
    expect(sams.recent[0]).toMatchObject({ kind: 'ask', tools: 1 })
    expect(sams.recent[0].question).toBeUndefined()
  })

  it('a run that fails keeps what it had spent', async () => {
    const s = await setup()
    claude.reply = (_b, n) => (n === 1 ? turn([{ tool: 'todays_moves' }]) : new Response(JSON.stringify({ error: { type: 'overloaded_error' } }), { status: 529 }))
    const { run } = await ask(s, 'Who should I chase today?')
    expect(run.status).toBe('failed')
    expect(run.error).toBe('Claude refused the request: overloaded_error (529)')
    expect(run.costUsd).toBeCloseTo(costOf(TURN_USAGE, AI_MODEL), 10)
    expect((await s.t.run((ctx) => ctx.db.get(run._id as Id<'askRuns'>)))?.usage).toMatchObject({ input: 2000, output: 100 })
  })

  it('runs one question on the model the chip picked, then goes back to the Ask model', async () => {
    const s = await setup()
    claude.reply = () => turn([{ text: 'Kite Angels.' }])
    const once = await ask(s, 'Who should I chase today?', OPUS)
    expect(claude.bodies[0].model).toBe(OPUS)
    expect(once.run.model).toBe(OPUS)
    expect(once.run.costUsd).toBeCloseTo(costOf(TURN_USAGE, OPUS), 10)
    expect(once.run.costUsd).toBeCloseTo((2000 * 4 + 100 * 20) / 1e6, 10)
    const next = await ask(s, 'Who should I chase today?')
    expect(claude.bodies[1].model).toBe(HAIKU)
    expect(next.run.model).toBe(HAIKU)
    // Settings › AI gives Ask its own model; a question without a pick uses it.
    await s.as.mutation(api.enrich.setModel, { feature: 'ask', model: SONNET })
    const third = await ask(s, 'Who should I chase today?')
    expect(claude.bodies[2].model).toBe(SONNET)
    expect(third.run.costUsd).toBeCloseTo((2000 * 2 + 100 * 10) / 1e6, 10)
    const ai = await s.as.query(api.enrich.data, {})
    expect(ai.spend.byModel).toMatchObject({ [OPUS]: expect.closeTo(once.run.costUsd, 10), [HAIKU]: expect.closeTo(next.run.costUsd, 10), [SONNET]: expect.closeTo(third.run.costUsd, 10) })
  })
})

describe('the read helpers Ask added', () => {
  it('material_opens: who opened which version, and who was never sent it', async () => {
    const s = await setup()
    const now = Date.now()
    await s.t.run(async (ctx) => {
      const m = await ctx.db.insert('materials', { kind: 'deck', title: 'Pitch deck', createdAt: now, createdBy: s.dev })
      const v4 = await ctx.db.insert('materialVersions', { materialId: m, n: 4, note: '', createdAt: now, createdBy: s.dev })
      await ctx.db.patch(m, { currentVersionId: v4 })
      const options = { askEmail: true, allowDownload: false, watermark: true, notify: true, reply: true }
      const opened = await ctx.db.insert('shareLinks', { token: 'a'.repeat(22), investorId: s.orchard, materialId: m, versionId: 'current', options, createdBy: s.dev, createdAt: now - 864e5 })
      await ctx.db.insert('shareLinks', { token: 'b'.repeat(22), investorId: s.rowan, materialId: m, versionId: v4, options, createdBy: s.dev, createdAt: now - 864e5 })
      await ctx.db.insert('views', { linkId: opened, sessionId: 's1', versionId: v4, startedAt: now - 36e5, lastAt: now - 33e5, device: 'desktop', pages: [{ page: 1, ms: 20e3 }, { page: 6, ms: 220e3 }] })
    })
    const out = await s.t.query(internal.mcp.read, { tool: 'material_opens', args: { material: 'deck', version: 4 } })
    if (!out.ok) throw new Error(out.error)
    expect(out.data.links).toMatchObject([
      { investor: 'Orchard Capital', version: 'v4', opened: true, opens: 1, minutesRead: 4, longestPage: 6 },
      { investor: 'Rowan Operator', version: 'v4', opened: false, opens: 0 },
    ])
    expect(out.data.investorsWithoutLink).toEqual([{ id: s.kite, name: 'Kite Angels', stage: '1st meeting' }])
  })

  it('meetings_between: investor meetings in a range of IST days, with ids for the prep brief', async () => {
    const s = await setup()
    const day = todayIST()
    const at = (hhmm: string) => Date.parse(`${day}T${hhmm}:00+05:30`)
    const ids = await s.t.run(async (ctx) => {
      const m = (eventId: string, start: number, investorIds: Id<'investors'>[]) =>
        ctx.db.insert('meetings', { userId: s.dev, eventId, title: 'Pesto × ' + eventId, start, end: start + 45 * 6e4, people: [], investorIds })
      const four = await m('kite', at('16:00'), [s.kite])
      await m('kite', at('16:00'), [s.kite])
      await m('coffee', at('10:00'), [])
      await ctx.db.insert('notes', { investorId: s.kite, meetingId: four, date: day, text: 'Liked retention.' })
      return { four }
    })
    const out = await s.t.query(internal.mcp.read, { tool: 'meetings_between', args: { from: day } })
    if (!out.ok) throw new Error(out.error)
    expect(out.data.meetings).toEqual([{ id: ids.four, title: 'Pesto × kite', day, start: '16:00 IST', end: '16:45 IST', past: expect.any(Boolean), investors: [{ id: s.kite, name: 'Kite Angels' }], notesSaved: true }])
    expect(out.seen).toEqual({ meetings: [ids.four], investors: [s.kite] })
    const back = await s.t.query(internal.mcp.read, { tool: 'meetings_between', args: { from: day, to: '2020-01-01' } })
    expect(back).toEqual({ ok: false, error: 'to must be the same day as from or later.' })
  })
})
