// @vitest-environment edge-runtime
// PST-305: Network against a mocked Anthropic API and a mocked Resend (fetch is
// faked; nothing here calls either). The relation migration, a founder's lookup
// (parsing, dedupe against Nest, the real cost, tick-to-add), Who do they know,
// Wants to invest (create, link, off, counted once), the CSV import, the intro
// ask (blanks kept, nothing invented, sending ticks Asked) and an agent's Network
// suggestions. Every person, firm, company, address and link is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { todayIST } from '../src/lib/dates'
import { allPeople, type Introducer } from '../src/lib/introducers'
import type { Investor } from '../src/lib/pipeline'

const modules = import.meta.glob('./**/*.ts')
const FENCE = '\x60\x60\x60'
const base = { firm: '', type: 'Seed fund' as const, geo: 'India' as const, warmth: 'intro' as const, tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0, path: '' }

type Ev = Record<string, unknown>
const sse = (events: Ev[]) => new Response(events.map((e) => 'event: ' + e.type + '\ndata: ' + JSON.stringify(e) + '\n\n').join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
function lookupEvents(answer: unknown): Ev[] {
  const text = FENCE + 'json\n' + JSON.stringify(answer) + '\n' + FENCE
  return [
    { type: 'message_start', message: { usage: { input_tokens: 20_000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'server_tool_use', id: 'srvtoolu_0', name: 'web_search', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"query":"Tinkerly investors"}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2_000, server_tool_use: { web_search_requests: 2 } } },
    { type: 'message_stop' },
  ]
}

type Call = { url: string; body: Record<string, unknown> }
let calls: Call[]
let lookupAnswer: unknown
let askAnswer: unknown
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  calls.push({ url, body })
  if (url.startsWith('https://api.anthropic.com')) {
    if (body.stream) return sse(lookupEvents(lookupAnswer))
    const text = FENCE + 'json\n' + JSON.stringify(askAnswer) + '\n' + FENCE
    return new Response(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 2500, output_tokens: 300 } }), { status: 200 })
  }
  if (url.startsWith('https://api.resend.com')) return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 })
  return new Response('{}', { status: 404 })
}

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real')
  calls = []
  lookupAnswer = { investors: [] }
  askAnswer = {}
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const add = (name: string, o: Record<string, unknown> = {}) => ctx.db.insert('investors', { ...base, name, firm: name, stage: 'todo', maxStage: 'todo', ...o })
    return {
      dev,
      orchard: await add('Orchard Capital', { domains: ['orchard.example.com'], stage: 'm1', maxStage: 'm1' }),
      kite: await add('Kite Angels', { type: 'Angel' }),
      lantern: await add('Lantern Ventures', { path: 'Ria' }),
      sable: await add('Sable Fund', { stage: 'signed', maxStage: 'signed', committed: 25_000 }),
    }
  })
  const as = t.withIdentity({ subject: ids.dev + '|s1' })
  const person = (name: string, o: Record<string, unknown> = {}) =>
    t.run((ctx) => ctx.db.insert('introducers', { name, key: name.toLowerCase(), relation: 'founder', notes: '', createdAt: 0, ...o }))
  return { t, as, person, ...ids }
}
type S = Awaited<ReturnType<typeof setup>>
async function drain(t: S['t']) {
  vi.useFakeTimers()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers()
}

describe('the relation migration', () => {
  it('turns every portfolio founder into a founder, once, and the list says when some are left', async () => {
    const s = await setup()
    const a = await s.person('Ankur Mehta', { relation: 'portfolio' })
    await s.person('Ria Kapoor', { relation: 'friend' })
    const before = await s.as.query(api.introducers.list, {})
    expect(before.legacy).toBe(true)
    expect(before.introducers.find((p) => p._id === a)!.relation).toBe('founder')
    expect(await s.as.mutation(api.network.migrateRelations, {})).toEqual({ migrated: 1 })
    expect(await s.as.mutation(api.network.migrateRelations, {})).toEqual({ migrated: 0 })
    expect((await s.t.run((ctx) => ctx.db.get(a)))!.relation).toBe('founder')
    expect((await s.as.query(api.introducers.list, {})).legacy).toBe(false)
  })
})

