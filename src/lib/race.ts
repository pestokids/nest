// PST-295: Pipeline › Race (round5/pipeline-race.png): kickoff week, who's ahead
// and the "slow down" note, the lead, and who to update. Pure functions over plain
// data, shared by the UI and Convex; days are Asia/Kolkata like the rest of Nest.
import { decideByOf, type DecisionFields } from './decisions'
import { dayDiff, formatDay, weekdayOf } from './dates'
import { dayOf, dedupeMeetings, normEmail, type SyncedMeeting } from './google'
import { maxIdx, type Activity, type Investor } from './pipeline'
import type { Phase, Round } from './round'
import { COMMIT, IDX, STAGE_TILE, type PipelineStage, type Stage } from './stages'

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const weekday = (iso: string) => new Date(iso + 'T00:00:00Z').getUTCDay()
const isWorkday = (iso: string) => weekday(iso) !== 0 && weekday(iso) !== 6
const firstWord = (s: string) => s.trim().split(/\s+/)[0] || s
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
/** "Three", "12". */
export const countWord = (n: number) => COUNT_WORDS[n] ?? String(n)

/* ---------- who's in the race ---------- */

/** Booked through Verbal: a 1st meeting is on or done, and nobody has signed yet. Verbal is an offer. */
export const RACE_STAGES = ['booked', 'm1', 'm2', 'dd', 'verbal'] as const satisfies readonly PipelineStage[]
export type RaceStage = (typeof RACE_STAGES)[number]
export const isRacing = (s: Stage): s is RaceStage => (RACE_STAGES as readonly string[]).includes(s)
/** Two offers in the same week is the goal (round5 design). */
export const OFFER_TARGET = 2
export type RaceInput = {
  investors: readonly Investor[]
  acts: readonly Activity[]
  meetings: readonly SyncedMeeting[]
  round: Pick<Round, 'phases'>
  today: string
  /** PST-293's decision: Dev's own decide-by date, when set. */
  decision: (investorId: string) => Pick<DecisionFields, 'decideBy' | 'decideByManual'> | undefined
}

/** The day an investor first moved into a stage (from the activity log). */
function stageDays(acts: readonly Activity[]) {
  const m = new Map<string, string>()
  for (const a of acts) {
    if (a.kind !== 'stage' || !a.stage) continue
    const k = a.investorId + '|' + a.stage
    const was = m.get(k)
    if (!was || a.date < was) m.set(k, a.date)
  }
  return (id: string, stage: Stage) => m.get(id + '|' + stage)
}

/** Each investor's synced meetings, deduplicated. */
function meetingsBy(meetings: readonly SyncedMeeting[]) {
  const m = new Map<string, SyncedMeeting[]>()
  for (const x of dedupeMeetings(meetings)) for (const id of x.investorIds) m.set(id, [...(m.get(id) ?? []), x])
  return (id: string) => m.get(id) ?? []
}

/**
 * The day of an investor's 1st meeting: its move into 1st meeting, else (still
 * booked) the next meeting on the calendar, else the booked next-step date.
 */
function firstMeetingOf(i: Investor, dayOfStage: (id: string, s: Stage) => string | undefined, theirMeetings: SyncedMeeting[], today: string): string | undefined {
  const moved = dayOfStage(i._id, 'm1')
  if (moved) return moved
  if (i.stage !== 'booked') return undefined
  const next = theirMeetings.map((x) => dayOf(x.start)).filter((d) => d >= today).sort()[0]
  return next ?? i.nextDate
}

/* ---------- kickoff week (or this week) ---------- */

export const KICKOFF = /kick\s*-?\s*off/i
/** The round plan's Kickoff phase: the week Dev pitches everyone at once. */
export const kickoffPhase = (round: Pick<Round, 'phases'>): Phase | undefined => round.phases.find((p) => KICKOFF.test(p.name))

