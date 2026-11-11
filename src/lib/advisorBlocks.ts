// PST-307: the Advisor's interactive answer blocks (round6/advisor-interactive-blocks.png)
// and the tools that make them. Claude calls a show_* tool, or an action tool
// (create_draft, suggest_change, remember), with JSON; parseBlock checks it here
// before anything is stored, and the error goes back to Claude in words it can act
// on. convex/advisorSchema.ts stores the same shapes (vBlock). Pure (unit-tested).
import { isISODate } from './dates'
import { STAGE_KEYS, LABEL } from './stages'
import { APPLICATION_STATUSES } from './applications'
import { AI_DRAFT_TYPES, type AiDraftType } from './drafts'

export const DRAFT_KINDS = ['email', 'qa', 'story'] as const
export type DraftKind = (typeof DRAFT_KINDS)[number]
/** What suggest_change can propose. Each becomes a Suggestion, deduped like an agent's. */
export const CHANGE_KINDS = ['decide_by', 'stage', 'next_step', 'application'] as const
export type ChangeKind = (typeof CHANGE_KINDS)[number]
export const CHANGE_LABEL: Record<ChangeKind, string> = { decide_by: 'decide-by date', stage: 'stage', next_step: 'next step', application: 'application status' }

export type PlanItem = { text: string; date: string; investorId?: string }
export type Option = { label: string; upside: string; risk: string }
export type Beat = { label: string; text: string }

export type Block =
  | { kind: 'investor_card'; investorId: string; note?: string }
  | { kind: 'plan'; title?: string; items: PlanItem[]; ticked: number[] }
  | { kind: 'options'; question?: string; options: Option[]; picked?: number }
  | { kind: 'race'; investorIds: string[]; note?: string }
  | { kind: 'story'; title?: string; investorId?: string; beats: Beat[] }
  | { kind: 'blank'; label: string; unit?: string; why?: string; investorId?: string; value?: string; saved?: 'story' | 'plan' }
  | { kind: 'draft'; draftKind: DraftKind; title: string; subject?: string; body: string; question?: string; investorId?: string; draftType?: AiDraftType; draftId?: string; questionId?: string }
  | { kind: 'follow_ups'; questions: string[] }
  | { kind: 'suggestion'; investorId: string; change: ChangeKind; value?: string; date?: string; why: string; state: 'proposed' | 'sent' | 'not_added'; suggestionId?: string; note?: string }
  | { kind: 'memory'; fact: string; state: 'asked' | 'saved' | 'dismissed'; memoryId?: string }
export type BlockKind = Block['kind']

/** Blocks Dev acts on in place; an answer never has two of the same follow-ups. */
export const BLOCK_KINDS = ['investor_card', 'plan', 'options', 'race', 'story', 'blank', 'draft', 'follow_ups', 'suggestion', 'memory'] as const satisfies readonly BlockKind[]

/* ---------- the tools Claude is given ---------- */

type Prop = { type: string; description?: string; enum?: readonly (string | number)[]; maxLength?: number; minLength?: number; items?: Prop; minItems?: number; maxItems?: number; properties?: Record<string, Prop>; required?: readonly string[]; format?: string; additionalProperties?: boolean }
export type BlockTool = { name: string; description: string; input_schema: Prop }

const ID: Prop = { type: 'string', minLength: 1, maxLength: 64, description: 'An investor id from the read tools. Never make one up.' }
const DATE: Prop = { type: 'string', format: 'date', description: 'YYYY-MM-DD, India time.' }
const text = (max: number, description: string, min = 1): Prop => ({ type: 'string', minLength: min, maxLength: max, description })
const obj = (properties: Record<string, Prop>, required: string[]): Prop => ({ type: 'object', properties, required, additionalProperties: false })

