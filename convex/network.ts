// PST-305: Network. Founders, friends and advisors as sources of warm intros, on
// top of PST-294's introducers and intros (convex/introducers.ts):
// - the relation migration ('portfolio' → 'founder'; the client runs it on first load),
// - a person's touched fields and roles,
// - "Find their investors" for a founder (Haiku with web search; the estimate before,
//   the real cost after, in Settings › AI's spend with Find more), and the ticked
//   results added to their list,
// - "Who do they know": investors from the list, or new firms (Not contacted, source
//   Network, warm path "via <name>"), each with an intro "to ask",
// - "Wants to invest": an Angel at Asked linked both ways, or an existing one linked,
// - the CSV import of people, and the intro ask (a draft naming 2–3 investors).
// Logs carry ids and counts only: never names, companies or text.
import { ConvexError, v } from 'convex/values'
import { action, internalAction, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { firstName as userFirstName, requireUser } from './lib/access'
import { AIError, complete, errorTag, extractJson, hasAIKey, NoAIKey, PRICES, research, usageRow } from './lib/anthropic'
import { autoEnrich, featureModel } from './lib/enrichQueue'
import { conform, SchemaError } from './lib/jsonSchema'
import { ASK_SYSTEM, askPrompt, LOOKUP_SYSTEM, lookupPrompt, lookupTools, vLookupAnswer, type AskContext } from './lib/networkPrompt'
import { saveInvestor } from './investors'
import { vRelation } from './introducersSchema'
import { vModel, vUsage } from './validators'
import { isEmail } from '../src/lib/drafts'
import { fieldLabel, NO_AI_KEY } from '../src/lib/enrich'
import { normEmail } from '../src/lib/google'
import { normName, pathKey, RELATION_LABEL, relationOf } from '../src/lib/introducers'
import { ASK_MAX, angelFields, cleanDomain, composeAsk, LOOKUP_SEARCHES, lookupEstimate, lookupResults, markInNest, matchInvestor, sameInvestor, targetFields, type NewTarget } from '../src/lib/network'

const MAX_NAME = 120
const MAX_NOTES = 500
/** A lookup still "running" after this long died with its action; a new one may start. */
const STALE_MS = 10 * 60_000
const noKey = () => new ConvexError({ code: NO_AI_KEY, message: 'AI isn’t set up here.' })

/* ---------- the relation migration ---------- */

/** Every 'portfolio' row becomes 'founder'. Idempotent: the Network calls it on first load while the list says some rows are old. */
export const migrateRelations = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    let migrated = 0
    for (const p of await ctx.db.query('introducers').collect()) {
      if (p.relation !== 'portfolio') continue
      await ctx.db.patch(p._id, { relation: 'founder' })
      migrated++
    }
    if (migrated) console.log('network.migrateRelations', 'founders=' + migrated)
    return { migrated }
  },
})

/* ---------- a person's fields and roles ---------- */

const vPatch = v.object({
  name: v.optional(v.string()), email: v.optional(v.string()), relation: v.optional(vRelation), notes: v.optional(v.string()), company: v.optional(v.string()), companyDomain: v.optional(v.string()),
})

async function personOf(ctx: QueryCtx, id: Id<'introducers'>) {
  const p = await ctx.db.get(id)
  if (!p) throw new ConvexError('That person was deleted')
  return p
}

/** Save only the fields Dev touched (PST-303's rule): a field nobody touched keeps what it has now. */
export const updatePerson = mutation({
  args: { id: v.id('introducers'), patch: vPatch },
  handler: async (ctx, { id, patch }) => {
    await requireUser(ctx)
    await personOf(ctx, id)
    const set: Partial<Doc<'introducers'>> = {}
    if (patch.name !== undefined) {
      const name = patch.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME)
      if (!normName(name)) throw new ConvexError('Add their name.')
      const same = await ctx.db.query('introducers').withIndex('by_key', (q) => q.eq('key', normName(name))).first()
      if (same && same._id !== id) throw new ConvexError(name + ' is already in your Network.')
      Object.assign(set, { name, key: normName(name) })
    }
    if (patch.email !== undefined) {
      const email = normEmail(patch.email)
      if (email && !isEmail(email)) throw new ConvexError('That email doesn’t look right.')
      set.email = email || undefined
    }
    if (patch.relation !== undefined) {
      if (patch.relation === 'committed') throw new ConvexError('Committed investors come from the investor list.')
      set.relation = patch.relation
    }
    if (patch.notes !== undefined) set.notes = patch.notes.trim().slice(0, MAX_NOTES)
    if (patch.company !== undefined) set.company = patch.company.trim().slice(0, MAX_NAME) || undefined
    if (patch.companyDomain !== undefined) set.companyDomain = cleanDomain(patch.companyDomain) || undefined
    await ctx.db.patch(id, set)
  },
})

