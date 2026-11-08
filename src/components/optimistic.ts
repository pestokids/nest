// PST-290: Convex optimistic updates for the instant changes. Each shows the
// change in the local query results at once; Convex swaps in the saved rows
// when the mutation lands (or drops the guess if it fails).
import type { OptimisticLocalStore } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { todayIST } from '../lib/dates'
import { applyAdvance } from '../lib/pipeline'
import { applyTouch, undoTouchPatch, type TouchFields } from '../lib/touch'

type NoteArgs = { id: Id<'investors'>; note: string; touch?: Doc<'activities'>['touch']; date?: string; next?: { step: string; date?: string | null } }

/** A logged touch: lastTouch (and the next step) on the investor, and its row at the top of both activity lists. */
export function showTouch(store: OptimisticLocalStore, a: NoteArgs, by: string, today = todayIST()) {
  const list = store.getQuery(api.investors.list, {})
  const i = list?.find((x) => x._id === a.id)
  if (!list || !i) return
  const { day, patch } = applyTouch(i, { touch: a.touch, date: a.date, next: a.next ? { step: a.next.step, date: a.next.date ?? undefined } : undefined }, today)
  store.setQuery(api.investors.list, {}, list.map((x) => (x._id === a.id ? { ...x, ...patch } : x)))
  const row = {
    _id: `optimistic-${crypto.randomUUID()}` as Id<'activities'>, _creationTime: Date.now(), investorId: a.id, kind: 'note' as const,
    note: a.note.trim(), ...(a.touch ? { touch: a.touch } : {}), date: day, userId: '' as Id<'users'>, by,
  }
  const recent = store.getQuery(api.activities.recent, {})
  if (recent) store.setQuery(api.activities.recent, {}, [row, ...recent])
  const theirs = store.getQuery(api.activities.forInvestor, { investorId: a.id })
  if (theirs) store.setQuery(api.activities.forInvestor, { investorId: a.id }, [row, ...theirs])
}

/** Undo of a touch: its row goes, and the fields go back unless they changed again since. */
export function hideTouch(store: OptimisticLocalStore, a: { id: Id<'investors'>; activityId: Id<'activities'>; from: TouchFields; set: TouchFields }) {
  const list = store.getQuery(api.investors.list, {})
  if (list) store.setQuery(api.investors.list, {}, list.map((i) => (i._id === a.id ? { ...i, ...undoTouchPatch(i, a) } : i)))
  const recent = store.getQuery(api.activities.recent, {})
  if (recent) store.setQuery(api.activities.recent, {}, recent.filter((x) => x._id !== a.activityId))
  const theirs = store.getQuery(api.activities.forInvestor, { investorId: a.id })
  if (theirs) store.setQuery(api.activities.forInvestor, { investorId: a.id }, theirs.filter((x) => x._id !== a.activityId))
}

/** One stage on (the drawer's Move button), with its next step. */
export function showAdvance(store: OptimisticLocalStore, a: { id: Id<'investors'>; next?: { step: string; date?: string | null } }, today = todayIST()) {
  const list = store.getQuery(api.investors.list, {})
  if (!list) return
  store.setQuery(api.investors.list, {}, list.map((i) => {
    const nx = i._id === a.id ? applyAdvance(i, today) : null
    if (!nx) return i
    return { ...i, stage: nx.stage, lastTouch: nx.lastTouch, ...(nx.raiseMax ? { maxStage: nx.stage } : {}), ...(a.next ? { nextStep: a.next.step.trim(), nextDate: a.next.date ?? undefined } : {}) }
  }))
}
