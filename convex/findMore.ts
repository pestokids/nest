// PST-296: Find more like these (Investors, screens/round5/investors-find-more.png)
// and Jev's fit scores for Investors › Sort: Priority. A run asks Haiku with web
// search (src/lib/findMore.ts, convex/lib/findPrompt.ts) for investors who backed
// the companies one step ahead of Pesto or invest alongside the top Priority
// investors, keeps at most 30 active ones new to Nest, and asks Jev four Score
// questions about each (src/lib/fitScore.ts). Without Jev (null) a candidate gets
// Nest's own Priority score. "Add" puts candidates in Suggestions as new investors;
// nothing is on the list until Dev accepts them there. Logs carry counts and costs
// only: never names, seeds or answers.
import { ConvexError, v } from 'convex/values'
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { firstName, requireUser } from './lib/access'
import { AIError, errorTag, extractJson, hasAIKey, NoAIKey, PRICES, research, usageRow } from './lib/anthropic'
import { featureModel } from './lib/enrichQueue'
import { askJev, jevStatus } from './lib/jev'
import { conform, SchemaError } from './lib/jsonSchema'
import { mapLimit } from './lib/mapLimit'
import { loadRound } from './lib/round'
import { FIND_SYSTEM, findPrompt, findTools, foundFrom, vFindAnswer } from './lib/findPrompt'
import { priorityState, storedScore } from './lib/fitScores'
import { keptFits } from './priority'
import { insertSuggestion } from './suggestions'
import { vFitParts, vFound } from './findMoreSchema'
import { vUsage, vWave } from './validators'
import { todayIST } from '../src/lib/dates'
import { asType, NO_AI_KEY } from '../src/lib/enrich'
import { backedChip, cleanCompanies, fallbackScore, findEstimate, findKey, foundFacts, pickCandidates, roundChips, searchesFor, topPriority, warmPathOf, type Found } from '../src/lib/findMore'
import { fitQuestions, fitScore, needsRescore, roundFacts } from '../src/lib/fitScore'
import { DAY_MS } from '../src/lib/google'
import { priorities } from '../src/lib/priority'

/** A run still "running" after this long died with its action; a new one may start. */
const STALE_MS = 15 * 60_000
/** Jev calls at once. */
const JEV_AT_ONCE = 4
/** How far back Gmail and Calendar are read for warm paths. */
const WARM_DAYS = 180

/** Investor id → Jev fit score, for every investor that has one. */
async function jevScoresById(ctx: QueryCtx): Promise<Record<string, number>> {
  return Object.fromEntries((await ctx.db.query('jevScores').collect()).map((r) => [r.investorId, r.score]))
}

/** The companies (the saved chips) and the top Priority investors' firms, as a run starts from them. */
async function seedsOf(ctx: QueryCtx) {
  const companies = (await ctx.db.query('findSettings').first())?.companies ?? []
  const investors = await ctx.db.query('investors').collect()
  const prio = priorities(investors, await keptFits(ctx), todayIST(), await jevScoresById(ctx))
  return { companies, investors: topPriority(investors, prio).map((i) => i.firm.trim() || i.name) }
}

const latestRun = (ctx: QueryCtx) => ctx.db.query('findRuns').withIndex('by_started').order('desc').first()

/* ---------- what the panel reads ---------- */

/** The panel: seeds, the estimate, the round's chips, the latest run and its candidates still to add (best first). */
export const state = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const seeds = await seedsOf(ctx)
    const { round } = await loadRound(ctx)
    const model = await featureModel(ctx, 'find')
    const run = await latestRun(ctx)
    const rows = run ? await ctx.db.query('findCandidates').withIndex('by_run', (q) => q.eq('runId', run._id)).collect() : []
    return {
      connected: hasAIKey(),
      jev: (await jevStatus(ctx)).on,
      ...seeds,
      model,
      estimateUsd: findEstimate(seeds.companies.length + seeds.investors.length, model).usd,
      chips: roundChips(round),
      waveLabel: round.waves[1] ?? 'Wave 2',
      run: run
        ? { _id: run._id, status: run.status, startedAt: run.startedAt, costUsd: run.costUsd, error: run.error, inactive: run.inactive ?? 0, already: run.already ?? 0, found: rows.length, added: rows.filter((c) => c.status === 'suggested').length }
        : null,
      candidates: rows.filter((c) => c.status === 'new').sort((a, b) => b.score - a.score || a.name.localeCompare(b.name)),
    }
  },
})

