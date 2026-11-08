// PST-302: the one way a stage move is logged. Every change writes exactly one
// stage activity, with the stage before it, the stage after it, who made it
// (a person; "agent" when Dev accepted an agent's suggestion; "signal" when Nest
// moved it from Calendar) and the day.
import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import type { Stage } from '../../src/lib/stages'
import type { StageVia } from '../../src/lib/pipeline'

export async function logStageMove(
  ctx: MutationCtx,
  a: { investorId: Id<'investors'>; from?: Stage; to: Stage; userId: Id<'users'>; date: string; via?: StageVia; source?: 'calendar' | 'gmail' },
) {
  return await ctx.db.insert('activities', {
    investorId: a.investorId,
    kind: 'stage',
    stage: a.to,
    ...(a.from && a.from !== a.to ? { fromStage: a.from } : {}),
    ...(a.via ? { via: a.via } : {}),
    ...(a.source ? { source: a.source } : {}),
    date: a.date,
    userId: a.userId,
  })
}
