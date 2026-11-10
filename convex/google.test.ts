// @vitest-environment edge-runtime
// PST-263: Calendar and Gmail sync against a fake Google (fetch is mocked; nothing here calls Google).
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import schema from './schema'
import { decryptToken, encryptToken, signState, verifyState } from './lib/crypto'
import { inboundMessages, parseEvent, parseThread, RETRY } from './lib/googleApi'
import { mapLimit } from './lib/mapLimit'
import { PACE, THREADS_VERSION } from './googleSync'

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
      return Promise.resolve(json({ access_token: 'access-new', refresh_token: 'refresh-from-code', scope: 'openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly' }))
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
  if (url.pathname.endsWith('/users/me/threads')) {
    // Paged like Gmail: maxResults per page, the page token is just the offset.
    const from = Number(url.searchParams.get('pageToken') ?? 0)
    const to = from + Number(url.searchParams.get('maxResults') ?? 100)
    return Promise.resolve(json({ threads: google.threads.slice(from, to).map((t) => ({ id: t.id })), ...(to < google.threads.length ? { nextPageToken: String(to) } : {}) }))
  }
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
  // No real waiting between rate-limit retries, and no pacing unless a test sets a rate.
  RETRY.baseMs = 0
  PACE.threadsPerSecond = Infinity
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

  it('runs the suggestion checks when a sync finishes (PST-275)', async () => {
    const s = await setup()
    const now = Date.now()
    await s.t.run((ctx) => ctx.db.patch(s.kite, { stage: 'booked', maxStage: 'booked' }))
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.events = [event('met', now - D, ['sam@kite.example.com'])]
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    const rows = await s.t.run((ctx) => ctx.db.query('suggestions').collect())
    expect(rows).toContainEqual(expect.objectContaining({ kind: 'stage', investorId: s.kite, patch: { op: 'stage', from: 'booked', to: 'm1' }, source: 'calendar', status: 'open' }))
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
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/gmail.readonly')
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

/* ---------- Gmail errors: reasons, rate limits, skipped threads ---------- */

/** Google's error body for a 403 (or 429) with a reason. */
const refused = (reason: string, status = 403) => json({ error: { code: status, message: 'Refused', errors: [{ domain: 'usageLimits', reason, message: 'Refused' }], status: 'PERMISSION_DENIED' } }, status)
/** fetch that answers single-thread reads with `answer(threadId, attempt)` when it returns a Response, else the fake Google. */
function threadFetch(answer: (id: string, attempt: number) => Response | undefined) {
  const attempts = new Map<string, number>()
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const th = /\/users\/me\/threads\/([^/?]+)/.exec(String(input))
    if (th) {
      const n = (attempts.get(th[1]) ?? 0) + 1
      attempts.set(th[1], n)
      const r = answer(th[1], n)
      if (r) {
        google.calls.push(`GET thread ${th[1]} ${r.status}`)
        return r
      }
    }
    return fakeFetch(input, init)
  }))
  return attempts
}
const kiteThread = (id: string, when: number) => ({ id, messages: [msg(id, 1, 'sam@kite.example.com', 'founder@pestokids.com', when)] })
const newsThread = (id: string, when: number) => ({ id, messages: [msg(id, 1, 'news@shop.example.com', 'founder@pestokids.com', when, 'Sale!')] })

