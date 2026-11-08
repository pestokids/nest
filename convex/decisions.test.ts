// @vitest-environment edge-runtime
// PST-293: decisions and signals against a mocked Jev and a mocked Gmail (fetch is
// faked; nothing here calls either). Every person, firm, address, subject and
// note below is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { emailSignals } from './lib/signalHooks'
import { todayIST } from '../src/lib/dates'
import { addDays } from '../src/lib/today'
import { WANTS_LEAD } from '../src/lib/decisions'

const modules = import.meta.glob('./**/*.ts')

type Body = { state: Record<string, string>; questions: Record<string, { type: string; criteria?: unknown }> }
/** The fake Jev's answers by question id; \`status\` is the HTTP status to answer with instead. */
let jev: { calls: Body[]; nouls: Record<string, number>; choices: Record<string, Record<string, number>>; status?: number }
/** The fake Gmail: message text by id, or a status to fail with. */
let gmail: { reads: string[]; bodies: Record<string, string>; status?: number; reason?: string }

const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_')

function answersFor(b: Body) {
  return Object.fromEntries(
    Object.entries(b.questions).map(([id, q]) => {
      if (q.type === 'noul') return [id, { type: 'noul', noul: jev.nouls[id] ?? 0.05 }]
      if (q.type === 'score') return [id, { type: 'score', score: 2.5, confidence: 0.4, legend: {}, probabilities: { 0: 0.1, 1: 0.1, 2: 0.2, 3: 0.4, 4: 0.2 } }]
      const keys = Object.keys(q.criteria as Record<string, string>)
      const probabilities = jev.choices[id] ?? Object.fromEntries(keys.map((k) => [k, 1 / keys.length]))
      const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0]
      return [id, { type: 'choice', choice: top, confidence: 0.5, probabilities }]
    }),
  )
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === 'https://api.typesafe.ai/v1/systemone') {
    const body = JSON.parse(String(init?.body)) as Body
    jev.calls.push(body)
    if (jev.status) return new Response('{}', { status: jev.status })
    return new Response(JSON.stringify({ model: 'jev-1.14.0', answers: answersFor(body), usage: { input_tokens: 1000, output_tokens: 30 } }), { status: 200 })
  }
  const m = url.match(/^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/([^?]+)\?format=full$/)
  if (m) {
    gmail.reads.push(decodeURIComponent(m[1]))
    if (gmail.status) return new Response(JSON.stringify({ error: { code: gmail.status, errors: [{ reason: gmail.reason ?? 'forbidden' }] } }), { status: gmail.status })
    return new Response(JSON.stringify({ id: m[1], payload: { mimeType: 'text/plain', body: { data: b64(gmail.bodies[m[1]] ?? '') } } }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
}

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
  vi.stubEnv('TYPESAFE_API_KEY', 'ts-test-key-not-real')
  jev = { calls: [], nouls: {}, choices: {} }
  gmail = { reads: [], bodies: {} }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const base = { type: 'Seed fund' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0, stage: 'm1' as const, maxStage: 'm1' as const }
const DAY = 864e5

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const kite = await ctx.db.insert('investors', { ...base, name: 'Kite Angels', firm: 'Kite Angels', email: 'sam@kite.example.com' })
    const orchard = await ctx.db.insert('investors', { ...base, name: 'Orchard Capital', firm: 'Orchard Capital', email: 'maya@orchard.example.com' })
    return { dev, kite, orchard }
  })
  const ctx = { runQuery: t.query, runMutation: t.mutation } as unknown as Parameters<typeof emailSignals>[0]
  return { t, ctx, ...ids, as: t.withIdentity({ subject: ids.dev + '|s1' }) }
}
type S = Awaited<ReturnType<typeof setup>>

const addNote = (s: S, investorId: Id<'investors'>, text: string) =>
  s.t.run((ctx) => ctx.db.insert('notes', { investorId, date: todayIST(), text, title: '1st meeting', createdBy: s.dev }))
const decision = async (s: S, id: Id<'investors'>) => (await s.as.query(api.decisions.data, {})).decisions.find((d) => d.investorId === id)
const signals = async (s: S) => (await s.as.query(api.decisions.data, {})).signals
const inbound = (messageId: string, from: string, subject = 'Re: Pesto') => ({ messageId, threadId: 't-' + messageId, from, subject, at: Date.now() })
const conn = (s: S) => ({ userId: s.dev, googleEmail: 'founder@pestokids.com' })

