// PST-263: the few Google endpoints Nest calls, and how their answers become rows.
// Read-only: Calendar events (calendar.readonly) and Gmail (gmail.readonly: headers for
// email touches, and PST-293's one read of a new investor email's text for Jev, never stored).
// Nothing here logs a token, and errors never include one.
import { CALENDAR_AHEAD_DAYS, CALENDAR_BACK_DAYS, DAY_MS, gmailThreadLink, isOurs, normEmail, parseAddresses } from '../../src/lib/google'
import { isAutomated, type GPart } from '../../src/lib/signals'

// PST-293: gmail.readonly instead of gmail.metadata, so signals can read a new email's text.
// A connection made before keeps working on headers; its signals read the subject alone.
export const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/gmail.readonly'] as const
export const CALLBACK_PATH = '/google/callback'

/** Google no longer accepts the refresh token (revoked, expired, or a scope was taken away): the user has to reconnect. */
export class Revoked extends Error {
  constructor(why: string) {
    super(`Google access revoked: ${why}`)
  }
}
/** Any other failure (rate limit, outage). Retried on the next run. `reason` is Google's, e.g. `userRateLimitExceeded`. */
export class GoogleError extends Error {
  constructor(
    public status: number,
    what: string,
    public reason = '',
  ) {
    super(`Google ${what} failed (${status}${reason ? ` ${reason}` : ''})`)
  }
  /** Google is asking us to slow down: retried with backoff in `get`, and never treated as "skip this one". */
  get rateLimited() {
    return isRateLimit(this.status, this.reason)
  }
}

const RATE_LIMIT_REASONS = /^(rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED|RESOURCE_EXHAUSTED)$/
const isRateLimit = (status: number, reason: string) => status === 429 || (status === 403 && RATE_LIMIT_REASONS.test(reason))

/**
 * How `get` backs off when Google rate-limits: `tries` attempts in all, waiting
 * about baseMs, 2×, 4×… (capped at maxMs, plus up to baseMs of jitter) between
 * them: 2, 4, 8, 16 and 32 s. Tests set baseMs to 0.
 */
export const RETRY = { tries: 6, baseMs: 2000, maxMs: 32_000 }

/** Per-run hooks for `get`: `pace` is awaited before every request (retries too), `onRetry` hears each rate-limit retry. */
export type Hooks = { pace?: () => Promise<void>; onRetry?: () => void }
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export const redirectUri = () => `${process.env.CONVEX_SITE_URL}${CALLBACK_PATH}`

export function oauthClient() {
  const id = process.env.AUTH_GOOGLE_ID
  const secret = process.env.AUTH_GOOGLE_SECRET
  if (!id || !secret) return null
  return { id, secret }
}

/** The consent URL: incremental (keeps sign-in's scopes), offline, always asks so Google returns a refresh token. */
export function consentUrl(clientId: string, state: string, loginHint?: string) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  if (loginHint) q.set('login_hint', loginHint)
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

async function tokenCall(body: Record<string, string>, what: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string }
  if (!res.ok) {
    if (j.error === 'invalid_grant' || j.error === 'unauthorized_client') throw new Revoked(j.error)
    throw new GoogleError(res.status, what)
  }
  return j
}

/** Exchange the callback's code. */
export async function exchangeCode(code: string) {
  const c = oauthClient()
  if (!c) throw new GoogleError(500, 'setup')
  const j = await tokenCall({ code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri(), grant_type: 'authorization_code' }, 'code exchange')
  return { accessToken: j.access_token ?? '', refreshToken: j.refresh_token, scopes: (j.scope ?? '').split(/\s+/) }
}

/** A fresh access token from the stored refresh token. */
export async function accessToken(refreshToken: string) {
  const c = oauthClient()
  if (!c) throw new GoogleError(500, 'setup')
  const j = await tokenCall({ refresh_token: refreshToken, client_id: c.id, client_secret: c.secret, grant_type: 'refresh_token' }, 'token refresh')
  if (!j.access_token) throw new GoogleError(500, 'token refresh')
  return j.access_token
}

/** Tell Google to forget the grant (Disconnect). Best effort. */
export async function revoke(token: string) {
  await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => undefined)
}

type GoogleErrorBody = { error?: { status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } }

