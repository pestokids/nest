// PST-277: meeting notes become updates (screens/raise-ai/drawer-notes-read-by-nest.png).
// Claude reads a note with the investor's record and proposes a next step, a stage
// move, Expected, the questions they asked and warm paths. This file is the part
// that doesn't trust Claude: every item must quote the note, a stage move is only
// ever the next stage, Expected needs an amount that was actually said, and a
// question id must be one Nest sent. Pure, so Convex, the preview and the tests share it.
import { isISODate } from './dates'
import { addressesOf, dayOf, domainOf, GENERIC_DOMAINS, normEmail } from './google'
import { dayMonth } from './home'
import { money } from './money'
import { normFirm } from './suggestions'
import { IDX, STAGES, STAGE_SHORT, STAGE_TILE, type PipelineStage, type Stage } from './stages'

export const NOTE_SOURCES = ['paste', 'wispr', 'agent'] as const
export type NoteSource = (typeof NOTE_SOURCES)[number]
export const READ_STATUSES = ['reading', 'ready', 'applied', 'dismissed', 'failed'] as const
export type ReadStatus = (typeof READ_STATUSES)[number]

/** Claude's answer, as the prompt's JSON Schema asks for it (convex/lib/notesPrompt.ts holds the validator). */
export type NoteAnswer = {
  summary: string[]
  nextStep: { step: string; date: string | null; quote: string } | null
  stage: { to: string; quote: string } | null
  expected: { amount: number; quote: string } | null
  questions: { text: string; questionId: string | null; answer: string | null; answerQuote: string | null; quote: string }[]
  warmPaths: { text: string; quote: string }[]
}

export type NoteQuestion = { text: string; questionId?: string; answer?: string; quote: string }
/** One proposed update. `suggestionId` links it to its row in Suggestions; `clash` means Apply won't change anything. */
export type Proposal = { id: string; suggestionId?: string } & (
  | { kind: 'next_step'; step: string; date?: string; quote: string }
  | { kind: 'stage'; from: PipelineStage; to: PipelineStage; quote: string }
  | { kind: 'expected'; amount: number; quote: string; clash?: string }
  | { kind: 'questions'; items: NoteQuestion[] }
  | { kind: 'warm_path'; text: string; quote: string }
)
export type ProposalKind = Proposal['kind']
/** Open until it's applied or dropped, from the drawer or from Suggestions. */
export type ProposalState = 'open' | 'applied' | 'dropped'

export type NoteRead = {
  _id: string
  noteId: string
  investorId: string
  status: ReadStatus
  summary: string[]
  proposals: (Proposal & { state: ProposalState })[]
  costUsd: number
  error?: string
  startedAt: number
  finishedAt?: number
}

/** Notes that came in for nobody Nest could match ("Unmatched notes" on Today). */
export type UnmatchedNote = { _id: string; email?: string; meetingTitle: string; date: string; text: string; source: NoteSource; createdAt: number }
/** What "Draft from past answers" hands the Answer panel: the draft, what it cost, and how many answers and notes it read. */
export type Draft = { text: string; costUsd: number; from: number }

export const READ_LIMITS = { summary: 3, line: 200, step: 120, quote: 160, warm: 3, questions: 8 } as const

/* ---------- checking Claude's answer ---------- */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9$%'".,?!-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** True when `quote` is in the note (case, spacing and curly quotes aside). Under three letters never counts. */
export function quoteIn(note: string, quote: string | null | undefined): boolean {
  const q = norm(quote ?? '')
    .replace(/^["'\s]+|["'.,\s]+$/g, '')
    .trim()
  return q.length >= 3 && norm(note).replace(/"/g, '').includes(q.replace(/"/g, ''))
}

const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|lakhs|crore|crores|million|grand|k)\b/i
/** The quote says an amount: a digit, or a number word ("around fifty", "a lakh"). */
export const saidAmount = (quote: string) => /\d/.test(quote) || NUMBER_WORDS.test(quote)

/** The only stage a note can move a card to: the next one. Null at Money in, Passed or Parked. */
export function nextStage(stage: Stage): PipelineStage | null {
  const i = IDX[stage]
  return i === undefined || i + 1 >= STAGES.length ? null : STAGES[i + 1].k
}

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t
}
const bare = (s: string) => norm(s).replace(/[^a-z0-9]/g, '')
const same = (a: string, b: string) => bare(a) === bare(b)

export type ReadContext = {
  note: string
  investor: { stage: Stage; expected?: number; nextStep: string; nextDate?: string }
  /** The live questions in the bank Claude was shown. */
  bank: readonly { _id: string; text: string }[]
}