describe('Gmail errors', () => {
  it('puts Google’s 403 reason in lastError', async () => {
    const s = await setup()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => (new URL(String(input)).pathname.endsWith('/users/me/threads') ? refused('failedPrecondition') : fakeFetch(input, init))))
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('error')
    expect(await s.t.run((ctx) => ctx.db.get(conn))).toMatchObject({ lastError: 'Google gmail threads failed (403 failedPrecondition)' })
  })

  it('reads the reason from newer error shapes too, and never more than an identifier', async () => {
    const s = await setup()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      new URL(String(input)).pathname.endsWith('/users/me/profile')
        ? json({ error: { code: 403, message: 'secret-ish text', status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED <b>' }] } }, 403)
        : fakeFetch(input, init),
    ))
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('error')
    const c = await s.t.run((ctx) => ctx.db.get(conn))
    expect(c!.lastError).toBe('Google gmail profile failed (403 SERVICE_DISABLEDb)')
  })

  it('retries rateLimitExceeded and userRateLimitExceeded (and 429) with backoff, then carries on', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.threads = [kiteThread('th-a', now - D), kiteThread('th-b', now - 2 * D), kiteThread('th-c', now - 3 * D)]
    const attempts = threadFetch((id, n) => {
      if (id === 'th-a' && n <= 2) return refused('rateLimitExceeded')
      if (id === 'th-b' && n <= 3) return refused('userRateLimitExceeded')
      if (id === 'th-c' && n === 1) return refused('rateLimitExceeded', 429)
    })
    const sleeps: number[] = []
    const realSetTimeout = globalThis.setTimeout
    vi.stubGlobal('setTimeout', (fn: () => void, ms?: number) => (sleeps.push(ms ?? 0), realSetTimeout(fn, 0)))
    RETRY.baseMs = 1000
    try {
      expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    } finally {
      RETRY.baseMs = 0
    }
    expect(Object.fromEntries(attempts)).toEqual({ 'th-a': 3, 'th-b': 4, 'th-c': 2 })
    expect((await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).map((t) => t.threadId).sort()).toEqual(['th-a', 'th-b', 'th-c'])
    // Exponential: about 1 s, 2 s, 4 s (each plus up to 1 s of jitter).
    const backoffs = sleeps.filter((ms) => ms >= 1000).sort((a, b) => a - b)
    expect(backoffs).toHaveLength(6)
    expect(backoffs.filter((ms) => ms >= 4000 && ms < 5000)).toHaveLength(1)
    expect(await s.t.run((ctx) => ctx.db.get(conn))).toMatchObject({ status: 'connected' })
  })

  it('a rate limit that never lifts fails the run with the reason, after trying RETRY.tries times', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.threads = [kiteThread('th-a', now - D)]
    const attempts = threadFetch(() => refused('userRateLimitExceeded'))
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('error')
    expect(attempts.get('th-a')).toBe(RETRY.tries)
    expect(await s.t.run((ctx) => ctx.db.get(conn))).toMatchObject({ status: 'syncing', lastError: 'Google gmail thread failed (403 userRateLimitExceeded)' })
    // Not skipped past: the 30-day read starts over next run.
    expect((await s.t.run((ctx) => ctx.db.get(conn)))!.gmailHistoryId).toBeUndefined()
  })

  it('skips a thread Google refuses (403) or can’t find (404), stores the rest, and finishes', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.threads = [kiteThread('th-ok', now - D), kiteThread('th-forbidden', now - 2 * D), kiteThread('th-gone', now - 3 * D)]
    threadFetch((id) => (id === 'th-forbidden' ? refused('forbidden') : id === 'th-gone' ? json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, 404) : undefined))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    expect((await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).map((t) => t.threadId)).toEqual(['th-ok'])
    const c = await s.t.run((ctx) => ctx.db.get(conn))
    expect(c).toMatchObject({ status: 'connected', gmailHistoryId: '100' })
    expect(c!.lastError).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped 2 of 3 threads \(403 forbidden ×1, 404 notFound ×1\)/))
    warn.mockRestore()
  })

  it('a project-level 403 (dailyLimitExceeded) on threads.get fails the run with its reason, never skips', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.threads = [kiteThread('th-ok', now - D), kiteThread('th-daily', now - 2 * D), kiteThread('th-ok2', now - 3 * D)]
    const attempts = threadFetch((id) => (id === 'th-daily' ? refused('dailyLimitExceeded') : undefined))
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('error')
    // Not a rate limit: tried once, not retried.
    expect(attempts.get('th-daily')).toBe(1)
    const c = await s.t.run((ctx) => ctx.db.get(conn))
    expect(c).toMatchObject({ status: 'syncing', lastError: 'Google gmail thread failed (403 dailyLimitExceeded)' })
    expect(c!.gmailHistoryId).toBeUndefined()
    expect(c!.lastSyncAt).toBeUndefined()
  })

  it.each(['quotaExceeded', 'accessNotConfigured', 'domainPolicy'])('a 403 %s on one thread fails the run too', async (reason) => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.threads = [kiteThread('th-ok', now - D), kiteThread('th-bad', now - 2 * D)]
    threadFetch((id) => (id === 'th-bad' ? refused(reason) : undefined))
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('error')
    expect((await s.t.run((ctx) => ctx.db.get(conn)))!.lastError).toMatch(new RegExp(`\\(403 ${reason}\\)$`))
  })

  it('a page where every thread is refused fails the run, keeps the scan and its pageToken, and stores nothing', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    // Mid-way through the 30-day read: the first 100 were read in an earlier run; the next page is all refused.
    const scan = { done: 100, pageToken: '100', oldest: now - 5 * D, startedAt: now - 6e4, historyId: '100' }
    await s.t.run((ctx) => ctx.db.patch(conn, { scan }))
    google.threads = Array.from({ length: 250 }, (_, k) => kiteThread(`th-${k}`, now - D - k * 6e4))
    threadFetch((id) => (Number(id.slice(3)) >= 100 && Number(id.slice(3)) < 200 ? refused('forbidden') : undefined))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let run = 0; run < 2; run++) {
      expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('error')
      const c = await s.t.run((ctx) => ctx.db.get(conn))
      expect(c).toMatchObject({ status: 'syncing', scan, lastError: 'Google gmail thread failed (403 forbidden)' })
      expect(c!.gmailHistoryId).toBeUndefined()
      expect(c!.lastSyncAt).toBeUndefined()
      expect(c!.lockUntil).toBeUndefined()
    }
    expect(await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).toEqual([])
    const me = (await s.asDev.query(api.google.data, {})).me
    expect(me).toMatchObject({ status: 'syncing', scan: { done: 100 }, lastError: 'Google gmail thread failed (403 forbidden)' })
    vi.mocked(console.warn).mockRestore()
  })

  it('a page where every thread is gone (404) is skipped quietly, and the read carries on', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    // Two pages: the first 100 all deleted, the second has an investor thread.
    google.threads = Array.from({ length: 150 }, (_, k) => (k === 120 ? kiteThread(`th-${k}`, now - 2 * D) : newsThread(`th-${k}`, now - D - k * 6e4)))
    threadFetch((id) => (Number(id.slice(3)) < 100 ? json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, 404) : undefined))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    const c = await s.t.run((ctx) => ctx.db.get(conn))
    expect(c).toMatchObject({ status: 'connected', gmailHistoryId: '100' })
    expect(c!.lastError).toBeUndefined()
    expect(c!.scan).toBeUndefined()
    expect((await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).map((t) => t.threadId)).toEqual(['th-120'])
    vi.mocked(console.warn).mockRestore()
  })

  it('a page of only 404s and 403 forbidden (none read) is skipped, and the read carries on', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.threads = Array.from({ length: 150 }, (_, k) => (k === 120 ? kiteThread(`th-${k}`, now - 2 * D) : newsThread(`th-${k}`, now - D - k * 6e4)))
    threadFetch((id) => {
      const k = Number(id.slice(3))
      if (k >= 100) return undefined
      return k % 2 ? refused('forbidden') : json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, 404)
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    const c = await s.t.run((ctx) => ctx.db.get(conn))
    expect(c).toMatchObject({ status: 'connected', gmailHistoryId: '100' })
    expect(c!.lastError).toBeUndefined()
    expect((await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).map((t) => t.threadId)).toEqual(['th-120'])
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped 100 of 100 threads \((404 notFound ×50, 403 forbidden ×50|403 forbidden ×50, 404 notFound ×50)\)/))
    warn.mockRestore()
  })

  it('an incremental run whose only changed thread was deleted (404) succeeds and moves the history id on', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    await s.t.action(internal.googleSync.run, { connectionId: conn })
    expect(await s.t.run((ctx) => ctx.db.get(conn))).toMatchObject({ gmailHistoryId: '100' })
    google.threads = [kiteThread('th-gone', now - H)]
    google.history = ['th-gone']
    threadFetch(() => json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, 404))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    const c = await s.t.run((ctx) => ctx.db.get(conn))
    expect(c).toMatchObject({ status: 'connected', gmailHistoryId: '101' })
    expect(c!.lastError).toBeUndefined()
    expect(await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).toEqual([])
    vi.mocked(console.warn).mockRestore()
  })

  it('counts skipped threads across the 30-day read and shows them while syncing', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    // 350 recent threads: more than one run's chunk (300), so the read continues in a second run.
    google.threads = Array.from({ length: 350 }, (_, k) => (k === 5 ? kiteThread(`th-${k}`, now - D) : newsThread(`th-${k}`, now - D - k * 6e4)))
    const bad = new Set(['th-10', 'th-20', 'th-320'])
    threadFetch((id) => (bad.has(id) ? refused('forbidden') : undefined))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('more')
    let me = (await s.asDev.query(api.google.data, {})).me
    expect(me).toMatchObject({ status: 'syncing', scan: { done: 300, skipped: 2 } })
    expect(me!.lastError).toBeUndefined()

    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    me = (await s.asDev.query(api.google.data, {})).me
    expect(me).toMatchObject({ status: 'connected' })
    expect(me!.scan).toBeUndefined()
    expect((await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).map((t) => t.threadId)).toEqual(['th-5'])
    vi.mocked(console.warn).mockRestore()
  })

  it('a skipped thread in an incremental (history) run doesn’t fail it either', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    await s.t.action(internal.googleSync.run, { connectionId: conn })
    google.threads = [kiteThread('th-new', now - H), kiteThread('th-gone', now - H)]
    google.history = ['th-new', 'th-gone']
    threadFetch((id) => (id === 'th-gone' ? json({ error: { code: 404, errors: [{ reason: 'notFound' }] } }, 404) : undefined))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    expect(await s.t.run((ctx) => ctx.db.get(conn))).toMatchObject({ gmailHistoryId: '101' })
    expect((await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).map((t) => t.threadId)).toEqual(['th-new'])
    vi.mocked(console.warn).mockRestore()
  })

  it('reads at most 2 threads at once', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.threads = Array.from({ length: 20 }, (_, k) => kiteThread(`th-${k}`, now - D))
    let inFlight = 0
    let most = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!/\/users\/me\/threads\/[^/?]+/.test(String(input))) return fakeFetch(input, init)
      most = Math.max(most, ++inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return fakeFetch(input, init)
    }))
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    expect(most).toBe(2)
  })

  it('paces thread reads, retries included: never more than PACE.threadsPerSecond start in any second', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.threads = Array.from({ length: 30 }, (_, k) => newsThread(`th-${k}`, now - D - k * 6e4))
    const starts: number[] = []
    const attempts = new Map<string, number>()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const th = /\/users\/me\/threads\/([^/?]+)/.exec(String(input))
      if (!th) return fakeFetch(input, init)
      starts.push(Date.now())
      const n = (attempts.get(th[1]) ?? 0) + 1
      attempts.set(th[1], n)
      return th[1] === 'th-3' && n === 1 ? refused('rateLimitExceeded') : fakeFetch(input, init)
    }))
    PACE.threadsPerSecond = 20
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    expect(starts).toHaveLength(31)
    // Any 21 reads in a row span at least a second.
    for (let k = 0; k + 20 < starts.length; k++) expect(starts[k + 20] - starts[k]).toBeGreaterThanOrEqual(1000)
  })

  it('a page where the 3rd of 10 threads stays rate-limited stores what was read, keeps the pageToken and sets lastError', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    // A first page of 100 that reads fine, then a page of 10 investor threads whose 3rd never stops being rate-limited.
    google.threads = Array.from({ length: 110 }, (_, k) => (k < 100 ? newsThread(`th-${k}`, now - H - k * 6e4) : kiteThread(`th-${k}`, now - D - k * 6e4)))
    const attempts = threadFetch((id) => (id === 'th-102' ? refused('rateLimitExceeded') : undefined))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('error')
    expect(attempts.get('th-102')).toBe(6)
    const c = await s.t.run((ctx) => ctx.db.get(conn))
    expect(c).toMatchObject({ status: 'syncing', scan: { done: 100, pageToken: '100', historyId: '100' }, lastError: 'Google gmail thread failed (403 rateLimitExceeded)' })
    expect(c!.gmailHistoryId).toBeUndefined()
    expect(c!.lastSyncAt).toBeUndefined()
    expect(c!.lockUntil).toBeUndefined()
    const stored = (await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).map((t) => t.threadId)
    expect(stored).toEqual(expect.arrayContaining(['th-100', 'th-101']))
    expect(stored).not.toContain('th-102')
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/: read \d+ threads, skipped 0, 5 rate-limit retries, \d+\.\ds$/))

    // Next run, the limit has lifted: the same page is read again (not the first one), and the read finishes.
    threadFetch(() => undefined)
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    const after = await s.t.run((ctx) => ctx.db.get(conn))
    expect(after).toMatchObject({ status: 'connected', gmailHistoryId: '100' })
    expect(after!.lastError).toBeUndefined()
    expect(after!.scan).toBeUndefined()
    expect((await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).map((t) => t.threadId).sort()).toEqual(Array.from({ length: 10 }, (_, k) => `th-${100 + k}`))
    expect(google.calls.filter((call) => call === 'GET /gmail/v1/users/me/threads/th-0')).toHaveLength(1)
    vi.mocked(console.error).mockRestore()
    log.mockRestore()
  })

  it('a run where the rate limit clears after 2 retries finishes normally and logs what it did', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    google.threads = [kiteThread('th-a', now - D), kiteThread('th-b', now - 2 * D), newsThread('th-c', now - 3 * D)]
    const attempts = threadFetch((id, n) => (id === 'th-b' && n <= 2 ? refused('rateLimitExceeded') : undefined))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    expect(attempts.get('th-b')).toBe(3)
    expect((await s.t.run((ctx) => ctx.db.query('emailTouches').collect())).map((t) => t.threadId).sort()).toEqual(['th-a', 'th-b'])
    const c = await s.t.run((ctx) => ctx.db.get(conn))
    expect(c).toMatchObject({ status: 'connected', gmailHistoryId: '100' })
    expect(c!.lastError).toBeUndefined()
    expect(c!.scan).toBeUndefined()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`^google sync ${conn}: read 3 threads, skipped 0, 2 rate-limit retries, \\d+\\.\\ds$`)))
    log.mockRestore()
  })
})

