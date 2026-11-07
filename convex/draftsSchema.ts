// PST-278: Drafts. One row per draft Nest wrote (or Dev wrote, when AI isn't set
// up) for an investor; it stays to show in the drawer's History. Spread into
// schema.ts in its own block so other branches' schema changes rebase around it.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { DRAFT_STATUSES, DRAFT_TYPES, TWEAKS } from '../src/lib/drafts'
import { runModelFields } from './validators'

const lit = <T extends string>(xs: readonly T[]) => v.union(...xs.map((x) => v.literal(x)))
export const vDraftType = lit(DRAFT_TYPES)
export const vDraftStatus = lit(DRAFT_STATUSES)
export const vTweak = lit(TWEAKS)
export const vDraftVia = v.union(v.literal('nest'), v.literal('copy'), v.literal('whatsapp'))

export const draftTables = {
  drafts: defineTable({
    investorId: v.id('investors'),
    type: vDraftType,
    subject: v.string(),
    body: v.string(),
    /** draft until it's copied (Copy, WhatsApp) or sent (from Nest, or ticked "I sent it"). */
    status: vDraftStatus,
    /** What Claude cost for this draft, every regenerate added up. */
    costUsd: v.number(),
    createdAt: v.number(),
    createdBy: v.id('users'),
    to: v.optional(v.string()),
    via: v.optional(vDraftVia),
    /** When it was sent, and its email touch logged. */
    sentAt: v.optional(v.number()),
    /** PST-273: the model of the latest write, and the usage of every write added up (like costUsd). */
    ...runModelFields,
  })
    .index('by_investor', ['investorId', 'createdAt'])
    .index('by_created', ['createdAt']),
}
