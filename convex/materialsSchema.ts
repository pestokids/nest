// PST-282: Materials. The library, per-investor share links and what the public
// viewer at /d/<token> records. Spread into schema.ts in its own block.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'
import { MATERIAL_KINDS } from '../src/lib/materials'

const lit = <T extends string>(xs: readonly T[]) => v.union(...xs.map((x) => v.literal(x)))
export const vMaterialKind = lit(MATERIAL_KINDS)
export const vLinkOptions = v.object({ askEmail: v.boolean(), allowDownload: v.boolean(), watermark: v.boolean(), notify: v.boolean(), reply: v.boolean() })
export const vDevice = v.union(v.literal('phone'), v.literal('tablet'), v.literal('desktop'))

export const materialsTables = {
  // A pitch deck, memo, one-pager, model or data room file. Absent `currentVersionId` only mid-create.
  materials: defineTable({
    kind: vMaterialKind,
    title: v.string(),
    currentVersionId: v.optional(v.id('materialVersions')),
    createdAt: v.number(),
    createdBy: v.id('users'),
  }),

  // Every version stays readable. A PDF in Convex file storage, or a link (Google Slides or Docs).
  materialVersions: defineTable({
    materialId: v.id('materials'),
    n: v.number(),
    fileId: v.optional(v.id('_storage')),
    url: v.optional(v.string()),
    pages: v.optional(v.number()),
    note: v.string(),
    createdAt: v.number(),
    createdBy: v.id('users'),
  }).index('by_material', ['materialId', 'n']),

  // One link per investor. `token`: 128 random bits, the only thing the public viewer is given.
  shareLinks: defineTable({
    token: v.string(),
    investorId: v.optional(v.id('investors')),
    materialId: v.id('materials'),
    versionId: v.union(v.id('materialVersions'), v.literal('current')),
    options: vLinkOptions,
    revokedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    createdBy: v.id('users'),
    createdAt: v.number(),
    /** The first open (the touch is logged then). */
    firstOpenedAt: v.optional(v.number()),
    /** The maker saw the first-open notice (Today row dismissed or opened). */
    seenAt: v.optional(v.number()),
  })
    .index('by_token', ['token'])
    .index('by_investor', ['investorId'])
    .index('by_material', ['materialId']),

  // One open of a link (a viewer session): when, roughly what device, the email if asked, time per page.
  views: defineTable({
    linkId: v.id('shareLinks'),
    sessionId: v.string(),
    versionId: v.id('materialVersions'),
    email: v.optional(v.string()),
    startedAt: v.number(),
    lastAt: v.number(),
    device: vDevice,
    pages: v.array(v.object({ page: v.number(), ms: v.number() })),
  })
    .index('by_link', ['linkId'])
    .index('by_session', ['sessionId']),

  // Fixed-window counters for the public viewer's lookups (per token, and one for unknown tokens).
  viewerHits: defineTable({ key: v.string(), windowStart: v.number(), count: v.number() }).index('by_key', ['key']),
}
