// Suggested fixes (PST-275, screens/raise-ai/suggestions-all.png): the rule
// checks that spot mistakes and missing data in the investor list, and how the
// review queue reads. No AI here. Pure functions, shared by Convex
// (convex/suggestions.ts) and the ?preview data.
import { dayDiff } from './dates'
import { addressesOf, cleanDomains, dayOf, domainOf, GENERIC_DOMAINS, isOurs, normEmail } from './google'
import { dayLabel } from './investorView'
import { maxIdx } from './pipeline'
import { ACTIVE, COMMIT, IDX, LABEL, STAGE_TILE, STAGES, WARM, type InvestorType, type PipelineStage, type Stage, type TouchKind, type Warmth, type Wave } from './stages'
import { applicationChip, cleanApplication, sameApplication, type Application } from './applications' // PST-302
import { addDays } from './today'

// PST-276 adds new_investor (an agent's add_investor; accepting creates the investor).
// PST-277 adds question and warm_path (from meeting notes).
// PST-302 adds notes, outreach and application (agents, through suggest_change).
export const SUGGESTION_KINDS = ['stage', 'expected', 'missing_info', 'duplicate', 'next_step', 'question', 'warm_path', 'enrichment', 'touch', 'new_investor', 'notes', 'outreach', 'application'] as const
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number]
// PST-292 adds jev (Duplicate firms checked by Jev).
export const SUGGESTION_SOURCES = [
  'rule', 'calendar', 'gmail', 'notes', 'enrich', 'agent', 'jev',
  // PST-296: investors Dev added from Find more like these.
  'find_more',
] as const
export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number]
export const SUGGESTION_STATUSES = ['open', 'accepted', 'dismissed'] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

/** The change a suggestion makes when accepted. `merge` and `review` need a person (Merge, or the drawer). */
export type SuggestionPatch =
  | { op: 'stage'; from: Stage; to: Stage }
  | { op: 'next_step'; step: string; date?: string }
  | { op: 'expected'; amount: number }
  | { op: 'domain'; domain: string }
  | { op: 'touch'; touch: TouchKind; note: string; date?: string }
  // PST-296: Find more adds the wave, the type and the firm's domain.
  | { op: 'new_investor'; name: string; firm: string; email?: string; note?: string; wave?: Wave; type?: InvestorType; domain?: string }
  | { op: 'merge' }
  | { op: 'review' }
  // PST-277: questions from a meeting note into the Q&A bank, and a warm path onto the investor's notes.
  | { op: 'questions'; noteId: string; items: { text: string; questionId?: string; answer?: string; quote: string }[] }
  | { op: 'warm_path'; text: string }
  // PST-302: replace the notes or append a correction (`before`: the notes it was written against), the outreach labels, the application.
  | { op: 'notes'; mode: 'replace' | 'append'; text: string; before: string }
  | { op: 'outreach'; path?: string; warmth?: Warmth; source?: string }
  | ({ op: 'application' } & Application)

export type SuggestionDraft = {
  kind: SuggestionKind
  /** The investor it's about; for a duplicate, the one that's kept. */
  investorId?: string
  /** A duplicate's other card, the one merged in and deleted. */
  otherInvestorId?: string
  /** The "why" line. */
  title: string
  /** The "→ change" line. */
  fix: string
  patch: SuggestionPatch
  source: SuggestionSource
  agentName?: string
  safe: boolean
  /** Unique: a suggestion with this key is never created twice, so a dismissed one never comes back. */
  key: string
}
export type Suggestion = SuggestionDraft & { _id: string; status: SuggestionStatus; createdAt: number; decidedAt?: number }

/** Keys the rule checks own. Open rows with these keys are withdrawn when their rule stops firing; nothing else may use the prefix. */
export const CHECK_PREFIX = 'check:'

/* ---------- how the queue reads ---------- */

