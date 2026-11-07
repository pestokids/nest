// PST-274: investor enrichment. From an investor's name, email or firm (or a new
// sender's address), Claude with web search finds who the person is and what their
// fund does. Every fact has a source, and nothing reaches the investor until it's
// kept. Runs are queued (lib/enrichQueue.ts) and write their steps as they go, so
// the drawer updates live. Logs carry ids only: never names or email addresses.
import { ConvexError, v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { AIError, extractJson, hasAIKey, NoAIKey, PRICES, research, usageRow, type RunUsage } from './lib/anthropic'
import { conform, SchemaError } from './lib/jsonSchema'
import { factsFrom, investorPrompt, parseStep, senderPrompt, SYSTEM, vResearch } from './lib/research'
import { aiSettings, CACHE_DAYS, capLeft, featureModel, modelChoice, pump, queue, syncReview } from './lib/enrichQueue'
import { saveInvestor } from './investors'
import { vNewFact, vStep, vVerdict } from './enrichSchema'
import { vFeature, vModel, vUsage } from './validators'
import { asRank, firmDomain, investorWrite, NO_AI_KEY, type RecentRun } from '../src/lib/enrich'
import { todayIST } from '../src/lib/dates'
import { DAY_MS, domainOf, GENERIC_DOMAINS, nameFromEmail, normEmail } from '../src/lib/google'
import { fieldsOf, NEW_INVESTOR } from '../src/lib/pipeline'
import { averageUsage, FEATURES, LEGACY_MODEL, MODELS, type Feature, type Model } from '../src/lib/models'

const noKey = () => new ConvexError({ code: NO_AI_KEY, message: 'AI isn’t set up here.' })
const active = (r: Doc<'enrichRuns'>) => r.status === 'queued' || r.status === 'running'
const factKey = (f: { group: string; field: string; value: string }) => f.group + '.' + f.field + ':' + f.value.trim().toLowerCase()
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
/** PST-273: the latest runs with stored usage that a feature's estimate averages. */
const REAL_RUNS = 50

/* ---------- what the app reads ---------- */

/**
 * Everything outside the drawer: whether AI is set up, the toggles, this month's
 * spend, each investor's latest run (the Enriched column and the bulk toast),
 * looked-up senders with their facts (Who's this?) and the recent runs (Settings).
 */
export const data = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const now = Date.now()
    const monthStart = Date.parse(todayIST(now).slice(0, 8) + '01T00:00:00+05:30')
    const runs = await ctx.db.query('enrichRuns').withIndex('by_started').order('desc').take(2000)
    const month = runs.filter((r) => r.startedAt >= monthStart)
    // PST-277: reading meeting notes counts toward this month's spend.
    const reads = await ctx.db.query('noteReads').withIndex('by_started', (q) => q.gte('startedAt', monthStart)).collect()
    const pending = new Map<string, number>()
    for (const f of await ctx.db.query('facts').withIndex('by_status', (q) => q.eq('status', 'pending')).collect())
      if (f.investorId) pending.set(f.investorId, (pending.get(f.investorId) ?? 0) + 1)
    const latest = new Map<string, Doc<'enrichRuns'>>()
    const senderRuns = new Map<string, Doc<'enrichRuns'>>()
    for (const r of runs) {
      if (r.investorId && !latest.has(r.investorId)) latest.set(r.investorId, r)
      if (!r.investorId && r.email && r.startedAt >= now - CACHE_DAYS * DAY_MS && !senderRuns.has(r.email)) senderRuns.set(r.email, r)
    }
    const senders = []
    for (const [email, run] of senderRuns) {
      const facts = (await ctx.db.query('facts').withIndex('by_run', (q) => q.eq('runId', run._id)).collect()).filter((f) => f.status !== 'dismissed' && !f.investorId)
      senders.push({ email, run, facts })
    }
    // PST-279: Ask Nest and the morning brief count toward the spend and show in Recent runs. Only you see your own questions.
    const asks = await ctx.db.query('askRuns').withIndex('by_started', (q) => q.gte('startedAt', monthStart)).collect()
    const briefs = await ctx.db.query('briefs').withIndex('by_built', (q) => q.gte('builtAt', monthStart)).collect()
    const recent: RecentRun[] = []
    for (const r of runs.slice(0, 8)) {
      const inv = r.investorId ? await ctx.db.get(r.investorId) : null
      recent.push({
        _id: r._id, at: r.finishedAt ?? r.startedAt, investor: inv?.name, email: r.email, wasInvestor: !!r.investorId, facts: r.factCount ?? 0, costUsd: r.costUsd, status: r.status, cached: !!r.cached,
        ...(r.cached || r.status === 'queued' ? {} : { model: r.model ?? LEGACY_MODEL.enrich }),
      })
    }
    for (const a of asks.slice(-8))
      recent.push({
        _id: a._id, at: a.finishedAt ?? a.startedAt, kind: 'ask', ...(a.userId === userId ? { question: a.question } : {}), tools: a.tools.length, wasInvestor: false, facts: 0, costUsd: a.costUsd,
        status: a.status === 'done' || a.status === 'failed' ? a.status : 'running', cached: false, model: a.model ?? LEGACY_MODEL.ask,
      })
    for (const b of briefs.slice(-8)) recent.push({ _id: b._id, at: b.builtAt, kind: 'brief', moves: b.moves.length, wasInvestor: false, facts: 0, costUsd: b.costUsd, status: 'done', cached: false, model: b.model ?? LEGACY_MODEL.brief })
    recent.sort((x, y) => y.at - x.at)
    // PST-273: Drafts count toward the spend too, and every feature's runs this month (by model) and its real usage feed Settings › AI's Model section.
    const drafts = await ctx.db.query('drafts').withIndex('by_created', (q) => q.gte('createdAt', monthStart)).collect()
    const rows: Record<Feature, { model?: Model; usage?: RunUsage; costUsd: number }[]> = {
      enrich: month.filter((r) => !r.cached), notes: reads.filter((r) => r.status !== 'reading'), drafts: drafts.filter((d) => d.costUsd > 0), ask: asks, brief: briefs,
    }
    const lastRuns = {
      enrich: runs.filter((r) => !r.cached),
      notes: await ctx.db.query('noteReads').withIndex('by_started').order('desc').take(REAL_RUNS * 4),
      drafts: await ctx.db.query('drafts').withIndex('by_created').order('desc').take(REAL_RUNS * 4),
      ask: await ctx.db.query('askRuns').withIndex('by_started').order('desc').take(REAL_RUNS * 4),
      brief: await ctx.db.query('briefs').withIndex('by_built').order('desc').take(REAL_RUNS * 2),
    }
    const byModel = Object.fromEntries(MODELS.map((m) => [m, 0])) as Record<Model, number>
    const byFeature = Object.fromEntries(FEATURES.map((k) => [k, 0])) as Record<Feature, number>
    const features = {} as Record<Feature, { month: number; real: ReturnType<typeof averageUsage> }>
    for (const k of FEATURES) {
      for (const r of rows[k]) {
        byModel[r.model ?? LEGACY_MODEL[k]] += r.costUsd
        byFeature[k] += r.costUsd
      }
      const used = (lastRuns[k] as { usage?: RunUsage }[]).flatMap((r) => (r.usage ? [r.usage] : [])).slice(0, REAL_RUNS)
      features[k] = { month: rows[k].length, real: averageUsage(used) }
    }
    return {
      connected: hasAIKey(),
      settings: await aiSettings(ctx),
      models: await modelChoice(ctx),
      features,
      spend: { byModel, byFeature },
      month: {
        usd: [...month, ...reads, ...asks, ...briefs, ...drafts].reduce((s, r) => s + r.costUsd, 0),
        asks: asks.length,
        noteReads: reads.filter((r) => r.status !== 'reading').length,
        lookups: month.filter((r) => !r.investorId && !r.cached).length,
        enrichments: month.filter((r) => r.investorId && !r.cached).length,
      },
      capLeft: await capLeft(ctx, now),
      runs: [...latest.values()].map((r) => ({ ...r, pending: pending.get(r.investorId!) ?? 0 })),
      senders,
      recent: recent.slice(0, 8),
    }
  },
})

