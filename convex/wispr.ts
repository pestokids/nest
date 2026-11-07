// PST-285: Wispr Flow notes after investor meetings. Nest is an MCP client of
// Wispr Flow's remote MCP server (convex/lib/mcpClient.ts): Connect discovers its
// sign-in, registers Nest as a client and opens the browser sign-in (PKCE); the
// callback (wisprOAuth.ts) seals the tokens. Every 15 minutes (crons.ts) a run per
// connection looks for the notes of investor meetings that ended 10 minutes to 7
// days ago: get_meeting_by_calendar_id with the Google event id first, else
// search_meetings around the meeting's time (start ±15 min and the title). A note
// is saved through the same path as the add_meeting_notes MCP tool (source
// "wispr"), so Nest's read runs as usual and its proposals wait in Suggestions;
// one it can't tie to an investor waits in Unmatched notes. The Wispr meeting id is
// the dedupe key. Logs carry ids, counts and statuses only.
import { ConvexError, v } from 'convex/values'
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { decryptToken, encryptToken, hasTokenKey, MissingKey, signState } from './lib/crypto'
import { aiSettings } from './lib/enrichQueue'
import {
  AuthRefused, authorizeUrl, discover, DiscoveryError, McpError, NoDcr, openSession, pkce, refreshTokens, register, Unauthorized,
  type AuthMeta, type Client, type Session, type Tokens,
} from './lib/mcpClient'
import { addMeetingNotes } from './noteReads'
import { vWisprAuthMethod } from './wisprSchema'
import { DAY_MS, dayOf } from '../src/lib/google'
import {
  calendarArgs, cleanUrl, MATCH_MS, matchMeeting, meetingArgs, readMeeting, readMeetings, resultData, searchArgs, SETTLE_MS, TRY_DAYS, WISPR_CALLBACK_PATH,
  type ToolDef, type WisprCardData,
} from '../src/lib/wispr'

/** A run holds the lock this long at most (a stuck run frees it for the next cron). */
const LOCK_MS = 9 * 6e4
/** A run stops taking new meetings after this, and the rest continue in a follow-up run. */
const BUDGET_MS = 6 * 6e4
/** Meetings per run; the rest continue in a follow-up run straight away. */
const PER_RUN = 40
/** An access token this close to expiring is refreshed first. */
const SKEW_MS = 60e3
/** "Fetch past 30 days" shows as running at most this long without progress. */
const BACKFILL_STALE_MS = 15 * 6e4

type Conn = Doc<'wisprConnections'>

/**
 * Where Wispr Flow sends the browser back. Production's SITE_URL is
 * https://nest.pestokids.com, which rewrites /wispr/callback to this deployment
 * (vercel.json, on that host only); local dev's is http://localhost:3000, whose
 * Vite server proxies it to the dev deployment. Anywhere else: this deployment's
 * own .convex.site URL.
 */
export function redirectUri(): string {
  const site = process.env.SITE_URL?.trim().replace(/\/+$/, '')
  if (site && (site.startsWith('https://') || /^http:\/\/localhost(:\d+)?$/.test(site))) return site + WISPR_CALLBACK_PATH
  return (process.env.CONVEX_SITE_URL ?? '').replace(/\/+$/, '') + WISPR_CALLBACK_PATH
}

const myConnection = (ctx: QueryCtx, userId: Id<'users'>) =>
  ctx.db
    .query('wisprConnections')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique()

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return undefined
  }
}

/* ---------- what Settings reads and does ---------- */

/** Your connection for the Settings card: status, the server's host, the last fetch. Never a token, a secret or a note. */
export const status = query({
  args: {},
  handler: async (ctx): Promise<WisprCardData> => {
    const { userId } = await requireUser(ctx)
    const reads = (await aiSettings(ctx)).meetingNotes
    const c = await myConnection(ctx, userId)
    if (!c) return { status: 'off', fetching: false, reads }
    const host = hostOf(c.serverUrl)
    return {
      status: c.status === 'pending' ? 'off' : c.status,
      url: c.serverUrl,
      ...(host ? { host } : {}),
      ...(c.lastFetch ? { lastFetch: c.lastFetch } : {}),
      ...(c.lastCheckAt ? { lastCheckAt: c.lastCheckAt } : {}),
      fetching: c.status === 'connected' && (c.backfill ?? 0) > Date.now() - BACKFILL_STALE_MS,
      ...(c.lastError && c.status === 'connected' ? { lastError: c.lastError } : {}),
      reads,
    }
  },
})