describe('mapLimit', () => {
  it('keeps order and never runs more than n at once', async () => {
    let inFlight = 0
    let most = 0
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (x) => {
      most = Math.max(most, ++inFlight)
      await new Promise((r) => setTimeout(r, x))
      inFlight--
      return x * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30, 0])
    expect(most).toBe(2)
  })

  it('on a failure, starts nothing new and waits for the calls in flight before throwing', async () => {
    const started: number[] = []
    const settled: number[] = []
    const p = mapLimit([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (x) => {
      started.push(x)
      if (x === 0) throw new Error('boom')
      await new Promise((r) => setTimeout(r, 20))
      settled.push(x)
      return x
    })
    let rejectedWith: unknown
    await p.catch((e) => (rejectedWith = e))
    expect(rejectedWith).toEqual(new Error('boom'))
    // 1, 2, 3 were already running when 0 failed: they finished before mapLimit threw, and nothing after them started.
    expect(started.sort()).toEqual([0, 1, 2, 3])
    expect(settled.sort()).toEqual([1, 2, 3])
  })

  it('throws the first error when several fail', async () => {
    await expect(
      mapLimit([1, 2, 3], 3, async (x) => {
        await new Promise((r) => setTimeout(r, x * 5))
        throw new Error(`fail ${x}`)
      }),
    ).rejects.toThrow('fail 1')
  })
})