/** The drawer: the investor's latest run (steps live while it runs), its facts to review and kept, and its people. */
export const forInvestor = query({
  args: { investorId: v.id('investors') },
  handler: async (ctx, { investorId }) => {
    await requireUser(ctx)
    const run = await ctx.db.query('enrichRuns').withIndex('by_investor', (q) => q.eq('investorId', investorId)).order('desc').first()
    const facts = (await ctx.db.query('facts').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()).filter((f) => f.status !== 'dismissed')
    const people = await ctx.db.query('people').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()
    return { run, facts, people: people.sort((a, b) => Number(b.primary) - Number(a.primary) || a._creationTime - b._creationTime) }
  },
})

/* ---------- starting and stopping ---------- */

const targetOf = (inv: Doc<'investors'>, auto: boolean) => {
  const email = normEmail(inv.email)
  const domain = firmDomain(inv)
  return { investorId: inv._id, auto, ...(email ? { email } : {}), ...(domain ? { domain } : {}) }
}

async function openRun(ctx: MutationCtx, investorId: Id<'investors'>) {
  return (await ctx.db.query('enrichRuns').withIndex('by_investor', (q) => q.eq('investorId', investorId)).order('desc').take(5)).find(active)
}

/** Enrich (or Refresh) in the drawer: always a fresh lookup, never the cache. PST-273: `model` makes it a one-off on that model (Redo with Sonnet), leaving the setting alone. */
export const enrich = mutation({
  args: { investorId: v.id('investors'), model: v.optional(vModel) },
  handler: async (ctx, { investorId, model }) => {
    await requireUser(ctx)
    if (!hasAIKey()) throw noKey()
    const inv = await ctx.db.get(investorId)
    if (!inv) throw new ConvexError('That investor was deleted')
    return (await openRun(ctx, investorId))?._id ?? (await queue(ctx, { ...targetOf(inv, false), ...(model ? { model } : {}) }))
  },
})