describe('the decision', () => {
  it('has no status and no decide-by date before the 1st meeting', async () => {
    const s = await setup()
    expect(await decision(s, s.kite)).toMatchObject({ investorId: s.kite, calls: 0 })
    expect((await decision(s, s.kite))?.decideBy).toBeUndefined()
  })

  it('decide-by defaults to 7 days after the 1st meeting; Dev can move or clear it', async () => {
    const s = await setup()
    const start = Date.now() - 2 * DAY
    await s.t.run((ctx) => ctx.db.insert('meetings', { userId: s.dev, eventId: 'e1', title: 'Pesto × Kite', start, end: start + 3600e3, people: [], investorIds: [s.kite] }))
    const first = todayIST(start)
    expect(await decision(s, s.kite)).toMatchObject({ calls: 1, decideBy: addDays(first, 7) })
    await s.as.mutation(api.decisions.setDecideBy, { investorId: s.kite, date: '2026-12-01' })
    expect((await decision(s, s.kite))?.decideBy).toBe('2026-12-01')
    await s.as.mutation(api.decisions.setDecideBy, { investorId: s.kite, date: null })
    expect((await decision(s, s.kite))?.decideBy).toBeUndefined()
    await expect(s.as.mutation(api.decisions.setDecideBy, { investorId: s.kite, date: 'soon' })).rejects.toThrow('isn’t a date')
  })

  it('setStatus sets maybe-since, logs it as Dev’s, and Undo puts it back', async () => {
    const s = await setup()
    await s.as.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'interested' })
    const logId = await s.as.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'maybe', reason: WANTS_LEAD })
    expect(await decision(s, s.kite)).toMatchObject({ status: 'maybe', reason: WANTS_LEAD, maybeSince: expect.any(Number) })
    expect(await s.as.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'maybe', reason: WANTS_LEAD })).toBeNull()
    const log = await s.as.query(api.decisions.log, { investorId: s.kite })
    expect(log.map((l) => [l.from, l.to, l.by, l.auto])).toEqual([['interested', 'maybe', 'Dev', false], [undefined, 'interested', 'Dev', false]])
    expect(await s.as.mutation(api.decisions.undo, { logId: logId! })).toBe(true)
    const d = await decision(s, s.kite)
    expect(d).toMatchObject({ status: 'interested' })
    expect(d?.reason).toBeUndefined()
    expect(d?.maybeSince).toBeUndefined()
  })

  it('Undo refuses once the status changed again', async () => {
    const s = await setup()
    const logId = await s.as.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'maybe' })
    await s.as.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'no' })
    await expect(s.as.mutation(api.decisions.undo, { logId: logId! })).rejects.toThrow('changed again')
  })

  it('needs Dev to be signed in', async () => {
    const s = await setup()
    await expect(s.t.query(api.decisions.data, {})).rejects.toThrow()
    await expect(s.t.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'yes' })).rejects.toThrow()
  })

  it('removing an investor removes their decision, its log and their signals', async () => {
    const s = await setup()
    await s.as.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'maybe' })
    jev.nouls = { pass: 0.95 }
    await emailSignals(s.ctx, conn(s), 'tok', [inbound('m1', 'sam@kite.example.com')])
    await s.as.mutation(api.investors.remove, { id: s.kite })
    const left = await s.t.run(async (ctx) => [
      (await ctx.db.query('decisions').collect()).length,
      (await ctx.db.query('decisionLog').collect()).length,
      (await ctx.db.query('signals').collect()).length,
    ])
    expect(left).toEqual([0, 0, 0])
  })
})

