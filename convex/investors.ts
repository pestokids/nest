import { v } from 'convex/values'
import { ConvexError } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { investorFields, vPipelineStage, vStage, vTouch } from './validators'
import { todayIST, isISODate } from '../src/lib/dates'
import { applyAdvance, applySave, touchDay, type InvestorFields } from '../src/lib/pipeline'
import { applyMove, applyUndo } from '../src/lib/board'
import { IDX, LABEL } from '../src/lib/stages'
import { addressesOf, cleanDomains, cleanEmails, normEmail } from '../src/lib/google'
import { internal } from './_generated/api'
import { autoEnrich, forgetInvestor } from './lib/enrichQueue'

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return await ctx.db.query('investors').collect()
  },
})

/** null → undefined, trim strings, clamp money at 0, drop bad dates. */
export function clean(f: typeof vFields.type): InvestorFields {
  const num = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? undefined : Math.max(0, x))
  const date = (x: string | null | undefined) => (x && isISODate(x) ? x : undefined)
  return {
    ...f,
    name: f.name.trim(), firm: f.firm.trim(), path: f.path.trim(), nextStep: f.nextStep.trim(), notes: f.notes.trim(), source: f.source.trim(),
    expected: num(f.expected), committed: num(f.committed), nextDate: date(f.nextDate), lastTouch: date(f.lastTouch),
    email: normEmail(f.email) || f.email?.trim() || undefined,
    parkedUntil: f.stage === 'parked' ? date(f.parkedUntil) : undefined,
    emails: orNone(cleanEmails(f.emails, f.email ?? undefined)),
    domains: orNone(cleanDomains(f.domains)),
  }
}
const orNone = (xs: string[]) => (xs.length ? xs : undefined)

/** The addresses an investor is matched by, as one comparable string. */
const addressKey = (i: { email?: string; emails?: string[]; domains?: string[] } | null) => {
  if (!i) return ''
  const a = addressesOf(i)
  return a.emails.length || a.domains.length ? [...a.emails].sort().join(',') + '|' + [...a.domains].sort().join(',') : ''
}

/** Calendar and Gmail: match again when an investor's addresses change (and read Gmail again for new ones). */
async function rematchIfChanged(ctx: MutationCtx, before: string, after: string) {
  if (before === after) return
  const added = after.split(/[|,]/).some((x) => x && !before.split(/[|,]/).includes(x))
  await ctx.scheduler.runAfter(0, internal.google.rematch, { rescan: added })
}
const vFields = v.object(investorFields)

async function logStage(ctx: MutationCtx, investorId: Id<'investors'>, stage: InvestorFields['stage'], userId: Id<'users'>, date: string) {
  await ctx.db.insert('activities', { investorId, kind: 'stage', stage, date, userId })
}

/**
 * The upsert write: clean, require a name, log a stage change in the same
 * transaction, and match Calendar and Gmail again when addresses change. Also
 * how enrichment's Keep writes an investor field.
 */
export async function saveInvestor(ctx: MutationCtx, userId: Id<'users'>, id: Id<'investors'> | undefined, fields: typeof vFields.type) {
  const body = clean(fields)
  if (!body.name) throw new ConvexError('Name is required')
  const today = todayIST()
  const prev = id ? await ctx.db.get(id) : null
  if (id && !prev) throw new ConvexError('That investor was deleted')
  // Older clients don't send emails/domains: keep what's stored rather than clearing it.
  if (prev && fields.emails === undefined) body.emails = prev.emails
  if (prev && fields.domains === undefined) body.domains = prev.domains
  const { lastTouch, maxStage, logStage: stage } = applySave(prev, body, today)
  const doc = { ...body, lastTouch, maxStage, updatedAt: Date.now(), updatedBy: userId }
  let investorId: Id<'investors'>
  if (prev) {
    // replace, so cleared optional fields are removed
    await ctx.db.replace(prev._id, { ...doc, ...(prev.slug ? { slug: prev.slug } : {}) })
    investorId = prev._id
  } else investorId = await ctx.db.insert('investors', doc)
  if (stage) await logStage(ctx, investorId, stage, userId, today)
  await rematchIfChanged(ctx, addressKey(prev), addressKey(body))
  return investorId
}

/** Create (no id) or update an investor. A new one is looked up when "Enrich investors when you add them" is on. */
export const upsert = mutation({
  args: { id: v.optional(v.id('investors')), fields: vFields },
  handler: async (ctx, { id, fields }) => {
    const { userId } = await requireUser(ctx)
    const investorId = await saveInvestor(ctx, userId, id, fields)
    if (!id) await autoEnrich(ctx, [investorId])
    return investorId
  },
})

/**
 * Import rows from the CSV preview, skipping name + firm duplicates again server-side.
 * Returns the new ids (for "See the new names" and Undo) and notes the import in the change log.
 */
export const importMany = mutation({
  args: { rows: v.array(vFields), file: v.optional(v.string()) },
  handler: async (ctx, { rows, file }) => {
    const { userId } = await requireUser(ctx)
    const key = (n: string, f: string) => `${n.trim().toLowerCase()}\u0000${f.trim().toLowerCase()}`
    const seen = new Set((await ctx.db.query('investors').collect()).map((i) => key(i.name, i.firm)))
    const today = todayIST()
    let added = 0
    let newAddresses = false
    const ids: Id<'investors'>[] = []
    for (const r of rows) {
      const body = clean(r)
      if (!body.name || seen.has(key(body.name, body.firm))) continue
      seen.add(key(body.name, body.firm))
      const { lastTouch, maxStage, logStage: stage } = applySave(null, body, today)
      const id = await ctx.db.insert('investors', { ...body, lastTouch, maxStage, updatedAt: Date.now(), updatedBy: userId })
      if (stage) await logStage(ctx, id, stage, userId, today)
      ids.push(id)
      added++
      if (addressKey(body)) newAddresses = true
    }
    if (newAddresses) await ctx.scheduler.runAfter(0, internal.google.rematch, { rescan: true })
    await autoEnrich(ctx, ids)
    if (added) {
      const what = `${added} investor${added === 1 ? '' : 's'}${file ? ` from ${file.trim().slice(0, 120)}` : ''}`
      await ctx.db.insert('settingsLog', { userId, at: Date.now(), field: 'import', from: '', to: what })
    }
    return { added, skipped: rows.length - added, ids }
  },
})

