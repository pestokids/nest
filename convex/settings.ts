import { ConvexError } from 'convex/values'
import { mutation, query } from './_generated/server'
import { firstName, requireUser } from './lib/access'
import { getRoundRow, loadRound } from './lib/round'
import { vRound } from './validators'
import { diffRound, validateRound, type Round } from '../src/lib/round'

/** The round parameters (DEFAULT_ROUND until the row exists). */
export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return await loadRound(ctx)
  },
})

/** Replace the round row after validating; logs one settingsLog row per changed field. */
export const update = mutation({
  args: { round: vRound },
  handler: async (ctx, { round }) => {
    const { userId } = await requireUser(ctx)
    const next: Round = {
      ...round,
      instrument: round.instrument.trim(),
      waves: round.waves.map((w) => w.trim()),
      phases: round.phases.map((p) => ({ ...p, name: p.name.trim(), todo: p.todo.map((t) => t.trim()).filter(Boolean), targets: p.targets.map((x) => ({ ...x, l: x.l.trim() })) })),
    }
    const errors = validateRound(next)
    if (Object.keys(errors).length) throw new ConvexError({ message: 'Fix the highlighted fields', errors })
    const { round: before } = await loadRound(ctx)
    const changes = diffRound(before, next)
    const row = await getRoundRow(ctx)
    if (row) await ctx.db.replace(row._id, { key: 'round', ...next })
    else await ctx.db.insert('settings', { key: 'round', ...next })
    const at = Date.now()
    for (const c of changes) await ctx.db.insert('settingsLog', { userId, at, ...c })
    return changes.length
  },
})

/** Recent settings changes, newest first. */
export const log = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const rows = await ctx.db.query('settingsLog').withIndex('by_at').order('desc').take(60)
    const names = new Map<string, string>()
    for (const r of rows) if (!names.has(r.userId)) names.set(r.userId, firstName(await ctx.db.get(r.userId)))
    return rows.map((r) => ({ ...r, by: names.get(r.userId) ?? '?' }))
  },
})
