// PST-302: an investor's application (status, programme, dates), set from the
// drawer's Application row, and marking a backward stage move as a correction.
// An application never moves the stage; a correction resets maxStage to where
// the investor went back to and drops out of the funnel and conversion stats.
import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'
import { requireUser } from './lib/access'
import { vApplication, vApplicationChanges } from './validators'
import { changeApplication, cleanApplication } from '../src/lib/applications'
import { isBackward } from '../src/lib/pipeline'
import { IDX, type PipelineStage } from '../src/lib/stages'

/** Set the application (null: not applied). Resolves with the one it replaced, for Undo. */
export const set = mutation({
  args: { id: v.id('investors'), application: v.union(vApplication, v.null()) },
  handler: async (ctx, { id, application }) => {
    const { userId } = await requireUser(ctx)
    const i = await ctx.db.get(id)
    if (!i) throw new ConvexError('That investor was deleted')
    const next = cleanApplication(application)
    if (application && !next) throw new ConvexError('Pick a status for the application.')
    await ctx.db.patch(id, { application: next ?? undefined, updatedAt: Date.now(), updatedBy: userId })
    return { before: i.application ?? null }
  },
})

/**
 * Change only the fields Dev touched (PST-303's save rule), merged with the
 * application as stored now. Resolves with the one it replaced, for Undo.
 */
export const change = mutation({
  args: { id: v.id('investors'), changes: vApplicationChanges },
  handler: async (ctx, { id, changes }) => {
    const { userId } = await requireUser(ctx)
    const i = await ctx.db.get(id)
    if (!i) throw new ConvexError('That investor was deleted')
    const next = changeApplication(i.application, changes)
    if (!next) throw new ConvexError('Pick a status for the application first.')
    await ctx.db.patch(id, { application: next, updatedAt: Date.now(), updatedBy: userId })
    return { before: i.application ?? null }
  },
})

/**
 * Mark a backward stage move as a correction (or take the mark back). Only the
 * investor's latest move, while they're still where it put them: maxStage goes
 * to that stage, and back to what it was when the mark is taken off.
 */
export const markCorrection = mutation({
  args: { activityId: v.id('activities'), on: v.boolean() },
  handler: async (ctx, { activityId, on }) => {
    const { userId } = await requireUser(ctx)
    const a = await ctx.db.get(activityId)
    if (!a || a.kind !== 'stage' || !a.stage) throw new ConvexError('That move is gone.')
    if (!isBackward(a.fromStage, a.stage)) throw new ConvexError('Only a move back can be a correction.')
    const i = await ctx.db.get(a.investorId)
    if (!i) throw new ConvexError('That investor was deleted')
    const latest = await ctx.db
      .query('activities')
      .withIndex('by_investor', (q) => q.eq('investorId', i._id))
      .order('desc')
      .filter((q) => q.eq(q.field('kind'), 'stage'))
      .first()
    if (i.stage !== a.stage || latest?._id !== a._id) throw new ConvexError('It moved again since, so this can’t change now.')
    const stamp = { updatedAt: Date.now(), updatedBy: userId }
    if (on) {
      if (a.correction) return { maxStage: i.maxStage }
      const maxStage = (IDX[a.stage] !== undefined ? a.stage : 'todo') as PipelineStage
      await ctx.db.patch(a._id, { correction: { maxBefore: i.maxStage } })
      await ctx.db.patch(i._id, { maxStage, ...stamp })
      return { maxStage }
    }
    if (!a.correction) return { maxStage: i.maxStage }
    await ctx.db.patch(a._id, { correction: undefined })
    await ctx.db.patch(i._id, { maxStage: a.correction.maxBefore, ...stamp })
    return { maxStage: a.correction.maxBefore }
  },
})
