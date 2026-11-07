// PST-279: Ask Nest in ⌘K (screens/raise-ai/ask-nest.png). What a run looks like,
// how its answer reads (investor chips, action buttons) and the line under it.
// Claude cites investors as [[investor:<id>|Name]] and offers actions as
// [[action:open|prep|ask|<id>]] lines (convex/lib/ask.ts asks for both). Pure (unit-tested).
import { cents } from './enrich'

export const ASK_STATUSES = ['thinking', 'answering', 'done', 'failed'] as const
export type AskStatus = (typeof ASK_STATUSES)[number]
export type Sources = { investors: number; threads: number; meetings: number }
export type AskRun = { _id: string; question: string; status: AskStatus; text: string; tools: string[]; sources: Sources; costUsd: number; error?: string }

/** Read tool calls per question; after the last one Claude has to answer with what it has. */
export const MAX_TOOL_CALLS = 6
export const QUESTION_MAX = 300
/** What Claude says when the tools don't have it. */
export const DONT_KNOW = 'I don’t know from Nest’s data.'

/** The TRY chips. "deck vN" is the current pitch deck's version, when there is one. */
export function suggestedQuestions(deckVersion?: number): string[] {
  return ['How much is verbal but not signed?', 'Prep me for my 4pm', deckVersion ? `Who hasn’t seen deck v${deckVersion}?` : 'Who hasn’t seen the deck?']
}

const STEP: Record<string, string> = {
  search_investors: 'Searching investors',
  get_investor: 'Reading an investor',
  todays_moves: 'Reading today’s moves',
  list_questions: 'Reading the Q&A bank',
  round_totals: 'Adding up the round',
  material_opens: 'Checking who opened what',
  meetings_between: 'Reading the calendar',
}
/** The line while it works: what the latest tool is doing. */
export const workingLine = (tools: readonly string[]) => (STEP[tools[tools.length - 1]] ?? 'Thinking') + '…'

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const and = (xs: string[]) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : (xs[0] ?? ''))

/** "From 40 investors, 12 email threads and 3 meetings · 1¢". Parts with nothing are left out. */
export function sourcesLine(s: Sources, costUsd: number): string {
  const parts = [s.investors && plural(s.investors, 'investor'), s.threads && plural(s.threads, 'email thread'), s.meetings && plural(s.meetings, 'meeting')].filter((x): x is string => !!x)
  return (parts.length ? 'From ' + and(parts) : 'From Nest’s data') + ' · ' + cents(costUsd)
}

/* ---------- reading the answer ---------- */

export type Inline = { kind: 'text'; text: string } | { kind: 'bold'; text: string } | { kind: 'investor'; id: string; name: string }
export type AnswerBlock = { kind: 'p'; parts: Inline[] } | { kind: 'ol' | 'ul'; items: Inline[][] }
export const ACTION_KINDS = ['open', 'prep', 'draft', 'ask'] as const
export type AnswerAction = { kind: (typeof ACTION_KINDS)[number]; id: string }

const ACTION_RE = /\[\[action:(open|prep|draft|ask)\|([A-Za-z0-9_-]{1,64})\]\]/g
const INLINE_RE = /\[\[investor:([A-Za-z0-9_-]{1,64})\|([^\]\n]{1,120})\]\]|\*\*([^*\n]+)\*\*/g

/** Text with investor citations and **bold**. */
export function inline(text: string): Inline[] {
  const out: Inline[] = []
  let at = 0
  for (const m of text.matchAll(INLINE_RE)) {
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) })
    out.push(m[1] ? { kind: 'investor', id: m[1], name: m[2].trim() } : { kind: 'bold', text: m[3] })
    at = m.index + m[0].length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}

/**
 * The answer as paragraphs and lists, with its action lines taken out (at most
 * three, each once). While it streams, a half-written [[…]] at the end is held
 * back so a chip never shows as raw text.
 */
export function parseAnswer(text: string, streaming = false): { blocks: AnswerBlock[]; actions: AnswerAction[] } {
  let t = text.replace(/\r/g, '')
  if (streaming) {
    const open = t.lastIndexOf('[[')
    if (open >= 0 && t.indexOf(']]', open) < 0) t = t.slice(0, open)
    else if (t.endsWith('[')) t = t.slice(0, -1)
  }
  const actions: AnswerAction[] = []
  for (const m of t.matchAll(ACTION_RE)) {
    const a = { kind: m[1] as AnswerAction['kind'], id: m[2] }
    if (actions.length < 3 && !actions.some((x) => x.kind === a.kind && x.id === a.id)) actions.push(a)
  }
  t = t.replace(ACTION_RE, '')
  const blocks: AnswerBlock[] = []
  let para: string[] = []
  const endPara = () => {
    if (para.length) blocks.push({ kind: 'p', parts: inline(para.join(' ')) })
    para = []
  }
  for (const raw of t.split('\n')) {
    const line = raw.trim()
    const item = /^(\d+[.)]|[-•*])\s+(.*)$/.exec(line)
    const last = blocks[blocks.length - 1]
    if (!line) endPara()
    else if (item) {
      endPara()
      const kind = /\d/.test(item[1]) ? 'ol' : 'ul'
      if (last && last.kind === kind) last.items.push(inline(item[2]))
      else blocks.push({ kind, items: [inline(item[2])] })
    } else if (!para.length && last && last.kind !== 'p' && /^\s/.test(raw)) {
      const items = last.items
      items[items.length - 1] = [...items[items.length - 1], { kind: 'text', text: ' ' }, ...inline(line)]
    } else para.push(line)
  }
  endPara()
  return { blocks, actions }
}

/** The investor ids an answer cites (chips), in order, once each. */
export const citedIds = (text: string) => [...new Set([...text.matchAll(INLINE_RE)].filter((m) => m[1]).map((m) => m[1]))]
