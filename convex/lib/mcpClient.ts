// PST-285: Nest as an MCP client of a remote server that signs in with OAuth,
// following the MCP authorization spec: discovery (a 401's WWW-Authenticate
// resource_metadata, RFC 9728 protected resource metadata, RFC 8414
// authorization server metadata), dynamic client registration (RFC 7591), OAuth
// 2.1 authorization code with PKCE S256 and the resource parameter (RFC 8707),
// refresh, then Streamable HTTP JSON-RPC: initialize, tools/list, tools/call.
// Errors carry statuses and OAuth error codes only: never a token, a code, a
// secret or anything a tool returned.
import type { ToolDef, ToolResult } from '../../src/lib/wispr'

const PROTOCOL = '2025-11-25'
const CLIENT_INFO = { name: 'nest', title: 'Nest', version: '1.0.0' }
const ACCEPT = 'application/json, text/event-stream'

/** The authorization server has no registration endpoint: nothing to connect with. */
export class NoDcr extends Error {
  constructor() {
    super('The authorization server doesn’t support dynamic client registration')
  }
}
/** Discovery found something unusable (no metadata, no PKCE, not https…). */
export class DiscoveryError extends Error {}
/** The authorization server refused the grant (invalid_grant, invalid_client…): the user has to sign in again. */
export class AuthRefused extends Error {
  constructor(public code: string) {
    super(`Sign-in refused (${code})`)
  }
}
/** The MCP server answered 401: the access token isn't good any more. */
export class Unauthorized extends Error {
  constructor() {
    super('The MCP server refused the token (401)')
  }
}
/** Anything else (an outage, a bad answer). Retried on the next run. */
export class McpError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message)
  }
}

export type AuthMeta = {
  /** The protected resource (RFC 8707), sent with every authorization and token request. */
  resource: string
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  scope?: string
  authMethods: string[]
}
export type AuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic'
export type Client = { clientId: string; clientSecret?: string; authMethod: AuthMethod }
export type Tokens = { accessToken: string; refreshToken?: string; expiresAt?: number }

type Obj = Record<string, unknown>

/** https only, except localhost (tests and local servers). */
function safeUrl(raw: unknown, what: string): string {
  if (typeof raw !== 'string') throw new DiscoveryError(`No ${what}`)
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new DiscoveryError(`Bad ${what}`)
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new DiscoveryError(`${what} isn’t https`)
  return u.href
}

/** `Bearer resource_metadata="…", scope="…"` as a map. */
export function parseWwwAuthenticate(h: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!h) return out
  for (const m of h.matchAll(/([a-zA-Z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g)) out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').replace(/\\(.)/g, '$1')
  return out
}

/** The well-known URLs to try, path-inserted first (RFC 9728 §3.1, RFC 8414 §3.1, then OpenID Connect discovery). */
function wellKnown(base: string, names: string[]): string[] {
  const u = new URL(base)
  const path = u.pathname.replace(/\/+$/, '')
  const out: string[] = []
  for (const n of names) {
    if (path) out.push(`${u.origin}/.well-known/${n}${path}`)
    if (path && n === 'openid-configuration') out.push(`${u.origin}${path}/.well-known/${n}`)
  }
  for (const n of names) out.push(`${u.origin}/.well-known/${n}`)
  return [...new Set(out)]
}

async function firstJson(urls: string[]): Promise<Obj | null> {
  for (const url of urls) {
    let res: Response
    try {
      res = await fetch(url, { headers: { Accept: 'application/json', 'MCP-Protocol-Version': PROTOCOL } })
    } catch {
      continue
    }
    if (!res.ok) continue
    const j = (await res.json().catch(() => null)) as unknown
    if (j && typeof j === 'object' && !Array.isArray(j)) return j as Obj
  }
  return null
}

const sameIssuer = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

/**
 * Discovery: an unauthenticated initialize must get a 401 whose WWW-Authenticate
 * names the resource metadata (else the well-known URLs are tried), which names
 * the authorization server, whose metadata must offer PKCE S256 and a
 * registration endpoint. Throws NoDcr when it has none.
 */
export async function discover(serverUrl: string): Promise<AuthMeta> {
  let res: Response
  try {
    res = await fetch(serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: ACCEPT },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO } }),
    })
  } catch {
    throw new DiscoveryError('The MCP server couldn’t be reached')
  }
  if (res.status !== 401) throw new DiscoveryError(res.ok ? 'The MCP server didn’t ask to sign in' : `The MCP server answered ${res.status}`)
  const www = parseWwwAuthenticate(res.headers.get('WWW-Authenticate'))
  const prm = await firstJson(www.resource_metadata ? [safeUrl(www.resource_metadata, 'resource metadata URL')] : wellKnown(serverUrl, ['oauth-protected-resource']))
  if (!prm) throw new DiscoveryError('No protected resource metadata')
  const servers = Array.isArray(prm.authorization_servers) ? prm.authorization_servers : []
  const issuer = safeUrl(servers[0], 'authorization server')
  const meta = await firstJson(wellKnown(issuer, ['oauth-authorization-server', 'openid-configuration']))
  if (!meta) throw new DiscoveryError('No authorization server metadata')
  if (typeof meta.issuer !== 'string' || !sameIssuer(meta.issuer, issuer)) throw new DiscoveryError('The authorization server metadata names another issuer')
  const methods = Array.isArray(meta.code_challenge_methods_supported) ? meta.code_challenge_methods_supported : []
  if (!methods.includes('S256')) throw new DiscoveryError('The authorization server doesn’t offer PKCE (S256)')
  if (!meta.registration_endpoint) throw new NoDcr()
  const scopes = Array.isArray(prm.scopes_supported) ? (prm.scopes_supported as unknown[]).filter((s): s is string => typeof s === 'string') : []
  const scope = www.scope || scopes.join(' ') || undefined
  return {
    resource: typeof prm.resource === 'string' ? safeUrl(prm.resource, 'resource') : serverUrl,
    issuer: meta.issuer,
    authorizationEndpoint: safeUrl(meta.authorization_endpoint, 'authorization endpoint'),
    tokenEndpoint: safeUrl(meta.token_endpoint, 'token endpoint'),
    registrationEndpoint: safeUrl(meta.registration_endpoint, 'registration endpoint'),
    ...(scope ? { scope } : {}),
    authMethods: Array.isArray(meta.token_endpoint_auth_methods_supported) ? (meta.token_endpoint_auth_methods_supported as string[]) : [],
  }
}