/* ---------- PST-293: reading email text needs gmail.readonly ---------- */

describe('email bodies (PST-293)', () => {
  const READONLY = 'https://www.googleapis.com/auth/gmail.readonly'
  const METADATA = 'https://www.googleapis.com/auth/gmail.metadata'
  /** Google lists the grant's scopes on a refresh. */
  const refreshWith = (scope: string) =>
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
      if (String(input).startsWith('https://oauth2.googleapis.com/token') && form.get('grant_type') === 'refresh_token') return json({ access_token: 'access-1', scope })
      return fakeFetch(input, init)
    }))

  it('a grant with gmail.metadata only shows "Reconnect Google to read email bodies"; gmail.readonly clears it', async () => {
    const s = await setup()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    refreshWith('https://www.googleapis.com/auth/calendar.readonly ' + METADATA)
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    expect((await s.asDev.query(api.google.data, {})).me).toMatchObject({ status: 'connected', emailBodies: false })
    refreshWith('https://www.googleapis.com/auth/calendar.readonly ' + READONLY)
    await s.t.action(internal.googleSync.run, { connectionId: conn })
    expect((await s.asDev.query(api.google.data, {})).me).toMatchObject({ emailBodies: true })
  })

  it('a refresh that lists no scopes leaves it as it was', async () => {
    const s = await setup()
    const conn = await s.connect(s.dev, 'founder@pestokids.com')
    await s.t.mutation(internal.google.setBodies, { connectionId: conn, bodies: false })
    await s.t.action(internal.googleSync.run, { connectionId: conn })
    expect((await s.asDev.query(api.google.data, {})).me).toMatchObject({ emailBodies: false })
  })

  it('connecting again (every scope granted) can read bodies', async () => {
    const s = await setup()
    await s.t.mutation(internal.google.store, { userId: s.dev, googleEmail: 'founder@pestokids.com', sealed: await encryptToken('refresh-ok') })
    expect((await s.asDev.query(api.google.data, {})).me).toMatchObject({ emailBodies: true })
  })
})

