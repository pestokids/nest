// @vitest-environment edge-runtime
// PST-292: Jev against a mocked TypeSafe API (fetch is faked; nothing here calls it):
// the three primitives, the cache, the monthly cap, the fallbacks, and each
// housekeeping threshold. Every person, firm, address and note below is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { askJev } from './lib/jev'
import { choice, noul, score, whoQuestions } from '../src/lib/jev'
import { todayIST } from '../src/lib/dates'

const modules = import.meta.glob('./**/*.ts')

type Body = { model: string; state: unknown; questions: Record<string, { type: string; criteria?: unknown }> }
/** What the fake Jev answers: a Noul's probability by question id, a Choice's probabilities, and the HTTP statuses to fail with first. */
let jev: { calls: Body[]; nouls: Record<string, number>; choices: Record<string, Record<string, number>>; fail: number[]; bad?: boolean; pick?: (b: Body) => Record<string, number> }
let claude: number

function answersFor(b: Body) {
  return Object.fromEntries(
    Object.entries(b.questions).map(([id, q]) => {
      if (q.type === 'noul') return [id, { type: 'noul', noul: jev.nouls[id] ?? 0.5 }]
      if (q.type === 'score') return [id, { type: 'score', score: 1.43, confidence: 0.35, legend: { 0: 'Low', 1: 'Mid', 2: 'High' }, probabilities: { 0: 0, 1: 0.57, 2: 0.43 } }]
      const keys = Object.keys(q.criteria as Record<string, string>)
      const probabilities = (id === 'same_as' && jev.pick?.(b)) || jev.choices[id] || Object.fromEntries(keys.map((k) => [k, 1 / keys.length]))
      const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0]
      return [id, { type: 'choice', choice: top, confidence: 0.5, probabilities }]
    }),
  )
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.startsWith('https://api.anthropic.com/')) {
    claude++
    return new Response('{}', { status: 500 })
  }
  if (url !== 'https://api.typesafe.ai/v1/systemone') return new Response('{}', { status: 404 })
  expect((init?.headers as Record<string, string>).authorization).toBe('Bearer ts-test-key-not-real')
  const body = JSON.parse(String(init?.body)) as Body
  jev.calls.push(body)
  const status = jev.fail.shift()
  if (status) return new Response('{}', { status, headers: { 'retry-after': '0' } })
  const answers = jev.bad ? { nope: true } : answersFor(body)
  return new Response(JSON.stringify({ model: 'jev-1.14.0', answers, usage: { input_tokens: 1000, output_tokens: 30 } }), { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real')
  vi.stubEnv('TYPESAFE_API_KEY', 'ts-test-key-not-real')
  jev = { calls: [], nouls: {}, choices: {}, fail: [] }
  claude = 0
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const base = { type: 'Seed fund' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0, stage: 'm1' as const, maxStage: 'm1' as const }
const fields = { name: '', firm: '', type: 'Seed fund' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, stage: 'todo' as const, lead: false, nextStep: '', notes: '', source: '' }

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const juniper = await ctx.db.insert('investors', { ...base, name: 'Juniper Seed', firm: 'Juniper Seed', email: 'ana@juniper.example.com' })
    const kite = await ctx.db.insert('investors', { ...base, name: 'Kite Angels', firm: 'Kite Angels', email: 'sam@kite.example.com' })
    const orchard = await ctx.db.insert('investors', { ...base, name: 'Orchard Capital', firm: 'Orchard Capital', email: 'maya@orchard.example.com' })
    return { dev, juniper, kite, orchard }
  })
  const ctx = { runQuery: t.query, runMutation: t.mutation } as unknown as Parameters<typeof askJev>[0]
  return { t, ctx, ...ids, as: t.withIdentity({ subject: ids.dev + '|s1' }) }
}
type S = Awaited<ReturnType<typeof setup>>
const runs = (s: S) => s.t.run((ctx) => ctx.db.query('jevRuns').collect())
const marks = (s: S) => s.t.run((ctx) => ctx.db.query('jevMarks').collect())

async function drain(t: S['t']) {
  vi.useFakeTimers()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
}

