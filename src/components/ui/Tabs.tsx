import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'

export type TabItem = { to: string; label: string; live?: boolean; soon?: boolean; exact?: boolean }

/** Top bar section tabs: forest pill when active, "soon" tabs are muted and not links. */
export function Tabs({ items, label }: { items: TabItem[]; label: string }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((t) =>
        t.soon ? (
          <span key={t.label} className="tab tab--soon" aria-disabled="true" title={`${t.label}: coming soon`}>
            {t.label}
            <span className="sr-only"> (coming soon)</span>
          </span>
        ) : (
          <Link key={t.to} to={t.to} className="tab" activeProps={{ className: 'tab tab--active', 'aria-current': 'page' }} activeOptions={{ exact: t.exact, includeSearch: false }}>
            {t.label}
            {t.live ? <span className="tab__live m-live-dot" aria-hidden="true" /> : null}
          </Link>
        ),
      )}
    </nav>
  )
}

/** Underlined sub-tabs (Raise: Today, Pipeline…). Scrolls sideways on phones. */
export function SubTabs({ items, label, children }: { items: TabItem[]; label: string; children?: ReactNode }) {
  return (
    <nav className="subtabs" aria-label={label}>
      <div className="subtabs__list">
        {items.map((t) => (
          <Link key={t.to} to={t.to} className="subtab" activeProps={{ className: 'subtab subtab--active', 'aria-current': 'page' }} activeOptions={{ includeSearch: false }}>
            {t.label}
          </Link>
        ))}
      </div>
      {children}
    </nav>
  )
}

/** The same underlined tabs switching panels in place (the drawer's Details and History). */
export function SubTabButtons<T extends string>({ items, value, onChange, label, idPrefix }: { items: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; idPrefix: string }) {
  return (
    <div className="subtabs" role="tablist" aria-label={label}>
      <div className="subtabs__list">
        {items.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.value}`}
            aria-selected={t.value === value}
            aria-controls={`${idPrefix}-panel`}
            className={`subtab${t.value === value ? ' subtab--active' : ''}`}
            onClick={() => onChange(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  )
}