/** Enrich in the Investors bulk bar: queued, at most two at once. */
export const enrichMany = mutation({
  args: { ids: v.array(v.id('investors')) },
  handler: async (ctx, { ids }) => {
    await requireUser(ctx)
    if (!hasAIKey()) throw noKey()
    const out: Id<'enrichRuns'>[] = []
    for (const id of [...new Set(ids)].slice(0, 200)) {
      const inv = await ctx.db.get(id)
      if (!inv) continue
      out.push((await openRun(ctx, id))?._id ?? (await queue(ctx, targetOf(inv, false))))
    }
    return out
  },
})

/** Who's this?: look a sender up (once a month; a recent lookup is reused). */
export const lookupSender = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    await requireUser(ctx)
    if (!hasAIKey()) throw noKey()
    const e = normEmail(email)
    if (!e) throw new ConvexError('That doesn’t look like an email address.')
    const since = Date.now() - CACHE_DAYS * DAY_MS
    const seen = (await ctx.db.query('enrichRuns').withIndex('by_email', (q) => q.eq('email', e).gte('startedAt', since)).order('desc').collect()).find(
      (r) => !r.investorId && r.status !== 'failed' && r.status !== 'stopped',
    )
    return seen?._id ?? (await queue(ctx, { email: e, auto: false, ...(GENERIC_DOMAINS.has(domainOf(e)) ? {} : { domain: domainOf(e) }) }))
  },
})

export const stop = mutation({
  args: { runId: v.id('enrichRuns') },
  handler: async (ctx, { runId }) => {
    await requireUser(ctx)
    const r = await ctx.db.get(runId)
    if (!r || !active(r)) return false
    await ctx.db.patch(runId, { status: 'stopped', finishedAt: Date.now() })
    await pump(ctx)
    return true
  },
})

/* ---------- review ---------- */

/** Keep one fact: investor fields only when empty (else a clash note), the person into People, a partner as a new person. */
async function keep(ctx: MutationCtx, userId: Id<'users'>, f: Doc<'facts'>) {
  if (f.status === 'kept') return f.clash
  const inv = f.investorId ? await ctx.db.get(f.investorId) : null
  let clash: string | undefined
  if (inv) {
    const w = investorWrite(inv, f)
    clash = w.clash
    if (w.patch) await saveInvestor(ctx, userId, inv._id, { ...fieldsOf(inv), ...w.patch })
    if (f.group === 'person') await keepPerson(ctx, inv, f)
    else if (f.field === 'partner' && f.person) await addPartner(ctx, inv._id, f.person)
  }
  await ctx.db.patch(f._id, { status: 'kept', keptAt: Date.now(), clash })
  return clash
}