/** Show-only tools: each draws one live block in the answer. None of them changes anything. */
export const SHOW_TOOLS: BlockTool[] = [
  {
    name: 'show_investor_card',
    description: 'Show one investor as a card Dev can open, move (that only suggests the move) or prep for. Use it when the answer is about one investor.',
    input_schema: obj({ investorId: ID, note: text(120, 'One short line under the name, e.g. “Can lead · 1st meeting Wed”.') }, ['investorId']),
  },
  {
    name: 'show_plan',
    description: 'Show a plan Dev can tick: 1–8 dated steps. A ticked step becomes that investor’s next step (Dev ticks it; you don’t). Give investorId on every step that is about one investor.',
    input_schema: obj(
      {
        title: text(80, 'A few words, e.g. “Kickoff week”.'),
        items: { type: 'array', minItems: 1, maxItems: 8, items: obj({ text: text(140, 'The step, as Dev would write it: “Book Lantern’s partner slot”.'), date: DATE, investorId: ID }, ['text', 'date']) },
      },
      ['items'],
    ),
  },
  {
    name: 'show_options',
    description: 'Show 2–3 ways to play a decision, each with its upside and its risk. Dev picks one and it is sent back to you as the next message.',
    input_schema: obj(
      {
        question: text(120, 'The decision, e.g. “Slow Juniper down, or take the offer?”.'),
        options: { type: 'array', minItems: 2, maxItems: 3, items: obj({ label: text(60, 'A few words: “Slow Juniper down”.'), upside: text(140, 'What it gets Dev.'), risk: text(140, 'What could go wrong.') }, ['label', 'upside', 'risk']) },
      },
      ['options'],
    ),
  },
  {
    name: 'show_race',
    description: 'Show the race at a glance (who is how far along this week) with a link to Pipeline › Race. Leave investorIds out for everyone in the race.',
    input_schema: obj({ investorIds: { type: 'array', maxItems: 5, items: ID }, note: text(120, 'One line, e.g. “Juniper is a stage ahead”.') }, []),
  },
  {
    name: 'show_story',
    description: 'Show a story arc Dev can reorder and edit: 2–8 beats (Hook, Problem, Insight, Proof, Why now, Ask…). Use [__] for every number Nest doesn’t have.',
    input_schema: obj(
      {
        title: text(80, 'What it’s for, e.g. “Lantern open”.'),
        investorId: ID,
        beats: { type: 'array', minItems: 2, maxItems: 8, items: obj({ label: text(20, 'HOOK, PROBLEM, INSIGHT, PROOF, WHY NOW, ASK…'), text: text(300, 'One or two sentences in Dev’s voice.') }, ['label', 'text']) },
      },
      ['beats'],
    ),
  },
  {
    name: 'show_blank',
    description: 'Ask Dev for one missing number, as a small form: what it is, why it matters. Use it for each [__] that matters most (at most two per answer).',
    input_schema: obj({ label: text(60, 'The number, e.g. “Week-8 retention”.'), unit: text(12, 'The unit: %, $, families…'), why: text(140, 'Why it matters here.'), investorId: ID }, ['label']),
  },
  {
    name: 'show_follow_ups',
    description: 'End every answer with 3–4 next questions Dev might ask, written for this answer (not generic).',
    input_schema: obj({ questions: { type: 'array', minItems: 3, maxItems: 4, items: text(80, 'A short question in Dev’s words.') } }, ['questions']),
  },
]

