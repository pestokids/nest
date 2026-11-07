// Raise · Today: the next three moves, the KPI notes, the phase bar details and
// the advance-stage rule. Pure functions over plain data (unit-tested).
import { dayDiff } from './dates'
import { dayMonth, nextPhase, phaseOn } from './home'
import { money } from './money'
import { committedOf, dueList, lastContact, phaseActual, quietList, totals, type Activity, type Investor } from './pipeline'
import { isDollarMetric, targetValue, type Metric, type Phase, type Round } from './round'
import { ACTIVE, COMMIT, IDX, LABEL, STAGE_TILE, type PipelineStage, type Stage, type Wave } from './stages'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const utc = (iso: string) => new Date(iso + 'T00:00:00Z')
export const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)

/** "Tuesday" within the coming week, else "Tue 10 Nov". */
export function byWhen(iso: string, today: string): string {
  const n = dayDiff(iso, today)
  if (n === 0) return 'today'
  if (n === 1) return 'tomorrow'
  if (n > 1 && n < 7) return WEEKDAYS[utc(iso).getUTCDay()]
  return dayMonth(iso)
}

/* ---------- Next moves ---------- */

export type MoveAction =
  | { kind: 'import' }
  | { kind: 'investors'; wave?: Wave; stage?: Stage }
  | { kind: 'pipeline' }
  | { kind: 'ask'; investorId: string }
  | { kind: 'open'; investorId: string }
  | { kind: 'scroll'; to: 'due' | 'quiet' }

export type Move = {
  key: string
  /** `hot` is the peach card with the orange action (asking someone for a number). */
  tone: 'default' | 'hot'
  title: string
  why: string
  /** The phone card's shorter line. */
  short?: string
  /** 0–1. Absent when the move has no measure (then `meta` shows instead). */
  progress?: number
  /** Mono line under the why, e.g. "Expected $25K · 1st meeting done". */
  meta?: string
  label: string
  action: MoveAction
  /** Mono count in the footer, e.g. "40 / 150 names" or "Due Wed 11 Nov". */
  count: string
}

/** The phase "Your next 3 moves" works from: the one on today, else the next, else the last. */
export const movesPhase = (round: Round, today: string): Phase | undefined =>
  phaseOn(round, today) ?? nextPhase(round, today) ?? round.phases[round.phases.length - 1]

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0)
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

const STAGE_GOAL: Partial<Record<PipelineStage, [string, string]>> = {
  ask: ['intro asks', 'asks'],
  intro: ['intros', 'intros'],
  booked: ['calls booked', 'booked'],
  m1: ['first meetings', 'meetings'],
  m2: ['second meetings', 'meetings'],
  dd: ['in diligence', 'in DD'],
  verbal: ['verbal yeses', 'verbals'],
  signed: ['SAFEs signed', 'signed'],
  wired: ['wires in', 'wired'],
}

