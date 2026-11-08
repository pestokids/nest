import { v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireUser } from './lib/access'

/** The caller's own preferences; each is null until they change it (the client then uses its local value). */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const row = await ctx.db
      .query('prefs')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique()
    return { sounds: row?.sounds ?? null, density: row?.density ?? null }
  },
})

async function setPref(ctx: MutationCtx, userId: Id<'users'>, patch: { sounds?: boolean; density?: 'compact' | 'comfortable' }) {
  const row = await ctx.db
    .query('prefs')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique()
  if (row) await ctx.db.patch(row._id, patch)
  else await ctx.db.insert('prefs', { userId, ...patch })
}

/** Sounds on or off for the caller, on every device. */
export const setSounds = mutation({
  args: { on: v.boolean() },
  handler: async (ctx, { on }) => {
    const { userId } = await requireUser(ctx)
    await setPref(ctx, userId, { sounds: on })
    return on
  },
})

/** PST-290: compact (44 px) or comfortable (64 px) rows for the caller, on every device. */
export const setDensity = mutation({
  args: { density: v.union(v.literal('compact'), v.literal('comfortable')) },
  handler: async (ctx, { density }) => {
    const { userId } = await requireUser(ctx)
    await setPref(ctx, userId, { density })
    return density
  },
})
