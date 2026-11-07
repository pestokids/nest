// PST-285: Wispr Flow notes after investor meetings. The pure parts, shared by
// Convex (convex/wispr.ts) and Settings: building a tool's arguments from the
// input schema the server returned in tools/list (never from argument names
// written here), reading a meeting out of a tool result, matching search
// results to a calendar meeting, and the card's wording.

export const WISPR_CALLBACK_PATH = '/wispr/callback'
/** A meeting is fetched for once it ended this long ago (Wispr needs a moment to write the notes). */
export const SETTLE_MS = 10 * 6e4
/** The cron covers meetings that ended up to this many days ago, then stops trying. */
export const TRY_DAYS = 7
/** "Fetch past 30 days". */
export const BACKFILL_DAYS = 30
/** A search result is the meeting when it starts within this of the calendar event (and the title agrees). */
export const MATCH_MS = 15 * 6e4
export const EVERY_MIN = 15

export type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  format?: string
  description?: string
  minimum?: number
  maximum?: number
}
export type ToolDef = { name: string; description?: string; inputSchema?: JsonSchema }
export type ToolResult = { content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }

type Prop = { name: string; schema: JsonSchema; required: boolean }

const propsOf = (s: JsonSchema | undefined): Prop[] =>
  Object.entries(s?.properties ?? {}).map(([name, schema]) => ({ name, schema: schema ?? {}, required: !!s?.required?.includes(name) }))
const typeOf = (s: JsonSchema) => (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type) ?? 'string'
const key = (p: Prop) => p.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_')
/** Every required argument is filled (else the call can't be made). */
const complete = (schema: JsonSchema | undefined, args: Record<string, unknown>) => propsOf(schema).every((p) => !p.required || p.name in args)

/** The one string argument naming a thing by id: the name that says so, else the only required string. */
function idProp(schema: JsonSchema | undefined, hint: RegExp): Prop | null {
  const strings = propsOf(schema).filter((p) => typeOf(p.schema) === 'string')
  const named = strings.filter((p) => hint.test(key(p)))
  if (named.length === 1) return named[0]
  const required = strings.filter((p) => p.required)
  if (required.length === 1) return required[0]
  return named.find((p) => p.required) ?? null
}

const CALENDAR_ID = /(calendar|event).*id|^id$/
const MEETING_ID = /(meeting|recording|note).*id|^id$/

/** get_meeting_by_calendar_id's arguments for a calendar event id, or null when the schema has no place for it. */
export function calendarArgs(schema: JsonSchema | undefined, eventId: string): Record<string, unknown> | null {
  const p = idProp(schema, CALENDAR_ID)
  if (!p) return null
  const args = { [p.name]: eventId }
  return complete(schema, args) ? args : null
}

/** get_meeting's arguments for a meeting id from search results. */
export function meetingArgs(schema: JsonSchema | undefined, meetingId: string): Record<string, unknown> | null {
  const p = idProp(schema, MEETING_ID)
  if (!p) return null
  const args = { [p.name]: meetingId }
  return complete(schema, args) ? args : null
}

const isTo = (k: string) => /(^|_)(until|before|to|max|end|ends|latest)(_|$)/.test(k)
const isFrom = (k: string) => /(^|_)(since|after|from|min|start|starts|begin|earliest)(_|$)/.test(k)

