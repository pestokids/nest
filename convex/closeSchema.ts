// PST-283: Close. Closing records (one per investor in Verbal or later) and
// the cap table inputs kept on the round settings row. See src/lib/close.ts.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { STEP_KEYS } from '../src/lib/close'

export const vStepKey = v.union(...STEP_KEYS.map((k) => v.literal(k)))

/** A closing record's terms, the signer and the links (src/lib/close.ts ClosingTerms). */
export const closingTermFields = {
  amount: v.number(),
  instrument: v.string(),
  cap: v.number(),
  discount: v.optional(v.number()),
  proRata: v.boolean(),
  mfn: v.boolean(),
  sideLetter: v.optional(v.string()),
  signedUrl: v.optional(v.string()),
  requestUrl: v.optional(v.string()),
  signerName: v.optional(v.string()),
  signerEmail: v.optional(v.string()),
}

/** Founders' shares, the option pool (shares) and earlier SAFEs, entered in Settings › Round. */
export const vCapTable = v.object({
  founders: v.array(v.object({ name: v.string(), shares: v.number() })),
  optionPool: v.number(),
  safes: v.optional(v.array(v.object({ name: v.string(), amount: v.number(), cap: v.number(), mfn: v.optional(v.boolean()) }))),
})

/** Added to the round settings row; empty until someone fills in the Cap table card. */
export const roundCapTableField = { capTable: v.optional(vCapTable) }

export const closeTables = {
  // One per investor (enforced in code). Steps are ticked by hand: signing happens outside Nest.
  closings: defineTable({
    investorId: v.id('investors'),
    ...closingTermFields,
    steps: v.array(v.object({ key: vStepKey, at: v.string() })),
    updatedAt: v.number(),
    updatedBy: v.id('users'),
  }).index('by_investor', ['investorId']),
}
