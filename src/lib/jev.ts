// PST-292: Jev, TypeSafe's System One model, for typed yes/no and pick-one
// decisions (docs.typesafe.ai). It never writes text: it answers questions about a
// piece of text (the state) with probabilities. Pure, shared by Convex (the client in
// convex/lib/jev.ts and the housekeeping in convex/jevHousekeeping.ts) and Settings › AI.
// The question builders here are exported for PST-293 (signals) and PST-296 (scoring).

export const JEV_MODEL = 'jev-latest'
export const JEV_API = 'https://api.typesafe.ai/v1/systemone'
/** Dollars per million input tokens (docs.typesafe.ai/models). Output tokens are free. */
export const JEV_PRICE_IN = 0.042
/** The monthly cap when Settings › AI hasn't set one. */
export const JEV_DEFAULT_CAP = 4
/** The most Settings › AI accepts as a monthly cap. */
export const JEV_MAX_CAP = 10
/** Context is 64K tokens a request and 32K a question; Nest keeps every state well under that. */
export const JEV_STATE_CHARS = 24_000

/** What each call is for (jevRuns.feature). PST-293 and PST-296 add theirs here. */
export const JEV_FEATURES = [
  'whos_this', 'unmatched_notes', 'duplicate_firms', 'qa_repeats',
  // PST-293: signals from emails and notes (src/lib/signals.ts).
  'email_signals', 'note_signals',
] as const
export type JevFeature = (typeof JEV_FEATURES)[number]

/* ---------- questions and answers (docs.typesafe.ai/primitives) ---------- */

export type ChoiceQuestion = { type: 'choice'; instructions: string; criteria: Record<string, string> }
export type ScoreQuestion = { type: 'score'; instructions: string; criteria: string[] }
export type NoulQuestion = { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
export type JevQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion

export type ChoiceAnswer = { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
export type ScoreAnswer = { type: 'score'; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number }
export type NoulAnswer = { type: 'noul'; noul: number }
export type JevAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer
export type AnswerOf<Q extends JevQuestion> = Q extends ChoiceQuestion ? ChoiceAnswer : Q extends ScoreQuestion ? ScoreAnswer : NoulAnswer
export type Answers<Q extends Record<string, JevQuestion>> = { [K in keyof Q]: AnswerOf<Q[K]> }

export const choice = (instructions: string, criteria: Record<string, string>): ChoiceQuestion => ({ type: 'choice', instructions, criteria })
export const score = (instructions: string, criteria: string[]): ScoreQuestion => ({ type: 'score', instructions, criteria })
export const noul = (instructions: string, criteria?: { true: string; false: string }): NoulQuestion => ({ type: 'noul', instructions, ...(criteria ? { criteria } : {}) })

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const probs = (x: unknown): x is Record<string, number> => !!x && typeof x === 'object' && Object.values(x).every(num)

/** Every question answered with the right type, or null (an answer Nest can't trust is no answer). */
export function readAnswers<Q extends Record<string, JevQuestion>>(questions: Q, raw: unknown): Answers<Q> | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, JevAnswer> = {}
  for (const [id, q] of Object.entries(questions)) {
    const a = (raw as Record<string, Record<string, unknown> | undefined>)[id]
    if (!a) return null
    if (q.type === 'noul' && num(a.noul)) out[id] = { type: 'noul', noul: a.noul }
    else if (q.type === 'choice' && typeof a.choice === 'string' && a.choice in q.criteria && probs(a.probabilities))
      out[id] = { type: 'choice', choice: a.choice, probabilities: a.probabilities, confidence: num(a.confidence) ? a.confidence : 0 }
    else if (q.type === 'score' && num(a.score) && probs(a.probabilities))
      out[id] = { type: 'score', score: a.score, legend: (a.legend ?? {}) as Record<string, string>, probabilities: a.probabilities, confidence: num(a.confidence) ? a.confidence : 0 }
    else return null
  }
  return out as Answers<Q>
}

/* ---------- cost and the cap ---------- */

export const jevCost = (inputTokens: number) => (inputTokens * JEV_PRICE_IN) / 1e6
/** Before a call: about four characters a token, for the state and the questions together. */
export const estimateTokens = (state: unknown, questions: unknown) => Math.ceil((JSON.stringify(state).length + JSON.stringify(questions).length) / 4)
/** A call that should cost `estimate` would take this month's spend past the cap. */
export const overCap = (spent: number, estimate: number, cap: number) => spent + estimate > cap

/** The sha256 the cache is keyed by: the model, the state and the questions, as sent. */
export async function jevHash(model: string, state: unknown, questions: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([model, state, questions]))
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Settings › AI's Jev row: set up (TYPESAFE_API_KEY), on, the cap and this month's spend. */
export type JevStatus = { connected: boolean; on: boolean; capUsd: number; monthUsd: number; calls: number; cached: number }
export const JEV_OFF: JevStatus = { connected: false, on: true, capUsd: JEV_DEFAULT_CAP, monthUsd: 0, calls: 0, cached: 0 }

/* ---------- name similarity (trigrams, counted the way Postgres pg_trgm does) ---------- */

function trigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (const w of s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const p = '  ' + w + ' '
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3))
  }
  return out
}

