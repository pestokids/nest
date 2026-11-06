import { TYPES } from '../../lib/stages'
import type { BoardFilter } from '../../lib/board'
import { Icon, Kbd, Toggle } from '../ui'

/** Search, Wave and Type filters, "Show passed and parked", and the count. */
export function Toolbar({ filter, setFilter, waves, showClosed, setShowClosed, count, total }: {
  filter: BoardFilter
  setFilter: (f: BoardFilter) => void
  waves: string[]
  showClosed: boolean
  setShowClosed: (on: boolean) => void
  count: number
  total: number
}) {
  const filtered = !!(filter.q.trim() || filter.wave || filter.type)
  return (
    <div className="pb-toolbar">
      <label className="pb-search">
        <Icon name="search" size={18} />
        <input
          type="search"
          placeholder="Search investors, notes…"
          aria-label="Search investors and notes"
          value={filter.q}
          onChange={(e) => setFilter({ ...filter, q: e.target.value })}
          onKeyDown={(e) => e.key === 'Escape' && filter.q && (e.stopPropagation(), setFilter({ ...filter, q: '' }))}
        />
        <Kbd aria-hidden="true">⌘K</Kbd>
      </label>
      <span className="pb-select">
        <select aria-label="Wave" value={filter.wave ?? ''} onChange={(e) => setFilter({ ...filter, wave: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Wave: All</option>
          {[1, 2, 3].map((w) => (
            <option key={w} value={w}>
              Wave: {waves[w - 1] || w}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} strokeWidth={2.2} />
      </span>
      <span className="pb-select">
        <select aria-label="Type" value={filter.type ?? ''} onChange={(e) => setFilter({ ...filter, type: e.target.value || null })}>
          <option value="">Type: All</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              Type: {t}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} strokeWidth={2.2} />
      </span>
      <Toggle className="pb-toggle" label="Show passed and parked" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
      <span className="pb-toolbar__sp" />
      <p className="pb-toolbar__count">
        {filtered ? `${count} of ${total}` : total} investor{total === 1 ? '' : 's'} · drag a card when its rule is true
      </p>
    </div>
  )
}
