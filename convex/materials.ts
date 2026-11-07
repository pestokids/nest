// PST-282: Materials, the signed-in side. The library (materials and their
// versions), per-investor share links, and what the viewer recorded. The public
// viewer is convex/viewer.ts, reached only through the HTTP routes in viewerHttp.ts.
import { ConvexError, v } from 'convex/values'
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'
import { firstName, requireUser } from './lib/access'
import { emailReady, sendEmail } from './lib/email'
import { randomToken } from './lib/token'
import { vLinkOptions, vMaterialKind } from './materialsSchema'
import { todayIST } from '../src/lib/dates'
import { cleanUrl, DAY_MS, MAX_UPLOAD_BYTES, normOptions, PDF_TYPE, SHARE_ORIGIN, shareUrl, type ViewStat } from '../src/lib/materials'

const MAX_TITLE = 120
const MAX_NOTE = 280
const MAX_PAGES = 2000
const MAX_SHARE = 50
const MAX_MESSAGE = 2000

/** Everything the Materials tab, the drawer and Today read. Views come added up per link and version. */
export const data = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireUser(ctx)
    const materials = await ctx.db.query('materials').collect()
    const versions = await ctx.db.query('materialVersions').collect()
    const links = await ctx.db.query('shareLinks').collect()
    const views = await ctx.db.query('views').collect()
    const names = new Map<Id<'users'>, string>()
    for (const id of new Set(versions.map((x) => x.createdBy))) names.set(id, firstName(await ctx.db.get(id)))

    const stats = new Map<string, ViewStat>()
    for (const w of views) {
      const key = `${w.linkId}|${w.versionId}`
      let s = stats.get(key)
      if (!s) {
        s = { linkId: w.linkId, versionId: w.versionId, opens: 0, firstAt: w.startedAt, lastAt: 0, totalMs: 0, pageMs: [], device: w.device }
        stats.set(key, s)
      }
      s.opens++
      s.firstAt = Math.min(s.firstAt, w.startedAt)
      if (w.lastAt >= s.lastAt) {
        s.lastAt = w.lastAt
        s.device = w.device
        if (w.email) s.email = w.email
      }
      for (const p of w.pages) {
        s.pageMs[p.page - 1] = (s.pageMs[p.page - 1] ?? 0) + p.ms
        s.totalMs += p.ms
      }
    }

    return {
      materials: materials.map((m) => ({ _id: m._id, kind: m.kind, title: m.title, currentVersionId: m.currentVersionId, createdAt: m.createdAt })),
      versions: versions.map((x) => ({ _id: x._id, materialId: x.materialId, n: x.n, fileId: x.fileId, url: x.url, pages: x.pages, note: x.note, createdAt: x.createdAt, by: names.get(x.createdBy) })),
      links: links.map((l) => ({
        _id: l._id, token: l.token, investorId: l.investorId, materialId: l.materialId, versionId: l.versionId, options: l.options,
        revokedAt: l.revokedAt, expiresAt: l.expiresAt, createdAt: l.createdAt, firstOpenedAt: l.firstOpenedAt,
      })),
      stats: [...stats.values()].map((s) => ({ ...s, pageMs: Array.from(s.pageMs, (x) => x ?? 0) })),
      notices: links
        .filter((l) => l.createdBy === userId && l.options.notify && l.firstOpenedAt !== undefined && l.seenAt === undefined && l.investorId)
        .map((l) => ({ linkId: l._id, investorId: l.investorId!, at: l.firstOpenedAt! })),
      emailReady: emailReady(),
    }
  },
})

/** A short-lived URL to read one version in Nest (older versions stay readable). */
export const fileUrl = query({
  args: { versionId: v.id('materialVersions') },
  handler: async (ctx, { versionId }) => {
    await requireUser(ctx)
    const ver = await ctx.db.get(versionId)
    if (!ver) return null
    if (ver.url) return ver.url
    return ver.fileId ? await ctx.storage.getUrl(ver.fileId) : null
  },
})

/** Where the browser uploads a PDF to (Convex file storage). */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

const vSource = v.object({ fileId: v.optional(v.id('_storage')), url: v.optional(v.string()), pages: v.optional(v.number()), note: v.string() })
type Source = typeof vSource.type

/** One version's contents: an uploaded PDF (checked here) or an https link, and a one-line note. */
async function cleanSource(ctx: MutationCtx, s: Source) {
  const note = s.note.trim().replace(/\s+/g, ' ').slice(0, MAX_NOTE)
  if (s.fileId && s.url) throw new ConvexError('A version is a file or a link, not both.')
  if (s.url !== undefined) {
    const url = cleanUrl(s.url)
    if (!url) throw new ConvexError('That link doesn’t look right. Paste the https:// address of the Google Slides or Docs file.')
    return { url, note }
  }
  if (!s.fileId) throw new ConvexError('Add a PDF or a link.')
  const meta = await ctx.db.system.get(s.fileId)
  if (!meta) throw new ConvexError('That upload didn’t arrive. Try again.')
  if (meta.size > MAX_UPLOAD_BYTES) throw new ConvexError('That file is over 50 MB. Export a lighter PDF and try again.')
  if (meta.contentType && meta.contentType !== PDF_TYPE) throw new ConvexError('Only PDFs upload here. Add Google Slides or Docs as a link.')
  const pages = s.pages !== undefined && Number.isInteger(s.pages) && s.pages > 0 && s.pages <= MAX_PAGES ? s.pages : undefined
  return { fileId: s.fileId, pages, note }
}

