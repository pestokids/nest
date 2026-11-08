// PST-289: Home's Inbox preview. The top rows from Today's own lists (Waiting on
// you, Due today, Gone quiet and Suggested fixes) through one selector, so Home
// never has rules of its own. PST-297 swaps this for the real Inbox.
import { dayDiff } from './dates'
import { agoShort, waitingOnYou, type SyncedThread } from './google'
import { dueDate, dueList, quietFor, quietList, type Investor } from './pipeline'
import type { Suggestion } from './suggestions'

export type InboxKind = 'reply' | 'due' | 'quiet' | 'review'
export type InboxRow = { key: string; kind: InboxKind; name: string; detail: string; investorId?: string }

export const INBOX_LABEL: Record<InboxKind, string> = { reply: 'Reply', due: 'Follow up', quiet: 'Nudge', review: 'Review' }

export type InboxSources = {
  investors: Investor[]
  threads: readonly SyncedThread[]
  /** Open suggestions, best first (as Today has them). */
  suggestions: readonly Pick<Suggestion, '_id' | 'investorId' | 'title'>[]
  quietDays: number
  today: string
  now: number
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/**
 * Every row, in Today's order: replies owed, then what's due (oldest first),
 * then who's gone quiet, then suggestions. An investor shows once, on their
 * first row. `total` counts them all; `rows` is the first `limit`.
 */
export function inboxPreview(src: InboxSources, limit = 4): { total: number; rows: InboxRow[] } {
  const byId = new Map(src.investors.map((i) => [i._id, i]))
  const seen = new Set<string>()
  const all: InboxRow[] = []
  const add = (row: InboxRow) => {
    if (row.investorId && row.kind !== 'review') {
      if (seen.has(row.investorId)) return
      seen.add(row.investorId)
    }
    all.push(row)
  }

  for (const t of waitingOnYou(src.threads, src.now)) {
    const i = byId.get(t.investorIds[0])
    if (!i) continue
    add({ key: 'reply:' + t._id, kind: 'reply', investorId: i._id, name: i.name, detail: `wrote ${agoShort(t.lastAt, src.now)}` })
  }
  for (const i of dueList(src.investors, src.today)) {
    const late = dayDiff(src.today, dueDate(i)!)
    const detail = i.stage === 'parked' ? 'back from parked' : late > 0 ? `${days(late)} over` : i.nextStep.trim() || 'due today'
    add({ key: 'due:' + i._id, kind: 'due', investorId: i._id, name: i.name, detail })
  }
  for (const i of quietList(src.investors, src.today, src.quietDays)) {
    const n = quietFor(i, src.today, src.quietDays)!
    add({ key: 'quiet:' + i._id, kind: 'quiet', investorId: i._id, name: i.name, detail: n === Infinity ? 'never touched' : `${days(n)} quiet` })
  }
  for (const s of src.suggestions) {
    const i = s.investorId ? byId.get(s.investorId) : undefined
    add({ key: 'review:' + s._id, kind: 'review', investorId: i?._id, name: i?.name ?? 'Suggested fix', detail: s.title })
  }
  return { total: all.length, rows: all.slice(0, limit) }
}
