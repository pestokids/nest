// PST-294: Introducers as people, and the six dated steps of each intro.
// The old free-text warm paths become people through `migrate`, which the
// Introducers view and the drawer call when they find one not linked yet: it is
// idempotent (an intro remembers the text it came from) and the same person is
// created once (matched by normalised name). The text stays on the investor.
// Committed investors are introducers too, derived from the list (no rows).
import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { vRelation, vStep } from './introducersSchema'
import { migrationPlan, normName, relationOf, setStep, type Step } from '../src/lib/introducers'
import { cleanDomain } from '../src/lib/network' // PST-305
import { isISODate, todayIST } from '../src/lib/dates'
import { isEmail } from '../src/lib/drafts'
import { normEmail } from '../src/lib/google'

const MAX_NAME = 120
const MAX_NOTES = 500

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const introducers = await ctx.db.query('introducers').collect()
    const intros = await ctx.db.query('intros').collect()
    return {
      // PST-305: 'portfolio' reads as 'founder' until network.migrateRelations has run; company, roles and the investor they also are.
      introducers: introducers.map((p) => ({
        _id: p._id, name: p.name, email: p.email, relation: relationOf(p.relation), notes: p.notes, createdAt: p.createdAt,
        company: p.company, companyDomain: p.companyDomain, roles: p.roles, investorId: p.investorId,
      })),
      intros: intros.map(({ _creationTime: _, updatedAt: __, ...x }) => x),
      /** PST-305: some rows still say 'portfolio' (the client runs the migration). */
      legacy: introducers.some((p) => p.relation === 'portfolio'),
    }
  },
})

/** Every warm path not linked yet becomes people and intros. Safe to call any number of times. */
export const migrate = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const plan = migrationPlan(await ctx.db.query('investors').collect(), await ctx.db.query('introducers').collect(), await ctx.db.query('intros').collect())
    if (!plan.link.length) return { created: 0, linked: 0 }
    const now = Date.now()
    const made = new Map<string, Id<'introducers'>>()
    for (const c of plan.create) made.set(c.key, await ctx.db.insert('introducers', { name: c.name, key: normName(c.name), relation: c.relation, notes: c.notes, createdAt: now, createdBy: userId }))
    for (const l of plan.link) {
      if (l.existing) await ctx.db.patch(l.existing as Id<'intros'>, { fromPath: l.fromPath, updatedAt: now })
      else
        await ctx.db.insert('intros', {
          investorId: l.investorId as Id<'investors'>, introducerId: made.get(l.introducer) ?? (l.introducer as Id<'introducers'>), steps: {}, fromPath: l.fromPath, createdAt: now, updatedAt: now,
        })
    }
    console.log('introducers.migrate', 'created=' + plan.create.length, 'linked=' + plan.link.length)
    return { created: plan.create.length, linked: plan.link.length }
  },
})

// PST-305: a founder's company and its website (an angel's title or company), when the form shows them.
const vFields = { name: v.string(), email: v.optional(v.string()), relation: vRelation, notes: v.string(), company: v.optional(v.string()), companyDomain: v.optional(v.string()) }
type Fields = { name: string; email?: string; relation: Doc<'introducers'>['relation']; notes: string; company?: string; companyDomain?: string }

function clean(f: Fields) {
  const name = f.name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME)
  if (!normName(name)) throw new ConvexError('Add their name.')
  const email = normEmail(f.email)
  if (email && !isEmail(email)) throw new ConvexError('That email doesn’t look right.')
  if (f.relation === 'committed') throw new ConvexError('Committed investors come from the investor list.')
  return {
    name, key: normName(name), email: email || undefined, relation: f.relation, notes: f.notes.trim().slice(0, MAX_NOTES),
    // PST-305: only when given, so an older form never clears them.
    ...(f.company !== undefined ? { company: f.company.trim().slice(0, MAX_NAME) || undefined } : {}),
    ...(f.companyDomain !== undefined ? { companyDomain: cleanDomain(f.companyDomain) || undefined } : {}),
  }
}

/** A new introducer; someone already there by that name is kept (their empty email and notes filled in). */
export const add = mutation({
  args: vFields,
  handler: async (ctx, f) => {
    const { userId } = await requireUser(ctx)
    const c = clean(f)
    const same = await ctx.db.query('introducers').withIndex('by_key', (q) => q.eq('key', c.key)).first()
    if (same) {
      await ctx.db.patch(same._id, {
        ...(c.email && !same.email ? { email: c.email } : {}), ...(c.notes && !same.notes ? { notes: c.notes } : {}),
        ...(c.company && !same.company ? { company: c.company } : {}), ...(c.companyDomain && !same.companyDomain ? { companyDomain: c.companyDomain } : {}), // PST-305
      })
      return { id: same._id, existed: true }
    }
    return { id: await ctx.db.insert('introducers', { ...c, createdAt: Date.now(), createdBy: userId }), existed: false }
  },
})