/** Can intro and Gives advice. Wants to invest goes through setWantsToInvest (it makes or links an investor). */
export const setRoles = mutation({
  args: { id: v.id('introducers'), roles: v.object({ canIntro: v.optional(v.boolean()), givesAdvice: v.optional(v.boolean()) }) },
  handler: async (ctx, { id, roles }) => {
    await requireUser(ctx)
    const p = await personOf(ctx, id)
    await ctx.db.patch(id, { roles: { ...p.roles, ...roles } })
  },
})

/* ---------- investors a person can introduce, each with an intro "to ask" ---------- */

type Who = { introducerId?: Id<'introducers'>; viaInvestorId?: Id<'investors'> }
const vWho = { introducerId: v.optional(v.id('introducers')), viaInvestorId: v.optional(v.id('investors')) }
const vNewTarget = v.object({ firm: v.string(), partner: v.optional(v.string()), domain: v.optional(v.string()), round: v.optional(v.string()), year: v.optional(v.number()), url: v.optional(v.string()) })

/** The person's name, for "via <name>". Throws when they're gone. */
async function whoName(ctx: QueryCtx, who: Who): Promise<string> {
  if (!who.introducerId === !who.viaInvestorId) throw new ConvexError('Pick who makes the intro.')
  const p = who.introducerId ? await ctx.db.get(who.introducerId) : await ctx.db.get(who.viaInvestorId!)
  if (!p) throw new ConvexError('That person was deleted')
  return p.name
}

/** The intro from this person to an investor: the one there is, else a new one "to ask". */
async function linkIntro(ctx: MutationCtx, investorId: Id<'investors'>, who: Who, fromPath?: string) {
  const mine = await ctx.db.query('intros').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()
  const there = mine.find((x) => (who.introducerId ? x.introducerId === who.introducerId : x.viaInvestorId === who.viaInvestorId))
  if (there) return { id: there._id, made: false }
  const now = Date.now()
  const id = await ctx.db.insert('intros', {
    investorId, ...(who.introducerId ? { introducerId: who.introducerId } : { viaInvestorId: who.viaInvestorId }), steps: {}, ...(fromPath ? { fromPath } : {}), createdAt: now, updatedAt: now,
  })
  return { id, made: true }
}

/**
 * Investors in Nest get this person as a warm path (an intro "to ask"; an empty
 * warm path text becomes "via <name>"); new firms are added to Investors as Not
 * contacted, source Network, "via <name>", each with an intro "to ask". A new
 * firm that is already in Nest (by domain or name) is never a second card.
 */
export async function addTargetsFor(ctx: MutationCtx, userId: Id<'users'>, who: Who, investorIds: Id<'investors'>[], fresh: NewTarget[]) {
  const name = await whoName(ctx, who)
  const via = 'via ' + name
  const all = await ctx.db.query('investors').collect()
  const introIds: Id<'intros'>[] = []
  const made: Id<'intros'>[] = []
  const created: Id<'investors'>[] = []
  let linked = 0
  const linkExisting = async (inv: Doc<'investors'>) => {
    if (inv._id === who.viaInvestorId) return
    const empty = !inv.path.trim()
    if (empty) await ctx.db.patch(inv._id, { path: via, updatedAt: Date.now(), updatedBy: userId })
    const r = await linkIntro(ctx, inv._id, who, empty ? pathKey(via) : undefined)
    introIds.push(r.id)
    if (!r.made) return
    made.push(r.id)
    linked++
  }
  for (const id of investorIds) {
    const inv = await ctx.db.get(id)
    if (inv) await linkExisting(inv)
  }
  for (const t of fresh) {
    if (!t.firm.trim()) continue
    const there = matchInvestor(t, all)
    if (there) {
      await linkExisting(there)
      continue
    }
    const fields = targetFields(t, name)
    const id = await saveInvestor(ctx, userId, undefined, fields)
    const doc = await ctx.db.get(id)
    if (doc) all.push(doc)
    const r = await linkIntro(ctx, id, who, pathKey(fields.path))
    introIds.push(r.id)
    made.push(r.id)
    created.push(id)
  }
  if (created.length) await autoEnrich(ctx, created)
  return { linked, created: created.length, introIds, made, createdIds: created }
}

