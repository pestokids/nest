import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
import { investorFields, vPipelineStage } from './validators'
import { clean } from './investors'
import { getRoundRow } from './lib/round'
import { mergeRound, validateRound } from '../src/lib/round'

/**
 * Import internal/seed.json: round settings merged over DEFAULT_ROUND, plus
 * investors upserted by slug. Safe to run twice: unchanged rows aren't written.
 * Run with `pnpm seed` (dev) or `pnpm seed:prod`.
 */
export const importSeed = internalMutation({
  args: {
    exportedAt: v.optional(v.string()),
    round: v.optional(v.any()),
    investors: v.array(v.object({ ...investorFields, maxStage: vPipelineStage, slug: v.string() })),
    activities: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args) => {
    const counts = { settings: { inserted: 0, updated: 0, unchanged: 0 }, investors: { inserted: 0, updated: 0, unchanged: 0 }, activitiesIgnored: args.activities?.length ?? 0 }

    const row = await getRoundRow(ctx)
    const base = row ? (({ _id: _a, _creationTime: _b, key: _k, ...r }) => r)(row) : null
    const round = mergeRound({ ...(base ?? {}), ...(args.round ?? {}) })
    const errors = validateRound(round)
    if (Object.keys(errors).length) throw new Error('Seed round is invalid: ' + JSON.stringify(errors))
    if (!row) {
      await ctx.db.insert('settings', { key: 'round', ...round })
      counts.settings.inserted++
    } else if (JSON.stringify(sortKeys(base)) !== JSON.stringify(sortKeys(round))) {
      await ctx.db.replace(row._id, { key: 'round', ...round })
      counts.settings.updated++
    } else counts.settings.unchanged++

    for (const s of args.investors) {
      const { maxStage, slug, ...fields } = s
      const doc = { ...clean(fields), maxStage, slug }
      const prev = await ctx.db.query('investors').withIndex('by_slug', (q) => q.eq('slug', slug)).unique()
      if (!prev) {
        await ctx.db.insert('investors', { ...doc, updatedAt: Date.now() })
        counts.investors.inserted++
        continue
      }
      const { _id, _creationTime: _c, updatedAt: _u, updatedBy, ...current } = prev
      if (JSON.stringify(sortKeys(current)) === JSON.stringify(sortKeys(stripUndef(doc)))) {
        counts.investors.unchanged++
        continue
      }
      await ctx.db.replace(_id, { ...doc, updatedAt: Date.now(), ...(updatedBy ? { updatedBy } : {}) })
      counts.investors.updated++
    }
    return counts
  },
})

function stripUndef<T extends object>(o: T) {
  return Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined))
}
function sortKeys(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(sortKeys)
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, y]) => [k, sortKeys(y)]))
  return x
}
