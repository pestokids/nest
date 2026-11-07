// PST-282: the public viewer's side of Convex. Only the HTTP routes in
// viewerHttp.ts call these, and they only ever take a link's token (plus the
// viewer's own session id and email). They return the document and Pesto's
// name, never anything about the investor, Nest or other links.
import { v } from 'convex/values'
import { internalMutation, type MutationCtx } from './_generated/server'
import type { Doc } from './_generated/dataModel'
import { EMAIL_REPLY_TO } from './lib/email'
import { randomToken } from './lib/token'
import { vDevice } from './materialsSchema'
import { todayIST } from '../src/lib/dates'
import { addPageTime, isEmail, isToken, linkState } from '../src/lib/materials'

/** Lookups per token per minute; unknown tokens share one budget. */
export const LIMITS = { open: 20, file: 30, beat: 120, miss: 60 } as const
const WINDOW_MS = 60_000

/** Count one hit on `key`; false once it's over `limit` this minute. */
async function hit(ctx: MutationCtx, key: string, limit: number): Promise<boolean> {
  const now = Date.now()
  const start = now - (now % WINDOW_MS)
  const row = await ctx.db.query('viewerHits').withIndex('by_key', (q) => q.eq('key', key)).unique()
  if (!row) {
    await ctx.db.insert('viewerHits', { key, windowStart: start, count: 1 })
    return true
  }
  if (row.windowStart !== start) {
    await ctx.db.patch(row._id, { windowStart: start, count: 1 })
    return true
  }
  if (row.count >= limit) return false
  await ctx.db.patch(row._id, { count: row.count + 1 })
  return true
}

type Found = { link: Doc<'shareLinks'>; material: Doc<'materials'>; version: Doc<'materialVersions'> }
type Lookup = Found | 'missing' | 'expired' | 'limited'

/** The link behind a token, rate-limited per token; "expired" for revoked or past-date links and deleted documents. */
async function lookup(ctx: MutationCtx, token: string, kind: keyof typeof LIMITS): Promise<Lookup> {
  const link = isToken(token) ? await ctx.db.query('shareLinks').withIndex('by_token', (q) => q.eq('token', token)).unique() : null
  if (!link) return (await hit(ctx, 'miss', LIMITS.miss)) ? 'missing' : 'limited'
  if (!(await hit(ctx, `${kind}:${token}`, LIMITS[kind]))) return 'limited'
  if (linkState(link, Date.now()) !== 'live') return 'expired'
  const material = await ctx.db.get(link.materialId)
  const versionId = link.versionId === 'current' ? material?.currentVersionId : link.versionId
  const version = versionId ? await ctx.db.get(versionId) : null
  if (!material || !version) return 'expired'
  return { link, material, version }
}

/** What the viewer page shows: the document, Pesto's name, and the reply line if the link has it. */
export type ViewerDoc = {
  title: string
  n: number
  pages: number | null
  kind: 'pdf' | 'link'
  url: string | null
  download: boolean
  watermark: string | null
  reply: string | null
  from: 'Pesto'
}
export type OpenResult = { state: 'ok'; sessionId: string; doc: ViewerDoc } | { state: 'email'; invalid: boolean } | { state: 'missing' | 'expired' | 'limited' }

/**
 * Open a link: check it, ask for an email first when the link wants one, then
 * start a view (a session). The first open of a link logs a touch on the
 * investor ("Opened Pitch deck v4") and moves their Last touch to today.
 */
export const open = internalMutation({
  args: { token: v.string(), email: v.optional(v.string()), device: vDevice },
  handler: async (ctx, { token, email: raw, device }): Promise<OpenResult> => {
    const found = await lookup(ctx, token, 'open')
    if (typeof found === 'string') return { state: found }
    const { link, material, version } = found
    const o = link.options
    const wantsEmail = o.askEmail || o.watermark
    const email = raw?.trim().toLowerCase() ?? ''
    if (wantsEmail && !isEmail(email)) return { state: 'email', invalid: !!email }
    const now = Date.now()
    const sessionId = randomToken()
    await ctx.db.insert('views', {
      linkId: link._id, sessionId, versionId: version._id, startedAt: now, lastAt: now, device, pages: [],
      ...(wantsEmail ? { email } : {}),
    })
    if (link.firstOpenedAt === undefined) {
      await ctx.db.patch(link._id, { firstOpenedAt: now })
      const investor = link.investorId ? await ctx.db.get(link.investorId) : null
      if (investor) {
        const today = todayIST(now)
        await ctx.db.insert('activities', { investorId: investor._id, kind: 'note', note: `Opened ${material.title} v${version.n}`, date: today, userId: link.createdBy })
        if (!investor.lastTouch || investor.lastTouch < today) await ctx.db.patch(investor._id, { lastTouch: today, updatedAt: now })
      }
    }
    return {
      state: 'ok',
      sessionId,
      doc: {
        title: material.title,
        n: version.n,
        pages: version.pages ?? null,
        kind: version.fileId ? 'pdf' : 'link',
        url: version.fileId ? null : version.url ?? null,
        download: o.allowDownload && !!version.fileId,
        watermark: o.watermark ? email : null,
        reply: o.reply ? EMAIL_REPLY_TO : null,
        from: 'Pesto',
      },
    }
  },
})

/** The view behind a session, if it belongs to this link. */
async function viewOf(ctx: MutationCtx, link: Doc<'shareLinks'>, sessionId: string) {
  if (!isToken(sessionId)) return null
  const view = await ctx.db.query('views').withIndex('by_session', (q) => q.eq('sessionId', sessionId)).unique()
  return view && view.linkId === link._id ? view : null
}

export type BeatResult = 'ok' | 'missing' | 'expired' | 'limited'

/** A beacon: `ms` more on `page` (every 5 s while visible, and on page change). */
export const beat = internalMutation({
  args: { token: v.string(), sessionId: v.string(), page: v.number(), ms: v.number() },
  handler: async (ctx, { token, sessionId, page, ms }): Promise<BeatResult> => {
    const found = await lookup(ctx, token, 'beat')
    if (typeof found === 'string') return found
    const view = await viewOf(ctx, found.link, sessionId)
    if (!view) return 'missing'
    const version = await ctx.db.get(view.versionId)
    await ctx.db.patch(view._id, { pages: addPageTime(view.pages, page, ms, version?.pages), lastAt: Date.now() })
    return 'ok'
  },
})

/** The PDF behind an open session (the email ask already passed when it was opened). */
export const file = internalMutation({
  args: { token: v.string(), sessionId: v.string() },
  handler: async (ctx, { token, sessionId }) => {
    const found = await lookup(ctx, token, 'file')
    if (typeof found === 'string') return { state: found }
    const view = await viewOf(ctx, found.link, sessionId)
    const version = view ? await ctx.db.get(view.versionId) : null
    if (!version?.fileId) return { state: 'missing' as const }
    const name = `Pesto ${found.material.title} v${version.n}.pdf`.replace(/[^\w .()-]+/g, '')
    return { state: 'ok' as const, fileId: version.fileId, download: found.link.options.allowDownload, name }
  },
})
