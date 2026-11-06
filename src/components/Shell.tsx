import { Link, Outlet } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { shortDate, todayIST } from '../lib/dates'
import { money } from '../lib/money'
import { totals } from '../lib/pipeline'
import { useRaise } from './data'
import { Drawer } from './Drawer'
import { UIContext, useAdvance, useToast } from './ui'

const TABS = [
  { to: '/raise/today', l: 'Today' },
  { to: '/raise/pipeline', l: 'Pipeline' },
  { to: '/raise/investors', l: 'Investors' },
  { to: '/raise/plan', l: 'Plan' },
  { to: '/raise/settings', l: 'Settings' },
] as const

/** Round band, tab bar, status notice, the active view, drawer and toast. */
export function Shell() {
  const d = useRaise()
  const { toast, node: toastNode } = useToast()
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

  const today = todayIST()
  const r = d.round
  const t = totals(d.investors, r, today)
  const status = !d.loaded
    ? slow
      ? 'Still waiting for the tracker’s data. It may be out of reach right now; this view will fill in when it connects.'
      : 'Connecting to the tracker’s data…'
    : d.investors.length
      ? ''
      : 'No investors yet. Add the first one with + Add investor.'
  const terms = [r.instrument, r.cap ? `${money(r.cap)} cap` : '', r.minCheck ? `${money(r.minCheck)} minimum check` : ''].filter(Boolean)

  return (
    <UIContext.Provider value={ui}>
      <div className="wrap">
        <section className="band">
          <div>
            <div className="eyebrow">Pesto · pre-seed · {terms.join(' · ')}</div>
            <h1>Pre-seed round</h1>
            <div className="sub">
              {d.loaded
                ? `${t.daysLeft >= 0 ? t.daysLeft + ' days to close' : 'Close date passed'} (${shortDate(r.deadline)}) · raising ${money(r.target)}, room to ${money(r.stretch)} · ${d.investors.length} investors tracked`
                : 'Loading the round…'}
            </div>
          </div>
          <div className="raised" aria-live="polite">
            <div className="fig">
              <span className="big num">{d.loaded ? money(t.committed) : '–'}</span>
              <span className="muted num">{d.loaded ? `of ${money(r.target)} target · ${money(t.weighted)} weighted pipeline` : ''}</span>
            </div>
            <div className="bar" aria-hidden="true">
              <div className="w" style={{ width: d.loaded ? `${t.weightedPct}%` : 0 }} />
              <div className="c" style={{ width: d.loaded ? `${t.committedPct}%` : 0 }} />
              <div className="t" style={{ left: `${t.targetPct}%` }} />
            </div>
            <div className="legend">
              <span>
                <i style={{ background: 'var(--lime)' }} />
                Committed (verbal + signed + in)
              </span>
              <span>
                <i style={{ background: 'repeating-linear-gradient(135deg, var(--lime) 0 3px, transparent 3px 6px)' }} />
                Weighted pipeline
              </span>
              <span>Line = {money(r.target)} target</span>
            </div>
          </div>
        </section>

        <nav className="tabs" aria-label="Views">
          {TABS.map((x) => (
            <Link key={x.to} to={x.to} activeProps={{ 'aria-current': 'page' }} activeOptions={{ includeSearch: false }}>
              {x.l}
            </Link>
          ))}
          <span className="sp" />
          <button className="btn primary small" type="button" onClick={() => open(null)}>
            + Add investor
          </button>
          <button className="btn small" type="button" onClick={d.signOut} title={`Signed in as ${d.me}`}>
            {d.me} · Sign out
          </button>
        </nav>

        <div className="notice" hidden={!status}>
          {status}
        </div>

        {d.loaded ? <Outlet /> : null}
      </div>
      {drawer ? <Drawer key={drawer.id ?? 'new'} id={drawer.id} onClose={() => setDrawer(null)} /> : null}
      {toastNode}
    </UIContext.Provider>
  )
}