const cleanTitle = (t: string) => {
  const title = t.trim().replace(/\s+/g, ' ').slice(0, MAX_TITLE)
  if (!title) throw new ConvexError('Give it a name, like Pitch deck.')
  return title
}

/** A new material with its first version (v1, current). */
export const create = mutation({
  args: { kind: vMaterialKind, title: v.string(), source: vSource },
  handler: async (ctx, { kind, title, source }) => {
    const { userId } = await requireUser(ctx)
    const body = await cleanSource(ctx, source)
    const now = Date.now()
    const materialId = await ctx.db.insert('materials', { kind, title: cleanTitle(title), createdAt: now, createdBy: userId })
    const versionId = await ctx.db.insert('materialVersions', { materialId, n: 1, ...body, createdAt: now, createdBy: userId })
    await ctx.db.patch(materialId, { currentVersionId: versionId })
    return materialId
  },
})

/** A new version, which becomes current. Links pinned to older versions keep showing them. */
export const addVersion = mutation({
  args: { materialId: v.id('materials'), source: vSource },
  handler: async (ctx, { materialId, source }) => {
    const { userId } = await requireUser(ctx)
    const m = await ctx.db.get(materialId)
    if (!m) throw new ConvexError('That material was deleted.')
    const body = await cleanSource(ctx, source)
    const last = await ctx.db.query('materialVersions').withIndex('by_material', (q) => q.eq('materialId', materialId)).order('desc').first()
    const versionId = await ctx.db.insert('materialVersions', { materialId, n: (last?.n ?? 0) + 1, ...body, createdAt: Date.now(), createdBy: userId })
    await ctx.db.patch(materialId, { currentVersionId: versionId })
    return versionId
  },
})

export const makeCurrent = mutation({
  args: { versionId: v.id('materialVersions') },
  handler: async (ctx, { versionId }) => {
    await requireUser(ctx)
    const ver = await ctx.db.get(versionId)
    if (!ver) throw new ConvexError('That version was deleted.')
    await ctx.db.patch(ver.materialId, { currentVersionId: versionId })
    return ver.n
  },
})

/** Delete a material: its versions and files, its links (they stop opening) and their views. */
export const remove = mutation({
  args: { materialId: v.id('materials') },
  handler: async (ctx, { materialId }) => {
    await requireUser(ctx)
    for (const l of await ctx.db.query('shareLinks').withIndex('by_material', (q) => q.eq('materialId', materialId)).collect()) {
      for (const w of await ctx.db.query('views').withIndex('by_link', (q) => q.eq('linkId', l._id)).collect()) await ctx.db.delete(w._id)
      await ctx.db.delete(l._id)
    }
    for (const ver of await ctx.db.query('materialVersions').withIndex('by_material', (q) => q.eq('materialId', materialId)).collect()) {
      if (ver.fileId) await ctx.storage.delete(ver.fileId)
      await ctx.db.delete(ver._id)
    }
    if (await ctx.db.get(materialId)) await ctx.db.delete(materialId)
  },
})

const versionName = (m: Doc<'materials'>, ver: Doc<'materialVersions'> | null) => (ver ? `${m.title} v${ver.n}` : m.title)

/**
 * Share: one link per investor, each with its own 128-bit token. Pinned to a
 * version, or "current" (always the current one). Each link goes in the
 * investor's history; their first open counts as a touch (viewer.ts).
 */
export const share = mutation({
  args: {
    materialId: v.id('materials'),
    versionId: v.union(v.id('materialVersions'), v.literal('current')),
    investorIds: v.array(v.id('investors')),
    options: vLinkOptions,
    expiresInDays: v.number(),
  },
  handler: async (ctx, { materialId, versionId, investorIds, options, expiresInDays }) => {
    const { userId } = await requireUser(ctx)
    const m = await ctx.db.get(materialId)
    if (!m) throw new ConvexError('That material was deleted.')
    const ids = [...new Set(investorIds)]
    if (!ids.length) throw new ConvexError('Pick at least one investor.')
    if (ids.length > MAX_SHARE) throw new ConvexError(`Up to ${MAX_SHARE} investors at a time.`)
    const verId = versionId === 'current' ? m.currentVersionId : versionId
    const ver = verId ? await ctx.db.get(verId) : null
    if (!ver || ver.materialId !== materialId) throw new ConvexError('That version isn’t part of this material.')
    if (!Number.isInteger(expiresInDays) || expiresInDays < 0 || expiresInDays > 365) throw new ConvexError('Pick when the link expires.')
    const now = Date.now()
    const today = todayIST(now)
    const out: { linkId: Id<'shareLinks'>; investorId: Id<'investors'>; token: string }[] = []
    for (const investorId of ids) {
      if (!(await ctx.db.get(investorId))) continue
      const token = randomToken()
      const linkId = await ctx.db.insert('shareLinks', {
        token, investorId, materialId, versionId, options: normOptions(options), createdBy: userId, createdAt: now,
        ...(expiresInDays ? { expiresAt: now + expiresInDays * DAY_MS } : {}),
      })
      const what = versionId === 'current' ? `${m.title} (always the current version)` : versionName(m, ver)
      await ctx.db.insert('activities', { investorId, kind: 'note', note: `Sent a link to ${what}`, date: today, userId })
      out.push({ linkId, investorId, token })
    }
    return out
  },
})