/**
 * Connect (or Reconnect): discover the server's sign-in, register Nest as a
 * client (or reuse the one registered before), and return the browser sign-in
 * URL with a PKCE challenge and a signed state naming you. Stores nothing when
 * discovery fails, and says so when the server doesn't offer dynamic client registration.
 */
export const connect = action({
  args: { url: v.string() },
  handler: async (ctx, { url }): Promise<string> => {
    const me = await ctx.runQuery(internal.google.whoami, {})
    const serverUrl = cleanUrl(url)
    if (!serverUrl) throw new ConvexError('Paste the https URL from Wispr Flow › Settings › MCP.')
    if (!hasTokenKey()) throw new ConvexError('Wispr Flow can’t be connected yet: the server is missing GOOGLE_TOKEN_KEY. Nothing was stored.')
    let meta: AuthMeta
    try {
      meta = await discover(serverUrl)
    } catch (e) {
      if (e instanceof NoDcr) {
        console.log(`wispr connect user=${me.userId} discovery=no_dcr`)
        throw new ConvexError('Wispr Flow’s sign-in server doesn’t support dynamic client registration, so Nest can’t register itself with it. Nothing was stored.')
      }
      if (e instanceof DiscoveryError) {
        console.log(`wispr connect user=${me.userId} discovery=failed`)
        throw new ConvexError(`That URL didn’t lead to a sign-in (${e.message.replace(/\.$/, '')}). Copy it again from Wispr Flow › Settings › MCP. Nothing was stored.`)
      }
      throw e
    }
    const redirect = redirectUri()
    const prev = await ctx.runQuery(internal.wispr.forUser, { userId: me.userId })
    let client: Client | null = null
    if (prev && prev.serverUrl === serverUrl && prev.issuer === meta.issuer && prev.redirectUri === redirect) client = await clientOf(prev).catch(() => null)
    if (!client) {
      try {
        client = await register(meta, redirect)
      } catch (e) {
        if (!(e instanceof McpError)) throw e
        console.log(`wispr connect user=${me.userId} register=failed status=${e.status}`)
        throw new ConvexError('Wispr Flow didn’t accept Nest’s registration. Try again in a minute. Nothing was stored.')
      }
    }
    const { verifier, challenge } = await pkce()
    await ctx.runMutation(internal.wispr.begin, {
      userId: me.userId,
      serverUrl,
      resource: meta.resource,
      issuer: meta.issuer,
      authorizationEndpoint: meta.authorizationEndpoint,
      tokenEndpoint: meta.tokenEndpoint,
      ...(meta.scope ? { scope: meta.scope } : {}),
      redirectUri: redirect,
      clientId: client.clientId,
      ...(client.clientSecret ? { clientSecret: await encryptToken(client.clientSecret) } : {}),
      authMethod: client.authMethod,
      verifier: await encryptToken(verifier),
    })
    const state = await signState({ u: me.userId, exp: Date.now() + 10 * 6e4 })
    return authorizeUrl(meta, client.clientId, { redirectUri: redirect, state, challenge })
  },
})

/** "Fetch past 30 days": the same fetch for meetings that ended in the last 30 days, ones it gave up on included. */
export const fetchPast = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const c = await myConnection(ctx, userId)
    if (!c || c.status === 'pending') throw new ConvexError('Connect Wispr Flow first.')
    if (c.status === 'reconnect') throw new ConvexError('Wispr Flow needs reconnecting first.')
    const now = Date.now()
    if ((c.backfill ?? 0) > now - BACKFILL_STALE_MS) return null
    await ctx.db.patch(c._id, { backfill: now })
    await ctx.scheduler.runAfter(0, internal.wispr.run, { connectionId: c._id, days: 30, backfill: true })
    return null
  },
})

/** Disconnect: forget the connection and its tokens. Notes already fetched stay, and so does the record of which were fetched, so a reconnect never brings them in twice. */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const c = await myConnection(ctx, userId)
    if (c) await ctx.db.delete(c._id)
    return null
  },
})

/* ---------- the sign-in's reads and writes ---------- */