describe('signals from a meeting note', () => {
  it('"come back when there’s a lead", sure: Maybe with the reason, by itself, with Undo', async () => {
    const s = await setup()
    await s.as.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'interested' })
    jev.nouls = { comeback: 0.92 }
    const noteId = await addNote(s, s.kite, 'Liked the product. Come back once a lead is in.')
    await s.t.action(internal.signals.fromNote, { noteId })
    expect(jev.calls).toHaveLength(1)
    expect(jev.calls[0].state).toMatchObject({ meeting: '1st meeting', note: 'Liked the product. Come back once a lead is in.' })
    expect(await decision(s, s.kite)).toMatchObject({ status: 'maybe', reason: WANTS_LEAD })
    const [sig] = await signals(s)
    expect(sig).toMatchObject({ source: 'note', outcome: 'auto', change: { from: 'interested', to: 'maybe', reason: WANTS_LEAD }, p: 0.92, comeback: 0.92 })
    const log = await s.as.query(api.decisions.log, { investorId: s.kite })
    expect(log[0]).toMatchObject({ to: 'maybe', auto: true, source: 'note' })
    expect(log[0].by).toBeUndefined()
    expect(await s.as.mutation(api.decisions.undoSignal, { signalId: sig._id as Id<'signals'> })).toBe(true)
    expect(await decision(s, s.kite)).toMatchObject({ status: 'interested' })
    expect((await signals(s))[0].undoneAt).toEqual(expect.any(Number))
  })

  it('keeps the answers, never the note’s text', async () => {
    const s = await setup()
    const noteId = await addNote(s, s.kite, 'A made-up line that must not be stored.')
    await s.t.action(internal.signals.fromNote, { noteId })
    const rows = await s.t.run((ctx) => ctx.db.query('signals').collect())
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain('must not be stored')
    expect(rows[0]).toMatchObject({ noteId, key: 'note:' + noteId, answers: { score: 3.5 } })
  })

  it('reads each note once', async () => {
    const s = await setup()
    const noteId = await addNote(s, s.kite, 'Second call went well.')
    await s.t.action(internal.signals.fromNote, { noteId })
    await s.t.action(internal.signals.fromNote, { noteId })
    expect(jev.calls).toHaveLength(1)
  })

  it('unsure: a Decide row, and taking it is logged as Dev’s', async () => {
    const s = await setup()
    jev.choices = { status: { yes: 0.7, interested: 0.2, maybe: 0.05, no: 0.05 } }
    const noteId = await addNote(s, s.kite, 'They want to see the next month first.')
    await s.t.action(internal.signals.fromNote, { noteId })
    expect((await decision(s, s.kite))?.status).toBeUndefined()
    const [sig] = await signals(s)
    expect(sig).toMatchObject({ outcome: 'decide', change: { to: 'yes' }, p: 0.7 })
    await s.as.mutation(api.decisions.resolve, { signalId: sig._id as Id<'signals'>, accept: true })
    expect(await decision(s, s.kite)).toMatchObject({ status: 'yes' })
    expect((await s.as.query(api.decisions.log, { investorId: s.kite }))[0]).toMatchObject({ to: 'yes', by: 'Dev', auto: false })
    await expect(s.as.mutation(api.decisions.resolve, { signalId: sig._id as Id<'signals'>, accept: true })).rejects.toThrow('already decided')
  })

  it('leaving a Decide row changes nothing', async () => {
    const s = await setup()
    jev.nouls = { comeback: 0.5 }
    const noteId = await addNote(s, s.kite, 'Maybe later.')
    await s.t.action(internal.signals.fromNote, { noteId })
    const [sig] = await signals(s)
    expect(await s.as.mutation(api.decisions.resolve, { signalId: sig._id as Id<'signals'>, accept: false })).toBeNull()
    expect((await decision(s, s.kite))?.status).toBeUndefined()
    expect((await signals(s))[0].doneAt).toEqual(expect.any(Number))
  })

  it('when Jev can’t answer, nothing changes and nothing is kept', async () => {
    const s = await setup()
    await s.as.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'interested' })
    jev.status = 400
    const noteId = await addNote(s, s.kite, 'Good call.')
    await s.t.action(internal.signals.fromNote, { noteId })
    vi.stubEnv('TYPESAFE_API_KEY', '')
    await s.t.action(internal.signals.fromNote, { noteId })
    expect(await signals(s)).toEqual([])
    expect(await decision(s, s.kite)).toMatchObject({ status: 'interested' })
  })
})