describe('askJev', () => {
  it('asks Choice, Score and Noul questions in one request and types the answers', async () => {
    const s = await setup()
    jev.nouls.urgent = 0.91
    jev.choices.team = { billing: 0.1, technical: 0.85, sales: 0.05 }
    const r = await askJev(s.ctx, {
      feature: 'qa_repeats',
      state: 'Made-up ticket: the export button does nothing.',
      questions: { team: choice('Which team handles this?', { billing: 'Payments', technical: 'Bugs', sales: 'Pricing' }), level: score('How bad is it?', ['Cosmetic', 'Broken with a workaround', 'Blocking']), urgent: noul('The message is urgent.') },
    })
    expect(r?.answers.team).toMatchObject({ type: 'choice', choice: 'technical', probabilities: { technical: 0.85 } })
    expect(r?.answers.level).toMatchObject({ type: 'score', score: 1.43, legend: { 1: 'Mid' } })
    expect(r?.answers.urgent).toEqual({ type: 'noul', noul: 0.91 })
    expect(jev.calls[0]).toMatchObject({ model: 'jev-latest', questions: { team: { type: 'choice' }, level: { type: 'score' }, urgent: { type: 'noul' } } })
    // $0.042 per million input tokens; output is free.
    expect(r?.costUsd).toBeCloseTo(0.000042, 12)
    expect(await runs(s)).toMatchObject([{ feature: 'qa_repeats', status: 'ok', cached: false, questions: 3, inputTokens: 1000, outputTokens: 30, model: 'jev-1.14.0' }])
  })

  it('answers the same text from the cache, never asking twice', async () => {
    const s = await setup()
    const ask = () => askJev(s.ctx, { feature: 'whos_this', state: { email_domain: 'example.com' }, questions: whoQuestions() })
    const a = await ask()
    const b = await ask()
    expect(jev.calls).toHaveLength(1)
    expect(b).toMatchObject({ cached: true, costUsd: 0, answers: a!.answers })
    expect((await runs(s)).map((r) => r.cached)).toEqual([false, true])
  })

  it('stops at the monthly cap, logging "jev cap reached" and never the text', async () => {
    const s = await setup()
    const log = vi.spyOn(console, 'log')
    await s.as.mutation(api.jev.setJev, { capUsd: 0 })
    const state = { invite_title: 'Made-up title that must not be logged' }
    expect(await askJev(s.ctx, { feature: 'whos_this', state, questions: whoQuestions() })).toBeNull()
    expect(jev.calls).toHaveLength(0)
    expect(await runs(s)).toMatchObject([{ status: 'capped', reason: 'cap', costUsd: 0 }])
    const lines = log.mock.calls.map((c) => String(c[0]))
    expect(lines.some((l) => l.startsWith('jev cap reached'))).toBe(true)
    expect(lines.join('\n')).not.toContain('Made-up title')
  })

  it('counts this month’s spend against the cap', async () => {
    const s = await setup()
    await s.t.run((ctx) => ctx.db.insert('jevRuns', { feature: 'whos_this', at: Date.now(), status: 'ok', cached: false, questions: 1, inputTokens: 1e7, outputTokens: 0, costUsd: 0.42 }))
    await s.as.mutation(api.jev.setJev, { capUsd: 0.42 })
    expect(await askJev(s.ctx, { feature: 'whos_this', state: 'x', questions: whoQuestions() })).toBeNull()
    await s.as.mutation(api.jev.setJev, { capUsd: 0.5 })
    expect(await askJev(s.ctx, { feature: 'whos_this', state: 'x', questions: whoQuestions() })).not.toBeNull()
    await expect(s.as.mutation(api.jev.setJev, { capUsd: 50 })).rejects.toThrow(/between/)
  })

  it('returns null without a key, or when switched off', async () => {
    const s = await setup()
    vi.stubEnv('TYPESAFE_API_KEY', '')
    expect(await askJev(s.ctx, { feature: 'whos_this', state: 'x', questions: whoQuestions() })).toBeNull()
    vi.stubEnv('TYPESAFE_API_KEY', 'ts-test-key-not-real')
    await s.as.mutation(api.jev.setJev, { on: false })
    expect(await askJev(s.ctx, { feature: 'whos_this', state: 'x', questions: whoQuestions() })).toBeNull()
    expect(jev.calls).toHaveLength(0)
  })

  it('retries 429 and 5xx twice, then gives up with a short reason', async () => {
    const s = await setup()
    jev.fail = [429, 503]
    expect(await askJev(s.ctx, { feature: 'whos_this', state: 'a', questions: whoQuestions() })).not.toBeNull()
    expect(jev.calls).toHaveLength(3)
    jev.fail = [500, 502, 503]
    expect(await askJev(s.ctx, { feature: 'whos_this', state: 'b', questions: whoQuestions() })).toBeNull()
    expect(jev.calls).toHaveLength(6)
    jev.fail = [401]
    expect(await askJev(s.ctx, { feature: 'whos_this', state: 'c', questions: whoQuestions() })).toBeNull()
    expect(jev.calls).toHaveLength(7)
    jev.bad = true
    expect(await askJev(s.ctx, { feature: 'whos_this', state: 'd', questions: whoQuestions() })).toBeNull()
    expect((await runs(s)).map((r) => [r.status, r.reason])).toEqual([['ok', undefined], ['error', '503'], ['error', '401'], ['error', 'bad_answer']])
  })

  it('shows in Settings › AI: this month’s spend, the cap, and in the month’s total', async () => {
    const s = await setup()
    await askJev(s.ctx, { feature: 'whos_this', state: 'x', questions: whoQuestions() })
    const ai = await s.as.query(api.enrich.data, {})
    expect(ai.jev).toMatchObject({ connected: true, on: true, capUsd: 0.5, calls: 1 })
    expect(ai.jev.monthUsd).toBeCloseTo(0.000042, 12)
    expect(ai.month.usd).toBeCloseTo(0.000042, 12)
  })
})

