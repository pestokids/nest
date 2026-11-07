// Round parameters are data. Everything about the raise (amounts, dates, phases,
// odds, the "gone quiet" rule) lives in the `round` settings row; DEFAULT_ROUND
// holds neutral placeholders and is used only until that row exists.
import { isISODate } from './dates'
import { LABEL, PIPELINE_KEYS, type PipelineStage } from './stages'

/** What a phase target measures (prototype keys). */
export const METRICS = ['count', 'pathed', 'committed', 'signed', ...PIPELINE_KEYS.map((k) => `stage:${k}` as const)] as const
export type Metric = (typeof METRICS)[number]
/** Dollar metrics store their target as a share of the raise target (0.15 = 15%). */
export const DOLLAR_METRICS = new Set<Metric>(['committed', 'signed'])
export const isDollarMetric = (m: Metric) => DOLLAR_METRICS.has(m)

export const METRIC_LABEL: Record<Metric, string> = Object.fromEntries(
  METRICS.map((m) => [
    m,
    m === 'count'
      ? 'Names on the list'
      : m === 'pathed'
        ? 'Names with a warm path'
        : m === 'committed'
          ? 'Committed $'
          : m === 'signed'
            ? 'Signed $ (SAFE signed + money in)'
            : `Moved to ${LABEL[m.slice(6) as PipelineStage]} in phase`,
  ]),
) as Record<Metric, string>

export type PhaseTarget = { l: string; m: Metric; t: number }
export type Phase = {
  k: string
  name: string
  from: string
  to: string
  targets: PhaseTarget[]
  todo: string[]
  /** One line on the Plan card, e.g. "List of 150, warm paths for 100." Optional; older rows don't have it. */
  goal?: string
}

export type Round = {
  target: number
  stretch: number
  /** Close date. */
  deadline: string
  kickoff: string
  instrument: string
  cap?: number
  minCheck?: number
  phases: Phase[]
  odds: Record<PipelineStage, number>
  quietDays: number
  /** Labels for waves 1, 2, 3 in the drawer. */
  waves: string[]
}

export const DEFAULT_ODDS: Record<PipelineStage, number> = {
  todo: 0, ask: 0.03, intro: 0.08, booked: 0.12, m1: 0.2, m2: 0.35, dd: 0.55, verbal: 0.85, signed: 0.95, wired: 1,
}

export const DEFAULT_ROUND: Round = {
  target: 1000000,
  stretch: 1500000,
  deadline: '2030-02-01',
  kickoff: '2030-01-01',
  instrument: 'post-money SAFE',
  phases: [
    {
      k: 'p1', name: 'Phase 1', from: '2030-01-01', to: '2030-01-07',
      targets: [{ l: 'Names on the list', m: 'count', t: 100 }, { l: 'Names with a warm path', m: 'pathed', t: 50 }],
      todo: ['Prepare your materials', 'Build the investor list', 'Find a warm path to each name'],
    },
    {
      k: 'p2', name: 'Phase 2', from: '2030-01-08', to: '2030-01-14',
      targets: [{ l: 'Intro asks sent', m: 'stage:ask', t: 30 }, { l: '1st meetings', m: 'stage:m1', t: 10 }, { l: 'Committed', m: 'committed', t: 0.15 }],
      todo: ['Start with the warmest names', 'Ask each for an amount and intros'],
    },
    {
      k: 'p3', name: 'Phase 3', from: '2030-01-15', to: '2030-01-21',
      targets: [{ l: '1st meetings', m: 'stage:m1', t: 20 }, { l: '2nd meetings', m: 'stage:m2', t: 10 }, { l: 'Committed', m: 'committed', t: 0.6 }],
      todo: ['Follow up on every open conversation', 'Send an update to the whole pipeline'],
    },
    {
      k: 'p4', name: 'Phase 4', from: '2030-01-22', to: '2030-02-01',
      targets: [{ l: 'Committed', m: 'committed', t: 1 }, { l: 'SAFEs signed', m: 'signed', t: 1 }],
      todo: ['Push every maybe to an answer', 'Collect signatures', 'Thank everyone, passes included'],
    },
  ],
  odds: DEFAULT_ODDS,
  quietDays: 4,
  waves: ['Wave 1', 'Wave 2', 'Wave 3'],
}