const FOUND = [
  { firm: 'Brightpath Ventures', partner: 'Tara Quinn', round: 'pre-seed', year: 2024, domain: 'brightpath.example.com', url: 'https://brightpath.example.com/portfolio' },
  // Already in Nest: by domain, and by name.
  { firm: 'Orchard Cap.', partner: null, round: 'seed', year: '2025', domain: 'www.orchard.example.com', url: 'https://news.example.com/tinkerly-seed' },
  { firm: 'Kite Angels', partner: null, round: null, year: null, domain: null, url: 'https://deals.example.com/kite' },
  // A repeat, one with no source link, and one with a bad link: all left out.
  { firm: 'Brightpath Ventures', partner: null, round: null, year: null, domain: 'brightpath.example.com', url: 'https://deals.example.com/bp' },
  { firm: 'Ghost Fund', partner: null, round: 'seed', year: 2025, domain: 'ghost.example.com', url: null },
  { firm: 'Nowhere Fund', partner: null, round: null, year: null, domain: null, url: 'not a link' },
]

describe('Find their investors', () => {
  it('shows the estimate first, sends only the company, and keeps up to 15 with sources, marking the ones in Nest', async () => {
    const s = await setup()
    const ankur = await s.person('Ankur Mehta', { company: 'Tinkerly', companyDomain: 'tinkerly.example', email: 'ankur@tinkerly.example', notes: 'Met at a demo day' })
    const before = await s.as.query(api.network.lookupState, { introducerId: ankur })
    expect(before.run).toBeNull()
    expect(before.estimateUsd).toBeGreaterThan(0)
    expect(calls).toHaveLength(0)

    lookupAnswer = { investors: FOUND }
    await s.as.mutation(api.network.startLookup, { introducerId: ankur })
    await drain(s.t)
    const after = await s.as.query(api.network.lookupState, { introducerId: ankur })
    expect(after.run!.status).toBe('done')
    expect(after.run!.results.map((r) => [r.firm, r.investorId ?? null])).toEqual([
      ['Brightpath Ventures', null],
      ['Orchard Cap.', s.orchard],
      ['Kite Angels', s.kite],
    ])
    expect(after.run!.results[0]).toMatchObject({ partner: 'Tara Quinn', round: 'pre-seed', year: 2024, url: 'https://brightpath.example.com/portfolio' })
    expect(after.run!.results[1].year).toBe(2025)

    // Haiku with web search only; the prompt names the company and its site, never the founder.
    const req = calls[0].body as { model: string; tools: unknown; messages: { content: unknown }[] }
    expect(req.model).toMatch(/haiku/)
    expect(req.tools).toEqual([{ type: 'web_search_20260318', name: 'web_search', max_uses: 3 }])
    const sent = JSON.stringify(req)
    expect(sent).toContain('Tinkerly')
    expect(sent).toContain('tinkerly.example')
    expect(sent).not.toMatch(/Ankur|Mehta|ankur@|demo day/)
  })

  it('keeps 15 at most', async () => {
    const s = await setup()
    const ankur = await s.person('Ankur Mehta', { company: 'Tinkerly' })
    lookupAnswer = { investors: Array.from({ length: 22 }, (_, k) => ({ firm: 'Fund ' + k, partner: null, round: null, year: null, domain: 'fund' + k + '.example.com', url: 'https://fund' + k + '.example.com' })) }
    await s.as.mutation(api.network.startLookup, { introducerId: ankur })
    await drain(s.t)
    expect((await s.as.query(api.network.lookupState, { introducerId: ankur })).run!.results).toHaveLength(15)
  })

  it('records the real cost in Settings › AI spend, under Find', async () => {
    const s = await setup()
    const ankur = await s.person('Ankur Mehta', { company: 'Tinkerly' })
    lookupAnswer = { investors: FOUND }
    await s.as.mutation(api.network.startLookup, { introducerId: ankur })
    await drain(s.t)
    const run = await s.t.run(async (ctx) => (await ctx.db.query('founderLookups').collect())[0])
    // 20K in and 2K out on Haiku, plus two searches at $10 per 1,000.
    expect(run.costUsd).toBeCloseTo((20_000 * 0.1 + 2_000 * 0.5) / 1e6 + 0.02, 10)
    const ai = await s.as.query(api.enrich.data, {})
    expect(ai.spend.byFeature.find).toBeCloseTo(run.costUsd, 10)
  })

  it('needs a company and the AI key, and runs one at a time', async () => {
    const s = await setup()
    const ria = await s.person('Ria Kapoor')
    await expect(s.as.mutation(api.network.startLookup, { introducerId: ria })).rejects.toThrow(/company first/)
    const ankur = await s.person('Ankur Mehta', { company: 'Tinkerly' })
    const a = await s.as.mutation(api.network.startLookup, { introducerId: ankur })
    expect(await s.as.mutation(api.network.startLookup, { introducerId: ankur })).toBe(a)
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    await expect(s.as.mutation(api.network.startLookup, { introducerId: ria })).rejects.toThrow()
  })

  it('adds only the ticked ones: an investor in Nest gets the founder as a warm path, a new firm is Not contacted via them; each is “to ask”', async () => {
    const s = await setup()
    const ankur = await s.person('Ankur Mehta', { company: 'Tinkerly' })
    lookupAnswer = { investors: FOUND }
    const lookupId = await s.as.mutation(api.network.startLookup, { introducerId: ankur })
    await drain(s.t)
    const investorsBefore = (await s.t.run((ctx) => ctx.db.query('investors').collect())).length
    // Nothing is added without a tick.
    expect(await s.as.mutation(api.network.addFromLookup, { lookupId, picks: [] })).toEqual({ linked: 0, created: 0, added: 0 })
    expect((await s.t.run((ctx) => ctx.db.query('intros').collect())).length).toBe(0)

    expect(await s.as.mutation(api.network.addFromLookup, { lookupId, picks: [0, 1] })).toEqual({ linked: 1, created: 1, added: 2 })
    const investors = await s.t.run((ctx) => ctx.db.query('investors').collect())
    expect(investors).toHaveLength(investorsBefore + 1)
    const bp = investors.find((i) => i.name === 'Tara Quinn')!
    expect(bp).toMatchObject({ firm: 'Brightpath Ventures', stage: 'todo', source: 'Network', path: 'via Ankur Mehta', domains: ['brightpath.example.com'] })
    expect((await s.t.run((ctx) => ctx.db.get(s.orchard)))!.path).toBe('via Ankur Mehta')
    const intros = await s.t.run((ctx) => ctx.db.query('intros').collect())
    expect(intros.map((x) => [x.investorId, x.introducerId, x.steps]).sort()).toEqual([[bp._id, ankur, {}], [s.orchard, ankur, {}]].sort())
    // Ticked again: never added twice; Kite stays untouched.
    expect(await s.as.mutation(api.network.addFromLookup, { lookupId, picks: [0, 1] })).toEqual({ linked: 0, created: 0, added: 0 })
    const run = (await s.as.query(api.network.lookupState, { introducerId: ankur })).run!
    expect(run.results.map((r) => !!r.added)).toEqual([true, true, false])
  })
})

