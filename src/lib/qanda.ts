// PST-281: the Q&A bank. The questions investors ask, the best answer to each,
// where each was asked, meeting notes and the prep brief. Pure, so Convex
// (convex/qanda.ts), the preview store and the UI share it, and it's unit-tested.
import { dayDiff } from './dates'
import { dayMonth } from './home'
import { weekday } from './investorView'
import { money } from './money'
import { matchScore } from './palette'
import type { Activity, Investor } from './pipeline'
import type { Material, MaterialVersion } from './materials'
import { STAGE_TILE, TOUCH_LABEL, type Stage } from './stages'
import type { NoteSource } from './meetingNotes'

export const THEMES = ['Traction', 'Business model', 'Market', 'Product', 'Team', 'Round', 'Competition'] as const
export const ASK_SOURCES = ['notes', 'manual', 'meeting'] as const
export type AskSource = (typeof ASK_SOURCES)[number]

/** The deck version to assume while Materials has no pitch deck. */
export const DECK_VERSION = 4
export const NEXT_DECK = DECK_VERSION + 1

/**
 * "Add to deck vN": the version after the pitch deck's current one in Materials
 * (the newest material of kind "deck"), or NEXT_DECK while there is no deck.
 */
export function nextDeck(materials: Pick<Material, 'kind' | 'currentVersionId' | 'createdAt'>[], versions: Pick<MaterialVersion, '_id' | 'n'>[]): number {
  const deck = materials.filter((m) => m.kind === 'deck' && m.currentVersionId).sort((a, b) => b.createdAt - a.createdAt)[0]
  const n = deck ? versions.find((x) => x._id === deck.currentVersionId)?.n : undefined
  return n === undefined ? NEXT_DECK : n + 1
}

export const LIMITS = { question: 300, answer: 4000, theme: 40, slide: 60, note: 20000, title: 60 } as const

/** One saved answer. The bank keeps every one, oldest first, the current one included. */
export type AnswerVersion = { text: string; at: number; by?: string }
export type Ask = {
  _id: string
  investorId: string
  /** IST day it was asked. */
  date: string
  source: AskSource
  noteId?: string
  noteLine?: number
  /** The note line it came from. */
  quote?: string
  /** The note's meeting, e.g. "1st meeting". */
  label?: string
}
export type Question = {
  _id: string
  text: string
  theme: string
  bestAnswer: string
  answerVersions: AnswerVersion[]
  /** e.g. "p8 · Pricing". */
  slideRef?: string
  onDeck: boolean
  askedCount: number
  /** On the deck-gaps list for this deck version. */
  deckGap?: { deck: number; at: number }
  createdAt: number
  updatedAt: number
  asks: Ask[]
  /** PST-292: Jev marked it the same as this question in the bank (Merge, or Not the same). */
  sameAs?: { id: string; text: string }
}
export type Note = {
  _id: string
  investorId: string
  meetingId?: string
  date: string
  text: string
  /** The meeting, e.g. "1st meeting". */
  title?: string
  /** First name of whoever pasted it ("Wispr Flow" when it came in through MCP). */
  by: string
  /** PST-277: pasted, Wispr Flow or an agent (absent: pasted). */
  source?: NoteSource
  _creationTime?: number
}

/* ---------- text ---------- */

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** The same question when only case and punctuation differ. */
export const sameText = (a: string, b: string) => !!norm(a) && norm(a) === norm(b)

