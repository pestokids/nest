// The Today Inbox (PST-297): every row that needs Dev, from each feature's own
// selectors (below, one block per feature), merged into one ranked list. Today,
// Home's Inbox card and the top bar's count all read `buildInbox` through
// components/inbox/data.tsx, so the numbers match everywhere. Pure (unit-tested).
import { dayDiff, todayIST } from './dates'
import { agoShort, dayOf, dedupeMeetings, timeOf, type SyncedMeeting, type SyncedThread } from './google'
import { dueDate, dueList, lastContact, quietFor, quietList, type Activity, type Investor } from './pipeline'
import { acceptsTogether, KIND_LABEL, type Suggestion } from './suggestions'
// PST-293
import { ASK_OR_DROP_CALLS, DECISION_LABEL, decideByLine, isDecideByPassed, undecided, type Decision } from './decisions'
import { ASK_LABEL, decideQuestion, type SignalChange, type SignalView } from './signals'
import { allPeople, firstName, hasDecided, NUDGE_AFTER, personKey, saidNo, waitingDays, type Intro, type IntroSources } from './introducers' // PST-294
import { addDays, nextMoves, type MoveAction } from './today' // PST-294, PST-297
// PST-297
import { closeDue, endOfDayIST, KIT_LABEL } from './closeKit'
import type { Closing } from './close'
import type { DraftType } from './drafts'
import { money } from './money'
import type { Round } from './round'
import { KEYS, matches, type KeyEventLike } from './shortcuts'

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

import { isDecisionPassed, passedDetail } from './applications' // PST-302

/* ---------- PST-293: decisions, for PST-297's Inbox ---------- */
// Four row types: a decide-by date that has passed, the 3rd call done (ask or
// drop), a new ask from an email, and a Decide row (an unsure signal). Today shows
// them in Due today until PST-297 replaces it.

export type DecisionInboxKind = 'decide_by' | 'third_call' | 'ask' | 'decide'
export type DecisionInboxRow = {
  key: string
  kind: DecisionInboxKind
  investorId: string
  name: string
  detail: string
  /** ask and decide rows: the signal to act on. */
  signalId?: string
  /** decide rows: the change it proposes. */
  change?: SignalChange
}
export const DECISION_INBOX_LABEL: Record<DecisionInboxKind, string> = { decide_by: 'Get a yes or no', third_call: 'Ask or drop', ask: 'They asked', decide: 'Decide' }

export type DecisionSources = {
  investors: readonly Pick<Investor, '_id' | 'name' | 'stage'>[]
  decisions: readonly Decision[]
  signals: readonly SignalView[]
  today: string
}

/** Who's still in it: on the list, not passed and the money not in, and no Yes or No yet. */
function open(src: DecisionSources) {
  const byId = new Map(src.investors.filter((i) => i.stage !== 'passed' && i.stage !== 'wired').map((i) => [i._id, i]))
  return src.decisions.filter((d) => byId.has(d.investorId) && undecided(d)).map((d) => ({ d, i: byId.get(d.investorId)! }))
}

/** The decide-by date has passed, the oldest first. */
export function decideByPassedRows(src: DecisionSources): DecisionInboxRow[] {
  return open(src)
    .filter(({ d }) => isDecideByPassed(d, src.today))
    .sort((a, b) => a.d.decideBy!.localeCompare(b.d.decideBy!))
    .map(({ d, i }) => ({ key: 'decide_by:' + i._id, kind: 'decide_by', investorId: i._id, name: i.name, detail: decideByLine(d.decideBy!, src.today) }))
}

/** The 3rd call is done: ask for a yes or no, or drop them. Most calls first. */
export function thirdCallRows(src: DecisionSources): DecisionInboxRow[] {
  return open(src)
    .filter(({ d }) => d.calls >= ASK_OR_DROP_CALLS)
    .sort((a, b) => b.d.calls - a.d.calls)
    .map(({ d, i }) => ({ key: 'third_call:' + i._id, kind: 'third_call', investorId: i._id, name: i.name, detail: d.calls + ' calls · ask or drop' }))
}

const byName = (src: DecisionSources) => new Map(src.investors.map((i) => [i._id, i.name]))

/** New asks from emails (deck, data, numbers, a meeting, an intro) not ticked off yet, newest first. */
export function newAskRows(src: DecisionSources): DecisionInboxRow[] {
  const names = byName(src)
  return src.signals
    .filter((s) => s.asked && !s.askDoneAt && names.has(s.investorId))
    .sort((a, b) => b.at - a.at)
    .map((s) => ({ key: 'ask:' + s._id, kind: 'ask', investorId: s.investorId, name: names.get(s.investorId)!, detail: 'Asked for ' + ASK_LABEL[s.asked!], signalId: s._id }))
}