/** The companies chips, saved as Dev edits them. */
export const setCompanies = mutation({
  args: { companies: v.array(v.string()) },
  handler: async (ctx, { companies }) => {
    const { userId } = await requireUser(ctx)
    const clean = cleanCompanies(companies)
    const row = await ctx.db.query('findSettings').first()
    if (row) await ctx.db.patch(row._id, { companies: clean, updatedAt: Date.now(), updatedBy: userId })
    else await ctx.db.insert('findSettings', { companies: clean, updatedAt: Date.now(), updatedBy: userId })
    return clean
  },
})

/* ---------- a run ---------- */

/** "Find more like these": starts a run from today's seeds (one at a time). Resolves with its id. */
export const start = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    if (!hasAIKey()) throw new ConvexError({ code: NO_AI_KEY, message: 'AI isn’t set up here.' })
    const now = Date.now()
    const last = await latestRun(ctx)
    if (last?.status === 'running' && last.startedAt > now - STALE_MS) return last._id
    const seeds = await seedsOf(ctx)
    if (!seeds.companies.length && !seeds.investors.length) throw new ConvexError('Add a company to start from.')
    const model = await featureModel(ctx, 'find')
    const estimateUsd = findEstimate(seeds.companies.length + seeds.investors.length, model).usd
    const runId = await ctx.db.insert('findRuns', { status: 'running', ...seeds, startedAt: now, estimateUsd, costUsd: 0, model, startedBy: userId })
    await ctx.scheduler.runAfter(0, internal.findMore.execute, { runId })
    return runId
  },
})

/** What the action needs: the seeds, who's already in Nest (and already suggested), the round, and Introducers, Gmail and Calendar for warm paths. */
export const input = internalQuery({
  args: { runId: v.id('findRuns') },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId)
    if (!run || run.status !== 'running') return null
    const since = Date.now() - WARM_DAYS * DAY_MS
    const meetings = await ctx.db.query('meetings').withIndex('by_start', (q) => q.gte('start', since)).collect()
    const threads = await ctx.db.query('emailTouches').withIndex('by_last', (q) => q.gte('lastAt', since)).collect()
    const names: Record<string, string> = {}
    for (const id of new Set([...meetings.map((m) => m.userId), ...threads.map((t) => t.userId)])) names[id] = firstName(await ctx.db.get(id))
    const taken = await ctx.db.query('suggestions').withIndex('by_key', (q) => q.gte('key', 'find:').lt('key', 'find;')).collect()
    const investors = await ctx.db.query('investors').collect()
    const introducers = (await ctx.db.query('introducers').collect()).map((p) => ({ _id: p._id, name: p.name, email: p.email, relation: p.relation, notes: p.notes }))
    return {
      companies: run.companies,
      investors: run.investors,
      model: run.model,
      round: (await loadRound(ctx)).round,
      existing: investors.map((i) => ({ name: i.name, firm: i.firm, email: i.email, domains: i.domains })),
      taken: taken.map((s) => s.key),
      history: {
        meetings: meetings.map((m) => ({ userId: m.userId, start: m.start, people: m.people })),
        threads: threads.map((t) => ({ userId: t.userId, lastAt: t.lastAt, participants: t.participants })),
        names,
      },
      people: { introducers, intros: [], investors },
    }
  },
})