/** Nest keeps a secret server-side, so it asks to be a confidential client when the server allows it. RFC 8414's default is client_secret_basic. */
function preferredMethod(supported: string[]): AuthMethod {
  if (!supported.length) return 'client_secret_basic'
  for (const m of ['client_secret_post', 'client_secret_basic', 'none'] as const) if (supported.includes(m)) return m
  return 'none'
}

/** Dynamic client registration (RFC 7591): Nest, this redirect URI, code and refresh grants. */
export async function register(meta: AuthMeta, redirectUri: string): Promise<Client> {
  const asked = preferredMethod(meta.authMethods)
  let res: Response
  try {
    res = await fetch(meta.registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: 'Nest',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: asked,
        ...(meta.scope ? { scope: meta.scope } : {}),
      }),
    })
  } catch {
    throw new McpError('Client registration couldn’t reach the server')
  }
  const j = (await res.json().catch(() => ({}))) as Obj
  if (!res.ok || typeof j.client_id !== 'string') throw new McpError(`Client registration failed (${res.status}${typeof j.error === 'string' ? ' ' + j.error : ''})`, res.status)
  const secret = typeof j.client_secret === 'string' && j.client_secret ? j.client_secret : undefined
  const given = typeof j.token_endpoint_auth_method === 'string' ? j.token_endpoint_auth_method : asked
  const authMethod: AuthMethod = !secret ? 'none' : given === 'client_secret_post' || given === 'client_secret_basic' ? given : asked === 'none' ? 'client_secret_basic' : asked
  return { clientId: j.client_id, ...(secret ? { clientSecret: secret } : {}), authMethod }
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A PKCE pair: a 43-character verifier and its S256 challenge. */
export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  return { verifier, challenge: await challengeOf(verifier) }
}
export const challengeOf = async (verifier: string) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))

/** Where the browser signs in. */
export function authorizeUrl(meta: Pick<AuthMeta, 'authorizationEndpoint' | 'resource' | 'scope'>, clientId: string, o: { redirectUri: string; state: string; challenge: string }) {
  const u = new URL(meta.authorizationEndpoint)
  const q: Record<string, string> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: o.redirectUri,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
    resource: meta.resource,
    ...(meta.scope ? { scope: meta.scope } : {}),
  }
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
  return u.href
}

type TokenTarget = { tokenEndpoint: string; resource: string }