/** "Who do they know": investors from the list, and new firms typed in. */
export const addTargets = mutation({
  args: { ...vWho, investorIds: v.array(v.id('investors')), fresh: v.array(vNewTarget) },
  handler: async (ctx, { investorIds, fresh, ...who }) => {
    const { userId } = await requireUser(ctx)
    if (investorIds.length + fresh.length > 30) throw new ConvexError('That’s more than 30 at once.')
    const r = await addTargetsFor(ctx, userId, who, investorIds, fresh)
    return { linked: r.linked, created: r.created, introIds: r.introIds }
  },
})

/* ---------- Wants to invest ---------- */

/**
 * On: link the investor Dev picked (linkTo); else offer an investor already in
 * Nest with the same email or name (nothing changes until Dev picks: linkTo, or
 * create); else make an Angel at Asked, source Network. Off: unlink, never
 * delete. Resolves with the investor, for the panel and Undo.
 */
export const setWantsToInvest = mutation({
  args: { id: v.id('introducers'), on: v.boolean(), linkTo: v.optional(v.id('investors')), create: v.optional(v.boolean()) },
  handler: async (ctx, { id, on, linkTo, create }): Promise<{ investorId?: Id<'investors'>; created?: boolean; offer?: Id<'investors'> }> => {
    const { userId } = await requireUser(ctx)
    const p = await personOf(ctx, id)
    if (!on) {
      await ctx.db.patch(id, { investorId: undefined, roles: { ...p.roles, wantsToInvest: false } })
      return { investorId: p.investorId }
    }
    if (p.investorId && (await ctx.db.get(p.investorId)) && !linkTo) {
      await ctx.db.patch(id, { roles: { ...p.roles, wantsToInvest: true } })
      return { investorId: p.investorId, created: false }
    }
    if (linkTo) {
      if (!(await ctx.db.get(linkTo))) throw new ConvexError('That investor was deleted')
      const other = await ctx.db.query('introducers').withIndex('by_investor', (q) => q.eq('investorId', linkTo)).first()
      if (other && other._id !== id) throw new ConvexError('That investor is already linked to ' + other.name + '.')
      await ctx.db.patch(id, { investorId: linkTo, roles: { ...p.roles, wantsToInvest: true } })
      return { investorId: linkTo, created: false }
    }
    const linked = new Set((await ctx.db.query('introducers').collect()).flatMap((x) => (x.investorId && x._id !== id ? [x.investorId] : [])))
    const same = sameInvestor(p, (await ctx.db.query('investors').collect()).filter((i) => !linked.has(i._id)))
    if (same && !create) return { offer: same._id }
    const investorId = await saveInvestor(ctx, userId, undefined, angelFields({ ...p, relation: relationOf(p.relation) }))
    await ctx.db.patch(id, { investorId, roles: { ...p.roles, wantsToInvest: true } })
    return { investorId, created: true }
  },
})

/* ---------- Find their investors (founders) ---------- */

const latestLookup = (ctx: QueryCtx, introducerId: Id<'introducers'>) =>
  ctx.db.query('founderLookups').withIndex('by_introducer', (q) => q.eq('introducerId', introducerId)).order('desc').first()

/** The panel: the estimate before it runs, and this founder's latest lookup with its results. */
export const lookupState = query({
  args: { introducerId: v.id('introducers') },
  handler: async (ctx, { introducerId }) => {
    await requireUser(ctx)
    const model = await featureModel(ctx, 'find')
    const run = await latestLookup(ctx, introducerId)
    return {
      connected: hasAIKey(),
      model,
      estimateUsd: lookupEstimate(model),
      run: run ? { _id: run._id, status: run.status, company: run.company, startedAt: run.startedAt, costUsd: run.costUsd, error: run.error, results: run.results } : null,
    }
  },
})