/** A time in the shape the schema asks for: an ISO date or date-time string, or epoch seconds (milliseconds only when it says so). */
function timeValue(s: JsonSchema, ms: number, end: boolean): string | number {
  const t = typeOf(s)
  if (t === 'integer' || t === 'number') return /milli|\bms\b/i.test(s.description ?? '') ? ms : Math.floor(ms / 1000)
  if (s.format === 'date') return new Date(ms + (end ? 864e5 : 0)).toISOString().slice(0, 10)
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * search_meetings' arguments for a time window: the window goes into whatever
 * the schema calls its from and to (since/until, start_after/start_before…). A
 * required text query gets the meeting's title; an optional one is left out.
 * Null when the window has nowhere to go or a required argument can't be filled.
 */
export function searchArgs(schema: JsonSchema | undefined, w: { from: number; to: number; title: string }): Record<string, unknown> | null {
  const props = propsOf(schema)
  const times = props.filter((p) => ['string', 'integer', 'number'].includes(typeOf(p.schema)) && !/cursor|page|limit|offset|query/.test(key(p)))
  const to = times.find((p) => isTo(key(p)))
  const from = times.find((p) => p !== to && isFrom(key(p)))
  if (!from && !to) return null
  const args: Record<string, unknown> = {}
  if (from) args[from.name] = timeValue(from.schema, w.from, false)
  if (to) args[to.name] = timeValue(to.schema, w.to, true)
  const query = props.find((p) => p.required && typeOf(p.schema) === 'string' && /query|^q$|search|text|keyword/.test(key(p)))
  if (query) args[query.name] = w.title
  const limit = props.find((p) => !p.required && (typeOf(p.schema) === 'integer' || typeOf(p.schema) === 'number') && /limit|max_results|page_size|count/.test(key(p)))
  if (limit) args[limit.name] = Math.min(limit.schema.maximum ?? 25, 25)
  return complete(schema, args) ? args : null
}

/** What a tool returned: structured content, else the text parsed as JSON, else the text itself. Null for an error or nothing. */
export function resultData(r: ToolResult | null | undefined): unknown {
  if (!r || r.isError) return null
  if (r.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent
  const text = (r.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return { text }
  }
}

export type WisprMeeting = { id?: string; title?: string; start?: number; end?: number; notes: string }

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
const norm = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_')
const pick = (o: Obj, re: RegExp) => Object.keys(o).find((k) => re.test(norm(k)))
const str = (x: unknown) => (typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '')
/** Text from a string, or from an object's markdown, text or content. */
const body = (x: unknown): string => (typeof x === 'string' ? x.trim() : isObj(x) ? body(x.markdown ?? x.text ?? x.content ?? x.body) : '')
function when(x: unknown): number | undefined {
  if (typeof x === 'number' && Number.isFinite(x)) return x < 1e12 ? x * 1000 : x
  if (typeof x !== 'string') return undefined
  const ms = Date.parse(x)
  return Number.isNaN(ms) ? undefined : ms
}

/** One meeting out of a tool result (get_meeting, get_meeting_by_calendar_id, or one search result). */
export function readMeeting(data: unknown): WisprMeeting | null {
  if (!isObj(data)) return null
  const inner = pick(data, /^(meeting|recording)$/)
  const o = inner && isObj(data[inner]) ? { ...data, ...(data[inner] as Obj) } : data
  const idKey = pick(o, /^(meeting_id|recording_id|id)$/)
  const titleKey = pick(o, /^(title|name|meeting_title)$/)
  const startKey = pick(o, /^(start|start_time|started_at|start_at|starts_at|start_date_time|start_datetime)$/)
  const endKey = pick(o, /^(end|end_time|ended_at|end_at|ends_at|end_date_time|end_datetime)$/)
  const summary = body(o[pick(o, /^(summary|flow_summary)$/) ?? ''])
  const notes = body(o[pick(o, /^(content|notes|markdown|note)$/) ?? '']) || (Object.keys(o).length === 1 ? str(o.text) : '')
  const text = [summary ? `Summary\n${summary}` : '', notes ? (summary ? `Notes\n${notes}` : notes) : ''].filter(Boolean).join('\n\n')
  const id = idKey ? str(o[idKey]) : ''
  const title = titleKey ? str(o[titleKey]) : ''
  const start = startKey ? when(o[startKey]) : undefined
  const end = endKey ? when(o[endKey]) : undefined
  return { ...(id ? { id } : {}), ...(title ? { title } : {}), ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}), notes: text }
}