/** Internal only: the whole connection, sealed fields included. */
export const forUser = internalQuery({ args: { userId: v.id('users') }, handler: (ctx, { userId }) => myConnection(ctx, userId) })
export const forRun = internalQuery({ args: { connectionId: v.id('wisprConnections') }, handler: (ctx, { connectionId }) => ctx.db.get(connectionId) })

/** Connect started: what discovery found, the client, the sealed PKCE verifier. A connection to the same server keeps its tokens until the sign-in finishes. */
export const begin = internalMutation({
  args: {
    userId: v.id('users'),
    serverUrl: v.string(),
    resource: v.string(),
    issuer: v.string(),
    authorizationEndpoint: v.string(),
    tokenEndpoint: v.string(),
    scope: v.optional(v.string()),
    redirectUri: v.string(),
    clientId: v.string(),
    clientSecret: v.optional(v.string()),
    authMethod: vWisprAuthMethod,
    verifier: v.string(),
  },
  handler: async (ctx, a) => {
    const prev = await myConnection(ctx, a.userId)
    if (!prev) return await ctx.db.insert('wisprConnections', { ...a, status: 'pending' })
    if (prev.status === 'pending' || prev.serverUrl !== a.serverUrl) await ctx.db.replace(prev._id, { ...a, status: 'pending' })
    else await ctx.db.patch(prev._id, { ...a, scope: a.scope, clientSecret: a.clientSecret })
    return prev._id
  },
})

const vSealed = { accessToken: v.string(), refreshToken: v.optional(v.string()), expiresAt: v.optional(v.number()) }

/** The sign-in finished: sealed tokens in, verifier out. */
export const signedIn = internalMutation({
  args: { connectionId: v.id('wisprConnections'), ...vSealed },
  handler: async (ctx, { connectionId, accessToken, refreshToken, expiresAt }) => {
    await ctx.db.patch(connectionId, {
      status: 'connected', accessToken, refreshToken, expiresAt, verifier: undefined, connectedAt: Date.now(), lastError: undefined, lockUntil: undefined, backfill: undefined,
    })
  },
})

/** A refresh: the new access token, and the refresh token when the server rotated it. */
export const saveTokens = internalMutation({
  args: { connectionId: v.id('wisprConnections'), ...vSealed },
  handler: async (ctx, { connectionId, accessToken, refreshToken, expiresAt }) => {
    if (!(await ctx.db.get(connectionId))) return
    await ctx.db.patch(connectionId, { accessToken, expiresAt, ...(refreshToken ? { refreshToken } : {}) })
  },
})

/** Sealed for storage (AES-GCM with GOOGLE_TOKEN_KEY, like Google's refresh token). */
export const sealTokens = async (t: Tokens) => ({
  accessToken: await encryptToken(t.accessToken),
  ...(t.refreshToken ? { refreshToken: await encryptToken(t.refreshToken) } : {}),
  ...(t.expiresAt ? { expiresAt: t.expiresAt } : {}),
})

/** The registered client, its secret unsealed. */
export const clientOf = async (c: Pick<Conn, 'clientId' | 'clientSecret' | 'authMethod'>): Promise<Client> => ({
  clientId: c.clientId,
  authMethod: c.authMethod,
  ...(c.clientSecret ? { clientSecret: await decryptToken(c.clientSecret) } : {}),
})

/* ---------- the run's reads and writes ---------- */

/** Take the run lock: true, the time it's held until, or false when the connection is gone or not connected. */
export const claim = internalMutation({
  args: { connectionId: v.id('wisprConnections'), until: v.number(), backfill: v.boolean() },
  handler: async (ctx, { connectionId, until, backfill }): Promise<boolean | number> => {
    const c = await ctx.db.get(connectionId)
    if (!c || c.status !== 'connected') return false
    if ((c.lockUntil ?? 0) > Date.now()) return c.lockUntil!
    await ctx.db.patch(connectionId, { lockUntil: until, ...(backfill ? { backfill: Date.now() } : {}) })
    return true
  },
})

/** Before a meeting is tried again: every run for the first hour, then hourly, then every 6 hours. */
const backoff = (attempts: number) => (attempts < 4 ? 0 : attempts < 10 ? 36e5 : 6 * 36e5)

