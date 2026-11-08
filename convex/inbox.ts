// PST-297: the Today Inbox's done and snooze marks, and the once-a-day
// clear-inbox confetti. Per person: each founder clears their own Inbox. The rows
// themselves are worked out on the client from each feature's data (src/lib/inbox.ts).
import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { vInboxMarkKind } from './inboxSchema'
import { isISODate } from '../src/lib/dates'
import { firstClearToday } from '../src/lib/inbox'

const MAX_KEY = 200
const MAX_VERSION = 64
/** Snoozed and done marks older than this are dropped when a new one is written. */
const KEEP_MS = 90 * 864e5

const vMark = v.object({ kind: vInboxMarkKind, version: v.string(), until: v.optional(v.number()) })

const rowOf = (ctx: MutationCtx, userId: Id<'users'>, key: string) =>
  ctx.db
    .query('inboxMarks')
    .withIndex('by_user_key', (q) => q.eq('userId', userId).eq('key', key))
    .unique()

function check(key: string, version?: string) {
  if (!key || key.length > MAX_KEY) throw new ConvexError('That row can’t be marked.')
  if (version !== undefined && (!version || version.length > MAX_VERSION)) throw new ConvexError('That row can’t be marked.')
}

/** The caller's marks. */
export const marks = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const rows = await ctx.db
      .query('inboxMarks')
      .withIndex('by_user_key', (q) => q.eq('userId', userId))
      .collect()
    return rows.map((r) => ({ key: r.key, kind: r.kind, version: r.version, ...(r.until !== undefined ? { until: r.until } : {}) }))
  },
})

/** Done (E, a swipe right) or snoozed (S, a swipe left). Resolves with the mark it replaced, for Undo. */
export const mark = mutation({
  args: { key: v.string(), ...vMark.fields },
  handler: async (ctx, { key, kind, version, until }) => {
    const { userId } = await requireUser(ctx)
    check(key, version)
    if (kind === 'snooze' && (until === undefined || !Number.isFinite(until))) throw new ConvexError('Pick when it comes back.')
    const now = Date.now()
    const had = await rowOf(ctx, userId, key)
    const prev = had ? { kind: had.kind, version: had.version, ...(had.until !== undefined ? { until: had.until } : {}) } : null
    const next = { kind, version, until: kind === 'snooze' ? until : undefined, at: now }
    if (had) await ctx.db.patch(had._id, next)
    else await ctx.db.insert('inboxMarks', { userId, key, ...next })
    for (const old of await ctx.db
      .query('inboxMarks')
      .withIndex('by_user_key', (q) => q.eq('userId', userId))
      .collect())
      if (old.key !== key && old.at < now - KEEP_MS) await ctx.db.delete(old._id)
    return prev
  },
})

/** Undo: put back the mark it replaced (null: no mark, so the row shows again). */
export const restore = mutation({
  args: { key: v.string(), prev: v.union(vMark, v.null()) },
  handler: async (ctx, { key, prev }) => {
    const { userId } = await requireUser(ctx)
    check(key, prev?.version)
    const had = await rowOf(ctx, userId, key)
    if (!prev) {
      if (had) await ctx.db.delete(had._id)
      return null
    }
    const next = { kind: prev.kind, version: prev.version, until: prev.kind === 'snooze' ? prev.until : undefined, at: Date.now() }
    if (had) await ctx.db.patch(had._id, next)
    else await ctx.db.insert('inboxMarks', { userId, key, ...next })
    return null
  },
})

/** The Inbox is clear: true the first time today (play the confetti), false after. */
export const cleared = mutation({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const { userId } = await requireUser(ctx)
    if (!isISODate(day)) throw new ConvexError('Not a day.')
    const row = await ctx.db
      .query('inboxCleared')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique()
    if (!firstClearToday(row?.day, day)) return false
    if (row) await ctx.db.patch(row._id, { day })
    else await ctx.db.insert('inboxCleared', { userId, day })
    return true
  },
})