export type RaceWindow = {
  /** Inside the Kickoff phase, or the current week (Monday to Sunday) outside it. */
  kind: 'kickoff' | 'week'
  from: string
  to: string
  /** Its working days. */
  days: string[]
  /** Today's place among them (1-based; 0 before the first). */
  day: number
  /** Meetings per day: the window's working days, then the next three. */
  bars: string[]
}

export function raceWindow(round: Pick<Round, 'phases'>, today: string): RaceWindow {
  const k = kickoffPhase(round)
  const kickoff = !!k && today >= k.from && today <= k.to
  const from = kickoff ? k.from : addDays(today, -((weekday(today) + 6) % 7))
  const to = kickoff ? k.to : addDays(from, 6)
  const days: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d)) days.push(d)
  const bars = [...days]
  for (let d = addDays(to, 1); bars.length < days.length + 3; d = addDays(d, 1)) if (isWorkday(d)) bars.push(d)
  return { kind: kickoff ? 'kickoff' : 'week', from, to, days, day: days.filter((d) => d <= today).length, bars }
}

export type DayBar = { day: string; n: number; today: boolean; past: boolean }
export type Kickoff = {
  window: RaceWindow
  /** Intros made, of the intros asked for. */
  intros: { out: number; of: number }
  /** 1st meetings that fall in the window (done, or booked). */
  firstMeetings: number
  inRace: number
  partnerMeetings: number
  /** Investors who moved to Verbal in the window, against OFFER_TARGET. */
  offers: number
  perDay: DayBar[]
  headline: string
}

/**
 * Meetings with investors on each day: synced Calendar meetings, then 1st and
 * partner meetings from the stage log and booked 1st meetings on days the
 * calendar doesn't already have them (so it works before Google is connected).
 */
export function meetingsPerDay(input: RaceInput, days: readonly string[]): DayBar[] {
  const ids = new Set(input.investors.map((i) => i._id))
  const keys = new Map<string, Set<string>>(days.map((d) => [d, new Set()]))
  const covered = new Set<string>()
  for (const m of dedupeMeetings(input.meetings)) {
    const day = dayOf(m.start)
    const on = m.investorIds.filter((id) => ids.has(id))
    if (!keys.has(day) || !on.length) continue
    keys.get(day)!.add('m:' + m._id)
    for (const id of on) covered.add(id + '|' + day)
  }
  for (const a of input.acts) {
    if (a.kind !== 'stage' || (a.stage !== 'm1' && a.stage !== 'm2') || !ids.has(a.investorId) || covered.has(a.investorId + '|' + a.date)) continue
    keys.get(a.date)?.add('a:' + a.investorId)
  }
  for (const i of input.investors)
    if (i.stage === 'booked' && i.nextDate && i.nextDate >= input.today && !covered.has(i._id + '|' + i.nextDate)) keys.get(i.nextDate)?.add('a:' + i._id)
  return days.map((day) => ({ day, n: keys.get(day)!.size, today: day === input.today, past: day < input.today }))
}

export function kickoff(input: RaceInput): Kickoff {
  const w = raceWindow(input.round, input.today)
  const dayOfStage = stageDays(input.acts)
  const theirs = meetingsBy(input.meetings)
  const within = (d: string | undefined) => !!d && d >= w.from && d <= w.to
  const moved = (stage: Stage) => input.investors.filter((i) => within(dayOfStage(i._id, stage))).length
  const intros = {
    out: input.investors.filter((i) => maxIdx(i) >= IDX.intro!).length,
    of: input.investors.filter((i) => maxIdx(i) >= IDX.ask!).length,
  }
  const k = {
    window: w,
    intros,
    firstMeetings: input.investors.filter((i) => within(firstMeetingOf(i, dayOfStage, theirs(i._id), input.today))).length,
    inRace: input.investors.filter((i) => isRacing(i.stage)).length,
    partnerMeetings: moved('m2'),
    offers: moved('verbal'),
    perDay: meetingsPerDay(input, w.bars),
  }
  return { ...k, headline: kickoffHeadline(k) }
}

