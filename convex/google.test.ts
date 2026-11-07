// @vitest-environment edge-runtime
// PST-263: Calendar and Gmail sync against a fake Google (fetch is mocked; nothing here calls Google).
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { decryptToken, encryptToken, signState, verifyState } from './lib/crypto'
import { parseEvent, parseThread } from './lib/googleApi'

const modules = import.meta.glob('./**/*.ts')

const H = 36e5
const D = 24 * H
// A made-up 32-byte key for tests only.
const TEST_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)))

/* ---------- a fake Google ---------- */

type Ev = Record<string, unknown>
type Th = { id: string; messages: { id: string; threadId: string; internalDate: string; labelIds?: string[]; payload: { headers: { name: string; value: string }[] } }[] }
let google: { events: Ev[]; changes: Ev[]; threads: Th[]; history: string[]; calls: string[]; revoked: string[] }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  google.calls.push(`${init?.method ?? 'GET'} ${url.pathname}`)
  const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
  if (url.href.startsWith('https://oauth2.googleapis.com/token')) {
    if (form.get('grant_type') === 'authorization_code')
      return Promise.resolve(json({ access_token: 'access-new', refresh_token: 'refresh-from-code', scope: 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.metadata' }))
    if (form.get('refresh_token') === 'refresh-revoked') return Promise.resolve(json({ error: 'invalid_grant' }, 400))
    return Promise.resolve(json({ access_token: 'access-1' }))
  }
  if (url.href.startsWith('https://oauth2.googleapis.com/revoke')) {
    google.revoked.push(form.get('token') ?? '')
    return Promise.resolve(json({}))
  }
  if (url.pathname.endsWith('/calendars/primary/events')) {
    if (url.searchParams.get('syncToken')) return Promise.resolve(json({ items: google.changes, nextSyncToken: 'sync-2' }))
    return Promise.resolve(json({ items: google.events, nextSyncToken: 'sync-1' }))
  }
  if (url.pathname.endsWith('/users/me/profile')) return Promise.resolve(json({ emailAddress: 'founder@pestokids.com', historyId: '100' }))
  if (url.pathname.endsWith('/users/me/threads')) return Promise.resolve(json({ threads: google.threads.map((t) => ({ id: t.id })) }))
  const th = /\/users\/me\/threads\/([^/]+)$/.exec(url.pathname)
  if (th) return Promise.resolve(json(google.threads.find((t) => t.id === th[1])))
  if (url.pathname.endsWith('/users/me/history'))
    return Promise.resolve(json({ history: google.history.map((threadId) => ({ messagesAdded: [{ message: { id: 'm-' + threadId, threadId } }] })), historyId: '101' }))
  return Promise.resolve(json({ error: 'not faked' }, 500))
}

const at = (ms: number) => new Date(ms).toISOString()
const event = (id: string, start: number, emails: string[], extra: Ev = {}): Ev => ({
  id, status: 'confirmed', summary: `Call ${id}`, htmlLink: `https://calendar.example.com/${id}`,
  start: { dateTime: at(start) }, end: { dateTime: at(start + H) },
  attendees: [{ email: 'founder@pestokids.com', self: true, responseStatus: 'accepted' }, ...emails.map((email) => ({ email }))],
  ...extra,
})
const msg = (threadId: string, n: number, from: string, to: string, when: number, subject = 'Re: Pesto') => ({
  id: `${threadId}-${n}`, threadId, internalDate: String(when), labelIds: ['INBOX'],
  payload: { headers: [{ name: 'From', value: from }, { name: 'To', value: to }, { name: 'Subject', value: subject }] },
})

/* ---------- setup ---------- */

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com,teammate@pestokids.com')
  vi.stubEnv('GOOGLE_TOKEN_KEY', TEST_KEY)
  vi.stubEnv('AUTH_GOOGLE_ID', 'test-client-id')
  vi.stubEnv('AUTH_GOOGLE_SECRET', 'test-client-secret')
  vi.stubEnv('CONVEX_SITE_URL', 'https://test.convex.site')
  vi.stubEnv('SITE_URL', 'http://localhost:3000')
  google = { events: [], changes: [], threads: [], history: [], calls: [], revoked: [] }
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const base = { firm: '', type: 'Angel' as const, geo: 'India' as const, warmth: 'intro' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const adi = await ctx.db.insert('users', { email: 'teammate@pestokids.com', name: 'Teammate', emailVerificationTime: 1 })
    const out = await ctx.db.insert('users', { email: 'someone@elsewhere.example.com', name: 'Out', emailVerificationTime: 1 })
    const kite = await ctx.db.insert('investors', { ...base, name: 'Kite Angels', stage: 'intro', maxStage: 'intro', email: 'sam@kite.example.com', lastTouch: '2026-10-01' })
    const orchard = await ctx.db.insert('investors', { ...base, name: 'Orchard', stage: 'm2', maxStage: 'm2', domains: ['orchard.example.com'], nextStep: 'Partner call', nextDate: '2099-01-01' })
    const fern = await ctx.db.insert('investors', { ...base, name: 'Fernhill', stage: 'm2', maxStage: 'm2', email: 'ana@fernhill.example.com' })
    return { dev, adi, out, kite, orchard, fern }
  })
  const connect = async (userId: Id<'users'>, email: string, refresh = 'refresh-ok') =>
    t.run(async (ctx) =>
      ctx.db.insert('googleConnections', { userId, googleEmail: email, refreshToken: await encryptToken(refresh), status: 'syncing', connectedAt: Date.now() }),
    )
  return { t, ...ids, connect, asDev: t.withIdentity({ subject: `${ids.dev}|s1` }), asAdi: t.withIdentity({ subject: `${ids.adi}|s2` }), asOut: t.withIdentity({ subject: `${ids.out}|s3` }) }
}