/** Unsure signals waiting on Dev: "Mark as no?", newest first. */
export function decideRows(src: DecisionSources): DecisionInboxRow[] {
  const names = byName(src)
  return src.signals
    .filter((s) => s.outcome === 'decide' && s.change && !s.doneAt && names.has(s.investorId))
    .sort((a, b) => b.at - a.at)
    .map((s) => ({
      key: 'decide:' + s._id, kind: 'decide', investorId: s.investorId, name: names.get(s.investorId)!,
      detail: decideQuestion(s.change!) + ' From ' + (s.source === 'email' ? 'their email' : 'your notes') + ' · ' + Math.round(s.p * 100) + '%',
      signalId: s._id, change: s.change,
    }))
}

/** All four, in that order: Decide rows, new asks, decide-by passed, then the 3rd call (an investor once among the last two). */
export function decisionInbox(src: DecisionSources): DecisionInboxRow[] {
  const late = decideByPassedRows(src)
  const seen = new Set(late.map((r) => r.investorId))
  return [...decideRows(src), ...newAskRows(src), ...late, ...thirdCallRows(src).filter((r) => !seen.has(r.investorId))]
}
/* ---------- end PST-293 ---------- */
/* ---------- PST-294: introducer rows (PST-297's Inbox takes these as they are) ---------- */

export type IntroRowKind = 'thank' | 'report' | 'nudge-introducer'
export type IntroRow = {
  key: string
  kind: IntroRowKind
  introId: string
  investorId: string
  /** The person (or committed investor) making the intro. */
  personKey: string
  /** "Ankur Mehta" */
  name: string
  /** "Thank Ankur for the intro to Lantern Ventures" */
  title: string
  /** "Intro made today", "Orchard said yes", "Asked 4 days ago, no reply" */
  detail: string
  /** The day it's due: the intro's day for a thank-you, the decision's for a report, ask + 3 days for a nudge. */
  due: string
  /** Days past due (0 on the day). */
  late: number
}

/** Where the selectors read from: introducers.ts's sources. */
export type IntroInboxSources = IntroSources & { today: string }

const nameOf = (src: IntroSources) => {
  const people = new Map(allPeople(src.introducers, src.investors).map((p) => [p.key, p]))
  return (x: Intro) => people.get(personKey(x))
}

/** Thank the introducer the same day the intro is made: due that day, late after. */
export function introThanks(src: IntroInboxSources): IntroRow[] {
  const person = nameOf(src)
  const byId = new Map(src.investors.map((i) => [i._id, i]))
  return src.intros
    .filter((x) => x.steps.made && !x.steps.thanked && x.steps.made <= src.today)
    .flatMap((x) => {
      const p = person(x)
      const inv = byId.get(x.investorId)
      if (!p || !inv) return []
      const due = x.steps.made!
      const late = dayDiff(src.today, due)
      return [{
        key: 'thank:' + x._id, kind: 'thank' as const, introId: x._id, investorId: inv._id, personKey: p.key, name: p.name,
        title: 'Thank ' + firstName(p.name) + ' for the intro to ' + inv.name, detail: late <= 0 ? 'Intro made today' : 'Intro made ' + days(late) + ' ago', due, late,
      }]
    })
    .sort((a, b) => a.due.localeCompare(b.due))
}

/** Report back to the introducer once the investor decides (a yes or a no), after thanking. */
export function introReports(src: IntroInboxSources): IntroRow[] {
  const person = nameOf(src)
  const byId = new Map(src.investors.map((i) => [i._id, i]))
  return src.intros
    .filter((x) => x.steps.made && !x.steps.reported)
    .flatMap((x) => {
      const p = person(x)
      const inv = byId.get(x.investorId)
      if (!p || !inv || !hasDecided(inv)) return []
      const due = [inv.lastTouch, x.steps.thanked, x.steps.made].filter((d): d is string => !!d).sort().at(-1)!
      const late = Math.max(0, dayDiff(src.today, due))
      return [{
        key: 'report:' + x._id, kind: 'report' as const, introId: x._id, investorId: inv._id, personKey: p.key, name: p.name,
        title: 'Tell ' + firstName(p.name) + ' how ' + inv.name + ' went', detail: inv.name + (saidNo(inv) ? ' passed' : ' said yes'), due, late,
      }]
    })
    .sort((a, b) => a.due.localeCompare(b.due))
}

