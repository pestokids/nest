import type { QueryCtx } from '../_generated/server'
import { mergeRound, type Round } from '../../src/lib/round'

export async function getRoundRow(ctx: QueryCtx) {
  const row = await ctx.db.query('settings').withIndex('by_key', (q) => q.eq('key', 'round')).unique()
  return row?.key === 'round' ? row : null
}

/** The round row, or DEFAULT_ROUND when it doesn't exist yet. */
export async function loadRound(ctx: QueryCtx): Promise<{ round: Round; exists: boolean }> {
  const row = await getRoundRow(ctx)
  if (!row) return { round: mergeRound(null), exists: false }
  const { _id: _i, _creationTime: _c, key: _k, ...rest } = row
  return { round: mergeRound(rest), exists: true }
}
