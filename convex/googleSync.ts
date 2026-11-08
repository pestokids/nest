// PST-263: the sync itself. One run per connection (crons.ts, every 10 minutes,
// or Sync now): Calendar incrementally with a sync token, then Gmail from the
// stored history id, or a newest-first read of the last 30 days on the first run
// (in chunks, so progress shows on Settings). A token Google refuses marks the
// connection "needs reconnecting"; nothing here throws out of the run. Thread
// reads are paced (PACE) and rate limits retried with backoff (lib/googleApi.ts);
// one that outlasts the retries keeps what the run read and fails it with the
// reason. A single thread Google refuses for any other reason (403, 404) is
// skipped and counted, not fatal.
import { v } from 'convex/values'
import { internalAction, type ActionCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import { decryptToken, MissingKey } from './lib/crypto'
import { mapLimit } from './lib/mapLimit'
import { pacer } from './lib/pace'
import {
  accessToken, getThread, GMAIL_READONLY, GoogleError, gmailProfile, inboundMessages, listEvents, listHistory, listThreads, parseEvent, parseThread, revoke, Revoked,
  type Inbound, type ParsedMeeting, type ParsedThread,
} from './lib/googleApi'
import { emailSignals } from './lib/signalHooks' // PST-293
import { DAY_MS, GMAIL_BACK_DAYS, makeMatcher } from '../src/lib/google'

/** A run holds the lock this long at most (a stuck run frees it for the next cron). */
const LOCK_MS = 9 * 6e4
/** Threads read per run during the 30-day read; the rest continue in a follow-up run straight away. */
const SCAN_CHUNK = 300
/** Parallel Gmail requests. Two keep PACE busy; more would only queue up behind it. */
const PARALLEL = 2
/**
 * threads.get per second, across a run's workers and their retries. Each costs 10
 * of the 250 quota units a user gets per second: 15 leaves room for the rest. Tests set it.
 */
export const PACE = { threadsPerSecond: 15 }
const MAX_PAGES = 20

type Conn = Doc<'googleConnections'>
/** One run's pacer, and what it did (logged when the run ends). */
type Run = { pace: () => Promise<void>; read: number; skipped: number; retries: number }

async function syncCalendar(ctx: ActionCtx, c: Conn, token: string, now: number) {
  let syncToken = c.calendarSyncToken
  let pageToken: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    let res
    try {
      res = await listEvents(token, { syncToken, pageToken, now })
    } catch (e) {
      // The sync token expired: start over with the 30/60-day window.
      if (e instanceof GoogleError && e.status === 410 && syncToken) {
        syncToken = undefined
        pageToken = undefined
        continue
      }
      throw e
    }
    const items: ParsedMeeting[] = []
    const drops: string[] = []
    for (const ev of res.items ?? []) {
      const r = parseEvent(ev, c.googleEmail)
      if ('drop' in r) drops.push(r.drop)
      else if (r.end >= now - 31 * DAY_MS) items.push(r)
    }
    if (items.length || drops.length) await ctx.runMutation(internal.google.upsertMeetings, { userId: c.userId, self: c.googleEmail, items, drops })
    if (res.nextPageToken) {
      pageToken = res.nextPageToken
      continue
    }
    await ctx.runMutation(internal.google.saveCursors, { connectionId: c._id, calendarSyncToken: res.nextSyncToken ?? null })
    return
  }
}

/**
 * 403s that are about the project or the account, not this thread: daily quota,
 * the API turned off, a Workspace policy. Skipping past them would read nothing,
 * so they fail the run with their reason instead.
 */
const ACCOUNT_LEVEL = /^(dailyLimitExceeded|quotaExceeded|accessNotConfigured|SERVICE_DISABLED|domainPolicy)$/
/** A problem with this one thread (404 gone, or a 403 that isn't a rate limit or account-level): skip it rather than fail the run. */
const skippable = (e: unknown): e is GoogleError =>
  e instanceof GoogleError && (e.status === 404 || (e.status === 403 && !e.rateLimited && !ACCOUNT_LEVEL.test(e.reason)))

/**
 * Read threads, keep the ones with an investor, write them. Returns the parsed
 * threads (for progress) and how many were skipped. When Google refused every
 * thread on the page with a 403, throws the most common reason instead: nothing
 * moves forward, and the read tries the same page again next run. A 404 (the
 * thread was deleted) is always a quiet skip and never counts toward that. A
 * rate limit that outlasts the retries starts no new reads, writes the threads
 * already read, then throws.
 */