/** Nudge an introducer after 3 days with no reply to the ask (counting again from a nudge). */
export function introNudges(src: IntroInboxSources): IntroRow[] {
  const person = nameOf(src)
  const byId = new Map(src.investors.map((i) => [i._id, i]))
  return src.intros
    .flatMap((x) => {
      const n = waitingDays(x, src.today)
      const p = person(x)
      const inv = byId.get(x.investorId)
      if (n === null || !p || !inv || hasDecided(inv)) return []
      return [{
        key: 'nudge-introducer:' + x._id, kind: 'nudge-introducer' as const, introId: x._id, investorId: inv._id, personKey: p.key, name: p.name,
        title: 'Nudge ' + firstName(p.name) + ' about ' + inv.name, detail: 'Asked ' + days(n) + ' ago, no reply', due: addDays(src.today, NUDGE_AFTER - n), late: n - NUDGE_AFTER,
      }]
    })
    .sort((a, b) => b.late - a.late)
}

/* ---------- end PST-294 ---------- */

/* ---------- PST-297: the Inbox ---------- */
// One list from every selector above and each feature's own: follow-ups after a
// meeting, replies (with what they asked for), introducers to thank or report
// back to, decisions, written confirmations and close steps due, next steps due,
// notes to review, suggested fixes, opened links, who's gone quiet and the next
// moves. One row per investor (or introducer) per type, grouped Do now, Today
// and When you can, and ranked by deadline, then Priority. Done and snooze are
// marks per row key with the row's version: a row comes back when its source
// changes (a new email, a new date).

/** `awaiting` is PST-302's slot: an application whose decision date passed. Its selector joins buildInbox; the rest already handles the type. */
export const INBOX_TYPES = ['followup', 'reply', 'thank', 'report', 'decide', 'awaiting', 'confirm', 'close', 'due', 'review', 'fix', 'opened', 'quiet', 'move'] as const
export type InboxType = (typeof INBOX_TYPES)[number]
export const INBOX_TYPE_LABEL: Record<InboxType, string> = {
  followup: 'Follow up', reply: 'Reply', thank: 'Thank', report: 'Report back', decide: 'Decide', awaiting: 'Decision due', confirm: 'Confirm', close: 'Close',
  due: 'Next step', review: 'Review', fix: 'Fix', opened: 'Opened', quiet: 'Quiet', move: 'Next move',
}
/** The filter chips over the list: introducers' rows share one, and so do the close kit's. */
export const INBOX_CHIP: Record<InboxType, string> = {
  followup: 'Follow up', reply: 'Reply', thank: 'Introducers', report: 'Introducers', decide: 'Decide', awaiting: 'Awaiting', confirm: 'Close', close: 'Close',
  due: 'Next steps', review: 'Review', fix: 'Fixes', opened: 'Opened', quiet: 'Quiet', move: 'Moves',
}

export const INBOX_GROUPS = ['now', 'today', 'later'] as const
export type InboxGroup = (typeof INBOX_GROUPS)[number]
export const INBOX_GROUP_LABEL: Record<InboxGroup, string> = { now: 'Do now · promised today', today: 'Today', later: 'When you can' }

/** A row's one primary action. */
export type InboxAction =
  | { kind: 'gmail'; url: string }
  | { kind: 'draft'; type: DraftType }
  | { kind: 'open'; tab?: 'materials' | 'notes'; /** Opened links: their notices are seen once opened. */ seen?: string[] }
  | { kind: 'step'; introIds: string[]; step: 'thanked' | 'reported' }
  | { kind: 'nudge-introducer'; introIds: string[] }
  | { kind: 'resolve'; signalId: string }
  | { kind: 'kit' }
  | { kind: 'done' }
  | { kind: 'accept-fixes'; ids: string[] }
  | { kind: 'fixes' }
  | { kind: 'move'; move: MoveAction }

export type InboxRow = {
  /** `type:investorId` (or the introducer's person key): what done and snooze are stored under. */
  key: string
  type: InboxType
  group: InboxGroup
  name: string
  detail: string
  investorId?: string
  /** Introducer rows: the person (Investors › Introducers opens on them). */
  personKey?: string
  /** The deadline (epoch ms), when there is one. */
  due?: number
  /** The right-hand label: "Send by 18:00", "Reply today", "1 day over", "2h ago". */
  when: string
  late: boolean
  /** PST-284's Priority (0–100): the tie-break after the deadline. */
  priority: number
  /** A short hash of the source state: a mark only holds while it matches. */
  version: string
  label: string
  action: InboxAction
  /** What D drafts (with the investor), when it isn't the drawer's pick. */
  draft?: DraftType
}

