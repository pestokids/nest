// PST-276: the Nest MCP server. POST /mcp on the Convex HTTP router (and
// https://nest.pestokids.com/mcp through vercel.json's rewrite), plus GET
// /mcp/skill for the Nest skill. Streamable HTTP, hand-written: one JSON-RPC 2.0
// request per POST, answered with application/json (no SSE), no sessions.
//
// Dual-era (spec 2026-07-28, basic/versioning): a request whose params._meta
// carries io.modelcontextprotocol/protocolVersion is served statelessly as
// 2026-07-28 (server/discover, Mcp-Method / Mcp-Name / MCP-Protocol-Version
// headers checked against the body). Anything else is served as the
// initialize-handshake versions 2025-03-26 to 2025-11-25 (initialize, ping).
//
// Every request needs "Authorization: Bearer nest_ak_…"; only its SHA-256 is
// looked up (agents.authorize, which also holds each key to about 60 calls a
// minute and logs the call: tool, time, outcome, duration, never arguments or
// results). Bad input gets a JSON-RPC error with a plain message, never a stack trace.
import type { HttpRouter } from 'convex/server'
import type { Id } from './_generated/dataModel'
import { httpAction, type ActionCtx } from './_generated/server'
import { internal } from './_generated/api'
import { serverUrl } from './agents'
import { bearerKey, hashKey } from './lib/agentKey'
import { checkArgs, MCP_PATH, nestSkill, RATE_LIMIT, SKILL_PATH, toolNamed, toolsFor, type AgentScope } from '../src/lib/agents'

export const MODERN_VERSIONS = ['2026-07-28']
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const SUPPORTED = [...MODERN_VERSIONS, ...LEGACY_VERSIONS]
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion'
const SERVER_INFO = { name: 'nest', title: 'Nest', version: '1.0.0' }
const INSTRUCTIONS =
  'Nest is Pesto’s pre-seed raise tracker. Read investors, today’s moves and the Q&A bank. Every write you make is only a suggestion that waits in Dev’s Suggestions queue: never claim you changed something. Follow the stage rules and never invent numbers. The full guide: ' + SKILL_PATH
const MAX_BODY = 64 * 1024

/** JSON-RPC error codes: the standard ones, -32000…-32019 for this server, and the spec's -32020 and -32022. */
export const CODE = {
  parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603,
  unauthorized: -32001, rateLimited: -32002, forbidden: -32003, headerMismatch: -32020, unsupportedVersion: -32022,
} as const

const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
type Id_ = string | number | null
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } })
const fail = (id: Id_, code: number, message: string, status: number, data?: unknown, extra?: Record<string, string>) =>
  json({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }, status, extra)

/** A browser Origin must be Nest's own site; agents' servers send none. */
function originOk(origin: string | null) {
  if (!origin) return true
  try {
    return !!process.env.SITE_URL && new URL(process.env.SITE_URL).origin === origin
  } catch {
    return false
  }
}

const unauthorized = () =>
  fail(null, CODE.unauthorized, 'Missing, unknown or revoked key. Send “Authorization: Bearer nest_ak_…” with a key from Nest › Raise › Settings › Agents.', 401, undefined, {
    'WWW-Authenticate': 'Bearer realm="nest", error="invalid_token"',
  })

/** Mcp-Name may come as =?base64?…?= (spec: Value Encoding). */
function headerValue(h: string | null) {
  const m = h && /^=\?base64\?(.*)\?=$/.exec(h)
  if (!m) return h
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0)))
  } catch {
    return null
  }
}

type Key = { id: Id<'agentKeys'>; name: string; scope: AgentScope }
/** A handled request: the response, what to log as the tool, and whether it worked. */
type Handled = { res: Response; tool: string; ok: boolean }
const KNOWN_METHODS = new Set(['initialize', 'server/discover', 'ping', 'tools/list', 'tools/call'])