/** The run's person (matched by the name it found, else the main contact), created if they aren't in People yet. */
async function keepPerson(ctx: MutationCtx, inv: Doc<'investors'>, f: Doc<'facts'>) {
  const people = await ctx.db.query('people').withIndex('by_investor', (q) => q.eq('investorId', inv._id)).collect()
  const name = f.field === 'name' ? f.value : (await ctx.db.query('facts').withIndex('by_run', (q) => q.eq('runId', f.runId)).collect()).find((x) => x.group === 'person' && x.field === 'name')?.value
  const email = normEmail(f.email ?? inv.email)
  const p =
    people.find((x) => (name && sameName(x.name, name)) || (!!email && normEmail(x.email) === email)) ?? (name ? undefined : people.find((x) => x.primary))
  const patch = (
    f.field === 'rank' ? { rank: asRank(f.value) } : f.field === 'email' ? { email: normEmail(f.value) || undefined } : { [f.field]: f.value.trim() }
  ) as Partial<Doc<'people'>>
  if (p) await ctx.db.patch(p._id, patch)
  else
    await ctx.db.insert('people', {
      investorId: inv._id, name: name?.trim() || inv.name, primary: !people.some((x) => x.primary), ...(email ? { email } : {}), ...patch,
    })
}

async function addPartner(ctx: MutationCtx, investorId: Id<'investors'>, person: NonNullable<Doc<'facts'>['person']>) {
  const people = await ctx.db.query('people').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()
  if (people.some((p) => sameName(p.name, person.name))) return
  await ctx.db.insert('people', { investorId, ...person, primary: false })
}

export const keepFact = mutation({
  args: { factId: v.id('facts') },
  handler: async (ctx, { factId }) => {
    const { userId } = await requireUser(ctx)
    const f = await ctx.db.get(factId)
    if (!f) throw new ConvexError('That fact is gone. Try Refresh.')
    const clash = await keep(ctx, userId, f)
    await syncReview(ctx, f.runId)
    return clash ?? null
  },
})

/** Dismissed facts don't come back on a refresh. */
export const dismissFact = mutation({
  args: { factId: v.id('facts') },
  handler: async (ctx, { factId }) => {
    await requireUser(ctx)
    const f = await ctx.db.get(factId)
    if (f?.status !== 'pending') return null
    await ctx.db.patch(factId, { status: 'dismissed' })
    await syncReview(ctx, f.runId)
    return null
  },
})

/** Undo in the Dismiss toast. */
export const undoDismiss = mutation({
  args: { factId: v.id('facts') },
  handler: async (ctx, { factId }) => {
    await requireUser(ctx)
    const f = await ctx.db.get(factId)
    if (f?.status !== 'dismissed') return null
    await ctx.db.patch(factId, { status: 'pending' })
    await syncReview(ctx, f.runId)
    return null
  },
})

const pendingOf = async (ctx: MutationCtx, runId: Id<'enrichRuns'>) =>
  (await ctx.db.query('facts').withIndex('by_run', (q) => q.eq('runId', runId)).collect()).filter((f) => f.status === 'pending')

export const keepAll = mutation({
  args: { runId: v.id('enrichRuns') },
  handler: async (ctx, { runId }) => {
    const { userId } = await requireUser(ctx)
    const facts = await pendingOf(ctx, runId)
    for (const f of facts) await keep(ctx, userId, (await ctx.db.get(f._id))!)
    await syncReview(ctx, runId)
    return facts.length
  },
})

export const dismissAll = mutation({
  args: { runId: v.id('enrichRuns') },
  handler: async (ctx, { runId }) => {
    await requireUser(ctx)
    const facts = await pendingOf(ctx, runId)
    for (const f of facts) await ctx.db.patch(f._id, { status: 'dismissed' })
    await syncReview(ctx, runId)
    return facts.length
  },
})

/* ---------- Who's this? and People ---------- */

/**
 * "Add as investor" (no investorId: a new investor named after their fund, or
 * them) or "Add to <firm>" (their address joins that investor). Either way they
 * join its People, and the lookup's facts move to the investor's drawer: kept ones
 * are applied now, the rest wait for review.
 */
