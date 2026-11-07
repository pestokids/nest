// @vitest-environment edge-runtime
// PST-285: Wispr Flow notes against a mocked Wispr MCP server: discovery, dynamic
// client registration, the PKCE sign-in, token refresh, tools/list, both fetch
// paths, dedupe, Unmatched notes, needs reconnecting and the "Read meeting notes"
// toggle. fetch is faked; nothing here calls Wispr Flow. Every name, address,
// title and note below is made up.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { decryptToken, encryptToken, signState } from './lib/crypto'
import { challengeOf, parseWwwAuthenticate } from './lib/mcpClient'
import { redirectUri } from './wispr'
import type { ToolDef } from '../src/lib/wispr'

const modules = import.meta.glob('./**/*.ts')

const M = 6e4
const H = 60 * M
const D = 24 * H
// A made-up 32-byte key for tests only.
const TEST_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)))
const MCP = 'https://wispr.example.com/connect/mcp'
const AUTH = 'https://auth.example.com'
const NOTE = 'Liked the retention story. Wants week-8 numbers before deciding.'
const SUMMARY = 'Next steps: send week-8 retention.'

/* ---------- a fake Wispr Flow ---------- */

type Rec = { id: string; calendarId?: string; title: string; start: number; end: number }
type Server = {
  dcr: boolean
  meetings: Rec[]
  tools: ToolDef[]
  live: Set<string>
  refresh: 'ok' | 'invalid_grant' | 'down'
  clients: { id: string; secret: string; redirect: string }[]
  codes: Map<string, { challenge: string; clientId: string; redirect: string }>
  calls: { tool: string; args: Record<string, unknown> }[]
  sse: boolean
  n: number
}
let wispr: Server

const STANDARD_TOOLS: ToolDef[] = [
  { name: 'get_meeting_by_calendar_id', inputSchema: { type: 'object', properties: { calendar_id: { type: 'string' }, view_content: { type: 'object' } } as never, required: ['calendar_id'] } },
  {
    name: 'search_meetings',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, since: { type: 'string', format: 'date-time' }, until: { type: 'string', format: 'date-time' }, limit: { type: 'integer', maximum: 50 }, cursor: { type: 'string' } },
    },
  },
  { name: 'get_meeting', inputSchema: { type: 'object', properties: { meeting_id: { type: 'string' }, view_content: { type: 'object' } } as never, required: ['meeting_id'] } },
  { name: 'list_upcoming_meetings', inputSchema: { type: 'object', properties: { window_hours: { type: 'integer' } } } },
]

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const iso = (ms: number) => new Date(ms).toISOString()
const full = (r: Rec) => ({ meeting_id: r.id, title: r.title, start_time: iso(r.start), end_time: iso(r.end), summary: { markdown: SUMMARY }, content: NOTE })
const textResult = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] })
const stringArg = (args: Record<string, unknown>) => Object.values(args).find((v) => typeof v === 'string') as string | undefined
/** A from/to bound in whatever shape the args came in (ISO string or epoch seconds). */
const bound = (v: unknown) => (typeof v === 'number' ? v * 1000 : typeof v === 'string' ? Date.parse(v) : undefined)

function callTool(name: string, args: Record<string, unknown>) {
  wispr.calls.push({ tool: name, args })
  if (name === 'get_meeting_by_calendar_id') {
    const r = wispr.meetings.find((m) => m.calendarId && m.calendarId === stringArg(args))
    return r ? textResult(full(r)) : { isError: true, content: [{ type: 'text', text: 'No recording is linked to that event.' }] }
  }
  if (name === 'search_meetings') {
    const vals = Object.entries(args)
    const from = bound(vals.find(([k]) => /since|after/i.test(k))?.[1]) ?? 0
    const to = bound(vals.find(([k]) => /until|before/i.test(k))?.[1]) ?? Infinity
    const found = wispr.meetings.filter((m) => m.start >= from && m.start <= to).map((m) => ({ meeting_id: m.id, title: m.title, start_time: iso(m.start), end_time: iso(m.end) }))
    return textResult({ meetings: found, has_more: false })
  }
  if (name === 'get_meeting') {
    const r = wispr.meetings.find((m) => m.id === stringArg(args))
    return r ? textResult(full(r)) : { isError: true, content: [{ type: 'text', text: 'Not found.' }] }
  }
  return { isError: true, content: [{ type: 'text', text: 'Unknown tool.' }] }
}

