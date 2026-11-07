// PST-279: Ask Nest (⌘K) and the morning brief. One block of tables, spread into
// schema.ts, plus the brief's toggle on the AI settings row, so other branches'
// schema changes (Drafts, PST-278) rebase cleanly around it.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { ASK_STATUSES } from '../src/lib/ask'
import { NOTE_STATES } from '../src/lib/brief'
import { vMaterialKind } from './materialsSchema'

const lit = <T extends string>(xs: readonly T[]) => v.union(...xs.map((x) => v.literal(x)))

export const vAskStatus = lit(ASK_STATUSES)
export const vSources = v.object({ investors: v.number(), threads: v.number(), meetings: v.number() })
const who = { investorId: v.id('investors'), name: v.string() }
export const vBriefSince = v.object({
  /** Gmail threads where the investor wrote last since yesterday: waiting on Dev. */
  replies: v.array(v.object(who)),
  /** Materials opened since yesterday: which, for how long, and the page read longest. */
  opens: v.array(v.object({ ...who, material: v.string(), kind: vMaterialKind, ms: v.number(), page: v.optional(v.number()) })),
  /** Investor meetings that ended since yesterday, and whether Nest has read notes from them. */
  meetings: v.array(v.object({ ...who, title: v.string(), notes: lit(NOTE_STATES) })),
  suggestions: v.object({ open: v.number(), safe: v.number() }),
})
export const vBriefMove = v.object({
  key: v.string(),
  title: v.string(),
  /** Today's own why line (the fallback). */
  why: v.string(),
  /** Claude's one line, from the facts. Absent when AI isn't set up or it failed. */
  reason: v.optional(v.string()),
  investorId: v.optional(v.id('investors')),
})

/** Added to the AI settings row (key "ai"). Left out = on. */
export const askSettingsFields = { morningBrief: v.optional(v.boolean()) }

export const askTables = {
  // One question asked in ⌘K. The answer streams into `text`; Ask only ever reads.
  askRuns: defineTable({
    userId: v.id('users'),
    question: v.string(),
    status: vAskStatus,
    /** The answer so far, investors cited as [[investor:<id>|Name]]. */
    text: v.string(),
    /** The read tools it called, in order (at most MAX_TOOL_CALLS). */
    tools: v.array(v.string()),
    sources: vSources,
    costUsd: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index('by_user', ['userId', 'startedAt'])
    .index('by_started', ['startedAt']),

  // The morning brief: one per IST day, built at 08:00 (crons.ts).
  briefs: defineTable({
    day: v.string(),
    builtAt: v.number(),
    since: vBriefSince,
    moves: v.array(vBriefMove),
    costUsd: v.number(),
    /** Dismissed on Today: it collapses to one line. */
    dismissedAt: v.optional(v.number()),
  })
    .index('by_day', ['day'])
    .index('by_built', ['builtAt']),
}