/** A first open of a link, as the row shows it ("Read deck v4 for 4 min, longest on p6"). */
export type InboxOpen = { linkId: string; investorId: string; at: number; text: string }

export type InboxSources = {
  now: number
  today: string
  investors: readonly Investor[]
  acts: readonly Activity[]
  round: Round
  meetings: readonly SyncedMeeting[]
  threads: readonly SyncedThread[]
  decisions: readonly Decision[]
  signals: readonly SignalView[]
  introducers: IntroSources['introducers']
  intros: IntroSources['intros']
  /** The list with each investor's decision (a Yes or No there means report back). */
  introInvestors: IntroSources['investors']
  closings: readonly Closing[]
  opens: readonly InboxOpen[]
  /** Open suggestions (the notes' proposals among them). */
  suggestions: readonly Suggestion[]
  /** PST-284's Priority score by investor id (0 when unknown). */
  priority: (investorId: string) => number
  /** The morning brief's moves, for their reasons. */
  briefMoves?: readonly { key: string; why: string; reason?: string }[]
}

const HOUR = 36e5
const DAY = 24 * HOUR
/** Meetings that ended up to this many days ago still want a follow-up. */
export const FOLLOW_UP_DAYS = 3
/** Touches that count as following up after a meeting. */
const FOLLOW_TOUCHES = new Set<string | undefined>(['email', 'ask', 'nudge', 'done'])

/** The end of the working day after a meeting: 18:00 IST, or 23:59 when it ended within the hour before. */
export function followUpBy(end: number): number {
  const day = dayOf(end)
  const six = Date.parse(day + 'T18:00:00+05:30')
  return end <= six - HOUR ? six : endOfDayIST(day)
}

/** A reply is owed by the end of the day they wrote, or of the next day when they wrote after 18:00 IST. */
export function replyBy(at: number): number {
  const day = dayOf(at)
  return at < Date.parse(day + 'T18:00:00+05:30') ? endOfDayIST(day) : endOfDayIST(addDays(day, 1))
}

/** "2 days over", or "Overdue" earlier the same day. */
export function overText(due: number, now: number): string {
  const n = dayDiff(todayIST(now), dayOf(due))
  return n >= 1 ? days(n) + ' over' : 'Overdue'
}

/** Snooze lasts until tomorrow, 09:00 IST. */
export const snoozeUntil = (now: number) => Date.parse(addDays(todayIST(now), 1) + 'T09:00:00+05:30')

const hash = (s: string) => {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

type Raw = Omit<InboxRow, 'late' | 'when' | 'priority'> & { when?: string }

const groupBy = <T>(xs: readonly T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>()
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x])
  return m
}
const names = (xs: readonly string[]) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1])

function followUpRows(src: InboxSources, byId: Map<string, Investor>): Raw[] {
  const followed = (id: string, end: number) =>
    src.acts.some((a) => a.investorId === id && a.kind === 'note' && a.source !== 'calendar' && FOLLOW_TOUCHES.has(a.touch) && (a._creationTime ? a._creationTime > end : a.date > dayOf(end))) ||
    src.threads.some((t) => t.lastFrom === 'us' && t.lastAt > end && t.investorIds.includes(id))
  const out: Raw[] = []
  for (const m of dedupeMeetings(src.meetings).sort((a, b) => b.end - a.end)) {
    if (m.end > src.now || m.end < src.now - FOLLOW_UP_DAYS * DAY) continue
    for (const id of m.investorIds) {
      const i = byId.get(id)
      if (!i || i.stage === 'passed' || followed(id, m.end)) continue
      const due = followUpBy(m.end)
      out.push({
        key: 'followup:' + id, type: 'followup', group: 'now', name: i.name, investorId: id,
        detail: 'Meeting ended ' + agoShort(m.end, src.now) + '. No follow-up sent yet.', due, when: 'Send by ' + timeOf(due),
        version: m.eventId + '@' + m.end, label: 'Draft follow-up', action: { kind: 'draft', type: 'followup' }, draft: 'followup',
      })
    }
  }
  return out
}