function issue() {
  wispr.n++
  const access = `at-${wispr.n}`
  wispr.live.add(access)
  return { access_token: access, refresh_token: `rt-${wispr.n}`, token_type: 'Bearer', expires_in: 3600 }
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = init?.method ?? 'GET'
  const headers = new Headers(init?.headers)
  if (url.href === MCP) {
    if (method === 'DELETE') return new Response(null, { status: 204 })
    const token = headers.get('Authorization')?.replace(/^Bearer /, '')
    if (!token || !wispr.live.has(token))
      return json({ error: 'invalid_token' }, 401, { 'WWW-Authenticate': 'Bearer resource_metadata="https://wispr.example.com/.well-known/oauth-protected-resource/connect/mcp", scope="openid offline_access"' })
    const msg = JSON.parse(String(init?.body)) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } }
    if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 })
    let result: unknown
    if (msg.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-wispr', version: '0' } }
    else if (msg.method === 'tools/list') result = { tools: wispr.tools }
    else if (msg.method === 'tools/call') result = callTool(msg.params?.name ?? '', msg.params?.arguments ?? {})
    else return json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'nope' } })
    const reply = { jsonrpc: '2.0', id: msg.id, result }
    if (wispr.sse && msg.method === 'tools/call')
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\nevent: message\ndata: ${JSON.stringify(reply)}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    return json(reply, 200, msg.method === 'initialize' ? { 'Mcp-Session-Id': 'session-1' } : {})
  }
  if (url.href === 'https://wispr.example.com/.well-known/oauth-protected-resource/connect/mcp')
    return json({ resource: MCP, authorization_servers: [AUTH], scopes_supported: ['openid', 'offline_access'], bearer_methods_supported: ['header'] })
  if (url.href === `${AUTH}/.well-known/oauth-authorization-server`)
    return json({
      issuer: AUTH,
      authorization_endpoint: `${AUTH}/oauth2/authorize`,
      token_endpoint: `${AUTH}/oauth2/token`,
      ...(wispr.dcr ? { registration_endpoint: `${AUTH}/oauth2/register` } : {}),
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      response_types_supported: ['code'],
    })
  if (url.href === `${AUTH}/oauth2/register` && method === 'POST') {
    const body = JSON.parse(String(init?.body)) as { redirect_uris: string[]; token_endpoint_auth_method: string }
    const client = { id: `client-${wispr.clients.length + 1}`, secret: `secret-${wispr.clients.length + 1}`, redirect: body.redirect_uris[0] }
    wispr.clients.push(client)
    return json({ client_id: client.id, client_secret: client.secret, token_endpoint_auth_method: body.token_endpoint_auth_method, redirect_uris: body.redirect_uris }, 201)
  }
  if (url.href === `${AUTH}/oauth2/token` && method === 'POST') {
    const form = new URLSearchParams(String(init?.body))
    const client = wispr.clients.find((c) => c.id === form.get('client_id') && c.secret === form.get('client_secret'))
    if (!client) return json({ error: 'invalid_client' }, 401)
    if (form.get('resource') !== MCP) return json({ error: 'invalid_target' }, 400)
    if (form.get('grant_type') === 'authorization_code') {
      const code = wispr.codes.get(form.get('code') ?? '')
      wispr.codes.delete(form.get('code') ?? '')
      if (!code || code.clientId !== client.id || code.redirect !== form.get('redirect_uri') || (await challengeOf(form.get('code_verifier') ?? '')) !== code.challenge) return json({ error: 'invalid_grant' }, 400)
      return json(issue())
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (wispr.refresh === 'invalid_grant') return json({ error: 'invalid_grant' }, 400)
      if (wispr.refresh === 'down') return json({}, 503)
      return json(issue())
    }
    return json({ error: 'unsupported_grant_type' }, 400)
  }
  return json({ error: 'not faked' }, 404)
}