async function handle(ctx: ActionCtx, req: Request, key: Key): Promise<Handled> {
  const text = await req.text()
  if (text.length > MAX_BODY) return { res: fail(null, CODE.invalidRequest, 'The request is too big.', 413), tool: 'unknown', ok: false }
  let msg: unknown
  try {
    msg = JSON.parse(text)
  } catch {
    return { res: fail(null, CODE.parse, 'That isn’t valid JSON.', 400), tool: 'unknown', ok: false }
  }
  if (Array.isArray(msg)) return { res: fail(null, CODE.invalidRequest, 'Batches aren’t supported: send one JSON-RPC request per POST.', 400), tool: 'unknown', ok: false }
  const m = (msg && typeof msg === 'object' ? msg : {}) as Record<string, unknown>
  const hasId = 'id' in m
  const id = typeof m.id === 'string' || typeof m.id === 'number' ? m.id : null
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string' || (hasId && id === null))
    return { res: fail(id, CODE.invalidRequest, 'Not a JSON-RPC 2.0 request: it needs "jsonrpc": "2.0", a method, and a string or number id.', 400), tool: 'unknown', ok: false }
  const method = m.method
  const tool = KNOWN_METHODS.has(method) ? method : 'unknown'
  // A notification (notifications/initialized and the like): nothing to answer.
  if (!hasId) return { res: new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } }), tool: method.startsWith('notifications/') ? 'notification' : 'unknown', ok: true }
  if (m.params !== undefined && (typeof m.params !== 'object' || m.params === null || Array.isArray(m.params)))
    return { res: fail(id, CODE.invalidParams, 'params must be an object.', 400), tool, ok: false }
  const params = (m.params ?? {}) as Record<string, unknown>
  const meta = params._meta && typeof params._meta === 'object' ? (params._meta as Record<string, unknown>) : undefined
  const headerVersion = req.headers.get('mcp-protocol-version')

  // Which era: per-request _meta (2026-07-28) or the initialize handshake (earlier).
  const modern = method !== 'initialize' && meta?.[VERSION_KEY] !== undefined
  if (modern) {
    const v = meta![VERSION_KEY]
    if (typeof v !== 'string' || !MODERN_VERSIONS.includes(v))
      return { res: fail(id, CODE.unsupportedVersion, 'Unsupported protocol version', 400, { supported: SUPPORTED, requested: v }), tool, ok: false }
    const mismatch =
      headerVersion !== v
        ? `MCP-Protocol-Version header ${headerVersion ? `'${headerVersion.slice(0, 40)}'` : 'is missing and'} doesn’t match _meta '${v}'`
        : req.headers.get('mcp-method') !== method
          ? `Mcp-Method header doesn’t match the method '${method.slice(0, 40)}'`
          : method === 'tools/call' && headerValue(req.headers.get('mcp-name')) !== params.name
            ? 'Mcp-Name header doesn’t match params.name'
            : null
    if (mismatch) return { res: fail(id, CODE.headerMismatch, `Header mismatch: ${mismatch}`, 400), tool, ok: false }
  } else if (method !== 'initialize' && headerVersion && !LEGACY_VERSIONS.includes(headerVersion)) {
    return MODERN_VERSIONS.includes(headerVersion)
      ? { res: fail(id, CODE.headerMismatch, `Header mismatch: protocol version ${headerVersion} needs params._meta["${VERSION_KEY}"]`, 400), tool, ok: false }
      : { res: fail(id, CODE.unsupportedVersion, 'Unsupported protocol version', 400, { supported: SUPPORTED, requested: headerVersion.slice(0, 40) }), tool, ok: false }
  }

  const ok = (result: Record<string, unknown>, logAs = tool, worked = true): Handled => ({
    res: json({ jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result, _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO } } : result }),
    tool: logAs,
    ok: worked,
  })
  const capabilities = { tools: { listChanged: false } }

  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion
      const protocolVersion = typeof asked === 'string' && LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0]
      return ok({ protocolVersion, capabilities, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS })
    }
    case 'server/discover':
      return ok({ supportedVersions: SUPPORTED, capabilities, instructions: INSTRUCTIONS, ttlMs: 3_600_000, cacheScope: 'public' })
    case 'ping':
      return ok({})
    case 'tools/list':
      return ok({
        tools: toolsFor(key.scope).map((t) => ({
          name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: t.scope === 'read', destructiveHint: false, openWorldHint: t.name === 'enrich' },
        })),
        ...(modern ? { ttlMs: 300_000, cacheScope: 'private' } : {}),
      })
    case 'tools/call': {
      const name = params.name
      const def = typeof name === 'string' ? toolNamed(name) : undefined
      if (!def) return { res: fail(id, CODE.invalidParams, `Unknown tool: ${String(name ?? '').slice(0, 60) || '(none)'}`, 200), tool: 'unknown', ok: false }
      if (def.scope === 'suggest' && key.scope !== 'suggest')
        return { res: fail(id, CODE.invalidParams, `${def.name} needs a key that can suggest changes; this one is read only.`, 200), tool: def.name, ok: false }
      const args = checkArgs(def, params.arguments)
      if (!args.ok) return { res: fail(id, CODE.invalidParams, `Invalid arguments for ${def.name}: ${args.error}.`, 200), tool: def.name, ok: false }
      const out =
        def.scope === 'read'
          ? await ctx.runQuery(internal.mcp.read, { tool: def.name, args: args.value })
          : await ctx.runMutation(internal.mcp.write, { tool: def.name, args: args.value, agent: { keyId: key.id, name: key.name, scope: key.scope } })
      if (!out.ok) return ok({ content: [{ type: 'text', text: out.error }], isError: true }, def.name, false)
      return ok({ content: [{ type: 'text', text: JSON.stringify(out.data, null, 2) }], structuredContent: out.data, isError: false }, def.name)
    }
    default:
      return { res: fail(id, CODE.methodNotFound, `Method not found: ${method.slice(0, 60)}`, modern ? 404 : 200), tool, ok: false }
  }
}

