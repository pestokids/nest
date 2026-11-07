// @vitest-environment edge-runtime
// PST-276: the Nest MCP server. Keys (hashed, revoked, read vs suggest), the
// JSON-RPC protocol in both eras, the rate limit, and that every write is only a suggestion.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import schema from './schema'
import { hashKey } from './lib/agentKey'
import { CODE } from './mcpHttp'
import { todayIST } from '../src/lib/dates'
import { AGENT_TOOLS, RATE_LIMIT } from '../src/lib/agents'

const modules = import.meta.glob('./**/*.ts')
const V = 'io.modelcontextprotocol/protocolVersion'

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
  vi.stubEnv('SITE_URL', 'https://nest.example.com')
  vi.stubEnv('ANTHROPIC_API_KEY', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

type InvFields = Partial<Omit<Doc<'investors'>, '_id' | '_creationTime'>> & Pick<Doc<'investors'>, 'name' | 'stage'>
const base = { firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'intro' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: 'Follow up', notes: '', source: '', updatedAt: 0 }

/** Made-up investors: Kite Angels (1st meeting) and Larkspur (to do). */
async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const inv = (f: InvFields) => ctx.db.insert('investors', { ...base, maxStage: f.stage as Doc<'investors'>['maxStage'], ...f })
    const kite = await inv({ name: 'Kite Angels', firm: 'Kite Angels', stage: 'm1', email: 'sam@kite.example.com' })
    const lark = await inv({ name: 'Larkspur', firm: 'Larkspur', stage: 'todo', email: 'rowan@larkspur.example.com' })
    return { dev, kite, lark }
  })
  const as = t.withIdentity({ subject: `${ids.dev}|s1` })
  const read = await as.mutation(api.agents.create, { name: 'Claude', scope: 'read' })
  const grok = await as.mutation(api.agents.create, { name: '  Grok   Bot ', scope: 'suggest' })
  let n = 0
  /** One JSON-RPC request. */
  const rpc = async (key: string | null, method: string, params?: Record<string, unknown>, headers: Record<string, string> = {}) => {
    const res = await t.fetch('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, ...(params ? { params } : {}) }),
    })
    return { status: res.status, headers: res.headers, body: res.status === 202 ? null : await res.json() }
  }
  /** A 2026-07-28 request: _meta version plus the matching headers. */
  const modern = (key: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    rpc(key, method, { ...params, _meta: { [V]: '2026-07-28' } }, { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(typeof params.name === 'string' ? { 'Mcp-Name': params.name } : {}), ...headers })
  const call = (key: string, name: string, args: Record<string, unknown>) => rpc(key, 'tools/call', { name, arguments: args }, { 'MCP-Protocol-Version': '2025-06-18' })
  const snapshot = () =>
    t.run(async (ctx) => ({
      investors: await ctx.db.query('investors').collect(),
      activities: await ctx.db.query('activities').collect(),
      suggestions: await ctx.db.query('suggestions').collect(),
    }))
  return { t, as, ...ids, read, grok, rpc, modern, call, snapshot }
}

