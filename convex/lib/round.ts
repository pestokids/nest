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
  // PST-283: the cap table is read and written on its own (convex/closings.ts), never through the round form.
  // PST-291: so is tranche 2. PST-295: so is the lead (convex/race.ts).
  const { _id: _i, _creationTime: _c, key: _k, capTable: _t, tranche2: _t2, leadId: _l, ...rest } = row
  return { round: mergeRound(rest), exists: true }
}