const vScored = v.object({ ...vFound, score: v.number(), scoredBy: v.union(v.literal('jev'), v.literal('nest')), parts: v.optional(vFitParts), warmPath: v.optional(v.string()) })

export const finish = internalMutation({
  args: { runId: v.id('findRuns'), candidates: v.array(vScored), costUsd: v.number(), usage: vUsage, jevUsd: v.number(), inactive: v.number(), already: v.number() },
  handler: async (ctx, { runId, candidates, usage, ...rest }) => {
    const run = await ctx.db.get(runId)
    if (!run || run.status !== 'running') return
    await ctx.db.patch(runId, { status: 'done', finishedAt: Date.now(), usage, ...rest })
    for (const c of candidates) await ctx.db.insert('findCandidates', { runId, ...c, status: 'new' })
  },
})

export const fail = internalMutation({
  args: { runId: v.id('findRuns'), error: v.string(), costUsd: v.number() },
  handler: async (ctx, { runId, error, costUsd }) => {
    const run = await ctx.db.get(runId)
    if (!run || run.status !== 'running') return
    await ctx.db.patch(runId, { status: 'failed', finishedAt: Date.now(), error, costUsd })
  },
})

/** One run: Haiku searches, Nest keeps the active ones new to Nest (30 at most), Jev scores each, and the run is saved with its real cost. */
export const execute = internalAction({
  args: { runId: v.id('findRuns') },
  handler: async (ctx, { runId }) => {
    const t0 = Date.now()
    const job = await ctx.runQuery(internal.findMore.input, { runId })
    if (!job) return
    const today = todayIST()
    let searches = 0
    let found = 0
    let jevAnswered = 0
    let costUsd = 0
    let failure = ''
    try {
      const out = await research({
        model: job.model,
        system: FIND_SYSTEM,
        prompt: findPrompt({ companies: job.companies, investors: job.investors, today, round: job.round }),
        tools: findTools(searchesFor(job.companies.length + job.investors.length)),
        hooks: { onToolUse: (name) => void (name === 'web_search' && searches++) },
      })
      costUsd = out.costUsd
      const all = foundFrom(conform(vFindAnswer, extractJson(out.text + '\n')))
      found = all.length
      const { candidates, inactive, already } = pickCandidates(all, job.existing, job.taken, today)
      const round = roundFacts(job.round)
      let jevUsd = 0
      const scored = await mapLimit(candidates, JEV_AT_ONCE, async (c: Found) => {
        const warmPath = warmPathOf(c, job.people, job.history) ?? undefined
        const r = await askJev(ctx, { feature: 'find_more', state: { round, investor: foundFacts(c) }, questions: fitQuestions() })
        const base = { ...c, ...(warmPath ? { warmPath } : {}) }
        if (!r) return { ...base, score: fallbackScore(base, job.round, today), scoredBy: 'nest' as const }
        jevUsd += r.costUsd
        jevAnswered++
        const f = fitScore(r.answers)
        return { ...base, score: f.score, parts: f.parts, scoredBy: 'jev' as const }
      })
      await ctx.runMutation(internal.findMore.finish, { runId, candidates: scored, costUsd, usage: usageRow(out.usage), jevUsd, inactive, already })
      console.log('find run=' + runId + ' status=done found=' + found + ' kept=' + scored.length + ' inactive=' + inactive + ' already=' + already + ' jev=' + jevAnswered + ' searches=' + searches + ' cost=$' + costUsd.toFixed(4) + ' jevCost=$' + jevUsd.toFixed(6) + ' secs=' + Math.round((Date.now() - t0) / 1000))
    } catch (e) {
      failure = errorTag(e)
      costUsd = Math.max(costUsd, searches * PRICES.webSearch)
      const error = e instanceof NoAIKey ? NO_AI_KEY : e instanceof AIError || e instanceof SchemaError ? e.message.slice(0, 200) : 'Something went wrong while searching.'
      await ctx.runMutation(internal.findMore.fail, { runId, error, costUsd })
      console.log('find run=' + runId + ' status=failed error=' + failure + ' searches=' + searches + ' cost=$' + costUsd.toFixed(4))
    }
  },
})

