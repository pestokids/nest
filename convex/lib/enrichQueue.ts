// PST-274: the enrichment queue. Every lookup (a click, a bulk Enrich, or an
// automatic one for a new sender or a new investor) is queued here and at most
// MAX_RUNNING run at once. Automatic lookups follow the Settings toggles, a daily
// cap, and a 30-day cache by email and domain.
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Doc, Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { hasAIKey } from './anthropic'
import { INVESTOR_STEPS, SENDER_STEPS } from './research'
import { firmDomain, investorWrite } from '../../src/lib/enrich'
import { todayIST } from '../../src/lib/dates'
import { DAY_MS, domainOf, GENERIC_DOMAINS, isOurs, normEmail } from '../../src/lib/google'
import { AI_MODEL, modelFor, type Feature, type Model, type ModelChoice } from '../../src/lib/models'

export const MAX_RUNNING = 2
export const DAILY_AUTO_CAP = 30
export const CACHE_DAYS = 30
/** A run still "running" after this long died without saying so. */
export const STALE_MS = 10 * 6e4

export const AI_DEFAULTS = { lookups: true, enrichNew: true, meetingNotes: true, morningBrief: true }

export async function aiSettings(ctx: QueryCtx) {
  const row = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', 'ai')).unique()
  if (row?.key !== 'ai') return { ...AI_DEFAULTS }
  return {
    lookups: row.lookups ?? AI_DEFAULTS.lookups,
    enrichNew: row.enrichNew ?? AI_DEFAULTS.enrichNew,
    meetingNotes: row.meetingNotes ?? AI_DEFAULTS.meetingNotes,
    morningBrief: row.morningBrief ?? AI_DEFAULTS.morningBrief,
  }
}

/** PST-273: Settings › AI's models: the default (AI_MODEL until one is picked) and each feature's own. */
export async function modelChoice(ctx: QueryCtx): Promise<ModelChoice> {
  const row = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', 'ai')).unique()
  if (row?.key !== 'ai') return { default: AI_MODEL, features: {} }
  return { default: row.model ?? AI_MODEL, features: row.models ?? {} }
}

/** The model a feature runs on now. */
export const featureModel = async (ctx: QueryCtx, f: Feature): Promise<Model> => modelFor(await modelChoice(ctx), f)

/** Automatic lookups still allowed today (IST): cache hits don't count. */
export async function capLeft(ctx: QueryCtx, now = Date.now()) {
  const since = Date.parse(todayIST(now) + 'T00:00:00+05:30')
  const runs = await ctx.db.query('enrichRuns').withIndex('by_started', (q) => q.gte('startedAt', since)).collect()
  return Math.max(0, DAILY_AUTO_CAP - runs.filter((r) => r.auto && !r.cached).length)
}

/** `model`: a one-off on another model (Redo with Sonnet); left out, the run uses the Enrichment model when it starts. */
type Target = { investorId?: Id<'investors'>; email?: string; domain?: string; auto: boolean; model?: Model }

/** Queue a lookup and start it if a slot is free. */
export async function queue(ctx: MutationCtx, t: Target): Promise<Id<'enrichRuns'>> {
  const steps = (t.investorId ? INVESTOR_STEPS : SENDER_STEPS).map((label) => ({ label, state: 'waiting' as const }))
  const id = await ctx.db.insert('enrichRuns', { ...t, status: 'queued', steps, costUsd: 0, startedAt: Date.now() })
  await pump(ctx)
  return id
}

/** Start queued runs, oldest first, while fewer than MAX_RUNNING are running. Clears runs that died. */
export async function pump(ctx: MutationCtx) {
  const now = Date.now()
  let live = 0
  for (const r of await ctx.db.query('enrichRuns').withIndex('by_status', (q) => q.eq('status', 'running')).collect()) {
    if (r.startedAt < now - STALE_MS) await ctx.db.patch(r._id, { status: 'failed', error: 'Took too long', finishedAt: now })
    else live++
  }
  if (live >= MAX_RUNNING) return
  const next = await ctx.db.query('enrichRuns').withIndex('by_status', (q) => q.eq('status', 'queued')).take(MAX_RUNNING - live)
  for (const r of next) {
    const model = r.model ?? (await featureModel(ctx, 'enrich'))
    await ctx.db.patch(r._id, { status: 'running', startedAt: now, model, steps: r.steps.map((s, i) => (i === 0 ? { ...s, state: 'running' as const } : s)) })
    await ctx.scheduler.runAfter(0, internal.enrich.execute, { runId: r._id })
  }
}

/** A finished lookup of this email (else this domain) in the last 30 days. */
async function cached(ctx: QueryCtx, email?: string, domain?: string): Promise<{ run: Doc<'enrichRuns'>; by: 'email' | 'domain' } | null> {
  const since = Date.now() - CACHE_DAYS * DAY_MS
  const done = (r: Doc<'enrichRuns'>) => r.status === 'done' && !!r.factCount
  if (email) {
    const rows = await ctx.db.query('enrichRuns').withIndex('by_email', (q) => q.eq('email', email).gte('startedAt', since)).order('desc').collect()
    const r = rows.find(done)
    if (r) return { run: r, by: 'email' }
  }
  if (domain) {
    const rows = await ctx.db.query('enrichRuns').withIndex('by_domain', (q) => q.eq('domain', domain).gte('startedAt', since)).order('desc').collect()
    const r = rows.find(done)
    if (r) return { run: r, by: 'domain' }
  }
  return null
}

