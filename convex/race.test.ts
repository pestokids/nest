// @vitest-environment edge-runtime
// PST-295: the round's lead, "can lead" (enrichment fills it; Dev's override always
// wins), asked to lead, and updates Dev marks sent. Every firm and address is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { conform } from './lib/jsonSchema'
import { vResearch } from './lib/research'
import { todayIST } from '../src/lib/dates'
import { fieldsOf } from '../src/lib/pipeline'
import { canLeadOf } from '../src/lib/race'
import { DEFAULT_ROUND } from '../src/lib/round'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const base = { firm: '', type: 'Seed fund' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'A' as const, wave: 1 as const, lead: false, notes: '', source: '', nextStep: '', updatedAt: 0 }
const USAGE = { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, webSearches: 1 }

async function setup({ round = true } = {}) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const orchard = await ctx.db.insert('investors', { ...base, name: 'Orchard Capital', email: 'maya@orchard.example.com', stage: 'm2', maxStage: 'm2' })
    const kite = await ctx.db.insert('investors', { ...base, name: 'Kite Angels', stage: 'm1', maxStage: 'm1' })
    if (round) await ctx.db.insert('settings', { key: 'round', ...DEFAULT_ROUND })
    return { dev, orchard, kite }
  })
  const as = t.withIdentity({ subject: `${ids.dev}|s1` })
  const get = async (id: Id<'investors'>) => (await t.run((ctx) => ctx.db.get(id)))!
  /** A finished enrichment run for an investor, as Claude answered it. */
  const enriched = async (investorId: Id<'investors'>, canLead?: { value: 'yes' | 'no' | 'unknown'; reason: string }) => {
    const runId = await t.run((ctx) => ctx.db.insert('enrichRuns', { investorId, auto: false, status: 'running', steps: [], costUsd: 0, startedAt: Date.now() }))
    await t.mutation(internal.enrich.finish, { runId, facts: [], verdict: 'investor', summary: 'A seed fund.', costUsd: 0.02, model: 'claude-haiku-5-5', usage: USAGE, canLead })
    return runId
  }
  return { t, as, get, enriched, ...ids }
}

describe('can lead', () => {
  it('Claude’s answer may have it or not: older answers still count', () => {
    const answer = { verdict: 'investor', summary: 'x', person: Object.fromEntries(['name', 'title', 'rank', 'covers', 'location', 'email', 'linkedin', 'x'].map((k) => [k, null])), fund: Object.fromEntries(['name', 'website', 'domain', 'type', 'size', 'vintage', 'stage', 'check', 'leads', 'geography', 'thesis', 'recentDeals'].map((k) => [k, null])), partners: [] }
    expect(() => conform(vResearch, answer)).not.toThrow()
    expect(conform(vResearch, { ...answer, canLead: { value: 'yes', reason: 'Leads pre-seed rounds' } }).canLead?.value).toBe('yes')
    expect(() => conform(vResearch, { ...answer, canLead: { value: 'maybe', reason: '' } })).toThrow()
  })

  it('new and refreshed enrichments fill it; one that couldn’t tell keeps the earlier answer', async () => {
    const { t, get, enriched, orchard, kite } = await setup()
    const run = await enriched(orchard, { value: 'yes', reason: 'Leads pre-seed rounds of $500K–$1M' })
    expect((await get(orchard)).canLead).toMatchObject({ value: 'yes', reason: 'Leads pre-seed rounds of $500K–$1M' })
    expect(canLeadOf(await get(orchard))).toMatchObject({ on: true, from: 'enrichment' })
    await enriched(orchard, { value: 'unknown', reason: 'Nothing on their site' })
    expect((await get(orchard)).canLead?.value).toBe('yes')
    // The run keeps what it found, so a cached copy for a new investor carries it.
    expect((await t.run((ctx) => ctx.db.get(run)))?.canLead?.value).toBe('yes')
    // An answer without it leaves the investor as it was.
    await enriched(kite)
    expect((await get(kite)).canLead).toBeUndefined()
  })

  it('Dev’s switch always wins, also over a later enrichment, and keeps “Can lead or anchor” in step', async () => {
    const { as, get, enriched, orchard } = await setup()
    await enriched(orchard, { value: 'yes', reason: 'Leads pre-seed rounds' })
    await as.mutation(api.race.setCanLead, { investorId: orchard, on: false })
    expect(await get(orchard)).toMatchObject({ leadOverride: false, lead: false })
    await enriched(orchard, { value: 'yes', reason: 'Leads pre-seed rounds' })
    expect(canLeadOf(await get(orchard))).toMatchObject({ on: false, from: 'you' })
    await as.mutation(api.race.setCanLead, { investorId: orchard, on: true })
    expect(canLeadOf(await get(orchard))).toMatchObject({ on: true, from: 'you', reason: 'Leads pre-seed rounds' })
  })

  it('the edit form keeps the lead fields, and ticking “Can lead or anchor” is Dev’s word too', async () => {
    const { as, get, enriched, kite } = await setup()
    await enriched(kite, { value: 'no', reason: 'Follows a lead' })
    await as.mutation(api.race.setLeadAsked, { investorId: kite, on: true })
    const before = await get(kite)
    await as.mutation(api.investors.upsert, { id: kite, fields: { ...fieldsOf(before), nextStep: 'Send the deck' } })
    expect(await get(kite)).toMatchObject({ nextStep: 'Send the deck', canLead: before.canLead, leadAskedOn: todayIST() })
    expect((await get(kite)).leadOverride).toBeUndefined()
    await as.mutation(api.investors.upsert, { id: kite, fields: { ...fieldsOf(before), lead: true } })
    expect(canLeadOf(await get(kite))).toMatchObject({ on: true, from: 'you' })
  })
})

