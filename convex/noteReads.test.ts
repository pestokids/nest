// @vitest-environment edge-runtime
// PST-277: meeting notes become updates, against a mocked Claude (fetch is faked;
// nothing here calls the API). Every person, firm and address below is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { NoAIKey, complete } from './lib/anthropic'
import { NO_AI_KEY } from '../src/lib/enrich'
import { todayIST } from '../src/lib/dates'
import { addDays } from '../src/lib/today'

const modules = import.meta.glob('./**/*.ts')

const NOTE = [
  'Liked the retention story; wants week-8 numbers before deciding.',
  'Asked how we keep stories safe for 4-year-olds.',
  'Who else is in the round? Told him two angels are in.',
  'Said "around fifty" if the numbers hold.',
  'Retention after week 4?',
  'Sam offered an intro to Orchard Capital.',
  'Send week-8 retention in two weeks.',
].join('\n')

let bankId = ''
const answer = (o: Record<string, unknown> = {}) => ({
  summary: ['Liked the retention story.', 'Wants week-8 numbers before deciding.', 'Around $50K if the numbers hold.'],
  nextStep: { step: 'Send week-8 retention', date: '2026-11-20', quote: 'Send week-8 retention in two weeks' },
  stage: { to: 'm1', quote: 'Liked the retention story' },
  expected: { amount: 50000, quote: 'around fifty' },
  questions: [
    { text: 'How do you keep the stories safe for a 4-year-old?', questionId: null, answer: null, answerQuote: null, quote: 'keep stories safe for 4-year-olds' },
    { text: 'Who else is in the round?', questionId: null, answer: 'Two angels are in so far.', answerQuote: 'Told him two angels are in', quote: 'Who else is in the round?' },
    { text: 'What does retention look like after week 4?', questionId: bankId, answer: null, answerQuote: null, quote: 'Retention after week 4?' },
    // Not in the note: dropped.
    { text: 'What is your CAC?', questionId: null, answer: null, answerQuote: null, quote: 'CAC is $6 so far' },
  ],
  warmPaths: [{ text: 'Sam offered an intro to Orchard Capital', quote: 'offered an intro to Orchard Capital' }],
  ...o,
})

type Call = { body: { model: string; tools?: unknown; stream?: boolean; system: string; messages: { content: string }[] } }
let claude: { calls: Call[]; reply: () => Response }
const message = (text: string) =>
  new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 3000, output_tokens: 600 }, stop_reason: 'end_turn' }), { status: 200, headers: { 'content-type': 'application/json' } })
const json = (o: unknown) => message('Here it is.\n```json\n' + JSON.stringify(o) + '\n```')

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!url.startsWith('https://api.anthropic.com/v1/messages')) return new Response('{}', { status: 500 })
  claude.calls.push({ body: JSON.parse(String(init?.body)) })
  return claude.reply()
}

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real')
  claude = { calls: [], reply: () => json(answer()) }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const base = { type: 'Angel' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, notes: 'Met at a demo day.', source: '', updatedAt: 0 }

