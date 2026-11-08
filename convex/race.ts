// PST-295: Race and the lead. The round's lead, "can lead" (Dev's override
// beats enrichment), "asked to lead", and the updates Dev marks sent. Nest never
// sends an update itself: it lists who to send one to (src/lib/race.ts).
import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { firstName, requireUser } from './lib/access'
import { getRoundRow } from './lib/round'
import { todayIST } from '../src/lib/dates'
import { mergeCanLead, type CanLeadValue } from '../src/lib/race'

/** The round's lead, and the last update Dev sent. */
export const data = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const row = await getRoundRow(ctx)
    const last = await ctx.db.query('investorUpdates').withIndex('by_at').order('desc').first()
    return {
      leadId: row?.leadId ?? null,
      lastUpdate: last ? { _id: last._id, sentOn: last.sentOn, count: last.count, by: firstName(await ctx.db.get(last.by)) } : null,
    }
  },
})

const nameOf = async (ctx: MutationCtx, id: Id<'investors'> | undefined) => (id ? (await ctx.db.get(id))?.name ?? '' : '')

/** Set the round's lead (null: no lead). One change-log row. Resolves with the lead it replaced, for Undo. */
export const setLead = mutation({
  args: { investorId: v.union(v.id('investors'), v.null()) },
  handler: async (ctx, { investorId }) => {
    const { userId } = await requireUser(ctx)
    const row = await getRoundRow(ctx)
    if (!row) throw new ConvexError('Save the round first, then pick the lead.')
    if (investorId && !(await ctx.db.get(investorId))) throw new ConvexError('That investor was deleted')
    const before = row.leadId ?? null
    if (before === investorId) return { before }
    await ctx.db.patch(row._id, { leadId: investorId ?? undefined })
    await ctx.db.insert('settingsLog', { userId, at: Date.now(), field: 'leadId', from: await nameOf(ctx, before ?? undefined), to: await nameOf(ctx, investorId ?? undefined) })
    return { before }
  },
})

/** The drawer's "Can lead" switch: Dev's word, which always wins over enrichment. Keeps "Can lead or anchor" in step. */
export const setCanLead = mutation({
  args: { investorId: v.id('investors'), on: v.boolean() },
  handler: async (ctx, { investorId, on }) => {
    const { userId } = await requireUser(ctx)
    if (!(await ctx.db.get(investorId))) throw new ConvexError('That investor was deleted')
    await ctx.db.patch(investorId, { leadOverride: on, lead: on, updatedAt: Date.now(), updatedBy: userId })
  },
})

/** "Asked to lead", ticked or unticked by hand. */
export const setLeadAsked = mutation({
  args: { investorId: v.id('investors'), on: v.boolean() },
  handler: async (ctx, { investorId, on }) => {
    const { userId } = await requireUser(ctx)
    if (!(await ctx.db.get(investorId))) throw new ConvexError('That investor was deleted')
    await ctx.db.patch(investorId, { leadAskedOn: on ? todayIST() : undefined, updatedAt: Date.now(), updatedBy: userId })
  },
})

/** The "Ask if they'll lead" draft went out (sent from Nest, or "I sent it"): the first step is done. */
export async function noteLeadAsked(ctx: MutationCtx, investorId: Id<'investors'>) {
  const i = await ctx.db.get(investorId)
  if (i && !i.leadAskedOn) await ctx.db.patch(investorId, { leadAskedOn: todayIST() })
}

/**
 * New and refreshed enrichments fill "can lead" (Dev's override still wins: see
 * canLeadOf). One that couldn't tell keeps the yes or no an earlier run found.
 */
export async function fillCanLead(ctx: MutationCtx, inv: Doc<'investors'>, found: { value: CanLeadValue; reason: string }) {
  const next = mergeCanLead(inv.canLead, { ...found, at: Date.now() })
  if (next !== inv.canLead) await ctx.db.patch(inv._id, { canLead: next })
}

/** An investor was deleted: the round no longer has them as its lead. */
export async function forgetLead(ctx: MutationCtx, investorId: Id<'investors'>) {
  const row = await getRoundRow(ctx)
  if (row?.leadId === investorId) await ctx.db.patch(row._id, { leadId: undefined })
}

/** Dev sent an update to the list (from his own email). Resolves with the row, for Undo. */
export const markUpdateSent = mutation({
  args: { count: v.number() },
  handler: async (ctx, { count }) => {
    const { userId } = await requireUser(ctx)
    return await ctx.db.insert('investorUpdates', { sentOn: todayIST(), at: Date.now(), by: userId, count: Math.max(0, Math.round(count)) })
  },
})

export const undoUpdateSent = mutation({
  args: { id: v.id('investorUpdates') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    if (await ctx.db.get(id)) await ctx.db.delete(id)
  },
})
