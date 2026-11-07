// PST-282: Materials. The library (materials with versions), per-investor share
// links and what the viewer at /d/<token> records. Pure functions over plain
// data, shared by the UI and Convex.
import { todayIST } from './dates'

export const MATERIAL_KINDS = ['deck', 'memo', 'one-pager', 'model', 'data-room', 'other'] as const
export type MaterialKind = (typeof MATERIAL_KINDS)[number]
export const KIND_LABEL: Record<MaterialKind, string> = {
  deck: 'Pitch deck',
  memo: 'Investment memo',
  'one-pager': 'One-pager',
  model: 'Financial model',
  'data-room': 'Data room file',
  other: 'Other',
}

/** Uploads: PDFs only, up to 50 MB (Convex file storage). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const PDF_TYPE = 'application/pdf'

/** Links live on nest.pestokids.com/d/<token>. */
export const SHARE_ORIGIN = 'https://nest.pestokids.com'
export const shareUrl = (token: string, origin = SHARE_ORIGIN) => `${origin.replace(/\/$/, '')}/d/${token}`
export const shareLabel = (token: string) => `nest.pestokids.com/d/${token}`

/** 128 random bits, base64url: 22 characters. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{22}$/
export const isToken = (s: unknown): s is string => typeof s === 'string' && TOKEN_RE.test(s)

export type LinkOptions = {
  /** Ask for their email before it opens. Always on when `watermark` is. */
  askEmail: boolean
  /** Off by default. */
  allowDownload: boolean
  /** Pages carry the viewer's email. */
  watermark: boolean
  /** Tell whoever made the link (in Nest) on the first open. */
  notify: boolean
  /** "Questions? Reply to Dev" under the document. */
  reply: boolean
}
export const DEFAULT_OPTIONS: LinkOptions = { askEmail: true, allowDownload: false, watermark: true, notify: true, reply: true }
/** The watermark needs an email to print, so it turns the email ask on. */
export const normOptions = (o: LinkOptions): LinkOptions => ({ ...o, askEmail: o.askEmail || o.watermark })

export const EXPIRY_CHOICES = [
  { days: 7, label: 'In 7 days' },
  { days: 30, label: 'In 30 days' },
  { days: 90, label: 'In 90 days' },
  { days: 0, label: 'Never' },
] as const
export const DEFAULT_EXPIRY_DAYS = 30
export const DAY_MS = 864e5

/* ---------- shapes the UI reads ---------- */

export type Material = { _id: string; kind: MaterialKind; title: string; currentVersionId?: string; createdAt: number }
export type MaterialVersion = {
  _id: string
  materialId: string
  n: number
  fileId?: string
  url?: string
  pages?: number
  note: string
  createdAt: number
  by?: string
}
/** `versionId` is a version, or "current" (always the material's current version). */
export type ShareLink = {
  _id: string
  token: string
  investorId?: string
  materialId: string
  versionId: string
  options: LinkOptions
  revokedAt?: number
  expiresAt?: number
  createdAt: number
  firstOpenedAt?: number
}
/** Every open of one link on one version, added up (`pageMs[k]` is page k + 1). */
export type ViewStat = {
  linkId: string
  versionId: string
  opens: number
  firstAt: number
  lastAt: number
  totalMs: number
  pageMs: number[]
  email?: string
  device: Device
}
/** A first open someone asked to hear about (the Today row and the toast). */
export type OpenNotice = { linkId: string; investorId: string; at: number }

export type MaterialsData = {
  loaded: boolean
  materials: Material[]
  versions: MaterialVersion[]
  links: ShareLink[]
  stats: ViewStat[]
  notices: OpenNotice[]
  /** RESEND_API_KEY is set on the server, so "Send by email" can show. */
  emailReady: boolean
}
export const NO_MATERIALS: MaterialsData = { loaded: false, materials: [], versions: [], links: [], stats: [], notices: [], emailReady: false }

/* ---------- links ---------- */

