import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRaise } from '../../components/data'
import { Drawer } from '../../components/Drawer'
import { UIContext, useAdvance } from '../../components/raise-ui'
import { Button, buttonClass, Icon, SubTabs, useToast, type TabItem } from '../../components/ui'

const TABS: TabItem[] = [
  { to: '/raise/today', label: 'Today' },
  { to: '/raise/pipeline', label: 'Pipeline' },
  { to: '/raise/investors', label: 'Investors' },
  { to: '/raise/plan', label: 'Plan' },
  { to: '/raise/settings', label: 'Settings' },
]

export const Route = createFileRoute('/_app/raise')({ component: RaiseLayout })

/** Raise header (eyebrow, title, Import CSV, Add investor), sub-tabs, the active view and the drawer. */
function RaiseLayout() {
  const d = useRaise()
  const toast = useToast()
  const advance = useAdvance(toast)
  const [drawer, setDrawer] = useState<{ id: string | null } | null>(null)
  const open = useCallback((id: string | null) => setDrawer({ id }), [])
  const ui = useMemo(() => ({ toast, open, advance }), [toast, open, advance])

  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (d.loaded) return
    const t = setTimeout(() => setSlow(true), 10000)
    return () => clearTimeout(t)
  }, [d.loaded])

  const status = !d.loaded
    ? slow
      ? 'Still waiting for the tracker’s data. It may be out of reach right now; this view will fill in when it connects.'
      : 'Connecting to the tracker’s data…'
    : d.investors.length
      ? ''
      : 'No investors yet. Add the first one with Add investor, or import a CSV.'
  const eyebrow = ['Pre-seed', d.round.instrument, d.loaded ? `${d.investors.length} investor${d.investors.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')

  return (
    <UIContext.Provider value={ui}>
      <div className="page raise">
        <header className="raise-head">
          <div className="raise-head__title">
            <div className="eyebrow-mono">{eyebrow}</div>
            <h1>Raise</h1>
          </div>
          <div className="raise-head__actions">
            <Link to="/raise/investors" search={{ import: true }} className={buttonClass({ variant: 'secondary' })}>
              Import CSV
            </Link>
            <Button variant="primary" icon="plus" onClick={() => open(null)}>
              Add investor
            </Button>
          </div>
        </header>
        <SubTabs items={TABS} label="Raise views" />
        {status ? <div className="notice">{status}</div> : null}
        <div className="raise-view">{d.loaded ? <Outlet /> : null}</div>
      </div>
      <button type="button" className="fab" aria-label="Add investor" onClick={() => open(null)}>
        <Icon name="plus" size={26} strokeWidth={2.2} />
      </button>
      {drawer ? <Drawer key={drawer.id ?? 'new'} id={drawer.id} onClose={() => setDrawer(null)} /> : null}
    </UIContext.Provider>
  )
}