/* ---------- PST-306: what waits on Dev ---------- */

describe('what waits on Dev (PST-306)', () => {
  const self = 'founder@pestokids.com'
  const sam = 'Sam <sam@kite.example.com>'
  const withHeaders = (m: ReturnType<typeof msg>, h: Record<string, string>) => ({ ...m, payload: { headers: [...m.payload.headers, ...Object.entries(h).map(([name, value]) => ({ name, value }))] } })
  const owed = (id: string, ...messages: ReturnType<typeof msg>[]) => parseThread({ id, messages }, self)!.owed

  it('owes the newest message from them, skipping calendar and automated mail; ours ends the wait', () => {
    const now = Date.now()
    expect(owed('q', msg('q', 1, self, sam, now - 3 * D), msg('q', 2, sam, self, now - 2 * D, 'Re: Pesto'), msg('q', 3, sam, self, now - D, 'Accepted: Kite x Pesto @ Fri'))).toEqual({ at: now - 2 * D, messageId: 'q-2' })
    expect(owed('inv', msg('inv', 1, sam, self, now - D, 'Updated invitation: Kite <> Pesto @ Wed'))).toBeNull()
    expect(owed('cal', withHeaders(msg('cal', 1, sam, self, now - D, 'Partner meeting'), { Sender: 'Google Calendar <calendar-notification@google.com>' }))).toBeNull()
    expect(owed('ics', withHeaders(msg('ics', 1, sam, self, now - D, 'Partner meeting'), { 'Content-Type': 'text/calendar; method=REQUEST' }))).toBeNull()
    expect(owed('apps', msg('apps', 1, 'Kite Applications <applications@kite.example.com>', self, now - D, 'Application received'))).toBeNull()
    expect(owed('list', withHeaders(msg('list', 1, sam, self, now - D, 'Kite quarterly letter'), { 'List-Unsubscribe': '<mailto:leave@kite.example.com>' }))).toBeNull()
    expect(owed('auto', withHeaders(msg('auto', 1, sam, self, now - D, 'Re: Pesto'), { 'Auto-Submitted': 'auto-generated' }))).toBeNull()
    expect(owed('bulk', withHeaders(msg('bulk', 1, sam, self, now - D, 'Portfolio news'), { Precedence: 'bulk' }))).toBeNull()
    expect(owed('ours', msg('ours', 1, sam, self, now - 2 * D, 'Can you send the deck?'), msg('ours', 2, self, sam, now - D, 'Re: Can you send the deck?'))).toBeNull()
  })

  it('spends no Jev call on calendar mail (PST-293 signals)', () => {
    const now = Date.now()
    const t = { id: 'x', messages: [msg('x', 1, sam, self, now, 'Accepted: Kite x Pesto'), msg('x', 2, sam, self, now, 'Re: Pesto')] }
    expect(inboundMessages(t, self, new Set(['x-1', 'x-2'])).map((m) => m.messageId)).toEqual(['x-2'])
  })

  /** Gmail with each message's parts (types and file names); `asked` gets the format and fields mask of every parts request. */
  const withParts = (byMessage: Record<string, unknown>, asked: string[], refuse = false) =>
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const m = /\/users\/me\/messages\/([^/]+)$/.exec(url.pathname)
      if (!m) return fakeFetch(input, init)
      asked.push(url.searchParams.get('format') + ' ' + url.searchParams.get('fields'))
      return refuse ? json({ error: { errors: [{ reason: 'insufficientPermissions' }] } }, 403) : json({ payload: byMessage[m[1]] })
    }))
  const multipart = { 'Content-Type': 'multipart/mixed; boundary=x' }
  const threadsWithAttachments = (now: number) => [
    { id: 'th-ics', messages: [msg('th-ics', 1, self, sam, now - 4 * D), withHeaders(msg('th-ics', 2, sam, self, now - 3 * D, 'Re: Pesto'), multipart)] },
    { id: 'th-deck', messages: [withHeaders(msg('th-deck', 1, 'ana@fernhill.example.com', self, now - 3 * D, 'Our questions'), multipart)] },
  ]
  const PARTS = {
    'th-ics-2': { mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/plain' }, { mimeType: 'application/ics', filename: 'invite.ics' }] },
    'th-deck-1': { mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/plain' }, { mimeType: 'application/pdf', filename: 'questions.pdf' }] },
  }
  const owedByThread = (s: Awaited<ReturnType<typeof setup>>) => s.t.run(async (ctx) => Object.fromEntries((await ctx.db.query('emailTouches').collect()).map((r) => [r.threadId, r.owed])))

  it('skips a message whose only attachment is an invite, reading part types and names only', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, self)
    google.threads = threadsWithAttachments(now)
    const asked: string[] = []
    withParts(PARTS, asked)
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    expect(await owedByThread(s)).toEqual({ 'th-ics': null, 'th-deck': { at: now - 3 * D, messageId: 'th-deck-1' } })
    expect(asked).toHaveLength(2)
    for (const a of asked) expect(a).toMatch(/^full payload\(mimeType,filename,parts\(/)
    for (const a of asked) expect(a).not.toMatch(/headers|body|data/)
  })

  it('never asks for parts under a gmail.metadata grant, and a refusal stops it asking without failing the sync', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, self)
    await s.t.run((ctx) => ctx.db.patch(conn, { gmailBodies: false }))
    google.threads = threadsWithAttachments(now)
    const asked: string[] = []
    withParts(PARTS, asked)
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    expect(asked).toEqual([])
    // Without the parts, both still wait on Dev.
    expect(await owedByThread(s)).toEqual({ 'th-ics': { at: now - 3 * D, messageId: 'th-ics-2' }, 'th-deck': { at: now - 3 * D, messageId: 'th-deck-1' } })

    const s2 = await setup()
    const conn2 = await s2.connect(s2.dev, self)
    google.threads = [1, 2, 3, 4, 5, 6].map((k) => ({ id: 'th-' + k, messages: [withHeaders(msg('th-' + k, 1, sam, self, now - 3 * D, 'Re: Pesto ' + k), multipart)] }))
    const refused: string[] = []
    withParts(PARTS, refused, true)
    expect(await s2.t.action(internal.googleSync.run, { connectionId: conn2 })).toBe('done')
    // Only the reads already under way when Google refused (two run at once).
    expect(refused.length).toBeLessThanOrEqual(2)
    expect(await s2.t.run((ctx) => ctx.db.get(conn2))).toMatchObject({ status: 'connected' })
  })

  it('reads the last 30 days again once when the stored threads predate it, then goes back to history', async () => {
    const s = await setup()
    const now = Date.now()
    const conn = await s.connect(s.dev, self)
    await s.t.run(async (ctx) => {
      await ctx.db.patch(conn, { gmailHistoryId: '90' })
      await ctx.db.insert('emailTouches', {
        userId: s.dev, threadId: 'th-old', subject: 'Re: Kite x Pesto', participants: ['sam@kite.example.com', self], lastAt: now - 3 * D, lastFrom: 'them',
        lastFromEmail: 'sam@kite.example.com', count: 1, link: '', investorIds: [s.kite],
      })
    })
    google.threads = [{ id: 'th-old', messages: [withHeaders(msg('th-old', 1, sam, self, now - 3 * D, 'Re: Kite x Pesto'), { Sender: 'Google Calendar <calendar-notification@google.com>' })] }]
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    expect(google.calls).toContain('GET /gmail/v1/users/me/threads')
    expect(google.calls).not.toContain('GET /gmail/v1/users/me/history')
    expect(await owedByThread(s)).toEqual({ 'th-old': null })
    expect(await s.t.run((ctx) => ctx.db.get(conn))).toMatchObject({ gmailThreads: THREADS_VERSION, gmailHistoryId: '100' })
    expect((await s.asDev.query(api.google.data, {})).threads[0].owed).toBeNull()

    google.calls = []
    expect(await s.t.action(internal.googleSync.run, { connectionId: conn })).toBe('done')
    expect(google.calls).toContain('GET /gmail/v1/users/me/history')
    expect(google.calls).not.toContain('GET /gmail/v1/users/me/threads')
  })
})
