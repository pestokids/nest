// PST-293: when Nest changes a status by itself from an email or notes, say so
// with Undo. Only for signals that arrive while the app is open; the drawer's
// decision and History keep the "Auto" mark and Undo for the rest.
import { useEffect, useRef } from 'react'
import { STATUS_PHRASE } from '../../lib/decisions'
import { play } from '../../lib/sound'
import { errorMessage, useRaise } from '../data'
import { useUI } from '../raise-ui'
import { useDecisions } from './data'

export function SignalToasts() {
  const x = useDecisions()
  const { investors } = useRaise()
  const ui = useUI()
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!x.loaded) return
    if (!seen.current) {
      seen.current = new Set(x.signals.map((s) => s._id))
      return
    }
    for (const s of x.signals) {
      if (seen.current.has(s._id)) continue
      seen.current.add(s._id)
      const inv = investors.find((i) => i._id === s.investorId)
      if (s.outcome !== 'auto' || s.undoneAt || !s.change || !inv) continue
      const to = s.change.to
      ui.toast({
        icon: 'spark',
        message: inv.name + ' is ' + STATUS_PHRASE[to] + ' now' + (s.change.reason ? ' (' + s.change.reason + ')' : '') + ', from ' + (s.source === 'email' ? 'their email' : 'your notes') + '.',
        durationMs: 8000,
        action: {
          label: 'Undo',
          onClick: () => {
            play('undo')
            x.undoSignal(s._id).catch((e) => {
              play('nope')
              ui.toast({ tone: 'error', message: errorMessage(e) })
            })
          },
        },
      })
    }
  }, [x, investors, ui])
  return null
}
