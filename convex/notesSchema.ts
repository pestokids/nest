// PST-277: meeting notes become updates. One block of tables, spread into
// schema.ts, so other branches' schema changes (the Nest MCP server, PST-276)
// rebase cleanly around it.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { NOTE_SOURCES, READ_STATUSES } from '../src/lib/meetingNotes'
import { vPipelineStage } from './validators'

const lit = <T extends string>(xs: readonly T[]) => v.union(...xs.map((x) => v.literal(x)))

export const vNoteSource = lit(NOTE_SOURCES)
export const vReadStatus = lit(READ_STATUSES)
/** A question they asked: one already in the bank (`questionId`) or a new one, with Dev's answer from the call if he gave one. */
export const vNoteQuestion = v.object({ text: v.string(), questionId: v.optional(v.id('questions')), answer: v.optional(v.string()), quote: v.string() })
const item = { id: v.string(), suggestionId: v.optional(v.id('suggestions')) }
/** One proposed update (src/lib/meetingNotes.ts Proposal). Every one carries the quote it came from. */
export const vProposal = v.union(
  v.object({ ...item, kind: v.literal('next_step'), step: v.string(), date: v.optional(v.string()), quote: v.string() }),
  v.object({ ...item, kind: v.literal('stage'), from: vPipelineStage, to: vPipelineStage, quote: v.string() }),
  v.object({ ...item, kind: v.literal('expected'), amount: v.number(), quote: v.string(), clash: v.optional(v.string()) }),
  v.object({ ...item, kind: v.literal('questions'), items: v.array(vNoteQuestion) }),
  v.object({ ...item, kind: v.literal('warm_path'), text: v.string(), quote: v.string() }),
)

export const notesReadTables = {
  // One time Claude read a note: its summary, what it proposes and what it cost.
  // Each proposal is also a row in Suggestions (source "notes"), so deciding it in either place decides both.
  noteReads: defineTable({
    noteId: v.id('notes'),
    investorId: v.id('investors'),
    status: vReadStatus,
    /** Started by saving notes (or by MCP), not by "Read with Nest". */
    auto: v.boolean(),
    summary: v.array(v.string()),
    proposals: v.array(vProposal),
    costUsd: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    /** Apply or Dismiss in the drawer: what Undo puts back. */
    decided: v.optional(
      v.object({
        at: v.number(),
        accepted: v.array(v.id('suggestions')),
        dropped: v.array(v.id('suggestions')),
        activityId: v.optional(v.id('activities')),
        lastTouch: v.optional(v.string()),
      }),
    ),
  })
    .index('by_note', ['noteId', 'startedAt'])
    .index('by_investor', ['investorId', 'startedAt'])
    .index('by_status', ['status', 'startedAt'])
    .index('by_started', ['startedAt']),

  // Notes that came in (Wispr Flow, an agent) for nobody Nest could match: "Unmatched notes" on Today until Dev picks the investor.
  unmatchedNotes: defineTable({
    email: v.optional(v.string()),
    meetingTitle: v.string(),
    date: v.string(),
    text: v.string(),
    source: vNoteSource,
    createdAt: v.number(),
    /** Picked an investor: the note it became. */
    noteId: v.optional(v.id('notes')),
    /** "Not about the round". */
    droppedAt: v.optional(v.number()),
  }).index('by_created', ['createdAt']),
}