describe('keys', () => {
  it('stores only the SHA-256 and the 8-character prefix; the key comes back once', async () => {
    const s = await setup()
    expect(s.grok.key).toMatch(/^nest_ak_[A-Za-z0-9_-]{43}$/)
    expect(s.grok.name).toBe('Grok Bot')
    const row = await s.t.run((ctx) => ctx.db.get(s.grok.id))
    expect(row!.hash).toBe(await hashKey(s.grok.key))
    expect(row!.hash).not.toContain(s.grok.key.slice(8))
    expect(row!.prefix).toBe(s.grok.key.slice(8, 16))
    expect(JSON.stringify(row)).not.toContain(s.grok.key)
    const listed = await s.as.query(api.agents.list, {})
    expect(listed.serverUrl).toBe('https://nest.example.com/mcp')
    expect(listed.keys.map((k) => k.name)).toEqual(['Claude', 'Grok Bot'])
    expect(JSON.stringify(listed)).not.toContain(s.grok.key)
    expect(Object.keys(listed.keys[1])).not.toContain('hash')
  })

  it('needs a signed-in teammate to create, list or revoke', async () => {
    const s = await setup()
    await expect(s.t.mutation(api.agents.create, { name: 'X', scope: 'read' })).rejects.toThrow()
    await expect(s.t.query(api.agents.list, {})).rejects.toThrow()
    await expect(s.t.mutation(api.agents.revoke, { id: s.grok.id })).rejects.toThrow()
    await expect(s.as.mutation(api.agents.create, { name: '   ', scope: 'read' })).rejects.toThrow('Give the agent a name.')
  })

  it('refuses no key, an unknown key and a revoked key', async () => {
    const s = await setup()
    for (const key of [null, 'nest_ak_madeupmadeupmadeup', 'sk-not-ours']) {
      const r = await s.rpc(key, 'tools/list')
      expect(r.status).toBe(401)
      expect(r.body.error.code).toBe(CODE.unauthorized)
      expect(r.headers.get('WWW-Authenticate')).toContain('Bearer')
    }
    expect((await s.rpc(s.grok.key, 'ping')).status).toBe(200)
    await s.as.mutation(api.agents.revoke, { id: s.grok.id })
    const r = await s.rpc(s.grok.key, 'ping')
    expect(r.status).toBe(401)
    expect((await s.as.query(api.agents.list, {})).keys.map((k) => k.name)).toEqual(['Claude'])
  })

  it('refuses a browser from another site', async () => {
    const s = await setup()
    expect((await s.rpc(s.grok.key, 'ping', undefined, { Origin: 'https://evil.example.com' })).status).toBe(403)
    expect((await s.rpc(s.grok.key, 'ping', undefined, { Origin: 'https://nest.example.com' })).status).toBe(200)
  })
})

