// @vitest-environment edge-runtime
// PST-307: the Advisor against a mocked Claude (fetch is faked; nothing here calls
// the API): the tool loop and streaming, Stop, the cap, each block tool's checks,
// drafts that are never sent, suggestions deduped, memory kept only on Yes, the
// decide-by suggestion and its Undo, and the chat list. Every investor is made up.
// PST-308: an answer's words and blocks kept in the order Claude wrote them.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { costOf, OPUS, SONNET } from './lib/anthropic'
import { ADVISOR_SYSTEM, BLOCKS_GUARD, NUMBERS_GUARD, WEB_SEARCH } from './lib/advisor'
import { ADVISOR_CAP } from './advisor'
import { MAX_TOOL_CALLS } from '../src/lib/advisor'
import { todayIST } from '../src/lib/dates'
import { planStep } from '../src/lib/advisorBlocks'
import { fieldsOf } from '../src/lib/pipeline'

const modules = import.meta.glob('./**/*.ts')

type Ev = Record<string, unknown>
const sse = (events: Ev[]) =>
  new Response(events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
const TURN_USAGE = { input_tokens: 2000, output_tokens: 100 }
type Part = { text: string } | { tool: string; input?: Ev } | { search: { url: string; title: string }[] }

let n = 0
/** One streamed turn the way the API sends it: text, tool_use, and a web search with its results. */
function turn(parts: Part[], searches = 0): Response {
  const events: Ev[] = [{ type: 'message_start', message: { usage: { input_tokens: TURN_USAGE.input_tokens, output_tokens: 1 } } }]
  parts.forEach((p, i) => {
    if ('text' in p)
      events.push(
        { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: p.text.slice(0, 7) } },
        { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: p.text.slice(7) } },
        { type: 'content_block_stop', index: i },
      )
    else if ('tool' in p)
      events.push(
        { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: 'toolu_' + ++n, name: p.tool, input: {} } },
        { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(p.input ?? {}) } },
        { type: 'content_block_stop', index: i },
      )
    else
      events.push(
        { type: 'content_block_start', index: i, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_' + ++n, content: p.search.map((r) => ({ type: 'web_search_result', ...r })) } },
        { type: 'content_block_stop', index: i },
      )
  })
  const stop = parts.some((p) => 'tool' in p) ? 'tool_use' : 'end_turn'
  events.push({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: TURN_USAGE.output_tokens, server_tool_use: { web_search_requests: searches } } }, { type: 'message_stop' })
  return sse(events)
}

type Body = {
  model: string; max_tokens: number; thinking?: { type: string }; tools: { name: string; type?: string; cache_control?: unknown }[]; tool_choice: { type: string }
  system: { text: string; cache_control?: unknown }[]; messages: { role: string; content: unknown }[]
}
let claude: { bodies: Body[]; reply: (body: Body, n: number) => Response | Promise<Response> }

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://api.anthropic.com/v1/messages')) return new Response('{}', { status: 500 })
  if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  const body = JSON.parse(String(init?.body)) as Body
  claude.bodies.push(body)
  return await claude.reply(body, claude.bodies.length)
}

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com,sam@pestokids.com')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real')
  claude = { bodies: [], reply: () => turn([{ text: 'Lead with the firms that can lead.' }]) }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const base = { type: 'Seed fund' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'A' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }
type InvFields = Partial<Omit<Doc<'investors'>, '_id' | '_creationTime'>> & Pick<Doc<'investors'>, 'name' | 'stage'>

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const sam = await ctx.db.insert('users', { email: 'sam@pestokids.com', name: 'Sam', emailVerificationTime: 1 })
    const inv = (f: InvFields) => ctx.db.insert('investors', { ...base, firm: f.name, maxStage: f.stage as Doc<'investors'>['maxStage'], ...f })
    const lantern = await inv({ name: 'Lantern Ventures', stage: 'm1', email: 'pat@lantern.example.com' })
    const juniper = await inv({ name: 'Juniper Seed', stage: 'm2' })
    await ctx.db.insert('notes', { investorId: juniper, date: '2026-11-10', text: 'Liked the retention story; wants the cohort chart.' })
    return { dev, sam, lantern, juniper }
  })
  return { t, ...ids, as: t.withIdentity({ subject: ids.dev + '|s1' }), asSam: t.withIdentity({ subject: ids.sam + '|s1' }) }
}
type S = Awaited<ReturnType<typeof setup>>

async function drain(t: S['t']) {
  vi.useFakeTimers()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
}