/**
 * Investor meetings on this person's calendar that ended between 10 minutes and
 * `days` ago with no Wispr note yet, newest first. The cron skips ones it gave
 * up on; "Fetch past 30 days" (`retry`) tries those again and ignores the backoff.
 */
export const candidates = internalQuery({
  args: { connectionId: v.id('wisprConnections'), days: v.number(), retry: v.boolean() },
  handler: async (ctx, { connectionId, days, retry }) => {
    const c = await ctx.db.get(connectionId)
    if (!c) return []
    const now = Date.now()
    const out = []
    for (const m of await ctx.db
      .query('meetings')
      .withIndex('by_start', (q) => q.gte('start', now - (days + 1) * DAY_MS).lte('start', now))
      .collect()) {
      if (m.userId !== c.userId || !m.investorIds.length || m.end > now - SETTLE_MS || m.end < now - days * DAY_MS) continue
      const f = await ctx.db
        .query('wisprFetches')
        .withIndex('by_meeting', (q) => q.eq('meetingId', m._id))
        .unique()
      if (f && f.status !== 'waiting' && !(retry && f.status === 'gaveup')) continue
      if (f && !retry && now - f.lastTriedAt < backoff(f.attempts)) continue
      out.push({ meetingId: m._id, eventId: m.eventId, title: m.title, start: m.start, end: m.end })
    }
    return out.sort((a, b) => b.end - a.end)
  },
})

/** Whether a Wispr meeting's note already came in (for any calendar meeting). */
export const known = internalQuery({
  args: { wisprId: v.string() },
  handler: async (ctx, { wisprId }) => {
    const rows = await ctx.db
      .query('wisprFetches')
      .withIndex('by_wispr', (q) => q.eq('wisprId', wisprId))
      .collect()
    return rows.some((r) => r.status === 'saved' || r.status === 'unmatched')
  },
})

/** A note found; `text` null when that Wispr meeting already came in (it isn't fetched again). */
const vFound = v.object({ wisprId: v.string(), text: v.union(v.string(), v.null()), via: v.union(v.literal('calendar'), v.literal('search')) })
type Outcome = 'saved' | 'unmatched' | 'waiting' | 'duplicate' | 'gaveup'

/**
 * One attempt for one meeting. A note found is saved like add_meeting_notes
 * saves one (source "wispr"): on the meeting's investor when it has exactly one,
 * else wherever the notes matcher puts it, else in Unmatched notes. A Wispr
 * meeting id that already came in is never saved again. Nothing found: another
 * attempt is counted, and after 7 days the cron stops trying.
 */
export const record = internalMutation({
  args: { meetingId: v.id('meetings'), userId: v.id('users'), found: v.union(v.null(), vFound) },
  handler: async (ctx, { meetingId, userId, found }): Promise<Outcome> => {
    const now = Date.now()
    const row = await ctx.db
      .query('wisprFetches')
      .withIndex('by_meeting', (q) => q.eq('meetingId', meetingId))
      .unique()
    if (row && (row.status === 'saved' || row.status === 'unmatched')) return 'duplicate'
    const put = async (status: Outcome, extra: Partial<Doc<'wisprFetches'>> = {}) => {
      const doc = { status, attempts: (row?.attempts ?? 0) + 1, lastTriedAt: now, ...extra }
      if (row) await ctx.db.patch(row._id, doc)
      else await ctx.db.insert('wisprFetches', { meetingId, userId, firstTriedAt: now, ...doc })
      return status
    }
    const m = await ctx.db.get(meetingId)
    if (!m) return await put('gaveup')
    if (found && found.text === null) return await put('duplicate', { wisprId: found.wisprId, via: found.via })
    if (found?.text?.trim()) {
      const seen = await ctx.db
        .query('wisprFetches')
        .withIndex('by_wispr', (q) => q.eq('wisprId', found.wisprId))
        .collect()
      if (seen.some((r) => r.meetingId !== meetingId && (r.status === 'saved' || r.status === 'unmatched'))) return await put('duplicate', { wisprId: found.wisprId, via: found.via })
      const investors = (await Promise.all(m.investorIds.map((id) => ctx.db.get(id)))).filter((i): i is Doc<'investors'> => !!i)
      const only = investors.length === 1 ? investors[0] : null
      const r = await addMeetingNotes(ctx, {
        ...(only ? { investorId: only._id, meetingId } : {}),
        meetingTitle: m.title,
        date: dayOf(m.start),
        text: found.text,
        source: 'wispr',
      })
      if ('unmatchedId' in r) return await put('unmatched', { wisprId: found.wisprId, via: found.via, unmatchedId: r.unmatchedId })
      return await put('saved', { wisprId: found.wisprId, via: found.via, noteId: r.noteId })
    }
    return await put(m.end < now - TRY_DAYS * DAY_MS ? 'gaveup' : 'waiting')
  },
})

