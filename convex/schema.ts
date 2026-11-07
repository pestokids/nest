import { defineSchema, defineTable } from 'convex/server'
import { authTables } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { roundFields, vGeo, vMeetingAnswer, vPipelineStage, vStage, vSyncSource, vTier, vTouch, vType, vWarmth, vWave } from './validators'

export default defineSchema({
  ...authTables,

  investors: defineTable({
    name: v.string(),
    firm: v.string(),
    type: vType,
    geo: vGeo,
    warmth: vWarmth,
    path: v.string(),
    tier: vTier,
    wave: vWave,
    stage: vStage,
    maxStage: vPipelineStage,
    lead: v.boolean(),
    expected: v.optional(v.number()),
    committed: v.optional(v.number()),
    nextStep: v.string(),
    nextDate: v.optional(v.string()),
    lastTouch: v.optional(v.string()),
    notes: v.string(),
    source: v.string(),
    slug: v.optional(v.string()),
    // PST-266 (optional, additive): contact email, and the date a parked investor comes back.
    email: v.optional(v.string()),
    parkedUntil: v.optional(v.string()),
    // PST-263 (optional, additive): more addresses and the firm's domains, for Calendar and Gmail matching.
    emails: v.optional(v.array(v.string())),
    domains: v.optional(v.array(v.string())),
    updatedAt: v.number(),
    // Absent on rows imported by the seed until someone edits them.
    updatedBy: v.optional(v.id('users')),
  })
    .index('by_stage', ['stage'])
    .index('by_slug', ['slug']),

  activities: defineTable({
    investorId: v.id('investors'),
    kind: v.union(v.literal('stage'), v.literal('note')),
    stage: v.optional(vStage),
    note: v.optional(v.string()),
    // PST-266 (optional, additive): what kind of touch a note was (call, email, meeting, ask…).
    touch: v.optional(vTouch),
    // PST-263 (optional, additive): written by Calendar or Gmail sync, not by hand.
    source: v.optional(vSyncSource),
    date: v.string(),
    userId: v.id('users'),
  })
    .index('by_investor', ['investorId'])
    .index('by_date', ['date']),

  settings: defineTable({ key: v.literal('round'), ...roundFields }).index('by_key', ['key']),

  settingsLog: defineTable({
    userId: v.id('users'),
    at: v.number(),
    field: v.string(),
    from: v.string(),
    to: v.string(),
  }).index('by_at', ['at']),

  // Home prep checklist: one row per ticked to-do of a phase (unticking deletes it).
  prepTicks: defineTable({
    phaseKey: v.string(),
    item: v.number(),
    doneBy: v.id('users'),
    doneAt: v.number(),
  }).index('by_phase_item', ['phaseKey', 'item']),

  // Per-user preferences that follow the user across devices.
  prefs: defineTable({
    userId: v.id('users'),
    sounds: v.boolean(),
  }).index('by_user', ['userId']),

  // PST-263: one Google connection per teammate (Calendar read-only, Gmail metadata).
  // The refresh token is AES-GCM encrypted with GOOGLE_TOKEN_KEY; no query ever returns it.
  googleConnections: defineTable({
    userId: v.id('users'),
    googleEmail: v.string(),
    refreshToken: v.string(),
    status: v.union(v.literal('syncing'), v.literal('connected'), v.literal('reconnect')),
    connectedAt: v.number(),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    /** A sync holds this until it finishes (or the time passes), so runs never overlap. */
    lockUntil: v.optional(v.number()),
    calendarSyncToken: v.optional(v.string()),
    gmailHistoryId: v.optional(v.string()),
    /** A full read of the last 30 days of Gmail, newest first, in chunks. */
    scan: v.optional(v.object({ pageToken: v.optional(v.string()), done: v.number(), oldest: v.optional(v.number()), startedAt: v.number(), historyId: v.string() })),
    /** An investor's emails or domains changed: read the last 30 days again on the next run. */
    rescan: v.optional(v.boolean()),
  }).index('by_user', ['userId']),

  // Calendar events with at least one outside attendee. Title, times, attendees' emails (and display names), the event link.
  meetings: defineTable({
    userId: v.id('users'),
    eventId: v.string(),
    title: v.string(),
    start: v.number(),
    end: v.number(),
    link: v.optional(v.string()),
    people: v.array(v.object({ email: v.string(), name: v.optional(v.string()) })),
    investorIds: v.array(v.id('investors')),
    /** Last touch has been set from this meeting (it has ended). */
    touched: v.optional(v.boolean()),
    /** "How did it go?" was answered on Today. */
    answer: v.optional(vMeetingAnswer),
    /** People marked "Not about the round" on Who's this?. */
    dismissed: v.optional(v.array(v.string())),
  })
    .index('by_user_event', ['userId', 'eventId'])
    .index('by_event', ['eventId'])
    .index('by_user', ['userId'])
    .index('by_start', ['start']),

  // Gmail threads with an investor. Subject, participants' emails, the last message's date and sender, the Gmail link. Never bodies or snippets.
  emailTouches: defineTable({
    userId: v.id('users'),
    threadId: v.string(),
    subject: v.string(),
    participants: v.array(v.string()),
    lastAt: v.number(),
    lastFrom: v.union(v.literal('us'), v.literal('them')),
    lastFromEmail: v.string(),
    count: v.number(),
    link: v.string(),
    investorIds: v.array(v.id('investors')),
  })
    .index('by_user_thread', ['userId', 'threadId'])
    .index('by_user', ['userId'])
    .index('by_last', ['lastAt']),
})
