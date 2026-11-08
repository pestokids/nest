// PST-296: where Investors › Sort: Priority's Jev fit scores start. Enrichment kept
// a fact (convex/enrich.ts): Nest works out what Jev would read about that investor
// (their kept fund facts against the round) and its hash, and schedules one Jev call
// only when the hash differs from the score it keeps. Nothing here sweeps the list.
import type { MutationCtx, QueryCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { jevReady } from './jev'
import { loadRound } from './round'
import type { Fact } from '../../src/lib/enrich'
import { factsHash, investorFacts, needsRescore, roundFacts, type FitState } from '../../src/lib/fitScore'

/** What Jev would read about an investor now, and its hash. Null when they're gone or nothing about them is kept yet. */
export async function priorityState(ctx: QueryCtx, investorId: Id<'investors'>): Promise<{ state: FitState; hash: string } | null> {
  const inv = await ctx.db.get(investorId)
  if (!inv) return null
  const facts = await ctx.db.query('facts').withIndex('by_investor', (q) => q.eq('investorId', investorId)).collect()
  const investor = investorFacts(inv.firm.trim() || inv.name, inv.type, facts as unknown as Fact[])
  if (!investor) return null
  const { round } = await loadRound(ctx)
  const state = { round: roundFacts(round), investor }
  return { state, hash: await factsHash(state) }
}

export const storedScore = (ctx: QueryCtx, investorId: Id<'investors'>) => ctx.db.query('jevScores').withIndex('by_investor', (q) => q.eq('investorId', investorId)).first()

/** After a fact is kept: schedule a rescore when the facts Jev reads changed. What it did, for the tests. */
export async function rescoreLater(ctx: MutationCtx, investorId: Id<'investors'>): Promise<'scheduled' | 'unchanged' | 'nofacts' | 'off'> {
  const s = await priorityState(ctx, investorId)
  if (!s) return 'nofacts'
  if (!needsRescore(await storedScore(ctx, investorId), s.hash)) return 'unchanged'
  if (!(await jevReady(ctx))) return 'off'
  await ctx.scheduler.runAfter(0, internal.findMore.scorePriority, { investorId })
  return 'scheduled'
}

/**
 * Dev accepted a Find more suggestion: the new investor keeps the score Jev gave
 * the candidate. It's kept under the candidate's own mark, so the first fact
 * enrichment keeps about them asks again.
 */
export async function carryFindScore(ctx: MutationCtx, suggestionId: Id<'suggestions'>, investorId: Id<'investors'>) {
  const c = await ctx.db.query('findCandidates').withIndex('by_suggestion', (q) => q.eq('suggestionId', suggestionId)).first()
  if (!c || c.scoredBy !== 'jev' || !c.parts) return
  await ctx.db.insert('jevScores', { investorId, hash: 'find:' + c._id, score: c.score, parts: c.parts, at: Date.now() })
}