/** What the browser does at Wispr Flow's sign-in: approve, and come back with a code for that PKCE challenge. */
function approve(authorize: string) {
  const u = new URL(authorize)
  const code = `code-${wispr.codes.size + 1}`
  wispr.codes.set(code, { challenge: u.searchParams.get('code_challenge') ?? '', clientId: u.searchParams.get('client_id') ?? '', redirect: u.searchParams.get('redirect_uri') ?? '' })
  return `/wispr/callback?code=${code}&state=${encodeURIComponent(u.searchParams.get('state') ?? '')}&iss=${encodeURIComponent(AUTH)}`
}

/* ---------- setup ---------- */

let logs: string[]
beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
  vi.stubEnv('GOOGLE_TOKEN_KEY', TEST_KEY)
  vi.stubEnv('CONVEX_SITE_URL', 'https://test.convex.site')
  vi.stubEnv('SITE_URL', 'https://nest.example.com')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  wispr = { dcr: true, meetings: [], tools: STANDARD_TOOLS, live: new Set(), refresh: 'ok', clients: [], codes: new Map(), calls: [], sse: false, n: 0 }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
  logs = []
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void logs.push(a.join(' ')))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const base = { firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'intro' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const kite = await ctx.db.insert('investors', { ...base, name: 'Kite Angels', firm: 'Kite Angels', stage: 'intro', maxStage: 'intro', email: 'sam@kite.example.com' })
    const orchard = await ctx.db.insert('investors', { ...base, name: 'Orchard', firm: 'Orchard', stage: 'm1', maxStage: 'm1', domains: ['orchard.example.com'] })
    return { dev, kite, orchard }
  })
  const meeting = (eventId: string, endedAgo: number, investorIds: Id<'investors'>[], title = 'Pesto x Kite Angels') => {
    const end = Date.now() - endedAgo
    return t.run((ctx) => ctx.db.insert('meetings', { userId: ids.dev, eventId, title, start: end - H, end, people: [{ email: 'sam@kite.example.com' }], investorIds, touched: true }))
  }
  /** A connection as it is after sign-in, with live tokens on the fake server. */
  const connected = async (o: { expired?: boolean; access?: string } = {}) => {
    const t1 = issue()
    const access = o.access ?? t1.access_token
    wispr.clients.push({ id: 'client-x', secret: 'secret-x', redirect: 'https://nest.example.com/wispr/callback' })
    return t.run(async (ctx) =>
      ctx.db.insert('wisprConnections', {
        userId: ids.dev, serverUrl: MCP, status: 'connected', resource: MCP, issuer: AUTH, authorizationEndpoint: `${AUTH}/oauth2/authorize`, tokenEndpoint: `${AUTH}/oauth2/token`,
        redirectUri: 'https://nest.example.com/wispr/callback', clientId: 'client-x', clientSecret: await encryptToken('secret-x'), authMethod: 'client_secret_post',
        accessToken: await encryptToken(access), refreshToken: await encryptToken(t1.refresh_token), expiresAt: Date.now() + (o.expired ? -M : H), connectedAt: Date.now(),
      }),
    )
  }
  const run = (connectionId: Id<'wisprConnections'>, days = 7, backfill = false) => t.action(internal.wispr.run, { connectionId, days, ...(backfill ? { backfill } : {}) })
  const fetches = () => t.run((ctx) => ctx.db.query('wisprFetches').collect())
  const notes = () => t.run((ctx) => ctx.db.query('notes').collect())
  const conn = (id: Id<'wisprConnections'>) => t.run((ctx) => ctx.db.get(id))
  return { t, ...ids, meeting, connected, run, fetches, notes, conn, asDev: t.withIdentity({ subject: `${ids.dev}|s1` }) }
}

/** Nothing private in the logs: no note text, titles or names. */
const cleanLogs = () => {
  for (const l of logs) for (const bad of [NOTE, SUMMARY, 'Kite', 'Orchard', 'Pesto x', 'retention', 'sam@']) expect(l).not.toContain(bad)
}

/* ---------- connecting ---------- */