/** Stop a link from opening ("This link has expired"). */
export const revoke = mutation({
  args: { linkId: v.id('shareLinks') },
  handler: async (ctx, { linkId }) => {
    await requireUser(ctx)
    const l = await ctx.db.get(linkId)
    if (!l) throw new ConvexError('That link was deleted.')
    if (l.revokedAt === undefined) await ctx.db.patch(linkId, { revokedAt: Date.now() })
  },
})

/** The first-open notices you've seen (Today's row, or opened from the toast). */
export const seen = mutation({
  args: { linkIds: v.array(v.id('shareLinks')) },
  handler: async (ctx, { linkIds }) => {
    const { userId } = await requireUser(ctx)
    const now = Date.now()
    for (const id of linkIds.slice(0, 200)) {
      const l = await ctx.db.get(id)
      if (l && l.createdBy === userId && l.seenAt === undefined) await ctx.db.patch(id, { seenAt: now })
    }
  },
})

/* ---------- Send by email (only when RESEND_API_KEY is set) ---------- */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Where share links point: SITE_URL, else nest.pestokids.com. */
export const siteOrigin = () => (process.env.SITE_URL ?? SHARE_ORIGIN).replace(/\/$/, '')

/** The emails to send: live links whose investor has an email. Checks the caller's access. */
export const emailDrafts = internalQuery({
  args: { linkIds: v.array(v.id('shareLinks')), message: v.string() },
  handler: async (ctx, { linkIds, message }) => {
    await requireUser(ctx)
    const out: { linkId: Id<'shareLinks'>; to: string; subject: string; text: string; html: string }[] = []
    const now = Date.now()
    const intro = message.trim().slice(0, MAX_MESSAGE)
    for (const id of linkIds.slice(0, MAX_SHARE)) {
      const l = await ctx.db.get(id)
      if (!l || !l.investorId || l.revokedAt !== undefined || (l.expiresAt !== undefined && l.expiresAt <= now)) continue
      const i = await ctx.db.get(l.investorId)
      const m = await ctx.db.get(l.materialId)
      const to = i?.email?.trim().toLowerCase()
      if (!i || !m || !to) continue
      const url = shareUrl(l.token, siteOrigin())
      const text = `${intro ? intro + '\n\n' : ''}${m.title}: ${url}\n\nDev\nPesto`
      const html = [
        ...(intro ? intro.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`) : []),
        `<p><a href="${url}">${escapeHtml(m.title)}</a></p>`,
        '<p>Dev<br>Pesto</p>',
      ].join('\n')
      out.push({ linkId: l._id, to, subject: `${m.title} from Pesto`, text, html })
    }
    return out
  },
})

/** Emailing a link is a touch (Email), like logging one by hand. */
export const logEmailed = internalMutation({
  args: { linkIds: v.array(v.id('shareLinks')) },
  handler: async (ctx, { linkIds }) => {
    const { userId } = await requireUser(ctx)
    const today = todayIST()
    for (const id of linkIds) {
      const l = await ctx.db.get(id)
      const i = l?.investorId ? await ctx.db.get(l.investorId) : null
      const m = l ? await ctx.db.get(l.materialId) : null
      if (!l || !i || !m) continue
      await ctx.db.insert('activities', { investorId: i._id, kind: 'note', note: `Emailed the ${m.title} link.`, touch: 'email', date: today, userId })
      if (!i.lastTouch || i.lastTouch < today) await ctx.db.patch(i._id, { lastTouch: today, updatedAt: Date.now(), updatedBy: userId })
    }
  },
})

/** Send links by email through Resend. Skipped (not failed) when RESEND_API_KEY isn't set. */
export const emailLinks = action({
  args: { linkIds: v.array(v.id('shareLinks')), message: v.string() },
  handler: async (ctx, { linkIds, message }): Promise<{ sent: number; failed: number; skipped: number }> => {
    const drafts = await ctx.runQuery(internal.materials.emailDrafts, { linkIds, message })
    if (!emailReady()) return { sent: 0, failed: 0, skipped: linkIds.length }
    const sent: Id<'shareLinks'>[] = []
    let failed = 0
    for (const d of drafts) {
      const r = await sendEmail({ to: d.to, subject: d.subject, text: d.text, html: d.html })
      if (r.sent) sent.push(d.linkId)
      else failed++
    }
    if (sent.length) await ctx.runMutation(internal.materials.logEmailed, { linkIds: sent })
    return { sent: sent.length, failed, skipped: linkIds.length - drafts.length }
  },
})