/** POST /mcp */
const post = httpAction(async (ctx, req) => {
  const started = Date.now()
  if (!originOk(req.headers.get('origin'))) return fail(null, CODE.forbidden, 'This origin isn’t allowed.', 403)
  const key = bearerKey(req.headers.get('authorization'))
  if (!key) return unauthorized()
  const auth = await ctx.runMutation(internal.agents.authorize, { hash: await hashKey(key) })
  if (!auth.ok) {
    if (auth.reason === 'unauthorized') return unauthorized()
    return fail(null, CODE.rateLimited, `Too many calls: a key can make ${RATE_LIMIT} a minute. Try again in ${auth.retryAfter}s.`, 429, undefined, { 'Retry-After': String(auth.retryAfter) })
  }
  let done: Handled
  try {
    done = await handle(ctx, req, auth.key)
  } catch {
    // Ids only in logs: never the key, arguments or results.
    console.error(`mcp: call failed for key ${auth.key.id}`)
    done = { res: fail(null, CODE.internal, 'Nest couldn’t do that just now. Try again in a moment.', 500), tool: 'unknown', ok: false }
  }
  await ctx.runMutation(internal.agents.finishCall, { callId: auth.callId, tool: done.tool, ok: done.ok, ms: Date.now() - started })
  return done.res
})

/** GET and DELETE /mcp: no standalone stream and no sessions here. */
const notAllowed = httpAction(async () => fail(null, CODE.invalidRequest, 'Send JSON-RPC requests with POST.', 405, undefined, { Allow: 'POST' }))

/** GET /mcp/skill: the Nest skill, as markdown. */
const skill = httpAction(async () => new Response(nestSkill(serverUrl()), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=300' } }))

export function mcpRoutes(http: HttpRouter) {
  http.route({ path: MCP_PATH, method: 'POST', handler: post })
  http.route({ path: MCP_PATH, method: 'GET', handler: notAllowed })
  http.route({ path: MCP_PATH, method: 'DELETE', handler: notAllowed })
  http.route({ path: SKILL_PATH, method: 'GET', handler: skill })
}
