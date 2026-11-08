// PST-290: instant changes. Stage moves, passing, parking and logging a touch
// show at once (Convex optimistic updates), save behind, and the toast offers
// Undo instead of a confirm dialog. Permanent deletes keep their confirmation.
import { useMemo } from 'react'
import { formatDay, todayIST } from '../../lib/dates'
import type { Investor, TouchOptions } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { ASK_NOTE, askFollowUp } from '../../lib/today'
import { errorMessage, useRaise } from '../data'
import { useMoveCard } from '../pipeline/useMoveCard'
import { useToast } from '../ui'

const first = (name: string) => name.trim().split(/\s+/)[0] || name

export function useInstant() {
  const d = useRaise()
  const toast = useToast()
  const moveCard = useMoveCard()
  return useMemo(() => {
    const failed = (e: unknown) => {
      play('save-failed')
      toast({ tone: 'error', message: errorMessage(e) })
    }
    /** Undo waits for the save it undoes. */
    const undo = <R,>(saved: Promise<R>, back: (r: R) => Promise<unknown>) => ({
      label: 'Undo',
      onClick: () => {
        play('undo')
        saved.then(back).catch((e) => {
          play('nope')
          toast({ tone: 'error', message: errorMessage(e) })
        })
      },
    })
    const logTouch = (inv: Investor, note: string, opts: TouchOptions, message: string) => {
      const saved = d.logTouch(inv._id, note, opts)
      saved.catch(failed)
      toast({ message, action: undo(saved, d.undoTouch) })
    }
    return {
      /** Any stage, with the board's sounds and toast (src/components/pipeline/useMoveCard.ts). */
      move: moveCard,
      pass: (inv: Investor, from?: Element | null) => moveCard(inv, 'passed', { from }),
      /** Park until a day (null: no day). */
      park: (inv: Investor, until: string | null) => {
        play('park')
        const saved = d.move(inv._id, 'parked', { parkedUntil: until })
        saved.catch(failed)
        toast({
          message: until ? `Parked until ${formatDay(until)}. ${first(inv.name)} comes back to Due today then.` : `${inv.name} is parked.`,
          action: undo(saved, d.undoMove),
        })
      },
      logTouch,
      /** Ask for a number: Today's ask, with its follow-up. */
      ask: (inv: Investor) => {
        const next = askFollowUp(todayIST())
        play('ask-logged')
        logTouch(inv, ASK_NOTE, { touch: 'ask', next }, `Ask logged for ${inv.name}. Follow-up set for ${formatDay(next.date)}.`)
      },
    }
  }, [d, toast, moveCard])
}
