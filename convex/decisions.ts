// PST-293: the decision on each investor (status, decide-by date, calls, how long
// a maybe) and what Dev does with signals: Undo a change Nest made, answer a
// Decide row, tick off an ask. Signals themselves come in through signals.ts.
// Public functions are behind requireUser. Logs carry ids only.
import { ConvexError, v } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { firstName, requireUser } from './lib/access'
import { vDecisionStatus } from './decisionsSchema'
import { buildDecisions, isCallAct, nextMaybeSince, type DecisionStatus } from '../src/lib/decisions'
import type { SignalView } from '../src/lib/signals'
import { isISODate } from '../src/lib/dates'
import { DAY_MS } from '../src/lib/google'

/** Signals the app reads: the last 60 days (latest signal, Decide rows, asks, the auto changes' toasts). */
const SIGNAL_DAYS = 60

export const decisionRow = (ctx: QueryCtx, investorId: Id<'investors'>) =>
  ctx.db.query('decisions').withIndex('by_investor', (q) => q.eq('investorId', investorId)).unique()

/**
 * Change an investor's status and log it. Maybe-since is set when it becomes
 * Maybe and cleared when it leaves. Returns the log row (what Undo takes), or
 * null when it already was that.
 */
export async function applyStatus(
  ctx: MutationCtx,
  investorId: Id<'investors'>,
  to: DecisionStatus | undefined,
  o: { reason?: string; userId?: Id<'users'>; signalId?: Id<'signals'>; now?: number } = {},
): Promise<Id<'decisionLog'> | null> {
  const now = o.now ?? Date.now()
  const row = await decisionRow(ctx, investorId)
  const reason = to ? o.reason?.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined : undefined
  if (row?.status === to && row?.reason === reason) return null
  const fields = { status: to, reason, maybeSince: nextMaybeSince(row ?? undefined, to, now), updatedAt: now }
  if (row) await ctx.db.patch(row._id, fields)
  else await ctx.db.insert('decisions', { investorId, ...fields })
  return await ctx.db.insert('decisionLog', {
    investorId, at: now, from: row?.status, to, reason, prevReason: row?.reason, prevMaybeSince: row?.maybeSince, userId: o.userId, signalId: o.signalId,
  })
}

/** Put a logged change back. Refuses when the status has changed again since. */
async function undoLog(ctx: MutationCtx, logId: Id<'decisionLog'>) {
  const log = await ctx.db.get(logId)
  if (!log) throw new ConvexError('That change is gone, so there’s nothing to undo')
  if (log.undoneAt) return false
  const row = await decisionRow(ctx, log.investorId)
  if (row?.status !== log.to || row?.reason !== log.reason) throw new ConvexError('It changed again since, so there’s nothing to undo')
  const now = Date.now()
  if (row) await ctx.db.patch(row._id, { status: log.from, reason: log.prevReason, maybeSince: log.from === 'maybe' ? log.prevMaybeSince : undefined, updatedAt: now })
  await ctx.db.patch(log._id, { undoneAt: now })
  if (log.signalId && (await ctx.db.get(log.signalId))) await ctx.db.patch(log.signalId, { undoneAt: now })
  return true
}

export const signalView = (s: Doc<'signals'>): SignalView => ({
  _id: s._id,
  investorId: s.investorId,
  source: s.source,
  day: s.day,
  at: s.at,
  outcome: s.outcome,
  p: s.p,
  ...(s.change ? { change: s.change } : {}),
  ...(s.asked ? { asked: s.asked } : {}),
  ...(s.probabilities.pass !== undefined ? { pass: s.probabilities.pass } : {}),
  ...(s.probabilities.real !== undefined ? { real: s.probabilities.real } : {}),
  ...(s.probabilities.lead !== undefined ? { lead: s.probabilities.lead } : {}),
  ...(s.probabilities.comeback !== undefined ? { comeback: s.probabilities.comeback } : {}),
  ...(s.answers.score !== undefined ? { score: s.answers.score } : {}),
  ...(s.answers.status ? { status: s.answers.status } : {}),
  ...(s.doneAt ? { doneAt: s.doneAt } : {}),
  ...(s.askDoneAt ? { askDoneAt: s.askDoneAt } : {}),
  ...(s.undoneAt ? { undoneAt: s.undoneAt } : {}),
  // PST-306
  ...(s.messageId ? { messageId: s.messageId } : {}),
  ...(s.probabilities.ask?.nothing !== undefined ? { nothing: s.probabilities.ask.nothing } : {}),
})

/** One investor's decision, worked out the way `data` does (Drafts' "Ask for a yes or no" reads its decide-by date). */
export async function decisionFor(ctx: QueryCtx, investorId: Id<'investors'>, now = Date.now()) {
  const row = await decisionRow(ctx, investorId)
  const acts = (await ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()).filter(isCallAct)
  const meetings = (await ctx.db.query('meetings').withIndex('by_start', (q) => q.lt('start', now)).collect()).filter((m) => m.investorIds.includes(investorId))
  return buildDecisions([investorId], row ? [row] : [], meetings, acts, now)[0]
}

/* ---------- what the app reads ---------- */

