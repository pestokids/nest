// PST-297: the Today Inbox. Done and snooze marks per row key (each holds while
// the row's source is unchanged: `version`), and the day the clear-inbox
// confetti last played. Both per person. Spread into schema.ts in its own block.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const vInboxMarkKind = v.union(v.literal('done'), v.literal('snooze'))

export const inboxTables = {
  inboxMarks: defineTable({
    userId: v.id('users'),
    /** The row's key, e.g. `reply:<investor id>`. */
    key: v.string(),
    kind: vInboxMarkKind,
    /** A short hash of the row's source state when it was marked. */
    version: v.string(),
    /** Snoozed until (epoch ms). */
    until: v.optional(v.number()),
    at: v.number(),
  }).index('by_user_key', ['userId', 'key']),

  inboxCleared: defineTable({
    userId: v.id('users'),
    /** The IST day the confetti last played. */
    day: v.string(),
  }).index('by_user', ['userId']),
}