describe('protocol', () => {
  it('2025 era: initialize, the initialized notification, ping', async () => {
    const s = await setup()
    const init = await s.rpc(s.read.key, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
    expect(init.status).toBe(200)
    expect(init.body.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'nest' }, capabilities: { tools: {} } })
    const old = await s.rpc(s.read.key, 'initialize', { protocolVersion: '2024-11-05' })
    expect(old.body.result.protocolVersion).toBe('2025-11-25')
    const res = await s.t.fetch('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${s.read.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })
    expect(res.status).toBe(202)
    expect((await s.rpc(s.read.key, 'ping')).body.result).toEqual({})
  })

  it('2026-07-28: server/discover, and the headers must match the body', async () => {
    const s = await setup()
    const d = await s.modern(s.read.key, 'server/discover')
    expect(d.status).toBe(200)
    expect(d.body.result).toMatchObject({ resultType: 'complete', supportedVersions: expect.arrayContaining(['2026-07-28', '2025-06-18']) })
    const missing = await s.rpc(s.read.key, 'tools/list', { _meta: { [V]: '2026-07-28' } })
    expect(missing.status).toBe(400)
    expect(missing.body.error.code).toBe(CODE.headerMismatch)
    const wrongMethod = await s.modern(s.read.key, 'tools/list', {}, { 'Mcp-Method': 'ping' })
    expect(wrongMethod.body.error.code).toBe(CODE.headerMismatch)
    const wrongName = await s.modern(s.read.key, 'tools/call', { name: 'todays_moves', arguments: {} }, { 'Mcp-Name': 'search_investors' })
    expect(wrongName.body.error.code).toBe(CODE.headerMismatch)
    const encoded = await s.modern(s.read.key, 'tools/call', { name: 'todays_moves', arguments: {} }, { 'Mcp-Name': '=?base64?' + btoa('todays_moves') + '?=' })
    expect(encoded.body.result.isError).toBe(false)
    const future = await s.rpc(s.read.key, 'tools/list', { _meta: { [V]: '2099-01-01' } }, { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' })
    expect(future.status).toBe(400)
    expect(future.body.error).toMatchObject({ code: CODE.unsupportedVersion, data: { requested: '2099-01-01' } })
    const header = await s.rpc(s.read.key, 'tools/list', undefined, { 'MCP-Protocol-Version': '1999-01-01' })
    expect(header.body.error.code).toBe(CODE.unsupportedVersion)
  })

  it('tools/list matches the key: read keys only see the read tools', async () => {
    const s = await setup()
    const names = async (key: string) => (await s.rpc(key, 'tools/list')).body.result.tools.map((t: { name: string }) => t.name)
    expect(await names(s.read.key)).toEqual(['search_investors', 'get_investor', 'todays_moves', 'list_questions', 'round_totals', 'material_opens', 'meetings_between'])
    expect(await names(s.grok.key)).toEqual(AGENT_TOOLS.map((t) => t.name))
    const tools = (await s.modern(s.grok.key, 'tools/list')).body.result.tools
    expect(tools.every((t: { inputSchema: { type: string } }) => t.inputSchema.type === 'object')).toBe(true)
  })

  it('bad input gets a JSON-RPC error with a plain message', async () => {
    const s = await setup()
    const raw = (body: string) =>
      s.t.fetch('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${s.grok.key}`, 'Content-Type': 'application/json' }, body }).then(async (r) => ({ status: r.status, body: await r.json() }))
    expect((await raw('{nope')).body.error.code).toBe(CODE.parse)
    expect((await raw('[{"jsonrpc":"2.0","id":1,"method":"ping"}]')).body.error.code).toBe(CODE.invalidRequest)
    expect((await raw('{"id":1,"method":"ping"}')).body.error.code).toBe(CODE.invalidRequest)
    expect((await raw('{"jsonrpc":"2.0","id":1,"method":"ping","params":[1]}')).body.error.code).toBe(CODE.invalidParams)
    expect((await raw('x'.repeat(70 * 1024))).status).toBe(413)
    expect((await s.rpc(s.grok.key, 'resources/list')).body.error.code).toBe(CODE.methodNotFound)
    expect((await s.call(s.grok.key, 'drop_table', {})).body.error).toMatchObject({ code: CODE.invalidParams, message: 'Unknown tool: drop_table' })
    const bad = await s.call(s.grok.key, 'log_touch', { investorId: s.kite, kind: 'fax', date: '2026-11-01', note: 'x' })
    expect(bad.body.error).toMatchObject({ code: CODE.invalidParams, message: 'Invalid arguments for log_touch: kind must be one of: call, email, meeting, note.' })
    expect((await s.call(s.grok.key, 'get_investor', {})).body.error.message).toContain('id is required')
    expect((await s.call(s.grok.key, 'get_investor', { id: s.kite, extra: 1 })).body.error.message).toContain('extra')
    const nobody = await s.call(s.grok.key, 'get_investor', { id: 'not-an-id' })
    expect(nobody.body.result.isError).toBe(true)
    expect(JSON.stringify([bad.body, nobody.body])).not.toMatch(/at \w+ \(|\.ts:\d+/)
    expect((await s.t.fetch('/mcp', { method: 'GET' })).status).toBe(405)
  })

  it('serves the Nest skill', async () => {
    const s = await setup()
    const r = await s.t.fetch('/mcp/skill')
    expect(r.headers.get('Content-Type')).toContain('text/markdown')
    expect(await r.text()).toContain('https://nest.example.com/mcp')
  })
})

describe('tools', () => {
  it('read tools answer with structured content', async () => {
    const s = await setup()
    const found = await s.call(s.read.key, 'search_investors', { query: 'kite' })
    expect(found.body.result.structuredContent).toMatchObject({ count: 1, investors: [{ id: s.kite, name: 'Kite Angels', stage: expect.any(String), priority: expect.any(Number) }] })
    const one = await s.call(s.read.key, 'get_investor', { id: s.kite })
    expect(one.body.result.structuredContent.investor).toMatchObject({ name: 'Kite Angels', email: 'sam@kite.example.com' })
    expect((await s.call(s.read.key, 'todays_moves', {})).body.result.isError).toBe(false)
    expect((await s.call(s.read.key, 'list_questions', {})).body.result.structuredContent).toEqual({ count: 0, questions: [] })
  })

  it('a read key can’t call a write tool, and nothing is written', async () => {
    const s = await setup()
    const before = await s.snapshot()
    for (const name of ['log_touch', 'add_investor', 'suggest_change', 'enrich', 'add_meeting_notes']) {
      const r = await s.call(s.read.key, name, {})
      expect(r.body.error.code).toBe(CODE.invalidParams)
      expect(r.body.error.message).toContain('read only')
    }
    expect(await s.snapshot()).toEqual(before)
  })

  it('every write tool makes a suggestion from the agent, never a direct change', async () => {
    const s = await setup()
    const before = await s.snapshot()
    const today = todayIST()
    const writes: [string, Record<string, unknown>, string][] = [
      ['log_touch', { investorId: s.kite, kind: 'call', date: today, note: 'Called Sam, wants the deck by Friday.' }, 'touch'],
      ['add_investor', { name: 'Orchard Capital', firm: 'Orchard Capital', email: 'maya@orchard.example.com', note: 'Met at the summit.' }, 'new_investor'],
      ['suggest_change', { investorId: s.kite, kind: 'stage', value: 'Diligence', why: 'They asked for the data room.' }, 'stage'],
      ['suggest_change', { investorId: s.kite, kind: 'next_step', value: 'Send the data room', why: 'Asked on the call.', date: today }, 'next_step'],
      ['suggest_change', { investorId: s.kite, kind: 'expected', value: '$50K', why: 'Sam said around fifty.' }, 'expected'],
    ]
    for (const [name, args, kind] of writes) {
      const r = await s.call(s.grok.key, name, args)
      expect(r.body.result.isError, name).toBe(false)
      expect(r.body.result.structuredContent).toMatchObject({ suggested: true })
      const sg = await s.t.run((ctx) => ctx.db.get(r.body.result.structuredContent.suggestionId as Id<'suggestions'>))
      expect(sg).toMatchObject({ kind, source: 'agent', agentName: 'Grok Bot', safe: false })
    }
    const after = await s.snapshot()
    expect(after.investors).toEqual(before.investors)
    expect(after.activities).toEqual(before.activities)
    expect(after.suggestions).toHaveLength(before.suggestions.length + writes.length)
    const again = await s.call(s.grok.key, 'log_touch', writes[0][1])
    expect(again.body.result.structuredContent).toMatchObject({ suggested: false })
    expect((await s.snapshot()).suggestions).toHaveLength(after.suggestions.length)
  })

  it('write tools refuse what can’t be right', async () => {
    const s = await setup()
    const err = async (name: string, args: Record<string, unknown>) => {
      const r = await s.call(s.grok.key, name, args)
      expect(r.body.result.isError, name).toBe(true)
      return r.body.result.content[0].text as string
    }
    expect(await err('add_investor', { name: 'Kite Angels', firm: 'Kite Angels' })).toContain('already on the list')
    expect(await err('add_investor', { name: 'Sam', firm: '', email: 'SAM@kite.example.com' })).toContain('already on the list')
    expect(await err('log_touch', { investorId: s.kite, kind: 'call', date: '2099-01-01', note: 'x' })).toContain('future')
    expect(await err('suggest_change', { investorId: s.kite, kind: 'stage', value: 'm1', why: 'x' })).toContain('already at')
    expect(await err('suggest_change', { investorId: s.kite, kind: 'stage', value: 'moon', why: 'x' })).toContain('must be a stage')
    expect(await err('suggest_change', { investorId: s.kite, kind: 'expected', value: 'lots', why: 'x' })).toContain('US dollars')
    expect(await err('enrich', { investorId: s.kite, email: 'a@b.example.com' })).toContain('exactly one')
    expect(await err('enrich', { investorId: s.kite })).toContain('AI isn’t set up')
    expect((await s.snapshot()).suggestions).toHaveLength(0)
  })

  it('add_meeting_notes saves the notes on the matched investor, or keeps them in Unmatched notes (PST-277)', async () => {
    const s = await setup()
    const today = todayIST()
    const hit = await s.call(s.grok.key, 'add_meeting_notes', { email: 'SAM@kite.example.com', meetingTitle: 'Pesto × Kite Angels', date: today, text: 'Liked the retention story.', source: 'wispr' })
    expect(hit.body.result.isError).toBe(false)
    expect(hit.body.result.structuredContent).toMatchObject({ saved: true, matched: true, investorId: s.kite })
    expect(hit.body.result.structuredContent.message).toContain('Saved on Kite Angels')
    const byId = await s.call(s.grok.key, 'add_meeting_notes', { investorId: s.lark, meetingTitle: 'Coffee', date: today, text: 'Wants the deck.' })
    expect(byId.body.result.structuredContent).toMatchObject({ matched: true, investorId: s.lark })
    const miss = await s.call(s.grok.key, 'add_meeting_notes', { email: 'someone@gmail.com', meetingTitle: 'Coffee', date: today, text: 'Talked about the market.' })
    expect(miss.body.result.structuredContent).toMatchObject({ saved: true, matched: false })
    const { notes, unmatched } = await s.t.run(async (ctx) => ({ notes: await ctx.db.query('notes').collect(), unmatched: await ctx.db.query('unmatchedNotes').collect() }))
    expect(notes.map((n) => [n.investorId, n.source, n.text])).toEqual([
      [s.kite, 'wispr', 'Liked the retention story.'],
      [s.lark, 'agent', 'Wants the deck.'],
    ])
    expect(unmatched).toMatchObject([{ email: 'someone@gmail.com', meetingTitle: 'Coffee', source: 'agent' }])
    const err = async (args: Record<string, unknown>) => (await s.call(s.grok.key, 'add_meeting_notes', args)).body.result.content[0].text as string
    expect(await err({ investorId: 'nope', meetingTitle: 'x', date: today, text: 'x' })).toContain('no investor with that id')
    expect(await err({ meetingTitle: 'x', date: '2099-01-01', text: 'x' })).toContain('future')
    expect((await s.snapshot()).suggestions).toHaveLength(0)
  })

  it('accepting a new investor suggestion adds them; Undo takes them off again', async () => {
    const s = await setup()
    const r = await s.call(s.grok.key, 'add_investor', { name: 'Orchard Capital', firm: 'Orchard Capital', email: 'maya@orchard.example.com' })
    const id = r.body.result.structuredContent.suggestionId as Id<'suggestions'>
    expect(await s.as.mutation(api.suggestions.accept, { id })).toEqual({ applied: true })
    const added = (await s.snapshot()).investors.find((i) => i.name === 'Orchard Capital')
    expect(added).toMatchObject({ firm: 'Orchard Capital', email: 'maya@orchard.example.com' })
    await s.as.mutation(api.suggestions.undo, { ids: [id] })
    expect((await s.snapshot()).investors.find((i) => i.name === 'Orchard Capital')).toBeUndefined()
  })
})

describe('rate limit and Activity', () => {
  it('a key gets RATE_LIMIT calls a minute, then 429 with Retry-After; other keys are unaffected', async () => {
    const s = await setup()
    const now = Date.now()
    await s.t.run(async (ctx) => {
      for (let i = 0; i < RATE_LIMIT; i++) await ctx.db.insert('agentCalls', { keyId: s.grok.id, tool: 'ping', at: now - 30_000 + i, ok: true, ms: 1 })
    })
    const r = await s.rpc(s.grok.key, 'ping')
    expect(r.status).toBe(429)
    expect(r.body.error.code).toBe(CODE.rateLimited)
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect((await s.rpc(s.read.key, 'ping')).status).toBe(200)
    await s.t.run(async (ctx) => {
      for (const c of await ctx.db.query('agentCalls').collect()) if (c.keyId === s.grok.id) await ctx.db.patch(c._id, { at: c.at - 60_000 })
    })
    expect((await s.rpc(s.grok.key, 'ping')).status).toBe(200)
  })

  it('logs the tool, time, outcome and duration, never arguments; calls this week count tool calls only', async () => {
    const s = await setup()
    await s.rpc(s.grok.key, 'tools/list')
    await s.call(s.grok.key, 'search_investors', { query: 'secret-search-words' })
    await s.call(s.grok.key, 'log_touch', { investorId: s.kite, kind: 'fax', date: '2026-11-01', note: 'secret-note' })
    const calls = await s.as.query(api.agents.activity, { keyId: s.grok.id })
    expect(calls.map((c) => [c.tool, c.ok])).toEqual([['log_touch', false], ['search_investors', true], ['tools/list', true]])
    const rows = await s.t.run((ctx) => ctx.db.query('agentCalls').collect())
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['_creationTime', '_id', 'at', 'keyId', 'ms', 'ok', 'tool'])
    expect(JSON.stringify(rows)).not.toContain('secret')
    const grok = (await s.as.query(api.agents.list, {})).keys.find((k) => k.name === 'Grok Bot')!
    expect(grok.calls7d).toBe(2)
    expect(grok.lastUsedAt).toBeGreaterThan(0)
  })
})