/* ---------- Who's this? pre-check ---------- */

const meeting = (eventId: string, people: string[], title = 'Made-up chat') => ({ eventId, title, start: Date.now() + 36e5, end: Date.now() + 72e5, people: people.map((email) => ({ email })) })
const lookups = (s: S, email: string) => s.t.run((ctx) => ctx.db.query('enrichRuns').withIndex('by_email', (q) => q.eq('email', email)).collect())

describe('Who’s this? pre-check', () => {
  it('asks one Noul per new person with domains and the title only, and skips the lookup below 0.3', async () => {
    const s = await setup()
    jev.nouls.likely_investor = 0.12
    await s.t.mutation(internal.google.upsertMeetings, { userId: s.dev, self: 'founder@pestokids.com', items: [meeting('e1', ['founder@pestokids.com', 'lee@plumbing.example.com', 'kim@other.example.com'], 'Quote for the kitchen')], drops: [] })
    await drain(s.t)
    expect(jev.calls[0].state).toEqual({ email_domain: 'plumbing.example.com', invite_title: 'Quote for the kitchen', other_attendee_domains: ['other.example.com'], domain_is_known_investor_firm: false })
    expect(JSON.stringify(jev.calls)).not.toContain('lee@')
    expect(await lookups(s, 'lee@plumbing.example.com')).toEqual([])
    expect(claude).toBe(0)
    const ai = await s.as.query(api.enrich.data, {})
    expect(ai.prechecked).toContainEqual({ email: 'lee@plumbing.example.com', likely: 0.12 })
    // Not asked again on the next sync; "Look up anyway" still looks them up.
    await s.t.mutation(internal.google.upsertMeetings, { userId: s.dev, self: 'founder@pestokids.com', items: [meeting('e2', ['lee@plumbing.example.com'])], drops: [] })
    await drain(s.t)
    expect(jev.calls).toHaveLength(2)
    await s.as.mutation(api.enrich.lookupSender, { email: 'lee@plumbing.example.com' })
    expect(await lookups(s, 'lee@plumbing.example.com')).toHaveLength(1)
  })

  it('looks up as today at 0.3 or above', async () => {
    const s = await setup()
    jev.nouls.likely_investor = 0.3
    await s.t.mutation(internal.google.upsertMeetings, { userId: s.dev, self: 'founder@pestokids.com', items: [meeting('e1', ['rowan@larkspur.example.com'], 'Intro: Pesto × Larkspur')], drops: [] })
    await drain(s.t)
    expect(jev.calls).toHaveLength(1)
    expect(await lookups(s, 'rowan@larkspur.example.com')).toHaveLength(1)
    expect(await marks(s)).toEqual([])
  })

  it('falls back to the lookup when Jev fails, is off or has no key', async () => {
    const s = await setup()
    jev.fail = [500, 500, 500]
    await s.t.mutation(internal.google.upsertMeetings, { userId: s.dev, self: 'founder@pestokids.com', items: [meeting('e1', ['a@one.example.com'])], drops: [] })
    await drain(s.t)
    expect(await lookups(s, 'a@one.example.com')).toHaveLength(1)
    vi.stubEnv('TYPESAFE_API_KEY', '')
    await s.t.mutation(internal.google.upsertMeetings, { userId: s.dev, self: 'founder@pestokids.com', items: [meeting('e2', ['b@two.example.com'])], drops: [] })
    await drain(s.t)
    expect(await lookups(s, 'b@two.example.com')).toHaveLength(1)
    expect(jev.calls).toHaveLength(3)
  })
})