/** End of a run: release the lock, note the check and (when notes came in) the fetch. */
export const finish = internalMutation({
  args: { connectionId: v.id('wisprConnections'), count: v.number(), error: v.optional(v.string()), backfill: v.union(v.literal('done'), v.literal('more'), v.literal('no')) },
  handler: async (ctx, { connectionId, count, error, backfill }) => {
    const c = await ctx.db.get(connectionId)
    if (!c) return
    const now = Date.now()
    await ctx.db.patch(connectionId, {
      lockUntil: undefined,
      lastError: error,
      ...(error ? {} : { lastCheckAt: now }),
      ...(count ? { lastFetch: { at: now, count } } : {}),
      ...(backfill === 'done' ? { backfill: undefined } : backfill === 'more' ? { backfill: now } : {}),
    })
  },
})

/** Wispr Flow refused the sign-in (refresh failed, or the server keeps saying 401): stop until the user reconnects. Never throws. */
export const markReconnect = internalMutation({
  args: { connectionId: v.id('wisprConnections'), why: v.string() },
  handler: async (ctx, { connectionId, why }) => {
    if (!(await ctx.db.get(connectionId))) return
    await ctx.db.patch(connectionId, { status: 'reconnect', lockUntil: undefined, backfill: undefined, lastError: why.slice(0, 200) })
  },
})

/** Every 15 minutes (crons.ts): one run per connected teammate. Silent. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    let n = 0
    for (const c of await ctx.db.query('wisprConnections').collect()) {
      if (c.status !== 'connected' || (c.lockUntil ?? 0) > now) continue
      await ctx.scheduler.runAfter(0, internal.wispr.run, { connectionId: c._id, days: TRY_DAYS })
      n++
    }
    return n
  },
})

/* ---------- the run ---------- */

/** Access tokens for one run: the stored one while it's fresh, else a refresh (saved straight away, rotated refresh token included). */
function tokenKeeper(ctx: ActionCtx, c: Conn) {
  let sealed = { access: c.accessToken, refresh: c.refreshToken, expiresAt: c.expiresAt }
  const open = async (s: string) => {
    try {
      return await decryptToken(s)
    } catch (e) {
      if (e instanceof MissingKey) throw new McpError('GOOGLE_TOKEN_KEY is missing')
      throw new AuthRefused('unreadable')
    }
  }
  return async (force = false) => {
    if (!force && sealed.access && (!sealed.expiresAt || sealed.expiresAt - SKEW_MS > Date.now())) return await open(sealed.access)
    if (!sealed.refresh) throw new AuthRefused('no_refresh_token')
    const client = await clientOf(c).catch(() => {
      throw new AuthRefused('unreadable')
    })
    const t = await refreshTokens(c, client, await open(sealed.refresh))
    const s = await sealTokens(t)
    await ctx.runMutation(internal.wispr.saveTokens, { connectionId: c._id, ...s })
    sealed = { access: s.accessToken, refresh: s.refreshToken ?? sealed.refresh, expiresAt: s.expiresAt }
    return t.accessToken
  }
}

type Candidate = { meetingId: Id<'meetings'>; eventId: string; title: string; start: number; end: number }
type Found = { wisprId: string; text: string | null; via: 'calendar' | 'search' }

