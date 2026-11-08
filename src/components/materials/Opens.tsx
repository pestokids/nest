// PST-282: first opens of a link, for whoever made it with "Notify me on the
// first open": a toast while Nest is open (PST-297: and an Opened row in the Inbox).
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { useRaise } from '../data'
import { useToast } from '../ui'
import { useMaterials } from './data'
import { useIndex, versionName } from './parts'

/** A toast for each first open that arrives while Nest is open (no sound: nobody clicked). */
export function OpenToasts() {
  const m = useMaterials()
  const d = useRaise()
  const toast = useToast()
  const navigate = useNavigate()
  const path = useRouterState({ select: (s) => s.location.pathname })
  const ix = useIndex()
  const known = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!m.loaded || !d.loaded) return
    if (!known.current) {
      known.current = new Set(m.notices.map((n) => n.linkId))
      return
    }
    const fresh = m.notices.filter((n) => !known.current!.has(n.linkId))
    for (const n of fresh) known.current.add(n.linkId)
    const n = fresh[fresh.length - 1]
    const i = n && d.investors.find((x) => x._id === n.investorId)
    const l = n && m.links.find((x) => x._id === n.linkId)
    if (!n || !i || !l) return
    toast({
      tone: 'info',
      icon: 'note',
      message: `${i.name} just opened ${versionName(ix.mat.get(l.materialId), ix.shown(l))}.`,
      durationMs: 6000,
      action: {
        label: 'View',
        onClick: () => {
          void m.act.seen([n.linkId])
          const inRaise = path.startsWith('/raise/')
          void navigate({ to: inRaise ? path : '/raise/today', search: inRaise ? true : undefined, state: (s) => ({ ...s, drawer: { id: i._id, opts: { tab: 'materials' } } }) })
        },
      },
    })
  }, [m.notices, m.loaded, d.loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
