import { v } from 'convex/values'
import { ALL, GEOS, METRICS_LIST, PIPELINE_LIST, SUGGESTION_KINDS, SUGGESTION_SOURCES, SUGGESTION_STATUSES, TIERS, TOUCHES, TYPES, WARMTHS } from './lib/enums'

// v.union over a list of literals, typed as the union of its members.
const lit = <T extends string>(xs: readonly T[]) => v.union(...xs.map((x) => v.literal(x)))

export const vStage = lit(ALL)
export const vPipelineStage = lit(PIPELINE_LIST)
export const vType = lit(TYPES)
export const vGeo = lit(GEOS)
export const vWarmth = lit(WARMTHS)
export const vTier = lit(TIERS)
export const vWave = v.union(v.literal(1), v.literal(2), v.literal(3))
export const vMetric = lit(METRICS_LIST)
export const vTouch = lit(TOUCHES)
export const vSyncSource = v.union(v.literal('calendar'), v.literal('gmail'))
export const vMeetingAnswer = v.union(v.literal('m1'), v.literal('m2'), v.literal('passed'))

/** Editable investor fields. Optional numbers/dates accept null (= clear). */
export const investorFields = {
  name: v.string(),
  firm: v.string(),
  type: vType,
  geo: vGeo,
  warmth: vWarmth,
  path: v.string(),
  tier: vTier,
  wave: vWave,
  stage: vStage,
  lead: v.boolean(),
  expected: v.optional(v.union(v.number(), v.null())),
  committed: v.optional(v.union(v.number(), v.null())),
  nextStep: v.string(),
  nextDate: v.optional(v.union(v.string(), v.null())),
  lastTouch: v.optional(v.union(v.string(), v.null())),
  notes: v.string(),
  source: v.string(),
  // Added in PST-266. Optional, so older clients and rows keep working.
  email: v.optional(v.union(v.string(), v.null())),
  /** Only kept while the stage is "parked": the day it comes back to Due today. */
  parkedUntil: v.optional(v.union(v.string(), v.null())),
  // Added in PST-263. Left out = keep what's stored; null or [] = clear.
  emails: v.optional(v.union(v.array(v.string()), v.null())),
  domains: v.optional(v.union(v.array(v.string()), v.null())),
}

export const vPhase = v.object({
  k: v.string(),
  name: v.string(),
  from: v.string(),
  to: v.string(),
  targets: v.array(v.object({ l: v.string(), m: vMetric, t: v.number() })),
  todo: v.array(v.string()),
  goal: v.optional(v.string()),
})

export const vOdds = v.object({
  todo: v.number(), ask: v.number(), intro: v.number(), booked: v.number(), m1: v.number(),
  m2: v.number(), dd: v.number(), verbal: v.number(), signed: v.number(), wired: v.number(),
})

/** Every round parameter (see src/lib/round.ts). */
export const roundFields = {
  target: v.number(),
  stretch: v.number(),
  deadline: v.string(),
  kickoff: v.string(),
  instrument: v.string(),
  cap: v.optional(v.number()),
  minCheck: v.optional(v.number()),
  phases: v.array(vPhase),
  odds: vOdds,
  quietDays: v.number(),
  waves: v.array(v.string()),
}
export const vRound = v.object(roundFields)

/* ---------- PST-275: Suggested fixes ---------- */

export const vSuggestionKind = lit(SUGGESTION_KINDS)
export const vSuggestionSource = lit(SUGGESTION_SOURCES)
export const vSuggestionStatus = lit(SUGGESTION_STATUSES)
/** The change a suggestion makes when accepted (src/lib/suggestions.ts SuggestionPatch). */
export const vSuggestionPatch = v.union(
  v.object({ op: v.literal('stage'), from: vStage, to: vStage }),
  v.object({ op: v.literal('next_step'), step: v.string(), date: v.optional(v.string()) }),
  v.object({ op: v.literal('expected'), amount: v.number() }),
  v.object({ op: v.literal('domain'), domain: v.string() }),
  v.object({ op: v.literal('touch'), touch: vTouch, note: v.string(), date: v.optional(v.string()) }),
  // PST-276: an agent's add_investor.
  v.object({ op: v.literal('new_investor'), name: v.string(), firm: v.string(), email: v.optional(v.string()), note: v.optional(v.string()) }),
  v.object({ op: v.literal('merge') }),
  v.object({ op: v.literal('review') }),
)
const vIdsBefore = <T extends 'meetings' | 'emailTouches'>(table: T) => v.array(v.object({ id: v.id(table), investorIds: v.array(v.id('investors')) }))
/** What Undo needs after an accept: the values it replaced, the activity it wrote, or the card a merge deleted. */
export const vSuggestionUndo = v.union(
  v.object({ op: v.literal('stage'), to: vStage, from: v.object({ stage: vStage, lastTouch: v.optional(v.string()), maxStage: vPipelineStage }), activityId: v.optional(v.id('activities')) }),
  // `before` holds the old value of each key in `keys`; a key missing from it was empty.
  v.object({ op: v.literal('fields'), keys: v.array(v.string()), before: v.any() }),
  v.object({ op: v.literal('touch'), activityId: v.id('activities'), lastTouch: v.optional(v.string()) }),
  // PST-276: the investor an accepted new_investor created (Undo deletes it).
  v.object({ op: v.literal('new_investor'), investorId: v.id('investors') }),
  v.object({
    op: v.literal('merge'),
    dropId: v.id('investors'),
    /** The deleted card's fields, to put it back. */
    dropped: v.any(),
    activityIds: v.array(v.id('activities')),
    meetings: vIdsBefore('meetings'),
    threads: vIdsBefore('emailTouches'),
    keepKeys: v.array(v.string()),
    keepBefore: v.any(),
  }),
)

/* ---------- PST-281: Q&A bank ---------- */

export const vAskSource = v.union(v.literal('notes'), v.literal('manual'), v.literal('meeting'))
export const vAnswerVersion = v.object({ text: v.string(), at: v.number(), by: v.optional(v.id('users')) })
/** On a merged-away question: the asks it handed over, and the kept question's fields before the merge. */
export const vQuestionMerge = v.object({
  askIds: v.array(v.id('questionAsks')),
  keepBefore: v.object({ bestAnswer: v.string(), answerVersions: v.array(vAnswerVersion), slideRef: v.optional(v.string()), onDeck: v.boolean() }),
})
