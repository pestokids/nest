// PST-276: agents (Grok Bot, Claude, Capy) reading the raise through the Nest MCP
// server (convex/mcpHttp.ts) and suggesting changes. Shared by Convex and the
// Settings › Agents card: key scopes, the tools with their JSON Schemas (also what
// tool arguments are checked against), the Nest skill, and how a key reads in
// Settings. Pure functions (unit-tested).
import { isEmail } from './csv'
import { isISODate } from './dates'
import { LIMITS } from './qanda'
import { LABEL, STAGE_KEYS, STAGE_RULE, STAGE_TILE, TOUCH_PICK, type PipelineStage } from './stages'

export const AGENT_SCOPES = ['read', 'suggest'] as const
export type AgentScope = (typeof AGENT_SCOPES)[number]
export const SCOPE_LABEL: Record<AgentScope, string> = { read: 'Read only', suggest: 'Can suggest changes' }

/** Every key starts with this; the rest is 32 random bytes, base64url. */
export const KEY_PREFIX = 'nest_ak_'
/** How a stored key is shown: "nest_ak_7HQ2xK9p…". The stored prefix is the first 8 characters after nest_ak_. */
export const keyHint = (prefix: string) => `${KEY_PREFIX}${prefix}…`

/** About 60 calls a minute per key. */
export const RATE_LIMIT = 60
export const RATE_WINDOW_MS = 60_000
/** Activity shows this many calls. */
export const ACTIVITY_LIMIT = 50
export const NAME_MAX = 40

export const MCP_PATH = '/mcp'
export const SKILL_PATH = '/mcp/skill'
/** Production: nest.pestokids.com rewrites /mcp to the production Convex site (vercel.json). */
export const PROD_MCP_URL = 'https://nest.pestokids.com/mcp'

/* ---------- tools ---------- */

type Schema = {
  type?: 'object' | 'string' | 'integer' | 'number' | ('string' | 'number')[]
  description?: string
  enum?: readonly (string | number)[]
  minLength?: number
  maxLength?: number
  format?: 'email' | 'date'
  properties?: Record<string, Schema>
  required?: readonly string[]
  additionalProperties?: boolean
}
export type AgentTool = { name: string; title: string; description: string; scope: AgentScope; inputSchema: Schema }

const ID: Schema = { type: 'string', minLength: 1, maxLength: 64, description: 'The investor id from search_investors.' }
const STAGE_LIST = STAGE_KEYS.map((k) => `${k} (${LABEL[k]})`).join(', ')

