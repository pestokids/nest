// PST-282: first opens of a link, for whoever made it with "Notify me on the
// first open": a row on Today (like Waiting on you) and a toast while Nest is open.
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo, useRef } from 'react'
import { duration, whenOf } from '../../lib/materials'
import { useRaise } from '../data'
import { openOnKey, useUI } from '../raise-ui'
import { Badge, Card, Icon, useToast } from '../ui'
import { useMaterials } from './data'
import { useIndex, versionName } from './parts'

/** Today's "Opened your link" card; nothing when there's nothing new. */
export function MaterialOpens() {
  const m = useMaterials()
  const d = useRaise()
  const ui = useUI()
  const ix = useIndex()
  const byId = useMemo(() => new Map(d.investors.map((i) => [i._id, i])), [d.investors])
  const rows = m.notices.filter((n) => byId.has(n.investorId)).sort((a, b) => b.at - a.at)
  if (!rows.length) return null
  const now = Date.now()
  const view = (investorId: string, linkId: string) => {
    void m.act.seen([linkId])
    ui.open(investorId, { tab: 'materials' })
  }
  return (
    <Card riseIndex={6} className="gcard mopens" aria-labelledby="mopens-title">
      <header className="gcard__head">
        <h2 id="mopens-title" className="today__h2 gcard__title">
          <Icon name="note" size={20} />
          Opened your link
          <Badge className="list-panel__badge" aria-label={`${rows.length} new`}>
            {rows.length}
          </Badge>
        </h2>
        <span className="gcard__from eyebrow-mono">From Materials</span>
      </header>
      <ul className="gwait__list">
        {rows.map((n) => {
          const l = m.links.find((x) => x._id === n.linkId)
          const s = l ? ix.stat(l) : undefined
          const what = l ? versionName(ix.mat.get(l.materialId), ix.shown(l)) : 'a document'
          const name = byId.get(n.investorId)!.name
          return (
            <li key={n.linkId} className="gwait mopens__row">
              <div className="gwait__main" role="button" tabIndex={0} onClick={() => view(n.investorId, n.linkId)} onKeyDown={openOnKey(() => view(n.investorId, n.linkId))} aria-label={`${name} opened ${what}. Open`}>
                <span className="gwait__top">
                  <span className="gwait__name">{name}</span>
                  <span className="mopens__when">{whenOf(n.at, now)}</span>
                </span>
                <span className="gwait__sub">
                  Opened {what}
                  {s?.totalMs ? ` · ${duration(s.totalMs)}` : ''}
                </span>
              </div>
              <button type="button" className="mopens__x" aria-label={`Seen: ${name}`} onClick={() => void m.act.seen([n.linkId])}>
                <Icon name="close" size={16} />
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

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
