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

/** The pipeline stage after this one; null at Money in and for Passed or Parked. */
export function nextStage(s: Stage): PipelineStage | null {
  const ix = IDX[s]
  return ix === undefined || ix >= STAGES.length - 1 ? null : STAGES[ix + 1].k
}

export const isStage = (s: unknown): s is Stage => typeof s === 'string' && (STAGE_KEYS as string[]).includes(s)

/** Short labels for the drawer's stage progress bar (every pipeline stage after "Not contacted"). */
export const STAGE_SHORT: Partial<Record<PipelineStage, string>> = {
  ask: 'Asked', intro: 'Intro', booked: 'Booked', m1: '1st', m2: '2nd', dd: 'DD', verbal: 'Verbal', signed: 'Signed', wired: 'Money',
}
/** Tile labels for "How a conversation moves" and the stage chips. */
export const STAGE_TILE: Record<Stage, string> = {
  todo: 'Not contacted', ask: 'Asked', intro: 'Intro', booked: 'Booked', m1: '1st meeting', m2: '2nd meeting', dd: 'Diligence',
  verbal: 'Verbal', signed: 'Signed', wired: 'Money in', passed: 'Passed', parked: 'Parked',
}
/** The rule for moving a card into each stage ("Move a card only when the rule is true"). */
export const STAGE_RULE: Partial<Record<PipelineStage, string>> = {
  ask: 'You asked someone for an intro, or applied.',
  intro: 'The intro email went out.',
  booked: 'A meeting is on the calendar.',
  m1: 'First call done. Set the next step.',
  m2: 'Partner call or a deeper follow-up.',
  dd: 'They opened the data room.',
  verbal: 'They said a number. Confirm it in writing.',
  signed: 'The SAFE is signed.',
  wired: 'The wire landed. Celebrate.',
}
/** The tick-box line when advancing into `stage` (drawer): what has to be true. */
export function advanceConfirm(stage: PipelineStage, name: string): string {
  const who = name.trim().split(/\s+/)[0] || 'them'
  switch (stage) {
    case 'ask': return `You asked for an intro to ${who}, or applied`
    case 'intro': return `The intro to ${who} went out`
    case 'booked': return `A meeting with ${who} is on the calendar`
    case 'm1': return `The first call with ${who} happened`
    case 'm2': return `The follow-up with ${who} happened`
    case 'dd': return `${who} opened the data room`
    case 'verbal': return `${who} said a number`
    case 'signed': return `${who} signed the SAFE`
    case 'wired': return `${who}’s money landed`
    default: return `${who} is ready for the next stage`
  }
}

/** Kinds of logged touch (activities.touch). `ask`, `nudge` and `done` come from Today's buttons. */
export const TOUCHES = ['call', 'email', 'meeting', 'note', 'ask', 'nudge', 'done'] as const
export type TouchKind = (typeof TOUCHES)[number]
/** The four a person picks from in "Log a touch". */
export const TOUCH_PICK = ['call', 'email', 'meeting', 'note'] as const satisfies readonly TouchKind[]
export const TOUCH_LABEL: Record<TouchKind, string> = {
  call: 'Call', email: 'Email', meeting: 'Meeting', note: 'Note', ask: 'Asked for a number', nudge: 'Nudged', done: 'Next step done',
}
