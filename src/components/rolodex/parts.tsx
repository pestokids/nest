// Rolodex: the bits both views share. The People · Firms chips, a filter select that
// shows how many each option would leave, the filter chips under the bar, Export,
// the phone Filters sheet and paging as you scroll. Styles: rolodex.css over
// investors.css (inv-bar, inv-select, inv-chips) and introducers.css (inv-views).
import { Link } from '@tanstack/react-router'
import Papa from 'papaparse'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { todayIST } from '../../lib/dates'
import { play } from '../../lib/sound'
import { Modal, useTitleId } from '../system/Modal'
import { Button, buttonClass, Icon, type ChipTone, type ToastInput } from '../ui'

export const fmt = (n: number) => n.toLocaleString('en-US')
export const TIER_TONE: Record<string, ChipTone> = { 'Tier 1': 'live', 'Tier 2': 'neutral', 'Tier 3': 'outline' }

/** People · Firms, like Investors · Network. */
export function RolodexViews({ view, people, firms, right }: { view: 'people' | 'firms'; people: number | null; firms: number | null; right?: ReactNode }) {
  return (
    <div className="inv-views">
      <nav className="inv-views__chips" aria-label="Rolodex views">
        <Link from="/raise/rolodex" to="/raise/rolodex" search={(s) => ({ ...s, view: undefined })} className={'draft-chip' + (view === 'people' ? ' is-on' : '')} aria-current={view === 'people' ? 'page' : undefined}>
          People{people === null ? '' : ' ' + fmt(people)}
        </Link>
        <Link from="/raise/rolodex" to="/raise/rolodex" search={(s) => ({ ...s, view: 'firms' as const })} className={'draft-chip' + (view === 'firms' ? ' is-on' : '')} aria-current={view === 'firms' ? 'page' : undefined}>
          Firms{firms === null ? '' : ' ' + fmt(firms)}
        </Link>
      </nav>
      {right ? <div className="inv-views__right">{right}</div> : null}
    </div>
  )
}

export type Opt = { value: string; label: string; n?: number }

/** "Country: All" … "Country: India (2,104)". Options that would show nobody are dimmed, not hidden. */
export function Sel({ label, value, options, onChange, wide, allLabel = 'All' }: { label: string; value?: string; options: Opt[]; onChange: (v: string | undefined) => void; wide?: boolean; /** The no-filter option's word (Sort: Name). */ allLabel?: string }) {
  return (
    <span className={`select inv-select rdx-select${wide ? ' rdx-select--wide' : ''}${value && label !== 'Sort' ? ' is-on' : ''}`}>
      <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">
          {label}: {allLabel}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.n === 0 && o.value !== value}>
            {label}: {o.label}
            {o.n === undefined ? '' : ` (${fmt(o.n)})`}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={16} className="select__chevron" />
    </span>
  )
}

export type FilterChip = { k: string; label: string; clear: () => void }

/** "Country: India ×  Clear all" under the bar (investors.css inv-chips). */
export function FilterChips({ chips, onClear }: { chips: FilterChip[]; onClear: () => void }) {
  if (!chips.length) return null
  return (
    <div className="inv-chips">
      {chips.map((c) => (
        <span key={c.k} className="inv-chip">
          {c.label}
          <button type="button" onClick={c.clear} aria-label={`Remove filter ${c.label}`}>
            <Icon name="close" size={14} strokeWidth={2.4} />
          </button>
        </span>
      ))}
      <button type="button" className="inv-chips__clear" onClick={onClear}>
        Clear all
      </button>
    </div>
  )
}

/** Search, the selects (a Filters sheet on phones), the count. */
export function Bar({ q, onQ, placeholder, selects, active, count, onClear, resultLabel }: {
  q?: string
  onQ: (q: string | undefined) => void
  placeholder: string
  selects: ReactNode
  active: number
  count: string
  onClear: () => void
  resultLabel: string
}) {
  const [sheet, setSheet] = useState(false)
  const titleId = useTitleId()
  return (
    <div className="inv-bar rdx-bar">
      <label className="inv-search">
        <Icon name="search" size={18} className="inv-search__icon" />
        <input type="search" placeholder={placeholder} aria-label={placeholder} value={q ?? ''} onChange={(e) => onQ(e.target.value || undefined)} />
      </label>
      <div className="inv-bar__selects rdx-bar__selects">{selects}</div>
      <button type="button" className={`inv-filters-btn${active ? ' is-on' : ''}`} onClick={() => setSheet(true)} aria-haspopup="dialog">
        <Icon name="filter" size={18} />
        Filters{active ? <span className="inv-filters-btn__n">{active}</span> : null}
      </button>
      <span className="inv-bar__sp" />
      <span className="inv-bar__count" aria-live="polite">
        {count}
      </span>
      {sheet ? (
        <Modal onClose={() => setSheet(false)} labelledBy={titleId} variant="menu" className="inv-sheet">
          <h2 className="sys-sheet__title" id={titleId}>
            Filters
          </h2>
          <div className="inv-sheet__selects">{selects}</div>
          <div className="inv-sheet__actions">
            {active ? (
              <Button variant="ghost" onClick={onClear}>
                Clear all
              </Button>
            ) : null}
            <Button variant="primary" block onClick={() => setSheet(false)}>
              {resultLabel}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

/** Download rows as CSV with the export sound and the "Exported …" toast (like Investors' Export). */
export function exportRows(kind: 'people' | 'firms', headers: readonly string[], rows: string[][], toast: (t: ToastInput | string) => void) {
  const name = `nest-rolodex-${kind}-${todayIST()}.csv`
  const url = URL.createObjectURL(new Blob([Papa.unparse({ fields: [...headers], data: rows })], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  play('export')
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  toast({ message: `Exported ${fmt(rows.length)} ${kind === 'people' ? (rows.length === 1 ? 'person' : 'people') : rows.length === 1 ? 'firm' : 'firms'} to ${name}`, action: { label: 'Open', onClick: () => window.open(url, '_blank', 'noopener') } })
}

const PAGE = 60
/** Show 60 rows, then 60 more each time the end scrolls into view. Resets when `reset` changes. */
export function useMore(total: number, reset: unknown) {
  const [limit, setLimit] = useState(PAGE)
  useEffect(() => setLimit(PAGE), [reset])
  const sentinel = useRef<HTMLDivElement>(null)
  const more = limit < total
  useEffect(() => {
    const el = sentinel.current
    if (!el || !more || typeof IntersectionObserver !== 'function') return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setLimit((n) => n + PAGE), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more])
  return { limit, sentinel: more ? <div ref={sentinel} className="inv-more" aria-hidden="true" /> : null }
}

/** External link that looks like a secondary button. */
export function LinkButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className={buttonClass({ variant: 'secondary', className: 'rdx-linkbtn' })} href={href} target="_blank" rel="noopener noreferrer">
      <Icon name="link" size={18} />
      <span className="btn__label">{children}</span>
    </a>
  )
}
