// PST-274: investor enrichment tables, spread into schema.ts in one block so other
// branches' schema changes rebase cleanly around it.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { RANKS } from '../src/lib/enrich'
import { runModelFields, vModel } from './validators'

const lit = <T extends string>(xs: readonly T[]) => v.union(...xs.map((x) => v.literal(x)))

export const vRank = lit(RANKS)
export const vFactGroup = v.union(v.literal('person'), v.literal('fund'))
export const vRunStatus = v.union(v.literal('queued'), v.literal('running'), v.literal('done'), v.literal('failed'), v.literal('stopped'))
export const vStep = v.object({ label: v.string(), state: v.union(v.literal('waiting'), v.literal('running'), v.literal('done')), source: v.optional(v.string()) })
export const vVerdict = v.union(v.literal('investor'), v.literal('not_investor'), v.literal('unknown'))
/** A partner Claude found at the fund (kept, they become a person). */
export const vFactPerson = v.object({
  name: v.string(),
  title: v.optional(v.string()),
  rank: v.optional(vRank),
  covers: v.optional(v.string()),
  location: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  x: v.optional(v.string()),
})
/** A fact as a run finds it, before it's stored for review. */
export const vNewFact = v.object({
  group: vFactGroup,
  field: v.string(),
  value: v.string(),
  source: v.string(),
  confidence: v.number(),
  amount: v.optional(v.number()),
  person: v.optional(vFactPerson),
})

/** The AI row in the settings table: the auto-run toggles. Left out = the default (see AI_DEFAULTS). */
export const aiSettingsFields = {
  key: v.literal('ai'),
  lookups: v.optional(v.boolean()),
  enrichNew: v.optional(v.boolean()),
  meetingNotes: v.optional(v.boolean()),
  /** PST-273: the default model (left out = AI_MODEL, Haiku), and the features that have their own. */
  model: v.optional(vModel),
  models: v.optional(v.object({ enrich: v.optional(vModel), notes: v.optional(vModel), drafts: v.optional(vModel), ask: v.optional(vModel), brief: v.optional(vModel) })),
  /** PST-292: Jev on or off (left out = on), and its monthly cap in dollars (left out = JEV_DEFAULT_CAP, $0.50). */
  jev: v.optional(v.boolean()),
  jevCapUsd: v.optional(v.number()),
}

export const enrichTables = {
  // The people at an investor (a firm can have several); \`primary\` is the contact Dev deals with.
  people: defineTable({
    investorId: v.id('investors'),
    name: v.string(),
    title: v.optional(v.string()),
    rank: v.optional(vRank),
    covers: v.optional(v.string()),
    location: v.optional(v.string()),
    email: v.optional(v.string()),
    linkedin: v.optional(v.string()),
    x: v.optional(v.string()),
    primary: v.boolean(),
  }).index('by_investor', ['investorId']),

  // One lookup: an investor (Enrich) or a sender (Who's this?). Steps update live while it runs.
  enrichRuns: defineTable({
    investorId: v.optional(v.id('investors')),
    email: v.optional(v.string()),
    /** The firm domain it was looked up by (the 30-day cache). */
    domain: v.optional(v.string()),
    status: vRunStatus,
    steps: v.array(vStep),
    costUsd: v.number(),
    /** Queued at, then started at once it runs. */
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    /** Started by Nest (a new sender or a new investor), not by a click; counts toward the daily cap. */
    auto: v.boolean(),
    /** Copied from a recent lookup of the same email or domain instead of asking Claude again. */
    cached: v.optional(v.boolean()),
    factCount: v.optional(v.number()),
    verdict: v.optional(vVerdict),
    summary: v.optional(v.string()),
    /** PST-273: set when the run was a one-off on another model (Redo with Sonnet), else when it ran. */
    ...runModelFields,
  })
    .index('by_investor', ['investorId', 'startedAt'])
    .index('by_email', ['email', 'startedAt'])
    .index('by_domain', ['domain', 'startedAt'])
    .index('by_status', ['status', 'startedAt'])
    .index('by_started', ['startedAt']),

  // What a run found, one row per field, each with its source. Nothing reaches the investor until it's kept.
  facts: defineTable({
    runId: v.id('enrichRuns'),
    investorId: v.optional(v.id('investors')),
    email: v.optional(v.string()),
    group: vFactGroup,
    field: v.string(),
    value: v.string(),
    source: v.string(),
    confidence: v.number(),
    status: v.union(v.literal('pending'), v.literal('kept'), v.literal('dismissed')),
    clash: v.optional(v.string()),
    amount: v.optional(v.number()),
    person: v.optional(vFactPerson),
    keptAt: v.optional(v.number()),
  })
    .index('by_run', ['runId'])
    .index('by_investor', ['investorId'])
    .index('by_email', ['email'])
    .index('by_status', ['status']),
}