function replyRows(src: InboxSources, byId: Map<string, Investor>): Raw[] {
  const threads = groupBy(src.threads.filter((t) => t.lastFrom === 'them' && byId.has(t.investorIds[0] ?? '')), (t) => t.investorIds[0])
  const asks = groupBy(newAskRows({ investors: src.investors, decisions: src.decisions, signals: src.signals, today: src.today }), (r) => r.investorId)
  const signalAt = new Map(src.signals.map((s) => [s._id, s.at]))
  const endOfToday = endOfDayIST(src.today)
  const out: Raw[] = []
  for (const id of new Set([...threads.keys(), ...asks.keys()])) {
    const ts = [...(threads.get(id) ?? [])].sort((a, b) => b.lastAt - a.lastAt)
    const as = asks.get(id) ?? []
    const t = ts[0]
    const due = replyBy(Math.min(...ts.map((x) => x.lastAt), ...as.map((a) => signalAt.get(a.signalId!) ?? src.now)))
    const asked = as[0]?.detail ?? ''
    out.push({
      key: 'reply:' + id, type: 'reply', group: as.length || due < src.now ? 'now' : 'today', name: byId.get(id)!.name, investorId: id,
      detail: t ? [t.subject, 'they wrote ' + agoShort(t.lastAt, src.now), asked.replace(/^Asked/, 'asked')].filter(Boolean).join(' · ') : asked,
      due, when: due <= endOfToday ? 'Reply today' : 'Reply tomorrow',
      version: [...ts.map((x) => x._id + '@' + x.lastAt), ...as.map((a) => a.signalId!)].join(','),
      ...(t?.mine ? { label: 'Open in Gmail', action: { kind: 'gmail', url: t.link } as const } : { label: 'Draft a reply', action: { kind: 'draft', type: 'followup' } as const }),
      draft: 'followup',
    })
  }
  return out
}

function introRows(src: InboxSources): Raw[] {
  const isrc = { introducers: src.introducers, intros: src.intros, investors: src.introInvestors, today: src.today }
  const inv = new Map(src.introInvestors.map((i) => [i._id, i.name]))
  const out: Raw[] = []
  for (const [key, rs] of groupBy(introThanks(isrc), (r) => r.personKey)) {
    const due = endOfDayIST(rs[0].due)
    out.push({
      key: 'thank:' + key, type: 'thank', group: 'now', name: rs[0].name, personKey: key, investorId: rs.length === 1 ? rs[0].investorId : undefined,
      detail: 'Introduced you to ' + names(rs.map((r) => inv.get(r.investorId)!)), due, when: 'Thank today',
      version: rs.map((r) => r.introId + '@' + r.due).join(','), label: 'Mark thanked', action: { kind: 'step', introIds: rs.map((r) => r.introId), step: 'thanked' },
    })
  }
  for (const [key, rs] of groupBy(introReports(isrc), (r) => r.personKey))
    out.push({
      key: 'report:' + key, type: 'report', group: 'today', name: rs[0].name, personKey: key, investorId: rs.length === 1 ? rs[0].investorId : undefined,
      detail: rs.length === 1 ? rs[0].title.replace(/^Tell \S+/, 'Tell them') : 'Tell them how ' + names(rs.map((r) => inv.get(r.investorId)!)) + ' went',
      due: endOfDayIST(rs[0].due), when: 'Today',
      version: rs.map((r) => r.introId + '@' + r.due).join(','), label: 'Mark reported', action: { kind: 'step', introIds: rs.map((r) => r.introId), step: 'reported' },
    })
  for (const [key, rs] of groupBy(introNudges(isrc), (r) => r.personKey))
    out.push({
      key: 'quiet:' + key, type: 'quiet', group: 'later', name: rs[0].name, personKey: key, investorId: rs.length === 1 ? rs[0].investorId : undefined,
      detail: rs[0].detail + ' about ' + names(rs.map((r) => inv.get(r.investorId)!)) + '.', when: '',
      version: rs.map((r) => r.introId + '@' + r.due).join(','), label: 'Nudge', action: { kind: 'nudge-introducer', introIds: rs.map((r) => r.introId) },
    })
  return out
}

