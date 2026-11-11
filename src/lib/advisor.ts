// PST-307: the Advisor, a fundraising coach and storyteller chat (round6/advisor-*.png).
// What a chat and a message look like, the list's groups, the six starters, what a
// message should cost and the monthly cap, the "From:" chips and the ⌘J panel's
// "Looking at" line. Shared by Convex (convex/advisor.ts) and the UI. Pure (unit-tested).
import { cents } from './enrich'
import { pageLabel } from './feedback'
import { costOfRow, MODEL_INFO, OPUS, SONNET, type Model, type RunUsage } from './models'
import type { Block } from './advisorBlocks'

/** The code a refused send carries (a ConvexError's data.code), so the UI shows the cap notice with its link to Settings. */
export const ADVISOR_CAP = 'AdvisorCap'

export const ADVISOR_MODES = ['coach', 'storyteller'] as const
export type AdvisorMode = (typeof ADVISOR_MODES)[number]
export const MODE_LABEL: Record<AdvisorMode, string> = { coach: 'Coach', storyteller: 'Storyteller' }

/** The Advisor runs on Sonnet (the default) or Opus. */
export const ADVISOR_MODELS = [SONNET, OPUS] as const satisfies readonly Model[]
export type AdvisorModel = (typeof ADVISOR_MODELS)[number]
export const isAdvisorModel = (m: unknown): m is AdvisorModel => (ADVISOR_MODELS as readonly unknown[]).includes(m)
/** "Sonnet 5.5", as the chips and the answer's eyebrow say it. */
export const advisorModelName = (m: Model) => MODEL_INFO[m].name + ' 5.5'

export const MESSAGE_STATUSES = ['streaming', 'done', 'failed', 'stopped'] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

/** Settings › AI › Advisor, when the "ai" row doesn't say. */
export const ADVISOR_DEFAULTS = { model: SONNET as AdvisorModel, capUsd: 20, web: true }
export const MAX_CAP_USD = 500
export type AdvisorSettings = { model: AdvisorModel; capUsd: number; web: boolean }

export const MESSAGE_MAX = 4000
export const TITLE_MAX = 80
export const FACT_MAX = 300
/** Nest tool calls per answer (reads, drafts, suggestions and blocks together). After the last one it answers with what it has. */
export const MAX_TOOL_CALLS = 12
/** Earlier messages sent with each question. */
export const HISTORY_MESSAGES = 20
/** Investors and materials pinned to one chat with "+ Context". */
export const MAX_PINNED = 6

export type Pinned = { kind: 'investor' | 'material'; id: string; label: string }
/** What the ⌘J panel passes: the route and the investor or view open on it. */
export type ScreenContext = { path: string; view?: string; investorId?: string; investorName?: string }

/* ---------- sources: the "From:" chips ---------- */

export const SOURCE_KINDS = ['investor', 'notes', 'emails', 'signals', 'decision', 'calendar', 'round', 'plan', 'race', 'qanda', 'materials', 'network', 'inbox', 'memory', 'web'] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]
/** One thing an answer read. `label` is the chip's words, written where the read happens: "Lantern · enrichment", "Juniper · notes 12 Nov", "Race · kickoff week". */
export type Source = { kind: SourceKind; label: string; investorId?: string; url?: string }

/** Where a chip that isn't about one investor or a web page goes. */
export const SOURCE_ROUTE: Partial<Record<SourceKind, string>> = {
  round: '/raise/close', plan: '/raise/plan', race: '/raise/pipeline', qanda: '/raise/qanda', materials: '/raise/materials', network: '/raise/investors', inbox: '/raise/today', calendar: '/raise/today', memory: '/raise/settings',
}

/** "Juniper Seed" → "Juniper": chips name an investor by its first word. */
export const shortName = (name: string) => name.trim().split(/\s+/)[0] || name

/** One chip per source, web pages folded into "Web: N sources", at most eight. */
export function sourceChips(sources: readonly Source[]): { key: string; text: string; source: Source }[] {
  const seen = new Set<string>()
  const out: { key: string; text: string; source: Source }[] = []
  for (const s of sources) {
    if (s.kind === 'web') continue
    const key = s.kind + ':' + s.label
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ key, text: s.label, source: s })
  }
  const urls = [...new Set(sources.filter((s) => s.kind === 'web' && s.url).map((s) => s.url!))]
  if (urls.length) out.push({ key: 'web', text: 'Web: ' + urls.length + ' source' + (urls.length === 1 ? '' : 's'), source: { kind: 'web', label: 'Web', url: urls[0] } })
  return out.slice(0, 8)
}

/** Sources added up across an answer's tool calls, each once. */
export function addSources(into: Source[], more: readonly Source[]): Source[] {
  const key = (s: Source) => s.kind + ':' + (s.investorId ?? '') + ':' + (s.url ?? s.label)
  const have = new Set(into.map(key))
  for (const s of more) if (!have.has(key(s))) {
    have.add(key(s))
    into.push(s)
  }
  return into
}

