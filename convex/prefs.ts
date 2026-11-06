import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { requireUser } from './lib/access'

/** The caller's own preferences; `sounds` is null until they change it (the client then uses its local value). */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const row = await ctx.db
      .query('prefs')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique()
    return { sounds: row ? row.sounds : null }
  },
})

/** Sounds on or off for the caller, on every device. */
export const setSounds = mutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const { userId } = await requireUser(ctx)
    const row = await ctx.db
      .query('prefs')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique()
    if (row) await ctx.db.patch(row._id, { sounds: on })
    else await ctx.db.insert('prefs', { userId, sounds: on })
    return on
  },
})
