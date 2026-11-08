// @vitest-environment edge-runtime
// PST-302: the application field, free stage moves with one from → to entry,
// corrections resetting maxStage, and the connector's notes, outreach and
// application kinds with their no-op, duplicate and dismissed rules. Made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
  vi.stubEnv('SITE_URL', 'https://nest.example.com')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

type InvFields = Partial<Omit<Doc<'investors'>, '_id' | '_creationTime'>> & Pick<Doc<'investors'>, 'name' | 'stage'>
const base = { firm: '', type: 'Accelerator' as const, geo: 'India' as const, warmth: 'cold' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const inv = (f: InvFields) => ctx.db.insert('investors', { ...base, maxStage: f.stage as Doc<'investors'>['maxStage'], ...f })
    const north = await inv({ name: 'Northwind Accelerator', firm: 'Northwind', stage: 'ask', notes: 'Wants week-4 retention.', path: 'Applied' })
    const bird = await inv({ name: 'Bluebird Seed', firm: 'Bluebird', stage: 'todo' })
    return { dev, north, bird }
  })
  const as = t.withIdentity({ subject: ids.dev + '|s1' })
  const agent = await as.mutation(api.agents.create, { name: 'Claude', scope: 'suggest' })
  let n = 0
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await t.fetch('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + agent.key, 'MCP-Protocol-Version': '2025-06-18' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }),
    })
    return (await res.json()).result as { isError: boolean; structuredContent: Record<string, unknown>; content: { text: string }[] }
  }
  const moves = (id: Id<'investors'>) => t.run((ctx) => ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()).then((xs) => xs.filter((a) => a.kind === 'stage'))
  const get = (id: Id<'investors'>) => t.run((ctx) => ctx.db.get(id))
  return { t, as, ...ids, call, moves, get }
}

describe('the application field', () => {
  it('sets, cleans and clears the application without moving the stage', async () => {
    const s = await setup()
    const r = await s.as.mutation(api.applications.set, { id: s.north, application: { status: 'submitted', program: '  W27 ', submittedOn: '2030-03-01', decisionBy: 'later' } })
    expect(r).toEqual({ before: null })
    expect(await s.get(s.north)).toMatchObject({ stage: 'ask', maxStage: 'ask', application: { status: 'submitted', program: 'W27', submittedOn: '2030-03-01' } })
    expect((await s.get(s.north))!.application!.decisionBy).toBeUndefined()
    expect(await s.moves(s.north)).toHaveLength(0)
    expect(await s.as.mutation(api.applications.set, { id: s.north, application: null })).toEqual({ before: { status: 'submitted', program: 'W27', submittedOn: '2030-03-01' } })
    expect((await s.get(s.north))!.application).toBeUndefined()
  })
})

describe('the Application row saves only what Dev touched (PST-303)', () => {
  it('a status change keeps a decision date set elsewhere meanwhile', async () => {
    const s = await setup()
    await s.as.mutation(api.applications.set, { id: s.north, application: { status: 'submitted', program: 'C12' } })
    // An agent's accepted suggestion sets the decision date while the drawer is open…
    await s.t.run((ctx) => ctx.db.patch(s.north, { application: { status: 'submitted', program: 'C12', decisionBy: '2030-03-20' } }))
    // …and Dev picks Interview invited from the row, which still showed no date.
    const r = await s.as.mutation(api.applications.change, { id: s.north, changes: { status: 'interview_invited' } })
    expect(r.before).toEqual({ status: 'submitted', program: 'C12', decisionBy: '2030-03-20' })
    expect((await s.get(s.north))!.application).toEqual({ status: 'interview_invited', program: 'C12', decisionBy: '2030-03-20' })
    await s.as.mutation(api.applications.change, { id: s.north, changes: { decisionBy: null } })
    expect((await s.get(s.north))!.application).toEqual({ status: 'interview_invited', program: 'C12' })
    expect(await s.moves(s.north)).toHaveLength(0)
  })
  it('needs a status before any other field', async () => {
    const s = await setup()
    await expect(s.as.mutation(api.applications.change, { id: s.bird, changes: { program: 'W27' } })).rejects.toThrow('Pick a status')
  })
})