function decideRowsFor(src: InboxSources): Raw[] {
  const d = { investors: src.investors, decisions: src.decisions, signals: src.signals, today: src.today }
  const all = [...decideByPassedRows(d), ...decideRows(d), ...thirdCallRows(d)]
  const decision = new Map(src.decisions.map((x) => [x.investorId, x]))
  const out: Raw[] = []
  for (const [id, rs] of groupBy(all, (r) => r.investorId)) {
    const passed = rs.find((r) => r.kind === 'decide_by')
    const sig = rs.find((r) => r.kind === 'decide')
    const x = decision.get(id)
    out.push({
      key: 'decide:' + id, type: 'decide', group: passed ? 'now' : 'today', name: rs[0].name, investorId: id,
      detail: [...new Set(rs.map((r) => r.detail))].join(' · '), due: passed ? endOfDayIST(x!.decideBy!) : undefined, when: '',
      version: [x?.decideBy ?? '', x?.calls ?? 0, ...rs.filter((r) => r.signalId).map((r) => r.signalId)].join(','),
      ...(sig?.change
        ? { label: 'Mark as ' + DECISION_LABEL[sig.change.to].toLowerCase(), action: { kind: 'resolve', signalId: sig.signalId! } as const }
        : { label: 'Ask for a yes or no', action: { kind: 'draft', type: 'decision' } as const }),
      draft: 'decision',
    })
  }
  return out
}

function closeRows(src: InboxSources, byId: Map<string, Investor>): Raw[] {
  const endOfToday = endOfDayIST(src.today)
  return closeDue(src.now, { investors: src.investors, closings: src.closings, acts: src.acts }).map((s): Raw => {
    const amount = byId.get(s.investorId)?.expected
    return s.step === 'confirm'
      ? {
          key: 'confirm:' + s.investorId, type: 'confirm', group: s.overdue ? 'now' : 'today', name: s.name, investorId: s.investorId,
          detail: (amount ? 'Said ' + money(amount) + '. ' : '') + 'Confirm it in writing.', due: s.dueAt, when: s.dueAt === endOfToday ? 'Within the day' : 'By ' + timeOf(s.dueAt),
          version: s.step + '@' + s.dueAt, label: 'Send confirmation', action: { kind: 'kit' },
        }
      : {
          key: 'close:' + s.investorId, type: 'close', group: 'now', name: s.name, investorId: s.investorId,
          detail: KIT_LABEL[s.step] + (s.overdue ? ' is overdue.' : ' is due today.'), due: s.dueAt, when: 'Due ' + timeOf(s.dueAt),
          version: s.step + '@' + s.dueAt, label: 'Open the close kit', action: { kind: 'kit' },
        }
  })
}

function dueRows(src: InboxSources): Raw[] {
  return dueList([...src.investors], src.today).map((i) => ({
    key: 'due:' + i._id, type: 'due', group: 'today', name: i.name, investorId: i._id,
    detail: i.stage === 'parked' ? 'Parked until today. Check back in.' : i.nextStep.trim() || 'No next step written down',
    due: endOfDayIST(dueDate(i)!), when: 'Today', version: [i.stage, i.nextStep, i.nextDate, i.parkedUntil].join('|'), label: 'Mark done', action: { kind: 'done' },
  }))
}

function suggestionRows(src: InboxSources, byId: Map<string, Investor>): Raw[] {
  const out: Raw[] = []
  const live = src.suggestions.filter((s) => !s.investorId || byId.has(s.investorId))
  for (const [id, ss] of groupBy(live.filter((s) => s.source === 'notes' && s.investorId), (s) => s.investorId!))
    out.push({
      key: 'review:' + id, type: 'review', group: 'today', name: byId.get(id)!.name, investorId: id,
      detail: 'Nest read your meeting notes: ' + ss.length + (ss.length === 1 ? ' update' : ' updates'), when: '',
      version: ss.map((s) => s._id).sort().join(','), label: 'Review ' + ss.length, action: { kind: 'open', tab: 'notes' },
    })
  const fixes = live.filter((s) => s.source !== 'notes')
  const safe = fixes.filter(acceptsTogether)
  if (safe.length)
    out.push({
      key: 'fix:safe', type: 'fix', group: 'later', name: safe.length + (safe.length === 1 ? ' safe fix' : ' safe fixes'),
      detail: names([...new Set(safe.map((s) => KIND_LABEL[s.kind]))]), when: '',
      version: safe.map((s) => s._id).sort().join(','), label: 'Accept ' + safe.length, action: { kind: 'accept-fixes', ids: safe.map((s) => s._id) },
    })
  for (const [id, ss] of groupBy(fixes.filter((s) => !acceptsTogether(s)), (s) => s.investorId ?? s._id)) {
    const i = byId.get(id)
    out.push({
      key: 'fix:' + id, type: 'fix', group: 'later', name: i?.name ?? ss[0].title, investorId: i?._id,
      detail: (i ? ss[0].title : ss[0].fix) + (ss.length > 1 ? ' · ' + (ss.length - 1) + ' more' : ''), when: '',
      version: ss.map((s) => s._id).sort().join(','), label: 'Review', action: { kind: 'fixes' },
    })
  }
  return out
}