/** "Find their investors": one lookup at a time per founder, from their company (and its website). Resolves with its id. */
export const startLookup = mutation({
  args: { introducerId: v.id('introducers') },
  handler: async (ctx, { introducerId }) => {
    const { userId } = await requireUser(ctx)
    if (!hasAIKey()) throw noKey()
    const p = await personOf(ctx, introducerId)
    const company = (p.company ?? '').trim()
    if (!company) throw new ConvexError('Add their company first.')
    const now = Date.now()
    const last = await latestLookup(ctx, introducerId)
    if (last?.status === 'running' && last.startedAt > now - STALE_MS) return last._id
    const model = await featureModel(ctx, 'find')
    const lookupId = await ctx.db.insert('founderLookups', {
      introducerId, company, ...(p.companyDomain ? { domain: p.companyDomain } : {}), status: 'running', startedAt: now, estimateUsd: lookupEstimate(model), costUsd: 0, model, results: [], startedBy: userId,
    })
    await ctx.scheduler.runAfter(0, internal.network.executeLookup, { lookupId })
    return lookupId
  },
})

export const lookupInput = internalQuery({
  args: { lookupId: v.id('founderLookups') },
  handler: async (ctx, { lookupId }) => {
    const run = await ctx.db.get(lookupId)
    return run && run.status === 'running' ? { company: run.company, domain: run.domain, model: run.model } : null
  },
})

const vRawResult = v.object({ firm: v.string(), partner: v.optional(v.string()), round: v.optional(v.string()), year: v.optional(v.number()), url: v.string(), domain: v.optional(v.string()) })

/** Saved with its real cost; each result marked when that investor is already in Nest. */
export const finishLookup = internalMutation({
  args: { lookupId: v.id('founderLookups'), results: v.array(vRawResult), costUsd: v.number(), usage: vUsage },
  handler: async (ctx, { lookupId, results, costUsd, usage }) => {
    const run = await ctx.db.get(lookupId)
    if (!run || run.status !== 'running') return
    const marked = markInNest(results, await ctx.db.query('investors').collect()).map((r) => ({ ...r, ...(r.investorId ? { investorId: r.investorId as Id<'investors'> } : {}) }))
    await ctx.db.patch(lookupId, { status: 'done', finishedAt: Date.now(), results: marked as Doc<'founderLookups'>['results'], costUsd, usage })
  },
})

export const failLookup = internalMutation({
  args: { lookupId: v.id('founderLookups'), error: v.string(), costUsd: v.number() },
  handler: async (ctx, { lookupId, error, costUsd }) => {
    const run = await ctx.db.get(lookupId)
    if (!run || run.status !== 'running') return
    await ctx.db.patch(lookupId, { status: 'failed', finishedAt: Date.now(), error, costUsd })
  },
})

/** One lookup: Haiku searches the web for who backed the company; Nest keeps up to 15 with a source link each. */
export const executeLookup = internalAction({
  args: { lookupId: v.id('founderLookups') },
  handler: async (ctx, { lookupId }) => {
    const job = await ctx.runQuery(internal.network.lookupInput, { lookupId })
    if (!job) return
    let searches = 0
    let costUsd = 0
    try {
      const out = await research({
        model: job.model,
        system: LOOKUP_SYSTEM,
        prompt: lookupPrompt(job),
        tools: lookupTools(LOOKUP_SEARCHES),
        maxTokens: 8000,
        hooks: { onToolUse: (name) => void (name === 'web_search' && searches++) },
      })
      costUsd = out.costUsd
      const results = lookupResults(conform(vLookupAnswer, extractJson(out.text + '\n')).investors)
      await ctx.runMutation(internal.network.finishLookup, { lookupId, results, costUsd, usage: usageRow(out.usage) })
      console.log('network.lookup id=' + lookupId + ' status=done found=' + results.length + ' searches=' + searches + ' cost=$' + costUsd.toFixed(4))
    } catch (e) {
      costUsd = Math.max(costUsd, searches * PRICES.webSearch)
      const error = e instanceof NoAIKey ? NO_AI_KEY : e instanceof AIError || e instanceof SchemaError ? e.message.slice(0, 200) : 'Something went wrong while searching.'
      await ctx.runMutation(internal.network.failLookup, { lookupId, error, costUsd })
      console.log('network.lookup id=' + lookupId + ' status=failed error=' + errorTag(e) + ' searches=' + searches + ' cost=$' + costUsd.toFixed(4))
    }
  },
})