describe('free stage moves', () => {
  it('a jump of several stages logs exactly one from → to activity', async () => {
    const s = await setup()
    const r = await s.as.mutation(api.investors.move, { id: s.bird, stage: 'm1' })
    const acts = await s.moves(s.bird)
    expect(acts).toHaveLength(1)
    expect(acts[0]).toMatchObject({ stage: 'm1', fromStage: 'todo', userId: s.dev })
    expect(r.activityId).toBe(acts[0]._id)
    expect(await s.get(s.bird)).toMatchObject({ stage: 'm1', maxStage: 'm1' })
  })
  it('moving back to Not contacted logs one activity too, and maxStage stays', async () => {
    const s = await setup()
    await s.as.mutation(api.investors.move, { id: s.north, stage: 'todo' })
    const acts = await s.moves(s.north)
    expect(acts.map((a) => [a.fromStage, a.stage])).toEqual([['ask', 'todo']])
    expect(await s.get(s.north)).toMatchObject({ stage: 'todo', maxStage: 'ask' })
  })
})

describe('corrections', () => {
  it('marking a move back as a correction resets maxStage; taking it off restores it', async () => {
    const s = await setup()
    await s.as.mutation(api.investors.move, { id: s.bird, stage: 'intro' })
    const back = await s.as.mutation(api.investors.move, { id: s.bird, stage: 'todo' })
    expect((await s.get(s.bird))!.maxStage).toBe('intro')
    expect(await s.as.mutation(api.applications.markCorrection, { activityId: back.activityId!, on: true })).toEqual({ maxStage: 'todo' })
    expect((await s.get(s.bird))!.maxStage).toBe('todo')
    expect((await s.t.run((ctx) => ctx.db.get(back.activityId!)))!.correction).toEqual({ maxBefore: 'intro' })
    expect(await s.as.mutation(api.applications.markCorrection, { activityId: back.activityId!, on: false })).toEqual({ maxStage: 'intro' })
    expect((await s.get(s.bird))!.maxStage).toBe('intro')
  })
  it('only a move back, and only while it is the latest', async () => {
    const s = await setup()
    const fwd = await s.as.mutation(api.investors.move, { id: s.bird, stage: 'intro' })
    await expect(s.as.mutation(api.applications.markCorrection, { activityId: fwd.activityId!, on: true })).rejects.toThrow('Only a move back')
    const back = await s.as.mutation(api.investors.move, { id: s.bird, stage: 'ask' })
    await s.as.mutation(api.investors.move, { id: s.bird, stage: 'booked' })
    await expect(s.as.mutation(api.applications.markCorrection, { activityId: back.activityId!, on: true })).rejects.toThrow('moved again')
  })
})