// ---------- PST-298 interactions ----------
/** The second offer of the week just landed by your own move: the lime card's one confetti burst and target-hit. Never from a sync or on load. */
export const secondOfferCheer = (before: number, after: number, own: boolean) => own && before < OFFER_TARGET && after >= OFFER_TARGET
// ---------- end PST-298 interactions ----------

export function kickoffHeadline(k: Pick<Kickoff, 'intros' | 'offers'>): string {
  if (k.offers >= OFFER_TARGET) return `${countWord(k.offers)} offers in the same week. Now pick the lead.`
  if (k.intros.out < k.intros.of) return `${k.intros.out} of ${k.intros.of} intros are out. Chase the rest today.`
  if (k.intros.out) return `All ${k.intros.out} intros are out. Keep the meetings packed.`
  return 'No intros out yet. Send the asks first.'
}

/** "Kickoff week · Wed 18 – Tue 24 Nov · Day 3 of 5" (rendered uppercase), or "This week · …". */
export function windowEyebrow(w: RaceWindow): string {
  const label = w.kind === 'kickoff' ? 'Kickoff week' : 'This week'
  if (!w.days.length) return label
  const a = formatDay(w.days[0])
  const b = formatDay(w.days[w.days.length - 1])
  const range = (a.slice(-3) === b.slice(-3) ? a.slice(0, -4) : a) + ' – ' + b
  return `${label} · ${range}` + (w.day ? ` · Day ${w.day} of ${w.days.length}` : '')
}

/* ---------- who's ahead ---------- */

/** The lane's stops, left to right. */
export const LANE_STOPS = ['1st meeting', 'Partner', 'Diligence', 'Offer'] as const
const LEVEL: Record<RaceStage, number> = { booked: 0, m1: 1, m2: 2, dd: 3, verbal: 4 }
/** Where the marker sits, in stops (0 = 1st meeting, 3 = Offer): past a stop once it's done, on its way to the next. */
const POS: Record<RaceStage, number> = { booked: 0, m1: 0.5, m2: 1.5, dd: 2.5, verbal: 3 }

export type Lane = {
  investor: Investor
  stage: RaceStage
  /** 0 booked … 4 offer. */
  level: number
  pos: number
  firstMeeting?: string
  decideBy?: string
}

/** One lane per firm in the race, furthest along first, then the soonest decide-by. */
export function raceLanes(input: RaceInput): Lane[] {
  const dayOfStage = stageDays(input.acts)
  const theirs = meetingsBy(input.meetings)
  return input.investors
    .filter((i): i is Investor & { stage: RaceStage } => isRacing(i.stage))
    .map((i) => {
      const firstMeeting = firstMeetingOf(i, dayOfStage, theirs(i._id), input.today)
      return { investor: i, stage: i.stage, level: LEVEL[i.stage], pos: POS[i.stage], firstMeeting, decideBy: decideByOf(input.decision(i._id), firstMeeting) }
    })
    .sort((a, b) => b.level - a.level || (a.decideBy ?? '9').localeCompare(b.decideBy ?? '9') || a.investor.name.localeCompare(b.investor.name))
}

export type SlowDown = { leader: Lane; behind: Lane[]; text: string }

/**
 * The "slow down" note: one firm is at least a stage ahead of every other, from
 * the partner meeting on (a lone 1st meeting on day one isn't a lead yet). It
 * names the next two, and a day three working days out to hold the next step until.
 */
export function slowDown(lanes: readonly Lane[], today: string): SlowDown | null {
  if (lanes.length < 2) return null
  const [leader, ...rest] = [...lanes].sort((a, b) => b.level - a.level)
  if (leader.level < LEVEL.m2 || leader.level <= rest[0].level) return null
  const behind = rest.slice(0, 2)
  let day = today
  for (let n = 0; n < 3; ) if (isWorkday((day = addDays(day, 1)))) n++
  const on = WEEKDAYS[weekday(day)]
  const hold =
    leader.level === LEVEL.m2 ? `Offer diligence on ${on}` : leader.level === LEVEL.dd ? `Keep diligence going until ${on}` : `Ask for until ${on} to confirm it in writing`
  const names = behind.map((l) => firstWord(l.investor.name)).join(' and ')
  return { leader, behind, text: `${firstWord(leader.investor.name)} is a stage ahead of the rest. ${hold}, so ${names} can catch up.` }
}