/** Merge a partial row (e.g. the seed's `round`) over the defaults. */
export function mergeRound(partial: Partial<Round> | null | undefined): Round {
  const p = partial ?? {}
  return {
    ...DEFAULT_ROUND,
    ...stripUndefined(p),
    odds: { ...DEFAULT_ODDS, ...(p.odds ?? {}) },
    phases: p.phases ?? DEFAULT_ROUND.phases,
    waves: p.waves ?? DEFAULT_ROUND.waves,
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>
}

/** A phase target in display units: dollars for dollar metrics, counts otherwise. */
export const targetValue = (round: Pick<Round, 'target'>, x: PhaseTarget) => (isDollarMetric(x.m) ? x.t * round.target : x.t)

/** The phase that contains `today`, else the first (before) or last (after). */
export function currentPhase(round: Round, today: string): Phase | undefined {
  const ps = round.phases
  if (!ps.length) return undefined
  return ps.find((p) => today >= p.from && today <= p.to) ?? ps[today < ps[0].from ? 0 : ps.length - 1]
}

export type RoundErrors = Record<string, string>

/** Field-path keyed errors, e.g. `target`, `phases.2.to`, `odds.m1`. Empty when valid. */
export function validateRound(r: Round): RoundErrors {
  const e: RoundErrors = {}
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x)
  if (!num(r.target) || r.target <= 0) e.target = 'Must be more than $0.'
  if (!num(r.stretch) || r.stretch < r.target) e.stretch = 'Must be at least the raise target.'
  if (!isISODate(r.kickoff)) e.kickoff = 'Pick a date.'
  if (!isISODate(r.deadline)) e.deadline = 'Pick a date.'
  else if (isISODate(r.kickoff) && r.kickoff > r.deadline) e.kickoff = 'Must be on or before the close date.'
  if (!r.instrument.trim()) e.instrument = 'Required, e.g. post-money SAFE.'
  if (r.cap !== undefined && (!num(r.cap) || r.cap <= 0)) e.cap = 'Must be more than $0, or leave empty.'
  if (r.minCheck !== undefined && (!num(r.minCheck) || r.minCheck <= 0)) e.minCheck = 'Must be more than $0, or leave empty.'
  if (!Number.isInteger(r.quietDays) || r.quietDays < 1) e.quietDays = 'A whole number of days, 1 or more.'
  for (const k of PIPELINE_KEYS) {
    const p = r.odds[k]
    if (!num(p) || p < 0 || p > 1) e[`odds.${k}`] = 'Between 0 and 1.'
  }
  r.waves.forEach((w, i) => {
    if (!w.trim()) e[`waves.${i}`] = 'Required.'
  })
  if (!r.phases.length) e.phases = 'Add at least one phase.'
  r.phases.forEach((p, i) => {
    const at = `phases.${i}`
    if (!p.name.trim()) e[`${at}.name`] = 'Required.'
    if (!isISODate(p.from)) e[`${at}.from`] = 'Pick a date.'
    if (!isISODate(p.to)) e[`${at}.to`] = 'Pick a date.'
    else if (isISODate(p.from) && p.from > p.to) e[`${at}.to`] = 'Must be on or after the start.'
    const prev = r.phases[i - 1]
    if (prev && isISODate(prev.to) && isISODate(p.from) && p.from <= prev.to && !e[`${at}.from`])
      e[`${at}.from`] = `Must start after ${prev.name || 'the previous phase'} ends.`
    p.targets.forEach((x, j) => {
      if (!x.l.trim()) e[`${at}.targets.${j}.l`] = 'Required.'
      if (!num(x.t) || x.t <= 0) e[`${at}.targets.${j}.t`] = isDollarMetric(x.m) ? 'A share above 0, e.g. 0.15.' : 'More than 0.'
      else if (!isDollarMetric(x.m) && !Number.isInteger(x.t)) e[`${at}.targets.${j}.t`] = 'A whole number.'
    })
  })
  return e
}

/** Flatten a round into leaf paths for the change log. */
export function flattenRound(r: Round): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) {
      if (!v.length) out[path] = ''
      v.forEach((x, i) => walk(x, `${path}.${i}`))
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (k !== 'k') walk(x, path ? `${path}.${k}` : k)
    } else out[path] = v === undefined || v === null ? '' : String(v)
  }
  walk(r, '')
  return out
}

export type RoundChange = { field: string; from: string; to: string }

export function diffRound(before: Round, after: Round): RoundChange[] {
  const a = flattenRound(before)
  const b = flattenRound(after)
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
  return keys.filter((k) => (a[k] ?? '') !== (b[k] ?? '')).map((k) => ({ field: k, from: a[k] ?? '', to: b[k] ?? '' }))
}

const FIELD_LABEL: Record<string, string> = {
  target: 'Raise target', stretch: 'Stretch', deadline: 'Close date', kickoff: 'Kickoff date', instrument: 'Instrument',
  cap: 'Valuation cap', minCheck: 'Minimum check', quietDays: 'Gone quiet after (days)',
  // PST-283
  capTable: 'Cap table',
}
/** Human label for a change-log path, e.g. `phases.1.targets.2.t` → "Phase 2 · target 3". */
export function fieldLabel(path: string): string {
  if (FIELD_LABEL[path]) return FIELD_LABEL[path]
  const parts = path.split('.')
  if (parts[0] === 'odds') return `Odds · ${LABEL[parts[1] as PipelineStage] ?? parts[1]}`
  if (parts[0] === 'waves') return `Wave ${Number(parts[1]) + 1} label`
  if (parts[0] === 'phases') {
    const ph = `Phase ${Number(parts[1]) + 1}`
    const rest = parts.slice(2)
    if (!rest.length) return `${ph}`
    if (rest[0] === 'name') return `${ph} name`
    if (rest[0] === 'from') return `${ph} start`
    if (rest[0] === 'to') return `${ph} end`
    if (rest[0] === 'goal') return `${ph} goal`
    if (rest[0] === 'todo') return `${ph} · to-do ${Number(rest[1]) + 1}`
    if (rest[0] === 'targets') {
      const what = { l: 'label', m: 'measure', t: 'target' }[rest[2] ?? ''] ?? ''
      return `${ph} · target ${Number(rest[1]) + 1}${what ? ' ' + what : ''}`
    }
  }
  return path
}
