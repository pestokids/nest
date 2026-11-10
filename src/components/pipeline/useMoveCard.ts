// One way to move a card, shared by drag and drop, the [ and ] keys and the
// phone swipe (PST-290: and the drawer's M and N keys and ⌘K): sounds, confetti
// on a win, the save, and a toast with Undo. Uses the app-wide toast, so ⌘K can too.
import { useCallback } from 'react'
import { classifyMove, moveSound, moveToast, type Move, type MoveRecord } from '../../lib/board'
import { noteOwnMove } from '../../lib/ownMove' // PST-298
import { confetti, MOTION } from '../../lib/motion'
import { isBackward, type Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { STAGE_TILE, type Stage } from '../../lib/stages'
import { errorMessage, useRaise } from '../data'
import { useToast } from '../ui'
import { confirmAction } from '../close/openKit'

export function useMoveCard() {
  const { move, undoMove, markCorrection } = useRaise()
  const toast = useToast()
  return useCallback(
    (inv: Investor, to: Stage, opts: { from?: Element | null; swipe?: boolean } = {}): Move => {
      const m = classifyMove(inv.stage, to)
      const sound = opts.swipe && !m.win ? 'swipe' : moveSound(m)
      if (sound) play(sound)
      if (m.kind === 'same') return m
      if (m.win) confetti(opts.from)
      noteOwnMove(inv._id, to)
      // The board updates at once (optimistic); Undo waits for the save it undoes.
      const saved: Promise<MoveRecord> = move(inv._id, to)
      saved.catch((e) => {
        play('save-failed')
        toast({ tone: 'error', message: errorMessage(e) })
      })
      const message = moveToast(inv.name, to, m)
      let undone = false
      // PST-302: a move back can be marked as a correction (the furthest stage goes back too, and stats leave it out).
      const correction = isBackward(inv.stage, to)
        ? {
            label: 'Mark as a correction',
            onClick: () => {
              play('toggle-on')
              saved
                .then((rec) => (rec.activityId ? markCorrection(rec.activityId, true) : null))
                .then(() => toast({ tone: 'info', message: `Marked as a correction. ${inv.name} never got past ${STAGE_TILE[to]}.` }))
                .catch((e) => {
                  play('save-failed')
                  toast({ tone: 'error', message: errorMessage(e) })
                })
            },
          }
        : undefined
      if (message)
        toast({
          secondary: correction,
          tone: m.win ? 'win' : m.kind === 'skip' ? 'info' : 'success',
          icon: m.kind === 'skip' ? 'alert' : undefined,
          message,
          action: {
            label: 'Undo',
            onClick: () => {
              undone = true
              play('undo')
              saved
                .then((rec) => undoMove(rec))
                .catch((e) => {
                  play('save-failed')
                  toast({ tone: 'error', message: errorMessage(e) })
                })
            },
          },
        })
      // PST-291: a verbal yes gets the Close kit's written confirmation offered, once the Undo toast has had its time.
      if (to === 'verbal' && m.kind !== 'back')
        setTimeout(() => {
          if (!undone) toast({ tone: 'info', message: `Confirm ${inv.name} in writing today.`, action: confirmAction(inv._id) })
        }, MOTION.toast.holdMs)
      return m
    },
    [move, undoMove, markCorrection, toast],
  )
}
