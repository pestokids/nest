// PST-274: a small client for the Anthropic Messages API over fetch (no SDK), for
// research with the web search and web fetch server tools, and (PST-277) plain
// turns with no tools for reading meeting notes and drafting answers, and (PST-279) turns
// with Nest's own read tools for Ask Nest. It streams, so a run
// can report progress while Claude works, and prices every run from its usage.
// PST-273: every call names its model (Settings › AI picks it; src/lib/models.ts has the prices).
// The key is ANTHROPIC_API_KEY in the Convex env; nothing here logs it or puts it in an error.
import { costOf, HAIKU, OPUS, SONNET, type Model, type Usage } from '../../src/lib/models'

export { AI_MODEL, costOf, HAIKU, OPUS, PRICES, SONNET, usageRow, type Model, type RunUsage, type Usage } from '../../src/lib/models'

const API = 'https://api.anthropic.com/v1/messages'
/** The current API version (docs.claude.com/en/api/versioning). Server tools need no beta header on it. */
const VERSION = '2026-10-21'

/**
 * Server tools (docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool and …/web-fetch-tool).
 * Every result is read again on each later step of the run, so these limits set most of a run's tokens.
 */
export const TOOLS = [
  { type: 'web_search_20260318', name: 'web_search', max_uses: 4 },
  { type: 'web_fetch_20260318', name: 'web_fetch', max_uses: 3, max_content_tokens: 8000 },
]

/** ANTHROPIC_API_KEY isn't set (Vercel previews): the UI says "AI isn't set up here" instead of failing. */
export class NoAIKey extends Error {
  readonly code = 'NoAIKey'
  constructor() {
    super('AI isn’t set up here: ANTHROPIC_API_KEY is not set.')
  }
}

/**
 * Anything else the API refused or broke on. Never includes the key or the request.
 * `reason` is short and safe to log: the stop reason or what was wrong with an
 * answer (status 200), else the API's error type.
 */
export class AIError extends Error {
  constructor(
    public status: number,
    what: string,
    public reason = 'unknown',
  ) {
    super('Claude ' + what + ' (' + status + ')')
  }
}

/** A caught AI error for the log line: its class and short reason (`AIError reason=max_tokens`, `AIError status=400 type=invalid_request_error`). Never the prompt or the answer. */
export function errorTag(e: unknown): string {
  if (e instanceof AIError) return 'AIError ' + (e.status === 200 ? 'reason=' + e.reason : 'status=' + e.status + ' type=' + e.reason)
  return e instanceof Error ? e.constructor.name || e.name : typeof e
}

export type Thinking = { type: 'adaptive' } | { type: 'disabled' } | { type: 'between_tools' }

/**
 * How each model is told not to think before answering
 * (platform.claude.com/docs/en/build-with-claude/thinking). Haiku 5.5 thinks by
 * default and takes "disabled"; Sonnet 5.5 refuses "disabled" and takes
 * "between_tools" instead; Opus 5.5 always thinks and refuses both, so it's left unset.
 */
export const NO_THINKING: Record<Model, Thinking | undefined> = {
  [HAIKU]: { type: 'disabled' },
  [SONNET]: { type: 'between_tools' },
  [OPUS]: undefined,
}

export const hasAIKey = () => !!process.env.ANTHROPIC_API_KEY?.trim()

/** A system prompt marked for the cache: the tools come before it, so a run's later turns read the tools and the system prompt from the cache. */
const cachedSystem = (text: string) => [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]

/** Two requests' usage added up (a turn that paused and went on). */
export function addUsage(a: Usage, b: Usage): Usage {
  const n = (x?: number, y?: number) => (x ?? 0) + (y ?? 0)
  return {
    input_tokens: n(a.input_tokens, b.input_tokens),
    output_tokens: n(a.output_tokens, b.output_tokens),
    output_tokens_details: { thinking_tokens: n(a.output_tokens_details?.thinking_tokens ?? 0, b.output_tokens_details?.thinking_tokens ?? 0) },
    cache_creation_input_tokens: n(a.cache_creation_input_tokens, b.cache_creation_input_tokens),
    cache_read_input_tokens: n(a.cache_read_input_tokens, b.cache_read_input_tokens),
    cache_creation: {
      ephemeral_5m_input_tokens: n(a.cache_creation?.ephemeral_5m_input_tokens, b.cache_creation?.ephemeral_5m_input_tokens),
      ephemeral_1h_input_tokens: n(a.cache_creation?.ephemeral_1h_input_tokens, b.cache_creation?.ephemeral_1h_input_tokens),
    },
    server_tool_use: {
      web_search_requests: n(a.server_tool_use?.web_search_requests, b.server_tool_use?.web_search_requests),
      web_fetch_requests: n(a.server_tool_use?.web_fetch_requests, b.server_tool_use?.web_fetch_requests),
    },
  }
}