/* ---------- adding ---------- */

/**
 * "Add" or "Add N to Wave 2": each candidate becomes a new-investor suggestion
 * (Not contacted, in that wave when one is given). Nothing is on the list until
 * Dev accepts it in Suggestions. Resolves with how many went in.
 */
export const add = mutation({
  args: { ids: v.array(v.id('findCandidates')), wave: v.optional(vWave) },
  handler: async (ctx, { ids, wave }) => {
    await requireUser(ctx)
    const { round } = await loadRound(ctx)
    const where = wave ? ' in ' + (round.waves[wave - 1] ?? 'Wave ' + wave) : ''
    let added = 0
    for (const id of ids) {
      const c = await ctx.db.get(id)
      if (!c || c.status !== 'new') continue
      const who = c.firm && c.firm.toLowerCase() !== c.name.toLowerCase() ? c.name + ' (' + c.firm + ')' : c.name
      const why = [backedChip(c), 'fit ' + c.score].filter(Boolean).join(' · ')
      const type = asType(c.type ?? '')
      const note = ['From Find more: ' + why + '.', c.warmPath ? 'Warm path: ' + c.warmPath + '.' : '', 'Sources: ' + c.sources.map((s) => s.url).join(' ')].filter(Boolean).join('\n')
      const suggestionId = await insertSuggestion(ctx, {
        kind: 'new_investor',
        title: who + ': ' + why,
        fix: 'Add ' + who + ' as Not contacted' + where,
        patch: { op: 'new_investor', name: c.name, firm: c.firm || c.name, note, ...(wave ? { wave } : {}), ...(type ? { type } : {}), ...(c.domain ? { domain: c.domain } : {}) },
        source: 'find_more',
        key: findKey(c),
      })
      await ctx.db.patch(id, { status: 'suggested', ...(suggestionId ? { suggestionId } : {}) })
      if (suggestionId) added++
    }
    return { added }
  },
})

/* ---------- Priority: Jev's fit scores for investors already in Nest ---------- */

/** Investor id → Jev fit score (Investors › Sort: Priority uses it in place of the light Fit). */
export const priorityScores = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return await jevScoresById(ctx)
  },
})

export const priorityInput = internalQuery({
  args: { investorId: v.id('investors') },
  handler: async (ctx, { investorId }) => {
    const s = await priorityState(ctx, investorId)
    if (!s || !needsRescore(await storedScore(ctx, investorId), s.hash)) return null
    return s
  },
})

export const saveScore = internalMutation({
  args: { investorId: v.id('investors'), hash: v.string(), score: v.number(), parts: vFitParts },
  handler: async (ctx, { investorId, ...row }) => {
    if (!(await ctx.db.get(investorId))) return
    const had = await storedScore(ctx, investorId)
    if (had) await ctx.db.patch(had._id, { ...row, at: Date.now() })
    else await ctx.db.insert('jevScores', { investorId, ...row, at: Date.now() })
  },
})

/** One investor's facts changed (lib/fitScores.ts rescoreLater): ask Jev, unless the facts are the same again by now. Null from Jev keeps the score as it was. */
export const scorePriority = internalAction({
  args: { investorId: v.id('investors') },
  handler: async (ctx, { investorId }) => {
    const s = await ctx.runQuery(internal.findMore.priorityInput, { investorId })
    if (!s) return
    const r = await askJev(ctx, { feature: 'priority_scoring', state: s.state, questions: fitQuestions() })
    if (!r) return
    await ctx.runMutation(internal.findMore.saveScore, { investorId: investorId as Id<'investors'>, hash: s.hash, ...fitScore(r.answers) })
  },
})
