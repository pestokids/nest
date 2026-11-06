import { useState } from 'react'
import { openCommandPalette } from '../../lib/commandPalette'
import { ALL, GEOS, STAGE_TILE, TIERS, TYPES, WARM, type Geo, type InvestorType, type Stage, type Tier, type Warmth } from '../../lib/stages'
import { Button, Icon, Kbd } from '../ui'
import { Modal, useTitleId } from '../system/Modal'

export type InvestorFilters = {
  q?: string
  stage?: 'live' | Stage
  warmth?: Warmth
  type?: InvestorType
  geo?: Geo
  tier?: Tier
  wave?: 1 | 2 | 3
}
type Set = (patch: Partial<InvestorFilters>) => void

const stageText = (v: InvestorFilters['stage']) => (v === 'live' ? 'Live' : v ? STAGE_TILE[v] : 'All')

function Selects({ s, set }: { s: InvestorFilters; set: Set }) {
  return (
    <>
      <span className={`select inv-select${s.stage ? ' is-on' : ''}`}>
        <select aria-label="Stage" value={s.stage ?? ''} onChange={(e) => set({ stage: (e.target.value || undefined) as InvestorFilters['stage'] })}>
          <option value="">Stage: All</option>
          <option value="live">Stage: Live conversations</option>
          {ALL.map((x) => (
            <option key={x.k} value={x.k}>
              Stage: {STAGE_TILE[x.k]}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} className="select__chevron" />
      </span>
      <span className={`select inv-select${s.type ? ' is-on' : ''}`}>
        <select aria-label="Type" value={s.type ?? ''} onChange={(e) => set({ type: (e.target.value || undefined) as InvestorType })}>
          <option value="">Type: All</option>
          {TYPES.map((x) => (
            <option key={x} value={x}>
              Type: {x}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} className="select__chevron" />
      </span>
      <span className={`select inv-select${s.wave ? ' is-on' : ''}`}>
        <select aria-label="Wave" value={s.wave ?? ''} onChange={(e) => set({ wave: e.target.value ? (Number(e.target.value) as 1 | 2 | 3) : undefined })}>
          <option value="">Wave: All</option>
          {[1, 2, 3].map((w) => (
            <option key={w} value={w}>
              Wave: W{w}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} className="select__chevron" />
      </span>
    </>
  )
}

/** Search, Stage/Type/Wave, the count and Export (raise-investors/*.png). Phones: search + a Filters sheet. */
export function FilterBar({ s, set, count, onExport, exportLabel, active, onClear, resultCount }: {
  s: InvestorFilters
  set: Set
  count: string
  onExport: () => void
  exportLabel: string
  active: boolean
  onClear: () => void
  resultCount: number
}) {
  const [sheet, setSheet] = useState(false)
  const titleId = useTitleId()
  const n = [s.stage, s.type, s.wave, s.warmth, s.geo, s.tier].filter(Boolean).length
  return (
    <div className="inv-bar">
      <label className="inv-search">
        <Icon name="search" size={18} className="inv-search__icon" />
        <input type="search" placeholder="Search investors, notes…" aria-label="Search investors" value={s.q ?? ''} onChange={(e) => set({ q: e.target.value || undefined })} />
        <button type="button" className="inv-search__kbd" onClick={() => openCommandPalette(s.q)} aria-label="Search everything (⌘K)" tabIndex={-1}>
          <Kbd>⌘K</Kbd>
        </button>
      </label>
      <div className="inv-bar__selects">
        <Selects s={s} set={set} />
      </div>
      <button type="button" className={`inv-filters-btn${n ? ' is-on' : ''}`} onClick={() => setSheet(true)} aria-haspopup="dialog">
        <Icon name="filter" size={18} />
        Filters{n ? <span className="inv-filters-btn__n">{n}</span> : null}
      </button>
      <span className="inv-bar__sp" />
      <span className="inv-bar__count" aria-live="polite">
        {count}
      </span>
      <Button variant="secondary" className="inv-bar__export" icon="download" onClick={onExport}>
        {exportLabel}
      </Button>
      {sheet ? (
        <Modal onClose={() => setSheet(false)} labelledBy={titleId} variant="menu" className="inv-sheet">
          <h2 className="sys-sheet__title" id={titleId}>
            Filters
          </h2>
          <div className="inv-sheet__selects">
            <Selects s={s} set={set} />
          </div>
          <div className="inv-sheet__actions">
            {active ? (
              <Button variant="ghost" onClick={onClear}>
                Clear all
              </Button>
            ) : null}
            <Button variant="primary" block onClick={() => setSheet(false)}>
              Show {resultCount} investor{resultCount === 1 ? '' : 's'}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

/** "Stage: Asked ×  Clear all" under the bar; each chip pops in when applied. */
export function FilterChips({ s, set, onClear, only, clearOnly }: { s: InvestorFilters; set: Set; onClear: () => void; only: number; clearOnly: () => void }) {
  const chips: { k: string; label: string; clear: () => void }[] = []
  if (only) chips.push({ k: 'only', label: `Just imported: ${only}`, clear: clearOnly })
  if (s.stage) chips.push({ k: 'stage', label: `Stage: ${stageText(s.stage)}`, clear: () => set({ stage: undefined }) })
  if (s.type) chips.push({ k: 'type', label: `Type: ${s.type}`, clear: () => set({ type: undefined }) })
  if (s.wave) chips.push({ k: 'wave', label: `Wave: W${s.wave}`, clear: () => set({ wave: undefined }) })
  if (s.warmth) chips.push({ k: 'warmth', label: WARM[s.warmth], clear: () => set({ warmth: undefined }) })
  if (s.geo && (GEOS as readonly string[]).includes(s.geo)) chips.push({ k: 'geo', label: `Geo: ${s.geo}`, clear: () => set({ geo: undefined }) })
  if (s.tier && (TIERS as readonly string[]).includes(s.tier)) chips.push({ k: 'tier', label: `Tier ${s.tier}`, clear: () => set({ tier: undefined }) })
  if (!chips.length) return null
  return (
    <div className="inv-chips">
      {chips.map((c) => (
        <span key={c.k + c.label} className="inv-chip">
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