export type Hooks = {
  /** Each piece of Claude's text as it streams in. */
  onText?: (delta: string) => unknown
  /** A server tool started (web_search, web_fetch). */
  onToolUse?: (name: string) => unknown
  signal?: AbortSignal
}

export type Block = Record<string, unknown> & { type: string; text?: string; _json?: string }

/** A turn paused by the API this many times is given up on. */
const MAX_CONTINUATIONS = 3

/** One streamed request: key check, POST, errors without the key or the request, then the events read into blocks. */
async function streamed(body: Record<string, unknown>, hooks: Hooks) {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new NoAIKey()
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
    signal: hooks.signal,
  })
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: { type?: string } }
    throw new AIError(res.status, j.error?.type ? 'refused the request: ' + j.error.type : 'request failed', j.error?.type)
  }
  return await readStream(res.body, hooks)
}

/**
 * One research turn: Claude with web search and web fetch, streamed. Pauses
 * (stop_reason pause_turn) are continued. Returns all of Claude's text, the
 * summed usage, and the cost (each request priced on its own). Claude thinks
 * between steps, and that thinking counts toward max_tokens, so the cap leaves
 * it room: a request cut off at max_tokens can't be continued and fails the run.
 */
export async function research(o: { model: Model; system: string; prompt: string; maxTokens?: number; hooks?: Hooks }): Promise<{ text: string; usage: Usage; costUsd: number }> {
  const messages: Message[] = [{ role: 'user', content: o.prompt }]
  let usage: Usage = {}
  let costUsd = 0
  let text = ''
  for (let round = 0; ; round++) {
    const r = await streamed({ model: o.model, max_tokens: o.maxTokens ?? 16000, system: cachedSystem(o.system), messages, tools: TOOLS }, o.hooks ?? {})
    usage = addUsage(usage, r.usage)
    // Each step reads at most the instructions and what TOOLS allows (under 50K), so never the long-prompt price, however far the steps add up.
    costUsd += costOf(r.usage, o.model, false)
    text += r.blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    if (r.stop !== 'pause_turn') {
      if (r.stop === 'max_tokens') throw new AIError(200, 'ran out of room before answering', 'max_tokens')
      return { text, usage, costUsd }
    }
    if (round >= MAX_CONTINUATIONS) throw new AIError(200, 'kept pausing without an answer', 'pause_turn')
    messages.push({ role: 'assistant', content: r.blocks })
  }
}

/** PST-279: one of Nest's own tools, as Claude is given it (name, description, JSON Schema). */
export type ToolDef = { name: string; description: string; input_schema: unknown }
export type Message = { role: 'user' | 'assistant'; content: unknown }

/**
 * PST-279: one streamed turn with Nest's own tools and no server tools (Ask Nest).
 * The caller runs any tool_use blocks and goes on; `toolChoice: 'none'` makes
 * Claude answer with what it has. Claude may think first, which counts toward
 * max_tokens: the cap leaves room for that on top of a short answer.
 */
export async function converse(o: { model: Model; system: string; messages: Message[]; tools: ToolDef[]; toolChoice?: 'auto' | 'none'; maxTokens?: number; hooks?: Hooks }) {
  return await streamed(
    { model: o.model, max_tokens: o.maxTokens ?? 4000, system: cachedSystem(o.system), messages: o.messages, tools: o.tools, tool_choice: { type: o.toolChoice ?? 'auto' } },
    o.hooks ?? {},
  )
}

/**
 * PST-277: one plain turn, no tools and no streaming (reading meeting notes,
 * drafting an answer, the brief's reasons). Returns Claude's text and the usage
 * with its cost. These are short writing jobs, so Claude doesn't think first
 * (NO_THINKING) unless `thinking` says otherwise: thinking counts toward
 * max_tokens and cut the brief's reasons off.
 */