export type LinkState = 'live' | 'revoked' | 'expired'
export function linkState(l: { revokedAt?: number; expiresAt?: number }, now: number): LinkState {
  if (l.revokedAt !== undefined) return 'revoked'
  if (l.expiresAt !== undefined && l.expiresAt <= now) return 'expired'
  return 'live'
}

/** The version a link shows right now. */
export const linkVersionId = (l: { versionId: string }, m: { currentVersionId?: string } | undefined) =>
  l.versionId === 'current' ? m?.currentVersionId : l.versionId

/* ---------- the viewer's numbers ---------- */

export type Device = 'phone' | 'tablet' | 'desktop'
/** Approximate device type from a User-Agent (nothing else about it is kept). */
export function deviceOf(ua: string | null | undefined): Device {
  const s = ua ?? ''
  if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(s)) return 'tablet'
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(s)) return 'phone'
  return 'desktop'
}

/** Beacons come every 5 s while the page is visible, and on page change; one carries at most 30 s. */
export const BEAT_MS = 5_000
export const MAX_BEAT_MS = 30_000

/** Add `ms` on `page` (1-based) to a view's per-page times. Bad input adds nothing. */
export function addPageTime(pages: { page: number; ms: number }[], page: number, ms: number, pageCount: number | undefined): { page: number; ms: number }[] {
  const max = Math.max(1, pageCount ?? 1)
  if (!Number.isInteger(page) || page < 1 || page > max) return pages
  const add = Math.round(Math.min(MAX_BEAT_MS, Math.max(0, Number.isFinite(ms) ? ms : 0)))
  if (!add) return pages
  if (pages.some((p) => p.page === page)) return pages.map((p) => (p.page === page ? { page, ms: p.ms + add } : p))
  return [...pages, { page, ms: add }].sort((a, b) => a.page - b.page)
}

export const isEmail = (s: string) => s.length <= 254 && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(s)

/* ---------- formatting ---------- */

/** "4m 12s", "48s", "1h 05m". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** The library tile's file badge: PDF for uploads; DOC, PPT or XLS for Google links. */
export function badgeOf(v: { fileId?: string; url?: string } | undefined): string {
  if (!v || v.fileId) return 'PDF'
  const u = v.url ?? ''
  if (/docs\.google\.com\/presentation/.test(u)) return 'PPT'
  if (/docs\.google\.com\/spreadsheets/.test(u)) return 'XLS'
  if (/docs\.google\.com\/document/.test(u)) return 'DOC'
  return 'LINK'
}

/** "Google Slides" and friends, for a link version's sub line. */
export function linkSource(url: string): string {
  if (/docs\.google\.com\/presentation/.test(url)) return 'Google Slides'
  if (/docs\.google\.com\/spreadsheets/.test(url)) return 'Google Sheets'
  if (/docs\.google\.com\/document/.test(url)) return 'Google Docs'
  if (/drive\.google\.com/.test(url)) return 'Google Drive'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Link'
  }
}

/** A link added as a version: https only, at most 2000 characters. */
export function cleanUrl(s: string): string | null {
  const t = s.trim()
  if (!t || t.length > 2000) return null
  try {
    const u = new URL(t)
    return u.protocol === 'https:' && u.hostname.includes('.') && !u.username && !u.password ? u.toString() : null
  } catch {
    return null
  }
}