export const KIND_LABEL: Record<SuggestionKind, string> = {
  stage: 'Stage', expected: 'Expected', missing_info: 'Missing info', duplicate: 'Duplicate', next_step: 'Next step', question: 'Q&A', warm_path: 'Warm path', enrichment: 'Enrichment', touch: 'Touch',
  new_investor: 'New investor', notes: 'Notes', outreach: 'Outreach', application: 'Application',
}
const SOURCE_LABEL: Record<Exclude<SuggestionSource, 'agent'>, string> = { rule: 'Nest', calendar: 'Calendar', gmail: 'Gmail', notes: 'Meeting notes', enrich: 'Enrich', jev: 'Jev', find_more: 'Find more' }
/** "Calendar", "Grok Bot": shown as "From …". */
export const sourceLabel = (s: Pick<Suggestion, 'source' | 'agentName'>) => (s.source === 'agent' ? s.agentName?.trim() || 'an agent' : SOURCE_LABEL[s.source])

/** Filter chips: one per kind, and agents on their own ("From agents"), whatever kind they suggest. */
export type SuggestionFilter = 'all' | SuggestionKind | 'agents'
const FILTER_LABEL: Record<Exclude<SuggestionFilter, 'all'>, string> = {
  stage: 'Stage', expected: 'Expected', missing_info: 'Missing info', duplicate: 'Duplicates', next_step: 'Next steps', question: 'Q&A', warm_path: 'Warm paths', enrichment: 'Enrichment', touch: 'Touches', new_investor: 'New investors',
  notes: 'Notes', outreach: 'Outreach', application: 'Applications',
  agents: 'From agents',
}
export const filterOf = (s: Pick<Suggestion, 'kind' | 'source'>): Exclude<SuggestionFilter, 'all'> => (s.source === 'agent' ? 'agents' : s.kind)
export function filterChips(list: readonly Pick<Suggestion, 'kind' | 'source'>[]): { k: SuggestionFilter; label: string; n: number }[] {
  const n = (k: SuggestionFilter) => list.filter((s) => k === 'all' || filterOf(s) === k).length
  const kinds = ([...SUGGESTION_KINDS, 'agents'] as const).filter((k) => n(k) > 0)
  return [{ k: 'all', label: 'All', n: list.length }, ...kinds.map((k) => ({ k, label: FILTER_LABEL[k], n: n(k) }))]
}

/** What the row's main button does. */
export const actionOf = (s: Pick<Suggestion, 'patch'>): 'accept' | 'merge' | 'review' => (s.patch.op === 'merge' ? 'merge' : s.patch.op === 'review' ? 'review' : 'accept')

/** "Accept N safe ones": never a merge, a review (enrichment included) or anything from an agent. */
export const acceptsTogether = (s: Pick<Suggestion, 'safe' | 'source' | 'kind' | 'patch'>) =>
  s.safe && s.source !== 'agent' && s.kind !== 'enrichment' && actionOf(s) === 'accept'

/** Kind order (as in the design), then oldest first. */
export function sortSuggestions<T extends Pick<Suggestion, 'kind' | 'createdAt'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => SUGGESTION_KINDS.indexOf(a.kind) - SUGGESTION_KINDS.indexOf(b.kind) || a.createdAt - b.createdAt)
}

/** "Nothing changes until you accept. 4 are safe to accept together." */
export function safeLine(safe: number): string {
  if (!safe) return 'Nothing changes until you accept.'
  return `Nothing changes until you accept. ${safe === 1 ? '1 is safe to accept on its own' : `${safe} are safe to accept together`}.`
}
export const thingsToFix = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'} to fix`

/* ---------- the rule checks ---------- */

type CheckInvestor = {
  _id: string
  name: string
  firm: string
  stage: Stage
  maxStage: PipelineStage
  expected?: number
  committed?: number
  nextStep: string
  nextDate?: string
  email?: string
  emails?: string[]
  domains?: string[]
  _creationTime?: number
}
export type CheckInput = {
  investors: readonly CheckInvestor[]
  /** Stage moves (to find when a card reached Booked). */
  acts: readonly { investorId: string; kind: 'stage' | 'note'; stage?: Stage; date: string }[]
  meetings: readonly { title: string; start: number; end: number; people: readonly { email: string }[]; investorIds: readonly string[] }[]
  threads: readonly { subject: string; participants: readonly string[]; investorIds: readonly string[] }[]
  today: string
  now: number
}