describe('Who do they know', () => {
  it('links investors from the list and adds a new firm (and partner) once, each with an intro to ask', async () => {
    const s = await setup()
    const ria = await s.person('Ria Kapoor', { relation: 'friend' })
    const r = await s.as.mutation(api.network.addTargets, { introducerId: ria, investorIds: [s.kite], fresh: [{ firm: 'Pinecone Capital', partner: 'Sam Ortiz' }, { firm: 'kite angels' }] })
    expect(r.linked).toBe(1)
    expect(r.created).toBe(1)
    const pine = (await s.t.run((ctx) => ctx.db.query('investors').collect())).find((i) => i.firm === 'Pinecone Capital')!
    expect(pine).toMatchObject({ name: 'Sam Ortiz', stage: 'todo', source: 'Network', path: 'via Ria Kapoor' })
    expect((await s.t.run((ctx) => ctx.db.query('intros').collect())).filter((x) => x.introducerId === ria)).toHaveLength(2)
  })
})

describe('Wants to invest', () => {
  it('makes an Angel at Asked, linked both ways, and counts them once', async () => {
    const s = await setup()
    const neha = await s.person('Neha Rao', { relation: 'advisor', email: 'neha@rao.example' })
    const r = await s.as.mutation(api.network.setWantsToInvest, { id: neha, on: true })
    expect(r.created).toBe(true)
    const inv = (await s.t.run((ctx) => ctx.db.get(r.investorId!)))!
    expect(inv).toMatchObject({ name: 'Neha Rao', type: 'Angel', stage: 'ask', source: 'Network', email: 'neha@rao.example' })
    const p = (await s.t.run((ctx) => ctx.db.get(neha)))!
    expect(p.investorId).toBe(r.investorId)
    expect(p.roles?.wantsToInvest).toBe(true)
    // Once they commit, they're one person in the Network, not a second derived "committed" row.
    await s.t.run((ctx) => ctx.db.patch(r.investorId!, { stage: 'signed', maxStage: 'signed', committed: 10_000 }))
    const list = await s.as.query(api.introducers.list, {})
    const investors = (await s.t.run((ctx) => ctx.db.query('investors').collect())) as unknown as Investor[]
    const people = allPeople(list.introducers as Introducer[], investors)
    expect(people.filter((x) => x.name === 'Neha Rao')).toHaveLength(1)
    expect(people.filter((x) => x.relation === 'committed').map((x) => x.name)).toEqual(['Sable Fund'])
    expect(investors.filter((i) => i.name === 'Neha Rao')).toHaveLength(1)
  })

  it('offers an investor already in Nest with the same email or name, and links it when Dev picks it', async () => {
    const s = await setup()
    const kiteP = await s.person('Kite Angels', { relation: 'angel' })
    const r = await s.as.mutation(api.network.setWantsToInvest, { id: kiteP, on: true })
    expect(r).toEqual({ offer: s.kite })
    expect((await s.t.run((ctx) => ctx.db.get(kiteP)))!.investorId).toBeUndefined()
    const n = (await s.t.run((ctx) => ctx.db.query('investors').collect())).length
    expect(await s.as.mutation(api.network.setWantsToInvest, { id: kiteP, on: true, linkTo: s.kite })).toEqual({ investorId: s.kite, created: false })
    expect((await s.t.run((ctx) => ctx.db.query('investors').collect())).length).toBe(n)
    // Nobody else can link the same investor.
    const other = await s.person('Someone Else')
    await expect(s.as.mutation(api.network.setWantsToInvest, { id: other, on: true, linkTo: s.kite })).rejects.toThrow(/already linked/)
  })

  it('switching it off unlinks without deleting the investor, and Undo links it again', async () => {
    const s = await setup()
    const neha = await s.person('Neha Rao', { relation: 'advisor' })
    const { investorId } = await s.as.mutation(api.network.setWantsToInvest, { id: neha, on: true })
    expect(await s.as.mutation(api.network.setWantsToInvest, { id: neha, on: false })).toEqual({ investorId })
    expect((await s.t.run((ctx) => ctx.db.get(neha)))!.investorId).toBeUndefined()
    expect(await s.t.run((ctx) => ctx.db.get(investorId!))).not.toBeNull()
    await s.as.mutation(api.network.setWantsToInvest, { id: neha, on: true, linkTo: investorId! })
    expect((await s.t.run((ctx) => ctx.db.get(neha)))!.investorId).toBe(investorId)
  })
})