/** The meetings in a search result: the first list found (meetings, results, items…), or the result itself when it is one. */
export function readMeetings(data: unknown): WisprMeeting[] {
  const list = Array.isArray(data) ? data : isObj(data) ? (Object.values(data).find((v) => Array.isArray(v) && v.some(isObj)) as unknown[] | undefined) : undefined
  return (list ?? []).map(readMeeting).filter((m): m is WisprMeeting => !!m)
}

const words = (s: string) => new Set(s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1))
/** Titles agree: at least half the words of the shorter one are in the other. */
export function sameTitle(a: string, b: string) {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return false
  return [...x].filter((w) => y.has(w)).length / Math.min(x.size, y.size) >= 0.5
}

/** The search result that is this calendar meeting: starts within ±15 min and the title agrees (one without a title only when it's alone in that window). */
export function matchMeeting(found: readonly WisprMeeting[], m: { start: number; title: string }): WisprMeeting | null {
  const inTime = found.filter((f) => f.id && f.start !== undefined && Math.abs(f.start - m.start) <= MATCH_MS)
  const titled = inTime.filter((f) => f.title && sameTitle(f.title, m.title)).sort((a, b) => Math.abs(a.start! - m.start) - Math.abs(b.start! - m.start))
  if (titled.length) return titled[0]
  return inTime.length === 1 && !inTime[0].title ? inTime[0] : null
}

/* ---------- Settings ---------- */

export type WisprStatus = 'off' | 'connected' | 'reconnect'
export type WisprCardData = {
  status: WisprStatus
  /** The MCP URL last used, to prefill the field. */
  url?: string
  /** The server's host, shown on the connected card. */
  host?: string
  lastFetch?: { at: number; count: number }
  lastCheckAt?: number
  /** "Fetch past 30 days" is running. */
  fetching: boolean
  lastError?: string
  /** "Read meeting notes" is on (Settings › AI). */
  reads: boolean
}
export const WISPR_PREVIEW = ['off', 'connected', 'reconnect', 'fetching'] as const
export type WisprPreview = (typeof WISPR_PREVIEW)[number]

const ago = (ms: number, now: number) => {
  const min = Math.max(0, Math.round((now - ms) / 6e4))
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}
const noteCount = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`

/** "Last fetched 2 h ago · 3 notes", or what it says before any note came in. */
export function fetchedLine(c: Pick<WisprCardData, 'lastFetch' | 'lastCheckAt'>, now: number) {
  if (c.lastFetch) return `Last fetched ${ago(c.lastFetch.at, now)} · ${noteCount(c.lastFetch.count)}`
  return c.lastCheckAt ? `No notes yet · last checked ${ago(c.lastCheckAt, now)}` : 'No notes yet'
}

/** The pasted URL if it can be an MCP server: https, no credentials; a trailing slash is dropped (Wispr Flow's sign-in won't start with one). */
export function cleanUrl(raw: string): string | null {
  const s = raw.trim().replace(/\/+$/, '')
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' || u.username || u.password) return null
    return s
  } catch {
    return null
  }
}

/** What `?wisprConnect=<result>` (the sign-in callback's redirect) means, as a toast. */
export function wisprConnectMessage(r: string | null): { tone: 'info' | 'error'; message: string } | null {
  switch (r) {
    case 'ok':
      return { tone: 'info', message: 'Wispr Flow connected. Fetching notes from the last 7 days.' }
    case 'denied':
      return { tone: 'error', message: 'Wispr Flow wasn’t connected: access wasn’t allowed.' }
    case 'expired':
      return { tone: 'error', message: 'That took too long. Try Connect again.' }
    case 'nokey':
      return { tone: 'error', message: 'Wispr Flow can’t be connected yet: the server is missing GOOGLE_TOKEN_KEY. Nothing was stored.' }
    case 'error':
      return { tone: 'error', message: 'Couldn’t connect Wispr Flow. Try again.' }
    default:
      return null
  }
}