/* ---------- tests ---------- */

describe('token storage', () => {
  it('seals and opens refresh tokens with GOOGLE_TOKEN_KEY', async () => {
    const sealed = await encryptToken('refresh-abc')
    expect(sealed).not.toContain('refresh-abc')
    expect(await decryptToken(sealed)).toBe('refresh-abc')
  })
  it('signs the OAuth state and rejects tampering and expiry', async () => {
    const s = await signState({ u: 'user1', exp: Date.now() + 6e4 })
    expect(await verifyState(s)).toMatchObject({ u: 'user1' })
    expect(await verifyState(s.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')))).toBeNull()
    expect(await verifyState(await signState({ u: 'user1', exp: Date.now() - 1 }))).toBeNull()
  })
})

describe('parsing', () => {
  it('keeps outside attendees only and drops cancelled, all-day, declined and internal events', () => {
    const now = Date.now()
    expect(parseEvent(event('a', now, ['sam@kite.example.com', 'teammate@pestokids.com', 'room@resource.calendar.google.com']) as never, 'founder@pestokids.com')).toMatchObject({
      eventId: 'a', people: [{ email: 'sam@kite.example.com' }],
    })
    expect(parseEvent(event('b', now, ['teammate@pestokids.com']) as never, 'founder@pestokids.com')).toEqual({ drop: 'b' })
    expect(parseEvent({ id: 'c', status: 'cancelled' }, 'founder@pestokids.com')).toEqual({ drop: 'c' })
    expect(parseEvent({ id: 'd', start: { date: '2026-11-07' }, end: { date: '2026-11-08' }, attendees: [{ email: 'x@kite.example.com' }] }, 'founder@pestokids.com')).toEqual({ drop: 'd' })
    expect(parseEvent(event('e', now, ['sam@kite.example.com'], { attendees: [{ email: 'founder@pestokids.com', self: true, responseStatus: 'declined' }, { email: 'sam@kite.example.com' }] }) as never, 'founder@pestokids.com')).toEqual({ drop: 'e' })
  })
  it('reads a thread from headers only: subject, everyone, who sent last; drafts skipped', () => {
    const now = Date.now()
    const t = parseThread(
      {
        id: 't1',
        messages: [
          msg('t1', 1, 'Dev <founder@pestokids.com>', 'Sam <sam@kite.example.com>', now - 3 * D, 'Pesto deck'),
          msg('t1', 2, 'Sam <sam@kite.example.com>', 'founder@pestokids.com, "Lee, A" <lee@kite.example.com>', now - 2 * D, 'Re: Pesto deck'),
          { ...msg('t1', 3, 'founder@pestokids.com', 'sam@kite.example.com', now - D), labelIds: ['DRAFT'] },
        ],
      },
      'founder@pestokids.com',
    )
    expect(t).toMatchObject({ subject: 'Pesto deck', lastFrom: 'them', lastFromEmail: 'sam@kite.example.com', count: 2, lastAt: now - 2 * D })
    expect(t!.participants).toEqual(['founder@pestokids.com', 'sam@kite.example.com', 'lee@kite.example.com'])
    expect(t!.link).toBe('https://mail.google.com/mail/?authuser=founder%40pestokids.com#all/t1')
    expect(JSON.stringify(t)).not.toMatch(/snippet|body/)
  })
})

describe('sync', () => {
  it('turns events and threads into meetings and email touches, moving stages forward only', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.events = [
      event('ahead', now + 2 * D, ['sam@kite.example.com']), // Kite: intro → Booked, next step set
      event('past', now - 2 * D, ['partner@orchard.example.com']), // Orchard (domain): Last touch only, stays 2nd meeting
      event('ahead-orchard', now + 3 * D, ['partner@orchard.example.com']), // already past Booked: no stage change
      event('internal', now + D, ['teammate@pestokids.com']), // not kept
      event('stranger', now - D, ['priya@northstar.example.com']), // kept, matches nobody (Who's this?)
    ]
    google.threads = [
      { id: 'th-kite', messages: [msg('th-kite', 1, 'sam@kite.example.com', 'founder@pestokids.com', now - 3 * D)] },
      { id: 'th-news', messages: [msg('th-news', 1, 'news@shop.example.com', 'founder@pestokids.com', now - D, 'Sale!')] },
    ]
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')

    const state = await s.t.run(async (ctx) => ({
      meetings: await ctx.db.query('meetings').collect(),
      threads: await ctx.db.query('emailTouches').collect(),
      kite: await ctx.db.get(s.kite),
      orchard: await ctx.db.get(s.orchard),
      acts: await ctx.db.query('activities').collect(),
      conn: await ctx.db.get(conn),
    }))
    expect(state.meetings.map((m) => m.eventId).sort()).toEqual(['ahead', 'ahead-orchard', 'past', 'stranger'])
    expect(state.meetings.find((m) => m.eventId === 'stranger')!.investorIds).toEqual([])
    // Only the thread with an investor is stored, and nothing but headers.
    expect(state.threads.map((t) => t.threadId)).toEqual(['th-kite'])
    expect(state.threads[0]).toMatchObject({ subject: 'Re: Pesto', lastFrom: 'them', investorIds: [s.kite] })
    expect(state.kite).toMatchObject({ stage: 'booked', maxStage: 'booked', nextStep: 'Meeting: Call ahead' })
    expect(state.orchard).toMatchObject({ stage: 'm2', nextStep: 'Meeting: Call ahead-orchard' })
    expect(state.orchard!.lastTouch).toBeTruthy()
    expect(state.acts).toEqual([expect.objectContaining({ investorId: s.kite, kind: 'stage', stage: 'booked', source: 'calendar', userId: s.dev })])
    expect(state.conn).toMatchObject({ status: 'connected', calendarSyncToken: 'sync-1', gmailHistoryId: '100' })
    expect(state.conn!.lastSyncAt).toBeTypeOf('number')
    expect(state.conn!.scan).toBeUndefined()
    expect(state.conn!.lockUntil).toBeUndefined()
  })

  it('is idempotent: the same events and threads again change nothing', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.events = [event('ahead', now + 2 * D, ['sam@kite.example.com']), event('past', now - 2 * D, ['ana@fernhill.example.com'])]
    google.threads = [{ id: 'th-kite', messages: [msg('th-kite', 1, 'sam@kite.example.com', 'founder@pestokids.com', now - 3 * D)] }]
    await s.t.action(internal.googleSync.run, { connectionId: conn })
    const snap = () =>
      s.t.run(async (ctx) => ({
        meetings: (await ctx.db.query('meetings').collect()).map(({ _creationTime, ...m }) => m),
        threads: (await ctx.db.query('emailTouches').collect()).map(({ _creationTime, ...t }) => t),
        acts: (await ctx.db.query('activities').collect()).length,
        kite: await ctx.db.get(s.kite),
      }))
    const first = await snap()
    // Incremental Calendar returns the same events; Gmail history points at the same thread.
    google.changes = google.events
    google.history = ['th-kite']
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    // And straight through the upserts again.
    const items = google.events.map((e) => parseEvent(e as never, 'founder@pestokids.com')).filter((x) => !('drop' in x)) as never[]
    await s.t.mutation(internal.google.upsertMeetings, { userId: s.dev, self: 'founder@pestokids.com', items, drops: [] })
    await s.t.mutation(internal.google.upsertThreads, { userId: s.dev, self: 'founder@pestokids.com', items: [parseThread(google.threads[0] as never, 'founder@pestokids.com')!] })
    const second = await snap()
    expect(second.meetings).toEqual(first.meetings)
    expect(second.threads).toEqual(first.threads)
    expect(second.acts).toBe(first.acts)
    expect({ ...second.kite, updatedAt: 0 }).toEqual({ ...first.kite, updatedAt: 0 })
    expect(google.calls).toContain('GET /gmail/v1/users/me/history')
  })

  it('a meeting that has since ended sets Last touch once', async () => {
    const s = await setup()
    const start = Date.now() - 2 * H
    await s.t.run((ctx) =>
      ctx.db.insert('meetings', { userId: s.dev, eventId: 'e', title: 'Call', start, end: start + H, people: [{ email: 'ana@fernhill.example.com' }], investorIds: [s.fern], touched: false }),
    )
    expect(await s.t.mutation(internal.google.applyPast, { userId: s.dev })).toBe(1)
    expect(await s.t.mutation(internal.google.applyPast, { userId: s.dev })).toBe(0)
    expect((await s.t.run((ctx) => ctx.db.get(s.fern)))!.lastTouch).toBeTruthy()
  })

  it('re-matches when an investor gains an email', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.events = [event('ahead', now + D, ['priya@northstar.example.com'])]
    await s.t.action(internal.googleSync.run, { connectionId: conn })
    const priya = await s.t.run((ctx) => ctx.db.insert('investors', { ...base, name: 'Priya', stage: 'ask', maxStage: 'ask', emails: ['priya@northstar.example.com'] }))
    await s.t.mutation(internal.google.rematch, { rescan: true })
    const r = await s.t.run(async (ctx) => ({ m: await ctx.db.query('meetings').first(), p: await ctx.db.get(priya), c: await ctx.db.get(conn) }))
    expect(r.m!.investorIds).toEqual([priya])
    expect(r.p).toMatchObject({ stage: 'booked', nextStep: 'Meeting: Call ahead' })
    expect(r.c!.rescan).toBe(true)
  })

  it('a token Google revoked sets "needs reconnecting" and never throws', async () => {
    const s = await setup()
    const conn = await s.connect(s.dev, 'founder@pestokids.com', 'refresh-revoked')
    await expect(s.t.action(internal.googleSync.run, { connectionId: conn })).resolves.toBe('reconnect')
    const c = await s.t.run((ctx) => ctx.db.get(conn))
    expect(c).toMatchObject({ status: 'reconnect' })
    expect(c!.lockUntil).toBeUndefined()
    const d = await s.asDev.query(api.google.data, {})
    expect(d.me).toMatchObject({ status: 'reconnect', email: 'founder@pestokids.com' })
    // The cron leaves it alone until they reconnect; a later run is skipped, not retried.
    expect(await s.t.mutation(internal.google.tick, {})).toBe(0)
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('skipped')
  })

  it('a scope taken away (403) also asks to reconnect; an outage does not', async () => {
    const s = await setup()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input)
      if (u.includes('/calendars/')) return json({ error: { errors: [{ reason: 'insufficientPermissions' }] } }, 403)
      return fakeFetch(input, init)
    }))
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('reconnect')

    const s2 = await setup()
    const conn2 = await s2.connect(s2.dev, 'founder@pestokids.com')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => (String(input).includes('/calendars/') ? json({}, 503) : fakeFetch(input, init))))
    expect(await s2.t.action(internal.googleSync.run, { connectionId: conn2 })).toBe('error')
    expect(await s2.t.run((ctx) => ctx.db.get(conn2))).toMatchObject({ status: 'syncing', lastError: 'Google calendar failed (503)' })
  })
})