describe('connect', () => {
  it('discovers the sign-in, registers Nest (DCR), and signs in with PKCE; tokens are sealed', async () => {
    const s = await setup()
    const authorize = await s.asDev.action(api.wispr.connect, { url: MCP + '/' })
    const u = new URL(authorize)
    expect(u.origin + u.pathname).toBe(`${AUTH}/oauth2/authorize`)
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code', client_id: 'client-1', code_challenge_method: 'S256', resource: MCP, scope: 'openid offline_access', redirect_uri: 'https://nest.example.com/wispr/callback',
    })
    expect(u.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
    expect(wispr.clients).toHaveLength(1)
    const pending = await s.t.run((ctx) => ctx.db.query('wisprConnections').unique())
    expect(pending).toMatchObject({ status: 'pending', serverUrl: MCP, clientId: 'client-1', authMethod: 'client_secret_post' })
    expect(pending!.clientSecret).not.toContain('secret-1')
    expect(await decryptToken(pending!.clientSecret!)).toBe('secret-1')
    expect(await s.asDev.query(api.wispr.status, {})).toMatchObject({ status: 'off', url: MCP })

    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const r = await s.t.fetch(approve(authorize))
    expect(r.status).toBe(302)
    expect(r.headers.get('Location')).toBe('https://nest.example.com/raise/settings?wisprConnect=ok')
    const c = await s.conn(pending!._id)
    expect(c!.status).toBe('connected')
    expect(c!.verifier).toBeUndefined()
    expect(c!.accessToken).not.toBe('at-1')
    expect(await decryptToken(c!.accessToken!)).toBe('at-1')
    expect(await decryptToken(c!.refreshToken!)).toBe('rt-1')
    expect(await s.asDev.query(api.wispr.status, {})).toMatchObject({ status: 'connected', host: 'wispr.example.com', fetching: false })
    // The status never carries a token or a secret.
    expect(JSON.stringify(await s.asDev.query(api.wispr.status, {}))).not.toMatch(/at-1|rt-1|secret-1|client-1/)
  })

  it('reuses the registered client on Reconnect', async () => {
    const s = await setup()
    await s.asDev.action(api.wispr.connect, { url: MCP })
    await s.asDev.action(api.wispr.connect, { url: MCP })
    expect(wispr.clients).toHaveLength(1)
  })

  it('stops and says so when the server has no dynamic client registration', async () => {
    const s = await setup()
    wispr.dcr = false
    await expect(s.asDev.action(api.wispr.connect, { url: MCP })).rejects.toThrow(/dynamic client registration/)
    expect(await s.t.run((ctx) => ctx.db.query('wisprConnections').collect())).toHaveLength(0)
    expect(wispr.clients).toHaveLength(0)
  })

  it('refuses a URL that isn’t https, and one that leads to no sign-in', async () => {
    const s = await setup()
    await expect(s.asDev.action(api.wispr.connect, { url: 'http://wispr.example.com/mcp' })).rejects.toThrow(/https URL/)
    await expect(s.asDev.action(api.wispr.connect, { url: 'https://elsewhere.example.com/mcp' })).rejects.toThrow(/didn’t lead to a sign-in/)
  })

  it('the callback refuses a bad verifier, an expired state and a denial', async () => {
    const s = await setup()
    const authorize = await s.asDev.action(api.wispr.connect, { url: MCP })
    const u = new URL(authorize)
    u.searchParams.set('code_challenge', 'not-the-challenge-for-this-verifier-xxxxxxx')
    expect((await s.t.fetch(approve(u.href))).headers.get('Location')).toMatch(/wisprConnect=error$/)
    const late = encodeURIComponent(await signState({ u: s.dev, exp: Date.now() - 1 }))
    expect((await s.t.fetch(`/wispr/callback?code=x&state=${late}`)).headers.get('Location')).toMatch(/wisprConnect=expired$/)
    const ok = encodeURIComponent(new URL(authorize).searchParams.get('state')!)
    expect((await s.t.fetch(`/wispr/callback?error=access_denied&state=${ok}`)).headers.get('Location')).toMatch(/wisprConnect=denied$/)
    expect((await s.t.run((ctx) => ctx.db.query('wisprConnections').unique()))!.status).toBe('pending')
  })

  it('comes back on the production host in prod, localhost in dev, and the deployment elsewhere', () => {
    expect(redirectUri()).toBe('https://nest.example.com/wispr/callback')
    vi.stubEnv('SITE_URL', 'http://localhost:3000')
    expect(redirectUri()).toBe('http://localhost:3000/wispr/callback')
    vi.stubEnv('SITE_URL', '')
    expect(redirectUri()).toBe('https://test.convex.site/wispr/callback')
  })

  it('reads WWW-Authenticate', () => {
    expect(parseWwwAuthenticate('Bearer resource_metadata="https://x.example.com/.well-known/oauth-protected-resource", scope="openid offline_access"')).toEqual({
      resource_metadata: 'https://x.example.com/.well-known/oauth-protected-resource', scope: 'openid offline_access',
    })
  })
})

