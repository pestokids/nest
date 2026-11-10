import { useCallback } from 'react'
import { boardLabel } from '../../lib/board'
import { STEPS, type Closing, type StepKey } from '../../lib/close'
import { confetti, pop } from '../../lib/motion'
import { play } from '../../lib/sound'
import type { Stage } from '../../lib/stages'
import { useUI } from '../raise-ui'
import { useSaveAction } from '../system/useSaveAction'
import { useClose } from './CloseData'

/** The toast after a tick, untick or re-date. */
function tickMessage(name: string, key: StepKey, at: string | null, to: Stage | null): string {
  if (to === 'wired' && at) return `Money in from ${name}.`
  if (to === 'signed' && at) return `${name} signed. Moved to Signed on the pipeline.`
  if (to) return `Unticked “${STEPS[key].label}”. ${name} is back in ${boardLabel(to)}.`
  if (!at) return `Unticked “${STEPS[key].label}” for ${name}.`
  if (key === 'countersigned') return `Countersigned. ${name}’s SAFE is signed both sides.`
  return `Ticked “${STEPS[key].label}” for ${name}.`
}

/**
 * Tick, re-date or untick a step, with its moment: a signed or wired tick plays
 * "signed" then "stage-up" (the card moved on the pipeline), and the first time
 * an investor reaches Money in, confetti from the button. A plain tick is the
 * Today tick (card-pickup, higher). `undo` puts an Undo in the toast.
 */
export function useTick() {
  const c = useClose()
  const save = useSaveAction()
  const { toast } = useUI()
  const run = useCallback(
    async (closing: Pick<Closing, '_id'>, name: string, key: StepKey, at: string | null, opts: { from?: HTMLElement | null; undo?: boolean } = {}): Promise<boolean> => {
      const r = await save(() => c.tick(closing._id, key, at), { failMessage: `Couldn’t update ${name}’s SAFE.` })
      if (!r) return false
      const forward = !!at && (r.to === 'signed' || r.to === 'wired')
      if (forward) {
        play(r.to === 'wired' ? 'money-in' : 'signed')
        if (r.firstMoney) confetti(opts.from)
      } else play(at ? 'toggle-on' : 'toggle-off')
      pop(opts.from)
      toast({
        tone: r.to === 'wired' && at ? 'win' : 'success',
        message: tickMessage(name, key, at, r.to),
        ...(opts.undo && at ? { action: { label: 'Undo', onClick: () => void run(closing, name, key, null) } } : {}),
      })
      return true
    },
    [c, save, toast],
  )
  return run
}