describe('connect and disconnect', () => {
  it('starts the consent flow with only the two read scopes, offline, with consent', async () => {
    const s = await setup()
    const url = new URL(await s.asDev.action(api.google.connect, {}))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.metadata')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('redirect_uri')).toBe('https://test.convex.site/google/callback')
    expect(await verifyState(url.searchParams.get('state')!)).toMatchObject({ u: s.dev })
  })

  it('without GOOGLE_TOKEN_KEY, connecting errors and nothing is stored', async () => {
    const s = await setup()
    vi.stubEnv('GOOGLE_TOKEN_KEY', '')
    await expect(s.asDev.action(api.google.connect, {})).rejects.toThrow(/GOOGLE_TOKEN_KEY/)
    const r = await s.t.fetch('/google/callback?code=c&state=x')
    expect(r.headers.get('Location')).toBe('http://localhost:3000/raise/settings?connect=nokey')
    expect(await s.t.run((ctx) => ctx.db.query('googleConnections').collect())).toEqual([])
  })

  it('the callback seals the refresh token, checks the account and starts syncing', async () => {
    const s = await setup()
    const state = await signState({ u: s.dev, exp: Date.now() + 6e4 })
    const r = await s.t.fetch(`/google/callback?code=abc&state=${encodeURIComponent(state)}`)
    expect(r.status).toBe(302)
    expect(r.headers.get('Location')).toBe('http://localhost:3000/raise/settings?connect=ok')
    const [c] = await s.t.run((ctx) => ctx.db.query('googleConnections').collect())
    expect(c).toMatchObject({ userId: s.dev, googleEmail: 'founder@pestokids.com', status: 'syncing' })
    expect(c.refreshToken).not.toContain('refresh-from-code')
    expect(await decryptToken(c.refreshToken)).toBe('refresh-from-code')
    // Someone else's state can't connect Dev's account to Aditya.
    const r2 = await s.t.fetch(`/google/callback?code=abc&state=${encodeURIComponent(await signState({ u: s.adi, exp: Date.now() + 6e4 }))}`)
    expect(r2.headers.get('Location')).toBe('http://localhost:3000/raise/settings?connect=account')
    // Outsiders and forged states store nothing.
    const r3 = await s.t.fetch(`/google/callback?code=abc&state=${encodeURIComponent(await signState({ u: s.out, exp: Date.now() + 6e4 }))}`)
    expect(r3.headers.get('Location')).toBe('http://localhost:3000/raise/settings?connect=denied')
    const r4 = await s.t.fetch('/google/callback?code=abc&state=forged.state')
    expect(r4.headers.get('Location')).toBe('http://localhost:3000/raise/settings?connect=expired')
    expect(await s.t.run((ctx) => ctx.db.query('googleConnections').collect())).toHaveLength(1)
  })

  it('disconnect deletes that user’s connection, meetings and email touches only', async () => {
    const s = await setup()
    const devConn = await s.connect(s.dev, 'founder@pestokids.com')
    const adiConn = await s.connect(s.adi, 'teammate@pestokids.com')
    await s.t.run(async (ctx) => {
      for (const [userId, n] of [[s.dev, 3], [s.adi, 2]] as const)
        for (let k = 0; k < n; k++) {
          await ctx.db.insert('meetings', { userId, eventId: `e${k}`, title: 'Call', start: Date.now() + k * H, end: Date.now() + (k + 1) * H, people: [{ email: 'sam@kite.example.com' }], investorIds: [s.kite] })
          await ctx.db.insert('emailTouches', { userId, threadId: `t${k}`, subject: 'Hi', participants: ['sam@kite.example.com'], lastAt: Date.now(), lastFrom: 'them', lastFromEmail: 'sam@kite.example.com', count: 1, link: 'x', investorIds: [s.kite] })
        }
    })
    expect(await s.asDev.mutation(api.google.disconnect, {})).toBe(6)
    const left = await s.t.run(async (ctx) => ({
      conns: (await ctx.db.query('googleConnections').collect()).map((c) => c._id),
      meetings: (await ctx.db.query('meetings').collect()).map((m) => m.userId),
      threads: (await ctx.db.query('emailTouches').collect()).map((t) => t.userId),
    }))
    expect(left.conns).toEqual([adiConn])
    expect(left.conns).not.toContain(devConn)
    expect(left.meetings).toEqual([s.adi, s.adi])
    expect(left.threads).toEqual([s.adi, s.adi])
    expect((await s.asDev.query(api.google.data, {})).me).toBeNull()
  })

  it('never returns the token, and refuses anyone requireUser refuses', async () => {
    const s = await setup()
    await s.connect(s.dev, 'founder@pestokids.com')
    await s.t.run((ctx) => ctx.db.insert('meetings', { userId: s.dev, eventId: 'mine', title: 'Private', start: Date.now(), end: Date.now() + H, people: [{ email: 'friend@example.com' }], investorIds: [] }))
    const d = await s.asDev.query(api.google.data, {})
    const text = JSON.stringify(d)
    expect(text).not.toContain('refresh')
    expect(text).not.toMatch(/"v1\./)
    expect(d.me).toMatchObject({ status: 'syncing', email: 'founder@pestokids.com', running: false })
    // A meeting that matched no investor is only shown to the person whose calendar it's on.
    expect(d.meetings.map((m) => m.eventId)).toEqual(['mine'])
    expect((await s.asAdi.query(api.google.data, {})).meetings).toEqual([])
    await expect(s.t.query(api.google.data, {})).rejects.toThrow(/Not signed in/)
    await expect(s.asOut.query(api.google.data, {})).rejects.toThrow(/doesn't have access/)
    await expect(s.t.action(api.google.connect, {})).rejects.toThrow(/Not signed in/)
    await expect(s.t.mutation(api.google.disconnect, {})).rejects.toThrow(/Not signed in/)
    await expect(s.asOut.mutation(api.google.syncNow, {})).rejects.toThrow(/doesn't have access/)
  })
})