async function readThreads(ctx: ActionCtx, c: Conn, token: string, ids: string[], cutoff: number, run: Run, added?: ReadonlySet<string>) {
  const match = makeMatcher(await ctx.runQuery(internal.google.matchData, {}))
  const why = new Map<string, { status: number; reason: string; n: number }>()
  const hooks = { pace: run.pace, onRetry: () => void run.retries++ }
  const results = new Map<string, ParsedThread | null | 'skipped'>()
  // PST-293: the new messages someone else sent (history runs only), for signals.
  const inbound: Inbound[] = []
  let limited: GoogleError | undefined
  try {
    await mapLimit(ids, PARALLEL, async (id) => {
      try {
        const t = await getThread(token, id, hooks)
        run.read++
        results.set(id, parseThread(t, c.googleEmail))
        if (added) inbound.push(...inboundMessages(t, c.googleEmail, added))
      } catch (e) {
        if (!skippable(e)) throw e
        const k = `${e.status}${e.reason ? ` ${e.reason}` : ''}`
        const w = why.get(k) ?? { status: e.status, reason: e.reason, n: 0 }
        why.set(k, { ...w, n: w.n + 1 })
        results.set(id, 'skipped')
      }
    })
  } catch (e) {
    if (!(e instanceof GoogleError && e.rateLimited)) throw e
    limited = e
  }
  const read = ids.map((id) => results.get(id))
  const parsed = read.filter((t): t is ParsedThread => !!t && t !== 'skipped')
  const skipped = read.filter((t) => t === 'skipped').length
  run.skipped += skipped
  if (skipped) console.warn(`google sync ${c._id}: skipped ${skipped} of ${ids.length} threads (${[...why].map(([k, w]) => `${k} ×${w.n}`).join(', ')})`)
  const refused = [...why.values()].filter((w) => w.status === 403)
  if (ids.length && refused.reduce((n, w) => n + w.n, 0) === ids.length) {
    const top = refused.sort((a, b) => b.n - a.n)[0]
    throw new GoogleError(top.status, 'gmail thread', top.reason)
  }
  // Only threads with an investor ever leave this action.
  const keep = parsed.filter((t) => t.lastAt >= cutoff && match.people(t.participants, c.googleEmail).ids.length > 0)
  for (let k = 0; k < keep.length; k += 100) await ctx.runMutation(internal.google.upsertThreads, { userId: c.userId, self: c.googleEmail, items: keep.slice(k, k + 100) })
  if (limited) throw limited
  return { parsed, skipped, inbound }
}

/** Gmail: history since the stored id, or the 30-day read. Returns true when the read continues in another run. */
async function syncGmail(ctx: ActionCtx, c: Conn, token: string, now: number, run: Run): Promise<boolean> {
  const cutoff = now - GMAIL_BACK_DAYS * DAY_MS
  if (c.gmailHistoryId && !c.scan && !c.rescan) {
    const threadIds = new Set<string>()
    const added = new Set<string>()
    let historyId = c.gmailHistoryId
    let pageToken: string | undefined
    let expired = false
    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const res = await listHistory(token, c.gmailHistoryId, pageToken)
        for (const h of res.history ?? []) for (const a of h.messagesAdded ?? []) if (a.message?.threadId) {
          threadIds.add(a.message.threadId)
          added.add(a.message.id)
        }
        if (res.historyId) historyId = res.historyId
        if (!res.nextPageToken) break
        pageToken = res.nextPageToken
      } catch (e) {
        if (e instanceof GoogleError && e.status === 404) {
          expired = true
          break
        }
        throw e
      }
    }
    if (!expired) {
      // Rate-limited for good: what was read is written, and the history id stays put, so next run reads the same changes.
      const { inbound } = await readThreads(ctx, c, token, [...threadIds], cutoff, run, added)
      await ctx.runMutation(internal.google.saveCursors, { connectionId: c._id, gmailHistoryId: historyId })
      // PST-293: one Jev call per new email from an investor. Never fails the sync.
      const bodies = await emailSignals(ctx, c, token, inbound, { pace: run.pace, onRetry: () => void run.retries++ }, c.gmailBodies !== false)
      if (bodies === false && c.gmailBodies !== false) await ctx.runMutation(internal.google.setBodies, { connectionId: c._id, bodies: false })
      return false
    }
  }
  // The 30-day read: newest first, until a whole page is older than 30 days.
  let scan: NonNullable<Conn['scan']> = c.scan && !c.rescan ? { ...c.scan } : { done: 0, startedAt: now, historyId: (await gmailProfile(token)).historyId }
  let read = 0
  try {
    while (read < SCAN_CHUNK) {
      const res = await listThreads(token, scan.pageToken)
      const ids = (res.threads ?? []).map((t) => t.id)
      const { parsed, skipped } = await readThreads(ctx, c, token, ids, cutoff, run)
      read += ids.length
      const newest = Math.max(0, ...parsed.map((t) => t.lastAt))
      const oldest = parsed.length ? Math.max(cutoff, Math.min(...parsed.map((t) => t.lastAt))) : scan.oldest
      scan = { ...scan, done: scan.done + ids.length, ...(oldest ? { oldest } : {}), ...(skipped || scan.skipped ? { skipped: (scan.skipped ?? 0) + skipped } : {}), pageToken: res.nextPageToken }
      // A page with nothing read (all skipped) says nothing about dates: carry on to the next one.
      if (!res.nextPageToken || !ids.length || (parsed.length > 0 && newest < cutoff)) {
        await ctx.runMutation(internal.google.saveCursors, { connectionId: c._id, gmailHistoryId: scan.historyId, scan: null, rescan: false })
        return false
      }
    }
  } catch (e) {
    // Rate-limited for good: keep the pages this run finished, and the token of the one it was on, which is read again next run.
    if (e instanceof GoogleError && e.rateLimited) await ctx.runMutation(internal.google.saveCursors, { connectionId: c._id, scan, rescan: false })
    throw e
  }
  await ctx.runMutation(internal.google.saveCursors, { connectionId: c._id, scan, rescan: false })
  return true
}