/** Google's reason for a failure (`rateLimitExceeded`, `forbidden`, `failedPrecondition`…), from the error body. Never the message. */
async function errorReason(res: Response) {
  const j = (await res.json().catch(() => ({}))) as GoogleErrorBody
  const e = j.error
  const reason = e?.errors?.find((x) => x.reason)?.reason ?? e?.details?.find((x) => x.reason)?.reason ?? e?.status ?? ''
  // Shown on Settings and in logs: keep it a short identifier.
  return reason.replace(/[^\w.-]/g, '').slice(0, 60)
}

async function get<T>(url: string, token: string, what: string, hooks: Hooks = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    await hooks.pace?.()
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
    if (res.ok) return (await res.json()) as T
    if (res.status === 401) throw new Revoked(`${what} 401`)
    const reason = await errorReason(res)
    // A scope was unticked or taken away: only reconnecting fixes that.
    if (res.status === 403 && /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(reason)) throw new Revoked(`${what} ${reason}`)
    if (isRateLimit(res.status, reason) && attempt < RETRY.tries) {
      hooks.onRetry?.()
      const wait = Math.min(RETRY.maxMs, RETRY.baseMs * 2 ** (attempt - 1))
      await sleep(wait + Math.random() * RETRY.baseMs)
      continue
    }
    throw new GoogleError(res.status, reason === 'accessNotConfigured' ? `${what} (the API isn't turned on in Google Cloud)` : what, reason)
  }
}

/* ---------- Calendar ---------- */

export type GEvent = {
  id: string
  status?: string
  summary?: string
  htmlLink?: string
  start?: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string }[]
  organizer?: { email?: string; displayName?: string; self?: boolean }
}
type EventsPage = { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }

/** One page of the primary calendar: incremental with `syncToken`, else 30 days back and 60 ahead. 410 means the token expired. */
export function listEvents(token: string, o: { syncToken?: string; pageToken?: string; now: number }) {
  const q = new URLSearchParams({ singleEvents: 'true', maxResults: '250' })
  if (o.syncToken) q.set('syncToken', o.syncToken)
  else {
    q.set('timeMin', new Date(o.now - CALENDAR_BACK_DAYS * DAY_MS).toISOString())
    q.set('timeMax', new Date(o.now + CALENDAR_AHEAD_DAYS * DAY_MS).toISOString())
  }
  if (o.pageToken) q.set('pageToken', o.pageToken)
  return get<EventsPage>(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, token, 'calendar')
}

export type ParsedMeeting = { eventId: string; title: string; start: number; end: number; link?: string; people: { email: string; name?: string }[] }

/**
 * An event as a meeting row, or `{ drop }` when it should not be kept: cancelled,
 * all-day, declined, or nobody from outside. `people` are the outside attendees only.
 */
export function parseEvent(e: GEvent, self: string): ParsedMeeting | { drop: string } {
  if (e.status === 'cancelled') return { drop: e.id }
  const start = Date.parse(e.start?.dateTime ?? '')
  const end = Date.parse(e.end?.dateTime ?? e.start?.dateTime ?? '')
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { drop: e.id } // all-day
  const me = (e.attendees ?? []).find((a) => a.self)
  if (me?.responseStatus === 'declined') return { drop: e.id }
  const people: { email: string; name?: string }[] = []
  const all = [...(e.attendees ?? []), ...(e.organizer && !e.attendees?.length ? [e.organizer] : [])]
  for (const a of all) {
    if ('resource' in a && a.resource) continue
    const email = normEmail(a.email)
    if (!email || a.self || isOurs(email, self) || /(^|\.)calendar\.google\.com$|group\.v\.calendar/.test(email.split('@')[1] ?? '')) continue
    if (people.some((p) => p.email === email)) continue
    people.push(a.displayName?.trim() ? { email, name: a.displayName.trim().slice(0, 120) } : { email })
  }
  if (!people.length) return { drop: e.id }
  return { eventId: e.id, title: (e.summary ?? '').trim().slice(0, 200) || '(No title)', start, end, ...(e.htmlLink ? { link: e.htmlLink } : {}), people }
}

/* ---------- Gmail ---------- */

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

export const gmailProfile = (token: string) => get<{ emailAddress: string; historyId: string }>(`${GMAIL}/profile`, token, 'gmail profile')

/**
 * One page of threads, newest first. The gmail.metadata scope can't use `q`
 * (so no `newer_than:30d`): the caller reads pages until it passes 30 days.
 */
export function listThreads(token: string, pageToken?: string) {
  const q = new URLSearchParams({ maxResults: '100' })
  if (pageToken) q.set('pageToken', pageToken)
  return get<{ threads?: { id: string }[]; nextPageToken?: string }>(`${GMAIL}/threads?${q}`, token, 'gmail threads')
}