export const addSender = mutation({
  args: { email: v.string(), investorId: v.optional(v.id('investors')) },
  handler: async (ctx, { email, investorId }) => {
    const { userId } = await requireUser(ctx)
    const e = normEmail(email)
    if (!e) throw new ConvexError('That doesn’t look like an email address.')
    const run = (await ctx.db.query('enrichRuns').withIndex('by_email', (q) => q.eq('email', e)).order('desc').collect()).find((r) => !r.investorId)
    const facts = run ? (await ctx.db.query('facts').withIndex('by_run', (q) => q.eq('runId', run._id)).collect()).filter((f) => f.status !== 'dismissed') : []
    const found = (g: 'person' | 'fund', k: string) => facts.find((f) => f.group === g && f.field === k)?.value.trim()
    const name = found('person', 'name') || nameFromEmail(e)
    let id: Id<'investors'>
    if (investorId) {
      const inv = await ctx.db.get(investorId)
      if (!inv) throw new ConvexError('That investor was deleted')
      if (normEmail(inv.email) !== e && !(inv.emails ?? []).includes(e)) await saveInvestor(ctx, userId, inv._id, { ...fieldsOf(inv), emails: [...(inv.emails ?? []), e] })
      id = inv._id
    } else {
      const fund = found('fund', 'name')
      id = await saveInvestor(ctx, userId, undefined, { ...NEW_INVESTOR, name: fund || name, firm: fund ?? '', email: e, source: 'Who’s this?' })
    }
    const people = await ctx.db.query('people').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()
    if (!people.some((p) => normEmail(p.email) === e || sameName(p.name, name))) await ctx.db.insert('people', { investorId: id, name, email: e, primary: !people.some((p) => p.primary) })
    if (run) await ctx.db.patch(run._id, { investorId: id })
    const inv = (await ctx.db.get(id))!
    for (const f of facts) {
      if (f.status === 'kept') {
        await ctx.db.patch(f._id, { investorId: id, status: 'pending' })
        await keep(ctx, userId, (await ctx.db.get(f._id))!)
      } else await ctx.db.patch(f._id, { investorId: id, clash: investorWrite(inv, f).clash })
    }
    if (run) await syncReview(ctx, run._id)
    return id
  },
})

export const addPerson = mutation({
  args: { investorId: v.id('investors'), name: v.string(), title: v.optional(v.string()), email: v.optional(v.string()) },
  handler: async (ctx, { investorId, name, title, email }) => {
    await requireUser(ctx)
    if (!name.trim()) throw new ConvexError('Add a name.')
    if (!(await ctx.db.get(investorId))) throw new ConvexError('That investor was deleted')
    const people = await ctx.db.query('people').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()
    const e = normEmail(email)
    return await ctx.db.insert('people', {
      investorId, name: name.trim().slice(0, 120), primary: !people.some((p) => p.primary), ...(title?.trim() ? { title: title.trim().slice(0, 120) } : {}), ...(e ? { email: e } : {}),
    })
  },
})

/** Make someone the main contact. */
export const setPrimary = mutation({
  args: { personId: v.id('people') },
  handler: async (ctx, { personId }) => {
    await requireUser(ctx)
    const p = await ctx.db.get(personId)
    if (!p) throw new ConvexError('That person was removed')
    for (const x of await ctx.db.query('people').withIndex('by_investor', (q) => q.eq('investorId', p.investorId)).collect())
      if (x.primary !== (x._id === personId)) await ctx.db.patch(x._id, { primary: x._id === personId })
    return null
  },
})

/** The Settings toggles. */
export const setAuto = mutation({
  args: { lookups: v.optional(v.boolean()), enrichNew: v.optional(v.boolean()), meetingNotes: v.optional(v.boolean()), morningBrief: v.optional(v.boolean()) },
  handler: async (ctx, patch) => {
    await requireUser(ctx)
    const row = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', 'ai')).unique()
    if (row) await ctx.db.patch(row._id, patch)
    else await ctx.db.insert('settings', { key: 'ai', ...patch })
    return await aiSettings(ctx)
  },
})

/** PST-273: Settings › AI's Model section: the default model (`feature` left out), or one feature's own (null: back to the default). */
export const setModel = mutation({
  args: { feature: v.optional(vFeature), model: v.union(vModel, v.null()) },
  handler: async (ctx, { feature, model }) => {
    await requireUser(ctx)
    const row = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', 'ai')).unique()
    const had = row?.key === 'ai' ? row.models : undefined
    const patch = feature ? { models: Object.fromEntries(Object.entries({ ...had, [feature]: model }).filter(([, m]) => m)) } : { model: model ?? undefined }
    if (row) await ctx.db.patch(row._id, patch)
    else await ctx.db.insert('settings', { key: 'ai', ...patch })
    return await modelChoice(ctx)
  },
})