/** One move per unmet phase target, in the phase's order. */
export function targetMoves(round: Round, phase: Phase, inv: Investor[], acts: Pick<Activity, 'kind' | 'stage' | 'date'>[], today: string): Move[] {
  const committed = totals(inv, round, today).committed
  const when = byWhen(phase.to, today)
  const firstWave = round.waves[0]?.trim() || 'Wave 1'
  const out: Move[] = []
  phase.targets.forEach((x, ix) => {
    const goal = targetValue(round, x)
    const have = phaseActual(phase, x.m, inv, acts, committed)
    if (!(goal > 0) || have >= goal) return
    const progress = clamp01(have / goal)
    const key = `t:${phase.k}:${ix}`
    const m: Metric = x.m
    if (m === 'count')
      out.push({
        key, tone: 'default', progress,
        title: `Grow the list to ${goal}`,
        why: `You have ${have}. Add ${goal - have} more names before ${when}: angels, funds and operators who can intro.`,
        short: `You have ${have}. Add ${goal - have} more before ${when}.`,
        label: 'Import a CSV', action: { kind: 'import' }, count: `${have} / ${goal} names`,
      })
    else if (m === 'pathed')
      out.push({
        key, tone: 'default', progress,
        title: 'Find a warm path for each name',
        why: `${have} of ${goal} have one. For every ${firstWave} name, write down who can introduce you.`,
        short: `${have} of ${goal} have one. Write down who can introduce you.`,
        label: `Open ${firstWave} names`, action: { kind: 'investors', wave: 1 }, count: `${have} / ${goal} warm`,
      })
    else if (isDollarMetric(m))
      out.push({
        key, tone: 'default', progress,
        title: m === 'signed' ? `Get ${money(goal)} in signed SAFEs` : `Get to ${money(goal)} committed`,
        why:
          m === 'signed'
            ? `${money(have)} signed so far. Send the SAFE to every verbal yes before ${when}.`
            : `${money(have)} so far. Push every maybe to a number, confirmed in writing, before ${when}.`,
        short: `${money(have)} so far. ${money(goal - have)} to go before ${when}.`,
        label: 'Open the pipeline', action: { kind: 'pipeline' }, count: `${money(have)} / ${money(goal)}`,
      })
    else {
      const st = m.slice(6) as PipelineStage
      const [what, unit] = STAGE_GOAL[st] ?? [LABEL[st], '']
      out.push({
        key, tone: 'default', progress,
        title: st === 'ask' ? `Send ${goal} intro asks` : `Get to ${goal} ${what}`,
        why:
          st === 'ask'
            ? `${have} sent in ${phase.name}. Start with the warmest names and ask each for an amount and intros.`
            : `${have} so far in ${phase.name}. Follow up on every open conversation until it moves.`,
        short: `${have} of ${goal} so far, before ${when}.`,
        label: st === 'ask' ? 'Open the list' : 'Open the pipeline',
        action: st === 'ask' ? { kind: 'investors', stage: 'todo' } : { kind: 'pipeline' },
        count: `${have} / ${goal}${unit ? ' ' + unit : ''}`,
      })
    }
  })
  return out
}

/** Stages past a first meeting and short of a yes: time to ask for a number. */
const ASKABLE = new Set<Stage>(['m1', 'm2', 'dd'])
const DONE_LINE: Partial<Record<Stage, string>> = {
  m1: 'You’ve had the first meeting.',
  m2: 'You’ve had the follow-up.',
  dd: 'They’re in the data room.',
}

/** Investor ids with an ask already logged. */
/** What "Log the ask" writes (Today's ask move, and Ask Nest's button): the note, and a follow-up three days on. */
export const ASK_NOTE = 'Asked for a specific amount, confirmed in writing.'
export const askFollowUp = (today: string) => ({ step: 'Follow up on the ask', date: addDays(today, 3) })

export const askedIds = (acts: Pick<Activity, 'investorId' | 'touch'>[]) => new Set(acts.filter((a) => a.touch === 'ask').map((a) => a.investorId))

/**
 * The "ask for a number" move: the furthest-along conversation between a first
 * meeting and a yes that hasn't been asked yet (biggest expected check, then
 * the soonest next step). `keep` keeps a just-asked investor in place.
 */
export function askMove(inv: Investor[], acts: Pick<Activity, 'investorId' | 'touch'>[], phase: Phase | undefined, today: string, keep?: ReadonlySet<string>): Move | null {
  const asked = askedIds(acts)
  const pick = inv
    .filter((i) => ASKABLE.has(i.stage) && (!asked.has(i._id) || keep?.has(i._id)))
    .sort(
      (a, b) =>
        Number(!!keep?.has(b._id)) - Number(!!keep?.has(a._id)) ||
        (IDX[b.stage] ?? 0) - (IDX[a.stage] ?? 0) ||
        (b.expected ?? 0) - (a.expected ?? 0) ||
        (a.nextDate ?? '9999').localeCompare(b.nextDate ?? '9999') ||
        a.name.localeCompare(b.name),
    )[0]
  if (!pick) return null
  const due = pick.nextDate ?? (phase && phase.to >= today ? phase.to : addDays(today, 3))
  const meta = [pick.expected ? `Expected ${money(pick.expected)}` : '', `${STAGE_TILE[pick.stage]} done`].filter(Boolean).join(' · ')
  return {
    key: `ask:${pick._id}`,
    tone: 'hot',
    title: `Ask ${pick.name} for a number`,
    why: `${DONE_LINE[pick.stage] ?? ''} Ask for a specific amount and get it confirmed in writing by ${dayMonth(due)}.`.trim(),
    short: `${DONE_LINE[pick.stage] ?? ''} Ask for a specific amount, in writing.`.trim(),
    meta,
    label: 'Log the ask',
    action: { kind: 'ask', investorId: pick._id },
    count: `Due ${dayMonth(due)}`,
  }
}

