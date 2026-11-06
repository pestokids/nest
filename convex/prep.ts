import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { firstName, requireUser } from './lib/access'
import { loadRound } from './lib/round'

/** Ticked to-dos of one phase's prep checklist. */
export const list = query({
  args: { phaseKey: v.string() },
  handler: async (ctx, { phaseKey }) => {
    await requireUser(ctx)
    const rows = await ctx.db
      .query('prepTicks')
      .withIndex('by_phase_item', (q) => q.eq('phaseKey', phaseKey))
      .collect()
    const names = new Map<string, string>()
    for (const r of rows) if (!names.has(r.doneBy)) names.set(r.doneBy, firstName(await ctx.db.get(r.doneBy)))
    return rows.map((r) => ({ item: r.item, doneAt: r.doneAt, by: names.get(r.doneBy) ?? '?' }))
  },
})

/** Tick or untick to-do `item` (its index in the phase's to-do list). */
export const set = mutation({
  args: { phaseKey: v.string(), item: v.number(), done: v.boolean() },
  handler: async (ctx, { phaseKey, item, done }) => {
    const { userId } = await requireUser(ctx)
    const { round } = await loadRound(ctx)
    const phase = round.phases.find((p) => p.k === phaseKey)
    if (!phase || !Number.isInteger(item) || item < 0 || item >= phase.todo.length) throw new ConvexError('That to-do no longer exists')
    const existing = await ctx.db
      .query('prepTicks')
      .withIndex('by_phase_item', (q) => q.eq('phaseKey', phaseKey).eq('item', item))
      .collect()
    if (done && !existing.length) await ctx.db.insert('prepTicks', { phaseKey, item, doneBy: userId, doneAt: Date.now() })
    if (!done) for (const r of existing) await ctx.db.delete(r._id)
    return done
  },
})