/** Words stripped when comparing firm names. "Cap" covers the usual short form of Capital. */
const FIRM_WORDS = new Set(['capital', 'cap', 'ventures', 'vc', 'partners', 'fund', 'llp', 'llc'])
const words = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

/** "Better Capital" and "Better Cap." → "better": lowercase, no punctuation, no Capital, Ventures, VC, Partners, Fund, LLP, LLC. */
export function normFirm(s: string): string {
  const all = words(s)
  const core = all.filter((w) => !FIRM_WORDS.has(w))
  return (core.length ? core : all).join(' ')
}
const firmOf = (i: Pick<CheckInvestor, 'firm' | 'name'>) => i.firm.trim() || i.name.trim()

/** "today", "yesterday", "3 days ago", "on Mon 2 Nov". */
function ago(day: string, today: string): string {
  const n = dayDiff(today, day)
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n <= 6) return `${n} days ago`
  return `on ${dayLabel(day, today)}`
}

/** A next step per live stage, for an empty or long-overdue one. */
export const NEXT_STEP_DEFAULT: Partial<Record<Stage, string>> = {
  ask: 'Chase the intro',
  intro: 'Book the first call',
  booked: 'Send the deck before the call',
  m1: 'Send the follow-up and the data room',
  m2: 'Book the partner call',
  dd: 'Answer their diligence questions',
  verbal: 'Confirm the amount in writing',
  signed: 'Chase the wire',
}
/** A next step later than this many days gets a suggestion. */
export const OVERDUE_DAYS = 7

/** Five days out, moved off the weekend to the Monday. */
export function proposedDate(today: string): string {
  const d = addDays(today, 5)
  const wd = new Date(d + 'T00:00:00Z').getUTCDay()
  return wd === 6 ? addDays(d, 2) : wd === 0 ? addDays(d, 1) : d
}

/**
 * A firm domain for an investor with no addresses: from meetings and threads
 * whose title mentions the firm (or the person), the outside attendees' domains
 * that aren't personal mail, ours, or already someone else's. One clear answer
 * or nothing.
 */
function domainFor(i: CheckInvestor, input: CheckInput, taken: ReadonlySet<string>): { domain: string; from: 'calendar' | 'gmail' } | null {
  const needles = [...new Set([normFirm(firmOf(i)), words(i.name).join(' ')])].filter((n) => n.length >= 3)
  if (!needles.length) return null
  const mentions = (text: string) => {
    const t = ` ${words(text).join(' ')} `
    return needles.some((n) => t.includes(` ${n} `))
  }
  const found = new Map<string, 'calendar' | 'gmail'>()
  const add = (emails: readonly string[], from: 'calendar' | 'gmail') => {
    for (const raw of emails) {
      const e = normEmail(raw)
      if (!e || isOurs(e)) continue
      const d = cleanDomains([domainOf(e)])[0]
      if (d && !GENERIC_DOMAINS.has(d) && !taken.has(d) && !found.has(d)) found.set(d, from)
    }
  }
  for (const m of input.meetings) if (mentions(m.title)) add(m.people.map((p) => p.email), 'calendar')
  for (const t of input.threads) if (mentions(t.subject)) add(t.participants, 'gmail')
  if (found.size === 1) {
    const [[domain, from]] = [...found]
    return { domain, from }
  }
  // Several: only one that starts with the firm's name counts.
  const lead = normFirm(firmOf(i)).split(' ')[0]
  const named = [...found].filter(([d]) => lead && d.startsWith(lead))
  return named.length === 1 ? { domain: named[0][0], from: named[0][1] } : null
}

/**
 * Every suggestion the rules make right now, one per key:
 * - stage: a meeting with a Booked investor has happened since they were booked → the next stage (1st meeting), never further.
 * - missing_info: a live conversation with no email and no domain → a domain from a matching invite or thread, or a look in the drawer.
 * - duplicate: the same firm once normalised, or a shared domain → Merge into the furthest-along card.
 * - next_step: a live conversation with no next step, or one more than 7 days late → a default for its stage.
 * - expected: Verbal or later with no Expected (or Committed) amount → a look in the drawer.
 */