/** The line under a lane when there's no signal: the booked day, or the next step and its day. */
export function laneCaption(l: Lane, today: string): string {
  const i = l.investor
  const day = (d: string) => (d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : dayDiff(d, today) <= 6 ? weekdayOf(d) : formatDay(d))
  if (l.stage === 'booked') return l.firstMeeting === today ? '1st meeting today' : l.firstMeeting ? `Booked · ${day(l.firstMeeting)}` : 'Booked'
  if (!i.nextStep.trim()) return STAGE_TILE[i.stage] + ' done'
  return i.nextStep.trim() + (i.nextDate ? ` · ${day(i.nextDate)}` : '')
}

/* ---------- the lead ---------- */

export const CAN_LEAD_VALUES = ['yes', 'no', 'unknown'] as const
export type CanLeadValue = (typeof CAN_LEAD_VALUES)[number]
/** On an investor (all optional): enrichment's answer, Dev's override, and the day Dev asked them to lead. */
export type LeadFields = {
  canLead?: { value: CanLeadValue; reason: string; at?: number }
  leadOverride?: boolean
  leadAskedOn?: string
}
export type CanLead = { on: boolean; value: CanLeadValue; reason: string; from: 'you' | 'list' | 'enrichment' | 'none' }

/**
 * Whether a firm can lead. Dev's word always wins (8 Nov): the drawer's switch,
 * then "Can lead or anchor" ticked on the investor (or in a CSV), then enrichment.
 */
export function canLeadOf(i: Pick<Investor, 'lead'> & LeadFields): CanLead {
  const reason = i.canLead?.reason.trim() ?? ''
  if (i.leadOverride !== undefined) return { on: i.leadOverride, value: i.leadOverride ? 'yes' : 'no', reason, from: 'you' }
  if (i.lead) return { on: true, value: 'yes', reason, from: 'list' }
  const value = i.canLead?.value ?? 'unknown'
  return { on: value === 'yes', value, reason, from: i.canLead ? 'enrichment' : 'none' }
}

/** A refreshed enrichment that couldn't tell keeps the yes or no an earlier one found. */
export function mergeCanLead<T extends { value: CanLeadValue }>(prev: T | undefined, next: T): T {
  return next.value === 'unknown' && prev && prev.value !== 'unknown' ? prev : next
}

export const LEAD_STEPS = [
  { k: 'asked', l: 'Asked to lead', short: 'Asked to lead' },
  { k: 'partner', l: 'Partner meeting', short: 'Partner mtg' },
  { k: 'offer', l: 'Offer', short: 'Offer' },
  { k: 'leading', l: 'Leading', short: 'Leading' },
] as const
export type LeadStep = (typeof LEAD_STEPS)[number]['k']

/** Asked to lead → partner meeting → offer → leading. The middle two follow the stage; leading is the round's lead. */
export function leadSteps(i: Pick<Investor, '_id' | 'stage' | 'maxStage'> & LeadFields, leadId: string | null): Record<LeadStep, boolean> {
  const ix = maxIdx(i)
  const leading = leadId === i._id
  return { asked: !!i.leadAskedOn || leading, partner: ix >= IDX.m2!, offer: ix >= IDX.verbal!, leading }
}

/** The first step not done yet (the drawer's bar shows it in lime). */
export const nextLeadStep = (s: Record<LeadStep, boolean>): LeadStep | null => LEAD_STEPS.find((x) => !s[x.k])?.k ?? null