/* ---------- the chat list ---------- */

export type ChatRow = { _id: string; title: string; pinned: boolean; model: Model; mode: AdvisorMode; updatedAt: number; createdAt: number; messageCount: number; totalCostUsd: number }

const IST_MS = 330 * 6e4
/** Monday 00:00 IST of the week `now` is in. */
export function weekStartIST(now: number): number {
  const local = new Date(now + IST_MS)
  const back = (local.getUTCDay() + 6) % 7
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - back) - IST_MS
}
/** The 1st of this month, 00:00 IST. */
export function monthStartIST(now: number): number {
  const local = new Date(now + IST_MS)
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - IST_MS
}

/** Pinned, This week (since Monday, IST) and Earlier, newest first; search keeps chats whose title has every word. */
export function groupChats<T extends Pick<ChatRow, 'title' | 'pinned' | 'updatedAt'>>(chats: readonly T[], now: number, query = ''): { key: 'pinned' | 'week' | 'earlier'; label: string; chats: T[] }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const found = chats.filter((c) => words.every((w) => c.title.toLowerCase().includes(w))).sort((a, b) => b.updatedAt - a.updatedAt)
  const week = weekStartIST(now)
  const groups = [
    { key: 'pinned' as const, label: 'Pinned', chats: found.filter((c) => c.pinned) },
    { key: 'week' as const, label: 'This week', chats: found.filter((c) => !c.pinned && c.updatedAt >= week) },
    { key: 'earlier' as const, label: 'Earlier', chats: found.filter((c) => !c.pinned && c.updatedAt < week) },
  ]
  return groups.filter((g) => g.chats.length)
}

/** "Sonnet · 14 msgs" under a chat in the list. */
export const chatListMeta = (c: Pick<ChatRow, 'model' | 'messageCount'>) => MODEL_INFO[c.model].name + ' · ' + c.messageCount + ' msg' + (c.messageCount === 1 ? '' : 's')

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** "Started Mon · Sonnet 5.5 · 14 messages · 9¢" (Storyteller chats say so first). */
export function chatHeadMeta(c: Pick<ChatRow, 'model' | 'mode' | 'messageCount' | 'totalCostUsd' | 'createdAt'>, now: number): string {
  const started = c.createdAt >= weekStartIST(now) ? 'Started ' + DAY_NAMES[new Date(c.createdAt + IST_MS).getUTCDay()] : null
  return [c.mode === 'storyteller' ? 'Storyteller' : started, advisorModelName(c.model), c.messageCount + ' message' + (c.messageCount === 1 ? '' : 's'), cents(c.totalCostUsd)].filter(Boolean).join(' · ')
}

/** A new chat's title: the first question, on one line, cut to fit. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > 60 ? line.slice(0, 59).trimEnd() + '…' : line || 'New chat'
}

/* ---------- the empty state ---------- */

export const STARTERS: readonly { title: string; sub: string; prompt: string; mode: AdvisorMode }[] = [
  { title: 'Plan my week', sub: 'Who first, what to ask, what to drop', prompt: 'Plan my week: who should I put first, what should I ask each of them, and what should I drop?', mode: 'coach' },
  { title: 'Who should lead?', sub: 'Ranked lead candidates and how to ask', prompt: 'Who should lead this round? Rank the candidates and tell me how to ask each one.', mode: 'coach' },
  { title: 'Tighten my story', sub: 'For one investor, in their words', prompt: 'Tighten my story for one investor, in the words they care about. Ask me which investor if it isn’t clear.', mode: 'storyteller' },
  { title: 'Prep my next meeting', sub: 'Their likely questions and your answers', prompt: 'Prep my next investor meeting: their likely questions and my best answers.', mode: 'coach' },
  { title: 'Handle a maybe', sub: 'Turn a soft yes into a decision', prompt: 'Help me handle a maybe: how do I turn a soft yes into a decision?', mode: 'coach' },
  { title: 'Check my terms', sub: 'Cap, tranche 2 and allocation trade-offs', prompt: 'Check my terms: the cap, tranche 2 and the allocation trade-offs.', mode: 'coach' },
]

/* ---------- cost: the estimate before sending, and the cap ---------- */

/**
 * One typical answer: about 6K tokens of instructions and tools (written to the
 * cache once, read from it after), three lookups of about 3K each re-read on
 * each turn, and a short answer. Storyteller writes about twice as much.
 * On Sonnet that's about 2¢, on Opus about 4¢ (6¢ for a story), matching
 * Settings › AI › Advisor's cost table (round6/settings-advisor.png).
 */
export const TYPICAL_ANSWER: Record<AdvisorMode, RunUsage> = {
  coach: { input: 4_000, output: 600, cacheRead: 12_000, cacheWrite: 2_000, webSearches: 0 },
  storyteller: { input: 4_000, output: 1_200, cacheRead: 12_000, cacheWrite: 2_000, webSearches: 0 },
}
/** A web search the estimate counts on when web search is on (most answers make none or one). */
export const WEB_SEARCHES_EXPECTED = 0.5
/** Answers on a model with stored usage before the estimate uses them. */
export const MIN_REAL_ANSWERS = 5

