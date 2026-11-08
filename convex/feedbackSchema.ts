// PST-289: Send feedback (⌘.). One block of tables, spread into schema.ts, so
// other branches' schema changes rebase cleanly around it.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const vFeedbackType = v.union(v.literal('bug'), v.literal('idea'), v.literal('slow'), v.literal('confusing'))
export const vFeedbackStatus = v.union(v.literal('unsent'), v.literal('sending'), v.literal('sent'))

export const feedbackTables = {
  // What someone sent with ⌘., and how far it got. `unsent` waits for LINEAR_API_KEY
  // (or for Linear to answer again): Settings › Feedback has Send now, and a cron
  // retries hourly. `sending` is claimed by one run at a time.
  feedback: defineTable({
    by: v.id('users'),
    type: vFeedbackType,
    text: v.string(),
    /** The page's path only, never its query string. */
    path: v.string(),
    viewport: v.object({ w: v.number(), h: v.number() }),
    version: v.string(),
    /** The page as an image, in Convex file storage. */
    screenshotId: v.optional(v.id('_storage')),
    status: vFeedbackStatus,
    attempts: v.number(),
    sendingAt: v.optional(v.number()),
    /** Why the last try didn't land (Linear's own words, never the key). */
    lastError: v.optional(v.string()),
    issue: v.optional(v.object({ identifier: v.string(), url: v.string() })),
    sentAt: v.optional(v.number()),
  }).index('by_status', ['status']),
}