/** Move one stage forward, optionally setting the next step in the same write. */
export const advance = mutation({
  args: { id: v.id('investors'), next: v.optional(v.object({ step: v.string(), date: v.optional(v.union(v.string(), v.null())) })) },
  handler: async (ctx, { id, next: step }) => {
    const { userId } = await requireUser(ctx)
    const i = await ctx.db.get(id)
    if (!i) throw new ConvexError('That investor was deleted')
    const today = todayIST()
    const next = applyAdvance(i, today)
    if (!next) return null
    await ctx.db.patch(id, {
      stage: next.stage, lastTouch: today, updatedAt: Date.now(), updatedBy: userId,
      ...(next.raiseMax && IDX[next.stage] !== undefined ? { maxStage: next.stage } : {}),
      ...(step ? { nextStep: step.step.trim(), nextDate: step.date && isISODate(step.date) ? step.date : undefined } : {}),
    })
    await logStage(ctx, id, next.stage, userId, today)
    return { stage: next.stage, label: LABEL[next.stage] }
  },
})

/**
 * Log a touch (a note, call, email, meeting, ask, nudge or done next step).
 * `date` defaults to today and can't be in the future; lastTouch moves forward
 * to it. `next` also sets the next step (an empty date clears it).
 */
export const logNote = mutation({
  args: {
    id: v.id('investors'),
    note: v.string(),
    touch: v.optional(vTouch),
    date: v.optional(v.string()),
    next: v.optional(v.object({ step: v.string(), date: v.optional(v.union(v.string(), v.null())) })),
  },
  handler: async (ctx, { id, note, touch, date, next }) => {
    const { userId } = await requireUser(ctx)
    const text = note.trim()
    if (!text) throw new ConvexError('Write a note first')
    const i = await ctx.db.get(id)
    if (!i) throw new ConvexError('That investor was deleted')
    const today = todayIST()
    const day = touchDay(date, today)
    await ctx.db.insert('activities', { investorId: id, kind: 'note', note: text, ...(touch ? { touch } : {}), date: day, userId })
    await ctx.db.patch(id, {
      lastTouch: !i.lastTouch || i.lastTouch < day ? day : i.lastTouch,
      updatedAt: Date.now(),
      updatedBy: userId,
      ...(next ? { nextStep: next.step.trim(), nextDate: next.date && isISODate(next.date) ? next.date : undefined } : {}),
    })
    return day
  },
})

/** Delete an investor and its activity log. */
export const remove = mutation({
  args: { id: v.id('investors') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const acts = await ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()
    for (const a of acts) await ctx.db.delete(a._id)
    const prev = await ctx.db.get(id)
    if (prev) await ctx.db.delete(id)
    await forgetInvestor(ctx, id)
    // Its meetings and email touches lose the match (threads with nobody else go).
    if (prev && addressKey(prev)) await ctx.scheduler.runAfter(0, internal.google.rematch, { rescan: false })
    return acts.length
  },
})

/**
 * Move to any stage (the Pipeline board's drag, [ and ] keys and phone swipe).
 * Same write rule as `upsert` (lastTouch today, maxStage only rises, a stage
 * activity), but it patches only those fields and returns what Undo needs to
 * put the card back exactly.
 */
export const move = mutation({
  args: { id: v.id('investors'), stage: vStage },
  handler: async (ctx, { id, stage }) => {
    const { userId } = await requireUser(ctx)
    const prev = await ctx.db.get(id)
    if (!prev) throw new ConvexError('That investor was deleted')
    const from = { stage: prev.stage, lastTouch: prev.lastTouch, maxStage: prev.maxStage }
    if (prev.stage === stage) return { from, activityId: null }
    const today = todayIST()
    const { patch, logStage } = applyMove(prev, stage, today)
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now(), updatedBy: userId })
    const activityId = logStage ? await ctx.db.insert('activities', { investorId: id, kind: 'stage', stage: logStage, date: today, userId }) : null
    return { from, activityId }
  },
})

/** Undo a `move`: restore the old stage, lastTouch and maxStage and drop its activity, unless it has moved again since. */
export const undoMove = mutation({
  args: {
    id: v.id('investors'),
    to: vStage,
    from: v.object({ stage: vStage, lastTouch: v.optional(v.string()), maxStage: vPipelineStage }),
    activityId: v.optional(v.union(v.id('activities'), v.null())),
  },
  handler: async (ctx, { id, to, from, activityId }) => {
    const { userId } = await requireUser(ctx)
    const cur = await ctx.db.get(id)
    if (!cur) throw new ConvexError('That investor was deleted')
    const patch = applyUndo(cur, { id, to, from, activityId })
    if (!patch) throw new ConvexError('It moved again since, so there’s nothing to undo')
    await ctx.db.patch(id, { ...patch, lastTouch: patch.lastTouch && isISODate(patch.lastTouch) ? patch.lastTouch : undefined, updatedAt: Date.now(), updatedBy: userId })
    if (activityId) {
      const a = await ctx.db.get(activityId)
      if (a && a.investorId === id && a.kind === 'stage') await ctx.db.delete(activityId)
    }
    return patch.stage
  },
})
