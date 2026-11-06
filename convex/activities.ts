import { v } from 'convex/values'
import { query, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { firstName, requireUser } from './lib/access'

async function withNames(ctx: QueryCtx, acts: Doc<'activities'>[]) {
  const names = new Map<Id<'users'>, string>()
  for (const id of new Set(acts.map((a) => a.userId))) names.set(id, firstName(await ctx.db.get(id)))
  return acts.map((a) => ({ ...a, by: names.get(a.userId) ?? '?' }))
}

/** Newest 1000 activities (by date, then creation). */
export const recent = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const acts = await ctx.db.query('activities').withIndex('by_date').order('desc').take(1000)
    return await withNames(ctx, acts)
  },
})

/** One investor's log, newest first. */
export const forInvestor = query({
  args: { investorId: v.id('investors') },
  handler: async (ctx, { investorId }) => {
    await requireUser(ctx)
    const acts = await ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', investorId)).order('desc').collect()
    return await withNames(ctx, acts)
  },
})