describe('the round’s lead', () => {
  it('is set and cleared, logged, kept by the round form, and goes with the investor', async () => {
    const { as, orchard, kite } = await setup()
    expect((await as.query(api.race.data, {})).leadId).toBeNull()
    expect(await as.mutation(api.race.setLead, { investorId: kite })).toEqual({ before: null })
    expect(await as.mutation(api.race.setLead, { investorId: orchard })).toEqual({ before: kite })
    expect((await as.query(api.race.data, {})).leadId).toBe(orchard)
    const log = await as.query(api.settings.log, {})
    expect(log.map((l) => [l.field, l.from, l.to])).toEqual([['leadId', 'Kite Angels', 'Orchard Capital'], ['leadId', '', 'Kite Angels']])

    // Saving the round form keeps it; the form never sees it.
    const { round } = await as.query(api.settings.get, {})
    expect(round).not.toHaveProperty('leadId')
    await as.mutation(api.settings.update, { round: { ...round, quietDays: 5 } })
    expect((await as.query(api.race.data, {})).leadId).toBe(orchard)

    await as.mutation(api.investors.remove, { id: orchard })
    expect((await as.query(api.race.data, {})).leadId).toBeNull()
  })

  it('needs the round saved first', async () => {
    const { as, orchard } = await setup({ round: false })
    await expect(as.mutation(api.race.setLead, { investorId: orchard })).rejects.toThrow(/Save the round first/)
  })
})

describe('asked to lead', () => {
  it('ticks when the “Ask if they’ll lead” draft goes out, and by hand', async () => {
    const { as, get, orchard, kite } = await setup()
    const c = await as.mutation(api.drafts.copied, { investorId: orchard, type: 'lead', to: '', subject: 'Would you lead?', body: 'Hi,\n\nWould you lead the round?\n\nDev', via: 'copy' })
    expect((await get(orchard)).leadAskedOn).toBeUndefined()
    await as.mutation(api.drafts.markSent, { draftId: c.draftId })
    expect((await get(orchard)).leadAskedOn).toBe(todayIST())
    // Any other draft leaves it alone.
    const f = await as.mutation(api.drafts.copied, { investorId: kite, type: 'followup', to: '', subject: 'Deck', body: 'Here it is.\n\nDev', via: 'copy' })
    await as.mutation(api.drafts.markSent, { draftId: f.draftId })
    expect((await get(kite)).leadAskedOn).toBeUndefined()
    await as.mutation(api.race.setLeadAsked, { investorId: orchard, on: false })
    expect((await get(orchard)).leadAskedOn).toBeUndefined()
  })
})

describe('who to update', () => {
  it('Dev marks an update sent; Undo takes it back. Nothing is sent.', async () => {
    const { as } = await setup()
    expect((await as.query(api.race.data, {})).lastUpdate).toBeNull()
    const id = await as.mutation(api.race.markUpdateSent, { count: 7 })
    expect((await as.query(api.race.data, {})).lastUpdate).toMatchObject({ sentOn: todayIST(), count: 7, by: 'Dev' })
    await as.mutation(api.race.undoUpdateSent, { id })
    expect((await as.query(api.race.data, {})).lastUpdate).toBeNull()
  })
})