/** PST-273: the model a feature runs on now (for actions: Drafts, Draft from past answers, the brief). */
export const modelOf = internalQuery({
  args: { feature: vFeature },
  handler: async (ctx, { feature }) => await featureModel(ctx, feature),
})

/* ---------- the run itself ---------- */

/** What the action needs: the prompt (names, addresses, notes, next step, email subjects; never bodies). Null when the run isn't running. */
export const input = internalQuery({
  args: { runId: v.id('enrichRuns') },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId)
    if (!run || run.status !== 'running') return null
    const now = Date.now()
    if (run.investorId) {
      const i = await ctx.db.get(run.investorId)
      if (!i) return null
      const subjects = (await ctx.db.query('emailTouches').withIndex('by_last', (q) => q.gte('lastAt', now - 45 * DAY_MS)).collect())
        .filter((t) => t.investorIds.includes(i._id))
        .sort((a, b) => b.lastAt - a.lastAt)
        .map((t) => t.subject)
      return {
        steps: run.steps,
        model: run.model ?? (await featureModel(ctx, 'enrich')),
        what: 'investor:' + i._id,
        prompt: investorPrompt({ name: i.name, firm: i.firm, type: i.type, email: i.email, emails: i.emails, domains: i.domains, notes: i.notes, nextStep: i.nextStep, subjects: [...new Set(subjects)].slice(0, 8) }),
      }
    }
    const e = run.email
    if (!e) return null
    const ms = (await ctx.db.query('meetings').withIndex('by_start', (q) => q.gte('start', now - 31 * DAY_MS)).collect()).filter((m) => m.people.some((p) => p.email === e))
    const name = ms.flatMap((m) => m.people).find((p) => p.email === e && p.name)?.name
    return { steps: run.steps, model: run.model ?? (await featureModel(ctx, 'enrich')), what: 'sender', prompt: senderPrompt({ email: e, name, seenIn: [...new Set(ms.map((m) => m.title))].slice(0, 3) }) }
  },
})

/** Live steps and the cost so far; tells the action when Dev pressed Stop. */
export const progress = internalMutation({
  args: { runId: v.id('enrichRuns'), steps: v.array(vStep), costUsd: v.number() },
  handler: async (ctx, { runId, steps, costUsd }) => {
    const r = await ctx.db.get(runId)
    if (!r || r.status !== 'running') return { stopped: true }
    await ctx.db.patch(runId, { steps, costUsd })
    return { stopped: false }
  },
})

/** Store what a run found as pending facts (older pending ones go; kept and dismissed ones aren't asked again), then start the next run. */
export const finish = internalMutation({
  args: { runId: v.id('enrichRuns'), facts: v.array(vNewFact), verdict: vVerdict, summary: v.string(), costUsd: v.number(), model: vModel, usage: vUsage },
  handler: async (ctx, a) => {
    const run = await ctx.db.get(a.runId)
    if (!run) return
    if (run.status !== 'running') {
      await ctx.db.patch(run._id, { costUsd: a.costUsd, model: a.model, usage: a.usage })
      return
    }
    const inv = run.investorId ? await ctx.db.get(run.investorId) : null
    const email = run.email
    const before = run.investorId
      ? await ctx.db.query('facts').withIndex('by_investor', (q) => q.eq('investorId', run.investorId)).collect()
      : email
        ? (await ctx.db.query('facts').withIndex('by_email', (q) => q.eq('email', email)).collect()).filter((f) => !f.investorId)
        : []
    const seen = new Set(before.filter((f) => f.status !== 'pending').map(factKey))
    for (const f of before) if (f.status === 'pending') await ctx.db.delete(f._id)
    let n = 0
    for (const f of a.facts) {
      if (seen.has(factKey(f))) continue
      seen.add(factKey(f))
      const clash = inv ? investorWrite(inv, f).clash : undefined
      await ctx.db.insert('facts', { ...f, runId: run._id, status: 'pending', ...(run.investorId ? { investorId: run.investorId } : {}), ...(email ? { email } : {}), ...(clash ? { clash } : {}) })
      n++
    }
    await ctx.db.patch(run._id, {
      status: 'done', steps: run.steps.map((s) => ({ ...s, state: 'done' as const })), costUsd: a.costUsd, finishedAt: Date.now(), factCount: n, verdict: a.verdict, summary: a.summary,
      model: a.model, usage: a.usage,
    })
    await syncReview(ctx, run._id)
    await pump(ctx)
  },
})