/** What the next answer should cost: the typical answer (or the average of real ones), plus the chat so far, plus web searches. */
export function estimateAnswer(o: { model: Model; mode: AdvisorMode; web: boolean; historyChars: number; real?: RunUsage | null; realCount?: number }): number {
  const base = o.real && (o.realCount ?? 0) >= MIN_REAL_ANSWERS ? o.real : TYPICAL_ANSWER[o.mode]
  const history = Math.round(o.historyChars / 4)
  return costOfRow({ ...base, input: base.input + history, webSearches: o.web ? Math.max(base.webSearches, WEB_SEARCHES_EXPECTED) : 0 }, o.model)
}

/** "≈ 2¢ · web on" next to Send. */
export const estimateLine = (usd: number, web: boolean) => '≈ ' + cents(usd) + ' · web ' + (web ? 'on' : 'off')

/** Whether a run may start: this month's spend plus the estimate must stay within the cap. */
export function capCheck(monthUsd: number, estimateUsd: number, capUsd: number): { ok: true } | { ok: false; message: string } {
  if (monthUsd + estimateUsd <= capUsd) return { ok: true }
  return {
    ok: false,
    message: 'This would go over the Advisor’s monthly cap (' + cents(monthUsd) + ' of ' + cents(capUsd) + ' used). Raise the cap in Settings › AI › Advisor, or wait for next month.',
  }
}

/** "$3.12 of $20" in the sidebar, and how full the bar is (0–100). */
export function monthLine(monthUsd: number, capUsd: number): { text: string; pct: number } {
  const usd = (n: number) => '$' + (Number.isInteger(n) ? String(n) : n.toFixed(2))
  return { text: usd(Math.round(monthUsd * 100) / 100) + ' of ' + usd(capUsd), pct: capUsd > 0 ? Math.min(100, Math.round((monthUsd / capUsd) * 100)) : 100 }
}

/** Settings › AI › Advisor's cost table (round6/settings-advisor.png): a quick question, a week's plan, a story on Opus, a web search. */
export function costTable(): { label: string; model: string; usd: [number, number] }[] {
  const q = estimateAnswer({ model: SONNET, mode: 'coach', web: false, historyChars: 0 })
  const plan = estimateAnswer({ model: SONNET, mode: 'coach', web: false, historyChars: 40_000 })
  const story = estimateAnswer({ model: OPUS, mode: 'storyteller', web: false, historyChars: 30_000 })
  return [
    { label: 'A quick question', model: 'Sonnet', usd: [q * 0.5, q * 1.5] },
    { label: 'Plan my week', model: 'Sonnet', usd: [plan, plan * 2] },
    { label: 'A story rewrite', model: 'Opus', usd: [story, story * 2.5] },
  ]
}
export const rangeLine = ([lo, hi]: [number, number]) => '≈ ' + Math.max(1, Math.round(lo * 100)) + '–' + Math.max(2, Math.round(hi * 100)) + '¢'

/* ---------- the ⌘J panel ---------- */

const VIEW_WORDS: Record<string, string> = { race: 'Race', maybes: 'Maybes', board: 'Board', network: 'Network', introducers: 'Introducers', allocation: 'Allocation', insights: 'Insights' }

/** "Pipeline › Race", "Investors › Lantern Ventures", "Home". */
export function lookingAt(c: ScreenContext): string {
  const page = pageLabel(c.path).replace(/^Raise › /, '')
  const view = c.view ? VIEW_WORDS[c.view] ?? c.view.charAt(0).toUpperCase() + c.view.slice(1) : null
  return [page, view, c.investorName].filter(Boolean).join(' › ')
}

/* ---------- a message ---------- */

export type AdvisorMessage = {
  _id: string
  chatId: string
  role: 'user' | 'assistant'
  text: string
  blocks: Block[]
  sources: Source[]
  model?: Model
  mode?: AdvisorMode
  costUsd: number
  status: MessageStatus
  error?: string
  /** The cap refused it: the answer says so, with the way to Settings. */
  capped?: boolean
  createdAt: number
}

/** The answer's eyebrow: "ADVISOR · SONNET 5.5", "· STORYTELLER" in that mode, "· WRITING…" while it streams. */
export function eyebrow(m: Pick<AdvisorMessage, 'model' | 'mode' | 'status'>): string {
  return ['Advisor', m.model ? advisorModelName(m.model) : null, m.mode === 'storyteller' ? 'Storyteller' : null, m.status === 'streaming' ? 'Writing…' : null].filter(Boolean).join(' · ')
}

/** Copy: the answer as plain text, with investor chips back to names. */
export const plainText = (text: string) => text.replace(/\[\[investor:[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').trim()

/** The blanks an answer left for Dev to fill: each [__] it wrote. */
export const BLANK = '[__]'
export const blankCount = (text: string) => text.split(BLANK).length - 1