/** 0 to 1: the trigrams both share over all the trigrams of either. */
export function trigramSimilarity(a: string, b: string): number {
  const x = trigrams(a)
  const y = trigrams(b)
  if (!x.size || !y.size) return 0
  let shared = 0
  for (const t of x) if (y.has(t)) shared++
  return shared / (x.size + y.size - shared)
}

/** The `limit` items most similar to `text` (at least `min`), best first. */
export function mostSimilar<T>(text: string, items: readonly T[], textOf: (x: T) => string, limit: number, min: number): { item: T; similarity: number }[] {
  return items
    .map((item) => ({ item, similarity: trigramSimilarity(text, textOf(item)) }))
    .filter((x) => x.similarity >= min)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

/* ---------- thresholds ---------- */

export const THRESHOLDS = {
  /** Who's this?: below this, skip the Haiku lookup ("Probably not an investor"). */
  whoLikely: 0.3,
  /** Unmatched notes: attach when the top pick is at least this and the companion is below `noteNone`. */
  noteAttach: 0.9,
  noteNone: 0.3,
  /** Duplicate firms: only names at least this similar are asked about, and a Duplicate is suggested at `dupSame`. */
  dupSimilar: 0.6,
  dupSame: 0.8,
  dupCandidates: 5,
  /** Q&A repeats: the closest five (at least `qaSimilar`), marked "Same as …" at `qaSame` with the companion below `qaNone`. */
  qaCandidates: 5,
  qaSimilar: 0.2,
  qaSame: 0.85,
  qaNone: 0.3,
  /* ---------- PST-293: signals from emails and notes (src/lib/signals.ts) ---------- */
  /** A Choice whose top pick is at least this changes the decision on its own (and an ask makes an Inbox row). */
  signalChoice: 0.85,
  /** A Noul at least this is a sure yes, and at most `signalNo` a sure no. Anything between is a Decide row. */
  signalYes: 0.85,
  signalNo: 0.15,
  /* ---------- end PST-293 ---------- */
} as const

/** The option with the highest probability, and that probability. */
export function topPick(a: Pick<ChoiceAnswer, 'probabilities'>): { key: string; p: number } | null {
  let best: { key: string; p: number } | null = null
  for (const [key, p] of Object.entries(a.probabilities)) if (!best || p > best.p) best = { key, p }
  return best
}

/* ---------- the question builders ---------- */

/** Who's this?: what Jev reads about a new calendar attendee. Domains and the invite title only: no names, no email bodies. */
export type WhoState = { email_domain: string; invite_title: string; other_attendee_domains: string[]; domain_is_known_investor_firm: boolean }
export const whoQuestions = () => ({
  likely_investor: noul('This person is likely a venture investor or angel investor.'),
})
export const whoDecision = (likely: number): 'lookup' | 'skip' => (likely < THRESHOLDS.whoLikely ? 'skip' : 'lookup')

/** Unmatched notes: which of the meeting's investors the notes are about, and a companion Noul for none of them. */
export type NoteState = { meeting_title: string; date: string; investors: string[]; note: string }
export function noteQuestions(options: { key: string; label: string }[]) {
  return {
    investor: choice('Which investor in `investors` are the meeting notes in `note` about?', Object.fromEntries(options.map((o) => [o.key, o.label]))),
    none: noul('None of these investors in `investors` is the one the meeting notes in `note` are about.'),
  }
}
/** Attach to the top pick, or keep it in Unmatched with a "Probably …" hint. */
export function noteDecision(a: Answers<ReturnType<typeof noteQuestions>>): { attach: string } | { hint: string; p: number } | null {
  const top = topPick(a.investor)
  if (!top) return null
  if (top.p >= THRESHOLDS.noteAttach && a.none.noul < THRESHOLDS.noteNone) return { attach: top.key }
  return { hint: top.key, p: top.p }
}

/** Duplicate firms: one Noul per candidate, each about `record` and one of `others`. */
export type FirmRecord = { name: string; firm: string; type: string; domains: string[] }
export type DupState = { record: FirmRecord; others: FirmRecord[] }
export function duplicateQuestions(n: number): Record<string, NoulQuestion> {
  return Object.fromEntries(Array.from({ length: n }, (_, k) => ['same_' + k, noul('`record` and `others[' + k + ']` are records of the same investment firm.')]))
}
export const isDuplicate = (same: number) => same >= THRESHOLDS.dupSame

/** Q&A repeats: which of the closest questions the new one repeats, and a companion Noul for none of them. */
export type QaState = { new_question: string; existing: string[] }
export function qaQuestions(existing: string[]) {
  return {
    same_as: choice('Which question in `existing` asks the same thing as `new_question`?', Object.fromEntries(existing.map((t, k) => ['q' + k, t]))),
    none: noul('None of the questions in `existing` asks the same thing as `new_question`.'),
  }
}
/** The index in `existing` it repeats, or null. */
export function qaDecision(a: Answers<ReturnType<typeof qaQuestions>>): number | null {
  const top = topPick(a.same_as)
  if (!top || top.p < THRESHOLDS.qaSame || a.none.noul >= THRESHOLDS.qaNone) return null
  return Number(top.key.slice(1))
}