/** One sync run for one connection. Returns what happened (for tests and logs); never throws. */
export const run = internalAction({
  args: { connectionId: v.id('googleConnections') },
  handler: async (ctx, { connectionId }): Promise<'skipped' | 'busy' | 'done' | 'more' | 'reconnect' | 'error'> => {
    const c = await ctx.runQuery(internal.google.forSync, { connectionId })
    if (!c || c.status === 'reconnect') return 'skipped'
    const now = Date.now()
    if (!(await ctx.runMutation(internal.google.claim, { connectionId, until: now + LOCK_MS }))) return 'busy'
    const gmail: Run = { pace: pacer(PACE.threadsPerSecond), read: 0, skipped: 0, retries: 0 }
    try {
      let refresh: string
      try {
        refresh = await decryptToken(c.refreshToken)
      } catch (e) {
        // The key is gone: nothing can be read until it's back. A different key: the token is unreadable, reconnect.
        if (e instanceof MissingKey) throw e
        throw new Revoked('token unreadable')
      }
      const { token, scopes } = await accessToken(refresh)
      // PST-293: Google lists the grant's scopes on each refresh: gmail.metadata alone means subjects only for Jev.
      if (scopes && scopes.includes(GMAIL_READONLY) !== c.gmailBodies) {
        c.gmailBodies = scopes.includes(GMAIL_READONLY)
        await ctx.runMutation(internal.google.setBodies, { connectionId, bodies: c.gmailBodies })
      }
      await syncCalendar(ctx, c, token, now)
      const more = await syncGmail(ctx, c, token, now, gmail)
      await ctx.runMutation(internal.google.applyPast, { userId: c.userId })
      await ctx.runMutation(internal.google.finish, { connectionId, more })
      if (more) await ctx.scheduler.runAfter(0, internal.googleSync.run, { connectionId })
      // PST-275: what the sync learned can make new suggestions (a meeting happened, a domain turned up).
      else await ctx.runMutation(internal.suggestions.check, {})
      return more ? 'more' : 'done'
    } catch (e) {
      if (e instanceof Revoked) {
        await ctx.runMutation(internal.google.markReconnect, { connectionId, why: 'Google stopped accepting this connection.' })
        return 'reconnect'
      }
      const why = e instanceof MissingKey ? 'The server is missing GOOGLE_TOKEN_KEY.' : e instanceof GoogleError ? e.message : 'Sync failed. It will try again in 10 minutes.'
      console.error(`google sync ${connectionId}: ${why}`)
      await ctx.runMutation(internal.google.finish, { connectionId, error: why, more: false })
      return 'error'
    } finally {
      console.log(`google sync ${connectionId}: read ${gmail.read} threads, skipped ${gmail.skipped}, ${gmail.retries} rate-limit retries, ${((Date.now() - now) / 1000).toFixed(1)}s`)
    }
  },
})

/** Disconnect: ask Google to forget the grant. Best effort; the connection is already deleted. */
export const revokeGrant = internalAction({
  args: { sealed: v.string() },
  handler: async (_ctx, { sealed }) => {
    try {
      await revoke(await decryptToken(sealed))
    } catch {
      // Unreadable or no key: Google expires unused grants anyway.
    }
  },
})
