// PST-307: the Advisor (chats, their messages and what it remembers), and its
// three settings on the AI row. Spread into schema.ts in its own block so other
// branches' schema changes rebase around it. Every settings field is optional:
// left out means Sonnet, a $20 monthly cap and web search on (src/lib/advisor.ts).
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { ADVISOR_MODES, MESSAGE_STATUSES, SOURCE_KINDS } from '../src/lib/advisor'
import { CHANGE_KINDS, DRAFT_KINDS } from '../src/lib/advisorBlocks'
import { AI_DRAFT_TYPES } from '../src/lib/drafts'
import { vModel, vUsage } from './validators'

const lit = <T extends string>(xs: readonly T[]) => v.union(...xs.map((x) => v.literal(x)))

export const vAdvisorMode = lit(ADVISOR_MODES)
export const vMessageStatus = lit(MESSAGE_STATUSES)
export const vSource = v.object({ kind: lit(SOURCE_KINDS), label: v.string(), investorId: v.optional(v.string()), url: v.optional(v.string()) })
export const vPinned = v.object({ kind: v.union(v.literal('investor'), v.literal('material')), id: v.string(), label: v.string() })
export const vScreen = v.object({ path: v.string(), view: v.optional(v.string()), investorId: v.optional(v.string()), investorName: v.optional(v.string()) })

/** The answer blocks (src/lib/advisorBlocks.ts Block). Investor ids stay strings: an answer outlives a deleted investor, and the UI shows it as gone. */
export const vBlock = v.union(
  v.object({ kind: v.literal('investor_card'), investorId: v.string(), note: v.optional(v.string()) }),
  v.object({ kind: v.literal('plan'), title: v.optional(v.string()), items: v.array(v.object({ text: v.string(), date: v.string(), investorId: v.optional(v.string()) })), ticked: v.array(v.number()) }),
  v.object({ kind: v.literal('options'), question: v.optional(v.string()), options: v.array(v.object({ label: v.string(), upside: v.string(), risk: v.string() })), picked: v.optional(v.number()) }),
  v.object({ kind: v.literal('race'), investorIds: v.array(v.string()), note: v.optional(v.string()) }),
  v.object({ kind: v.literal('story'), title: v.optional(v.string()), investorId: v.optional(v.string()), beats: v.array(v.object({ label: v.string(), text: v.string() })) }),
  v.object({
    kind: v.literal('blank'), label: v.string(), unit: v.optional(v.string()), why: v.optional(v.string()), investorId: v.optional(v.string()), value: v.optional(v.string()),
    saved: v.optional(v.union(v.literal('story'), v.literal('plan'))),
  }),
  v.object({
    kind: v.literal('draft'), draftKind: lit(DRAFT_KINDS), title: v.string(), subject: v.optional(v.string()), body: v.string(), question: v.optional(v.string()), investorId: v.optional(v.string()),
    draftType: v.optional(lit(AI_DRAFT_TYPES)), draftId: v.optional(v.string()), questionId: v.optional(v.string()),
  }),
  v.object({ kind: v.literal('follow_ups'), questions: v.array(v.string()) }),
  v.object({
    kind: v.literal('suggestion'), investorId: v.string(), change: lit(CHANGE_KINDS), value: v.optional(v.string()), date: v.optional(v.string()), why: v.string(),
    state: v.union(v.literal('proposed'), v.literal('sent'), v.literal('not_added')), suggestionId: v.optional(v.string()), note: v.optional(v.string()),
  }),
  v.object({ kind: v.literal('memory'), fact: v.string(), state: v.union(v.literal('asked'), v.literal('saved'), v.literal('dismissed')), memoryId: v.optional(v.string()) }),
)

/** Added to the AI settings row (key "ai"). */
export const advisorSettingsFields = {
  advisorModel: v.optional(vModel),
  advisorCapUsd: v.optional(v.number()),
  advisorWeb: v.optional(v.boolean()),
}

export const advisorTables = {
  // One chat with the Advisor. Totals are kept on the row so the list never reads every message.
  advisorChats: defineTable({
    userId: v.id('users'),
    title: v.string(),
    pinned: v.boolean(),
    /** The chat's model (Sonnet or Opus); one answer can still be asked of Opus. */
    model: vModel,
    /** The mode of the latest message (it's picked per message). */
    mode: vAdvisorMode,
    createdAt: v.number(),
    updatedAt: v.number(),
    totalCostUsd: v.number(),
    messageCount: v.number(),
    /** "+ Context": investors and materials pinned to this chat. */
    pinnedContext: v.optional(v.array(vPinned)),
    /** Started from the ⌘J panel: the screen it was opened on. */
    screen: v.optional(vScreen),
    /** Deleted, waiting out its Undo (lists leave it out). */
    deletedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId', 'updatedAt']),

  // A question or an answer. An answer streams into `text` (investors cited as [[investor:<id>|Name]]).
  advisorMessages: defineTable({
    chatId: v.id('advisorChats'),
    role: v.union(v.literal('user'), v.literal('assistant')),
    text: v.string(),
    blocks: v.array(vBlock),
    sources: v.array(vSource),
    model: v.optional(vModel),
    mode: v.optional(vAdvisorMode),
    costUsd: v.number(),
    usage: v.optional(vUsage),
    status: vMessageStatus,
    error: v.optional(v.string()),
    /** The cap refused it before it started. */
    capped: v.optional(v.boolean()),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index('by_chat', ['chatId', 'createdAt'])
    .index('by_created', ['createdAt']),

  // A fact the Advisor keeps between chats. Only ever saved after Dev says Yes to "Remember this?".
  advisorMemory: defineTable({
    fact: v.string(),
    chatId: v.optional(v.id('advisorChats')),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    createdBy: v.id('users'),
  }).index('by_created', ['createdAt']),
}
