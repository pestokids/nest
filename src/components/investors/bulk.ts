// PST-298: Investors' bulk bar. Move to stage and Set wave show on every picked
// row at once (each save is optimistic, and they go together, not one by one);
// the toast's Undo puts them back. Delete keeps its confirmation: it's for good.
import type { MoveRecord } from '../../lib/board'
import { fieldsOf, type Investor } from '../../lib/pipeline'
import type { Stage, Wave } from '../../lib/stages'
import type { RaiseData } from '../data'

export type BulkChange = { stage: Stage } | { wave: Wave }

/**
 * Start the saves for the rows the change touches. `saved` resolves with the
 * first failure (undefined when every save went through); `undo` waits for the
 * saves and puts back the ones that went through.
 */
export function bulkChange(d: Pick<RaiseData, 'move' | 'undoMove' | 'save'>, picked: Investor[], change: BulkChange) {
  if ('stage' in change) {
    const moves = Promise.allSettled(picked.filter((i) => i.stage !== change.stage).map((i) => d.move(i._id, change.stage)))
    return {
      saved: moves.then((rs) => rs.find((r) => r.status === 'rejected')?.reason),
      undo: () => moves.then((rs) => Promise.all(rs.flatMap((r) => (r.status === 'fulfilled' ? [d.undoMove(r.value as MoveRecord)] : [])))),
    }
  }
  const rows = picked.filter((i) => i.wave !== change.wave)
  const saves = Promise.allSettled(rows.map((i) => d.save(i._id, { ...fieldsOf(i), wave: change.wave })))
  return {
    saved: saves.then((rs) => rs.find((r) => r.status === 'rejected')?.reason),
    undo: () => saves.then((rs) => Promise.all(rows.flatMap((i, k) => (rs[k].status === 'fulfilled' ? [d.save(i._id, fieldsOf(i))] : [])))),
  }
}