/** Tools that propose something. Nothing is sent or changed: a draft waits in Drafts or Q&A, a change waits for Dev's OK, a memory waits for Yes. */
export const ACTION_TOOLS: BlockTool[] = [
  {
    name: 'create_draft',
    description:
      'Write a draft. kind email: an email to an investor (recipient investor) or to the person who can introduce Dev (recipient introducer); it lands in Drafts, never sent. kind qa: an answer to an investor question, and kind story: a pitch line or story; both show with Save, which keeps them in Q&A. Write in Dev’s voice. Use [__] for every number Nest doesn’t have.',
    input_schema: obj(
      {
        kind: { type: 'string', enum: DRAFT_KINDS, description: 'email, qa or story.' },
        title: text(80, 'What it is, e.g. “Email to Sam asking for 2 intros” or “Lantern open”.'),
        investorId: ID,
        recipient: { type: 'string', enum: ['investor', 'introducer'], description: 'For an email: who it’s to.' },
        type: { type: 'string', enum: AI_DRAFT_TYPES, description: 'For an email to an investor: intro, followup, nudge, thanks, dataroom, decision or lead.' },
        subject: text(200, 'For an email: the subject line.'),
        question: text(300, 'For qa: the investor question it answers.'),
        body: text(6000, 'The text.'),
      },
      ['kind', 'title', 'body'],
    ),
  },
  {
    name: 'suggest_change',
    description:
      'Propose one change to an investor: decide_by (date), stage (value: a stage key), next_step (value: the step, date optional) or application (value: the status). Dev sees it as a card and sends it to Suggestions; nothing changes until Dev accepts it there.',
    input_schema: obj(
      {
        investorId: ID,
        kind: { type: 'string', enum: CHANGE_KINDS, description: 'What to change.' },
        value: { type: 'string', maxLength: 200, description: 'For stage: one of ' + STAGE_KEYS.join(', ') + '. For next_step: the step. For application: one of ' + APPLICATION_STATUSES.join(', ') + '.' },
        date: DATE,
        why: text(300, 'One plain sentence on why.'),
      },
      ['investorId', 'kind', 'why'],
    ),
  },
  {
    name: 'remember',
    description: 'Propose keeping one fact about the company or Dev’s preferences for later chats. Dev is asked “Remember this?” and it is kept only on Yes. Never for something already in Nest’s records.',
    input_schema: obj({ fact: text(300, 'The fact, in one sentence, e.g. “Dev prefers a call before sending the deck.”') }, ['fact']),
  },
]

export const BLOCK_TOOL_NAMES = new Set([...SHOW_TOOLS, ...ACTION_TOOLS].map((t) => t.name))

/* ---------- checking a call ---------- */

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
const bad = (error: string): { ok: false; error: string } => ({ ok: false, error })
type Raw = Record<string, unknown>

/** A trimmed string within its length, or undefined when optional and empty. Throws the error text. */
function str(a: Raw, k: string, max: number, required = false): string | undefined {
  const x = a[k]
  if (x === undefined || x === null || (x === '' && !required)) {
    if (required) throw k + ' is required'
    return undefined
  }
  if (typeof x !== 'string') throw k + ' must be text'
  const t = x.trim()
  if (!t && required) throw k + ' can’t be empty'
  if (t.length > max) throw k + ' is longer than ' + max + ' characters'
  return t || undefined
}
function date(a: Raw, k: string, required = false): string | undefined {
  const d = str(a, k, 10, required)
  if (d !== undefined && !isISODate(d)) throw k + ' must be a date like 2026-11-20'
  return d
}
function list(a: Raw, k: string, min: number, max: number): unknown[] {
  const x = a[k] ?? []
  if (!Array.isArray(x)) throw k + ' must be a list'
  if (x.length < min) throw k + ' needs at least ' + min
  if (x.length > max) throw k + ' takes at most ' + max
  return x
}
function only(a: Raw, keys: readonly string[]) {
  for (const k of Object.keys(a)) if (!keys.includes(k)) throw 'there’s no argument called “' + k.slice(0, 40) + '”'
}
const asObj = (x: unknown, what: string): Raw => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw what + ' must be an object'
  return x as Raw
}
const def = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T

/**
 * Check one block tool's input and turn it into the block it shows. Unknown
 * arguments, missing ones, wrong types, lengths, list sizes and dates are all
 * errors. Investor ids are only checked for shape here; Convex checks they exist.
 */
