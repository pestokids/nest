// PST-263: Calendar and Gmail. Public functions (all behind requireUser) and the
// internal mutations the sync (googleSync.ts) writes through. The encrypted
// refresh token is only ever read by `forSync` (internal) and never returned.
import { ConvexError, v } from 'convex/values'
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { allowedEmails, firstName, requireUser } from './lib/access'
import { hasTokenKey, signState } from './lib/crypto'
import { consentUrl, oauthClient } from './lib/googleApi'
import { vMeetingAnswer } from './validators'
import { applyMove } from '../src/lib/board'
import { todayIST } from '../src/lib/dates'
import { DAY_MS, dayOf, makeMatcher, normEmail, syncStageMove, WHO_BACK_DAYS } from '../src/lib/google'
import { DONE } from '../src/lib/stages'

/** The next step a synced meeting writes (and may rewrite when it moves). */
export const MEETING_STEP = 'Meeting: '

const vPerson = v.object({ email: v.string(), name: v.optional(v.string()) })
const vMeeting = v.object({ eventId: v.string(), title: v.string(), start: v.number(), end: v.number(), link: v.optional(v.string()), people: v.array(vPerson) })
const vThread = v.object({
  threadId: v.string(),
  subject: v.string(),
  participants: v.array(v.string()),
  lastAt: v.number(),
  lastFrom: v.union(v.literal('us'), v.literal('them')),
  lastFromEmail: v.string(),
  count: v.number(),
  link: v.string(),
})

const myConnection = (ctx: QueryCtx, userId: Id<'users'>) =>
  ctx.db
    .query('googleConnections')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique()

/* ---------- what the app reads ---------- */

/**
 * Your connection (status, Google email, last sync; never the token), who on the
 * team is connected, meetings and email threads. Meetings that matched no
 * investor (Who's this?) are only returned to the person whose calendar they're on.
 */
export const data = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const now = Date.now()
    const conns = await ctx.db.query('googleConnections').collect()
    const names = new Map<Id<'users'>, string>()
    for (const c of conns) names.set(c.userId, firstName(await ctx.db.get(c.userId)))
    const nameOf = async (id: Id<'users'>) => {
      if (!names.has(id)) names.set(id, firstName(await ctx.db.get(id)))
      return names.get(id)!
    }
    const mine = conns.find((c) => c.userId === userId)
    const meetings = []
    for (const m of await ctx.db
      .query('meetings')
      .withIndex('by_start', (q) => q.gte('start', now - 31 * DAY_MS))
      .collect()) {
      if (!m.investorIds.length && m.userId !== userId) continue
      meetings.push({
        _id: m._id, eventId: m.eventId, title: m.title, start: m.start, end: m.end, link: m.link, people: m.people, investorIds: m.investorIds,
        by: await nameOf(m.userId), mine: m.userId === userId, answer: m.answer, dismissed: m.dismissed,
      })
    }
    const threads = []
    for (const t of await ctx.db
      .query('emailTouches')
      .withIndex('by_last', (q) => q.gte('lastAt', now - 45 * DAY_MS))
      .collect())
      threads.push({
        _id: t._id, threadId: t.threadId, subject: t.subject, lastAt: t.lastAt, lastFrom: t.lastFrom, lastFromEmail: t.lastFromEmail,
        participants: t.participants, investorIds: t.investorIds, link: t.link, count: t.count, by: await nameOf(t.userId), mine: t.userId === userId,
      })
    return {
      me: mine
        ? {
            status: mine.status,
            email: mine.googleEmail,
            lastSyncAt: mine.lastSyncAt,
            running: (mine.lockUntil ?? 0) > now,
            scan: mine.scan ? { done: mine.scan.done, oldest: mine.scan.oldest, startedAt: mine.scan.startedAt, skipped: mine.scan.skipped } : undefined,
            lastError: mine.lastError,
          }
        : null,
      team: conns.map((c) => ({ name: names.get(c.userId) ?? '?', status: c.status, mine: c.userId === userId })).sort((a, b) => Number(b.mine) - Number(a.mine)),
      meetings,
      threads,
    }
  },
})