describe('signals from an email', () => {
  it('a sure pass sets No by itself; Jev reads the subject and the text without the quote', async () => {
    const s = await setup()
    await s.as.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'maybe' })
    jev.nouls = { pass: 0.94 }
    gmail.bodies = { m1: 'Thanks Dev, we will pass for now.\n\nOn Mon, 2 Nov 2026 at 10:00, Dev wrote:\n> hello' }
    await emailSignals(s.ctx, conn(s), 'tok', [inbound('m1', 'sam@kite.example.com', 'Re: Pesto seed')])
    expect(jev.calls[0].state).toEqual({ subject: 'Re: Pesto seed', email: 'Thanks Dev, we will pass for now.' })
    expect(await decision(s, s.kite)).toMatchObject({ status: 'no' })
    expect((await signals(s))[0]).toMatchObject({ source: 'email', outcome: 'auto', change: { from: 'maybe', to: 'no' }, pass: 0.94 })
    const rows = await s.t.run((ctx) => ctx.db.query('signals').collect())
    expect(JSON.stringify(rows)).not.toContain('pass for now')
    expect(rows[0]).toMatchObject({ messageId: 'm1', key: 'email:m1:' + s.kite })
  })

  it('a sure ask becomes an ask; an unsure one doesn’t', async () => {
    const s = await setup()
    jev.choices = { ask: { deck: 0.9, nothing: 0.1, data: 0, numbers: 0, meeting: 0, intro: 0 } }
    await emailSignals(s.ctx, conn(s), 'tok', [inbound('m1', 'sam@kite.example.com')])
    jev.choices = { ask: { numbers: 0.6, nothing: 0.4, deck: 0, data: 0, meeting: 0, intro: 0 } }
    await emailSignals(s.ctx, conn(s), 'tok', [inbound('m2', 'maya@orchard.example.com', 'Re: Pesto numbers')])
    const byInvestor = Object.fromEntries((await signals(s)).map((x) => [x.investorId, x.asked]))
    expect(byInvestor).toEqual({ [s.kite]: 'deck', [s.orchard]: undefined })
    const [sig] = (await signals(s)).filter((x) => x.asked)
    await s.as.mutation(api.decisions.doneAsk, { signalId: sig._id as Id<'signals'> })
    expect((await signals(s)).find((x) => x._id === sig._id)?.askDoneAt).toEqual(expect.any(Number))
  })

  it('only reads messages from investors, and each one once', async () => {
    const s = await setup()
    await emailSignals(s.ctx, conn(s), 'tok', [inbound('m1', 'someone@elsewhere.example.com'), inbound('m2', 'sam@kite.example.com')])
    await emailSignals(s.ctx, conn(s), 'tok', [inbound('m2', 'sam@kite.example.com')])
    expect(jev.calls).toHaveLength(1)
    expect(gmail.reads).toEqual(['m2'])
  })

  it('under the old gmail.metadata grant (403), Jev reads the subject alone and the run stops asking for text', async () => {
    const s = await setup()
    gmail.status = 403
    gmail.reason = 'insufficientPermissions'
    jev.nouls = { real: 0.9 }
    await emailSignals(s.ctx, conn(s), 'tok', [inbound('m1', 'sam@kite.example.com', 'Keen to go deeper'), inbound('m2', 'maya@orchard.example.com', 'Next steps')])
    expect(gmail.reads).toEqual(['m1'])
    expect(jev.calls.map((c) => c.state)).toEqual([{ subject: 'Keen to go deeper', email: '' }, { subject: 'Next steps', email: '' }])
    expect(await decision(s, s.kite)).toMatchObject({ status: 'interested' })
  })

  it('on a metadata-only grant it never asks Gmail for the text, and reports a 403 so Settings can ask to reconnect', async () => {
    const s = await setup()
    await expect(emailSignals(s.ctx, conn(s), 'tok', [inbound('m1', 'sam@kite.example.com', 'Quick question')], undefined, false)).resolves.toBeUndefined()
    expect(gmail.reads).toEqual([])
    expect(jev.calls[0].state).toEqual({ subject: 'Quick question', email: '' })
    gmail.status = 403
    await expect(emailSignals(s.ctx, conn(s), 'tok', [inbound('m2', 'maya@orchard.example.com', 'Following up')])).resolves.toBe(false)
  })

  it('a Yes Dev holds is only changed through a Decide row', async () => {
    const s = await setup()
    await s.as.mutation(api.decisions.setStatus, { investorId: s.kite, status: 'yes' })
    jev.nouls = { pass: 0.95 }
    await emailSignals(s.ctx, conn(s), 'tok', [inbound('m1', 'sam@kite.example.com')])
    expect(await decision(s, s.kite)).toMatchObject({ status: 'yes' })
    expect((await signals(s))[0]).toMatchObject({ outcome: 'decide', change: { from: 'yes', to: 'no' } })
  })

  it('when Jev can’t answer, nothing changes and nothing throws', async () => {
    const s = await setup()
    jev.status = 403
    await expect(emailSignals(s.ctx, conn(s), 'tok', [inbound('m1', 'sam@kite.example.com')])).resolves.toBeUndefined()
    expect(await signals(s)).toEqual([])
  })
})
