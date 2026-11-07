// Calendar and Gmail (PST-263): matching people to investors, the forward-only
// stage rule for synced meetings, "Waiting on you", "Who's this?" and the
// meeting lists on Today. Pure functions, shared by the UI and Convex.
import { dayDiff, todayIST } from './dates'
import { IDX, STAGES, type PipelineStage, type Stage } from './stages'

/** Our own Workspace: these addresses are us, never an investor. */
export const OUR_DOMAINS = ['pestokids.com'] as const

/** Personal mail domains: never used to match a whole firm. */
export const GENERIC_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk',
  'ymail.com', 'rocketmail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'pm.me', 'gmx.com', 'gmx.net',
  'mail.com', 'zoho.com', 'zohomail.com', 'yandex.com', 'fastmail.com', 'hey.com', 'rediffmail.com', 'qq.com', '163.com',
])

/** Calendar sync window: 30 days back, 60 forward on the first sync. Gmail: 30 days back. */
export const DAY_MS = 864e5
export const CALENDAR_BACK_DAYS = 30
export const CALENDAR_AHEAD_DAYS = 60
export const GMAIL_BACK_DAYS = 30
/** "Waiting on you": the investor wrote last at least this long ago. */
export const WAITING_MS = 48 * 36e5
/** "Who's this?": people from meetings in the last two weeks (and the next two days). */
export const WHO_BACK_DAYS = 14

/* ---------- addresses ---------- */

/** Lowercased bare address ("Name <A@B.com>" → "a@b.com"), or "" when there isn't one. */
export function normEmail(s: string | null | undefined): string {
  if (!s) return ''
  const m = /<([^<>]+)>/.exec(s)
  const a = (m ? m[1] : s).trim().replace(/^mailto:/i, '').toLowerCase()
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(a) ? a : ''
}

/** Every address in a To/Cc/From header, lowercased. Handles quoted names with commas. */
export function parseAddresses(header: string | null | undefined): string[] {
  if (!header) return []
  const out: string[] = []
  for (const m of header.matchAll(/[^\s<>",;:()]+@[^\s<>",;:()]+\.[^\s<>",;:()]+/g)) {
    const a = normEmail(m[0])
    if (a && !out.includes(a)) out.push(a)
  }
  return out
}

export const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase()

/** One of us (a pestokids.com address, or the connected account itself). */
export const isOurs = (email: string, self?: string) =>
  (OUR_DOMAINS as readonly string[]).includes(domainOf(email)) || (!!self && email === self.toLowerCase())

/** "northstar.vc" from "@Northstar.VC", "https://www.northstar.vc/team" or "partner@northstar.vc"; "" if it isn't a domain. */
export function normDomain(s: string): string {
  let d = s.trim().toLowerCase()
  if (d.includes('@')) d = d.slice(d.lastIndexOf('@') + 1)
  d = d.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0]
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) ? d : ''
}

/** Split "a@x.com, b@y.com" (commas, spaces, semicolons or new lines). */
export const splitList = (s: string) => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)

/** Clean an investor's extra emails: valid, lowercased, unique, without the main email. */
export function cleanEmails(xs: readonly string[] | null | undefined, main?: string): string[] {
  const m = normEmail(main)
  return [...new Set((xs ?? []).map(normEmail).filter((a) => a && a !== m))]
}

/** Clean an investor's firm domains: valid, unique, and never a personal mail domain or ours. */
export function cleanDomains(xs: readonly string[] | null | undefined): string[] {
  return [...new Set((xs ?? []).map(normDomain).filter((d) => d && !GENERIC_DOMAINS.has(d) && !(OUR_DOMAINS as readonly string[]).includes(d)))]
}