/* ---------- connect, sync, disconnect ---------- */

/** Who's asking (for actions, which can't read the database themselves). Throws for anyone requireUser refuses. */
export const whoami = internalQuery({
  args: {},
  handler: async (ctx) => {
    const { userId, user } = await requireUser(ctx)
    return { userId, email: (user.email ?? '').toLowerCase() }
  },
})

/**
 * Start "Connect Google": the consent URL for Calendar (read-only) and Gmail
 * (headers only), with a signed state naming you. Errors (and stores nothing)
 * when the server isn't set up for it.
 */
export const connect = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const me = await ctx.runQuery(internal.google.whoami, {})
    const client = oauthClient()
    if (!client) throw new ConvexError('Google isn’t set up on the server yet (AUTH_GOOGLE_ID). Nothing was stored.')
    if (!hasTokenKey()) throw new ConvexError('Google can’t be connected yet: the server is missing GOOGLE_TOKEN_KEY. Nothing was stored.')
    const state = await signState({ u: me.userId, exp: Date.now() + 10 * 6e4 })
    return consentUrl(client.id, state, me.email)
  },
})

/** Sync now (Settings). */
export const syncNow = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const c = await myConnection(ctx, userId)
    if (!c) throw new ConvexError('Connect Google first.')
    if (c.status === 'reconnect') throw new ConvexError('Google needs reconnecting first.')
    await ctx.scheduler.runAfter(0, internal.googleSync.run, { connectionId: c._id })
    return null
  },
})

/** Delete every meeting and email touch synced from one person's account. */
async function deleteSynced(ctx: MutationCtx, userId: Id<'users'>) {
  let n = 0
  for (const m of await ctx.db
    .query('meetings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()) {
    await ctx.db.delete(m._id)
    n++
  }
  for (const t of await ctx.db
    .query('emailTouches')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect()) {
    await ctx.db.delete(t._id)
    n++
  }
  return n
}

/**
 * Disconnect: delete your connection, your meetings and your email touches, and
 * ask Google to forget the grant. Stage moves already made stay in History.
 */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const c = await myConnection(ctx, userId)
    const removed = await deleteSynced(ctx, userId)
    if (c) {
      await ctx.db.delete(c._id)
      await ctx.scheduler.runAfter(0, internal.googleSync.revokeGrant, { sealed: c.refreshToken })
    }
    return removed
  },
})

/** "How did it go?" answered (after the stage move itself, which goes through investors.move). */
export const answerMeeting = mutation({
  args: { eventId: v.string(), answer: vMeetingAnswer },
  handler: async (ctx, { eventId, answer }) => {
    await requireUser(ctx)
    const rows = await ctx.db
      .query('meetings')
      .withIndex('by_event', (q) => q.eq('eventId', eventId))
      .collect()
    for (const m of rows) await ctx.db.patch(m._id, { answer })
    return rows.length
  },
})

/** "Not about the round" on Who's this?: stop asking about this person (your recent meetings). */
export const dismissPerson = mutation({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    const { userId } = await requireUser(ctx)
    const e = normEmail(email)
    if (!e) throw new ConvexError('That doesn’t look like an email address.')
    let n = 0
    for (const m of await ctx.db
      .query('meetings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()) {
      if (!m.people.some((p) => p.email === e) || m.dismissed?.includes(e)) continue
      await ctx.db.patch(m._id, { dismissed: [...(m.dismissed ?? []), e] })
      n++
    }
    return n
  },
})

/* ---------- the OAuth callback's writes ---------- */

/** The user the signed state names, if they still pass the access list. */
export const allowedUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const id = ctx.db.normalizeId('users', userId)
    const user = id ? await ctx.db.get(id) : null
    const email = user?.email?.toLowerCase()
    if (!user || !email || user.emailVerificationTime === undefined || !allowedEmails().has(email)) return null
    return { userId: user._id, email }
  },
})

