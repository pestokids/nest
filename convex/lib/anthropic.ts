// PST-274: a small client for the Anthropic Messages API over fetch (no SDK), for
// research with the web search and web fetch server tools, and (PST-277) plain
// turns with no tools for reading meeting notes and drafting answers, and (PST-279) turns
// with Nest's own read tools for Ask Nest. It streams, so a run
// can report progress while Claude works, and prices every run from its usage.
// The key is ANTHROPIC_API_KEY in the Convex env; nothing here logs it or puts it in an error.

export const MODEL = 'claude-sonnet-5-5'
/** PST-277: the cheap model, for drafting an answer from the Q&A bank. */
export const HAIKU = 'claude-haiku-5-5'
export type Model = typeof MODEL | typeof HAIKU
const API = 'https://api.anthropic.com/v1/messages'
/** The current API version (docs.claude.com/en/api/versioning). Server tools need no beta header on it. */
const VERSION = '2026-10-21'

/** Server tools (docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool and …/web-fetch-tool). */
export const TOOLS = [
  { type: 'web_search_20260318', name: 'web_search', max_uses: 6 },
  { type: 'web_fetch_20260318', name: 'web_fetch', max_uses: 6, max_content_tokens: 20000 },
]

/**
 * Dollars per million tokens, and per web search. From
 * https://docs.claude.com/en/docs/about-claude/pricing (Claude Sonnet 5.5, and Claude
 * Haiku 5.5 for prompts up to 100,000 tokens, which is all Nest sends it) and
 * https://docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool#usage-and-pricing
 * ($10 per 1,000 searches). Web fetch costs nothing beyond its tokens. Checked 7 Nov 2026.
 */
export const PRICES = {
  [MODEL]: { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1 },
  [HAIKU]: { input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01 },
  webSearch: 0.01,
} as const

/** ANTHROPIC_API_KEY isn't set (Vercel previews): the UI says "AI isn't set up here" instead of failing. */
export class NoAIKey extends Error {
  readonly code = 'NoAIKey'
  constructor() {
    super('AI isn’t set up here: ANTHROPIC_API_KEY is not set.')
  }
}

/** Anything else the API refused or broke on. Never includes the key or the request. */
export class AIError extends Error {
  constructor(
    public status: number,
    what: string,
  ) {
    super('Claude ' + what + ' (' + status + ')')
  }
}

export const hasAIKey = () => !!process.env.ANTHROPIC_API_KEY?.trim()

export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number }
}

/** What a run cost, in dollars: tokens at the model's prices plus web search requests. */
export function costOf(u: Usage, model: Model = MODEL): number {
  const p = PRICES[model]
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h)
  const tokens =
    (u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output + w5m * p.cacheWrite5m + w1h * p.cacheWrite1h + (u.cache_read_input_tokens ?? 0) * p.cacheRead
  return tokens / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * PRICES.webSearch
}

/** Two requests' usage added up (a turn that paused and went on). */
export function addUsage(a: Usage, b: Usage): Usage {
  const n = (x?: number, y?: number) => (x ?? 0) + (y ?? 0)
  return {
    input_tokens: n(a.input_tokens, b.input_tokens),
    output_tokens: n(a.output_tokens, b.output_tokens),
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
    throw new AIError(res.status, j.error?.type ? 'refused the request: ' + j.error.type : 'request failed')
  }
  return await readStream(res.body, hooks)
}

/**
 * One research turn: Claude with web search and web fetch, streamed. Pauses
 * (stop_reason pause_turn) are continued. Returns all of Claude's text and the
 * summed usage with its cost.
 */
export async function research(o: { system: string; prompt: string; maxTokens?: number; hooks?: Hooks }): Promise<{ text: string; usage: Usage; costUsd: number }> {
  const messages: Message[] = [{ role: 'user', content: o.prompt }]
  let usage: Usage = {}
  let text = ''
  for (let round = 0; ; round++) {
    const r = await streamed({ model: MODEL, max_tokens: o.maxTokens ?? 8000, system: o.system, messages, tools: TOOLS }, o.hooks ?? {})
    usage = addUsage(usage, r.usage)
    text += r.blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    if (r.stop !== 'pause_turn') {
      if (r.stop === 'max_tokens') throw new AIError(200, 'ran out of room before answering')
      return { text, usage, costUsd: costOf(usage) }
    }
    if (round >= MAX_CONTINUATIONS) throw new AIError(200, 'kept pausing without an answer')
    messages.push({ role: 'assistant', content: r.blocks })
  }
}

/** PST-279: one of Nest's own tools, as Claude is given it (name, description, JSON Schema). */
export type ToolDef = { name: string; description: string; input_schema: unknown }
export type Message = { role: 'user' | 'assistant'; content: unknown }

/**
 * PST-279: one streamed turn with Nest's own tools and no server tools (Ask Nest).
 * The caller runs any tool_use blocks and goes on; `toolChoice: 'none'` makes
 * Claude answer with what it has.
 */
export async function converse(o: { model: Model; system: string; messages: Message[]; tools: ToolDef[]; toolChoice?: 'auto' | 'none'; maxTokens?: number; hooks?: Hooks }) {
  return await streamed(
    { model: o.model, max_tokens: o.maxTokens ?? 2000, system: o.system, messages: o.messages, tools: o.tools, tool_choice: { type: o.toolChoice ?? 'auto' } },
    o.hooks ?? {},
  )
}

/**
 * PST-277: one plain turn, no tools and no streaming (reading meeting notes,
 * drafting an answer). Returns Claude's text and the usage with its cost.
 */
export async function complete(o: { model: Model; system: string; prompt: string; maxTokens?: number }): Promise<{ text: string; usage: Usage; costUsd: number }> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new NoAIKey()
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': VERSION, 'content-type': 'application/json' },
    body: JSON.stringify({ model: o.model, max_tokens: o.maxTokens ?? 4000, system: o.system, messages: [{ role: 'user', content: o.prompt }] }),
  })
  const j = (await res.json().catch(() => ({}))) as { content?: Block[]; usage?: Usage; stop_reason?: string; error?: { type?: string } }
  if (!res.ok) throw new AIError(res.status, j.error?.type ? 'refused the request: ' + j.error.type : 'request failed')
  if (j.stop_reason === 'max_tokens') throw new AIError(200, 'ran out of room before answering')
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
    if (e.type === 'error') throw new AIError(500, 'stream failed: ' + (e.error?.type ?? 'error'))
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
        b.input = b._json ? JSON.parse(b._json) : (b.input ?? {})
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

/** The JSON object in Claude's answer: the last fenced json block, else the outermost braces. */
export function extractJson(text: string): unknown {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].at(-1)?.[1]
  const raw = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    return JSON.parse(raw)
  } catch {
    throw new AIError(200, 'answered without readable JSON')
  }
}