/** "priya.raman@x.com" → "Priya Raman". */
export function nameFromEmail(email: string): string {
  const local = email.split('@')[0].replace(/\+.*$/, '')
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/* ---------- matching ---------- */

export type Matchable = { _id: string; email?: string; emails?: string[]; domains?: string[] }
export type Match = { id: string; by: 'email' | 'domain'; on: string }

/**
 * Match people to investors: exact email first (`email` and `emails`), then the
 * firm's `domains`. Generic mail domains and our own addresses never match.
 */
export function makeMatcher(investors: readonly Matchable[]) {
  const byEmail = new Map<string, string[]>()
  const byDomain = new Map<string, string[]>()
  const push = (m: Map<string, string[]>, k: string, id: string) => {
    const xs = m.get(k) ?? []
    if (!xs.includes(id)) m.set(k, [...xs, id])
  }
  for (const i of investors) {
    for (const e of [normEmail(i.email), ...cleanEmails(i.emails)]) if (e && !isOurs(e)) push(byEmail, e, i._id)
    for (const d of cleanDomains(i.domains)) push(byDomain, d, i._id)
  }
  /** Investors one address belongs to (exact email wins over the domain). */
  const one = (raw: string, self?: string): Match[] => {
    const e = normEmail(raw)
    if (!e || isOurs(e, self)) return []
    const exact = byEmail.get(e)
    if (exact) return exact.map((id) => ({ id, by: 'email' as const, on: e }))
    const d = domainOf(e)
    if (GENERIC_DOMAINS.has(d)) return []
    return (byDomain.get(d) ?? []).map((id) => ({ id, by: 'domain' as const, on: d }))
  }
  /** Every investor a set of people belongs to, plus the external people who matched nobody. */
  const people = (emails: readonly string[], self?: string) => {
    const ids: string[] = []
    const how: Record<string, Match> = {}
    const unmatched: string[] = []
    for (const raw of emails) {
      const e = normEmail(raw)
      if (!e || isOurs(e, self)) continue
      const ms = one(e, self)
      if (!ms.length && !unmatched.includes(e)) unmatched.push(e)
      for (const m of ms) {
        if (!ids.includes(m.id)) ids.push(m.id)
        // Keep the strongest reason (an exact email beats a domain).
        if (!how[m.id] || (how[m.id].by === 'domain' && m.by === 'email')) how[m.id] = m
      }
    }
    return { ids, how, unmatched }
  }
  return { one, people }
}

/** The addresses and domains that identify an investor (for "Matched by" and the Gmail search link). */
export function addressesOf(i: Pick<Matchable, 'email' | 'emails' | 'domains'>) {
  const emails = [...new Set([normEmail(i.email), ...cleanEmails(i.emails)].filter(Boolean))]
  return { emails, domains: cleanDomains(i.domains) }
}

/* ---------- stage rule ---------- */

/** Sync never moves anyone past Diligence (Verbal, Signed and Money in are people's calls). */
export const SYNC_CEILING: PipelineStage = 'dd'

/**
 * Where a synced signal may move an investor: only forward along the pipeline,
 * only up to `target`, never into Verbal, Signed or Money in, and never out of
 * Passed or Parked. Null when nothing changes.
 */
export function syncStageMove(stage: Stage, target: PipelineStage): PipelineStage | null {
  const from = IDX[stage]
  const to = IDX[target]
  if (from === undefined || to === undefined) return null
  if (to > IDX[SYNC_CEILING]!) return null
  return to > from ? STAGES[to].k : null
}

/* ---------- days and times (Asia/Kolkata, like the rest of Nest) ---------- */

/** The IST calendar day of a timestamp. */
export const dayOf = (ms: number) => todayIST(ms)

/** "11:00" in IST. */
export function timeOf(ms: number): string {
  const d = new Date(ms + 330 * 6e4)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** "2h ago", "1d ago", "Nov 4". */
export function agoShort(ms: number, now: number): string {
  const min = Math.max(0, Math.round((now - ms) / 6e4))
  if (min < 60) return min <= 1 ? 'just now' : `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  const d = dayDiff(dayOf(now), dayOf(ms))
  if (d <= 6) return `${Math.max(1, d)}d ago`
  const [, m, day] = dayOf(ms).split('-').map(Number)
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${day}`
}

/* ---------- what the client gets ---------- */

export type MeetingPerson = { email: string; name?: string }
export type MeetingAnswer = 'm1' | 'm2' | 'passed'
export type SyncedMeeting = {
  _id: string
  eventId: string
  title: string
  start: number
  end: number
  link?: string
  people: MeetingPerson[]
  investorIds: string[]
  /** Whose calendar (first name) and whether it's yours. */
  by: string
  mine: boolean
  answer?: MeetingAnswer
  dismissed?: string[]
}
export type SyncedThread = {
  _id: string
  threadId: string
  subject: string
  lastAt: number
  lastFrom: 'us' | 'them'
  lastFromEmail: string
  participants: string[]
  investorIds: string[]
  link: string
  count: number
  by: string
  mine: boolean
}
export type ConnectionStatus = 'syncing' | 'connected' | 'reconnect'
export type MyConnection = {
  status: ConnectionStatus
  email: string
  lastSyncAt?: number
  /** A sync is running right now. */
  running: boolean
  /** The first read of the inbox: threads read so far, the oldest one reached, and how many Google refused (skipped). */
  scan?: { done: number; oldest?: number; startedAt: number; skipped?: number }
  lastError?: string
}
export type GoogleData = {
  loaded: boolean
  me: MyConnection | null
  /** Teammates' connections (first name and status), you included. */
  team: { name: string; status: ConnectionStatus; mine: boolean }[]
  meetings: SyncedMeeting[]
  threads: SyncedThread[]
}
export const NO_GOOGLE: GoogleData = { loaded: true, me: null, team: [], meetings: [], threads: [] }

/* ---------- Gone quiet signals ---------- */

/** Per investor: the IST day of the latest email touch and of the latest meeting that has ended. */
export function contactSignals(g: Pick<GoogleData, 'meetings' | 'threads'>, now: number) {
  const out = new Map<string, { email?: string; meeting?: string }>()
  const bump = (id: string, k: 'email' | 'meeting', day: string) => {
    const o = out.get(id) ?? {}
    if (!o[k] || o[k]! < day) o[k] = day
    out.set(id, o)
  }
  for (const t of g.threads) for (const id of t.investorIds) bump(id, 'email', dayOf(Math.min(t.lastAt, now)))
  for (const m of g.meetings) if (m.end <= now) for (const id of m.investorIds) bump(id, 'meeting', dayOf(m.start))
  return out
}

/** Investors with their Google signals attached as `contact` (read by the gone-quiet rule). */
export function withContact<T extends { _id: string }>(investors: T[], g: Pick<GoogleData, 'meetings' | 'threads'>, now: number): (T & { contact?: { email?: string; meeting?: string } })[] {
  if (!g.meetings.length && !g.threads.length) return investors
  const s = contactSignals(g, now)
  return investors.map((i) => (s.has(i._id) ? { ...i, contact: s.get(i._id) } : i))
}

/* ---------- Today ---------- */

/** One row per event, even when both founders have it on their calendars (yours first). */
export function dedupeMeetings(ms: readonly SyncedMeeting[]): SyncedMeeting[] {
  const seen = new Map<string, SyncedMeeting>()
  for (const m of [...ms].sort((a, b) => Number(b.mine) - Number(a.mine))) {
    const k = `${m.eventId}|${m.start}`
    const had = seen.get(k)
    if (!had) seen.set(k, m)
    else if (!had.answer && m.answer) seen.set(k, { ...had, answer: m.answer })
  }
  return [...seen.values()].sort((a, b) => a.start - b.start)
}

/** Investor meetings on a day (IST), plus meetings with outside people who aren't in Raise yet. */
export const meetingsOn = (ms: readonly SyncedMeeting[], day: string) => dedupeMeetings(ms).filter((m) => dayOf(m.start) === day)

/** Stages where "How did it go?" makes sense: up to and including the first meeting. */
const ASK_AFTER = new Set<Stage>(['ask', 'intro', 'booked', 'm1'])

/**
 * The morning after: yesterday's meetings with an investor still at or before
 * 1st meeting, not answered yet. One question per investor.
 */
export function followUps<I extends { _id: string; stage: Stage }>(ms: readonly SyncedMeeting[], investors: readonly I[], today: string, now: number) {
  const yesterday = new Date(Date.parse(today + 'T00:00:00Z') - DAY_MS).toISOString().slice(0, 10)
  const byId = new Map(investors.map((i) => [i._id, i]))
  const asked = new Set<string>()
  const out: { meeting: SyncedMeeting; investor: I; options: MeetingAnswer[] }[] = []
  for (const m of dedupeMeetings(ms)) {
    if (m.answer || m.end > now || dayOf(m.start) !== yesterday) continue
    for (const id of m.investorIds) {
      const i = byId.get(id)
      if (!i || asked.has(id) || !ASK_AFTER.has(i.stage)) continue
      asked.add(id)
      const options: MeetingAnswer[] = [...(IDX[i.stage]! < IDX.m1! ? (['m1'] as const) : []), 'm2', 'passed']
      out.push({ meeting: m, investor: i, options })
    }
  }
  return out
}

/** "Waiting on you": the other side wrote last, 48 hours or more ago. Newest first, one per conversation. */
export function waitingOnYou(ts: readonly SyncedThread[], now: number): SyncedThread[] {
  const seen = new Set<string>()
  return [...ts]
    .filter((t) => t.lastFrom === 'them' && now - t.lastAt >= WAITING_MS && t.investorIds.length > 0)
    .sort((a, b) => b.lastAt - a.lastAt || Number(b.mine) - Number(a.mine))
    .filter((t) => {
      const k = `${t.subject.replace(/^(re|fwd?):\s*/gi, '').toLowerCase()}|${t.lastFromEmail}|${t.lastAt}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
}

export const isWaiting = (t: Pick<SyncedThread, 'lastFrom' | 'lastAt'>, now: number) => t.lastFrom === 'them' && now - t.lastAt >= WAITING_MS

export type Stranger = { email: string; name: string; meeting: SyncedMeeting }

/**
 * "Who's this?": outside people from recent meetings that matched no investor.
 * Ours, already-dismissed and anyone now matching an investor are left out.
 */
export function whoIsThis(ms: readonly SyncedMeeting[], investors: readonly Matchable[], now: number): Stranger[] {
  const match = makeMatcher(investors)
  const out = new Map<string, Stranger>()
  const recent = dedupeMeetings(ms)
    .filter((m) => m.investorIds.length === 0 && m.start >= now - WHO_BACK_DAYS * DAY_MS && m.start <= now + 2 * DAY_MS)
    .sort((a, b) => b.start - a.start)
  const dismissed = new Set(ms.flatMap((m) => m.dismissed ?? []))
  for (const m of recent)
    for (const p of m.people) {
      const e = normEmail(p.email)
      if (!e || isOurs(e) || dismissed.has(e) || out.has(e) || match.one(e).length) continue
      out.set(e, { email: e, name: p.name?.trim() || nameFromEmail(e), meeting: m })
    }
  return [...out.values()]
}

/* ---------- first sync progress ---------- */

/** "214 of 600 · about a minute left": estimated from how far back the newest-first read has reached. */
export function scanProgress(scan: { done: number; oldest?: number; startedAt: number }, now: number) {
  const span = GMAIL_BACK_DAYS * DAY_MS
  const covered = scan.oldest ? Math.min(1, Math.max(0.02, (now - scan.oldest) / span)) : 0.02
  const total = Math.max(scan.done + (covered >= 1 ? 0 : 1), Math.round(scan.done / covered))
  const elapsed = Math.max(1, now - scan.startedAt)
  const rate = scan.done / elapsed
  const leftMs = rate > 0 ? (total - scan.done) / rate : Infinity
  const left = !Number.isFinite(leftMs) ? 'a few minutes left' : leftMs < 45e3 ? 'almost done' : leftMs < 90e3 ? 'about a minute left' : `about ${Math.round(leftMs / 6e4)} minutes left`
  return { done: scan.done, total, pct: total ? Math.min(1, scan.done / total) : 0, left }
}

/* ---------- links ---------- */

const authuser = (email?: string) => (email ? `?authuser=${encodeURIComponent(email)}` : '')
export const gmailThreadLink = (account: string, threadId: string) => `https://mail.google.com/mail/${authuser(account)}#all/${threadId}`
/** Gmail search for everything with these people or their firm. */
export function gmailSearchLink(account: string | undefined, a: { emails: string[]; domains: string[] }) {
  const terms = [...a.emails, ...a.domains].map((x) => `from:${x} OR to:${x}`)
  return `https://mail.google.com/mail/${authuser(account)}#search/${encodeURIComponent(terms.join(' OR '))}`
}
export const calendarWeekLink = (account?: string) => `https://calendar.google.com/calendar/r/week${authuser(account)}`