/** Google Docs, Slides, Sheets and Drive files embed through their /preview page; anything else opens in a new tab. */
export function embedUrl(url: string): string | null {
  const m = url.match(/^https:\/\/docs\.google\.com\/(presentation|document|spreadsheets)\/d\/([A-Za-z0-9_-]+)/)
  if (m) return `https://docs.google.com/${m[1]}/d/${m[2]}/preview`
  const f = url.match(/^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/)
  if (f) return `https://drive.google.com/file/d/${f[1]}/preview`
  return null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Tue 3 Nov" (IST). */
export function dayOfMs(ms: number): string {
  const d = new Date(todayIST(ms) + 'T00:00:00Z')
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
/** "just now", "12m ago", "2h ago", "Yesterday", "Mon 2 Nov". */
export function whenOf(ms: number, now: number): string {
  const mins = Math.round((now - ms) / 6e4)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (todayIST(ms) === todayIST(now)) return `${Math.round(mins / 60)}h ago`
  if (todayIST(ms) === todayIST(now - DAY_MS)) return 'Yesterday'
  return dayOfMs(ms)
}

/* ---------- reading the views ---------- */

/** Pages with any time on them. */
export const pagesSeen = (s: { pageMs: number[] }) => s.pageMs.filter((x) => x > 0).length
/** The furthest page with time on it (0 when none). */
export const furthestPage = (s: { pageMs: number[] }) => s.pageMs.reduce((m, x, k) => (x > 0 ? k + 1 : m), 0)

/** The page with the most time on it (1-based), or null when nothing was read. */
export function topPage(pageMs: number[]): number | null {
  let best = 0
  let at = -1
  pageMs.forEach((x, k) => {
    if (x > best) {
      best = x
      at = k
    }
  })
  return at >= 0 ? at + 1 : null
}

/** Per-page times of several stats added up, at least `pages` long. */
export function sumPages(stats: { pageMs: number[] }[], pages: number): number[] {
  const out = Array.from({ length: Math.max(pages, 0, ...stats.map((s) => s.pageMs.length)) }, () => 0)
  for (const s of stats) s.pageMs.forEach((x, k) => (out[k] += x))
  return out
}

/** Average time on each page across the viewers who read any of it (the Views tab chart). */
export function averagePages(stats: { pageMs: number[] }[], pages: number): number[] {
  const viewers = stats.filter((s) => s.pageMs.some((x) => x > 0)).length
  return sumPages(stats, pages).map((x) => (viewers ? Math.round(x / viewers) : 0))
}

export type ReadStatus = 'unopened' | 'read' | 'back' | 'dropped' | 'opened' | 'old'
export const READ_LABEL: Record<ReadStatus, string> = {
  unopened: 'Not opened',
  read: 'Read it all',
  back: 'Came back',
  dropped: 'Dropped off',
  opened: 'Opened',
  old: 'Old version',
}

/**
 * How one investor read one link: an older version than the current one wins,
 * then every page seen, then more than one open, then stopping in the first half.
 */
export function readStatus(s: { opens: number; pageMs: number[] } | undefined, pages: number | undefined, old: boolean): ReadStatus {
  if (!s || !s.opens) return 'unopened'
  if (old) return 'old'
  if (pages && pagesSeen(s) >= pages) return 'read'
  if (s.opens > 1) return 'back'
  if (pages && pages > 2 && furthestPage(s) <= Math.ceil(pages / 2)) return 'dropped'
  return 'opened'
}

/** Per-material counts for the library tiles: links sent, links opened, investors with a link. */
export function materialCounts(materialId: string, links: ShareLink[], stats: ViewStat[]) {
  const mine = links.filter((l) => l.materialId === materialId)
  const ids = new Set(mine.map((l) => l._id))
  const opened = new Set(stats.filter((s) => ids.has(s.linkId) && s.opens > 0).map((s) => s.linkId))
  return { sent: mine.length, opened: opened.size, investors: new Set(mine.map((l) => l.investorId).filter(Boolean)).size }
}

/**
 * Investors whose newest link to a material is pinned to an older version than
 * the current one ("Still on an old version", "Send them v4").
 */
export function onOldVersion(material: Material, links: ShareLink[], versions: MaterialVersion[]): { investorId: string; versionId: string }[] {
  const cur = material.currentVersionId
  if (!cur) return []
  const nOf = new Map(versions.map((v) => [v._id, v.n]))
  const newest = new Map<string, ShareLink>()
  for (const l of links) {
    if (l.materialId !== material._id || !l.investorId || l.revokedAt !== undefined) continue
    const prev = newest.get(l.investorId)
    if (!prev || l.createdAt > prev.createdAt) newest.set(l.investorId, l)
  }
  return [...newest.values()]
    .filter((l) => l.versionId !== 'current' && (nOf.get(l.versionId) ?? 0) < (nOf.get(cur) ?? 0))
    .map((l) => ({ investorId: l.investorId!, versionId: l.versionId }))
}