function openRows(src: InboxSources, byId: Map<string, Investor>): Raw[] {
  const opens = [...src.opens].sort((a, b) => b.at - a.at).filter((o) => byId.has(o.investorId))
  return [...groupBy(opens, (o) => o.investorId)].map(([id, os]) => ({
    key: 'opened:' + id, type: 'opened', group: 'later', name: byId.get(id)!.name, investorId: id,
    detail: os[0].text + (os.length > 1 ? ' · ' + (os.length - 1) + ' more' : ''), when: agoShort(os[0].at, src.now),
    version: os.map((o) => o.linkId + '@' + o.at).join(','), label: 'Open', action: { kind: 'open', tab: 'materials', seen: os.map((o) => o.linkId) },
  }))
}

function quietRows(src: InboxSources): Raw[] {
  return quietList([...src.investors], src.today, src.round.quietDays).map((i) => {
    const n = quietFor(i, src.today, src.round.quietDays)!
    return {
      key: 'quiet:' + i._id, type: 'quiet', group: 'later', name: i.name, investorId: i._id,
      detail: (n === Infinity ? 'Never touched.' : 'No touch for ' + days(n) + '.') + ' Nudge, or ask for a no.', when: '',
      version: lastContact(i) ?? 'never', label: 'Nudge', action: { kind: 'draft', type: 'nudge' }, draft: 'nudge',
    }
  })
}

function moveRows(src: InboxSources): Raw[] {
  return nextMoves({ investors: [...src.investors], acts: [...src.acts], round: src.round, today: src.today, priority: src.priority })
    .filter((m) => m.action.kind !== 'scroll')
    .map((m) => {
      const b = src.briefMoves?.find((x) => x.key === m.key)
      const id = m.action.kind === 'ask' || m.action.kind === 'open' ? m.action.investorId : undefined
      return {
        key: 'move:' + m.key, type: 'move', group: 'later', name: m.title, investorId: id, detail: b ? b.reason || b.why : m.why, when: '',
        version: m.key + '|' + m.count, label: m.label, action: { kind: 'move', move: m.action },
      }
    })
}

/** Rows with the same key become one: the soonest deadline, the more urgent group, both sources in the version. */
export function mergeRows<R extends Pick<InboxRow, 'key' | 'group' | 'due' | 'version' | 'action'>>(rows: readonly R[]): R[] {
  const out = new Map<string, R>()
  for (const r of rows) {
    const had = out.get(r.key)
    if (!had) {
      out.set(r.key, r)
      continue
    }
    const action =
      (had.action.kind === 'step' && r.action.kind === 'step') || (had.action.kind === 'nudge-introducer' && r.action.kind === 'nudge-introducer')
        ? { ...had.action, introIds: [...new Set([...had.action.introIds, ...r.action.introIds])] }
        : had.action
    out.set(r.key, {
      ...had,
      group: INBOX_GROUPS[Math.min(INBOX_GROUPS.indexOf(had.group), INBOX_GROUPS.indexOf(r.group))],
      due: had.due === undefined ? r.due : r.due === undefined ? had.due : Math.min(had.due, r.due),
      version: [had.version, r.version].sort().join(','),
      action,
    })
  }
  return [...out.values()]
}

/** Do now, then Today, then When you can; in each, the soonest deadline first, then the higher Priority. */
export function rankInbox<R extends Pick<InboxRow, 'group' | 'due' | 'priority' | 'type' | 'name'>>(rows: readonly R[]): R[] {
  return [...rows].sort(
    (a, b) =>
      INBOX_GROUPS.indexOf(a.group) - INBOX_GROUPS.indexOf(b.group) ||
      (a.due ?? Infinity) - (b.due ?? Infinity) ||
      b.priority - a.priority ||
      INBOX_TYPES.indexOf(a.type) - INBOX_TYPES.indexOf(b.type) ||
      a.name.localeCompare(b.name),
  )
}

/** Every row the Inbox has, merged and ranked (before done and snooze). */
export function buildInbox(src: InboxSources): InboxRow[] {
  const byId = new Map(src.investors.map((i) => [i._id, i]))
  const raw = [
    ...followUpRows(src, byId), ...replyRows(src, byId), ...introRows(src), ...decideRowsFor(src), /* PST-302 */ ...awaitingRows(src), ...closeRows(src, byId),
    ...dueRows(src), ...suggestionRows(src, byId), ...openRows(src, byId), ...quietRows(src), ...moveRows(src),
  ]
  return rankInbox(
    mergeRows(raw).map((r): InboxRow => {
      const late = r.due !== undefined && r.due < src.now
      return { ...r, late, when: late ? overText(r.due!, src.now) : (r.when ?? ''), priority: r.investorId ? src.priority(r.investorId) : 0, version: hash(r.version) }
    }),
  )
}