/** "Add N to <name>'s list": only the results Dev ticked. Each is marked added, so it's never added twice. */
export const addFromLookup = mutation({
  args: { lookupId: v.id('founderLookups'), picks: v.array(v.number()) },
  handler: async (ctx, { lookupId, picks }) => {
    const { userId } = await requireUser(ctx)
    const run = await ctx.db.get(lookupId)
    if (!run || run.status !== 'done') throw new ConvexError('That lookup isn’t finished.')
    const want = [...new Set(picks)].filter((k) => Number.isInteger(k) && k >= 0 && k < run.results.length && !run.results[k].added)
    if (!want.length) return { linked: 0, created: 0, added: 0 }
    const existing: Id<'investors'>[] = []
    const fresh: NewTarget[] = []
    for (const k of want) {
      const r = run.results[k]
      if (r.investorId && (await ctx.db.get(r.investorId))) existing.push(r.investorId)
      else fresh.push({ firm: r.firm, partner: r.partner, domain: r.domain, round: r.round, year: r.year, url: r.url })
    }
    const out = await addTargetsFor(ctx, userId, { introducerId: run.introducerId }, existing, fresh)
    await ctx.db.patch(lookupId, { results: run.results.map((r, k) => (want.includes(k) ? { ...r, added: true } : r)) })
    return { linked: out.linked, created: out.created, added: want.length }
  },
})

/* ---------- the CSV import of people ---------- */

const vPersonRow = v.object({ name: v.string(), email: v.optional(v.string()), relation: vRelation, company: v.optional(v.string()), notes: v.string() })

/** The preview's rows, deduped again here by email or name (against the Network and within the file). */
export const importPeople = mutation({
  args: { rows: v.array(vPersonRow) },
  handler: async (ctx, { rows }) => {
    const { userId } = await requireUser(ctx)
    if (rows.length > 500) throw new ConvexError('That’s more than 500 people at once.')
    const people = await ctx.db.query('introducers').collect()
    const names = new Set(people.map((p) => p.key))
    const emails = new Set(people.map((p) => normEmail(p.email)).filter(Boolean))
    const ids: Id<'introducers'>[] = []
    for (const r of rows) {
      const name = r.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME)
      const key = normName(name)
      const email = normEmail(r.email)
      if (!key || names.has(key) || (email && emails.has(email)) || r.relation === 'committed') continue
      names.add(key)
      if (email) emails.add(email)
      const company = r.company?.trim().slice(0, MAX_NAME)
      ids.push(await ctx.db.insert('introducers', {
        name, key, ...(email && isEmail(email) ? { email } : {}), relation: r.relation, notes: r.notes.trim().slice(0, MAX_NOTES), ...(company ? { company } : {}), createdAt: Date.now(), createdBy: userId,
      }))
    }
    if (ids.length) console.log('network.importPeople', 'added=' + ids.length, 'skipped=' + (rows.length - ids.length))
    return { added: ids.length, skipped: rows.length - ids.length, ids }
  },
})

/* ---------- the intro ask ---------- */

/** What the ask's prompt gets: the person, the investors Dev picked (with Nest's kept facts) and Dev's best saved answers. Checks the caller. */
export const askContext = internalQuery({
  args: { introIds: v.array(v.id('intros')) },
  handler: async (ctx, { introIds }): Promise<AskContext & { investorId: Id<'investors'>; names: string[]; to?: string }> => {
    const { user } = await requireUser(ctx)
    if (!introIds.length || introIds.length > ASK_MAX) throw new ConvexError('Pick up to ' + ASK_MAX + ' investors to ask about.')
    const intros = []
    for (const id of introIds) {
      const x = await ctx.db.get(id)
      if (!x) throw new ConvexError('One of those intros was deleted')
      intros.push(x)
    }
    const key = (x: Doc<'intros'>) => x.introducerId ?? 'inv:' + x.viaInvestorId
    if (new Set(intros.map(key)).size > 1) throw new ConvexError('An ask goes to one person.')
    const p = intros[0].introducerId ? await ctx.db.get(intros[0].introducerId) : null
    const via = intros[0].viaInvestorId ? await ctx.db.get(intros[0].viaInvestorId) : null
    if (!p && !via) throw new ConvexError('That person was deleted')
    const investors: AskContext['investors'] = []
    for (const x of intros) {
      const inv = await ctx.db.get(x.investorId)
      if (!inv) throw new ConvexError('One of those investors was deleted')
      const facts = (await ctx.db.query('facts').withIndex('by_investor', (q) => q.eq('investorId', inv._id)).collect())
        .filter((f) => f.status === 'kept')
        .slice(0, 8)
        .map((f) => fieldLabel(f.group, f.field) + ': ' + f.value)
      investors.push({ name: inv.name, firm: inv.firm, type: inv.type, facts })
    }
    const bank = (await ctx.db.query('questions').collect())
      .filter((q) => q.removedAt === undefined && !q.mergedInto && q.bestAnswer.trim())
      .sort((a, b) => b.askedCount - a.askedCount)
      .slice(0, 4)
      .map((q) => ({ q: q.text, a: q.bestAnswer.trim() }))
    const person = p
      ? { name: p.name, relation: RELATION_LABEL[relationOf(p.relation)], company: p.company, notes: p.notes }
      : { name: via!.name, relation: RELATION_LABEL.committed, company: via!.firm && via!.firm !== via!.name ? via!.firm : undefined, notes: '' }
    return { me: userFirstName(user), person, investors, bank, investorId: intros[0].investorId, names: investors.map((i) => i.name), to: normEmail(p ? p.email : via!.email) || undefined }
  },
})

