// PST-295: Race and the lead. The fields it adds to investors and the round row,
// and the log of updates Dev sent, spread into schema.ts in their own blocks so
// other branches' schema changes rebase around them. See src/lib/race.ts.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { CAN_LEAD_VALUES } from '../src/lib/race'

export const vCanLeadValue = v.union(...CAN_LEAD_VALUES.map((x) => v.literal(x)))
/** Enrichment's answer to "can they lead?", with a short reason. */
export const vCanLead = v.object({ value: vCanLeadValue, reason: v.string() })

/** Added to investors, all optional. */
export const investorLeadFields = {
  /** From enrichment (new and refreshed runs); `at` is when it was found. */
  canLead: v.optional(v.object({ value: vCanLeadValue, reason: v.string(), at: v.optional(v.number()) })),
  /** Dev's switch in the drawer. Always wins over enrichment. */
  leadOverride: v.optional(v.boolean()),
  /** The day Dev asked them to lead (the lead draft went out, or ticked by hand). */
  leadAskedOn: v.optional(v.string()),
}

/** Added to the round settings row: the investor leading the round, when there is one. */
export const roundLeadField = { leadId: v.optional(v.id('investors')) }

export const raceTables = {
  // "Mark sent" under Who to update: Dev sent an update himself. Nest never sends these.
  investorUpdates: defineTable({
    sentOn: v.string(),
    at: v.number(),
    by: v.id('users'),
    /** How many addresses were on the list then. */
    count: v.number(),
  }).index('by_at', ['at']),
}