/** Save a new (or renewed) connection with its sealed refresh token, and start from scratch. */
export const store = internalMutation({
  args: { userId: v.id('users'), googleEmail: v.string(), sealed: v.string() },
  handler: async (ctx, { userId, googleEmail, sealed }) => {
    const prev = await myConnection(ctx, userId)
    const doc = { userId, googleEmail: googleEmail.toLowerCase(), refreshToken: sealed, status: 'syncing' as const, connectedAt: Date.now() }
    if (prev) {
      await ctx.db.replace(prev._id, doc)
      return prev._id
    }
    return await ctx.db.insert('googleConnections', doc)
  },
})

/* ---------- the sync's reads and writes ---------- */

/** Internal only: the whole connection, sealed token included, for the sync action. */
export const forSync = internalQuery({
  args: { connectionId: v.id('googleConnections') },
  handler: (ctx, { connectionId }) => ctx.db.get(connectionId),
})

const matchInputs = async (ctx: QueryCtx) =>
  (await ctx.db.query('investors').collect()).map((i) => ({ _id: i._id as string, email: i.email, emails: i.emails, domains: i.domains }))

/** What matching needs from investors (the sync action filters threads with it before anything is written). */
export const matchData = internalQuery({ args: {}, handler: (ctx) => matchInputs(ctx) })

/** Take the run lock; false when another run holds it. */
export const claim = internalMutation({
  args: { connectionId: v.id('googleConnections'), until: v.number() },
  handler: async (ctx, { connectionId, until }) => {
    const c = await ctx.db.get(connectionId)
    if (!c || c.status === 'reconnect' || (c.lockUntil ?? 0) > Date.now()) return false
    await ctx.db.patch(connectionId, { lockUntil: until })
    return true
  },
})

export const saveCursors = internalMutation({
  args: {
    connectionId: v.id('googleConnections'),
    calendarSyncToken: v.optional(v.union(v.string(), v.null())),
    gmailHistoryId: v.optional(v.string()),
    scan: v.optional(
      v.union(
        v.object({ pageToken: v.optional(v.string()), done: v.number(), oldest: v.optional(v.number()), skipped: v.optional(v.number()), startedAt: v.number(), historyId: v.string() }),
        v.null(),
      ),
    ),
    rescan: v.optional(v.boolean()),
  },
  handler: async (ctx, { connectionId, calendarSyncToken, gmailHistoryId, scan, rescan }) => {
    if (!(await ctx.db.get(connectionId))) return
    await ctx.db.patch(connectionId, {
      ...(calendarSyncToken !== undefined ? { calendarSyncToken: calendarSyncToken ?? undefined } : {}),
      ...(gmailHistoryId !== undefined ? { gmailHistoryId } : {}),
      ...(scan !== undefined ? { scan: scan ?? undefined } : {}),
      ...(rescan !== undefined ? { rescan: rescan || undefined } : {}),
    })
  },
})

/** End of a run: release the lock; "Last synced" moves only when a run finished cleanly. */
export const finish = internalMutation({
  args: { connectionId: v.id('googleConnections'), error: v.optional(v.string()), more: v.boolean() },
  handler: async (ctx, { connectionId, error, more }) => {
    const c = await ctx.db.get(connectionId)
    if (!c) return
    const now = Date.now()
    const done = !error && !more
    await ctx.db.patch(connectionId, {
      lockUntil: undefined,
      lastError: error,
      ...(done ? { lastSyncAt: now } : {}),
      status: c.status === 'reconnect' ? 'reconnect' : c.lastSyncAt || done ? 'connected' : 'syncing',
    })
  },
})

/** Google refused the token: stop syncing until the user reconnects. Never throws. */
export const markReconnect = internalMutation({
  args: { connectionId: v.id('googleConnections'), why: v.string() },
  handler: async (ctx, { connectionId, why }) => {
    if (!(await ctx.db.get(connectionId))) return
    await ctx.db.patch(connectionId, { status: 'reconnect', lockUntil: undefined, lastError: why.slice(0, 200) })
  },
})

/* ---------- effects on investors ---------- */

type Inv = Doc<'investors'>

