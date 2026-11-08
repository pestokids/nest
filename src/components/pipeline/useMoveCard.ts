// One way to move a card, shared by drag and drop, the [ and ] keys and the
// phone swipe (PST-290: and the drawer's M and N keys and ⌘K): sounds, confetti
// on a win, the save, and a toast with Undo. Uses the app-wide toast, so ⌘K can too.
import { useCallback } from 'react'
import { classifyMove, moveSounds, moveToast, type Move, type MoveRecord } from '../../lib/board'
import { confetti } from '../../lib/motion'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import type { Stage } from '../../lib/stages'
import { errorMessage, useRaise } from '../data'
import { useToast } from '../ui'
import { confirmAction } from '../close/openKit'

export function useMoveCard() {
  const { move, undoMove } = useRaise()
  const toast = useToast()
  return useCallback(
    (inv: Investor, to: Stage, opts: { from?: Element | null } = {}): Move => {
      const m = classifyMove(inv.stage, to)
      for (const c of moveSounds(m)) play(c.name, c.opts)
      if (m.kind === 'same') return m
      if (m.win) confetti(opts.from)
      // The board updates at once (optimistic); Undo waits for the save it undoes.
      const saved: Promise<MoveRecord> = move(inv._id, to)
      saved.catch((e) => {
        play('save-failed')
        toast({ tone: 'error', message: errorMessage(e) })
      })
      const message = moveToast(inv.name, to, m)
      if (message)
        toast({
          tone: m.win ? 'win' : m.kind === 'skip' ? 'info' : 'success',
          icon: m.kind === 'skip' ? 'alert' : undefined,
          message,
          action: {
            label: 'Undo',
            onClick: () => {
              play('undo')
              saved
                .then((rec) => undoMove(rec))
                .catch((e) => {
                  play('nope')
                  toast({ tone: 'error', message: errorMessage(e) })
                })
            },
          },
        })
      // PST-291: a verbal yes gets the Close kit's written confirmation offered.
      if (to === 'verbal' && m.kind !== 'back') toast({ tone: 'info', message: `Confirm ${inv.name} in writing today.`, action: confirmAction(inv._id) })
      return m
    },
    [move, undoMove, toast],
  )
}
