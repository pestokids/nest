// PST-294: Introducers as people, and one intro per introducer and investor
// with its six dated steps (src/lib/introducers.ts). Spread into schema.ts in
// its own block so other branches' schema changes rebase around it.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { RELATIONS, STEPS, STORED_RELATIONS } from '../src/lib/introducers'
import { networkPersonFields } from './networkSchema' // PST-305

const lit = <T extends string>(xs: readonly T[]) => v.union(...xs.map((x) => v.literal(x)))
export const vRelation = lit(RELATIONS)
/** PST-305: what a row may hold: every relation, and 'portfolio' until network.migrateRelations has run. */
export const vStoredRelation = lit(STORED_RELATIONS)
export const vStep = lit(STEPS)
/** Each step's day (YYYY-MM-DD, IST); absent until done. */
const day = v.optional(v.string())
export const vSteps = v.object({ asked: day, yes: day, sent: day, made: day, thanked: day, reported: day } satisfies Record<(typeof STEPS)[number], typeof day>)

export const introducerTables = {
  // People who introduce Dev. Committed investors are introducers too, but derived from the investor list, never rows here.
  introducers: defineTable({
    name: v.string(),
    /** normName(name): the same person is one row. */
    key: v.string(),
    email: v.optional(v.string()),
    relation: vStoredRelation,
    notes: v.string(),
    createdAt: v.number(),
    createdBy: v.optional(v.id('users')),
    // PST-305 (optional, additive): company, its domain, roles, and the investor they also are.
    ...networkPersonFields,
  })
    .index('by_key', ['key'])
    .index('by_investor', ['investorId']), // PST-305

  // One intro per introducer (a person, or a committed investor) and investor.
  intros: defineTable({
    investorId: v.id('investors'),
    introducerId: v.optional(v.id('introducers')),
    viaInvestorId: v.optional(v.id('investors')),
    steps: vSteps,
    nudgedAt: v.optional(v.string()),
    /** The free-text warm path (pathKey) the migration linked; the text itself stays on the investor. */
    fromPath: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_investor', ['investorId'])
    .index('by_introducer', ['introducerId'])
    .index('by_via', ['viaInvestorId']),
}
