// PST-292: Jev (TypeSafe's System One model). One block of tables, spread into
// schema.ts, so other branches' schema changes rebase cleanly around it. The cap and
// the on/off switch live on the AI settings row (aiSettingsFields in enrichSchema.ts).
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { JEV_FEATURES } from '../src/lib/jev'

const lit = <T extends string>(xs: readonly T[]) => v.union(...xs.map((x) => v.literal(x)))

export const vJevFeature = lit(JEV_FEATURES)
/** What Jev decided that Dev sees: a Who's this? pre-check, a "Probably …" hint on unmatched notes, a "Same as …" question. */
export const vJevMarkKind = v.union(v.literal('who'), v.literal('note'), v.literal('same_question'))

export const jevTables = {
  // Every call, cache hits and calls the cap stopped included: tokens, cost, and how it went. Never the state or the answers.
  jevRuns: defineTable({
    feature: vJevFeature,
    at: v.number(),
    status: v.union(v.literal('ok'), v.literal('error'), v.literal('capped')),
    /** Short and safe to log: "429", "timeout", "bad_answer"… */
    reason: v.optional(v.string()),
    cached: v.boolean(),
    questions: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    /** The versioned model that answered (jev-1.14.0). */
    model: v.optional(v.string()),
  }).index('by_at', ['at']),

  // Answers by sha256 of (model, state, questions), so the same text is never asked twice.
  jevCache: defineTable({
    hash: v.string(),
    answers: v.any(),
    model: v.optional(v.string()),
    at: v.number(),
  }).index('by_hash', ['hash']),

  // What Jev decided about one thing, keyed by it: an email (who), an unmatched note's id (note), a question's id (same_question).
  jevMarks: defineTable({
    kind: vJevMarkKind,
    subject: v.string(),
    /** The investor (note) or the question it repeats (same_question). */
    target: v.optional(v.string()),
    /** The probability it rests on. */
    p: v.number(),
    at: v.number(),
    /** Dev said no ("Not the same"). */
    undoneAt: v.optional(v.number()),
  }).index('by_subject', ['kind', 'subject', 'at']),
}