/** A meeting ahead: Booked if they're behind it (forward only, logged with source "calendar"), and the next step and date. */
async function meetingAhead(ctx: MutationCtx, i: Inv, m: { title: string; start: number }, userId: Id<'users'>, today: string) {
  const patch: Partial<Inv> = {}
  const to = syncStageMove(i.stage, 'booked')
  if (to) {
    const r = applyMove(i, to, today)
    Object.assign(patch, r.patch)
    if (r.logStage) await ctx.db.insert('activities', { investorId: i._id, kind: 'stage', stage: to, date: today, userId, source: 'calendar' })
  }
  const day = dayOf(m.start)
  if (!DONE.has(i.stage) && (!i.nextDate || i.nextDate < today || day <= i.nextDate || i.nextStep.startsWith(MEETING_STEP))) {
    patch.nextStep = `${MEETING_STEP}${m.title}`.slice(0, 200)
    patch.nextDate = day
  }
  if (Object.keys(patch).length) await ctx.db.patch(i._id, { ...patch, updatedAt: Date.now() })
}

/** A meeting that happened, or an email either way: Last touch moves forward to that day (never into the future). */
async function touched(ctx: MutationCtx, i: Inv, day: string, today: string) {
  const d = day > today ? today : day
  if (!i.lastTouch || i.lastTouch < d) await ctx.db.patch(i._id, { lastTouch: d, updatedAt: Date.now() })
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))

/**
 * Upsert meetings by (user, event id) and drop cancelled or no-longer-outside
 * ones. Running it twice with the same events changes nothing.
 */
export const upsertMeetings = internalMutation({
  args: { userId: v.id('users'), self: v.string(), items: v.array(vMeeting), drops: v.array(v.string()) },
  handler: async (ctx, { userId, self, items, drops }) => {
    const now = Date.now()
    const today = todayIST(now)
    const match = makeMatcher(await matchInputs(ctx))
    for (const eventId of drops) {
      const row = await ctx.db
        .query('meetings')
        .withIndex('by_user_event', (q) => q.eq('userId', userId).eq('eventId', eventId))
        .unique()
      if (row) await ctx.db.delete(row._id)
    }
    for (const m of items) {
      const ids = match.people(m.people.map((p) => p.email), self).ids as Id<'investors'>[]
      const row = await ctx.db
        .query('meetings')
        .withIndex('by_user_event', (q) => q.eq('userId', userId).eq('eventId', m.eventId))
        .unique()
      const ended = m.end <= now
      const moved = !!row && row.start !== m.start
      const fresh = (id: Id<'investors'>) => !row || moved || !row.investorIds.includes(id)
      const doc = { ...m, userId, investorIds: ids, touched: ended && ids.length > 0 }
      if (row) {
        const same = row.title === m.title && row.start === m.start && row.end === m.end && row.link === m.link && JSON.stringify(row.people) === JSON.stringify(m.people) && sameIds(row.investorIds, ids)
        if (!same || (doc.touched && !row.touched)) await ctx.db.patch(row._id, { ...doc, touched: doc.touched || (!moved && row.touched) })
      } else await ctx.db.insert('meetings', doc)
      for (const id of ids) {
        const i = await ctx.db.get(id)
        if (!i) continue
        if (ended) await touched(ctx, i, dayOf(m.start), today)
        else if (fresh(id)) await meetingAhead(ctx, i, m, userId, today)
      }
    }
  },
})

/** Meetings that have ended since they were synced: set Last touch once. */
export const applyPast = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const now = Date.now()
    const today = todayIST(now)
    let n = 0
    for (const m of await ctx.db
      .query('meetings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect()) {
      if (m.touched || m.end > now || !m.investorIds.length) continue
      for (const id of m.investorIds) {
        const i = await ctx.db.get(id)
        if (i) await touched(ctx, i, dayOf(m.start), today)
      }
      await ctx.db.patch(m._id, { touched: true })
      n++
    }
    return n
  },
})

/**
 * Upsert email touches by (user, thread id). Only threads with an investor are
 * kept; one that no longer matches anyone is deleted. Each sets Last touch.
 */