/** How one meeting's note is looked for, with the tools this server listed (arguments always built from their schemas). */
function finder(ctx: ActionCtx, session: Session, tools: ToolDef[]) {
  const tool = (name: string) => tools.find((t) => t.name === name)
  const byCalendar = tool('get_meeting_by_calendar_id')
  const search = tool('search_meetings')
  const get = tool('get_meeting')
  return async (m: Candidate): Promise<Found | null> => {
    const args = byCalendar && calendarArgs(byCalendar.inputSchema, m.eventId)
    if (byCalendar && args) {
      try {
        const w = readMeeting(resultData(await session.callTool(byCalendar.name, args)))
        if (w?.notes) return { wisprId: w.id ?? `calendar:${m.eventId}`, text: w.notes, via: 'calendar' }
      } catch (e) {
        if (!(e instanceof McpError)) throw e
      }
    }
    const sArgs = search && searchArgs(search.inputSchema, { from: m.start - MATCH_MS, to: m.end + MATCH_MS, title: m.title })
    if (!search || !sArgs) return null
    const hit = matchMeeting(readMeetings(resultData(await session.callTool(search.name, sArgs))), m)
    if (!hit?.id) return null
    // Already in: never fetched again.
    if (await ctx.runQuery(internal.wispr.known, { wisprId: hit.id })) return { wisprId: hit.id, text: null, via: 'search' }
    const gArgs = get && meetingArgs(get.inputSchema, hit.id)
    if (get && gArgs) {
      const w = readMeeting(resultData(await session.callTool(get.name, gArgs)))
      if (w?.notes) return { wisprId: hit.id, text: w.notes, via: 'search' }
    }
    return hit.notes ? { wisprId: hit.id, text: hit.notes, via: 'search' } : null
  }
}

/** One connection's fetch (the cron's 7 days, or "Fetch past 30 days"). Never throws; a refused sign-in marks the connection "needs reconnecting". */
export const run = internalAction({
  args: { connectionId: v.id('wisprConnections'), days: v.number(), backfill: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const started = Date.now()
    const held = await ctx.runMutation(internal.wispr.claim, { connectionId: a.connectionId, until: started + LOCK_MS, backfill: !!a.backfill })
    if (held !== true) {
      // A cron run has it: "Fetch past 30 days" goes right after.
      if (a.backfill && typeof held === 'number') await ctx.scheduler.runAfter(Math.max(1000, held - started + 1000), internal.wispr.run, a)
      return
    }
    const c = (await ctx.runQuery(internal.wispr.forRun, { connectionId: a.connectionId }))!
    const tally: Record<Outcome, number> = { saved: 0, unmatched: 0, waiting: 0, duplicate: 0, gaveup: 0 }
    let tried = 0
    let more = false
    let error: string | undefined
    let session: Session | null = null
    try {
      const token = tokenKeeper(ctx, c)
      try {
        session = await openSession(c.serverUrl, await token())
      } catch (e) {
        if (!(e instanceof Unauthorized)) throw e
        session = await openSession(c.serverUrl, await token(true))
      }
      const find = finder(ctx, session, await session.listTools())
      const list = await ctx.runQuery(internal.wispr.candidates, { connectionId: c._id, days: a.days, retry: !!a.backfill })
      for (const m of list) {
        if (tried >= PER_RUN || Date.now() - started > BUDGET_MS) {
          more = true
          break
        }
        tried++
        let found: Found | null = null
        try {
          found = await find(m)
        } catch (e) {
          if (!(e instanceof McpError)) throw e
        }
        tally[await ctx.runMutation(internal.wispr.record, { meetingId: m.meetingId, userId: c.userId, found })]++
      }
    } catch (e) {
      if (e instanceof AuthRefused || e instanceof Unauthorized) {
        await ctx.runMutation(internal.wispr.markReconnect, { connectionId: c._id, why: e.message })
        console.log(`wispr run conn=${c._id} status=reconnect reason=${e instanceof AuthRefused ? e.code : '401'}`)
        await session?.close()
        return
      }
      error = e instanceof McpError ? e.message : 'Something went wrong'
      if (!(e instanceof McpError)) console.error(`wispr run conn=${c._id} failed: ${e instanceof Error ? e.name : 'unknown'}`)
    }
    await session?.close()
    const count = tally.saved + tally.unmatched
    await ctx.runMutation(internal.wispr.finish, { connectionId: c._id, count, error, backfill: !a.backfill ? 'no' : more && !error ? 'more' : 'done' })
    const counts = Object.entries(tally).map(([k, n]) => `${k}=${n}`).join(' ')
    console.log(`wispr run conn=${c._id} days=${a.days} tried=${tried} ${counts} more=${more} status=${error ? 'error' : 'ok'}`)
    if (more && !error) await ctx.scheduler.runAfter(0, internal.wispr.run, a)
  },
})