/* ---------- fetching ---------- */

describe('fetch after investor meetings', () => {
  it('finds the note by calendar id and saves it on the investor and meeting, source wispr', async () => {
    const s = await setup()
    const id = await s.connected()
    const m = await s.meeting('ev-1', 2 * H, [s.kite])
    wispr.meetings.push({ id: 'w-1', calendarId: 'ev-1', title: 'Pesto x Kite Angels', start: Date.now() - 3 * H, end: Date.now() - 2 * H })
    await s.run(id)
    const [note] = await s.notes()
    expect(note).toMatchObject({ investorId: s.kite, meetingId: m, source: 'wispr', title: 'Pesto x Kite Angels' })
    expect(note.text).toContain(NOTE)
    expect(note.text).toContain(SUMMARY)
    expect(await s.fetches()).toMatchObject([{ meetingId: m, status: 'saved', wisprId: 'w-1', via: 'calendar', attempts: 1, noteId: note._id }])
    expect(wispr.calls.map((c) => c.tool)).toEqual(['get_meeting_by_calendar_id'])
    expect(wispr.calls[0].args).toEqual({ calendar_id: 'ev-1' })
    expect((await s.conn(id))!.lastFetch).toMatchObject({ count: 1 })
    expect((await s.conn(id))!.lockUntil).toBeUndefined()
    cleanLogs()
  })

  it('falls back to search_meetings (start ±15 min and the title), then get_meeting', async () => {
    const s = await setup()
    const id = await s.connected()
    const m = await s.meeting('ev-2', 30 * M, [s.kite])
    const start = Date.now() - 30 * M - H
    wispr.meetings.push(
      { id: 'w-other', title: 'Weekly standup', start: start + 5 * M, end: start + H },
      { id: 'w-2', title: 'Kite Angels <> Pesto', start: start + 7 * M, end: start + H },
      { id: 'w-late', title: 'Pesto x Kite Angels', start: start + 40 * M, end: start + 2 * H },
    )
    wispr.sse = true
    await s.run(id)
    expect(wispr.calls.map((c) => c.tool)).toEqual(['get_meeting_by_calendar_id', 'search_meetings', 'get_meeting'])
    const search = wispr.calls[1].args
    expect(Object.keys(search).sort()).toEqual(['limit', 'since', 'until'])
    expect(wispr.calls[2].args).toEqual({ meeting_id: 'w-2' })
    expect(await s.fetches()).toMatchObject([{ meetingId: m, status: 'saved', wisprId: 'w-2', via: 'search' }])
    expect(await s.notes()).toHaveLength(1)
    cleanLogs()
  })

  it('builds every argument from the schemas tools/list returned', async () => {
    const s = await setup()
    wispr.tools = [
      { name: 'get_meeting_by_calendar_id', inputSchema: { type: 'object', properties: { eventRef: { type: 'string' } }, required: ['eventRef'] } },
      { name: 'search_meetings', inputSchema: { type: 'object', properties: { text: { type: 'string' }, startedAfter: { type: 'integer', description: 'Unix seconds' }, startedBefore: { type: 'integer' } }, required: ['text'] } },
      { name: 'get_meeting', inputSchema: { type: 'object', properties: { recording: { type: 'string' } }, required: ['recording'] } },
    ]
    const id = await s.connected()
    await s.meeting('ev-3', H, [s.kite])
    wispr.meetings.push({ id: 'w-3', title: 'Pesto x Kite Angels', start: Date.now() - 2 * H + 3 * M, end: Date.now() - H })
    await s.run(id)
    expect(wispr.calls[0].args).toEqual({ eventRef: 'ev-3' })
    expect(Object.keys(wispr.calls[1].args).sort()).toEqual(['startedAfter', 'startedBefore', 'text'])
    expect(typeof wispr.calls[1].args.startedAfter).toBe('number')
    expect(wispr.calls[2].args).toEqual({ recording: 'w-3' })
    expect(await s.notes()).toHaveLength(1)
  })

  it('never fetches the same note twice', async () => {
    const s = await setup()
    const id = await s.connected()
    await s.meeting('ev-4', 2 * H, [s.kite])
    wispr.meetings.push({ id: 'w-4', calendarId: 'ev-4', title: 'Pesto x Kite Angels', start: Date.now() - 3 * H, end: Date.now() - 2 * H })
    await s.run(id)
    await s.run(id)
    expect(await s.notes()).toHaveLength(1)
    expect(wispr.calls).toHaveLength(1)
    // The same Wispr meeting found again for another calendar meeting: not fetched, not saved.
    const twin = await s.meeting('ev-4-copy', 2 * H, [s.kite])
    wispr.calls = []
    await s.run(id)
    expect(wispr.calls.map((c) => c.tool)).toEqual(['get_meeting_by_calendar_id', 'search_meetings'])
    expect(await s.notes()).toHaveLength(1)
    expect((await s.fetches()).find((f) => f.meetingId === twin)).toMatchObject({ status: 'duplicate', wisprId: 'w-4' })
  })

  it('sends a note it can’t tie to one investor to Unmatched notes', async () => {
    const s = await setup()
    const id = await s.connected()
    await s.meeting('ev-5', 2 * H, [s.kite, s.orchard], 'Catch-up')
    wispr.meetings.push({ id: 'w-5', calendarId: 'ev-5', title: 'Catch-up', start: Date.now() - 3 * H, end: Date.now() - 2 * H })
    await s.run(id)
    expect(await s.notes()).toHaveLength(0)
    const [u] = await s.t.run((ctx) => ctx.db.query('unmatchedNotes').collect())
    expect(u).toMatchObject({ source: 'wispr', meetingTitle: 'Catch-up' })
    expect(u.text).toContain(NOTE)
    expect(await s.fetches()).toMatchObject([{ status: 'unmatched', wisprId: 'w-5', unmatchedId: u._id }])
  })

  it('records attempts while there’s no note yet, and stops after 7 days', async () => {
    const s = await setup()
    const id = await s.connected()
    const fresh = await s.meeting('ev-6', H, [s.kite])
    const old = await s.meeting('ev-old', 8 * D, [s.kite])
    await s.meeting('ev-just-ended', 2 * M, [s.kite])
    await s.meeting('ev-nobody', H, [])
    await s.run(id)
    await s.run(id)
    expect(await s.fetches()).toMatchObject([{ meetingId: fresh, status: 'waiting', attempts: 2 }])
    expect(await s.t.mutation(internal.wispr.record, { meetingId: old, userId: s.dev, found: null })).toBe('gaveup')
    expect(await s.t.query(internal.wispr.candidates, { connectionId: id, days: 30, retry: false })).toHaveLength(1)
    expect((await s.t.query(internal.wispr.candidates, { connectionId: id, days: 30, retry: true })).map((c) => c.meetingId)).toEqual([fresh, old])
    expect((await s.conn(id))!.lastFetch).toBeUndefined()
    expect((await s.conn(id))!.lastCheckAt).toBeGreaterThan(0)
  })

  it('Fetch past 30 days covers older meetings', async () => {
    const s = await setup()
    const id = await s.connected()
    const m = await s.meeting('ev-7', 20 * D, [s.kite])
    wispr.meetings.push({ id: 'w-7', calendarId: 'ev-7', title: 'Pesto x Kite Angels', start: Date.now() - 20 * D - H, end: Date.now() - 20 * D })
    await s.run(id)
    expect(await s.notes()).toHaveLength(0)
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await s.asDev.mutation(api.wispr.fetchPast, {})
    expect(await s.asDev.query(api.wispr.status, {})).toMatchObject({ fetching: true })
    await s.run(id, 30, true)
    expect(await s.notes()).toMatchObject([{ meetingId: m, source: 'wispr' }])
    expect(await s.asDev.query(api.wispr.status, {})).toMatchObject({ status: 'connected', fetching: false, lastFetch: { count: 1 } })
  })
})