/* ---------- Unmatched notes ---------- */

async function unmatchedAt(s: S) {
  const today = todayIST()
  const start = Date.parse(today + 'T11:00:00+05:30')
  await s.t.run((ctx) => ctx.db.insert('meetings', { userId: s.dev, eventId: 'm1', title: 'Pesto partners lunch', start, end: start + 36e5, people: [{ email: 'sam@kite.example.com' }, { email: 'maya@orchard.example.com' }], investorIds: [s.kite, s.orchard] }))
  const r = await s.t.mutation(internal.noteReads.ingestNote, { meetingTitle: 'Pesto partners lunch', date: today, text: 'Made-up notes: asked about pricing.\nWants the deck.', source: 'agent' })
  if (!('unmatchedId' in r)) throw new Error('expected unmatched')
  await drain(s.t)
  return r.unmatchedId as Id<'unmatchedNotes'>
}
const unmatchedRow = (s: S, id: Id<'unmatchedNotes'>) => s.t.run((ctx) => ctx.db.get(id)) as Promise<Doc<'unmatchedNotes'>>

describe('Unmatched notes', () => {
  it('attaches the note when the top pick is at least 0.9 and the companion below 0.3', async () => {
    const s = await setup()
    jev.choices.investor = { i0: 0.94, i1: 0.06 }
    jev.nouls.none = 0.08
    const id = await unmatchedAt(s)
    expect(Object.values(jev.calls[0].questions.investor.criteria as Record<string, string>)).toEqual(['Kite Angels', 'Orchard Capital'])
    const u = await unmatchedRow(s, id)
    expect(u.noteId).toBeDefined()
    expect(await s.t.run((ctx) => ctx.db.get(u.noteId!))).toMatchObject({ investorId: s.kite })
  })

  it('keeps it in Unmatched with a “Probably …” hint otherwise', async () => {
    for (const [top, none] of [[0.85, 0.05], [0.95, 0.4]]) {
      const s = await setup()
      jev.choices.investor = { i0: 1 - top, i1: top }
      jev.nouls.none = none
      const id = await unmatchedAt(s)
      expect((await unmatchedRow(s, id)).noteId).toBeUndefined()
      expect(await s.as.query(api.noteReads.unmatched, {})).toMatchObject([{ _id: id, hint: { investorId: s.orchard, p: top } }])
    }
  })

  it('stays as today when Jev can’t answer', async () => {
    const s = await setup()
    jev.fail = [500, 500, 500]
    const id = await unmatchedAt(s)
    expect(await s.as.query(api.noteReads.unmatched, {})).toEqual([expect.not.objectContaining({ hint: expect.anything() })])
    expect((await unmatchedRow(s, id)).noteId).toBeUndefined()
  })
})

/* ---------- Duplicate firms ---------- */

const dupRows = (s: S) => s.t.run(async (ctx) => (await ctx.db.query('suggestions').collect()).filter((r) => r.kind === 'duplicate'))