export function ruleSuggestions(input: CheckInput): SuggestionDraft[] {
  const { investors, today, now } = input
  const out = new Map<string, SuggestionDraft>()
  const push = (s: SuggestionDraft) => {
    const key = CHECK_PREFIX + s.key
    if (!out.has(key)) out.set(key, { ...s, key })
  }

  // Stage: a meeting has happened since they reached Booked.
  for (const i of investors) {
    if (i.stage !== 'booked') continue
    const since = input.acts
      .filter((a) => a.investorId === i._id && a.kind === 'stage' && a.stage === 'booked')
      .reduce<string | undefined>((d, a) => (!d || a.date > d ? a.date : d), undefined)
    const met = input.meetings
      .filter((m) => m.investorIds.includes(i._id) && m.end <= now && (!since || dayOf(m.start) >= since))
      .sort((a, b) => b.start - a.start)[0]
    if (!met) continue
    const to = STAGES[IDX.booked! + 1].k
    push({
      kind: 'stage', investorId: i._id, source: 'calendar', safe: true, key: `stage:${i._id}:booked`,
      title: `${i.name}: the 1st meeting happened ${ago(dayOf(met.start), today)}, but the card is still in Booked.`,
      fix: `Move to ${STAGE_TILE[to]}`,
      patch: { op: 'stage', from: 'booked', to },
    })
  }

  // Missing info: a live conversation nothing can match.
  const taken = new Set(investors.flatMap((i) => addressesOf(i).domains))
  for (const i of investors) {
    if (!ACTIVE.has(i.stage)) continue
    const a = addressesOf(i)
    if (a.emails.length || a.domains.length) continue
    const title = `${i.name} has no email or domain, so meetings and emails can’t match.`
    const found = domainFor(i, input, taken)
    if (found)
      push({
        kind: 'missing_info', investorId: i._id, source: found.from, safe: true, key: `missing_info:${i._id}:${found.domain}`, title,
        fix: `Add domain ${found.domain} (from ${found.from === 'calendar' ? 'a calendar invite' : 'an email thread'})`,
        patch: { op: 'domain', domain: found.domain },
      })
    else push({ kind: 'missing_info', investorId: i._id, source: 'rule', safe: false, key: `missing_info:${i._id}`, title, fix: 'Add their email or the firm’s domain', patch: { op: 'review' } })
  }

  // Duplicates: the same firm once normalised, or a shared domain. A group of more than two pairs each with the one kept.
  const parent = new Map(investors.map((i) => [i._id, i._id]))
  const root = (id: string): string => (parent.get(id) === id ? id : root(parent.get(id)!))
  const why = new Map<string, string>()
  const join = (a: string, b: string, reason: string) => {
    const [ra, rb] = [root(a), root(b)]
    if (ra !== rb) parent.set(rb, ra)
    why.set([a, b].sort().join('|'), reason)
  }
  const byFirm = new Map<string, string>()
  const byDomain = new Map<string, string>()
  for (const i of investors) {
    const f = normFirm(firmOf(i))
    if (f) {
      if (byFirm.has(f)) join(byFirm.get(f)!, i._id, 'firm')
      else byFirm.set(f, i._id)
    }
    for (const d of cleanDomains(i.domains)) {
      if (byDomain.has(d)) join(byDomain.get(d)!, i._id, `domain:${d}`)
      else byDomain.set(d, i._id)
    }
  }
  const groups = new Map<string, CheckInvestor[]>()
  for (const i of investors) groups.set(root(i._id), [...(groups.get(root(i._id)) ?? []), i])
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const [keep, ...rest] = [...g].sort((a, b) => maxIdx(b) - maxIdx(a) || (a._creationTime ?? 0) - (b._creationTime ?? 0) || a.name.localeCompare(b.name))
    for (const drop of rest) {
      const reason = why.get([keep._id, drop._id].sort().join('|')) ?? 'firm'
      const [a, b] = [firmOf(keep), firmOf(drop)]
      const title = reason.startsWith('domain:')
        ? `${keep.name} and ${drop.name} share the domain ${reason.slice(7)}.`
        : a !== b
          ? `${a} and “${b}” look like the same firm.`
          : keep.name !== drop.name
            ? `${keep.name} and ${drop.name} are both down as ${a}.`
            : `${keep.name} is on the list twice.`
      push({
        kind: 'duplicate', investorId: keep._id, otherInvestorId: drop._id, source: 'rule', safe: false, key: `duplicate:${[keep._id, drop._id].sort().join(':')}`,
        title, fix: `Merge into ${keep.name}, keeping both histories`, patch: { op: 'merge' },
      })
    }
  }

  // Next step: a live conversation with none, or one long overdue.
  for (const i of investors) {
    const step = NEXT_STEP_DEFAULT[i.stage]
    if (!ACTIVE.has(i.stage) || !step) continue
    const empty = !i.nextStep.trim()
    const late = !empty && i.nextDate ? dayDiff(today, i.nextDate) : 0
    if (!empty && late <= OVERDUE_DAYS) continue
    const date = proposedDate(today)
    push({
      kind: 'next_step', investorId: i._id, source: 'rule', safe: true,
      key: empty ? `next_step:${i._id}:${i.stage}` : `next_step:${i._id}:${i.stage}:${i.nextDate}`,
      title: empty ? `${i.name} is in ${STAGE_TILE[i.stage]} with no next step.` : `${i.name}’s next step is ${late} days late: “${i.nextStep.trim()}”.`,
      fix: `${empty ? 'Add' : 'Set'} “${step}” · ${dayLabel(date, today)}`,
      patch: { op: 'next_step', step, date },
    })
  }

  // Expected: Verbal or later with no amount.
  for (const i of investors) {
    if (!COMMIT.has(i.stage) || i.expected || i.committed) continue
    push({
      kind: 'expected', investorId: i._id, source: 'rule', safe: false, key: `expected:${i._id}`,
      title: `${i.name} is at ${STAGE_TILE[i.stage]} with no Expected amount.`, fix: 'Add the amount they said', patch: { op: 'review' },
    })
  }

  return [...out.values()]
}

