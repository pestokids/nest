// Plan: where each phase stands against its goal (its first target), and which
// targets were just hit. Pure, shared by Plan, Settings and the tests.
import { dayDiff } from './dates'
import { money } from './money'
import { phaseActual, totals, type Activity, type Investor } from './pipeline'
import { isDollarMetric, targetValue, type Metric, type Phase, type PhaseTarget, type Round } from './round'

export type PhaseState = 'hit' | 'missed' | 'done' | 'now' | 'next' | 'later'

export type PhaseView = {
  phase: Phase
  state: PhaseState
  /** The phase's goal: its first target. */
  target?: PhaseTarget
  actual: number
  goal: number
  dollars: boolean
  /** Goal reached (any phase that has one). */
  hit: boolean
  /** Fill of the bar, 0–100. */
  pct: number
  /** Days left in the phase (current phase only). */
  daysLeft: number
}

/** Unit after a count goal: "150 NAMES", "80 ASKS". */
const UNIT: Partial<Record<Metric, [string, string]>> = {
  count: ['name', 'names'],
  pathed: ['warm path', 'warm paths'],
  'stage:todo': ['name', 'names'],
  'stage:ask': ['ask', 'asks'],
  'stage:intro': ['intro', 'intros'],
  'stage:booked': ['call booked', 'calls booked'],
  'stage:m1': ['1st meeting', '1st meetings'],
  'stage:m2': ['2nd meeting', '2nd meetings'],
  'stage:dd': ['in diligence', 'in diligence'],
  'stage:verbal': ['verbal yes', 'verbal yeses'],
  'stage:signed': ['SAFE signed', 'SAFEs signed'],
  'stage:wired': ['wire', 'wires'],
}

/** "150 names", "$300K", "80 asks". */
export function amountLabel(m: Metric, n: number): string {
  if (isDollarMetric(m)) return money(n)
  const u = UNIT[m]
  return u ? `${Math.round(n)} ${n === 1 ? u[0] : u[1]}` : String(Math.round(n))
}

/** "Goal: 150 names" for the Settings phase list. */
export function goalLabel(round: Pick<Round, 'target'>, p: Phase): string {
  const t = p.targets[0]
  return t ? `Goal: ${amountLabel(t.m, targetValue(round, t))}` : 'No goal set'
}

/** Where every phase stands today. */
export function phaseStatuses(round: Round, inv: Investor[], acts: Pick<Activity, 'kind' | 'stage' | 'date'>[], today: string): PhaseView[] {
  const { committed } = totals(inv, round, today)
  let sawFuture = false
  return round.phases.map((phase) => {
    const target = phase.targets[0]
    const actual = target ? phaseActual(phase, target.m, inv, acts, committed) : 0
    const goal = target ? targetValue(round, target) : 0
    const hit = !!target && goal > 0 && actual >= goal
    let state: PhaseState
    if (today > phase.to) state = !target ? 'done' : hit ? 'hit' : 'missed'
    else if (today >= phase.from) state = 'now'
    else {
      state = sawFuture ? 'later' : 'next'
      sawFuture = true
    }
    return {
      phase, state, target, actual, goal, hit,
      dollars: !!target && isDollarMetric(target.m),
      pct: goal > 0 ? Math.min(100, (actual / goal) * 100) : 0,
      daysLeft: state === 'now' ? Math.max(0, dayDiff(phase.to, today)) : 0,
    }
  })
}

/** "62 / 80 asks · short by 18", "$350K / $300K · +$50K", "$900K / $1.2M · 5 days left". */
export function progressLine(v: PhaseView): string {
  if (!v.target) return 'No goal set'
  const m = v.target.m
  const base = v.dollars ? `${money(v.actual)} / ${money(v.goal)}` : `${Math.round(v.actual)} / ${amountLabel(m, v.goal)}`
  const over = v.actual - v.goal
  if (v.state === 'hit' || (v.state === 'now' && v.hit)) return `${base} · ${over > 0 && v.dollars ? '+' + money(over) : 'hit'}`
  if (v.state === 'missed') return `${base} · short by ${v.dollars ? money(-over) : Math.round(-over)}`
  if (v.state === 'now') return `${base} · ${v.daysLeft === 0 ? 'last day' : v.daysLeft === 1 ? '1 day left' : `${v.daysLeft} days left`}`
  return base
}

/** Phases that have started and whose goal is reached. */
export const hitKeys = (views: PhaseView[]) => new Set(views.filter((v) => v.hit && v.state !== 'next' && v.state !== 'later').map((v) => v.phase.k))

/**
 * Phases to celebrate: hit now, not hit at the last look, never celebrated.
 * `before` is null on the first look (page load), which never celebrates.
 */
export function newlyHit(before: Set<string> | null, now: Set<string>, celebrated: Set<string>): string[] {
  if (!before) return []
  return [...now].filter((k) => !before.has(k) && !celebrated.has(k))
}