describe('Duplicate firms', () => {
  it('asks only about similar names, and suggests a Duplicate at 0.8 or above', async () => {
    const s = await setup()
    jev.nouls.same_0 = 0.86
    const id = await s.as.mutation(api.investors.upsert, { fields: { ...fields, name: 'Junipr Seed', firm: 'Junipr Seed' } })
    await drain(s.t)
    expect(jev.calls).toHaveLength(1)
    expect(jev.calls[0].state).toMatchObject({ record: { name: 'Junipr Seed' }, others: [{ name: 'Juniper Seed' }] })
    expect(await dupRows(s)).toMatchObject([{ source: 'jev', investorId: s.juniper, otherInvestorId: id, patch: { op: 'merge' }, safe: false, status: 'open' }])
    // Nothing merges by itself.
    expect(await s.t.run((ctx) => ctx.db.get(id))).not.toBeNull()
  })

  it('suggests nothing below 0.8, and never asks without a similar name', async () => {
    const s = await setup()
    jev.nouls.same_0 = 0.79
    await s.as.mutation(api.investors.upsert, { fields: { ...fields, name: 'Juniper Seeds Club', firm: 'Juniper Seeds Club' } })
    await s.as.mutation(api.investors.upsert, { fields: { ...fields, name: 'Harbor Light', firm: 'Harbor Light' } })
    await drain(s.t)
    expect(jev.calls).toHaveLength(1)
    expect(jev.calls[0].state).toMatchObject({ record: { name: 'Juniper Seeds Club' }, others: [{ name: 'Juniper Seed' }] })
    expect(await dupRows(s)).toEqual([])
  })

  it('checks again on a rename, not on other edits', async () => {
    const s = await setup()
    const id = await s.as.mutation(api.investors.upsert, { fields: { ...fields, name: 'Harbor Light', firm: 'Harbor Light' } })
    await drain(s.t)
    await s.as.mutation(api.investors.upsert, { id, fields: { ...fields, name: 'Harbor Light', firm: 'Harbor Light', notes: 'Made-up note.' } })
    await drain(s.t)
    expect(jev.calls).toHaveLength(0)
    jev.nouls.same_0 = 0.9
    await s.as.mutation(api.investors.upsert, { id, fields: { ...fields, name: 'Kite Angel', firm: 'Kite Angel' } })
    await drain(s.t)
    expect(jev.calls).toHaveLength(1)
    expect(await dupRows(s)).toMatchObject([{ investorId: s.kite, otherInvestorId: id }])
  })
})

/* ---------- Q&A repeats ---------- */

async function bank(s: S) {
  const now = Date.now()
  const q = (text: string) => s.t.run((ctx) => ctx.db.insert('questions', { text, theme: 'Product', bestAnswer: '', answerVersions: [], onDeck: false, askedCount: 0, createdAt: now, updatedAt: now }))
  const safe = await q('How do you keep the stories safe for a 4-year-old?')
  await q('Is the app safe for young kids at night?')
  await q('What happens to margins when you add voice?')
  await q('Who else is in the round?')
  const noteId = await s.t.run((ctx) => ctx.db.insert('notes', { investorId: s.kite, date: todayIST(), text: 'Made-up notes.\nAre the stories safe for young kids?' }))
  const r = await s.as.mutation(api.qanda.markLine, { noteId, line: 1 })
  await drain(s.t)
  return { safe, added: r.questionId as Id<'questions'> }
}
/** The Choice's probabilities with `top` on the safety question, wherever it is among the options. */
function onSafe(top: number) {
  return (b: Body) => {
    const keys = Object.keys(b.questions.same_as.criteria as Record<string, string>)
    const at = keys.find((k) => (b.questions.same_as.criteria as Record<string, string>)[k].startsWith('How do you keep'))!
    return Object.fromEntries(keys.map((k) => [k, k === at ? top : (1 - top) / (keys.length - 1)]))
  }
}
const sameAs = async (s: S, id: string) => (await s.as.query(api.qanda.bank, {})).questions.find((q) => q._id === id)?.sameAs

describe('Q&A repeats', () => {
  it('marks a new question “Same as …” at 0.85 with the companion below 0.3, and Dev can undo it', async () => {
    const s = await setup()
    jev.pick = onSafe(0.92)
    jev.nouls.none = 0.1
    const { safe, added } = await bank(s)
    const sent = jev.calls[0]
    expect(sent.state).toMatchObject({ new_question: 'Are the stories safe for young kids?' })
    // The closest ones by trigrams: the two about safety, not margins or the round.
    expect([...(sent.state as { existing: string[] }).existing].sort()).toEqual(['How do you keep the stories safe for a 4-year-old?', 'Is the app safe for young kids at night?'])
    expect(await sameAs(s, added)).toEqual({ id: safe, text: 'How do you keep the stories safe for a 4-year-old?' })
    await s.as.mutation(api.jevHousekeeping.notSame, { questionId: added })
    expect(await sameAs(s, added)).toBeUndefined()
    await s.as.mutation(api.jevHousekeeping.restoreSame, { questionId: added })
    expect(await sameAs(s, added)).toBeDefined()
  })

  it('marks nothing below 0.85, or when the companion is 0.3 or above', async () => {
    for (const [top, none] of [[0.84, 0.1], [0.95, 0.3]]) {
      const s = await setup()
      jev.pick = onSafe(top)
      jev.nouls.none = none
      const { added } = await bank(s)
      expect(await sameAs(s, added)).toBeUndefined()
    }
  })
})
