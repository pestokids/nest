import { v } from 'convex/values'
import { ConvexError } from 'convex/values'
import { mutation, query, type MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireUser } from './lib/access'
import { investorFields } from './validators'
import { todayIST, isISODate } from '../src/lib/dates'
import { applyAdvance, applySave, type InvestorFields } from '../src/lib/pipeline'
import { IDX, LABEL } from '../src/lib/stages'

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
  }
}
const vFields = v.object(investorFields)

async function logStage(ctx: MutationCtx, investorId: Id<'investors'>, stage: InvestorFields['stage'], userId: Id<'users'>, date: string) {
  await ctx.db.insert('activities', { investorId, kind: 'stage', stage, date, userId })
}

/** Create (no id) or update an investor. Stage changes log an activity in the same transaction. */
export const upsert = mutation({
  args: { id: v.optional(v.id('investors')), fields: vFields },
  handler: async (ctx, { id, fields }) => {
    const { userId } = await requireUser(ctx)
    const body = clean(fields)
    if (!body.name) throw new ConvexError('Name is required')
    const today = todayIST()
    const prev = id ? await ctx.db.get(id) : null
    if (id && !prev) throw new ConvexError('That investor was deleted')
    const { lastTouch, maxStage, logStage: stage } = applySave(prev, body, today)
    const doc = { ...body, lastTouch, maxStage, updatedAt: Date.now(), updatedBy: userId }
    let investorId: Id<'investors'>
    if (prev) {
      // replace, so cleared optional fields are removed
      await ctx.db.replace(prev._id, { ...doc, ...(prev.slug ? { slug: prev.slug } : {}) })
      investorId = prev._id
    } else investorId = await ctx.db.insert('investors', doc)
    if (stage) await logStage(ctx, investorId, stage, userId, today)
    return investorId
  },
})

/** Import rows from the CSV preview, skipping name + firm duplicates again server-side. */
export const importMany = mutation({
  args: { rows: v.array(vFields) },
  handler: async (ctx, { rows }) => {
    const { userId } = await requireUser(ctx)
    const key = (n: string, f: string) => `${n.trim().toLowerCase()}\u0000${f.trim().toLowerCase()}`
    const seen = new Set((await ctx.db.query('investors').collect()).map((i) => key(i.name, i.firm)))
    const today = todayIST()
    let added = 0
    for (const r of rows) {
      const body = clean(r)
      if (!body.name || seen.has(key(body.name, body.firm))) continue
      seen.add(key(body.name, body.firm))
      const { lastTouch, maxStage, logStage: stage } = applySave(null, body, today)
      const id = await ctx.db.insert('investors', { ...body, lastTouch, maxStage, updatedAt: Date.now(), updatedBy: userId })
      if (stage) await logStage(ctx, id, stage, userId, today)
      added++
    }
    return { added, skipped: rows.length - added }
  },
})

/** Move one stage forward. */
export const advance = mutation({
  args: { id: v.id('investors') },
  handler: async (ctx, { id }) => {
    const { userId } = await requireUser(ctx)
    const i = await ctx.db.get(id)
    if (!i) throw new ConvexError('That investor was deleted')
    const today = todayIST()
    const next = applyAdvance(i, today)
    if (!next) return null
    await ctx.db.patch(id, {
      stage: next.stage, lastTouch: today, updatedAt: Date.now(), updatedBy: userId,
      ...(next.raiseMax && IDX[next.stage] !== undefined ? { maxStage: next.stage } : {}),
    })
    await logStage(ctx, id, next.stage, userId, today)
    return { stage: next.stage, label: LABEL[next.stage] }
  },
})

/** Log a note ("touch") and set lastTouch to today. */
export const logNote = mutation({
  args: { id: v.id('investors'), note: v.string() },
  handler: async (ctx, { id, note }) => {
    const { userId } = await requireUser(ctx)
    const text = note.trim()
    if (!text) throw new ConvexError('Write a note first')
    if (!(await ctx.db.get(id))) throw new ConvexError('That investor was deleted')
    const today = todayIST()
    await ctx.db.insert('activities', { investorId: id, kind: 'note', note: text, date: today, userId })
    await ctx.db.patch(id, { lastTouch: today, updatedAt: Date.now(), updatedBy: userId })
    return today
  },
})

/** Delete an investor and its activity log. */
export const remove = mutation({
  args: { id: v.id('investors') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const acts = await ctx.db.query('activities').withIndex('by_investor', (q) => q.eq('investorId', id)).collect()
    for (const a of acts) await ctx.db.delete(a._id)
    if (await ctx.db.get(id)) await ctx.db.delete(id)
    return acts.length
  },
})