/* ---------- tokens ---------- */

describe('tokens', () => {
  it('refreshes an expired access token and keeps the rotated refresh token', async () => {
    const s = await setup()
    const id = await s.connected({ expired: true })
    await s.meeting('ev-8', H, [s.kite])
    wispr.meetings.push({ id: 'w-8', calendarId: 'ev-8', title: 'Pesto x Kite Angels', start: Date.now() - 2 * H, end: Date.now() - H })
    await s.run(id)
    const c = await s.conn(id)
    expect(await decryptToken(c!.accessToken!)).toBe('at-2')
    expect(await decryptToken(c!.refreshToken!)).toBe('rt-2')
    expect(c!.expiresAt).toBeGreaterThan(Date.now())
    expect(await s.notes()).toHaveLength(1)
  })

  it('refreshes once when the server says 401 before the token’s time is up', async () => {
    const s = await setup()
    const id = await s.connected({ access: 'revoked-early' })
    await s.run(id)
    const c = await s.conn(id)
    expect(c!.status).toBe('connected')
    expect(await decryptToken(c!.accessToken!)).toBe('at-2')
  })

  it('marks the connection “needs reconnecting” when the refresh is refused, and the cron skips it', async () => {
    const s = await setup()
    const id = await s.connected({ expired: true })
    wispr.refresh = 'invalid_grant'
    await s.meeting('ev-9', H, [s.kite])
    await s.run(id)
    expect((await s.conn(id))!.status).toBe('reconnect')
    expect(await s.asDev.query(api.wispr.status, {})).toMatchObject({ status: 'reconnect' })
    expect(await s.t.mutation(internal.wispr.tick, {})).toBe(0)
    expect(await s.fetches()).toHaveLength(0)
    await expect(s.asDev.mutation(api.wispr.fetchPast, {})).rejects.toThrow(/reconnecting/)
    cleanLogs()
  })

  it('keeps the connection when Wispr Flow is down, and tries again next time', async () => {
    const s = await setup()
    const id = await s.connected({ expired: true })
    wispr.refresh = 'down'
    await s.run(id)
    expect(await s.conn(id)).toMatchObject({ status: 'connected', lastError: 'Token request failed (503)' })
    expect(await s.t.mutation(internal.wispr.tick, {})).toBe(1)
  })

  it('Disconnect forgets the tokens and keeps what was fetched', async () => {
    const s = await setup()
    const id = await s.connected()
    await s.meeting('ev-10', H, [s.kite])
    wispr.meetings.push({ id: 'w-10', calendarId: 'ev-10', title: 'Pesto x Kite Angels', start: Date.now() - 2 * H, end: Date.now() - H })
    await s.run(id)
    await s.asDev.mutation(api.wispr.disconnect, {})
    expect(await s.conn(id)).toBeNull()
    expect(await s.notes()).toHaveLength(1)
    expect(await s.fetches()).toHaveLength(1)
    expect(await s.asDev.query(api.wispr.status, {})).toMatchObject({ status: 'off' })
  })
})