/** Every investor's decision (calls and the decide-by date worked out here), and the last 60 days of signals. */
export const data = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const now = Date.now()
    const investors = await ctx.db.query('investors').collect()
    const rows = await ctx.db.query('decisions').collect()
    const acts = (await ctx.db.query('activities').collect()).filter(isCallAct)
    const meetings = (await ctx.db.query('meetings').withIndex('by_start', (q) => q.lt('start', now)).collect()).filter((m) => m.investorIds.length)
    const signals = await ctx.db.query('signals').withIndex('by_at', (q) => q.gte('at', now - SIGNAL_DAYS * DAY_MS)).collect()
    return {
      decisions: buildDecisions(investors.map((i) => i._id), rows, meetings, acts, now),
      signals: signals.map(signalView),
    }
  },
})

/** One investor's status changes, newest first, for the drawer's History (`auto`: Nest made it from an email or notes). */
export const log = query({
  args: { investorId: v.id('investors') },
  handler: async (ctx, { investorId }) => {
    await requireUser(ctx)
    const rows = await ctx.db.query('decisionLog').withIndex('by_investor', (q) => q.eq('investorId', investorId)).order('desc').take(100)
    const out = []
    for (const r of rows) {
      const sig = r.signalId ? await ctx.db.get(r.signalId) : null
      out.push({
        _id: r._id, at: r.at, from: r.from, to: r.to, reason: r.reason, undoneAt: r.undoneAt,
        by: r.userId ? firstName(await ctx.db.get(r.userId)) : undefined,
        auto: !r.userId && !!r.signalId,
        ...(sig ? { source: sig.source, day: sig.day } : {}),
      })
    }
    return out
  },
})

/* ---------- Dev's changes ---------- */

const live = async (ctx: QueryCtx, id: Id<'investors'>) => {
  if (!(await ctx.db.get(id))) throw new ConvexError('That investor was deleted')
}

/** Set the status (null clears it). Resolves with the log row Undo takes, or null when nothing changed. */
export const setStatus = mutation({
  args: { investorId: v.id('investors'), status: v.union(vDecisionStatus, v.null()), reason: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    await live(ctx, a.investorId)
    return await applyStatus(ctx, a.investorId, a.status ?? undefined, { reason: a.reason, userId })
  },
})

/** Undo a status change (Dev's, or one Nest made from a signal). */
export const undo = mutation({
  args: { logId: v.id('decisionLog') },
  handler: async (ctx, { logId }) => {
    await requireUser(ctx)
    return await undoLog(ctx, logId)
  },
})

/** Undo the change a signal made (the toast, the drawer). */
export const undoSignal = mutation({
  args: { signalId: v.id('signals') },
  handler: async (ctx, { signalId }) => {
    await requireUser(ctx)
    const s = await ctx.db.get(signalId)
    if (!s?.logId) throw new ConvexError('Nest didn’t change anything from that one')
    return await undoLog(ctx, s.logId)
  },
})

/** The decide-by date: a day, or null to clear it. Either way it stops following the 1st meeting. */
export const setDecideBy = mutation({
  args: { investorId: v.id('investors'), date: v.union(v.string(), v.null()) },
  handler: async (ctx, { investorId, date }) => {
    await requireUser(ctx)
    await live(ctx, investorId)
    if (date !== null && !isISODate(date)) throw new ConvexError('That isn’t a date')
    const row = await decisionRow(ctx, investorId)
    const fields = { decideBy: date ?? undefined, decideByManual: true, updatedAt: Date.now() }
    if (row) await ctx.db.patch(row._id, fields)
    else await ctx.db.insert('decisions', { investorId, ...fields })
    return null
  },
})

/** A Decide row: take the change it proposes (logged as Dev's), or leave things as they are. Resolves with the log row, if any. */
export const resolve = mutation({
  args: { signalId: v.id('signals'), accept: v.boolean() },
  handler: async (ctx, { signalId, accept }) => {
    const { userId } = await requireUser(ctx)
    const s = await ctx.db.get(signalId)
    if (!s || s.outcome !== 'decide' || s.doneAt) throw new ConvexError('That one was already decided')
    const logId = accept && s.change ? await applyStatus(ctx, s.investorId, s.change.to, { reason: s.change.reason, userId, signalId }) : null
    await ctx.db.patch(signalId, { doneAt: Date.now() })
    return logId
  },
})

/** An ask's Inbox row is done. */
export const doneAsk = mutation({
  args: { signalId: v.id('signals') },
  handler: async (ctx, { signalId }) => {
    await requireUser(ctx)
    const s = await ctx.db.get(signalId)
    if (s && !s.askDoneAt) await ctx.db.patch(signalId, { askDoneAt: Date.now() })
    return null
  },
})

/** An investor was deleted: their decision, its log and their signals go too. */
export async function forgetDecisions(ctx: MutationCtx, investorId: Id<'investors'>) {
  const row = await decisionRow(ctx, investorId)
  if (row) await ctx.db.delete(row._id)
  for (const l of await ctx.db.query('decisionLog').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()) await ctx.db.delete(l._id)
  for (const s of await ctx.db.query('signals').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()) await ctx.db.delete(s._id)
}
