import { defineSchema, defineTable } from 'convex/server'
import { authTables } from '@convex-dev/auth/server'
import { v } from 'convex/values'
import { roundFields, vGeo, vPipelineStage, vStage, vTier, vType, vWarmth, vWave } from './validators'

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
})