/* ---------- Nest's read ---------- */

describe('Read meeting notes', () => {
  async function fetchOne(meetingNotes: boolean) {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real')
    const s = await setup()
    if (!meetingNotes) await s.t.run((ctx) => ctx.db.insert('settings', { key: 'ai', meetingNotes: false }))
    const id = await s.connected()
    await s.meeting('ev-11', H, [s.kite])
    wispr.meetings.push({ id: 'w-11', calendarId: 'ev-11', title: 'Pesto x Kite Angels', start: Date.now() - 2 * H, end: Date.now() - H })
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await s.run(id)
    return { s, reads: await s.t.run((ctx) => ctx.db.query('noteReads').collect()) }
  }

  it('on: the note is read as usual (its proposals go to Suggestions)', async () => {
    const { s, reads } = await fetchOne(true)
    const [note] = await s.notes()
    expect(reads).toMatchObject([{ noteId: note._id, investorId: s.kite, auto: true, status: 'reading' }])
    expect(await s.asDev.query(api.wispr.status, {})).toMatchObject({ reads: true })
  })

  it('off: the note is saved but not read', async () => {
    const { s, reads } = await fetchOne(false)
    expect(await s.notes()).toHaveLength(1)
    expect(reads).toHaveLength(0)
    expect(await s.asDev.query(api.wispr.status, {})).toMatchObject({ reads: false })
  })
})
