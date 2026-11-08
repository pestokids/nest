// PST-289: Home's Inbox preview. The top rows from Today's own lists (Waiting on
// you, Due today, Gone quiet and Suggested fixes) through one selector, so Home
// never has rules of its own. PST-297 swaps this for the real Inbox.
import { dayDiff } from './dates'
import { agoShort, waitingOnYou, type SyncedThread } from './google'
import { dueDate, dueList, quietFor, quietList, type Investor } from './pipeline'
import type { Suggestion } from './suggestions'
// PST-293
import { ASK_OR_DROP_CALLS, decideByLine, isDecideByPassed, undecided, type Decision } from './decisions'
import { ASK_LABEL, decideQuestion, type SignalChange, type SignalView } from './signals'
import { allPeople, firstName, hasDecided, NUDGE_AFTER, personKey, saidNo, waitingDays, type Intro, type IntroSources } from './introducers' // PST-294
import { addDays } from './today' // PST-294

export type InboxKind = 'reply' | 'due' | 'quiet' | 'review'
export type InboxRow = { key: string; kind: InboxKind; name: string; detail: string; investorId?: string }

export const INBOX_LABEL: Record<InboxKind, string> = { reply: 'Reply', due: 'Follow up', quiet: 'Nudge', review: 'Review' }

export type InboxSources = {
  investors: Investor[]
  threads: readonly SyncedThread[]
  /** Open suggestions, best first (as Today has them). */
  suggestions: readonly Pick<Suggestion, '_id' | 'investorId' | 'title'>[]
  quietDays: number
  today: string
  now: number
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/**
 * Every row, in Today's order: replies owed, then what's due (oldest first),
 * then who's gone quiet, then suggestions. An investor shows once, on their
 * first row. `total` counts them all; `rows` is the first `limit`.
 */
export function inboxPreview(src: InboxSources, limit = 4): { total: number; rows: InboxRow[] } {
  const byId = new Map(src.investors.map((i) => [i._id, i]))
  const seen = new Set<string>()
  const all: InboxRow[] = []
  const add = (row: InboxRow) => {
    if (row.investorId && row.kind !== 'review') {
      if (seen.has(row.investorId)) return
      seen.add(row.investorId)
    }
    all.push(row)
  }

  for (const t of waitingOnYou(src.threads, src.now)) {
    const i = byId.get(t.investorIds[0])
    if (!i) continue
    add({ key: 'reply:' + t._id, kind: 'reply', investorId: i._id, name: i.name, detail: `wrote ${agoShort(t.lastAt, src.now)}` })
  }
  for (const i of dueList(src.investors, src.today)) {
    const late = dayDiff(src.today, dueDate(i)!)
    const detail = i.stage === 'parked' ? 'back from parked' : late > 0 ? `${days(late)} over` : i.nextStep.trim() || 'due today'
    add({ key: 'due:' + i._id, kind: 'due', investorId: i._id, name: i.name, detail })
  }
  for (const i of quietList(src.investors, src.today, src.quietDays)) {
    const n = quietFor(i, src.today, src.quietDays)!
    add({ key: 'quiet:' + i._id, kind: 'quiet', investorId: i._id, name: i.name, detail: n === Infinity ? 'never touched' : `${days(n)} quiet` })
  }
  for (const s of src.suggestions) {
    const i = s.investorId ? byId.get(s.investorId) : undefined
    add({ key: 'review:' + s._id, kind: 'review', investorId: i?._id, name: i?.name ?? 'Suggested fix', detail: s.title })
  }
  return { total: all.length, rows: all.slice(0, limit) }
}

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