export const AGENT_TOOLS: readonly AgentTool[] = [
  {
    name: 'search_investors',
    title: 'Search investors',
    scope: 'read',
    description:
      'Find investors in the raise. Returns each one’s id, name, firm, stage, wave, next step (with its date), last touch (the latest of a logged touch, an email and a past meeting) and priority (0–100, the Investors list’s Sort: Priority: fit × warmth × check size × recent activity). Leave the filters out to list everyone. At most 50 come back.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', maxLength: 100, description: 'Words to match in the name, firm or email address.' },
        stage: { type: 'string', enum: STAGE_KEYS, description: `Only investors at this stage: ${STAGE_LIST}.` },
        wave: { type: 'integer', enum: [1, 2, 3], description: 'Only this wave (wave 1 are the first people Dev talks to).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_investor',
    title: 'Get one investor',
    scope: 'read',
    description:
      'Everything Nest knows about one investor: their fields, people, recent history, email subjects (never bodies), meetings, the enrichment facts Dev kept, and the questions they asked (from the Q&A bank).',
    inputSchema: { type: 'object', properties: { id: ID }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'todays_moves',
    title: 'Today’s moves',
    scope: 'read',
    description:
      'What matters today (India time): next steps due today or late, conversations that have gone quiet, today’s meetings, and the three moves Nest suggests next. Start here for “who should I follow up with today?”.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_questions',
    title: 'Q&A bank',
    scope: 'read',
    description: 'The questions investors ask and Dev’s best answer to each, most asked first. A question with no answer yet says so.',
    inputSchema: {
      type: 'object',
      properties: { theme: { type: 'string', maxLength: 40, description: 'Only this theme, e.g. Traction, Business model, Market, Product, Team, Round or Competition.' } },
      additionalProperties: false,
    },
  },
  // PST-279: read helpers Ask Nest needed (and every agent gets).
  {
    name: 'round_totals',
    title: 'Round totals',
    scope: 'read',
    description:
      'The money in the round by how firm it is: soft circles (an Expected amount at 2nd meeting or diligence), verbal (said a number, SAFE not sent yet), SAFE sent, signed and wired, each with its investors and amounts. Also committed (verbal and later), the target and the stretch. “Verbal but not signed” is verbal plus SAFE sent.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'material_opens',
    title: 'Who opened what',
    scope: 'read',
    description:
      'Materials (pitch deck, memo, one-pager, model, data room) with their versions, and every link shared with an investor: which version, whether and when they opened it, how long they read and the page they read longest. Filter by words in the material, a version number or an investor. With a material, investorsWithoutLink lists investors in conversation who were never sent it. For “who hasn’t seen deck v4?”, read both the links not opened and investorsWithoutLink.',
    inputSchema: {
      type: 'object',
      properties: {
        material: { type: 'string', maxLength: 60, description: 'Words in the material’s title or kind, e.g. “deck” or “memo”.' },
        version: { type: 'integer', description: 'Only links to this version: 4 for deck v4.' },
        investorId: ID,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'meetings_between',
    title: 'Meetings in a time range',
    scope: 'read',
    description:
      'Calendar meetings with investors from one day to another (India time), past and upcoming: the meeting id, title, day, start and end time, which investors (ids and names) and whether notes from it are saved. Leave out to for one day. At most 31 days.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', format: 'date', description: 'The first day, YYYY-MM-DD in India time.' },
        to: { type: 'string', format: 'date', description: 'The last day, YYYY-MM-DD. Leave out for one day.' },
      },
      required: ['from'],
      additionalProperties: false,
    },
  },
  {
    name: 'log_touch',
    title: 'Log a touch',
    scope: 'suggest',
    description:
      'Suggest logging a call, email, meeting or note with an investor. Nothing changes until Dev accepts it in Suggestions. The note is what gets logged, so write it the way Dev would.',
    inputSchema: {
      type: 'object',
      properties: {
        investorId: ID,
        kind: { type: 'string', enum: TOUCH_PICK, description: 'What kind of touch it was.' },
        date: { type: 'string', format: 'date', description: 'The day it happened, YYYY-MM-DD in India time. Today or earlier.' },
        note: { type: 'string', minLength: 1, maxLength: 500, description: 'What happened, in plain words, e.g. “Called Asha, she wants the deck by Friday.”' },
      },
      required: ['investorId', 'kind', 'date', 'note'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_investor',
    title: 'Add an investor',
    scope: 'suggest',
    description:
      'Suggest adding someone to the investor list. Nothing changes until Dev accepts it; accepting creates the investor. Check search_investors first, so you don’t suggest someone who’s already there.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120, description: 'The person, or the fund if there’s no person yet.' },
        firm: { type: 'string', maxLength: 120, description: 'Their firm or fund. Empty for an angel.' },
        email: { type: 'string', format: 'email', maxLength: 254, description: 'Their email address, if you know it.' },
        note: { type: 'string', maxLength: 500, description: 'Why they belong on the list, or how Dev heard of them.' },
      },
      required: ['name', 'firm'],
      additionalProperties: false,
    },
  },
  {
    name: 'suggest_change',
    title: 'Suggest a change',
    scope: 'suggest',
    description:
      'Suggest a new stage, next step or expected amount for an investor. Nothing changes until Dev accepts it. stage: value is a stage key, and the stage rules must hold. next_step: value is the step, with an optional date. expected: value is the amount in US dollars the investor actually said, e.g. 50000.',
    inputSchema: {
      type: 'object',
      properties: {
        investorId: ID,
        kind: { type: 'string', enum: ['stage', 'next_step', 'expected'], description: 'What to change.' },
        value: { type: ['string', 'number'], maxLength: 200, description: `The new value. For a stage, one of: ${STAGE_LIST}.` },
        why: { type: 'string', minLength: 1, maxLength: 300, description: 'One plain sentence on why, e.g. “Kite Angels said around fifty on today’s call.”' },
        date: { type: 'string', format: 'date', description: 'For next_step only: when it’s due, YYYY-MM-DD.' },
      },
      required: ['investorId', 'kind', 'value', 'why'],
      additionalProperties: false,
    },
  },
  {
    name: 'enrich',
    title: 'Enrich',
    scope: 'suggest',
    description:
      'Start Nest’s web lookup of an investor (by id) or a person (by email): who they are and what their fund does. Pass exactly one of investorId and email. What it finds waits for Dev’s review. It counts towards the daily limit of automatic lookups.',
    inputSchema: {
      type: 'object',
      properties: { investorId: ID, email: { type: 'string', format: 'email', maxLength: 254, description: 'Their email address.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'add_meeting_notes',
    title: 'Add meeting notes',
    scope: 'suggest',
    description:
      'Save notes from a meeting with an investor (from Wispr Flow, or written up by you). Give investorId if you know it; otherwise Nest matches the notes by the investor’s email or the meeting title, and notes it can’t match wait in “Unmatched notes” for Dev. The notes are saved as they are. Nest then reads them, and every update it proposes waits in Suggestions for Dev.',
    inputSchema: {
      type: 'object',
      properties: {
        investorId: ID,
        email: { type: 'string', format: 'email', maxLength: 254, description: 'The investor’s email address, if you have it and not the id.' },
        meetingTitle: { type: 'string', minLength: 1, maxLength: 200, description: 'The meeting’s title, as on the calendar, e.g. “Pesto × Kite Angels”.' },
        date: { type: 'string', format: 'date', description: 'The day of the meeting, YYYY-MM-DD in India time. Today or earlier.' },
        text: { type: 'string', minLength: 1, maxLength: LIMITS.note, description: 'The notes, as written or dictated. Don’t summarise them.' },
        source: { type: 'string', enum: ['wispr', 'agent'], description: 'wispr for notes dictated in Wispr Flow; agent (the default) for notes you wrote.' },
      },
      required: ['meetingTitle', 'date', 'text'],
      additionalProperties: false,
    },
  },
]

/** The tools a key can see and call: read keys get the read tools only. */
export const toolsFor = (scope: AgentScope) => AGENT_TOOLS.filter((t) => scope === 'suggest' || t.scope === 'read')
export const toolNamed = (name: string) => AGENT_TOOLS.find((t) => t.name === name)

const fits = (want: NonNullable<Schema['type']>, x: unknown) =>
  (Array.isArray(want) ? want : [want]).some((w) => (w === 'number' ? typeof x === 'number' && Number.isFinite(x) : w === 'integer' ? Number.isInteger(x) : typeof x === w))
const typeWords = (t: NonNullable<Schema['type']>) => (Array.isArray(t) ? t.join(' or ') : t === 'integer' ? 'a whole number' : `a ${t}`)

/**
 * Check a tool's arguments against its inputSchema (the subset used above) and
 * trim strings. Optional arguments sent as null or "" count as left out. The
 * error names the first argument that's wrong, in words a model can act on.
 */
export function checkArgs(tool: AgentTool, args: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const s = tool.inputSchema
  const a = args ?? {}
  if (typeof a !== 'object' || Array.isArray(a)) return { ok: false, error: 'arguments must be an object' }
  const props = s.properties ?? {}
  for (const k of Object.keys(a)) if (!(k in props)) return { ok: false, error: `there’s no argument called “${k.slice(0, 40)}”` }
  const out: Record<string, unknown> = {}
  for (const [k, p] of Object.entries(props)) {
    const raw = (a as Record<string, unknown>)[k]
    const required = !!s.required?.includes(k)
    if (raw === undefined || raw === null || (raw === '' && !required)) {
      if (required) return { ok: false, error: `${k} is required` }
      continue
    }
    if (p.type && !fits(p.type, raw)) return { ok: false, error: `${k} must be ${typeWords(p.type)}` }
    const x = typeof raw === 'string' ? raw.trim() : raw
    if (typeof x === 'string') {
      if (p.minLength && x.length < p.minLength) return { ok: false, error: `${k} can’t be empty` }
      if (p.maxLength && x.length > p.maxLength) return { ok: false, error: `${k} is longer than ${p.maxLength} characters` }
      if (p.format === 'email' && !isEmail(x)) return { ok: false, error: `${k} must be an email address` }
      if (p.format === 'date' && !(isISODate(x) && new Date(x + 'T00:00:00Z').toISOString().startsWith(x))) return { ok: false, error: `${k} must be a date like 2026-11-07` }
    }
    if (p.enum && !p.enum.includes(x as string | number)) return { ok: false, error: `${k} must be one of: ${p.enum.join(', ')}` }
    out[k] = x
  }
  return { ok: true, value: out }
}

/** An amount the investor said: 50000, "50000", "$50,000", "50K", "1.2M". Null when it isn't a plain positive amount. */
export function parseAmount(x: string | number): number | null {
  if (typeof x === 'number') return Number.isFinite(x) && x > 0 && x < 1e10 ? Math.round(x) : null
  const m = /^\$?\s*(\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(x.replace(/,/g, '').trim())
  if (!m) return null
  const n = Number(m[1]) * (m[2] ? (m[2].toLowerCase() === 'k' ? 1e3 : 1e6) : 1)
  return n > 0 && n < 1e10 ? Math.round(n) : null
}

/* ---------- Activity ---------- */

const CALL_LABEL: Record<string, string> = {
  initialize: 'Connected',
  'server/discover': 'Connected',
  'tools/list': 'Listed the tools',
  ping: 'Checked the connection',
  notification: 'Sent a notification',
  search_investors: 'Searched investors',
  get_investor: 'Read an investor',
  todays_moves: 'Read today’s moves',
  list_questions: 'Read the Q&A bank',
  round_totals: 'Read the round totals',
  material_opens: 'Read who opened what',
  meetings_between: 'Read meetings',
  log_touch: 'Suggested a touch',
  add_investor: 'Suggested an investor',
  suggest_change: 'Suggested a change',
  enrich: 'Started a lookup',
  add_meeting_notes: 'Added meeting notes',
}
/** What a logged call did, in words. An empty tool is a call that never finished. */
export const callLabel = (tool: string) => CALL_LABEL[tool] ?? (tool ? 'Sent something Nest didn’t understand' : 'Didn’t finish')
/** Calls that count towards "41 calls this week": tool calls, not connecting or listing the tools. */
export const isToolCall = (tool: string) => !!toolNamed(tool)

/* ---------- how a key reads in Settings ---------- */

export type AgentKeyRow = { _id: string; name: string; scope: AgentScope; prefix: string; createdAt: number; lastUsedAt?: number; calls7d: number }
export type AgentCall = { _id: string; tool: string; at: number; ok: boolean; ms: number }
export type CreatedKey = { id: string; key: string; name: string; scope: AgentScope }

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Used 12 min ago", "Used 3h ago", "Used yesterday", "Used Nov 2", "Never used". dayOf gives the IST day of a time. */
export function lastUsedLine(lastUsedAt: number | undefined, now: number, dayOf: (ms: number) => string): string {
  if (!lastUsedAt) return 'Never used'
  const mins = Math.max(0, Math.floor((now - lastUsedAt) / 6e4))
  if (mins < 1) return 'Used just now'
  if (mins < 60) return `Used ${mins} min ago`
  const day = dayOf(lastUsedAt)
  if (day === dayOf(now)) return `Used ${Math.floor(mins / 60)}h ago`
  if (day === dayOf(now - 864e5)) return 'Used yesterday'
  const [, m, d] = day.split('-').map(Number)
  return `Used ${MONTHS[m - 1]} ${d}`
}
/** "GB" for Grok Bot; a one-word name takes its first letter and the next consonant: "CL" for Claude, "CP" for Capy. */
export function agentInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase()
  const w = words[0] ?? ''
  return (w[0] ?? '?').toUpperCase() + (/[^aeiou\W\d_]/i.exec(w.slice(1))?.[0] ?? w[1] ?? '').toUpperCase()
}

/** "Used 12 min ago · 41 calls this week". */
export function keyMeta(k: Pick<AgentKeyRow, 'lastUsedAt' | 'calls7d'>, now: number, dayOf: (ms: number) => string): string {
  const used = lastUsedLine(k.lastUsedAt, now, dayOf)
  return k.lastUsedAt ? `${used} · ${plural(k.calls7d, 'call')} this week` : used
}

/** The side card's "Agents can" list, and the one thing they never can. */
export const AGENTS_CAN = ['Read investors, history, meetings and the Q&A bank', 'Log a touch, add an investor and add meeting notes', 'Suggest stage moves, next steps and fixes'] as const
export const AGENTS_NEVER = 'Never send an email, move a stage or delete anything'

/* ---------- the Nest skill ---------- */

const STAGE_LINES = (Object.entries(STAGE_RULE) as [PipelineStage, string][]).map(([k, rule]) => `- **${STAGE_TILE[k]}** (\`${k}\`): ${rule}`).join('\n')

/** GET /mcp/skill, and the Copy buttons in Settings: a short guide for agents. */
export function nestSkill(serverUrl: string = PROD_MCP_URL): string {
  return `# Nest

Nest is Pesto's tracker for its pre-seed raise: every investor with their stage, next step and date, every touch, meetings and email subjects, and a Q&A bank of the questions investors ask with Dev's best answers. You reach it through the Nest MCP server at ${serverUrl}.

- Read: \`search_investors\`, \`get_investor\`, \`todays_moves\`, \`list_questions\`, \`round_totals\`, \`material_opens\`, \`meetings_between\`.
- Suggest (keys that can suggest changes): \`log_touch\`, \`add_investor\`, \`suggest_change\`, \`enrich\`, \`add_meeting_notes\`.
- For "who should I follow up with today?", start with \`todays_moves\`.

## Always suggest, never claim

Nothing you do changes Nest directly. Every write becomes a row in Dev's Suggestions queue, and Dev accepts or dismisses it.

- Say "I suggested…" or "it's waiting in Suggestions". Never say you updated, moved, logged or added something.
- \`enrich\` starts a lookup; what it finds also waits for Dev's review.
- \`add_meeting_notes\` saves the notes themselves on the investor; what Nest proposes from them waits in Suggestions.
- You can't send email, move a stage or delete anything.

## Stage rules

Suggest a stage only when its rule is true. Move one stage at a time, and when you're not sure, suggest a next step instead.

${STAGE_LINES}

## Numbers

Never invent numbers. Suggest an expected amount only when the investor said one, and say where it came from in \`why\`. If you don't know a number, say so.

## Writing

Write titles (\`why\` and \`note\`) in plain words, the way Dev would: one short sentence with names and facts, no jargon. "Kite Angels said around fifty on today's call", not "Updated expected investment based on conversation analysis".

Dates are YYYY-MM-DD in India time. Use the ids that \`search_investors\` returns.
`
}