/** A done run for an investor, from a cached one: its facts copied (the fund's only, when matched by domain), as pending. */
/**
 * Suggestions › Enrichment (PST-275's queue): one review row per investor run with
 * facts waiting, removed once they're all kept or dismissed. A row someone
 * dismissed stays dismissed.
 */
export async function syncReview(ctx: MutationCtx, runId: Id<'enrichRuns'>) {
  const run = await ctx.db.get(runId)
  if (!run?.investorId) return
  const left = (await ctx.db.query('facts').withIndex('by_run', (q) => q.eq('runId', runId)).collect()).filter((f) => f.status === 'pending').length
  const key = 'enrich:' + runId
  const row = await ctx.db.query('suggestions').withIndex('by_key', (q) => q.eq('key', key)).first()
  if (!left) {
    if (row?.status === 'open') await ctx.db.delete(row._id)
    return
  }
  const inv = await ctx.db.get(run.investorId)
  if (row || !inv) return
  await ctx.db.insert('suggestions', {
    kind: 'enrichment', investorId: inv._id, title: 'Nest found ' + left + (left === 1 ? ' thing' : ' things') + ' about ' + inv.name + '.', fix: 'Keep what’s right in the drawer',
    patch: { op: 'review' }, source: 'enrich', safe: false, status: 'open', key, createdAt: Date.now(),
  })
}

async function copyRun(ctx: MutationCtx, src: Doc<'enrichRuns'>, inv: Doc<'investors'>, fundOnly: boolean, t: Target) {
  const now = Date.now()
  const facts = (await ctx.db.query('facts').withIndex('by_run', (q) => q.eq('runId', src._id)).collect()).filter((f) => f.status !== 'dismissed' && (!fundOnly || f.group === 'fund'))
  const runId = await ctx.db.insert('enrichRuns', {
    ...t, auto: true, cached: true, status: 'done', steps: src.steps.map((s) => ({ ...s, state: 'done' as const })), costUsd: 0, startedAt: now, finishedAt: now,
    factCount: facts.length, ...(src.verdict ? { verdict: src.verdict } : {}), ...(src.summary ? { summary: src.summary } : {}),
  })
  for (const f of facts) {
    const clash = investorWrite(inv, f).clash
    await ctx.db.insert('facts', {
      runId, investorId: inv._id, group: f.group, field: f.field, value: f.value, source: f.source, confidence: f.confidence, status: 'pending',
      ...(t.email ? { email: t.email } : {}), ...(clash ? { clash } : {}), ...(f.amount ? { amount: f.amount } : {}), ...(f.person ? { person: f.person } : {}),
    })
  }
  await syncReview(ctx, runId)
}

/** New investors (added or imported): look each up when the toggle is on, from the cache when it can, within the daily cap. */
export async function autoEnrich(ctx: MutationCtx, ids: Id<'investors'>[]) {
  if (!ids.length || !hasAIKey() || !(await aiSettings(ctx)).enrichNew) return
  let left = await capLeft(ctx)
  for (const id of ids) {
    const inv = await ctx.db.get(id)
    if (!inv) continue
    const t: Target = { investorId: id, auto: true, ...(normEmail(inv.email) ? { email: normEmail(inv.email) } : {}), ...(firmDomain(inv) ? { domain: firmDomain(inv) } : {}) }
    const hit = await cached(ctx, t.email, t.domain)
    if (hit) {
      await copyRun(ctx, hit.run, inv, hit.by === 'domain', t)
      continue
    }
    if (left <= 0) continue
    left--
    await queue(ctx, t)
  }
}

/** New people in Who's this?: look each one up once when the toggle is on, within the daily cap. */
export async function autoLookup(ctx: MutationCtx, emails: string[]) {
  if (!emails.length || !hasAIKey() || !(await aiSettings(ctx)).lookups) return
  let left = await capLeft(ctx)
  const since = Date.now() - CACHE_DAYS * DAY_MS
  for (const raw of new Set(emails.map(normEmail))) {
    if (!raw || isOurs(raw) || left <= 0) continue
    const seen = await ctx.db.query('enrichRuns').withIndex('by_email', (q) => q.eq('email', raw).gte('startedAt', since)).collect()
    if (seen.some((r) => r.status !== 'failed' && r.status !== 'stopped')) continue
    left--
    await queue(ctx, { email: raw, auto: true, ...(GENERIC_DOMAINS.has(domainOf(raw)) ? {} : { domain: domainOf(raw) }) })
  }
}

/** An investor was deleted: its people and facts go too. Its runs stay (they're this month's spend), unlinked, and stop if running. */
export async function forgetInvestor(ctx: MutationCtx, id: Id<'investors'>) {
  for (const p of await ctx.db.query('people').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()) await ctx.db.delete(p._id)
  for (const f of await ctx.db.query('facts').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()) await ctx.db.delete(f._id)
  for (const r of await ctx.db.query('enrichRuns').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()) {
    const active = r.status === 'queued' || r.status === 'running'
    await ctx.db.patch(r._id, { investorId: undefined, ...(active ? { status: 'stopped' as const, finishedAt: Date.now() } : {}) })
  }
}
