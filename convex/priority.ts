// PST-284: what Investors › Sort: Priority needs from the server: each
// investor's Fit, from their kept fund facts (src/lib/priority.ts). The score
// itself is worked out where it's shown, from the investor list.
import { query, type QueryCtx } from './_generated/server'
import { requireUser } from './lib/access'
import { loadRound } from './lib/round'
import { fitsByInvestor } from '../src/lib/priority'

/** Fit by investor id, for every investor with enough kept fund facts. Also the MCP search's priority (mcp.ts). */
export async function keptFits(ctx: QueryCtx) {
  const { round } = await loadRound(ctx)
  const facts = await ctx.db
    .query('facts')
    .withIndex('by_status', (q) => q.eq('status', 'kept'))
    .collect()
  return fitsByInvestor(facts, round)
}

export const fits = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    return await keptFits(ctx)
  },
})
