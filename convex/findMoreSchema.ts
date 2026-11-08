// PST-296: Find more like these and Jev's fit scores. One block of tables, spread
// into schema.ts, so other branches' schema changes rebase cleanly around it.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { vModel, vUsage } from './validators'

export const vFitParts = v.object({ stage: v.number(), check: v.number(), thesis: v.number(), activity: v.number() })
export const vBacked = v.object({ company: v.string(), round: v.optional(v.string()), date: v.optional(v.string()) })
export const vFindSource = v.object({ url: v.string(), title: v.optional(v.string()) })
/** A candidate as the run keeps it (src/lib/findMore.ts Found). */
export const vFound = {
  name: v.string(),
  firm: v.string(),
  type: v.optional(v.string()),
  domain: v.optional(v.string()),
  leads: v.optional(v.boolean()),
  stage: v.optional(v.string()),
  check: v.optional(v.string()),
  checkUsd: v.optional(v.number()),
  thesis: v.optional(v.string()),
  geography: v.optional(v.string()),
  backed: v.array(vBacked),
  dealsLast12: v.optional(v.number()),
  lastDeal: v.optional(v.string()),
  coInvests: v.optional(v.array(v.string())),
  sources: v.array(vFindSource),
}

export const findMoreTables = {
  // The companies one step ahead of Pesto (the panel's chips). One row.
  findSettings: defineTable({
    companies: v.array(v.string()),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id('users')),
  }),

  // One Find more run: its seeds, the estimate shown before it ran, and what it really cost (Haiku and web searches; Jev's calls are in jevRuns).
  findRuns: defineTable({
    status: v.union(v.literal('running'), v.literal('done'), v.literal('failed')),
    companies: v.array(v.string()),
    investors: v.array(v.string()),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    estimateUsd: v.number(),
    costUsd: v.number(),
    /** What its Jev calls cost (already in jevRuns, so not in the spend twice). */
    jevUsd: v.optional(v.number()),
    model: vModel,
    usage: v.optional(vUsage),
    error: v.optional(v.string()),
    /** Found but left out: no deal in 12 months, or already in Nest. */
    inactive: v.optional(v.number()),
    already: v.optional(v.number()),
    startedBy: v.optional(v.id('users')),
  }).index('by_started', ['startedAt']),

  // What a run found: at most 30 a run. Added ones point at their suggestion.
  findCandidates: defineTable({
    runId: v.id('findRuns'),
    ...vFound,
    score: v.number(),
    /** Jev's four answers weighed (src/lib/fitScore.ts), or Nest's own Priority when Jev couldn't answer. */
    scoredBy: v.union(v.literal('jev'), v.literal('nest')),
    parts: v.optional(vFitParts),
    warmPath: v.optional(v.string()),
    status: v.union(v.literal('new'), v.literal('suggested')),
    suggestionId: v.optional(v.id('suggestions')),
  })
    .index('by_run', ['runId'])
    .index('by_suggestion', ['suggestionId']),

  // Investors › Sort: Priority: an investor's Jev fit score, kept under the hash of the facts Jev read. Recomputed only when that hash changes.
  jevScores: defineTable({
    investorId: v.id('investors'),
    hash: v.string(),
    score: v.number(),
    parts: vFitParts,
    at: v.number(),
  }).index('by_investor', ['investorId']),
}