async function send(s: S, text: string, o: { chatId?: Id<'advisorChats'>; mode?: 'coach' | 'storyteller'; model?: typeof SONNET | typeof OPUS } = {}) {
  const r = await s.as.mutation(api.advisor.send, { text, mode: o.mode ?? 'coach', ...(o.chatId ? { chatId: o.chatId } : {}), ...(o.model ? { model: o.model } : {}) })
  await drain(s.t)
  const c = (await s.as.query(api.advisor.chat, { chatId: r.chatId }))!
  return { ...r, chat: c.chat, answer: c.messages.find((m) => m._id === r.messageId)! }
}

const resultsIn = (b: Body) => (b.messages[b.messages.length - 1].content as { type: string; content: string; is_error?: boolean }[]).filter((x) => x.type === 'tool_result')

describe('the tool loop and streaming', () => {
  it('reads with the tools, drops the preamble, streams the answer into the row, and records the real cost', async () => {
    const s = await setup()
    const streamed: string[] = []
    claude.reply = async (_b, k) => {
      if (k === 3) streamed.push(...(await s.t.run(async (ctx) => (await ctx.db.query('advisorMessages').collect()).map((m) => m.text))))
      return k === 1
        ? turn([{ text: 'Let me look.' }, { tool: 'get_investor', input: { id: s.lantern } }, { tool: 'investor_detail', input: { id: s.juniper } }])
        : k === 2
          ? turn([{ text: 'Lead with [[investor:' + s.lantern + '|Lantern Ventures]].' }, { tool: 'show_follow_ups', input: { questions: ['What if Lantern says no?', 'Who else could lead?', 'Draft the Juniper note'] } }])
          : turn([{ text: 'Then Juniper on Friday.' }])
    }
    const { answer, chat } = await send(s, 'Kickoff week starts Wednesday. Who should I put first?')
    expect(answer.status).toBe('done')
    expect(answer.text).toBe('Lead with [[investor:' + s.lantern + '|Lantern Ventures]].\n\nThen Juniper on Friday.')
    // The kept turn's text was in the row before the last turn ran: it streamed.
    expect(streamed.some((x) => x.startsWith('Lead with'))).toBe(true)
    expect(answer.text).not.toContain('Let me look')
    expect(answer.sources.map((x) => x.label)).toEqual(['Lantern · enrichment', 'Juniper · notes 10 Nov'])
    expect(answer.blocks).toEqual([{ kind: 'follow_ups', questions: ['What if Lantern says no?', 'Who else could lead?', 'Draft the Juniper note'] }])
    const one = costOf({ ...TURN_USAGE, server_tool_use: { web_search_requests: 0 } }, SONNET)
    expect(answer.costUsd).toBeCloseTo(one * 3, 8)
    expect(chat.totalCostUsd).toBeCloseTo(one * 3, 8)
    expect(chat).toMatchObject({ title: 'Kickoff week starts Wednesday. Who should I put first?', model: SONNET, messageCount: 2 })
  })

  it('runs on Sonnet thinking between tools, with the tools and the system prompt cached, and web search when it’s on', async () => {
    const s = await setup()
    await send(s, 'What do seed funds want to see?')
    const b = claude.bodies[0]
    expect(b.model).toBe(SONNET)
    expect(b.thinking).toEqual({ type: 'between_tools' })
    expect(b.system[0].text).toBe(ADVISOR_SYSTEM)
    expect(b.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(b.system[1].cache_control).toBeUndefined()
    expect(b.system[1].text).toContain('Mode: Coach')
    expect(b.tools[b.tools.length - 1]).toMatchObject({ ...WEB_SEARCH, cache_control: { type: 'ephemeral' } })
    expect(b.tools.filter((x) => x.cache_control)).toHaveLength(1)
    await s.as.mutation(api.advisor.setSettings, { web: false })
    await send(s, 'And now?')
    expect(claude.bodies[1].tools.some((x) => x.type?.startsWith('web_search'))).toBe(false)
  })

  it('Opus always thinks, so thinking is left unset; Ask Opus instead re-runs one answer on Opus and keeps the chat on Sonnet', async () => {
    const s = await setup()
    const { messageId, chatId } = await send(s, 'Tighten my story for Lantern', { mode: 'storyteller' })
    await s.as.mutation(api.advisor.regenerate, { messageId, model: OPUS })
    await drain(s.t)
    expect(claude.bodies[1].model).toBe(OPUS)
    expect(claude.bodies[1].thinking).toBeUndefined()
    expect(claude.bodies[1].system[1].text).toContain('Mode: Storyteller')
    const c = (await s.as.query(api.advisor.chat, { chatId }))!
    expect(c.chat.model).toBe(SONNET)
    expect(c.messages.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(c.messages[1]).toMatchObject({ model: OPUS, status: 'done' })
  })

  it('sends the chat so far, and Dev can edit the last message', async () => {
    const s = await setup()
    const first = await send(s, 'Who is ahead?')
    await send(s, 'And who is behind?', { chatId: first.chatId })
    expect(claude.bodies[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    await s.as.mutation(api.advisor.editLast, { chatId: first.chatId, text: 'And who is furthest behind?' })
    await drain(s.t)
    const c = (await s.as.query(api.advisor.chat, { chatId: first.chatId }))!
    expect(c.messages.map((m) => m.text)).toEqual(['Who is ahead?', 'Lead with the firms that can lead.', 'And who is furthest behind?', 'Lead with the firms that can lead.'])
    expect(claude.bodies[2].messages[2].content).toBe('And who is furthest behind?')
  })

  it('Stop keeps what it wrote and ends the run', async () => {
    const s = await setup()
    claude.reply = async (_b, k) => {
      if (k === 2) await s.t.run(async (ctx) => {
        for (const m of await ctx.db.query('advisorMessages').collect()) if (m.status === 'streaming') await ctx.db.patch(m._id, { status: 'stopped' })
      })
      return k === 1 ? turn([{ text: 'Open with the bedtime moment.' }, { tool: 'show_follow_ups', input: { questions: ['a?', 'b?', 'c?'] } }]) : turn([{ text: 'More.' }, { tool: 'show_follow_ups', input: { questions: ['d?', 'e?', 'f?'] } }])
    }
    const { answer } = await send(s, 'How do I open the Lantern meeting?')
    expect(answer.status).toBe('stopped')
    expect(answer.text).toBe('Open with the bedtime moment.')
    expect(claude.bodies.length).toBeLessThanOrEqual(2)
  })

  it('stops calling tools after the limit and answers with what it has', async () => {
    const s = await setup()
    claude.reply = (b) => (b.tool_choice.type === 'none' ? turn([{ text: 'Here’s what I have.' }]) : turn([{ tool: 'round_plan' }]))
    const { answer } = await send(s, 'Tell me everything')
    expect(claude.bodies).toHaveLength(MAX_TOOL_CALLS + 1)
    expect(answer.text).toBe('Here’s what I have.')
  })

  it('shows web pages it used as sources, and counts web searches in the cost', async () => {
    const s = await setup()
    claude.reply = () => turn([{ search: [{ url: 'https://example.com/a', title: 'A fund page' }, { url: 'https://example.com/b', title: 'B' }] }, { text: 'They led two seed rounds (from the web).' }], 2)
    const { answer } = await send(s, 'What has Lantern backed?')
    expect(answer.sources.filter((x) => x.kind === 'web').map((x) => x.url)).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(answer.costUsd).toBeCloseTo(costOf({ ...TURN_USAGE, server_tool_use: { web_search_requests: 2 } }, SONNET), 8)
  })

  it('only you can read your chats', async () => {
    const s = await setup()
    const { chatId } = await send(s, 'Who is ahead?')
    expect(await s.asSam.query(api.advisor.chat, { chatId })).toBeNull()
    expect(await s.asSam.query(api.advisor.chats, {})).toEqual([])
    await expect(s.t.query(api.advisor.chats, {})).rejects.toThrow(/Not signed in/)
  })
})

describe('the monthly cap', () => {
  it('refuses to start a run that would go over, with the way to Settings, and starts nothing', async () => {
    const s = await setup()
    await s.as.mutation(api.advisor.setSettings, { capUsd: 0.01 })
    const err = await s.as.mutation(api.advisor.send, { text: 'Plan my week', mode: 'coach' }).catch((e) => e)
    expect(err.data).toMatchObject({ code: ADVISOR_CAP })
    expect(err.data.message).toMatch(/Settings › AI › Advisor/)
    expect(claude.bodies).toHaveLength(0)
    expect(await s.t.run((ctx) => ctx.db.query('advisorMessages').collect())).toEqual([])
  })

  it('counts this month’s answers against the cap, and answers with what it has when the cap is near', async () => {
    const s = await setup()
    const one = costOf(TURN_USAGE, SONNET)
    expect(one).toBeCloseTo(0.005, 8)
    // The estimate (about 2¢ with web search off) fits under a 3¢ cap, so it starts.
    await s.as.mutation(api.advisor.setSettings, { capUsd: 0.03, web: false })
    claude.reply = (b) => (b.tool_choice.type === 'none' ? turn([{ text: 'Short answer.' }]) : turn([{ tool: 'round_plan' }]))
    const { answer } = await send(s, 'Plan my week')
    // At 0.5¢ a turn, another lookup and the answer after it must both fit: five lookups, then the answer.
    expect(claude.bodies.map((b) => b.tool_choice.type)).toEqual(['auto', 'auto', 'auto', 'auto', 'auto', 'none'])
    expect(answer.text).toBe('Short answer.')
    expect(answer.costUsd).toBeCloseTo(one * 6, 8)
    expect(answer.costUsd).toBeLessThanOrEqual(0.03 + 1e-9)
    const o = await s.as.query(api.advisor.overview, {})
    expect(o.monthUsd).toBeCloseTo(one * 6, 8)
    const err = await s.as.mutation(api.advisor.send, { text: 'Again', mode: 'coach' }).catch((e) => e)
    expect(err.data.code).toBe(ADVISOR_CAP)
  })

  it('takes a cap between $0 and $500, and defaults to Sonnet, $20 and web on', async () => {
    const s = await setup()
    expect((await s.as.query(api.advisor.overview, {})).settings).toEqual({ model: SONNET, capUsd: 20, web: true })
    await expect(s.as.mutation(api.advisor.setSettings, { capUsd: -1 })).rejects.toThrow(/between/)
    await expect(s.as.mutation(api.advisor.setSettings, { model: 'claude-haiku-5-5' })).rejects.toThrow(/Sonnet or Opus/)
    expect(await s.as.mutation(api.advisor.setSettings, { capUsd: 35.555, model: OPUS })).toEqual({ model: OPUS, capUsd: 35.56, web: true })
  })
})

describe('blocks', () => {
  const answerWith = async (s: S, calls: Part[]) => {
    claude.reply = (_b, k) => (k === 1 ? turn(calls) : turn([{ text: 'Done.' }]))
    return await send(s, 'Show me')
  }

  it('checks every show tool’s input and stores the block it draws', async () => {
    const s = await setup()
    const { answer } = await answerWith(s, [
      { tool: 'show_investor_card', input: { investorId: s.lantern, note: 'Can lead · 1st meeting Wed' } },
      { tool: 'show_plan', input: { title: 'Kickoff week', items: [{ text: 'Book Lantern’s partner slot', date: '2026-11-19', investorId: s.lantern }] } },
      { tool: 'show_options', input: { options: [{ label: 'Slow Juniper down', upside: 'Two offers possible', risk: 'Juniper cools off' }, { label: 'Take the offer', upside: 'A lead in hand', risk: 'No leverage' }] } },
      { tool: 'show_race', input: { note: 'Juniper is a stage ahead' } },
      { tool: 'show_story', input: { beats: [{ label: 'Hook', text: 'Every night, [__] kids ask for the same story.' }, { label: 'Ask', text: '$1.2M to reach [__] families.' }] } },
      { tool: 'show_blank', input: { label: 'Week-8 retention', unit: '%' } },
      { tool: 'show_follow_ups', input: { questions: ['What if Lantern says no?', 'Who else could lead?', 'Make it 30 seconds'] } },
    ])
    expect(answer.blocks.map((b) => b.kind)).toEqual(['investor_card', 'plan', 'options', 'race', 'story', 'blank', 'follow_ups'])
    expect(answer.blocks[1]).toMatchObject({ ticked: [] })
    expect(answer.blocks[4]).toMatchObject({ beats: [{ label: 'HOOK' }, { label: 'ASK' }] })
    expect(resultsIn(claude.bodies[1]).every((r) => !r.is_error)).toBe(true)
  })

  it('refuses a bad block with an error Claude can act on, and an investor that doesn’t exist', async () => {
    const s = await setup()
    const { answer } = await answerWith(s, [
      { tool: 'show_options', input: { options: [{ label: 'Only one', upside: 'x', risk: 'y' }] } },
      { tool: 'show_plan', input: { items: [{ text: 'Book it', date: 'Friday' }] } },
      { tool: 'show_investor_card', input: { investorId: 'k57notreal' } },
      { tool: 'show_follow_ups', input: { questions: ['One?'], extra: true } },
    ])
    const r = resultsIn(claude.bodies[1])
    expect(r.every((x) => x.is_error)).toBe(true)
    expect(r.map((x) => x.content)).toEqual([
      'options needs at least 2', 'date must be a date like 2026-11-20', 'There’s no investor with id k57notreal. Use search_investors to find the right one.', 'there’s no argument called “extra”',
    ])
    expect(answer.blocks).toEqual([])
  })

  it('an email draft lands in Drafts as a draft and is never sent; a Q&A draft waits for Save', async () => {
    const s = await setup()
    const sent = vi.fn()
    vi.stubEnv('RESEND_API_KEY', '')
    const { answer } = await answerWith(s, [
      { tool: 'create_draft', input: { kind: 'email', title: 'Reschedule note to Juniper', investorId: s.juniper, subject: 'Friday instead?', body: 'Hi, could we move the partner meeting to Friday?' } },
      { tool: 'create_draft', input: { kind: 'qa', title: 'Lantern open', question: 'Why now?', body: 'Voice models made a personal story cost under [__].' } },
    ])
    const drafts = await s.t.run((ctx) => ctx.db.query('drafts').collect())
    expect(drafts).toHaveLength(1)
    expect(drafts[0]).toMatchObject({ investorId: s.juniper, type: 'followup', subject: 'Friday instead?', status: 'draft' })
    expect(drafts[0].sentAt).toBeUndefined()
    expect(answer.blocks[0]).toMatchObject({ kind: 'draft', draftKind: 'email', draftId: drafts[0]._id })
    expect(answer.blocks[1]).toMatchObject({ kind: 'draft', draftKind: 'qa', question: 'Why now?' })
    expect(await s.t.run((ctx) => ctx.db.query('questions').collect())).toEqual([])
    expect(resultsIn(claude.bodies[1])[0].content).toMatch(/Nothing was sent/)
    expect(sent).not.toHaveBeenCalled()
  })

  it('Save puts a Q&A draft or a story into Q&A as its best answer, once', async () => {
    const s = await setup()
    const { messageId } = await answerWith(s, [
      { tool: 'create_draft', input: { kind: 'qa', title: 'Why now', question: 'Why now?', body: 'Voice models made a personal story cheap enough to give away.' } },
      { tool: 'create_draft', input: { kind: 'story', title: 'Lantern open', body: 'Every night, [__] kids ask for the same story again.' } },
      { tool: 'create_draft', input: { kind: 'email', title: 'Note to Juniper', investorId: s.juniper, body: 'Hi.' } },
    ])
    const id = await s.as.mutation(api.advisor.saveToQanda, { messageId, index: 0 })
    expect(await s.as.mutation(api.advisor.saveToQanda, { messageId, index: 0 })).toBe(id)
    await s.as.mutation(api.advisor.saveToQanda, { messageId, index: 1 })
    const qs = await s.t.run((ctx) => ctx.db.query('questions').collect())
    expect(qs.map((q) => [q.text, q.bestAnswer])).toEqual([
      ['Why now?', 'Voice models made a personal story cheap enough to give away.'],
      ['Lantern open', 'Every night, [__] kids ask for the same story again.'],
    ])
    expect(qs[0].answerVersions).toHaveLength(1)
    await expect(s.as.mutation(api.advisor.saveToQanda, { messageId, index: 2 })).rejects.toThrow(/Only an answer or a story/)
    const c = (await s.as.query(api.advisor.chat, { chatId: (await s.t.run((ctx) => ctx.db.get(messageId)))!.chatId }))!
    expect(c.messages.at(-1)!.blocks[0]).toMatchObject({ questionId: id })
  })

  it('Move on an investor card only suggests the move', async () => {
    const s = await setup()
    const { messageId } = await answerWith(s, [{ tool: 'show_investor_card', input: { investorId: s.lantern, note: 'Can lead' } }])
    const out = await s.as.mutation(api.advisor.suggestMove, { messageId, index: 0, stage: 'm2' })
    expect(out.added).toBe(true)
    expect((await s.t.run((ctx) => ctx.db.get(s.lantern)))!.stage).toBe('m1')
    const rows = await s.t.run((ctx) => ctx.db.query('suggestions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ agentName: 'Advisor', investorId: s.lantern })
    await expect(s.asSam.mutation(api.advisor.suggestMove, { messageId, index: 0, stage: 'm2' })).rejects.toThrow()
  })

  it('a suggested change becomes a Suggestion only when Dev sends it, deduped like an agent’s', async () => {
    const s = await setup()
    const { answer, messageId } = await answerWith(s, [
      { tool: 'suggest_change', input: { investorId: s.juniper, kind: 'decide_by', date: '2026-11-20', why: 'Keeps both offers in the same week.' } },
      { tool: 'suggest_change', input: { investorId: s.juniper, kind: 'decide_by', date: '2026-11-20', why: 'Again.' } },
      { tool: 'suggest_change', input: { investorId: s.lantern, kind: 'stage', value: 'nope', why: 'x' } },
    ])
    expect(resultsIn(claude.bodies[1])[2]).toMatchObject({ is_error: true })
    expect(answer.blocks.map((b) => b.kind === 'suggestion' && b.state)).toEqual(['proposed', 'proposed'])
    expect(await s.t.run((ctx) => ctx.db.query('suggestions').collect())).toEqual([])
    const first = await s.as.mutation(api.advisor.sendSuggestion, { messageId, index: 0 })
    expect(first.added).toBe(true)
    const second = await s.as.mutation(api.advisor.sendSuggestion, { messageId, index: 1 })
    expect(second).toMatchObject({ added: false })
    expect(second.message).toMatch(/already waiting/)
    const rows = await s.t.run((ctx) => ctx.db.query('suggestions').collect())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'decide_by', source: 'agent', agentName: 'Advisor', safe: false, patch: { op: 'decide_by', date: '2026-11-20' } })
    // Accepting sets the decide-by date as Dev's own; Undo puts it back.
    await s.as.mutation(api.suggestions.accept, { id: rows[0]._id })
    expect(await s.t.run((ctx) => ctx.db.query('decisions').collect())).toMatchObject([{ investorId: s.juniper, decideBy: '2026-11-20', decideByManual: true }])
    await s.as.mutation(api.suggestions.undo, { ids: [rows[0]._id] })
    expect(await s.t.run((ctx) => ctx.db.query('decisions').collect())).toEqual([])
    const c = (await s.as.query(api.advisor.chat, { chatId: answer.chatId }))!
    expect(c.messages[1].blocks.map((b) => b.kind === 'suggestion' && b.state)).toEqual(['sent', 'not_added'])
  })

  it('remembers a fact only when Dev says Yes', async () => {
    const s = await setup()
    const { messageId } = await answerWith(s, [{ tool: 'remember', input: { fact: 'Dev prefers a call before sending the deck.' } }, { tool: 'remember', input: { fact: 'Dev likes long emails.' } }])
    expect(await s.t.run((ctx) => ctx.db.query('advisorMemory').collect())).toEqual([])
    await s.as.mutation(api.advisor.answerMemory, { messageId, index: 1, yes: false })
    expect(await s.t.run((ctx) => ctx.db.query('advisorMemory').collect())).toEqual([])
    await s.as.mutation(api.advisor.answerMemory, { messageId, index: 0, yes: true })
    const kept = await s.as.query(api.advisor.memory, {})
    expect(kept.map((m) => m.fact)).toEqual(['Dev prefers a call before sending the deck.'])
    // The next question carries it, and Settings can edit and delete it.
    await send(s, 'Next?')
    expect(claude.bodies[claude.bodies.length - 1].system[1].text).toContain('Dev prefers a call before sending the deck.')
    await s.as.mutation(api.advisor.editMemory, { id: kept[0]._id, fact: 'Dev prefers a call first.' })
    const gone = await s.as.mutation(api.advisor.deleteMemory, { id: kept[0]._id })
    expect(await s.as.query(api.advisor.memory, {})).toEqual([])
    await s.as.mutation(api.advisor.restoreMemory, gone!)
    expect((await s.as.query(api.advisor.memory, {})).map((m) => m.fact)).toEqual(['Dev prefers a call first.'])
  })

  it('a blank saved to Plan is a Suggestion; accepting keeps the number for the Advisor', async () => {
    const s = await setup()
    const { messageId } = await answerWith(s, [{ tool: 'show_blank', input: { label: 'Week-8 retention', unit: '%' } }])
    const out = await s.as.mutation(api.advisor.blankToPlan, { messageId, index: 0, value: '42' })
    expect(out.added).toBe(true)
    const [row] = await s.t.run((ctx) => ctx.db.query('suggestions').collect())
    expect(row).toMatchObject({ kind: 'plan_number', patch: { op: 'plan_number', label: 'Week-8 retention', value: '42 %' } })
    expect(await s.t.run((ctx) => ctx.db.query('advisorMemory').collect())).toEqual([])
    await s.as.mutation(api.suggestions.accept, { id: row._id })
    expect((await s.as.query(api.advisor.memory, {})).map((m) => m.fact)).toEqual(['Week-8 retention: 42 %'])
  })

  it('keeps Dev’s edits to a block, but never lets an edit change its kind or skip Yes', async () => {
    const s = await setup()
    const { messageId } = await answerWith(s, [
      { tool: 'show_plan', input: { items: [{ text: 'Book Lantern’s partner slot', date: '2026-11-19', investorId: s.lantern }] } },
      { tool: 'remember', input: { fact: 'A fact' } },
    ])
    await s.as.mutation(api.advisor.updateBlock, { messageId, index: 0, block: { kind: 'plan', items: [{ text: 'Book Lantern’s partner slot', date: '2026-11-19', investorId: s.lantern }], ticked: [0] } })
    await expect(s.as.mutation(api.advisor.updateBlock, { messageId, index: 0, block: { kind: 'follow_ups', questions: ['a', 'b', 'c'] } })).rejects.toThrow(/something else/)
    await expect(s.as.mutation(api.advisor.updateBlock, { messageId, index: 1, block: { kind: 'memory', fact: 'A fact', state: 'saved' } })).rejects.toThrow(/own buttons/)
    await expect(s.asSam.mutation(api.advisor.updateBlock, { messageId, index: 0, block: { kind: 'plan', items: [], ticked: [] } })).rejects.toThrow(/deleted/)
  })
})

describe('the plan tick: a dated next step through the normal mutation, with Undo', () => {
  it('sets the step and date with investors.upsert, and Undo puts the old ones back', async () => {
    const s = await setup()
    const inv = (await s.t.run((ctx) => ctx.db.get(s.lantern)))!
    const { set, undo } = planStep(inv, { text: 'Book Lantern’s partner slot', date: '2026-11-19' })
    const fields = { ...fieldsOf(inv), ...set }
    await s.as.mutation(api.investors.upsert, { id: s.lantern, fields })
    expect(await s.t.run((ctx) => ctx.db.get(s.lantern))).toMatchObject({ nextStep: 'Book Lantern’s partner slot', nextDate: '2026-11-19' })
    await s.as.mutation(api.investors.upsert, { id: s.lantern, fields: { ...fieldsOf(inv), ...undo } })
    const back = (await s.t.run((ctx) => ctx.db.get(s.lantern)))!
    expect(back.nextStep).toBe('')
    expect(back.nextDate).toBeUndefined()
  })
})

describe('the chat list', () => {
  it('rename, pin, model and delete with Undo', async () => {
    const s = await setup()
    const { chatId } = await send(s, 'Who is ahead?')
    await s.as.mutation(api.advisor.rename, { chatId, title: '  Lead strategy   for kickoff week ' })
    await s.as.mutation(api.advisor.setPinned, { chatId, pinned: true })
    await s.as.mutation(api.advisor.setModel, { chatId, model: OPUS })
    expect((await s.as.query(api.advisor.chats, {}))[0]).toMatchObject({ title: 'Lead strategy for kickoff week', pinned: true, model: OPUS, messageCount: 2 })
    await s.as.mutation(api.advisor.remove, { chatId })
    expect(await s.as.query(api.advisor.chats, {})).toEqual([])
    expect(await s.as.query(api.advisor.chat, { chatId })).toBeNull()
    await s.as.mutation(api.advisor.restore, { chatId })
    expect(await s.as.query(api.advisor.chats, {})).toHaveLength(1)
  })

  it('refuses a second question while an answer is still streaming', async () => {
    const s = await setup()
    const { chatId } = await s.as.mutation(api.advisor.send, { text: 'One', mode: 'coach' })
    await expect(s.as.mutation(api.advisor.send, { chatId, text: 'Two', mode: 'coach' })).rejects.toThrow(/Stop/)
    await drain(s.t)
  })

  it('no key: says AI isn’t set up, and starts nothing', async () => {
    const s = await setup()
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    const err = await s.as.mutation(api.advisor.send, { text: 'One', mode: 'coach' }).catch((e) => e)
    expect(err.data).toMatchObject({ code: 'NoAIKey' })
  })
})

describe('the prompt', () => {
  it('holds the rules, the guard on numbers, and no facts about the company', () => {
    expect(ADVISOR_SYSTEM).toContain(NUMBERS_GUARD)
    expect(NUMBERS_GUARD).toContain('Never invent a number')
    expect(NUMBERS_GUARD).toContain('[__]')
    expect(ADVISOR_SYSTEM).toMatch(/at most one clarifying question/)
    expect(ADVISOR_SYSTEM).toMatch(/plain words/)
    expect(ADVISOR_SYSTEM).toContain('[[investor:<id>|<name>]]')
    expect(ADVISOR_SYSTEM).toMatch(/never send, change/)
    expect(ADVISOR_SYSTEM).not.toMatch(/pesto|kids|bedtime|\$\d/i)
  })

  it('PST-308: asks for a lead-in before each block, and for naming the block instead of "above" or "below"', () => {
    expect(ADVISOR_SYSTEM).toContain(BLOCKS_GUARD)
    expect(BLOCKS_GUARD).toMatch(/Before each block, write a one- or two-line lead-in that says why it's there/)
    expect(BLOCKS_GUARD).toContain('Never refer to "above" or "below". Name the block instead')
    expect(BLOCKS_GUARD).toContain('in the order you write them')
  })

  it('tells Claude the date and what the ⌘J panel was looking at', async () => {
    const s = await setup()
    await s.as.mutation(api.advisor.send, { text: 'Should I slow Juniper down?', mode: 'coach', screen: { path: '/raise/pipeline', view: 'race' } })
    await drain(s.t)
    const ctx = claude.bodies[0].system[1].text
    expect(ctx).toContain(todayIST())
    expect(ctx).toContain('Pipeline › Race')
  })
})


/* ---------- PST-308: words and blocks in the order written ---------- */

describe('parts: words and blocks in the order Claude wrote them', () => {
  const plan = (s: S) => ({ tool: 'show_plan', input: { title: 'Today', items: [{ text: 'Ask Lantern what they’d need to lead', date: '2026-11-19', investorId: s.lantern }] } })
  const follow = { tool: 'show_follow_ups', input: { questions: ['Draft the ask', 'Who should I drop?', 'What if Juniper offers first?'] } }
  const options = { tool: 'show_options', input: { options: [{ label: 'Ask for a week', upside: 'Lantern catches up', risk: 'Juniper cools off' }, { label: 'Take it', upside: 'A lead in hand', risk: 'Less room' }] } }
  const partsNow = (s: S) => s.t.run(async (ctx) => (await ctx.db.query('advisorMessages').collect()).find((m) => m.role === 'assistant')?.parts)

  it('keeps a block between the words before it and the words after it, across turns, and streams the later words below it', async () => {
    const s = await setup()
    let midway: unknown
    claude.reply = async (_b, k) => {
      if (k === 2) midway = await partsNow(s)
      return k === 1 ? turn([{ text: 'In the plan, tick what you’ll do today.' }, plan(s)]) : k === 2 ? turn([{ text: 'Do Lantern first.' }, follow]) : turn([{ text: 'Good luck.' }])
    }
    const { answer } = await send(s, 'What should I do first today?')
    // While the second turn ran, the plan already sat after its lead-in.
    expect(midway).toEqual([{ text: 'In the plan, tick what you’ll do today.' }, { block: 0 }])
    expect(answer.blocks.map((b) => b.kind)).toEqual(['plan', 'follow_ups'])
    expect(answer.parts).toEqual([{ text: 'In the plan, tick what you’ll do today.' }, { block: 0 }, { text: 'Do Lantern first.' }, { block: 1 }, { text: 'Good luck.' }])
    expect(answer.text).toBe('In the plan, tick what you’ll do today.\n\nDo Lantern first.\n\nGood luck.')
  })

  it('keeps words and blocks written in one turn in their order', async () => {
    const s = await setup()
    claude.reply = (_b, k) => (k === 1 ? turn([{ text: 'In the plan, start with Lantern.' }, plan(s), { text: 'Then one call to make.' }, options, follow]) : turn([{ text: 'Pick one.' }]))
    const { answer } = await send(s, 'What should I do first today?')
    expect(answer.blocks.map((b) => b.kind)).toEqual(['plan', 'options', 'follow_ups'])
    expect(answer.parts).toEqual([{ text: 'In the plan, start with Lantern.' }, { block: 0 }, { text: 'Then one call to make.' }, { block: 1 }, { block: 2 }, { text: 'Pick one.' }])
  })

  it('a refused block gives up its place; a turn that read keeps its blocks but not its preamble', async () => {
    const s = await setup()
    claude.reply = (_b, k) =>
      k === 1
        ? turn([{ text: 'Let me look.' }, { tool: 'get_investor', input: { id: s.lantern } }, plan(s)])
        : k === 2
          ? turn([{ text: 'Lantern can lead.' }, { tool: 'show_investor_card', input: { investorId: 'nobody' } }, { text: 'Ask today.' }])
          : turn([{ text: 'That’s the order.' }])
    const { answer } = await send(s, 'What should I do first today?')
    expect(answer.blocks.map((b) => b.kind)).toEqual(['plan'])
    expect(answer.parts).toEqual([{ block: 0 }, { text: 'Lantern can lead.\n\nAsk today.\n\nThat’s the order.' }])
    expect(answer.text).not.toContain('Let me look')
  })

  it('Regenerate starts the parts again', async () => {
    const s = await setup()
    claude.reply = () => turn([{ text: 'In the plan, start with Lantern.' }, plan(s)])
    const { answer } = await send(s, 'What should I do first today?')
    claude.reply = () => turn([{ text: 'Lantern first.' }])
    await s.as.mutation(api.advisor.regenerate, { messageId: answer._id })
    expect((await partsNow(s))).toEqual([])
    await drain(s.t)
    expect(await partsNow(s)).toEqual([{ text: 'Lantern first.' }])
  })
})
