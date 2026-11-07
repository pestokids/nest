// PST-277: starting a read of a meeting note. Saving notes (pasted, or in through
// MCP) starts one when "Read meeting notes" is on in Settings; "Read with Nest"
// starts one whatever the toggle says. Nothing starts without ANTHROPIC_API_KEY.
import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'
import { internal } from '../_generated/api'
import { hasAIKey } from './anthropic'
import { aiSettings } from './enrichQueue'

/** A read still "reading" after this long died without saying so. */
export const READ_STALE_MS = 5 * 6e4

/** Queue Claude's read of a note. Null when AI isn't set up, or (for an automatic read) it's turned off. */
export async function startRead(ctx: MutationCtx, noteId: Id<'notes'>, o: { auto: boolean }): Promise<Id<'noteReads'> | null> {
  if (!hasAIKey()) return null
  if (o.auto && !(await aiSettings(ctx)).meetingNotes) return null
  const note = await ctx.db.get(noteId)
  if (!note || note.removedAt) return null
  const now = Date.now()
  const last = await ctx.db.query('noteReads').withIndex('by_note', (q) => q.eq('noteId', noteId)).order('desc').first()
  if (last?.status === 'reading' && last.startedAt > now - READ_STALE_MS) return last._id
  const id = await ctx.db.insert('noteReads', { noteId, investorId: note.investorId, status: 'reading', auto: o.auto, summary: [], proposals: [], costUsd: 0, startedAt: now })
  await ctx.scheduler.runAfter(0, internal.noteReads.execute, { readId: id })
  return id
}