/** Fill-ins when the phase targets are met: what's due, who's quiet, who's next on the list. */
function fillMoves(inv: Investor[], round: Round, today: string): Move[] {
  const out: Move[] = []
  const due = dueList(inv, today)
  if (due.length)
    out.push({
      key: 'due', tone: 'default',
      title: 'Clear what’s due today',
      why: `${plural(due.length, 'next step')} ${due.length === 1 ? 'is' : 'are'} due or late. Tick each one off when it’s done.`,
      label: 'See what’s due', action: { kind: 'scroll', to: 'due' }, count: `${due.length} due`,
    })
  const quiet = quietList(inv, today, round.quietDays)
  if (quiet.length)
    out.push({
      key: 'quiet', tone: 'default',
      title: `Nudge ${plural(quiet.length, 'quiet conversation')}`,
      why: `No touch in ${round.quietDays}+ days. A short update or a question keeps them warm.`,
      label: 'See who', action: { kind: 'scroll', to: 'quiet' }, count: `${quiet.length} quiet`,
    })
  const fresh = inv.filter((i) => i.stage === 'todo').sort((a, b) => (b.expected ?? 0) - (a.expected ?? 0) || a.wave - b.wave || a.name.localeCompare(b.name))[0]
  if (fresh)
    out.push({
      key: `reach:${fresh._id}`, tone: 'default',
      title: `Reach out to ${fresh.name}`,
      why: fresh.path && fresh.path.toLowerCase() !== 'cold' ? `Ask ${fresh.path} for the intro, with a line on why it’s a fit.` : 'Find someone who can introduce you first, then ask.',
      label: 'Open', action: { kind: 'open', investorId: fresh._id }, count: `Wave ${fresh.wave}`,
    })
  if (!inv.length) out.push({ key: 'start', tone: 'default', title: 'Add your first investors', why: 'Import a CSV of names, or add them one at a time.', label: 'Import a CSV', action: { kind: 'import' }, count: '0 names' })
  return out
}

/**
 * Your next 3 moves, in the order to do them: the current phase's unmet
 * targets (phase order), then the ask for a number in the last slot, then
 * fill-ins. Never more than three.
 */
export function nextMoves(
  { investors: inv, acts, round, today }: { investors: Investor[]; acts: Pick<Activity, 'investorId' | 'touch' | 'kind' | 'stage' | 'date'>[]; round: Round; today: string },
  keep?: ReadonlySet<string>,
): Move[] {
  const phase = movesPhase(round, today)
  const targets = phase ? targetMoves(round, phase, inv, acts, today) : []
  const ask = askMove(inv, acts, phase, today, keep)
  const moves = [...targets.slice(0, ask ? 2 : 3), ...(ask ? [ask] : [])]
  for (const f of fillMoves(inv, round, today)) {
    if (moves.length >= 3) break
    moves.splice(ask ? moves.length - 1 : moves.length, 0, f)
  }
  return moves.slice(0, 3)
}

/** "Prep ends Tue 10 Nov. Do these in order." */
export function movesNote(round: Round, today: string): string {
  const now = phaseOn(round, today)
  if (now) return `${now.name} ends ${dayMonth(now.to)}. Do these in order.`
  const next = nextPhase(round, today)
  if (next) return `${next.name} starts ${dayMonth(next.from)}. Do these in order.`
  return 'Do these in order.'
}

/* ---------- Summary card and phase bar ---------- */

/** "NOV 6–10", or "NOV 30–DEC 4" across months. */
export function dateRange(from: string, to: string): string {
  const a = utc(from)
  const b = utc(to)
  const ma = MONTHS[a.getUTCMonth()]
  const mb = MONTHS[b.getUTCMonth()]
  return ma === mb ? `${ma} ${a.getUTCDate()}–${b.getUTCDate()}` : `${ma} ${a.getUTCDate()}–${mb} ${b.getUTCDate()}`
}

const DETAIL_UNIT: Partial<Record<PipelineStage, string>> = {
  ask: 'asks', intro: 'intros', booked: 'booked', m1: 'meetings', m2: '2nd mtgs', dd: 'in DD', verbal: 'verbals', signed: 'signed', wired: 'wired',
}