/** A written ask: a new draft row, or the dialog's row rewritten (its cost added up). A sent draft is never rewritten. */
export const saveAsk = internalMutation({
  args: { draftId: v.optional(v.id('drafts')), investorId: v.id('investors'), introIds: v.array(v.id('intros')), subject: v.string(), body: v.string(), costUsd: v.number(), model: vModel, usage: vUsage, to: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const prev = a.draftId ? await ctx.db.get(a.draftId) : null
    if (prev && prev.type === 'introAsk' && prev.status !== 'sent') {
      const costUsd = prev.costUsd + a.costUsd
      await ctx.db.patch(prev._id, { investorId: a.investorId, introIds: a.introIds, subject: a.subject, body: a.body, costUsd, model: a.model, usage: a.usage })
      return { draftId: prev._id, costUsd }
    }
    const draftId = await ctx.db.insert('drafts', {
      investorId: a.investorId, type: 'introAsk', introIds: a.introIds, subject: a.subject, body: a.body, status: 'draft', costUsd: a.costUsd, model: a.model, usage: a.usage,
      createdAt: Date.now(), createdBy: userId, ...(a.to ? { to: a.to } : {}),
    })
    return { draftId, costUsd: a.costUsd }
  },
})

/** "Ask <name> for intros": Haiku writes the opening, a line per investor (Nest's facts only) and the note to forward; Nest puts the email together and blanks any number it doesn't have. */
export const writeAsk = action({
  args: { draftId: v.optional(v.id('drafts')), introIds: v.array(v.id('intros')) },
  handler: async (ctx, a): Promise<{ draftId: Id<'drafts'>; subject: string; body: string; costUsd: number; to?: string }> => {
    if (!hasAIKey()) throw noKey()
    const c: AskContext & { investorId: Id<'investors'>; names: string[]; to?: string } = await ctx.runQuery(internal.network.askContext, { introIds: a.introIds })
    const model = await ctx.runQuery(internal.enrich.modelOf, { feature: 'drafts' })
    let out
    try {
      const prompt = askPrompt(c)
      const r = await complete({ model, system: ASK_SYSTEM, prompt, maxTokens: 1500 })
      out = { ...composeAsk(extractJson(r.text) as Record<string, unknown>, { who: c.person.name, me: c.me, picked: c.names, known: prompt }), costUsd: r.costUsd, usage: usageRow(r.usage) }
    } catch (e) {
      if (e instanceof NoAIKey) throw noKey()
      console.warn('network.writeAsk failed', 'error=' + errorTag(e))
      throw new ConvexError(e instanceof AIError ? 'Couldn’t write it: ' + e.message + '. Try again.' : 'Couldn’t write it. Try again.')
    }
    const saved: { draftId: Id<'drafts'>; costUsd: number } = await ctx.runMutation(internal.network.saveAsk, {
      draftId: a.draftId, investorId: c.investorId, introIds: a.introIds, subject: out.subject, body: out.body, costUsd: out.costUsd, model, usage: out.usage, to: c.to,
    })
    return { draftId: saved.draftId, subject: out.subject, body: out.body, costUsd: saved.costUsd, ...(c.to ? { to: c.to } : {}) }
  },
})