/** A run that failed or was stopped: record it, then start the next one. */
export const end = internalMutation({
  args: { runId: v.id('enrichRuns'), status: v.union(v.literal('failed'), v.literal('stopped')), error: v.optional(v.string()), costUsd: v.number(), usage: v.optional(vUsage) },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.runId)
    if (!r) return
    const stopped = r.status === 'stopped'
    await ctx.db.patch(r._id, {
      status: stopped ? 'stopped' : a.status, costUsd: a.costUsd, finishedAt: r.finishedAt ?? Date.now(), ...(a.error && !stopped ? { error: a.error } : {}), ...(a.usage ? { usage: a.usage } : {}),
    })
    await pump(ctx)
  },
})

/** Run one lookup: stream Claude's research, mark each step as it lands, then store the facts. */
export const execute = internalAction({
  args: { runId: v.id('enrichRuns') },
  handler: async (ctx, { runId }) => {
    const t0 = Date.now()
    const job = await ctx.runQuery(internal.enrich.input, { runId })
    if (!job) {
      await ctx.runMutation(internal.enrich.end, { runId, status: 'failed', error: 'Nothing to look up', costUsd: 0 })
      return
    }
    const ctl = new AbortController()
    const steps = job.steps.map((s) => ({ ...s }))
    let searches = 0
    let pages = 0
    let stopped = false
    let line = ''
    const save = async () => {
      const r = await ctx.runMutation(internal.enrich.progress, { runId, steps, costUsd: searches * PRICES.webSearch })
      if (r.stopped && !stopped) {
        stopped = true
        ctl.abort()
      }
    }
    const onText = async (delta: string) => {
      line += delta
      for (let cut = line.indexOf('\n'); cut >= 0; cut = line.indexOf('\n')) {
        const s = parseStep(line.slice(0, cut))
        line = line.slice(cut + 1)
        if (!s || !steps[s.n - 1]) continue
        const was = steps[s.n - 1]
        steps[s.n - 1] = { label: /^nothing found/i.test(s.found) ? was.label + ': nothing found' : s.found, state: 'done', ...(s.source ? { source: s.source } : {}) }
        for (const x of steps) if (x.state === 'running') x.state = 'waiting'
        const next = steps.find((x) => x.state !== 'done')
        if (next) next.state = 'running'
        pages = 0
        await save()
      }
    }
    const onToolUse = async (name: string) => {
      if (name === 'web_search') searches++
      else if (name === 'web_fetch') pages++
      else return
      const cur = steps.find((x) => x.state === 'running')
      if (cur) cur.source = pages ? 'reading ' + pages + (pages === 1 ? ' page' : ' pages') : 'searching'
      await save()
    }
    let status: 'done' | 'failed' | 'stopped' = 'done'
    let found = 0
    let cost = 0
    let usage: RunUsage | undefined
    try {
      const out = await research({ model: job.model, system: SYSTEM, prompt: job.prompt, hooks: { onText, onToolUse, signal: ctl.signal } })
      cost = out.costUsd
      usage = usageRow(out.usage)
      const answer = conform(vResearch, extractJson(out.text + '\n'))
      const facts = factsFrom(answer)
      found = facts.length
      await ctx.runMutation(internal.enrich.finish, { runId, facts, verdict: answer.verdict, summary: answer.summary.trim().slice(0, 200), costUsd: cost, model: job.model, usage })
    } catch (e) {
      status = stopped ? 'stopped' : 'failed'
      cost = Math.max(cost, searches * PRICES.webSearch)
      const error = stopped ? undefined : e instanceof NoAIKey ? NO_AI_KEY : e instanceof AIError || e instanceof SchemaError ? e.message.slice(0, 200) : 'Something went wrong while looking this up.'
      await ctx.runMutation(internal.enrich.end, { runId, status, error, costUsd: cost, usage })
    }
    console.log('enrich run=' + runId + ' what=' + job.what + ' status=' + status + ' facts=' + found + ' cost=$' + cost.toFixed(4) + ' model=' + job.model + ' secs=' + Math.round((Date.now() - t0) / 1000))
  },
})