export function groupInbox(rows: readonly InboxRow[]): { group: InboxGroup; label: string; rows: InboxRow[] }[] {
  return INBOX_GROUPS.map((g) => ({ group: g, label: INBOX_GROUP_LABEL[g], rows: rows.filter((r) => r.group === g) })).filter((x) => x.rows.length)
}

/** "All" comes first in the UI; then one chip per kind of row in the list, in the list's type order. */
export function inboxChips(rows: readonly Pick<InboxRow, 'type'>[]): { label: string; n: number }[] {
  const n = new Map<string, number>()
  for (const t of INBOX_TYPES) for (const r of rows) if (r.type === t) n.set(INBOX_CHIP[t], (n.get(INBOX_CHIP[t]) ?? 0) + 1)
  return [...n].map(([label, k]) => ({ label, n: k }))
}

/* done and snooze */

export type InboxMarkKind = 'done' | 'snooze'
export type InboxMark = { key: string; kind: InboxMarkKind; version: string; until?: number }

/** A mark hides its row while the source is unchanged: done for good, snoozed until `until`. */
export const isMarked = (r: Pick<InboxRow, 'version'>, m: InboxMark | undefined, now: number) =>
  !!m && m.version === r.version && (m.kind === 'done' || (m.until ?? 0) > now)

export const visibleInbox = (rows: readonly InboxRow[], marks: ReadonlyMap<string, InboxMark>, now: number) => rows.filter((r) => !isMarked(r, marks.get(r.key), now))

/** The clear-inbox confetti plays at most once a day: `last` is the day it last played. */
export const firstClearToday = (last: string | null | undefined, today: string) => last !== today

/* keys (the shortcut registry's, so the ? sheet lists them) */

export type InboxKey = 'down' | 'up' | 'done' | 'snooze' | 'draft' | 'open'
const INBOX_KEYS: readonly InboxKey[] = ['down', 'up', 'done', 'snooze', 'draft', 'open']
export const inboxKey = (e: KeyEventLike): InboxKey | null => INBOX_KEYS.find((k) => matches(e, KEYS[k])) ?? null
/* ---------- end PST-297 ---------- */
/* ---------- PST-302: applications (PST-297's Inbox takes these as they are) ---------- */
// While an application waits on their decision there are no quiet rows or
// nudges (quietFor). Once its decision-by day has passed, one calm row asks Dev
// to update the status. An explicit next step stays its own due row, with its
// own date: waiting for the decision is never a next step.

export type DecisionPassedRow = { key: string; kind: 'decision_passed'; investorId: string; name: string; title: string; detail: string; due: string }

/** Applications still awaiting a decision after their decision-by day, the oldest first. Passed and parked investors are left out. */
export function decisionPassedRows(investors: readonly Pick<Investor, '_id' | 'name' | 'stage' | 'application'>[], today: string): DecisionPassedRow[] {
  return investors
    .filter((i) => i.stage !== 'passed' && i.stage !== 'parked' && isDecisionPassed(i.application, today))
    .sort((a, b) => a.application!.decisionBy!.localeCompare(b.application!.decisionBy!) || a.name.localeCompare(b.name))
    .map((i) => ({
      key: 'decision_passed:' + i._id, kind: 'decision_passed' as const, investorId: i._id, name: i.name,
      title: 'Decision date passed', detail: passedDetail(i.application!, today), due: i.application!.decisionBy!,
    }))
}

/** The Inbox's `awaiting` rows: calm, in Today, with no deadline of their own; "Update status" opens the drawer's Application row. */
function awaitingRows(src: InboxSources): Raw[] {
  const byId = new Map(src.investors.map((i) => [i._id, i]))
  return decisionPassedRows(src.investors, src.today).map((r) => {
    const a = byId.get(r.investorId)!.application!
    return {
      key: 'awaiting:' + r.investorId, type: 'awaiting', group: 'today', name: r.name, investorId: r.investorId,
      detail: r.title + ' · ' + r.detail, when: '', version: [a.status, a.decisionBy].join('|'), label: 'Update status', action: { kind: 'open' },
    }
  })
}
/* ---------- end PST-302 ---------- */