export type GMessage = { id: string; threadId: string; internalDate?: string; labelIds?: string[]; payload?: GPart & { headers?: { name: string; value: string }[] } }
export type GThread = { id: string; messages?: GMessage[] }

/** A thread's headers only (From, To, Cc, Subject; PST-293: and the ones that mark an auto-reply). Never bodies or snippets. */
export function getThread(token: string, id: string, hooks?: Hooks) {
  const q = new URLSearchParams({ format: 'metadata' })
  for (const h of ['From', 'To', 'Cc', 'Subject', ...AUTO_HEADERS]) q.append('metadataHeaders', h)
  return get<GThread>(`${GMAIL}/threads/${encodeURIComponent(id)}?${q}`, token, 'gmail thread', hooks)
}

/* ---------- PST-293: new investor emails, for signals ---------- */

const AUTO_HEADERS = ['Auto-Submitted', 'Precedence', 'X-Autoreply', 'X-Autorespond']

/** One message with its text (gmail.readonly; a 403 under the older gmail.metadata grant). Read once for Jev, never stored. */
export function getMessage(token: string, id: string, hooks?: Hooks) {
  return get<GMessage>(`${GMAIL}/messages/${encodeURIComponent(id)}?format=full`, token, 'gmail message', hooks)
}

/** A new message someone else sent: its id, sender, subject and time. */
export type Inbound = { messageId: string; threadId: string; from: string; subject: string; at: number }

/** The messages in `added` (new since the last sync) from someone outside, minus auto-replies and no-reply senders. */
export function inboundMessages(t: GThread, self: string, added: ReadonlySet<string>): Inbound[] {
  const out: Inbound[] = []
  for (const m of t.messages ?? []) {
    if (!added.has(m.id) || m.labelIds?.some((l) => [...SKIP_LABELS, 'SENT'].includes(l)) || !(Number(m.internalDate) > 0)) continue
    const header = (n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? ''
    const from = parseAddresses(header('From'))[0] ?? ''
    const subject = header('Subject').replace(/\s+/g, ' ').trim().slice(0, 300)
    if (!from || isOurs(from, self) || isAutomated(from, subject, header)) continue
    out.push({ messageId: m.id, threadId: t.id, from, subject, at: Number(m.internalDate) })
  }
  return out
}

/** Threads with new messages since `startHistoryId`. A 404 means it's too old: read the last 30 days again. */
export function listHistory(token: string, startHistoryId: string, pageToken?: string) {
  const q = new URLSearchParams({ startHistoryId, historyTypes: 'messageAdded', maxResults: '500' })
  if (pageToken) q.set('pageToken', pageToken)
  return get<{ history?: { messagesAdded?: { message?: { id: string; threadId: string } }[] }[]; nextPageToken?: string; historyId?: string }>(
    `${GMAIL}/history?${q}`,
    token,
    'gmail history',
  )
}

export type ParsedThread = { threadId: string; subject: string; participants: string[]; lastAt: number; lastFrom: 'us' | 'them'; lastFromEmail: string; count: number; link: string }

const SKIP_LABELS = ['DRAFT', 'SPAM', 'TRASH']

/** A thread as an email touch, from headers alone: subject, everyone's address, the last sent message's date and sender. */
export function parseThread(t: GThread, self: string): ParsedThread | null {
  const msgs = (t.messages ?? []).filter((m) => !m.labelIds?.some((l) => SKIP_LABELS.includes(l)) && Number(m.internalDate) > 0)
  if (!msgs.length) return null
  msgs.sort((a, b) => Number(a.internalDate) - Number(b.internalDate))
  const header = (m: GMessage, n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? ''
  const participants: string[] = []
  for (const m of msgs) for (const h of ['From', 'To', 'Cc']) for (const a of parseAddresses(header(m, h))) if (!participants.includes(a)) participants.push(a)
  const last = msgs[msgs.length - 1]
  const lastFromEmail = parseAddresses(header(last, 'From'))[0] ?? ''
  const subject = (header(msgs[0], 'Subject') || header(last, 'Subject')).replace(/\s+/g, ' ').trim().slice(0, 200) || '(No subject)'
  return {
    threadId: t.id,
    subject,
    participants: participants.slice(0, 50),
    lastAt: Number(last.internalDate),
    lastFrom: !lastFromEmail || isOurs(lastFromEmail, self) ? 'us' : 'them',
    lastFromEmail,
    count: msgs.length,
    link: gmailThreadLink(self, t.id),
  }
}