async function setup(inv: Partial<Doc<'investors'>> = {}) {
  const t = convexTest(schema, modules)
  const today = todayIST()
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const kite = await ctx.db.insert('investors', {
      ...base, name: 'Kite Angels', firm: 'Kite Angels', email: 'sam@kite.example.com', stage: 'booked', maxStage: 'booked', nextStep: 'Prepare for the 1st meeting', lastTouch: addDays(today, -3), ...inv,
    })
    const now = Date.now()
    const bank = await ctx.db.insert('questions', {
      text: 'What does retention look like after week 4?', theme: 'Traction', bestAnswer: 'Week-4 retention is 62%.', answerVersions: [], onDeck: false, askedCount: 0, createdAt: now, updatedAt: now,
    })
    return { dev, kite, bank }
  })
  bankId = ids.bank
  const as = t.withIdentity({ subject: ids.dev + '|s1' })
  return { t, as, today, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>

async function drain(t: S['t']) {
  vi.useFakeTimers()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
}

/** Paste the note (which starts a read) and let Claude answer. */
async function pasted(s: S) {
  const noteId = await s.as.mutation(api.qanda.addNote, { investorId: s.kite, text: NOTE, date: s.today, title: '1st meeting' })
  await drain(s.t)
  const [read] = await s.as.query(api.noteReads.forInvestor, { investorId: s.kite })
  return { noteId, read }
}
const inv = (s: S) => s.t.run((ctx) => ctx.db.get(s.kite))
const suggestions = (s: S) => s.t.run((ctx) => ctx.db.query('suggestions').collect())
const live = (s: S) => s.as.query(api.qanda.bank, {}).then((b) => b.questions)

describe('reading notes', () => {
  it('parses Claude’s JSON into proposals, each with its quote and a row in Suggestions', async () => {
    const s = await setup()
    const { read } = await pasted(s)
    expect(claude.calls).toHaveLength(1)
    const req = claude.calls[0].body
    expect(req.model).toBe('claude-sonnet-5-5')
    expect(req.tools).toBeUndefined()
    expect(req.messages[0].content).toContain('Send week-8 retention in two weeks.')
    expect(req.messages[0].content).toContain(s.bank + ': What does retention look like after week 4?')
    expect(req.messages[0].content).toContain('1st meeting (key "m1")')

    expect(read).toMatchObject({ status: 'ready', summary: answer().summary })
    expect(read.costUsd).toBeCloseTo((3000 * 2 + 600 * 10) / 1e6, 10)
    expect(read.proposals.map((p) => [p.id, p.state])).toEqual([
      ['next_step', 'open'], ['stage', 'open'], ['expected', 'open'], ['questions', 'open'], ['warm_path:0', 'open'],
    ])
    expect(read.proposals[0]).toMatchObject({ kind: 'next_step', step: 'Send week-8 retention', date: '2026-11-20', quote: 'Send week-8 retention in two weeks' })
    expect(read.proposals[1]).toMatchObject({ kind: 'stage', from: 'booked', to: 'm1' })
    expect(read.proposals[2]).toMatchObject({ kind: 'expected', amount: 50000, quote: 'around fifty' })
    const qs = read.proposals[3]
    expect(qs.kind === 'questions' && qs.items.map((q) => [q.text, q.questionId ?? null, q.answer ?? null])).toEqual([
      ['How do you keep the stories safe for a 4-year-old?', null, null],
      ['Who else is in the round?', null, 'Two angels are in so far.'],
      ['What does retention look like after week 4?', s.bank, null],
    ])
    const rows = await suggestions(s)
    expect(rows.map((r) => [r.kind, r.source, r.status, r.safe])).toEqual([
      ['next_step', 'notes', 'open', false], ['stage', 'notes', 'open', false], ['expected', 'notes', 'open', false], ['question', 'notes', 'open', false], ['warm_path', 'notes', 'open', false],
    ])
    expect(rows[0]).toMatchObject({ investorId: s.kite, title: 'Kite Angels’ 1st meeting notes: “Send week-8 retention in two weeks”' })
    // They show on Today.
    expect(await s.as.query(api.suggestions.list, {})).toHaveLength(5)
    // And count toward this month's spend.
    expect((await s.as.query(api.enrich.data, {})).month.usd).toBeCloseTo(read.costUsd, 10)
  })

  it('never skips a stage, and never moves a closed card', async () => {
    claude.reply = () => json(answer({ stage: { to: 'm2', quote: 'Liked the retention story' } }))
    const s = await setup()
    expect((await pasted(s)).read.proposals.some((p) => p.kind === 'stage')).toBe(false)

    claude.reply = () => json(answer())
    const parked = await setup({ stage: 'parked' })
    expect((await pasted(parked)).read.proposals.some((p) => p.kind === 'stage')).toBe(false)
  })

  it('proposes Expected only when an amount was said, and only fills it when empty', async () => {
    claude.reply = () => json(answer({ expected: { amount: 50000, quote: 'if the numbers hold' } }))
    const s = await setup()
    expect((await pasted(s)).read.proposals.some((p) => p.kind === 'expected')).toBe(false)

    claude.reply = () => json(answer({ expected: { amount: 50000, quote: 'said fifty thousand' } }))
    const invented = await setup()
    expect((await pasted(invented)).read.proposals.some((p) => p.kind === 'expected')).toBe(false)

    claude.reply = () => json(answer())
    const typed = await setup({ expected: 25000 })
    const { read } = await pasted(typed)
    const e = read.proposals.find((p) => p.kind === 'expected')!
    expect(e).toMatchObject({ amount: 50000, clash: 'You wrote $25K as Expected. Applying won’t change it.' })
    expect(e.suggestionId).toBeUndefined()
    await typed.as.mutation(api.noteReads.apply, { readId: read._id as Id<'noteReads'>, ids: read.proposals.map((p) => p.id) })
    expect((await inv(typed))?.expected).toBe(25000)
  })

  it('matches questions against the bank by id, or by the same words', async () => {
    claude.reply = () =>
      json(answer({ questions: [{ text: 'what does retention look like after week 4', questionId: 'not-a-real-id', answer: null, answerQuote: null, quote: 'Retention after week 4?' }] }))
    const s = await setup()
    const { read } = await pasted(s)
    const qs = read.proposals.find((p) => p.kind === 'questions')!
    expect(qs.kind === 'questions' && qs.items).toEqual([{ text: 'what does retention look like after week 4', questionId: s.bank, quote: 'Retention after week 4?' }])
  })

  it('reads a note again on “Read with Nest”, replacing the first read’s suggestions', async () => {
    const s = await setup()
    const { noteId } = await pasted(s)
    await s.as.mutation(api.noteReads.read, { noteId })
    await drain(s.t)
    expect(claude.calls).toHaveLength(2)
    expect((await s.as.query(api.suggestions.list, {})).length).toBe(5)
    expect(await s.as.query(api.noteReads.forInvestor, { investorId: s.kite })).toHaveLength(1)
  })

  it('records a read Claude answered badly as failed', async () => {
    claude.reply = () => message('I could not read these notes.')
    const s = await setup()
    const { read } = await pasted(s)
    expect(read).toMatchObject({ status: 'failed', error: 'Claude answered without readable JSON (200)' })
    expect(await suggestions(s)).toEqual([])
  })
})

describe('Apply and Undo', () => {
  it('writes each kind through the existing writes, and Undo reverts every one', async () => {
    const s = await setup()
    const { noteId, read } = await pasted(s)
    const before = await inv(s)
    const r = await s.as.mutation(api.noteReads.apply, { readId: read._id as Id<'noteReads'>, ids: read.proposals.map((p) => p.id) })
    expect(r).toEqual({ applied: 5 })

    expect(await inv(s)).toMatchObject({
      nextStep: 'Send week-8 retention', nextDate: '2026-11-20', stage: 'm1', maxStage: 'm1', lastTouch: s.today, expected: 50000,
      notes: 'Met at a demo day.\nWarm path: Sam offered an intro to Orchard Capital',
    })
    const acts = await s.t.run((ctx) => ctx.db.query('activities').collect())
    expect(acts.map((a) => [a.kind, a.stage ?? a.touch, a.date])).toEqual([['stage', 'm1', s.today], ['note', 'meeting', s.today]])
    expect(acts[1].note).toBe('1st meeting: Liked the retention story. Wants week-8 numbers before deciding. Around $50K if the numbers hold.')

    const qs = await live(s)
    expect(qs.map((q) => [q.text, q.askedCount, q.bestAnswer])).toEqual([
      ['What does retention look like after week 4?', 1, 'Week-4 retention is 62%.'],
      ['How do you keep the stories safe for a 4-year-old?', 1, ''],
      ['Who else is in the round?', 1, 'Two angels are in so far.'],
    ])
    expect(qs.flatMap((q) => q.asks.map((a) => [a.investorId, a.date, a.source, a.noteId, a.noteLine]))).toEqual([
      [s.kite, s.today, 'notes', noteId, 4], [s.kite, s.today, 'notes', noteId, 1], [s.kite, s.today, 'notes', noteId, 2],
    ])
    expect((await suggestions(s)).map((x) => x.status)).toEqual(['accepted', 'accepted', 'accepted', 'accepted', 'accepted'])
    const [after] = await s.as.query(api.noteReads.forInvestor, { investorId: s.kite })
    expect(after.status).toBe('applied')
    expect(after.proposals.every((p) => p.state === 'applied')).toBe(true)

    expect(await s.as.mutation(api.noteReads.undo, { readId: read._id as Id<'noteReads'> })).toBe(true)
    const back = (await inv(s))!
    for (const k of ['nextStep', 'nextDate', 'stage', 'maxStage', 'lastTouch', 'expected', 'notes'] as const) expect(back[k]).toEqual(before![k])
    expect(await s.t.run((ctx) => ctx.db.query('activities').collect())).toEqual([])
    expect((await live(s)).map((q) => [q.text, q.askedCount, q.bestAnswer])).toEqual([['What does retention look like after week 4?', 0, 'Week-4 retention is 62%.']])
    expect((await suggestions(s)).map((x) => x.status)).toEqual(['open', 'open', 'open', 'open', 'open'])
    expect((await s.as.query(api.noteReads.forInvestor, { investorId: s.kite }))[0].status).toBe('ready')
  })

  it('drops unticked items instead of keeping them as suggestions', async () => {
    const s = await setup()
    const { read } = await pasted(s)
    await s.as.mutation(api.noteReads.apply, { readId: read._id as Id<'noteReads'>, ids: ['next_step', 'stage'] })
    expect((await suggestions(s)).map((x) => [x.kind, x.status])).toEqual([
      ['next_step', 'accepted'], ['stage', 'accepted'], ['expected', 'dismissed'], ['question', 'dismissed'], ['warm_path', 'dismissed'],
    ])
    expect(await s.as.query(api.suggestions.list, {})).toEqual([])
    expect((await inv(s))?.notes).toBe('Met at a demo day.')
    expect((await inv(s))?.expected).toBeUndefined()
  })

  it('Dismiss drops the whole card, here and in Suggestions; Undo brings it back', async () => {
    const s = await setup()
    const { read } = await pasted(s)
    await s.as.mutation(api.noteReads.dismiss, { readId: read._id as Id<'noteReads'> })
    expect(await s.as.query(api.suggestions.list, {})).toEqual([])
    expect((await s.as.query(api.noteReads.forInvestor, { investorId: s.kite }))[0].status).toBe('dismissed')
    await s.as.mutation(api.noteReads.undo, { readId: read._id as Id<'noteReads'> })
    expect(await s.as.query(api.suggestions.list, {})).toHaveLength(5)
  })
})

describe('Suggestions and the drawer', () => {
  it('resolves both: accepting on Today marks it applied in the drawer, and Apply leaves nothing on Today', async () => {
    const s = await setup()
    const { read } = await pasted(s)
    const step = read.proposals[0].suggestionId as Id<'suggestions'>
    await s.as.mutation(api.suggestions.accept, { id: step })
    expect((await inv(s))?.nextStep).toBe('Send week-8 retention')
    let [now] = await s.as.query(api.noteReads.forInvestor, { investorId: s.kite })
    expect(now.proposals.map((p) => p.state)).toEqual(['applied', 'open', 'open', 'open', 'open'])

    // Undo on Today opens it again in the drawer.
    await s.as.mutation(api.suggestions.undo, { ids: [step] })
    ;[now] = await s.as.query(api.noteReads.forInvestor, { investorId: s.kite })
    expect(now.proposals[0].state).toBe('open')

    await s.as.mutation(api.noteReads.apply, { readId: read._id as Id<'noteReads'>, ids: ['next_step', 'stage', 'expected', 'questions'] })
    expect(await s.as.query(api.suggestions.list, {})).toEqual([])

    // Everything decided on Today: the drawer has nothing left to apply.
    const t2 = await setup()
    const r2 = (await pasted(t2)).read
    for (const p of r2.proposals) await t2.as.mutation(api.suggestions.dismiss, { id: p.suggestionId as Id<'suggestions'> })
    const [done] = await t2.as.query(api.noteReads.forInvestor, { investorId: t2.kite })
    expect(done.proposals.every((p) => p.state === 'dropped')).toBe(true)
  })
})

describe('notes from outside (Wispr Flow, agents)', () => {
  it('matches by email, else waits in Unmatched notes until Dev picks the investor', async () => {
    const s = await setup()
    const hit = await s.t.mutation(internal.noteReads.ingestNote, { email: 'Sam@Kite.example.com', meetingTitle: 'Pesto × Kite', date: s.today, text: NOTE, source: 'wispr' })
    expect(hit).toMatchObject({ investorId: s.kite })
    await drain(s.t)
    const notes = await s.as.query(api.qanda.notesFor, { investorId: s.kite })
    expect(notes).toMatchObject([{ source: 'wispr', by: 'Wispr Flow', title: 'Pesto × Kite', date: s.today }])
    expect((await s.as.query(api.noteReads.forInvestor, { investorId: s.kite }))[0].status).toBe('ready')

    const byTitle = await s.t.mutation(internal.noteReads.ingestNote, { meetingTitle: 'Kite Angels catch-up', date: s.today, text: 'Short call.', source: 'agent' })
    expect(byTitle).toMatchObject({ investorId: s.kite })

    const miss = await s.t.mutation(internal.noteReads.ingestNote, { email: 'rowan@larkspur.example.com', meetingTitle: 'Coffee', date: s.today, text: 'Talked about the market.', source: 'wispr' })
    expect(miss).toHaveProperty('unmatchedId')
    const [u] = await s.as.query(api.noteReads.unmatched, {})
    expect(u).toMatchObject({ email: 'rowan@larkspur.example.com', meetingTitle: 'Coffee' })
    await s.as.mutation(api.noteReads.dropUnmatched, { id: u._id })
    expect(await s.as.query(api.noteReads.unmatched, {})).toEqual([])
    await s.as.mutation(api.noteReads.restoreUnmatched, { id: u._id })
    const noteId = await s.as.mutation(api.noteReads.matchUnmatched, { id: u._id, investorId: s.kite })
    expect(await s.as.query(api.noteReads.unmatched, {})).toEqual([])
    expect((await s.as.query(api.qanda.notesFor, { investorId: s.kite })).some((n) => n._id === noteId && n.text === 'Talked about the market.')).toBe(true)
    await drain(s.t)
  })
})

describe('Draft from past answers', () => {
  it('drafts on the cheap model from the bank, and saves nothing', async () => {
    claude.reply = () => message('Week-4 retention is 62%, and week-8 numbers land in two weeks.')
    const s = await setup()
    const id = await s.t.run(async (ctx) => {
      const now = Date.now()
      return ctx.db.insert('questions', { text: 'How is retention after week 8?', theme: 'Traction', bestAnswer: '', answerVersions: [], onDeck: false, askedCount: 0, createdAt: now, updatedAt: now })
    })
    const d = await s.as.action(api.noteReads.draftAnswer, { questionId: id })
    expect(d).toMatchObject({ text: 'Week-4 retention is 62%, and week-8 numbers land in two weeks.', from: 1 })
    expect(d.costUsd).toBeCloseTo((3000 * 0.1 + 600 * 0.5) / 1e6, 12)
    expect(claude.calls[0].body.model).toBe('claude-haiku-5-5')
    expect(claude.calls[0].body.messages[0].content).toContain('Week-4 retention is 62%.')
    expect((await s.t.run((ctx) => ctx.db.get(id)))?.bestAnswer).toBe('')
  })
})

describe('missing key', () => {
  it('saves notes without reading them, refuses Read with Nest and drafts, and a queued read records it', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    await expect(complete({ model: 'claude-sonnet-5-5', system: 's', prompt: 'p' })).rejects.toBeInstanceOf(NoAIKey)
    const s = await setup()
    const { noteId, read } = await pasted(s)
    expect(read).toBeUndefined()
    expect(claude.calls).toEqual([])
    await expect(s.as.mutation(api.noteReads.read, { noteId })).rejects.toMatchObject({ data: { code: NO_AI_KEY } })
    await expect(s.as.action(api.noteReads.draftAnswer, { questionId: s.bank })).rejects.toMatchObject({ data: { code: NO_AI_KEY } })
    const readId = await s.t.run((ctx) => ctx.db.insert('noteReads', { noteId, investorId: s.kite, status: 'reading', auto: true, summary: [], proposals: [], costUsd: 0, startedAt: Date.now() }))
    await s.t.action(internal.noteReads.execute, { readId })
    expect((await s.as.query(api.noteReads.forInvestor, { investorId: s.kite }))[0]).toMatchObject({ status: 'failed', error: NO_AI_KEY })
  })

  it('reads automatically only while “Read meeting notes” is on', async () => {
    const s = await setup()
    await s.as.mutation(api.enrich.setAuto, { meetingNotes: false })
    const { noteId, read } = await pasted(s)
    expect(read).toBeUndefined()
    await s.as.mutation(api.noteReads.read, { noteId })
    await drain(s.t)
    expect((await s.as.query(api.noteReads.forInvestor, { investorId: s.kite }))[0].status).toBe('ready')
  })
})