describe('connector: notes, outreach and application', () => {
  it('each new kind waits in Suggestions and applies only on accept, with Undo', async () => {
    const s = await setup()
    const notes = await s.call('suggest_change', { investorId: s.north, kind: 'notes', mode: 'replace', text: 'Wants week-6 retention.', why: 'Corrected on the call.' })
    const outreach = await s.call('suggest_change', { investorId: s.north, kind: 'outreach', warmPath: 'Mira (ex-colleague)', warmth: 'warm', why: 'Mira knows the partner.' })
    const application = await s.call('suggest_change', { investorId: s.north, kind: 'application', value: 'interview_invited', program: 'C12', decisionBy: '2030-03-20', why: 'Interview invite came in.' })
    for (const r of [notes, outreach, application]) expect(r.structuredContent).toMatchObject({ suggested: true })
    expect(await s.get(s.north)).toMatchObject({ notes: 'Wants week-4 retention.', path: 'Applied', warmth: 'cold' })
    expect((await s.get(s.north))!.application).toBeUndefined()

    const ids = [notes, outreach, application].map((r) => r.structuredContent.suggestionId as Id<'suggestions'>)
    for (const id of ids) expect(await s.as.mutation(api.suggestions.accept, { id })).toEqual({ applied: true })
    expect(await s.get(s.north)).toMatchObject({ stage: 'ask', notes: 'Wants week-6 retention.', path: 'Mira (ex-colleague)', warmth: 'warm', application: { status: 'interview_invited', program: 'C12', decisionBy: '2030-03-20' } })
    expect(await s.moves(s.north)).toHaveLength(0)

    await s.as.mutation(api.suggestions.undo, { ids })
    expect(await s.get(s.north)).toMatchObject({ notes: 'Wants week-4 retention.', path: 'Applied', warmth: 'cold' })
    expect((await s.get(s.north))!.application).toBeUndefined()
  })
  it('appending a correction keeps the notes and adds to the end', async () => {
    const s = await setup()
    const r = await s.call('suggest_change', { investorId: s.north, kind: 'notes', text: 'Correction: week-6, not week-4.', why: 'Corrected on the call.' })
    await s.as.mutation(api.suggestions.accept, { id: r.structuredContent.suggestionId as Id<'suggestions'> })
    const notes = (await s.get(s.north))!.notes
    expect(notes.startsWith('Wants week-4 retention.')).toBe(true)
    expect(notes.endsWith('Correction: week-6, not week-4.')).toBe(true)
  })
  it('no suggestion when it is a no-op, already open, or dismissed before; each says why', async () => {
    const s = await setup()
    const noop = await s.call('suggest_change', { investorId: s.north, kind: 'notes', text: 'week-4 retention', why: 'x' })
    expect(noop.isError).toBe(true)
    expect(noop.content[0].text).toContain('already include')
    expect((await s.call('suggest_change', { investorId: s.north, kind: 'stage', value: 'ask', why: 'x' })).content[0].text).toContain('already at')

    const args = { investorId: s.north, kind: 'application', value: 'submitted', program: 'C12', why: 'They applied.' }
    const first = await s.call('suggest_change', args)
    expect(first.structuredContent).toMatchObject({ suggested: true })
    expect((await s.call('suggest_change', args)).structuredContent).toMatchObject({ suggested: false, reason: 'duplicate' })
    await s.as.mutation(api.suggestions.dismiss, { id: first.structuredContent.suggestionId as Id<'suggestions'> })
    const again = await s.call('suggest_change', args)
    expect(again.structuredContent).toMatchObject({ suggested: false, reason: 'dismissed' })
    expect(String(again.structuredContent.message)).toContain('dismissed')

    const step = { investorId: s.north, kind: 'next_step', value: 'Email the partners a progress update', why: 'x' }
    expect((await s.call('suggest_change', step)).structuredContent).toMatchObject({ suggested: true })
    expect((await s.call('suggest_change', step)).structuredContent).toMatchObject({ suggested: false, reason: 'duplicate' })
    const outreach = { investorId: s.north, kind: 'outreach', warmth: 'warm', why: 'x' }
    expect((await s.call('suggest_change', outreach)).structuredContent).toMatchObject({ suggested: true })
    expect((await s.call('suggest_change', outreach)).structuredContent).toMatchObject({ suggested: false, reason: 'duplicate' })
  })
  it('refuses an intro ask that stands for an application, and a wait as a next step', async () => {
    const s = await setup()
    const bird = await s.call('suggest_change', { investorId: s.bird, kind: 'stage', value: 'ask', why: 'Dev applied to their programme.' })
    expect(bird.isError).toBe(true)
    expect(bird.content[0].text).toContain('kind application')
    const wait = await s.call('suggest_change', { investorId: s.north, kind: 'next_step', value: 'Awaiting decision', why: 'x' })
    expect(wait.isError).toBe(true)
    expect(wait.content[0].text).toContain('isn’t a next step')
  })
  it('accepting an agent’s stage suggestion logs one move by the agent', async () => {
    const s = await setup()
    const r = await s.call('suggest_change', { investorId: s.bird, kind: 'stage', value: 'intro', why: 'Ria made the intro.' })
    await s.as.mutation(api.suggestions.accept, { id: r.structuredContent.suggestionId as Id<'suggestions'> })
    expect((await s.moves(s.bird)).map((a) => [a.fromStage, a.stage, a.via])).toEqual([['todo', 'intro', 'agent']])
  })
})
