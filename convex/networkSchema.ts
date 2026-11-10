// PST-305: Network. Optional fields on PST-294's introducers (company, its domain,
// roles, and the investor a person also is) and on drafts (the intro ask's
// intros), and one table of its own: a founder's investors, looked up (Haiku with
// web search). Every field is optional, so rows written before PST-305 are valid.
// Spread into introducersSchema.ts, draftsSchema.ts and schema.ts in marked blocks.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { vModel, vUsage } from './validators'

const vRoles = v.object({ canIntro: v.optional(v.boolean()), wantsToInvest: v.optional(v.boolean()), givesAdvice: v.optional(v.boolean()) })

/** On each introducers row. */
export const networkPersonFields = {
  /** A founder's company (an angel's title or company). */
  company: v.optional(v.string()),
  /** The company's website domain (founders): what "Find their investors" looks up. */
  companyDomain: v.optional(v.string()),
  /** Can intro (absent: on), Wants to invest, Gives advice (absent: on for advisors). */
  roles: v.optional(vRoles),
  /** The investor this person also is ("Wants to invest"): linked both ways (the drawer finds the person by this index). */
  investorId: v.optional(v.id('investors')),
}

/** On each drafts row: the intro ask's intros (2–3, all from one person). */
export const networkDraftFields = {
  introIds: v.optional(v.array(v.id('intros'))),
}

export const vLookupResult = v.object({
  firm: v.string(),
  partner: v.optional(v.string()),
  round: v.optional(v.string()),
  year: v.optional(v.number()),
  url: v.string(),
  domain: v.optional(v.string()),
  /** Already in Nest (by domain or name) when the lookup finished. */
  investorId: v.optional(v.id('investors')),
  /** Dev ticked it and it was added to the person's list. */
  added: v.optional(v.boolean()),
})

export const networkTables = {
  // "Find their investors": one lookup of a founder's company. The estimate shown before it ran, and what it really cost (in Settings › AI's spend, with Find more).
  founderLookups: defineTable({
    introducerId: v.id('introducers'),
    company: v.string(),
    domain: v.optional(v.string()),
    status: v.union(v.literal('running'), v.literal('done'), v.literal('failed')),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    estimateUsd: v.number(),
    costUsd: v.number(),
    model: vModel,
    usage: v.optional(vUsage),
    error: v.optional(v.string()),
    /** At most 15. */
    results: v.array(vLookupResult),
    startedBy: v.optional(v.id('users')),
  })
    .index('by_introducer', ['introducerId', 'startedAt'])
    .index('by_started', ['startedAt']),
}
