import { useCallback } from 'react'
import { runSave, type SaveOptions } from '../../lib/saveAction'
import { play } from '../../lib/sound'
import { errorMessage } from '../data'
import { useToast } from '../ui'

/**
 * Run any write so a failure shows the save-failed toast (with Retry) and plays
 * `save-failed`. Use it for every mutation:
 *
 *   const save = useSaveAction()
 *   await save(() => d.updateRound(draft), { failMessage: 'Couldn’t save the round.', onDone: … })
 */
export function useSaveAction() {
  const toast = useToast()
  return useCallback(
    <T,>(fn: () => Promise<T>, opts: SaveOptions<T> = {}) =>
      runSave(fn, opts, {
        toast,
        play: (n) => play(n),
        describe: (e) => {
          const m = errorMessage(e)
          // With a lead-in ("Couldn’t move X."), the generic connection text adds nothing; Retry says the rest.
          return opts.failMessage && m.startsWith('Couldn’t save') ? '' : m
        },
      }),
    [toast],
  )
}
