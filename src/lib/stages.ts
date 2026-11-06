// Stage keys, labels and order are fixed (copied from the prototype). Odds are
// round data: see `round.ts`.
export const STAGES = [
  { k: 'todo', l: 'Not contacted' },
  { k: 'ask', l: 'Intro asked' },
  { k: 'intro', l: 'Intro made' },
  { k: 'booked', l: 'Call booked' },
  { k: 'm1', l: '1st meeting' },
  { k: 'm2', l: '2nd meeting' },
  { k: 'dd', l: 'Diligence' },
  { k: 'verbal', l: 'Verbal yes' },
  { k: 'signed', l: 'SAFE signed' },
  { k: 'wired', l: 'Money in' },
] as const
export const CLOSED = [
  { k: 'passed', l: 'Passed' },
  { k: 'parked', l: 'Parked' },
] as const
export const ALL = [...STAGES, ...CLOSED] as const

export type PipelineStage = (typeof STAGES)[number]['k']
export type ClosedStage = (typeof CLOSED)[number]['k']
export type Stage = PipelineStage | ClosedStage

export const PIPELINE_KEYS = STAGES.map((s) => s.k) as PipelineStage[]
export const STAGE_KEYS = ALL.map((s) => s.k) as Stage[]

export const IDX: Partial<Record<Stage, number>> = Object.fromEntries(STAGES.map((s, i) => [s.k, i]))
export const LABEL = Object.fromEntries(ALL.map((s) => [s.k, s.l])) as Record<Stage, string>

export const COMMIT = new Set<Stage>(['verbal', 'signed', 'wired'])
export const ACTIVE = new Set<Stage>(['ask', 'intro', 'booked', 'm1', 'm2', 'dd', 'verbal', 'signed'])
/** Stages that no longer need a next step (excluded from "due" and "late"). */
export const DONE = new Set<Stage>(['passed', 'parked', 'wired'])

export const TYPES = ['Angel', 'Large angel', 'Micro-VC', 'Pre-seed fund', 'Seed fund', 'Multi-stage VC', 'Accelerator'] as const
export type InvestorType = (typeof TYPES)[number]
export const GEOS = ['India', 'US', 'MENA', 'Global'] as const
export type Geo = (typeof GEOS)[number]
export const WARM = { existing: 'Existing investor', warm: 'Warm, direct', intro: 'Needs intro', cold: 'Cold' } as const
export type Warmth = keyof typeof WARM
export const WARMTHS = Object.keys(WARM) as Warmth[]
export const TIERS = ['A', 'B', 'C'] as const
export type Tier = (typeof TIERS)[number]
export const WAVES = [1, 2, 3] as const
export type Wave = (typeof WAVES)[number]

export const isStage = (s: unknown): s is Stage => typeof s === 'string' && (STAGE_KEYS as string[]).includes(s)
