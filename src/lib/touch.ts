// PST-290: logging a touch shows on screen at once and saves behind it, with
// Undo. What a touch writes on the investor, and what Undo puts back, shared by
// the Convex mutations, their optimistic updates and the preview. Pure.
import { isISODate } from './dates'
import { touchDay, type Investor, type TouchOptions } from './pipeline'

export type TouchFields = Pick<Investor, 'lastTouch' | 'nextStep' | 'nextDate'>
/** Enough to undo one logged touch: the activity it wrote, and the fields before and after. */
export type TouchRecord = { id: string; activityId: string; day: string; set: TouchFields; from: TouchFields }

/** What logging a touch writes: lastTouch moves forward to its day (never into the future), and `next` replaces the next step. */
export function applyTouch(i: TouchFields, o: TouchOptions | undefined, today: string): { day: string; patch: TouchFields } {
  const day = touchDay(o?.date, today)
  const next = o?.next
  return {
    day,
    patch: {
      lastTouch: !i.lastTouch || i.lastTouch < day ? day : i.lastTouch,
      nextStep: next ? next.step.trim() : i.nextStep,
      nextDate: next ? (next.date && isISODate(next.date) ? next.date : undefined) : i.nextDate,
    },
  }
}

/** Undo a touch: each field goes back to what it was, unless it has changed again since. */
export function undoTouchPatch(cur: TouchFields, rec: Pick<TouchRecord, 'set' | 'from'>): TouchFields {
  const back = <K extends keyof TouchFields>(k: K): TouchFields[K] => (cur[k] === rec.set[k] ? rec.from[k] : cur[k])
  return { lastTouch: back('lastTouch'), nextStep: back('nextStep'), nextDate: back('nextDate') }
}