export function parseBlock(tool: string, input: unknown): Parsed<Block> {
  try {
    const a = asObj(input ?? {}, 'arguments')
    switch (tool) {
      case 'show_investor_card':
        only(a, ['investorId', 'note'])
        return { ok: true, value: def({ kind: 'investor_card' as const, investorId: str(a, 'investorId', 64, true)!, note: str(a, 'note', 120) }) }
      case 'show_plan': {
        only(a, ['title', 'items'])
        const items = list(a, 'items', 1, 8).map((x, i) => {
          const o = asObj(x, 'items[' + i + ']')
          only(o, ['text', 'date', 'investorId'])
          return def({ text: str(o, 'text', 140, true)!, date: date(o, 'date', true)!, investorId: str(o, 'investorId', 64) })
        })
        return { ok: true, value: def({ kind: 'plan' as const, title: str(a, 'title', 80), items, ticked: [] }) }
      }
      case 'show_options': {
        only(a, ['question', 'options'])
        const options = list(a, 'options', 2, 3).map((x, i) => {
          const o = asObj(x, 'options[' + i + ']')
          only(o, ['label', 'upside', 'risk'])
          return { label: str(o, 'label', 60, true)!, upside: str(o, 'upside', 140, true)!, risk: str(o, 'risk', 140, true)! }
        })
        return { ok: true, value: def({ kind: 'options' as const, question: str(a, 'question', 120), options }) }
      }
      case 'show_race': {
        only(a, ['investorIds', 'note'])
        const ids = list(a, 'investorIds', 0, 5).map((x, i) => {
          if (typeof x !== 'string' || !x.trim() || x.length > 64) throw 'investorIds[' + i + '] must be an investor id'
          return x.trim()
        })
        return { ok: true, value: def({ kind: 'race' as const, investorIds: ids, note: str(a, 'note', 120) }) }
      }
      case 'show_story': {
        only(a, ['title', 'investorId', 'beats'])
        const beats = list(a, 'beats', 2, 8).map((x, i) => {
          const o = asObj(x, 'beats[' + i + ']')
          only(o, ['label', 'text'])
          return { label: str(o, 'label', 20, true)!.toUpperCase(), text: str(o, 'text', 300, true)! }
        })
        return { ok: true, value: def({ kind: 'story' as const, title: str(a, 'title', 80), investorId: str(a, 'investorId', 64), beats }) }
      }
      case 'show_blank':
        only(a, ['label', 'unit', 'why', 'investorId'])
        return { ok: true, value: def({ kind: 'blank' as const, label: str(a, 'label', 60, true)!, unit: str(a, 'unit', 12), why: str(a, 'why', 140), investorId: str(a, 'investorId', 64) }) }
      case 'show_follow_ups': {
        only(a, ['questions'])
        const questions = list(a, 'questions', 3, 4).map((x, i) => {
          if (typeof x !== 'string' || !x.trim()) throw 'questions[' + i + '] must be text'
          if (x.trim().length > 80) throw 'questions[' + i + '] is longer than 80 characters'
          return x.trim()
        })
        return { ok: true, value: { kind: 'follow_ups', questions } }
      }
      case 'create_draft': {
        only(a, ['kind', 'title', 'investorId', 'recipient', 'type', 'subject', 'question', 'body'])
        const kind = str(a, 'kind', 10, true) as DraftKind
        if (!DRAFT_KINDS.includes(kind)) throw 'kind must be one of: ' + DRAFT_KINDS.join(', ')
        const investorId = str(a, 'investorId', 64)
        const recipient = str(a, 'recipient', 12)
        if (recipient && recipient !== 'investor' && recipient !== 'introducer') throw 'recipient must be investor or introducer'
        const type = str(a, 'type', 20) as AiDraftType | undefined
        if (type && !AI_DRAFT_TYPES.includes(type)) throw 'type must be one of: ' + AI_DRAFT_TYPES.join(', ')
        if (kind === 'email' && !investorId) throw 'an email needs investorId: the investor it’s to, or the one an introducer would introduce'
        const question = str(a, 'question', 300)
        if (kind === 'qa' && !question) throw 'a qa draft needs question: the investor question it answers'
        return {
          ok: true,
          value: def({
            kind: 'draft' as const, draftKind: kind, title: str(a, 'title', 80, true)!, subject: kind === 'email' ? str(a, 'subject', 200) : undefined, body: str(a, 'body', 6000, true)!,
            question, investorId, draftType: kind === 'email' ? (recipient === 'introducer' ? 'intro' : (type ?? 'followup')) : undefined,
          }),
        }
      }
      case 'suggest_change': {
        only(a, ['investorId', 'kind', 'value', 'date', 'why'])
        const change = str(a, 'kind', 20, true) as ChangeKind
        if (!CHANGE_KINDS.includes(change)) throw 'kind must be one of: ' + CHANGE_KINDS.join(', ')
        const raw = a.value
        const value = typeof raw === 'number' ? String(raw) : str(a, 'value', 200)
        const d = date(a, 'date')
        if (change === 'decide_by' && !d) throw 'decide_by needs date'
        if (change === 'stage' && !(value && (STAGE_KEYS as string[]).some((k) => k === value.toLowerCase() || LABEL[k as keyof typeof LABEL].toLowerCase() === value.toLowerCase()))) throw 'stage needs value: one of ' + STAGE_KEYS.join(', ')
        if (change === 'next_step' && !value) throw 'next_step needs value: the step'
        if (change === 'application' && !(value && (APPLICATION_STATUSES as readonly string[]).includes(value.toLowerCase().replace(/[\s-]+/g, '_')))) throw 'application needs value: one of ' + APPLICATION_STATUSES.join(', ')
        return { ok: true, value: def({ kind: 'suggestion' as const, investorId: str(a, 'investorId', 64, true)!, change, value, date: d, why: str(a, 'why', 300, true)!, state: 'proposed' as const }) }
      }
      case 'remember':
        only(a, ['fact'])
        return { ok: true, value: { kind: 'memory', fact: str(a, 'fact', 300, true)!, state: 'asked' } }
      default:
        return bad(tool + ' isn’t a block tool')
    }
  } catch (e) {
    return bad(typeof e === 'string' ? e : 'those arguments don’t fit')
  }
}