/** "Partner meeting done", for the lead card. */
export function leadLine(i: Investor & LeadFields, leadId: string | null): string {
  const s = leadSteps(i, leadId)
  if (s.leading) return 'Leading the round'
  if (s.offer) return 'Offer made'
  if (s.partner) return 'Partner meeting done'
  if (s.asked) return 'Asked to lead'
  if (i.stage === 'm1') return '1st meeting done'
  if (i.stage === 'booked') return '1st meeting booked'
  return STAGE_TILE[i.stage]
}

/** Firms that can lead, in the race or committed (and the lead, whatever it says), most steps done first. */
export function leadCandidates<T extends Investor & LeadFields>(investors: readonly T[], leadId: string | null): T[] {
  const done = (i: T) => Object.values(leadSteps(i, leadId)).filter(Boolean).length
  return investors
    .filter((i) => i._id === leadId || (canLeadOf(i).on && (isRacing(i.stage) || COMMIT.has(i.stage))))
    .sort((a, b) => Number(b._id === leadId) - Number(a._id === leadId) || done(b) - done(a) || maxIdx(b) - maxIdx(a) || a.name.localeCompare(b.name))
}

/** The candidate to ask next: furthest along and not asked yet. Nobody once the round has a lead. */
export const askNext = <T extends Investor & LeadFields>(candidates: readonly T[], leadId: string | null): T | undefined =>
  leadId ? undefined : candidates.find((i) => !leadSteps(i, leadId).asked)

/* ---------- who to update ---------- */

export const UPDATE_GROUPS = [
  { k: 'race', l: 'In the race' },
  { k: 'maybes', l: 'Maybes' },
  { k: 'committed', l: 'Committed' },
  { k: 'warm', l: 'Passed, but warm' },
] as const
export type UpdateGroupKey = (typeof UPDATE_GROUPS)[number]['k']
export type UpdateGroup = { key: UpdateGroupKey; label: string; investors: Investor[]; emails: string[] }

/** The address an update goes to: their main email, else their first other one. */
export const updateEmail = (i: Pick<Investor, 'email' | 'emails'>) => normEmail(i.email) || normEmail(i.emails?.[0])

/** After a real conversation, or warm to begin with: a pass worth keeping in the loop. */
const warmOrMet = (i: Investor) => i.warmth === 'existing' || i.warmth === 'warm' || maxIdx(i) >= IDX.m1!

/**
 * Who to send an update to, each investor in one group: committed (Verbal on),
 * maybes (PST-293's status), the rest of the race, and passed but warm (a
 * PST-293 No counts as passed: Mark as no slides them in). Nest only lists them;
 * Dev sends it.
 */
export function updateGroups(investors: readonly Investor[], isMaybe: (i: Investor) => boolean, isNo: (i: Investor) => boolean = () => false): UpdateGroup[] {
  const out = new Map<UpdateGroupKey, Investor[]>(UPDATE_GROUPS.map((g) => [g.k, []]))
  for (const i of investors) {
    const passed = i.stage === 'passed' || isNo(i)
    const key: UpdateGroupKey | null = COMMIT.has(i.stage)
      ? 'committed'
      : passed
        ? warmOrMet(i)
          ? 'warm'
          : null
        : isMaybe(i)
          ? 'maybes'
          : isRacing(i.stage)
            ? 'race'
            : null
    if (key) out.get(key)!.push(i)
  }
  return UPDATE_GROUPS.map((g) => {
    const list = out.get(g.k)!.sort((a, b) => a.name.localeCompare(b.name))
    return { key: g.k, label: g.l, investors: list, emails: [...new Set(list.map(updateEmail).filter(Boolean))] }
  })
}

/** What "Copy emails" puts on the clipboard: ready for the To or Bcc field. */
export const emailList = (emails: readonly string[]) => emails.join(', ')

/** "Last update: Wed 4 Nov, 4 days ago". */
export function lastUpdateLine(sentOn: string | null | undefined, today: string): string {
  if (!sentOn) return 'No update sent yet'
  const n = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(sentOn + 'T00:00:00Z')) / 864e5)
  return `Last update: ${formatDay(sentOn)}, ${n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`}`
}
