// PST-283: Close. Closing records and the cap table inputs. Nest tracks
// signing only: each step is ticked by hand, and the signed and wired ticks
// move the pipeline stage by the board's rules (src/lib/close.ts stageMove).
import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { getRoundRow } from './lib/round'
import { closingTermFields, vCapTable, vStepKey } from './closeSchema'
import { applyMove } from '../src/lib/board'
import { todayIST } from '../src/lib/dates'
import { capTableSummary, checkTick, cleanCapTable, cleanTerms, planTick, setStep, validateCapTable, validateTerms } from '../src/lib/close'
import { COMMIT } from '../src/lib/stages'

/** Every closing record, and the cap table inputs (null until someone enters them). */
export const data = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const closings = await ctx.db.query('closings').collect()
    const row = await getRoundRow(ctx)
    return { closings, capTable: row?.capTable ?? null }
  },
})

const fieldErrors = (errors: Record<string, string>) => {
  if (Object.keys(errors).length) throw new ConvexError({ message: 'Fix the highlighted fields', errors })
}

/**
 * Create or update an investor's closing record (the client sends every term,
 * links included). With `sentAt`, also ticks "SAFE sent" on that day: Record
 * SAFE sent. A new record needs the investor in Verbal or later. The amount
 * becomes the investor's Committed.
 */
export const save = mutation({
  args: { investorId: v.id('investors'), terms: v.object(closingTermFields), sentAt: v.optional(v.string()) },
  handler: async (ctx, { investorId, terms, sentAt }) => {
    const { userId } = await requireUser(ctx)
    const inv = await ctx.db.get(investorId)
    if (!inv) throw new ConvexError('That investor was deleted')
    const body = cleanTerms(terms)
    fieldErrors(validateTerms(body))
    const prev = await ctx.db.query('closings').withIndex('by_investor', (q) => q.eq('investorId', investorId)).unique()
    if (!prev && !COMMIT.has(inv.stage)) throw new ConvexError(`Move ${inv.name} to Verbal first. Closing records start at a verbal yes.`)
    let steps = prev?.steps ?? []
    if (sentAt) {
      const err = checkTick(steps, 'sent', sentAt, todayIST())
      if (err) fieldErrors({ sentAt: err })
      steps = setStep(steps, 'sent', sentAt)
    }
    const now = Date.now()
    // The SAFE's amount is what they committed: keep Today and Plan in step with it.
    if (inv.committed !== body.amount) await ctx.db.patch(investorId, { committed: body.amount, updatedAt: now, updatedBy: userId })
    const doc = { investorId, ...body, steps, updatedAt: now, updatedBy: userId }
    if (!prev) return await ctx.db.insert('closings', doc)
    await ctx.db.replace(prev._id, doc)
    return prev._id
  },
})

/**
 * Tick a step on a day, re-date it, or untick it (`at: null`). Ticking "Signed by
 * them" moves Verbal → Signed and "Wired" moves Signed → Money in, with the
 * same write as a board move (lastTouch today, maxStage only rises, a stage
 * activity); unticking undoes that move. A tick that would skip a stage is
 * refused. `firstMoney`: the investor reached Money in for the first time.
 */
export const tick = mutation({
  args: { id: v.id('closings'), key: vStepKey, at: v.union(v.string(), v.null()) },
  handler: async (ctx, { id, key, at }) => {
    const { userId } = await requireUser(ctx)
    const c = await ctx.db.get(id)
    if (!c) throw new ConvexError('That closing record was removed')
    const inv = await ctx.db.get(c.investorId)
    if (!inv) throw new ConvexError('That investor was deleted')
    const today = todayIST()
    const plan = planTick(c, inv.stage, key, at, today)
    if ('error' in plan) throw new ConvexError(plan.error)
    const now = Date.now()
    await ctx.db.patch(id, { steps: plan.steps, updatedAt: now, updatedBy: userId })
    if (!plan.to) return { to: null, firstMoney: false }
    const { patch, logStage } = applyMove(inv, plan.to, today)
    await ctx.db.patch(inv._id, { ...patch, updatedAt: now, updatedBy: userId })
    if (logStage) await ctx.db.insert('activities', { investorId: inv._id, kind: 'stage', stage: logStage, date: today, userId })
    return { to: plan.to, firstMoney: plan.to === 'wired' && inv.maxStage !== 'wired' }
  },
})

/** Remove a closing record (the pipeline stage stays where it is). */
export const remove = mutation({
  args: { id: v.id('closings') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    if (await ctx.db.get(id)) await ctx.db.delete(id)
    return null
  },
})

/** Save (or clear, with null) the cap table inputs on the round row; one change-log row when they change. */
export const setCapTable = mutation({
  args: { capTable: v.union(vCapTable, v.null()) },
  handler: async (ctx, { capTable }) => {
    const { userId } = await requireUser(ctx)
    const row = await getRoundRow(ctx)
    if (!row) throw new ConvexError('Save the round first, then add the cap table.')
    const next = capTable ? cleanCapTable(capTable) : null
    if (next) fieldErrors(validateCapTable(next))
    const from = capTableSummary(row.capTable)
    const to = capTableSummary(next)
    if (from === to && JSON.stringify(row.capTable ?? null) === JSON.stringify(next)) return 0
    await ctx.db.patch(row._id, { capTable: next ?? undefined })
    await ctx.db.insert('settingsLog', { userId, at: Date.now(), field: 'capTable', from, to })
    return 1
  },
})

/** An investor was deleted: its closing record goes too. */
export async function forgetClosing(ctx: MutationCtx, investorId: Id<'investors'>) {
  for (const c of await ctx.db.query('closings').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()) await ctx.db.delete(c._id)
}