describe('the CSV import', () => {
  it('adds the preview’s rows, skipping anyone already there by email or name, and repeats in the file', async () => {
    const s = await setup()
    await s.person('Ankur Mehta', { email: 'ankur@tinkerly.example' })
    const r = await s.as.mutation(api.network.importPeople, {
      rows: [
        { name: 'Asha Linden', email: 'asha@brightloop.example', relation: 'founder', company: 'Brightloop', notes: '' },
        { name: 'A. Mehta', email: 'ANKUR@tinkerly.example', relation: 'founder', notes: '' },
        { name: 'ankur  mehta', relation: 'friend', notes: '' },
        { name: 'Asha Linden', relation: 'friend', notes: 'twice' },
        { name: 'Ravi Moss', relation: 'friend', notes: 'College friend' },
      ],
    })
    expect(r).toMatchObject({ added: 2, skipped: 3 })
    const people = await s.t.run((ctx) => ctx.db.query('introducers').collect())
    expect(people.map((p) => [p.name, p.relation, p.company ?? null]).sort()).toEqual([['Ankur Mehta', 'founder', null], ['Asha Linden', 'founder', 'Brightloop'], ['Ravi Moss', 'friend', null]])
  })
})

describe('the intro ask', () => {
  async function ask() {
    const s = await setup()
    const ankur = await s.person('Ankur Mehta', { email: 'ankur@tinkerly.example', company: 'Tinkerly' })
    const { introIds } = await s.as.mutation(api.network.addTargets, { introducerId: ankur, investorIds: [s.orchard, s.kite, s.lantern], fresh: [] })
    return { ...s, ankur, introIds: introIds as Id<'intros'>[] }
  }

  it('names the picked investors only, keeps blanks for numbers Nest lacks, and never invents a reason', async () => {
    const s = await ask()
    askAnswer = {
      subject: 'A few intros?',
      opening: 'Hi Ankur,\n\nPesto grew 3x last month. Would you be up for introducing me to a few investors?',
      fits: [
        { name: 'Orchard Capital', why: 'They led 4 kids rounds and wrote $250K checks.' },
        { name: 'Fake Ventures', why: 'Made up.' },
      ],
      note: 'Pesto is a kids and family app with 12,000 families. We’re raising [__].',
    }
    const r = await s.as.action(api.network.writeAsk, { introIds: [s.introIds[0], s.introIds[1]] })
    const req = calls.find((c) => c.url.startsWith('https://api.anthropic.com'))!.body as { model: string; messages: { content: string }[] }
    expect(req.model).toMatch(/haiku/)
    expect(r.body).toContain('- Orchard Capital: ')
    expect(r.body).toContain('- Kite Angels: [why they fit]')
    expect(r.body).not.toContain('Fake Ventures')
    expect(r.body).not.toMatch(/3x|\$250K|12,000|\b4 kids/)
    expect(r.body).toContain('[__]')
    expect(r.to).toBe('ankur@tinkerly.example')
    const d = (await s.t.run((ctx) => ctx.db.get(r.draftId)))!
    expect(d).toMatchObject({ type: 'introAsk', introIds: [s.introIds[0], s.introIds[1]] })
  })

  it('picks up to 3 from one person, and sending it ticks Asked on each (and touches no investor)', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    const s = await ask()
    await expect(s.as.action(api.network.writeAsk, { introIds: [] })).rejects.toThrow(/up to 3/)
    askAnswer = { subject: 'Intros?', opening: 'Hi Ankur,', fits: [{ name: 'Orchard Capital', why: 'Kids and family apps.' }, { name: 'Kite Angels', why: 'Angels in consumer.' }], note: 'Pesto is a kids app.' }
    const r = await s.as.action(api.network.writeAsk, { introIds: [s.introIds[0], s.introIds[1]] })
    const input = { draftId: r.draftId, investorId: s.orchard, type: 'introAsk' as const, to: 'ankur@tinkerly.example', subject: r.subject, body: r.body, introIds: [s.introIds[0], s.introIds[1]] }
    await s.as.action(api.drafts.send, input)
    const intros = await s.t.run((ctx) => Promise.all(s.introIds.map((id) => ctx.db.get(id))))
    expect(intros.map((x) => x!.steps.asked ?? null)).toEqual([todayIST(), todayIST(), null])
    const acts = await s.t.run((ctx) => ctx.db.query('activities').collect())
    expect(acts).toHaveLength(0)
  })

  it('won’t send while a reason is still [why they fit]', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    const s = await ask()
    askAnswer = { subject: 'Intros?', opening: 'Hi Ankur,', fits: [], note: '' }
    const r = await s.as.action(api.network.writeAsk, { introIds: [s.introIds[0]] })
    await expect(s.as.action(api.drafts.send, { draftId: r.draftId, investorId: s.orchard, type: 'introAsk', to: 'ankur@tinkerly.example', subject: r.subject, body: r.body, introIds: [s.introIds[0]] })).rejects.toThrow(/why each investor fits/)
  })
})