/**
 * Claude's answer as proposals Nest will show. Anything not backed by a quote
 * from the note is dropped, a stage move must be exactly the next stage,
 * Expected needs an amount in its quote, and question ids must be ones Nest
 * sent (or the same words as a question in the bank).
 */
export function proposalsFrom(a: NoteAnswer, c: ReadContext): { summary: string[]; proposals: Proposal[] } {
  const ok = (q: string | null | undefined) => quoteIn(c.note, q)
  const summary = a.summary.map((l) => clip(l, READ_LIMITS.line)).filter(Boolean).slice(0, READ_LIMITS.summary)
  const out: Proposal[] = []

  const n = a.nextStep
  if (n && n.step.trim() && ok(n.quote)) {
    const step = clip(n.step, READ_LIMITS.step)
    const date = n.date && isISODate(n.date) ? n.date : undefined
    if (!same(step, c.investor.nextStep) || date !== c.investor.nextDate)
      out.push({ id: 'next_step', kind: 'next_step', step, ...(date ? { date } : {}), quote: clip(n.quote, READ_LIMITS.quote) })
  }

  const s = a.stage
  const from = c.investor.stage
  const to = nextStage(from)
  if (s && to && s.to === to && ok(s.quote)) out.push({ id: 'stage', kind: 'stage', from: from as PipelineStage, to, quote: clip(s.quote, READ_LIMITS.quote) })

  const e = a.expected
  if (e && Number.isFinite(e.amount) && e.amount > 0 && ok(e.quote) && saidAmount(e.quote)) {
    const amount = Math.round(e.amount)
    if (c.investor.expected !== amount) out.push({ id: 'expected', kind: 'expected', amount, quote: clip(e.quote, READ_LIMITS.quote), ...expectedClash(c.investor.expected) })
  }

  const ids = new Set(c.bank.map((q) => q._id))
  const items: NoteQuestion[] = []
  for (const q of a.questions) {
    if (!q.text.trim() || !ok(q.quote)) continue
    const byId = q.questionId && ids.has(q.questionId) ? q.questionId : undefined
    const questionId = byId ?? c.bank.find((b) => same(b.text, q.text))?._id
    const key = questionId ?? bare(q.text)
    if (items.some((x) => (x.questionId ?? bare(x.text)) === key)) continue
    const answer = q.answer?.trim() && ok(q.answerQuote) ? clip(q.answer, 600) : undefined
    items.push({ text: clip(q.text, 300), ...(questionId ? { questionId } : {}), ...(answer ? { answer } : {}), quote: clip(q.quote, READ_LIMITS.quote) })
    if (items.length >= READ_LIMITS.questions) break
  }
  if (items.length) out.push({ id: 'questions', kind: 'questions', items })

  a.warmPaths
    .filter((w) => w.text.trim() && ok(w.quote))
    .slice(0, READ_LIMITS.warm)
    .forEach((w, i) => out.push({ id: 'warm_path:' + i, kind: 'warm_path', text: clip(w.text, 200), quote: clip(w.quote, READ_LIMITS.quote) }))

  return { summary, proposals: out }
}

/** Expected is only ever filled when empty; a different amount you typed stays, with a note. */
export const expectedClash = (current: number | undefined): { clash?: string } =>
  current ? { clash: `You wrote ${money(current)} as Expected. Applying won’t change it.` } : {}

/* ---------- how the card reads ---------- */

export const KIND_LABEL: Record<ProposalKind, string> = { next_step: 'Next step', stage: 'Stage', expected: 'Expected', questions: 'Q&A', warm_path: 'Warm path' }

/** Can be applied at all: never one that would change nothing. */
export const canApply = (p: Proposal) => !(p.kind === 'expected' && p.clash)
/** Pre-ticked: everything that can be applied but warm paths. */
export const startsTicked = (p: Proposal) => canApply(p) && p.kind !== 'warm_path'

/** A question in a few words: "keep the stories safe for a 4-year-old" from "How do you keep the stories safe for a 4-year-old?". */
const shortQuestion = (t: string) => {
  const s = t.replace(/\?\s*$/, '').replace(/^(how|what|why|when|where|which) (do|does|did|is|are|will|would|can) (you|it|they|we) /i, '')
  return clip(s.charAt(0).toLowerCase() + s.slice(1), 48)
}

/** The value column: "Send week-8 retention · Fri 20 Nov", "Booked → 1st meeting", "$50K (“around fifty”)". */
export function proposalText(p: Proposal): string {
  switch (p.kind) {
    case 'next_step':
      return p.step + (p.date ? ' · ' + dayMonth(p.date) : '')
    case 'stage':
      return `${STAGE_SHORT[p.from] ?? STAGE_TILE[p.from]} → ${STAGE_TILE[p.to]}`
    case 'expected':
      return `${money(p.amount)} (“${p.quote.replace(/^["“]+|["”]+$/g, '')}”)`
    case 'questions':
      return p.items.length === 1 ? p.items[0].text : `${p.items.length} questions: ${p.items.map((q) => shortQuestion(q.text)).join(', ')}`
    case 'warm_path':
      return p.text
  }
}