/** A note line as a bank question: no bullet, number, "Q:" or quotes, and a capital first letter. */
export function cleanQuestion(line: string): string {
  const s = line
    .replace(/^\s*(?:[-*•–—>]+|\d+[.)]|q\s*\d*\s*[:.)-])\s*/i, '')
    .trim()
    .replace(/^["“”']+|["“”']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.question)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** A theme as typed: one space between words, a capital first letter, a built-in's own spelling. Empty when blank. */
export function cleanTheme(t: string): string {
  const s = t.replace(/\s+/g, ' ').trim().slice(0, LIMITS.theme)
  const built = THEMES.find((x) => x.toLowerCase() === s.toLowerCase())
  return built ?? s.charAt(0).toUpperCase() + s.slice(1)
}

/** The lines of a note worth picking: every line with words on it, by its index in the text. */
export function noteLines(text: string): { line: number; text: string }[] {
  return text
    .split(/\r?\n/)
    .map((t, line) => ({ line, text: t.trim() }))
    .filter((l) => /[a-z0-9]/i.test(l.text))
}

/** A line that reads like a question (ends with ? or opens like one). */
export const looksLikeQuestion = (line: string) =>
  /\?\s*["”']?\s*$/.test(line) || /^\s*(?:[-*•]\s*)?(?:q\s*[:.-]|how|what|why|who|when|where|which|would|will|can|could|do|does|did|is|are|have|has)\b/i.test(line)

const THEME_WORDS: [string, RegExp][] = [
  ['Competition', /\b(compet\w*|rivals?|versus|different from|incumbents?|moat|copy you)\b/i],
  ['Round', /\b(round|raise|raising|lead|board seat|valuation|cap table|terms|dilution|runway|who else|cheque|check size)\b/i],
  ['Team', /\b(team|founders?|hire|hiring|cto|ceo|co-?founders?|why you|background)\b/i],
  ['Traction', /\b(retention|traction|users?|growth|week-?\d+|dau|mau|churn|engagement|streaks?|metrics)\b/i],
  ['Business model', /\b(pay|paid|price|pricing|margins?|revenue|cac|ltv|unit economics|subscriptions?|monetis\w*|monetiz\w*|free)\b/i],
  ['Market', /\b(market|tam|families|reach|distribution|channels?|go to market|gtm|segment)\b/i],
]

/** A first theme for a new question, from its words (no AI). Product when nothing matches. */
export function guessTheme(text: string): string {
  return THEME_WORDS.find(([, re]) => re.test(text))?.[0] ?? 'Product'
}

/* ---------- the bank ---------- */

export const needsAnswer = (q: Pick<Question, 'bestAnswer'>) => !q.bestAnswer.trim()

/** The facts row: questions, notes from meetings, how many need an answer, how many are on a slide. */
export function facts(questions: readonly Question[], noteCount: number) {
  return {
    questions: questions.length,
    fromMeetings: noteCount,
    needAnswer: questions.filter(needsAnswer).length,
    onSlide: questions.filter((q) => q.onDeck).length,
  }
}

/** Every theme: the seven built-ins first, then custom ones in use, A to Z. */
export function allThemes(questions: readonly Pick<Question, 'theme'>[]): string[] {
  const custom = [...new Set(questions.map((q) => q.theme).filter((t) => t && !(THEMES as readonly string[]).includes(t)))].sort((a, b) => a.localeCompare(b))
  return [...THEMES, ...custom]
}

/** Filter chips: each theme with at least one question, and its count. */
export const themeChips = (questions: readonly Question[]) =>
  allThemes(questions)
    .map((theme) => ({ theme, n: questions.filter((q) => q.theme === theme).length }))
    .filter((c) => c.n > 0)

const latestAsk = (q: Question) => q.asks.reduce((m, a) => (a.date > m ? a.date : m), '')

/** "Need an answer": questions without an answer, the most recently asked first. */
export const unanswered = (questions: readonly Question[]) =>
  questions.filter(needsAnswer).sort((a, b) => latestAsk(b).localeCompare(latestAsk(a)) || b.createdAt - a.createdAt)

/** "Asked most": answered questions (of one theme, or all), most asked first. */
export const askedMost = (questions: readonly Question[], theme?: string | null) =>
  questions.filter((q) => !needsAnswer(q) && (!theme || q.theme === theme)).sort((a, b) => b.askedCount - a.askedCount || b.updatedAt - a.updatedAt)

/** Investors who asked, the latest first, once each. */
export function askerIds(q: Pick<Question, 'asks'>): string[] {
  return [...new Set([...q.asks].sort((a, b) => b.date.localeCompare(a.date)).map((a) => a.investorId))]
}

/** Earlier answers, newest first, without the current one or repeats. */
export function earlierAnswers(q: Pick<Question, 'answerVersions' | 'bestAnswer'>): AnswerVersion[] {
  const seen = new Set([q.bestAnswer.trim()])
  return [...q.answerVersions]
    .sort((a, b) => b.at - a.at)
    .filter((v) => {
      const t = v.text.trim()
      if (!t || seen.has(t)) return false
      seen.add(t)
      return true
    })
}

/** Slide references already in use, for the "Covered on" picker. */
export const slideRefs = (questions: readonly Pick<Question, 'slideRef'>[]) =>
  [...new Set(questions.map((q) => q.slideRef?.trim()).filter((s): s is string => !!s))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

const STOP = new Set('a an and are as at be by do does for from how i if in is it its of on or so that the their them they this to was we what when where which who why will with would you your'.split(' '))
const keyWords = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w)).map((w) => w.replace(/(?:ing|es|s)$/, '')))

/** Questions that look like this one in other words (shared key words), closest first. */
export function similarQuestions(q: Pick<Question, '_id' | 'text'>, all: readonly Question[], limit = 3): Question[] {
  const mine = keyWords(q.text)
  if (!mine.size) return []
  return all
    .filter((o) => o._id !== q._id)
    .map((o) => {
      const theirs = keyWords(o.text)
      const shared = [...mine].filter((w) => theirs.has(w)).length
      return { o, s: shared / (mine.size + theirs.size - shared || 1) }
    })
    .filter((x) => x.s >= 0.2)
    .sort((a, b) => b.s - a.s || b.o.askedCount - a.o.askedCount)
    .slice(0, limit)
    .map((x) => x.o)
}

/** ⌘K: questions whose wording or best answer matches, with a quote from the answer when that's where it matched. */
export function searchQuestions(questions: readonly Question[], query: string, limit = 4): { q: Question; quote?: string }[] {
  const qy = query.trim().toLowerCase()
  if (qy.length < 2) return []
  return questions
    .map((q) => {
      const byText = matchScore(q.text, query)
      const at = q.bestAnswer.toLowerCase().indexOf(qy)
      const byAnswer = at >= 0 ? 30 : matchScore(q.bestAnswer, query) * 0.5
      const quote = byAnswer > byText && at >= 0 ? quoteAround(q.bestAnswer, at, qy.length) : undefined
      return { q, s: Math.max(byText, byAnswer), quote }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.q.askedCount - a.q.askedCount)
    .slice(0, limit)
    .map(({ q, quote }) => ({ q, quote }))
}

function quoteAround(text: string, at: number, len: number) {
  const t = text.replace(/\s+/g, ' ')
  const from = Math.max(0, t.lastIndexOf(' ', Math.max(0, at - 20)) + 1)
  const to = Math.min(t.length, at + len + 28)
  return (from > 0 ? '…' : '') + t.slice(from, to).trim() + (to < t.length ? '…' : '')
}

/* ---------- labels ---------- */

/** "today", "yesterday", "Thu" within the week, else "5 Nov". */
export function relDay(date: string, today: string): string {
  const n = dayDiff(today, date)
  if (n === 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n > 1 && n <= 6) return weekday(date)
  return dayMonth(date).slice(4)
}

const SOURCE_LABEL: Record<AskSource, string> = { notes: 'meeting notes', manual: 'added by hand', meeting: 'a meeting' }

/** Where an ask came from: the note's meeting ("1st meeting"), else how it was added. */
export const askKind = (a: Pick<Ask, 'label' | 'source'>) => a.label ?? SOURCE_LABEL[a.source]

/** "Kite Angels · 1st meeting · yesterday". */
export const askLine = (a: Ask, name: string, today: string) => [name, askKind(a), relDay(a.date, today)].join(' · ')

/** Which meeting a note is from; the default follows the investor's stage. */
export const NOTE_TITLES = ['Intro call', '1st meeting', '2nd meeting', 'Diligence call', 'Call', 'Other'] as const
export function noteTitleFor(stage: Stage): string {
  if (stage === 'm1') return '1st meeting'
  if (stage === 'm2') return '2nd meeting'
  if (stage === 'dd') return 'Diligence call'
  if (stage === 'intro' || stage === 'booked' || stage === 'ask') return 'Intro call'
  return 'Call'
}

/* ---------- prep brief ---------- */

export type PrepPick = { q: Question; why: 'they' | 'similar' | 'most'; n: number }

/**
 * "Answers to have ready": the questions this investor asked (most first, and
 * the ones still without an answer before the rest), then the ones investors
 * of the same type asked, then the bank's most asked answered ones, up to `limit`.
 */
export function prepQuestions(investor: Pick<Investor, '_id' | 'type'>, investors: readonly Pick<Investor, '_id' | 'type'>[], questions: readonly Question[], limit = 4): PrepPick[] {
  const similar = new Set(investors.filter((i) => i._id !== investor._id && i.type === investor.type).map((i) => i._id))
  const scored = questions.map((q) => ({
    q,
    own: q.asks.filter((a) => a.investorId === investor._id).length,
    sim: q.asks.filter((a) => similar.has(a.investorId)).length,
  }))
  type Scored = (typeof scored)[number]
  const rank = (why: PrepPick['why'], xs: Scored[], n: (x: Scored) => number): PrepPick[] =>
    xs
      .sort((a, b) => n(b) - n(a) || Number(needsAnswer(b.q)) - Number(needsAnswer(a.q)) || b.q.askedCount - a.q.askedCount || b.q.updatedAt - a.q.updatedAt)
      .map((x) => ({ q: x.q, why, n: n(x) }))
  return [
    ...rank('they', scored.filter((x) => x.own > 0), (x) => x.own),
    ...rank('similar', scored.filter((x) => !x.own && x.sim > 0), (x) => x.sim),
    ...rank('most', scored.filter((x) => !x.own && !x.sim && x.q.askedCount > 0 && !needsAnswer(x.q)), (x) => x.q.askedCount),
  ].slice(0, limit)
}

/** "Who they are", from the investor record. */
export function whoTheyAre(i: Pick<Investor, 'name' | 'firm' | 'type' | 'expected' | 'path' | 'lead' | 'notes'>): string[] {
  const firm = i.firm && i.firm.trim().toLowerCase() !== i.name.trim().toLowerCase() ? ` at ${i.firm.trim()}` : ''
  const out = [`${i.type}${firm}.${i.expected ? ` Expected ${money(i.expected)}.` : ''}${i.lead ? ' Can lead or anchor.' : ''}`]
  const path = i.path.trim()
  if (path && !/^(cold|direct|applied)$/i.test(path)) out.push(`Warm path: ${path}.`)
  const note = i.notes.replace(/\s+/g, ' ').trim()
  if (note) {
    const two = note.match(/^.*?[.!?](?:\s|$)(?:.*?[.!?](?:\s|$))?/)?.[0]?.trim() || note
    out.push(two.length > 160 ? two.slice(0, 157).trimEnd() + '…' : two)
  }
  return out
}

export type Touch = { at: string; text: string }
const istDay = (ms: number) => new Date(ms + 330 * 6e4).toISOString().slice(0, 10)

/**
 * "Since last time": the latest touches, newest first. Logged touches and stage
 * moves (History), email threads, and meetings that have ended.
 */
export function lastTouches(
  acts: readonly Pick<Activity, 'kind' | 'stage' | 'note' | 'touch' | 'date' | '_creationTime'>[],
  threads: readonly { subject: string; lastAt: number; lastFrom: 'us' | 'them' }[],
  meetings: readonly { title: string; start: number; end: number }[],
  now: number,
  today: string,
  limit = 3,
): Touch[] {
  const rows: (Touch & { k: number })[] = [
    ...acts.map((a) => ({
      at: a.date,
      k: Date.parse(a.date + 'T12:00:00+05:30') + ((a._creationTime ?? 0) % 1e3),
      text: a.kind === 'stage' ? `Moved to ${STAGE_TILE[a.stage as Stage] ?? a.stage}` : `${a.touch ? TOUCH_LABEL[a.touch] : 'Note'}: ${a.note ?? ''}`,
    })),
    ...threads.map((t) => ({ at: istDay(t.lastAt), k: t.lastAt, text: `Email “${t.subject}”, ${t.lastFrom === 'them' ? 'they wrote last' : 'you wrote last'}` })),
    ...meetings.filter((m) => m.end <= now).map((m) => ({ at: istDay(m.start), k: m.start, text: `Meeting: ${m.title}` })),
  ]
  return rows
    .sort((a, b) => b.k - a.k)
    .slice(0, limit)
    .map(({ at, text }) => ({ at, text: `${text.trim().replace(/[.:\s]+$/, '')}. ${relDay(at, today).replace(/^./, (c) => c.toUpperCase())}.` }))
}

/** "In 40 min", "In 2 h", "Now", "Tomorrow" for the brief's eyebrow. */
export function startsIn(start: number, end: number, now: number, today: string): string {
  if (now >= end) return 'Ended'
  if (now >= start) return 'Now'
  if (istDay(start) !== today) return 'Tomorrow'
  const min = Math.round((start - now) / 6e4)
  return min < 60 ? `In ${Math.max(1, min)} min` : `In ${Math.round(min / 60)} h`
}
