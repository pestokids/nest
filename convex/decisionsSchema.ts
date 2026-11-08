// PST-293: decisions and signals. One block of tables, spread into schema.ts, so
// other branches' schema changes rebase cleanly around it. The decision lives in
// its own table rather than on the investor row, because saving an investor
// replaces the whole row (convex/investors.ts).
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { DECISION_STATUSES } from '../src/lib/decisions'
import { ASKS, type Ask } from '../src/lib/signals'

const lit = <T extends string>(xs: readonly T[]) => v.union(...xs.map((x) => v.literal(x)))

export const vDecisionStatus = lit(DECISION_STATUSES)
export const vAsk = lit(ASKS)
const vAsked = lit(ASKS.filter((a): a is Ask => a !== 'nothing'))
export const vSignalSource = v.union(v.literal('email'), v.literal('note'))
export const vSignalOutcome = v.union(v.literal('auto'), v.literal('decide'), v.literal('none'))
export const vSignalChange = v.object({ from: v.optional(vDecisionStatus), to: vDecisionStatus, reason: v.optional(v.string()) })
const vProbs = v.record(v.string(), v.number())

export const decisionTables = {
  // One row per investor with a decision. Every field optional: no row means no status and Nest's own decide-by date.
  decisions: defineTable({
    investorId: v.id('investors'),
    status: v.optional(vDecisionStatus),
    /** Why, in a few words ("wants a lead"). */
    reason: v.optional(v.string()),
    /** When the status became Maybe; cleared when it leaves. */
    maybeSince: v.optional(v.number()),
    /** Dev's own date, when decideByManual (absent then means Dev cleared it). */
    decideBy: v.optional(v.string()),
    decideByManual: v.optional(v.boolean()),
    updatedAt: v.number(),
  }).index('by_investor', ['investorId']),

  // Every status change, for the drawer's History and Undo. userId absent: Nest made it from a signal (`signalId`).
  decisionLog: defineTable({
    investorId: v.id('investors'),
    at: v.number(),
    from: v.optional(vDecisionStatus),
    to: v.optional(vDecisionStatus),
    reason: v.optional(v.string()),
    /** What it replaced, so Undo puts back the reason and the maybe-since too. */
    prevReason: v.optional(v.string()),
    prevMaybeSince: v.optional(v.number()),
    userId: v.optional(v.id('users')),
    signalId: v.optional(v.id('signals')),
    undoneAt: v.optional(v.number()),
  }).index('by_investor', ['investorId', 'at']),

  // What Jev read in one email or note: the answers and their probabilities, and what Nest did.
  // Never the text: emailTouchId + messageId, or noteId, point at where it came from.
  signals: defineTable({
    investorId: v.id('investors'),
    source: vSignalSource,
    emailTouchId: v.optional(v.id('emailTouches')),
    messageId: v.optional(v.string()),
    noteId: v.optional(v.id('notes')),
    /** The day of the email or note. */
    day: v.string(),
    /** "email:<message id>:<investor>" or "note:<note id>": one signal each. */
    key: v.string(),
    /** The picks: an email's ask, a note's status and interest (1 to 5). */
    answers: v.object({ ask: v.optional(vAsk), status: v.optional(vDecisionStatus), score: v.optional(v.number()) }),
    /** Choice and Score probabilities by option, and each Noul. */
    probabilities: v.object({
      ask: v.optional(vProbs),
      status: v.optional(vProbs),
      score: v.optional(vProbs),
      pass: v.optional(v.number()),
      real: v.optional(v.number()),
      lead: v.optional(v.number()),
      comeback: v.optional(v.number()),
    }),
    outcome: vSignalOutcome,
    /** The change it made (auto) or proposes (decide). */
    change: v.optional(vSignalChange),
    /** The probability the outcome rests on. */
    p: v.number(),
    /** A sure ask, for the Inbox's "new asks". */
    asked: v.optional(vAsked),
    at: v.number(),
    /** The status change it made (auto), for Undo. */
    logId: v.optional(v.id('decisionLog')),
    doneAt: v.optional(v.number()),
    askDoneAt: v.optional(v.number()),
    undoneAt: v.optional(v.number()),
  })
    .index('by_key', ['key'])
    .index('by_investor', ['investorId', 'at'])
    .index('by_at', ['at']),
}