/** "Applied: next step, warm path" (the questions show as lines marked as questions). */
export function appliedLine(proposals: readonly (Proposal & { state: ProposalState })[]): string {
  const done = proposals.filter((p) => p.state === 'applied')
  const kinds = [...new Set(done.filter((p) => p.kind !== 'questions').map((p) => KIND_LABEL[p.kind].toLowerCase()))]
  if (kinds.length) return 'Applied: ' + kinds.join(', ')
  return done.length ? 'Applied: questions into the Q&A bank' : 'Nothing applied'
}

/** What a note shows: no read yet, Claude reading, proposals to review, done, or a failed read. */
export function readView(r: NoteRead | null | undefined): 'none' | 'reading' | 'review' | 'done' | 'failed' {
  if (!r) return 'none'
  if (r.status === 'reading') return 'reading'
  if (r.status === 'failed') return 'failed'
  if (r.status === 'ready' && (!r.proposals.length || r.proposals.some((p) => p.state === 'open' && canApply(p)))) return 'review'
  return 'done'
}

/** "From Wispr Flow · 32 min call with Sam Kapoor", "Pasted by Dev". */
export function noteFrom(n: { source?: NoteSource; by: string }, meeting?: { start: number; end: number; people: readonly { email: string; name?: string }[] } | null): string {
  const src = n.source === 'wispr' ? 'From Wispr Flow' : n.source === 'agent' ? 'From an agent' : `Pasted by ${n.by}`
  if (!meeting) return src
  const mins = Math.round((meeting.end - meeting.start) / 6e4)
  const names = meeting.people.map((p) => p.name?.trim()).filter((x): x is string => !!x)
  return [src, `${mins} min call${names.length ? ' with ' + names.slice(0, 2).join(' and ') : ''}`].join(' · ')
}

/* ---------- which investor a note is about ---------- */

type MatchInvestor = { _id: string; name: string; firm: string; email?: string; emails?: string[]; domains?: string[] }
type MatchMeeting = { _id: string; title: string; start: number; investorIds: readonly string[] }

const onlyOne = <T,>(xs: T[]): T | undefined => (xs.length && new Set(xs).size === 1 ? xs[0] : undefined)
const titleKey = (s: string) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * An incoming note's investor (Wispr Flow, an agent): by the address it names
 * (an investor's own, one of its people's, then its firm's domain), then by the
 * meeting with that title on that day, then by a title that names exactly one
 * investor. One clear answer or null ("Unmatched notes" on Today).
 */
export function matchNote(
  n: { email?: string; meetingTitle: string; date: string },
  investors: readonly MatchInvestor[],
  people: readonly { investorId: string; email?: string }[],
  meetings: readonly MatchMeeting[],
): { investorId: string; meetingId?: string } | null {
  const onDay = meetings.filter((m) => dayOf(m.start) === n.date)
  const titled = onDay.filter((m) => titleKey(m.title) === titleKey(n.meetingTitle))
  const found = (investorId: string | undefined) => {
    if (!investorId) return null
    const m = titled.find((x) => x.investorIds.includes(investorId)) ?? onDay.find((x) => x.investorIds.includes(investorId))
    return { investorId, ...(m ? { meetingId: m._id } : {}) }
  }

  const e = normEmail(n.email)
  if (e) {
    const byEmail = onlyOne([...investors.filter((i) => addressesOf(i).emails.includes(e)).map((i) => i._id), ...people.filter((p) => normEmail(p.email) === e).map((p) => p.investorId)])
    if (byEmail) return found(byEmail)
    const d = domainOf(e)
    if (!GENERIC_DOMAINS.has(d)) {
      const byDomain = onlyOne(investors.filter((i) => addressesOf(i).domains.includes(d)).map((i) => i._id))
      if (byDomain) return found(byDomain)
    }
  }
  const byMeeting = onlyOne(titled.flatMap((m) => (m.investorIds.length === 1 ? [m.investorIds[0]] : [])))
  if (byMeeting) return found(byMeeting)
  const t = ` ${titleKey(n.meetingTitle)} `
  const named = investors.filter((i) => [titleKey(normFirm(i.firm || i.name)), titleKey(i.name)].some((w) => w.length >= 3 && t.includes(` ${w} `)))
  return found(onlyOne(named.map((i) => i._id)))
}
