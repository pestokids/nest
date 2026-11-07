// PST-279: the morning brief's one Claude call. Haiku writes a one-line reason for
// each of today's three moves from the facts Nest has (nothing else), well under
// a cent. Any line that's missing, too long, or carries a number the facts don't
// have is dropped, and that move keeps Today's own why.
import type { BriefSince } from '../../src/lib/brief'
import { extractJson } from './anthropic'

export const REASON_MAX = 90

export type MoveFacts = {
  move: string
  why: string
  investor?: { name: string; stage: string; nextStep?: string; nextDate?: string; lastTouch?: string; expected?: number; committed?: number }
  sinceYesterday: string[]
}

export const REASONS_SYSTEM = `You write the one-line reason under each of today's moves in Nest, Pesto's fundraising tracker, for Dev, the founder.

- One line per move, at most ${REASON_MAX} characters, in plain words, the way a sharp friend would say it: "They read Traction twice this morning."
- Use only the facts given for that move. Never add a number, name or date that isn't in them. When the facts add nothing, say the given why more plainly.
- No greetings, no emoji, no quotes.

Answer with JSON only: {"reasons": ["…", "…"]}, one per move, in the same order.`

/** What happened since yesterday that concerns one investor, in short lines. */
export function sinceLines(s: BriefSince, investorId: string): string[] {
  const out: string[] = []
  if (s.replies.some((r) => r.investorId === investorId)) out.push('Wrote back by email; the thread is waiting on Dev')
  for (const o of s.opens.filter((x) => x.investorId === investorId))
    out.push(`Opened ${o.material} for ${Math.max(1, Math.round(o.ms / 6e4))} min${o.page ? `, longest on page ${o.page}` : ''}`)
  for (const m of s.meetings.filter((x) => x.investorId === investorId))
    out.push(`Meeting “${m.title}” happened; ${m.notes === 'read' ? 'Nest read the notes' : m.notes === 'unread' ? 'notes saved, not read yet' : 'no notes yet'}`)
  return out
}

export const reasonsPrompt = (facts: MoveFacts[]) => 'Today’s moves, with what Nest knows:\n\n' + JSON.stringify(facts, null, 1)

/** Claude's reasons, one per move; undefined where Today's own why should stay. */
export function parseReasons(text: string, facts: MoveFacts[]): (string | undefined)[] {
  let xs: unknown
  try {
    xs = (extractJson(text) as { reasons?: unknown }).reasons
  } catch {
    return facts.map(() => undefined)
  }
  if (!Array.isArray(xs)) return facts.map(() => undefined)
  return facts.map((f, i) => {
    const r = typeof xs[i] === 'string' ? xs[i].trim().replace(/\s+/g, ' ') : ''
    if (!r || r.length > REASON_MAX) return undefined
    const known = JSON.stringify(f)
    return (r.match(/\d+/g) ?? []).every((n) => known.includes(n)) ? r : undefined
  })
}
