import { v } from 'convex/values'
import { ALL, GEOS, METRICS_LIST, PIPELINE_LIST, TIERS, TOUCHES, TYPES, WARMTHS } from './lib/enums'

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
