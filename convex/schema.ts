import { defineSchema, defineTable } from 'convex/server'
import { authTables } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { aiSettingsFields, enrichTables } from './enrichSchema'
import { materialsTables } from './materialsSchema'
import { closeTables, roundCapTableField } from './closeSchema'
import { closeKitTables } from './closeSchema'
import { agentTables } from './agentsSchema'
import { notesReadTables, vNoteSource } from './notesSchema'
import { draftTables } from './draftsSchema'
import { askSettingsFields, askTables } from './askSchema'
import { wisprTables } from './wisprSchema'
import { feedbackTables } from './feedbackSchema' // PST-289
// PST-292: Jev (jevRuns, jevCache, jevMarks; see jevSchema.ts).
import { jevTables } from './jevSchema'
// PST-293: decisions and signals (decisions, decisionLog, signals; see decisionsSchema.ts).
import { decisionTables } from './decisionsSchema'
import { introducerTables } from './introducersSchema' // PST-294
import { investorLeadFields, raceTables, roundLeadField } from './raceSchema' // PST-295
// PST-296: Find more and Jev fit scores (findSettings, findRuns, findCandidates, jevScores; see findMoreSchema.ts).
import { findMoreTables } from './findMoreSchema'
import { inboxTables } from './inboxSchema' // PST-297
import { networkTables } from './networkSchema' // PST-305
// PST-302: applications on investors, and from/by/correction on stage activities (see applicationsSchema.ts).
import { investorApplicationField, stageActivityFields } from './applicationsSchema'
// PST-307: the Advisor (advisorChats, advisorMessages, advisorMemory; its settings on the AI row; see advisorSchema.ts).
import { advisorSettingsFields, advisorTables } from './advisorSchema'
import { roundFields, vGeo, vMeetingAnswer, vPipelineStage, vStage, vSyncSource, vTier, vTouch, vType, vWarmth, vWave } from './validators'
import { vSuggestionKind, vSuggestionPatch, vSuggestionSource, vSuggestionStatus, vSuggestionUndo } from './validators'
import { vAnswerVersion, vAskSource, vQuestionMerge } from './validators'

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
    // PST-295 (optional, additive): can they lead (enrichment, and Dev's override), and when Dev asked them to.
    ...investorLeadFields,
    // PST-302 (optional, additive): an application's status, programme and dates; absent means not applied.
    ...investorApplicationField,
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
    // PST-302 (optional, additive): a stage move's from stage, who made it, and a correction mark.
    ...stageActivityFields,
  })
    .index('by_investor', ['investorId'])
    .index('by_date', ['date']),

  // The round row (key "round"), and PST-274's AI toggles (key "ai"; PST-279 adds morningBrief, see askSchema.ts).
  // PST-283: the round row also holds the cap table inputs (`capTable`, optional; see closeSchema.ts).
  // PST-295: and the investor leading the round (`leadId`, optional; see raceSchema.ts).
  settings: defineTable(v.union(v.object({ key: v.literal('round'), ...roundFields, ...roundCapTableField, ...roundLeadField }), v.object({ ...aiSettingsFields, ...askSettingsFields, /* PST-307 */ ...advisorSettingsFields }))).index('by_key', ['key']),

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
    sounds: v.optional(v.boolean()),
    // PST-290: list density (⇧D). Unset is comfortable.
    density: v.optional(v.union(v.literal('compact'), v.literal('comfortable'))),
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
    /** A full read of the last 30 days of Gmail, newest first, in chunks. `skipped`: threads Google refused (403/404) and the read went past. */
    scan: v.optional(
      v.object({ pageToken: v.optional(v.string()), done: v.number(), oldest: v.optional(v.number()), skipped: v.optional(v.number()), startedAt: v.number(), historyId: v.string() }),
    ),
    /** An investor's emails or domains changed: read the last 30 days again on the next run. */
    rescan: v.optional(v.boolean()),
    // PST-293 (optional, additive): the grant has gmail.readonly, so the sync can read email text for Jev. False: metadata only, reconnect.
    gmailBodies: v.optional(v.boolean()),
    // PST-306 (optional, additive): the version of thread reading the stored threads come from; an older one reads the last 30 days again.
    gmailThreads: v.optional(v.number()),
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
    // PST-306 (optional, additive): the investor message Dev owes a reply to (calendar and automated mail skipped); null when none, absent on rows synced before.
    owed: v.optional(v.union(v.object({ at: v.number(), messageId: v.string() }), v.null())),
  })
    .index('by_user_thread', ['userId', 'threadId'])
    .index('by_user', ['userId'])
    .index('by_last', ['lastAt']),

  /* ---------- PST-275: Suggested fixes ---------- */

  // A review queue of fixes to the investor list (convex/suggestions.ts). Nothing changes until someone accepts.
  // Unique by `key` (enforced in code), so a dismissed suggestion never comes back.
  suggestions: defineTable({
    kind: vSuggestionKind,
    investorId: v.optional(v.id('investors')),
    otherInvestorId: v.optional(v.id('investors')),
    /** The "why" line. */
    title: v.string(),
    /** The "→ change" line. */
    fix: v.string(),
    patch: vSuggestionPatch,
    source: vSuggestionSource,
    agentName: v.optional(v.string()),
    safe: v.boolean(),
    status: vSuggestionStatus,
    key: v.string(),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.id('users')),
    /** Set by an accept, cleared by its Undo. */
    undo: v.optional(vSuggestionUndo),
  })
    .index('by_key', ['key'])
    .index('by_status', ['status']),

  /* ---------- end PST-275 ---------- */

  // ---------- PST-274: investor enrichment (people, enrichRuns, facts) ----------
  ...enrichTables,

  /* ---------- PST-281: Q&A bank, meeting notes and prep brief ---------- */

  // The questions investors ask and the best answer to each (convex/qanda.ts).
  // Removed and merged-away rows stay (removedAt, mergedInto) so Undo can put them back; lists leave them out.
  questions: defineTable({
    text: v.string(),
    /** One of THEMES in src/lib/qanda.ts, or a custom one. */
    theme: v.string(),
    /** Empty until answered ("Need an answer"). */
    bestAnswer: v.string(),
    /** Every answer saved, oldest first, the current one included. */
    answerVersions: v.array(vAnswerVersion),
    /** e.g. "p8 · Pricing". */
    slideRef: v.optional(v.string()),
    onDeck: v.boolean(),
    /** How many asks (questionAsks rows) it has. */
    askedCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    /** On the deck-gaps list ("Add to deck vN"). */
    deckGap: v.optional(v.object({ deck: v.number(), at: v.number() })),
    removedAt: v.optional(v.number()),
    /** Merged into another question ("same question"); `merge` holds what Undo needs. */
    mergedInto: v.optional(v.id('questions')),
    merge: v.optional(vQuestionMerge),
  }),

  // Each time an investor asked a question: from meeting notes, by hand, or a meeting.
  questionAsks: defineTable({
    questionId: v.id('questions'),
    investorId: v.id('investors'),
    date: v.string(),
    source: vAskSource,
    noteId: v.optional(v.id('notes')),
    /** The line of the note it was picked from. */
    noteLine: v.optional(v.number()),
  })
    .index('by_question', ['questionId'])
    .index('by_investor', ['investorId'])
    .index('by_note', ['noteId']),

  // Meeting notes per investor: pasted, or in through MCP (Wispr Flow, an agent; PST-277).
  notes: defineTable({
    investorId: v.id('investors'),
    meetingId: v.optional(v.id('meetings')),
    date: v.string(),
    text: v.string(),
    /** Which meeting, e.g. "1st meeting". */
    title: v.optional(v.string()),
    // PST-277 (optional, additive): absent on notes that came in through MCP, where nobody pasted them.
    createdBy: v.optional(v.id('users')),
    removedAt: v.optional(v.number()),
    // PST-277 (optional, additive): where the notes came from; absent means pasted.
    source: v.optional(vNoteSource),
  }).index('by_investor', ['investorId']),

  /* ---------- end PST-281 ---------- */

  // ---------- PST-282: Materials (materials, materialVersions, shareLinks, views, viewerHits) ----------
  ...materialsTables,

  /* ---------- PST-283: Close (closings) ---------- */
  ...closeTables,
  /* ---------- end PST-283 ---------- */
  /* ---------- PST-276: Nest MCP server (agentKeys, agentCalls; convex/agentsSchema.ts) ---------- */
  ...agentTables,
  /* ---------- end PST-276 ---------- */

  /* ---------- PST-277: meeting notes become updates (noteReads, unmatchedNotes; see notesSchema.ts) ---------- */
  ...notesReadTables,
  /* ---------- end PST-277 ---------- */

  /* ---------- PST-278: Drafts (drafts; convex/draftsSchema.ts) ---------- */
  ...draftTables,
  /* ---------- end PST-278 ---------- */

  /* ---------- PST-279: Ask Nest and the morning brief (askRuns, briefs; see askSchema.ts) ---------- */
  ...askTables,
  /* ---------- end PST-279 ---------- */

  /* ---------- PST-285: Wispr Flow notes (wisprConnections, wisprFetches; see wisprSchema.ts) ---------- */
  ...wisprTables,
  /* ---------- end PST-285 ---------- */

  /* ---------- PST-289: Send feedback (feedback; see feedbackSchema.ts) ---------- */
  ...feedbackTables,
  /* ---------- end PST-289 ---------- */
  /* ---------- PST-292: Jev (jevRuns, jevCache, jevMarks; see jevSchema.ts) ---------- */
  ...jevTables,
  /* ---------- end PST-292 ---------- */

  /* ---------- PST-291: close kit and allocation (allocations; closings and the round row gain optional fields; see closeSchema.ts) ---------- */
  ...closeKitTables,
  /* ---------- end PST-291 ---------- */

  /* ---------- PST-293: decisions and signals (decisions, decisionLog, signals; see decisionsSchema.ts) ---------- */
  ...decisionTables,
  /* ---------- end PST-293 ---------- */
  /* ---------- PST-294: Introducers and intro steps (introducers, intros; see introducersSchema.ts) ---------- */
  ...introducerTables,
  /* ---------- end PST-294 ---------- */
  /* ---------- PST-295: Race and the lead (investorUpdates; see raceSchema.ts) ---------- */
  ...raceTables,
  /* ---------- end PST-295 ---------- */
  /* ---------- PST-296: Find more and Jev fit scores (see findMoreSchema.ts) ---------- */
  ...findMoreTables,
  /* ---------- end PST-296 ---------- */
  /* ---------- PST-297: the Today Inbox (inboxMarks, inboxCleared; see inboxSchema.ts) ---------- */
  ...inboxTables,
  /* ---------- end PST-297 ---------- */
  /* ---------- PST-305: Network (founderLookups; introducers and drafts gain optional fields; see networkSchema.ts) ---------- */
  ...networkTables,
  /* ---------- end PST-305 ---------- */
  /* ---------- PST-307: the Advisor (advisorChats, advisorMessages, advisorMemory; see advisorSchema.ts) ---------- */
  ...advisorTables,
  /* ---------- end PST-307 ---------- */
})