describe('an agent’s Network suggestions', () => {
  it('wait in Suggestions, are never queued twice, and accepting (and undoing) adds the person or the intro', async () => {
    const s = await setup()
    const agent = { keyId: await s.t.run((ctx) => ctx.db.insert('agentKeys', { name: 'Grok Bot', scope: 'suggest', prefix: 'abcd1234', hash: 'x', createdAt: 0, createdBy: s.dev } as never)), name: 'Grok Bot', scope: 'suggest' as const }
    const add = { name: 'Asha Linden', relation: 'founder', company: 'Brightloop', note: 'Backed by Orchard' }
    const a = await s.t.mutation(internal.mcp.write, { tool: 'add_person', args: add, agent })
    expect(a).toMatchObject({ ok: true })
    const again = await s.t.mutation(internal.mcp.write, { tool: 'add_person', args: add, agent })
    expect(JSON.stringify(again)).toMatch(/already waiting/)
    expect((await s.t.run((ctx) => ctx.db.query('introducers').collect())).length).toBe(0)
    const sug = (await s.t.run((ctx) => ctx.db.query('suggestions').collect()))[0]
    expect(sug).toMatchObject({ kind: 'network_person', source: 'agent', status: 'open' })
    await s.as.mutation(api.suggestions.accept, { id: sug._id })
    const asha = (await s.t.run((ctx) => ctx.db.query('introducers').collect()))[0]
    expect(asha).toMatchObject({ name: 'Asha Linden', relation: 'founder', company: 'Brightloop' })

    const b = await s.t.mutation(internal.mcp.write, { tool: 'add_to_network_list', args: { person: 'asha linden', firm: 'Pinecone Capital', partner: 'Sam Ortiz' }, agent })
    expect(b).toMatchObject({ ok: true })
    const t2 = (await s.t.run((ctx) => ctx.db.query('suggestions').collect())).find((x) => x.kind === 'network_target')!
    await s.as.mutation(api.suggestions.accept, { id: t2._id })
    const pine = (await s.t.run((ctx) => ctx.db.query('investors').collect())).find((i) => i.firm === 'Pinecone Capital')!
    expect(pine).toMatchObject({ stage: 'todo', source: 'Network', path: 'via Asha Linden' })
    expect((await s.t.run((ctx) => ctx.db.query('intros').collect())).map((x) => x.introducerId)).toEqual([asha._id])
    await s.as.mutation(api.suggestions.undo, { ids: [t2._id] })
    expect(await s.t.run((ctx) => ctx.db.get(pine._id))).toBeNull()
    expect(await s.t.run((ctx) => ctx.db.query('intros').collect())).toHaveLength(0)
    // Someone already in the Network isn't suggested again.
    expect(JSON.stringify(await s.t.mutation(internal.mcp.write, { tool: 'add_person', args: { name: 'ASHA LINDEN', relation: 'friend' }, agent }))).toMatch(/already in Dev’s Network/)
  })
})