/** Same fields, whatever their order (stored objects may come back with their keys sorted). */
const samePatch = (a: SuggestionPatch, b: SuggestionPatch) => {
  const flat = (p: SuggestionPatch) => JSON.stringify(Object.entries(p).filter(([, x]) => x !== undefined).sort(([x], [y]) => x.localeCompare(y)))
  return flat(a) === flat(b)
}

/**
 * What a run of the checks changes, given every stored suggestion (any status):
 * new keys are added (a key that exists in any status never is), open ones whose
 * wording moved are updated, and open check rows whose rule no longer fires are withdrawn.
 */
export function reconcile<R extends Pick<Suggestion, 'key' | 'status' | 'title' | 'fix' | 'patch' | 'source' | 'safe'> & { _id: string }>(rows: readonly R[], drafts: readonly SuggestionDraft[]) {
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const keys = new Set(drafts.map((d) => d.key))
  const add: SuggestionDraft[] = []
  const update: { id: R['_id']; draft: SuggestionDraft }[] = []
  for (const d of drafts) {
    const r = byKey.get(d.key)
    if (!r) add.push(d)
    else if (r.status === 'open' && (r.title !== d.title || r.fix !== d.fix || r.source !== d.source || r.safe !== d.safe || !samePatch(r.patch, d.patch)))
      update.push({ id: r._id, draft: d })
  }
  const withdraw: R['_id'][] = rows.filter((r) => r.status === 'open' && r.key.startsWith(CHECK_PREFIX) && !keys.has(r.key)).map((r) => r._id)
  return { add, update, withdraw }
}

/* ---------- confetti, once a day ---------- */

const TIDY_KEY = 'nest_tidy_confetti'
/** True the first time the list is cleared on a given day (on this device); records it. */
export function firstTidyToday(today: string, store: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try {
    if (!store || store.getItem(TIDY_KEY) === today) return false
    store.setItem(TIDY_KEY, today)
    return true
  } catch {
    return false
  }
}

/* ---------- PST-302: no-op checks and the new kinds' wording ---------- */