export async function complete(o: { model: Model; system: string; prompt: string; maxTokens?: number; thinking?: Thinking }): Promise<{ text: string; usage: Usage; costUsd: number }> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new NoAIKey()
  const thinking = o.thinking ?? NO_THINKING[o.model]
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({ model: o.model, max_tokens: o.maxTokens ?? 4000, ...(thinking ? { thinking } : {}), system: o.system, messages: [{ role: 'user', content: o.prompt }] }),
  })
  const j = (await res.json().catch(() => ({}))) as { content?: Block[]; usage?: Usage; stop_reason?: string; error?: { type?: string } }
  if (!res.ok) throw new AIError(res.status, j.error?.type ? 'refused the request: ' + j.error.type : 'request failed', j.error?.type)
  if (j.stop_reason === 'max_tokens') throw new AIError(200, 'ran out of room before answering', 'max_tokens')
  const usage = j.usage ?? {}
  const text = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
  return { text, usage, costUsd: costOf(usage, o.model) }
}

/** Read one streamed response (server-sent events) into content blocks, its stop reason and usage. */
async function readStream(body: ReadableStream<Uint8Array>, hooks: Hooks) {
  const reader = body.getReader()
  const dec = new TextDecoder()
  const blocks: Block[] = []
  let usage: Usage = {}
  let stop = ''
  let buf = ''
  const handle = async (data: string) => {
    const e = JSON.parse(data) as {
      type: string
      index?: number
      message?: { usage?: Usage }
      content_block?: Block
      delta?: { type?: string; text?: string; partial_json?: string; citation?: unknown; thinking?: string; signature?: string; stop_reason?: string }
      usage?: Usage
      error?: { type?: string }
    }
    if (e.type === 'error') throw new AIError(500, 'stream failed: ' + (e.error?.type ?? 'error'), e.error?.type)
    if (e.type === 'message_start') usage = { ...usage, ...e.message?.usage }
    else if (e.type === 'message_delta') {
      usage = { ...usage, ...Object.fromEntries(Object.entries(e.usage ?? {}).filter(([, x]) => x !== null && x !== undefined)) }
      if (e.delta?.stop_reason) stop = e.delta.stop_reason
    } else if (e.type === 'content_block_start' && e.content_block && e.index !== undefined) {
      const b: Block = { ...e.content_block }
      if (b.type === 'server_tool_use' || b.type === 'tool_use') b._json = ''
      blocks[e.index] = b
      if (b.type === 'server_tool_use') await hooks.onToolUse?.(String(b.name ?? ''))
    } else if (e.type === 'content_block_delta' && e.index !== undefined && blocks[e.index]) {
      const b = blocks[e.index]
      const d = e.delta ?? {}
      if (d.type === 'text_delta' && d.text) {
        b.text = (b.text ?? '') + d.text
        await hooks.onText?.(d.text)
      } else if (d.type === 'input_json_delta') b._json = (b._json ?? '') + (d.partial_json ?? '')
      else if (d.type === 'citations_delta') b.citations = [...((b.citations as unknown[]) ?? []), d.citation]
      else if (d.type === 'thinking_delta') b.thinking = String(b.thinking ?? '') + (d.thinking ?? '')
      else if (d.type === 'signature_delta') b.signature = d.signature
    } else if (e.type === 'content_block_stop' && e.index !== undefined && blocks[e.index]) {
      const b = blocks[e.index]
      if (b._json !== undefined) {
        try {
          b.input = b._json ? JSON.parse(b._json) : (b.input ?? {})
        } catch {
          b.input = {}
        }
        delete b._json
      }
    }
  }
  for (;;) {
    const { done, value } = await reader.read()
    buf += dec.decode(value ?? new Uint8Array(), { stream: !done })
    let cut: number
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, cut)
      buf = buf.slice(cut + 2)
      const data = chunk
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (data) await handle(data)
    }
    if (done) break
  }
  return { blocks: blocks.filter(Boolean), stop, usage }
}

/** Line breaks and tabs typed straight into JSON strings (Haiku does this), escaped. */
const escapeBreaks = (raw: string) => raw.replace(/"(?:[^"\\]|\\.)*"/g, (s) => s.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'))

/**
 * The JSON object in Claude's answer: the last fenced json block, else the
 * outermost braces, each tried again with raw line breaks in strings escaped.
 */
export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?[ \t]*\n?([\s\S]*?)```/g)].at(-1)?.[1]
  const braces = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  for (const raw of [fenced, braces]) {
    if (!raw?.trim()) continue
    for (const s of [raw, escapeBreaks(raw)]) {
      try {
        return JSON.parse(s)
      } catch {
        // the next way of reading it
      }
    }
  }
  throw new AIError(200, 'answered without readable JSON', 'no_json')
}
