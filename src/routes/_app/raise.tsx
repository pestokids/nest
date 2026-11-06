import { createFileRoute, Link, Outlet } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RaiseContext, useRaise, type RaiseData } from '../../components/data'
import { Drawer, type DrawerStart } from '../../components/Drawer'
import { usePreviewState } from '../../components/preview-state'
import { UIContext, useAdvance, useFail, type OpenOptions, type UI } from '../../components/raise-ui'
import { Button, buttonClass, Icon, SubTabs, useToast, type TabItem } from '../../components/ui'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'

const TABS: TabItem[] = [
  { to: '/raise/today', label: 'Today' },
  { to: '/raise/pipeline', label: 'Pipeline' },
  { to: '/raise/investors', label: 'Investors' },
  { to: '/raise/plan', label: 'Plan' },
  { to: '/raise/settings', label: 'Settings' },
]
/** How long Undo is offered before a delete is sent. */
const UNDO_MS = 6000

export const Route = createFileRoute('/_app/raise')({ component: RaiseLayout })

const NO_OPTS: OpenOptions = {}

/** Raise header (eyebrow, title, Import CSV, Add investor), sub-tabs, the active view and the drawer. */
function RaiseLayout() {
  const raw = useRaise()
  const toast = useToast()
  const fail = useFail(toast)
  const preview = usePreviewState()
  const [drawer, setDrawer] = useState<{ id: string | null; opts: OpenOptions; start?: DrawerStart } | null>(null)
  const opener = useRef<HTMLElement | null>(null)

  const open = useCallback((id: string | null, opts: OpenOptions = {}) => {
    opener.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    play('drawer', { volume: 0.5 })
    setDrawer({ id, opts })
  }, [])
  const opening = drawer?.opts ?? NO_OPTS
  const close = useCallback(() => {
    setDrawer(null)
    const el = opener.current
    opener.current = null
    if (el?.isConnected) requestAnimationFrame(() => el.focus({ preventScroll: true }))
  }, [])

  // Preview: open the drawer in the asked-for state (no sound on load).
  useEffect(() => {
    if (!preview?.drawer || !raw.loaded) return
    const pick = raw.investors.find((i) => i.stage === 'booked') ?? raw.investors[0]
    if (preview.drawer === 'new') setDrawer({ id: null, opts: NO_OPTS })
    else if (pick) setDrawer({ id: pick._id, opts: NO_OPTS, start: preview.drawer })
  }, [preview?.drawer, raw.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // Delete with Undo: hide the row now, send the delete when the toast goes
  // (or straight away if the Raise views unmount or the page is closing).
  const [hidden, setHidden] = useState<Set<string>>(() => new Set())
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const removeNow = raw.remove
  const commit = useCallback(
    (id: string) => {
      const t = pending.current.get(id)
      if (t === undefined) return
      clearTimeout(t)
      pending.current.delete(id)
      void removeNow(id)
        .catch(fail)
        .finally(() => setHidden((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : s)))
    },
    [removeNow, fail],
  )
  useEffect(() => {
    const flush = () => [...pending.current.keys()].forEach(commit)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [commit])
  const remove = useCallback(
    (i: Investor) => {
      setHidden((s) => new Set(s).add(i._id))
      pending.current.set(i._id, setTimeout(() => commit(i._id), UNDO_MS))
      toast({
        tone: 'info',
        icon: 'trash',
        message: `Deleted ${i.name}.`,
        durationMs: UNDO_MS - 200,
        action: {
          label: 'Undo',
          onClick: () => {
            const t = pending.current.get(i._id)
            if (t === undefined) return
            clearTimeout(t)
            pending.current.delete(i._id)
            setHidden((s) => new Set([...s].filter((x) => x !== i._id)))
            play('undo')
          },
        },
      })
    },
    [commit, toast],
  )

  const d = useMemo<RaiseData>(
    () => (hidden.size ? { ...raw, investors: raw.investors.filter((i) => !hidden.has(i._id)), acts: raw.acts.filter((a) => !hidden.has(a.investorId)) } : raw),
    [raw, hidden],
  )
  const advanceRaw = useAdvance(toast, fail)
  const ui = useMemo<UI>(() => ({ toast, open, opening, advance: advanceRaw, remove, fail }), [toast, open, opening, advanceRaw, remove, fail])

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
  const count = d.loaded ? `${d.investors.length} investor${d.investors.length === 1 ? '' : 's'}` : ''

  return (
    <RaiseContext.Provider value={d}>
      <UIContext.Provider value={ui}>
        <div className="page raise">
          <header className="raise-head">
            <div className="raise-head__title">
              <div className="eyebrow-mono">
                Pre-seed
                {d.round.instrument ? <span className="raise-head__instrument"> · {d.round.instrument}</span> : null}
                {count ? ` · ${count}` : ''}
              </div>
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
        {drawer ? null : (
          <button type="button" className="fab" aria-label="Add investor" onClick={() => open(null)}>
            <Icon name="plus" size={26} strokeWidth={2.2} />
          </button>
        )}
        {drawer ? <Drawer key={drawer.id ?? `new-${drawer.opts.stage ?? ''}`} id={drawer.id} start={drawer.start} forceSheet={preview?.sheet} onClose={close} /> : null}
      </UIContext.Provider>
    </RaiseContext.Provider>
  )
}