/** The investor ids a block names (Convex checks each exists before it's stored). */
export function blockInvestorIds(b: Block): string[] {
  switch (b.kind) {
    case 'investor_card':
    case 'suggestion':
      return [b.investorId]
    case 'plan':
      return b.items.flatMap((x) => (x.investorId ? [x.investorId] : []))
    case 'race':
      return b.investorIds
    case 'story':
    case 'blank':
    case 'draft':
      return b.investorId ? [b.investorId] : []
    default:
      return []
  }
}

/** One blank's value put into a story or draft: the first [__] after the label's words, else the first [__]. */
export function fillBlank(text: string, value: string): string {
  const i = text.indexOf('[__]')
  return i < 0 ? text : text.slice(0, i) + value.trim() + text.slice(i + 4)
}

/** A beat moved from one place to another (drag to reorder). */
export function moveBeat<T>(xs: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= xs.length || to >= xs.length) return [...xs]
  const out = [...xs]
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
}

/** The story as text, for Copy and for Save to Q&A. */
export const storyText = (beats: readonly Beat[]) => beats.map((b) => b.text).join('\n\n')

/**
 * Ticking a plan step: the investor's next step and its date become the step's
 * (saved through the investor's normal save), and `undo` is what puts back the
 * step that was there, for the toast's Undo.
 */
export function planStep(i: { nextStep: string; nextDate?: string }, item: Pick<PlanItem, 'text' | 'date'>) {
  return { set: { nextStep: item.text, nextDate: item.date }, undo: { nextStep: i.nextStep, nextDate: i.nextDate } }
}

/** The words of a blank's label that a beat would mention ("Week-8 retention" → week-8, retention). */
const labelWords = (label: string) => label.toLowerCase().split(/\s+/).filter((w) => w.length > 3)

/** Fill a blank into the line of this answer's story that mentions it (or its Q&A draft's first [__]). A unit already after the [__] isn't typed twice. */
export function fillInto(blocks: readonly Block[], label: string, value: string, unit?: string): { index: number; block: Block } | null {
  const words = labelWords(label)
  const put = (text: string) => {
    const after = text.slice(text.indexOf('[__]') + '[__]'.length)
    const v = value.trim()
    return fillBlank(text, unit && after.startsWith(unit) && v.endsWith(unit) ? v.slice(0, -unit.length).trim() : v)
  }
  for (let index = 0; index < blocks.length; index++) {
    const b = blocks[index]
    if (b.kind === 'story') {
      const open = b.beats.map((x, k) => ({ x, k })).filter(({ x }) => x.text.includes('[__]'))
      const hit = open.find(({ x }) => words.some((w) => x.text.toLowerCase().includes(w)))
      if (hit) return { index, block: { ...b, beats: b.beats.map((x, k) => (k === hit.k ? { ...x, text: put(x.text) } : x)) } }
    }
    if (b.kind === 'draft' && b.draftKind !== 'email' && b.body.includes('[__]')) return { index, block: { ...b, body: put(b.body) } }
  }
  return null
}