async function tokenCall(t: TokenTarget, c: Client, body: Record<string, string>): Promise<Tokens> {
  const form = new URLSearchParams({ ...body, resource: t.resource })
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }
  if (c.authMethod === 'client_secret_basic' && c.clientSecret) headers.Authorization = `Basic ${btoa(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`)}`
  else {
    form.set('client_id', c.clientId)
    if (c.authMethod === 'client_secret_post' && c.clientSecret) form.set('client_secret', c.clientSecret)
  }
  let res: Response
  try {
    res = await fetch(t.tokenEndpoint, { method: 'POST', headers, body: form.toString() })
  } catch {
    throw new McpError('The token endpoint couldn’t be reached')
  }
  const j = (await res.json().catch(() => ({}))) as Obj
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new AuthRefused(typeof j.error === 'string' ? j.error.slice(0, 40) : String(res.status))
    throw new McpError(`Token request failed (${res.status})`, res.status)
  }
  if (typeof j.access_token !== 'string' || !j.access_token) throw new McpError('The token response had no access token')
  const expiresIn = Number(j.expires_in)
  return {
    accessToken: j.access_token,
    ...(typeof j.refresh_token === 'string' && j.refresh_token ? { refreshToken: j.refresh_token } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresAt: Date.now() + expiresIn * 1000 } : {}),
  }
}

/** The authorization code for tokens, with the PKCE verifier. */
export const exchangeCode = (t: TokenTarget, c: Client, o: { code: string; verifier: string; redirectUri: string }) =>
  tokenCall(t, c, { grant_type: 'authorization_code', code: o.code, code_verifier: o.verifier, redirect_uri: o.redirectUri })

/** A fresh access token (and maybe a rotated refresh token). AuthRefused when the server won't. */
export const refreshTokens = (t: TokenTarget, c: Client, refreshToken: string) => tokenCall(t, c, { grant_type: 'refresh_token', refresh_token: refreshToken })

/* ---------- the MCP session ---------- */

type RpcMessage = { jsonrpc?: string; id?: number | string | null; result?: unknown; error?: { code?: number } }

/** The JSON-RPC response with this id, from a JSON body or an SSE stream. */
async function responseFor(res: Response, id: number): Promise<RpcMessage | null> {
  const type = res.headers.get('Content-Type') ?? ''
  const text = await res.text()
  const messages: unknown[] = []
  if (type.includes('text/event-stream')) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n')
      if (!data) continue
      try {
        messages.push(JSON.parse(data))
      } catch {
        /* not JSON: skip */
      }
    }
  } else {
    try {
      const j = JSON.parse(text) as unknown
      messages.push(...(Array.isArray(j) ? j : [j]))
    } catch {
      return null
    }
  }
  return (messages.find((m) => !!m && typeof m === 'object' && (m as RpcMessage).id === id) as RpcMessage | undefined) ?? null
}

export type Session = {
  listTools(): Promise<ToolDef[]>
  callTool(name: string, args: Record<string, unknown>): Promise<ToolResult>
  close(): Promise<void>
}

/** initialize, then notifications/initialized. Unauthorized on a 401. */
export async function openSession(serverUrl: string, accessToken: string): Promise<Session> {
  let sessionId: string | null = null
  let version = PROTOCOL
  let next = 1
  const headers = (extra: Record<string, string> = {}) => ({
    'Content-Type': 'application/json',
    Accept: ACCEPT,
    Authorization: `Bearer ${accessToken}`,
    ...(next > 1 ? { 'MCP-Protocol-Version': version } : {}),
    ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    ...extra,
  })
  const post = async (body: Obj, init = false) => {
    let res: Response
    try {
      res = await fetch(serverUrl, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
    } catch {
      throw new McpError('The MCP server couldn’t be reached')
    }
    if (res.status === 401) throw new Unauthorized()
    if (init) sessionId = res.headers.get('Mcp-Session-Id')
    return res
  }
  const request = async (method: string, params: Obj, init = false) => {
    const id = next
    const res = await post({ jsonrpc: '2.0', id, method, params }, init)
    next++
    if (!res.ok) throw new McpError(`${method} failed (${res.status})`, res.status)
    const msg = await responseFor(res, id)
    if (!msg) throw new McpError(`${method} had no answer`)
    if (msg.error) throw new McpError(`${method} error ${msg.error.code ?? '?'}`)
    return (msg.result ?? {}) as Obj
  }

  const init = await request('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: CLIENT_INFO }, true)
  if (typeof init.protocolVersion === 'string') version = init.protocolVersion
  const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  await res.body?.cancel().catch(() => undefined)

  return {
    async listTools() {
      const tools: ToolDef[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const r = await request('tools/list', cursor ? { cursor } : {})
        if (Array.isArray(r.tools)) tools.push(...(r.tools as ToolDef[]).filter((t) => t && typeof t.name === 'string'))
        cursor = typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : undefined
        if (!cursor) break
      }
      return tools
    },
    async callTool(name, args) {
      return (await request('tools/call', { name, arguments: args })) as ToolResult
    },
    async close() {
      if (!sessionId) return
      try {
        const r = await fetch(serverUrl, { method: 'DELETE', headers: headers() })
        await r.body?.cancel().catch(() => undefined)
      } catch {
        /* the session times out on its own */
      }
    },
  }
}
