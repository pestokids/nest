// PST-292: Jev's bookkeeping (see lib/jev.ts for the client): what a call checks
// first, the jevRuns row every call leaves, and Settings › AI's on/off switch and cap.
import { ConvexError, v } from 'convex/values'
import { internalMutation, internalQuery, mutation } from './_generated/server'
import { requireUser } from './lib/access'
import { jevStatus } from './lib/jev'
import { vJevFeature } from './jevSchema'
import { JEV_MAX_CAP } from '../src/lib/jev'

/** Before a call: the switch, the cap, this month's spend, and a cached answer to the same text. */
export const gate = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const s = await jevStatus(ctx)
    const hit = await ctx.db.query('jevCache').withIndex('by_hash', (q) => q.eq('hash', hash)).first()
    return { on: s.on, capUsd: s.capUsd, spentUsd: s.monthUsd, cached: hit ? { answers: hit.answers as unknown, model: hit.model } : null }
  },
})

/** One call's row, and its answers in the cache when it went to the API and came back right. */
export const record = internalMutation({
  args: {
    feature: vJevFeature,
    status: v.union(v.literal('ok'), v.literal('error'), v.literal('capped')),
    reason: v.optional(v.string()),
    cached: v.boolean(),
    questions: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    model: v.optional(v.string()),
    hash: v.optional(v.string()),
    answers: v.optional(v.any()),
  },
  handler: async (ctx, { hash, answers, ...run }) => {
    const at = Date.now()
    await ctx.db.insert('jevRuns', { ...run, at })
    if (hash && answers !== undefined && !(await ctx.db.query('jevCache').withIndex('by_hash', (q) => q.eq('hash', hash)).first()))
      await ctx.db.insert('jevCache', { hash, answers, at, ...(run.model ? { model: run.model } : {}) })
  },
})

/** Settings › AI: Jev on or off, and the monthly cap in dollars. */
export const setJev = mutation({
  args: { on: v.optional(v.boolean()), capUsd: v.optional(v.number()) },
  handler: async (ctx, { on, capUsd }) => {
    await requireUser(ctx)
    if (capUsd !== undefined && !(Number.isFinite(capUsd) && capUsd >= 0 && capUsd <= JEV_MAX_CAP)) throw new ConvexError('The cap has to be between $0 and $' + JEV_MAX_CAP + '.')
    const patch = { ...(on !== undefined ? { jev: on } : {}), ...(capUsd !== undefined ? { jevCapUsd: Math.round(capUsd * 100) / 100 } : {}) }
    const row = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', 'ai')).unique()
    if (row) await ctx.db.patch(row._id, patch)
    else await ctx.db.insert('settings', { key: 'ai', ...patch })
    return await jevStatus(ctx)
  },
})