export const update = mutation({
  args: { id: v.id('introducers'), ...vFields },
  handler: async (ctx, { id, ...f }) => {
    await requireUser(ctx)
    if (!(await ctx.db.get(id))) throw new ConvexError('That introducer was deleted')
    const c = clean(f)
    const same = await ctx.db.query('introducers').withIndex('by_key', (q) => q.eq('key', c.key)).first()
    if (same && same._id !== id) throw new ConvexError(c.name + ' is already an introducer.')
    await ctx.db.patch(id, { ...c, email: c.email })
  },
})

/** The intro from a person (or a committed investor) to an investor: the one there is, else a new one with no steps done. */
export const link = mutation({
  args: { investorId: v.id('investors'), introducerId: v.optional(v.id('introducers')), viaInvestorId: v.optional(v.id('investors')) },
  handler: async (ctx, a) => {
    await requireUser(ctx)
    if (!a.introducerId === !a.viaInvestorId) throw new ConvexError('Pick who makes the intro.')
    if (a.viaInvestorId === a.investorId) throw new ConvexError('They can’t introduce you to themselves.')
    if (!(await ctx.db.get(a.investorId))) throw new ConvexError('That investor was deleted')
    if (a.introducerId ? !(await ctx.db.get(a.introducerId)) : !(await ctx.db.get(a.viaInvestorId!))) throw new ConvexError('That introducer was deleted')
    const mine = await ctx.db.query('intros').withIndex('by_investor', (q) => q.eq('investorId', a.investorId)).collect()
    const there = mine.find((x) => (a.introducerId ? x.introducerId === a.introducerId : x.viaInvestorId === a.viaInvestorId))
    if (there) return there._id
    const now = Date.now()
    return await ctx.db.insert('intros', { investorId: a.investorId, ...(a.introducerId ? { introducerId: a.introducerId } : { viaInvestorId: a.viaInvestorId }), steps: {}, createdAt: now, updatedAt: now })
  },
})

/** Tick a step on a day (the steps before it come along), or untick it (day null: it and every step after). */
export async function tickStep(ctx: MutationCtx, introId: Id<'intros'>, step: Step, day: string | null) {
  const x = await ctx.db.get(introId)
  if (!x) return null
  const steps = setStep(x.steps, step, day)
  await ctx.db.patch(introId, { steps, updatedAt: Date.now() })
  return steps
}

/** The ask went (sent from Nest, or "I sent it"): Asked is today, unless it was ticked already. */
export async function markAsked(ctx: MutationCtx, introId: Id<'intros'>) {
  const x = await ctx.db.get(introId)
  if (x && !x.steps.asked) await tickStep(ctx, introId, 'asked', todayIST())
}

export const setStepDay = mutation({
  args: { introId: v.id('intros'), step: vStep, day: v.union(v.string(), v.null()) },
  handler: async (ctx, { introId, step, day }) => {
    await requireUser(ctx)
    if (day !== null && !isISODate(day)) throw new ConvexError('That isn’t a date.')
    const steps = await tickStep(ctx, introId, step, day)
    if (!steps) throw new ConvexError('That intro was deleted')
    return steps
  },
})

/** Dev nudged the introducer for a reply: the 3 days start again. */
export const nudged = mutation({
  args: { introId: v.id('intros') },
  handler: async (ctx, { introId }) => {
    await requireUser(ctx)
    if (!(await ctx.db.get(introId))) throw new ConvexError('That intro was deleted')
    await ctx.db.patch(introId, { nudgedAt: todayIST(), updatedAt: Date.now() })
  },
})

/** An investor was deleted: intros to them, and the ones they were making, go too. PST-305: a person who was also that investor stays, unlinked. */
export async function forgetIntros(ctx: MutationCtx, investorId: Id<'investors'>) {
  for (const x of await ctx.db.query('intros').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()) await ctx.db.delete(x._id)
  for (const x of await ctx.db.query('intros').withIndex('by_via', (q) => q.eq('viaInvestorId', investorId)).collect()) await ctx.db.delete(x._id)
  for (const p of await ctx.db.query('introducers').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect())
    await ctx.db.patch(p._id, { investorId: undefined, roles: { ...p.roles, wantsToInvest: false } })
}