/** The mono line under a phase: its dates and its headline target ("NOV 16–22 · 80 ASKS"). List-building targets stay off. */
export function phaseDetail(round: Round, p: Phase): string {
  const t = p.targets.find((x) => x.m !== 'count' && x.m !== 'pathed')
  if (!t) return dateRange(p.from, p.to)
  const v = targetValue(round, t)
  const what = isDollarMetric(t.m) ? money(v) : `${v} ${DETAIL_UNIT[t.m.slice(6) as PipelineStage] ?? ''}`.trim()
  return `${dateRange(p.from, p.to)} · ${what}`
}

/** Phone labels: "Wave 1" → "W1". */
export const shortPhaseName = (name: string) => name.replace(/^wave\s*(\d+)$/i, 'W$1')

/** "days to close on Fri 4 Dec. Wave 1 opens Wed 11 Nov." */
export function daysLine(round: Round, today: string): string {
  const left = dayDiff(round.deadline, today)
  if (left < 0) return `The round closed on ${dayMonth(round.deadline)}.`
  const next = nextPhase(round, today)
  const opens = next ? ` ${next.name} ${/^wave/i.test(next.name) ? 'opens' : 'starts'} ${dayMonth(next.from)}.` : ''
  return `${left === 1 ? 'day' : 'days'} to close on ${dayMonth(round.deadline)}.${opens}`
}

/* ---------- KPI notes ---------- */

const names = (xs: Pick<Investor, 'name'>[]) =>
  xs.length === 1 ? xs[0].name : xs.length === 2 ? `${xs[0].name} and ${xs[1].name}` : `${xs[0].name}, ${xs[1].name} and ${xs.length - 2} more`

export function kpis(inv: Investor[], round: Round, today: string) {
  const t = totals(inv, round, today)
  const committed = inv.filter((i) => COMMIT.has(i.stage) && committedOf(i) > 0)
  const asking = inv.filter((i) => i.stage === 'ask').length
  const passed = inv.filter((i) => i.stage === 'passed')
  const parked = inv.filter((i) => i.stage === 'parked').length
  return {
    committed: {
      value: money(t.committed),
      note: committed.length ? `${names(committed)}${committed.length === 1 ? `, ${STAGE_TILE[committed[0].stage].toLowerCase()}` : ''}.` : 'Counts only verbal or signed, confirmed in writing.',
    },
    still: {
      value: money(t.need),
      note: t.need <= 0 ? 'The target is covered. Anything more is stretch.' : t.daysLeft < 0 ? 'The close date has passed.' : `${money(t.perDay)} a day until ${dayMonthShort(round.deadline)}.`,
    },
    talking: {
      value: inv.filter((i) => ACTIVE.has(i.stage)).length,
      note: asking ? `${asking} ${asking === 1 ? 'is' : 'are'} waiting on an intro.` : 'Nobody waiting on an intro.',
    },
    passed: {
      value: passed.length,
      note: `${passed.length ? `${names(passed)}.` : 'Nobody has passed.'} ${parked ? `${parked} parked.` : 'Nobody parked.'}`,
    },
  }
}

/** "Dec 4" */
const dayMonthShort = (iso: string) => {
  const d = utc(iso)
  return `${MONTHS[d.getUTCMonth()][0]}${MONTHS[d.getUTCMonth()].slice(1).toLowerCase()} ${d.getUTCDate()}`
}

/* ---------- Gone quiet ---------- */

/** Whole days since the last contact (`lastContact`); null when never touched. */
export const quietDays = (i: Pick<Investor, 'lastTouch' | 'contact'>, today: string) => {
  const last = lastContact(i)
  return last ? dayDiff(today, last) : null
}

/* ---------- Advance stage ---------- */

export type StageChange = 'forward' | 'back' | 'closed' | 'reopened' | 'same'

/** How a stage change reads: only a move further along the pipeline is "forward". */
export function stageChange(from: Stage, to: Stage): StageChange {
  if (from === to) return 'same'
  const a = IDX[from]
  const b = IDX[to]
  if (b === undefined) return 'closed'
  if (a === undefined) return 'reopened'
  return b > a ? 'forward' : 'back'
}

/** Forward celebrates (egg hatch, stage-up). Back, passed, parked and reopening don't. */
export const celebrates = (from: Stage, to: Stage) => stageChange(from, to) === 'forward'