export const upsertThreads = internalMutation({
  args: { userId: v.id('users'), self: v.string(), items: v.array(vThread) },
  handler: async (ctx, { userId, self, items }) => {
    const today = todayIST()
    const match = makeMatcher(await matchInputs(ctx))
    let kept = 0
    for (const t of items) {
      const ids = match.people(t.participants, self).ids as Id<'investors'>[]
      const row = await ctx.db
        .query('emailTouches')
        .withIndex('by_user_thread', (q) => q.eq('userId', userId).eq('threadId', t.threadId))
        .unique()
      if (!ids.length) {
        if (row) await ctx.db.delete(row._id)
        continue
      }
      kept++
      const doc = { ...t, userId, investorIds: ids }
      if (!row) await ctx.db.insert('emailTouches', doc)
      else if (row.lastAt !== t.lastAt || row.count !== t.count || row.subject !== t.subject || !sameIds(row.investorIds, ids) || row.participants.length !== t.participants.length)
        await ctx.db.patch(row._id, doc)
      for (const id of ids) {
        const i = await ctx.db.get(id)
        if (i) await touched(ctx, i, dayOf(t.lastAt), today)
      }
    }
    return kept
  },
})

/**
 * An investor's email, emails or domains changed (or one was added or deleted):
 * match every stored meeting and thread again, apply what's newly matched, and
 * (`rescan`) read the last 30 days of Gmail again on the next run for threads
 * with the new addresses.
 */
export const rematch = internalMutation({
  args: { rescan: v.boolean() },
  handler: async (ctx, { rescan }) => {
    const conns = await ctx.db.query('googleConnections').collect()
    if (!conns.length) return 0
    const self = new Map(conns.map((c) => [c.userId, c.googleEmail]))
    const now = Date.now()
    const today = todayIST(now)
    const match = makeMatcher(await matchInputs(ctx))
    let changed = 0
    for (const m of await ctx.db.query('meetings').collect()) {
      const ids = match.people(m.people.map((p) => p.email), self.get(m.userId)).ids as Id<'investors'>[]
      if (sameIds(ids, m.investorIds)) continue
      changed++
      const ended = m.end <= now
      await ctx.db.patch(m._id, { investorIds: ids, touched: ended && ids.length > 0 })
      for (const id of ids.filter((x) => !m.investorIds.includes(x))) {
        const i = await ctx.db.get(id)
        if (!i) continue
        if (ended) await touched(ctx, i, dayOf(m.start), today)
        else await meetingAhead(ctx, i, m, m.userId, today)
      }
    }
    for (const t of await ctx.db.query('emailTouches').collect()) {
      const ids = match.people(t.participants, self.get(t.userId)).ids as Id<'investors'>[]
      if (sameIds(ids, t.investorIds)) continue
      changed++
      if (!ids.length) {
        await ctx.db.delete(t._id)
        continue
      }
      await ctx.db.patch(t._id, { investorIds: ids })
      for (const id of ids.filter((x) => !t.investorIds.includes(x))) {
        const i = await ctx.db.get(id)
        if (i) await touched(ctx, i, dayOf(t.lastAt), today)
      }
    }
    if (rescan) for (const c of conns) if (c.status !== 'reconnect') await ctx.db.patch(c._id, { rescan: true })
    return changed
  },
})

/** Every 10 minutes (crons.ts): one sync per connection, and old meetings nobody was matched to are dropped. */
export const tick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    let n = 0
    for (const c of await ctx.db.query('googleConnections').collect()) {
      if (c.status === 'reconnect' || (c.lockUntil ?? 0) > now) continue
      await ctx.scheduler.runAfter(0, internal.googleSync.run, { connectionId: c._id })
      n++
    }
    for (const m of await ctx.db
      .query('meetings')
      .withIndex('by_start', (q) => q.lt('start', now - (WHO_BACK_DAYS + 1) * DAY_MS))
      .take(500))
      if (!m.investorIds.length) await ctx.db.delete(m._id)
    return n
  },
})
