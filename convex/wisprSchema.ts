// PST-285: Wispr Flow notes after investor meetings. One block of tables, spread
// into schema.ts, so other branches' schema changes rebase cleanly around it.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const vWisprAuthMethod = v.union(v.literal('none'), v.literal('client_secret_post'), v.literal('client_secret_basic'))
export const vWisprFetchStatus = v.union(v.literal('waiting'), v.literal('saved'), v.literal('unmatched'), v.literal('duplicate'), v.literal('gaveup'))

export const wisprTables = {
  // One Wispr Flow connection per teammate: what discovery found, the client Nest
  // registered (RFC 7591), and the tokens. The client secret, the PKCE verifier and
  // both tokens are AES-GCM encrypted with GOOGLE_TOKEN_KEY; no query returns them.
  wisprConnections: defineTable({
    userId: v.id('users'),
    serverUrl: v.string(),
    /** pending: signing in for the first time (the card still shows Connect). */
    status: v.union(v.literal('pending'), v.literal('connected'), v.literal('reconnect')),
    resource: v.string(),
    issuer: v.string(),
    authorizationEndpoint: v.string(),
    tokenEndpoint: v.string(),
    scope: v.optional(v.string()),
    redirectUri: v.string(),
    clientId: v.string(),
    clientSecret: v.optional(v.string()),
    authMethod: vWisprAuthMethod,
    /** The PKCE verifier while a sign-in is open (sealed); cleared once it's used. */
    verifier: v.optional(v.string()),
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    connectedAt: v.optional(v.number()),
    /** The last run that brought notes in, and how many. */
    lastFetch: v.optional(v.object({ at: v.number(), count: v.number() })),
    lastCheckAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    /** A run holds this until it finishes (or the time passes), so runs never overlap. */
    lockUntil: v.optional(v.number()),
    /** "Fetch past 30 days" was asked for (or last moved on) at; cleared when it finishes. */
    backfill: v.optional(v.number()),
  }).index('by_user', ['userId']),

  // One row per calendar meeting Nest has looked for a Wispr note for: the attempts,
  // and the Wispr meeting id once found (the dedupe key, so a note never comes in twice).
  wisprFetches: defineTable({
    meetingId: v.id('meetings'),
    userId: v.id('users'),
    status: vWisprFetchStatus,
    attempts: v.number(),
    firstTriedAt: v.number(),
    lastTriedAt: v.number(),
    wisprId: v.optional(v.string()),
    via: v.optional(v.union(v.literal('calendar'), v.literal('search'))),
    noteId: v.optional(v.id('notes')),
    unmatchedId: v.optional(v.id('unmatchedNotes')),
  })
    .index('by_meeting', ['meetingId'])
    .index('by_wispr', ['wisprId'])
    .index('by_user', ['userId', 'lastTriedAt']),
}