type PatchTarget = { stage: Stage; nextStep: string; nextDate?: string; expected?: number; notes: string; path: string; warmth: Warmth; source: string; application?: Application }
const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/** The notes once a notes patch is applied. */
export const notesAfter = (notes: string, p: Extract<SuggestionPatch, { op: 'notes' }>) =>
  p.mode === 'replace' ? p.text.trim() : [notes.trim(), p.text.trim()].filter(Boolean).join('\n\n')

/** The application once an application patch is applied: a programme or date it leaves out stays as it was. */
export function applicationAfter(cur: Application | undefined, p: Extract<SuggestionPatch, { op: 'application' }>): Application {
  return cleanApplication({ status: p.status, program: p.program ?? cur?.program, submittedOn: p.submittedOn ?? cur?.submittedOn, decisionBy: p.decisionBy ?? cur?.decisionBy })!
}

/** Only the outreach fields that would change. */
export function outreachChanges(i: Pick<PatchTarget, 'path' | 'warmth' | 'source'>, p: Extract<SuggestionPatch, { op: 'outreach' }>) {
  const out: { path?: string; warmth?: Warmth; source?: string } = {}
  if (p.path !== undefined && !same(p.path, i.path)) out.path = p.path.trim()
  if (p.warmth !== undefined && p.warmth !== i.warmth) out.warmth = p.warmth
  if (p.source !== undefined && !same(p.source, i.source)) out.source = p.source.trim()
  return out
}

/**
 * Why a suggestion would change nothing: the record already has that value.
 * Null when it would change something. Agents get this back instead of a new row.
 */
export function noOpReason(i: PatchTarget & { name: string }, p: SuggestionPatch): string | null {
  switch (p.op) {
    case 'stage':
      return i.stage === p.to ? i.name + ' is already at ' + LABEL[p.to] + '.' : null
    case 'next_step':
      return same(i.nextStep, p.step) && (i.nextDate ?? '') === (p.date ?? '') ? i.name + '’s next step is already “' + i.nextStep + '”' + (i.nextDate ? ' on ' + i.nextDate : '') + '.' : null
    case 'expected':
      return i.expected === p.amount ? i.name + '’s Expected is already ' + p.amount + '.' : null
    case 'notes':
      if (p.mode === 'replace') return i.notes.trim() === p.text.trim() ? i.name + '’s notes already say exactly that.' : null
      return i.notes.includes(p.text.trim()) ? i.name + '’s notes already include that.' : null
    case 'outreach':
      return Object.keys(outreachChanges(i, p)).length ? null : i.name + ' already has that warm path, warmth and source.'
    case 'application':
      return sameApplication(i.application, applicationAfter(i.application, p)) ? i.name + '’s application is already “' + applicationChip(i.application) + '”.' : null
    default:
      return null
  }
}

/** The "→ change" line for the new kinds. */
export function fixLine(p: Extract<SuggestionPatch, { op: 'notes' | 'outreach' | 'application' }>, cur?: Application): string {
  if (p.op === 'notes') return p.mode === 'replace' ? 'Replace the notes' : 'Add a correction to the notes'
  if (p.op === 'application') return 'Set the application to “' + applicationChip(applicationAfter(cur, p)) + '”'
  const bits = [p.path !== undefined ? 'warm path “' + p.path.trim() + '”' : '', p.warmth ? WARM[p.warmth].toLowerCase() : '', p.source !== undefined ? 'source “' + p.source.trim() + '”' : ''].filter(Boolean)
  return 'Set ' + bits.join(', ')
}

/** A notes suggestion's before and after, for the row's diff. Long notes are cut around the change. */
export function notesDiff(p: Extract<SuggestionPatch, { op: 'notes' }>, max = 280): { before: string; after: string; added: boolean } {
  const cut = (x: string, fromEnd = false) => (x.length <= max ? x : fromEnd ? '…' + x.slice(-max) : x.slice(0, max) + '…')
  if (p.mode === 'append') return { before: cut(p.before.trim(), true), after: cut(p.text.trim()), added: true }
  return { before: cut(p.before.trim()), after: cut(p.text.trim()), added: false }
}
