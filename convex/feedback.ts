// PST-289: Send feedback (⌘.). The dialog saves a row (and its screenshot in
// file storage), then `send` turns it into a Linear issue in Pesto › Nest,
// labelled Feedback (convex/lib/linear.ts). Without LINEAR_API_KEY, or when
// Linear says no, the row stays `unsent`: Settings › Feedback lists it with
// Send now, and `retry` (hourly, crons.ts) sends what's waiting once a key is set.
// Logs carry ids and statuses only, never the text.
import { ConvexError, v } from 'convex/values'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx } from './_generated/server'
import { vFeedbackType } from './feedbackSchema'
import { firstName, requireUser } from './lib/access'
import { createFeedbackIssue } from './lib/linear'
import { cleanPath, FEEDBACK_TEXT_MAX, feedbackTitle, issueDescription, type FeedbackList, type FeedbackResult } from '../src/lib/feedback'

/** A run that claimed a row and died is given this long before another may try. */
const STALE_MS = 10 * 6e4
const RETRY_BATCH = 20

const linearKey = () => process.env.LINEAR_API_KEY?.trim() || null

/** Where the dialog uploads the screenshot (POST the image, get a storage id back). */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

export const submit = mutation({
  args: {
    type: vFeedbackType,
    text: v.string(),
    path: v.string(),
    viewport: v.object({ w: v.number(), h: v.number() }),
    version: v.string(),
    screenshotId: v.optional(v.id('_storage')),
  },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const text = a.text.trim()
    if (!text) throw new ConvexError('Say what’s wrong, slow or missing first.')
    if (text.length > FEEDBACK_TEXT_MAX) throw new ConvexError(`Keep it under ${FEEDBACK_TEXT_MAX} characters.`)
    return await ctx.db.insert('feedback', {
      by: userId,
      type: a.type,
      text,
      path: cleanPath(a.path),
      viewport: { w: Math.round(a.viewport.w), h: Math.round(a.viewport.h) },
      version: a.version.slice(0, 40) || 'unknown',
      screenshotId: a.screenshotId,
      status: 'unsent',
      attempts: 0,
    })
  },
})

/** Send one row to Linear now: right after Send, and Settings' Send now. */
export const send = action({
  args: { id: v.id('feedback') },
  handler: async (ctx, { id }): Promise<FeedbackResult> => {
    await ctx.runQuery(internal.feedback.allowed, {})
    return await deliver(ctx, id)
  },
})

/** Settings › Feedback: the latest 30, and whether Linear is set up here. */
export const list = query({
  args: {},
  handler: async (ctx): Promise<FeedbackList> => {
    await requireUser(ctx)
    const rows = await ctx.db.query('feedback').order('desc').take(30)
    const names = new Map<Id<'users'>, string>()
    for (const r of rows) if (!names.has(r.by)) names.set(r.by, firstName(await ctx.db.get(r.by)))
    return {
      linear: !!linearKey(),
      rows: rows.map((r) => ({ _id: r._id, type: r.type, title: feedbackTitle(r.text), path: r.path, status: r.status, issue: r.issue, createdAt: r._creationTime, by: names.get(r.by) ?? '?' })),
    }
  },
})

/* ---------- internal ---------- */

export const allowed = internalQuery({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return null
  },
})

export const get = internalQuery({ args: { id: v.id('feedback') }, handler: (ctx, { id }) => ctx.db.get(id) })

/** Take a row for one run: null when it's sent, or another run has it. */
export const claim = internalMutation({
  args: { id: v.id('feedback') },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id)
    if (!row || row.status === 'sent') return null
    if (row.status === 'sending' && Date.now() - (row.sendingAt ?? 0) < STALE_MS) return null
    await ctx.db.patch(id, { status: 'sending', sendingAt: Date.now(), attempts: row.attempts + 1 })
    return row
  },
})

export const sent = internalMutation({
  args: { id: v.id('feedback'), issue: v.object({ identifier: v.string(), url: v.string() }) },
  handler: async (ctx, { id, issue }) => {
    await ctx.db.patch(id, { status: 'sent', issue, sentAt: Date.now(), sendingAt: undefined, lastError: undefined })
  },
})

export const failed = internalMutation({
  args: { id: v.id('feedback'), error: v.string() },
  handler: async (ctx, { id, error }) => {
    await ctx.db.patch(id, { status: 'unsent', sendingAt: undefined, lastError: error })
  },
})

/** Hourly (crons.ts): with a key set, send what's waiting, a few seconds apart. */
export const retry = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (!linearKey()) return 0
    const unsent = await ctx.db.query('feedback').withIndex('by_status', (q) => q.eq('status', 'unsent')).take(RETRY_BATCH)
    const stuck = (await ctx.db.query('feedback').withIndex('by_status', (q) => q.eq('status', 'sending')).take(RETRY_BATCH)).filter((r) => Date.now() - (r.sendingAt ?? 0) >= STALE_MS)
    const rows = [...unsent, ...stuck].slice(0, RETRY_BATCH)
    for (const [k, r] of rows.entries()) await ctx.scheduler.runAfter(k * 2000, internal.feedback.deliverOne, { id: r._id })
    return rows.length
  },
})

export const deliverOne = internalAction({
  args: { id: v.id('feedback') },
  handler: async (ctx, { id }) => {
    await deliver(ctx, id)
  },
})

async function deliver(ctx: ActionCtx, id: Id<'feedback'>): Promise<FeedbackResult> {
  const key = linearKey()
  if (!key) return { status: 'unsent', reason: 'nokey' }
  const row = await ctx.runMutation(internal.feedback.claim, { id })
  if (!row) {
    const now = await ctx.runQuery(internal.feedback.get, { id })
    return now?.issue ? { status: 'sent', ...now.issue } : { status: 'unsent', reason: 'error' }
  }
  try {
    const screenshot = row.screenshotId ? await ctx.storage.get(row.screenshotId) : null
    const issue = await createFeedbackIssue(key, { title: feedbackTitle(row.text), description: (url) => issueDescription(row, url), screenshot })
    await ctx.runMutation(internal.feedback.sent, { id, issue })
    console.log(`feedback sent id=${id} issue=${issue.identifier}`)
    return { status: 'sent', ...issue }
  } catch (e) {
    const error = e instanceof Error ? e.message.slice(0, 300) : 'Linear didn’t answer'
    await ctx.runMutation(internal.feedback.failed, { id, error })
    console.log(`feedback unsent id=${id} attempt=${row.attempts + 1}`)
    return { status: 'unsent', reason: 'error' }
  }
}
