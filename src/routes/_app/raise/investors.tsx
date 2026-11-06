import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRaise } from '../../../components/data'
import { BulkBar } from '../../../components/investors/BulkBar'
import { FilterBar, FilterChips, type InvestorFilters } from '../../../components/investors/Filters'
import { ImportDialog, type ImportStart } from '../../../components/investors/ImportDialog'
import { InvestorList, type SortKey } from '../../../components/investors/InvestorList'
import { NoResults } from '../../../components/investors/NoResults'
import { exportInvestors } from '../../../components/investors/exportCsv'
import { useUI } from '../../../components/raise-ui'
import { usePreviewState } from '../../../components/preview-state'
import { todayIST } from '../../../lib/dates'
import { titleCase } from '../../../lib/palette'
import { isQuiet } from '../../../lib/investorView'
import type { Investor } from '../../../lib/pipeline'
import { ACTIVE, GEOS, IDX, isStage, STAGE_TILE, TIERS, TYPES, WARMTHS, type Stage } from '../../../lib/stages'

const SORT_KEYS: SortKey[] = ['name', 'type', 'stage', 'wave', 'path', 'lastTouch', 'nextStep', 'expected']

/** Filters and sort live in the URL, so a filtered view is a link. */
export type InvestorSearch = InvestorFilters & {
  sort?: SortKey
  dir?: 'asc' | 'desc'
  /** Open the CSV import (the Raise header's Import CSV links here). */
  import?: boolean
}

const oneOf = <T extends string | number>(xs: readonly T[], v: unknown): T | undefined => (xs as readonly unknown[]).includes(v) ? (v as T) : (xs as readonly unknown[]).includes(Number(v)) ? (Number(v) as T) : undefined

export const Route = createFileRoute('/_app/raise/investors')({
  validateSearch: (s: Record<string, unknown>): InvestorSearch => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    stage: s.stage === 'live' ? 'live' : isStage(s.stage) ? s.stage : undefined,
    warmth: oneOf(WARMTHS, s.warmth),
    type: oneOf(TYPES, s.type),
    geo: oneOf(GEOS, s.geo),
    tier: oneOf(TIERS, s.tier),
    wave: oneOf([1, 2, 3] as const, s.wave),
    sort: oneOf(SORT_KEYS, s.sort),
    dir: oneOf(['asc', 'desc'] as const, s.dir),
    import: s.import === true || s.import === '1' || s.import === 'true' ? true : undefined,
  }),
  component: Investors,
})

const PAGE = 50

function Investors() {
  const s = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const d = useRaise()
  const { open, toast } = useUI()
  const flags = usePreviewState()
  const today = todayIST()
  const inv = d.investors

  const setSearch = useCallback((patch: Partial<InvestorSearch>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true }), [navigate])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [only, setOnly] = useState<Set<string> | null>(null)
  const [limit, setLimit] = useState(PAGE)
  const [importStart, setImportStart] = useState<ImportStart | undefined>()

  // ?preview&investors=filtered|empty|bulk|exported|import1|import2|import3
  const previewDone = useRef(false)
  useEffect(() => {
    const p = flags?.investors
    if (!p || previewDone.current || !inv.length) return
    previewDone.current = true
    if (p === 'filtered') setSearch({ stage: 'ask' })
    else if (p === 'empty') setSearch({ q: 'nightjar' })
    else if (p === 'bulk') setSelected(new Set(inv.filter((i) => i.stage === 'intro' || i.stage === 'ask').slice(0, 2).map((i) => i._id)))
    else if (p === 'exported') exportInvestors(inv, toast, { download: false })
    else if (p.startsWith('import'))
      void import('../../../preview/fixture').then(async ({ fixtureCsv }) => {
        const { parseCsv, autoMatch, previewMapped } = await import('../../../lib/csv')
        const parsed = parseCsv(fixtureCsv())
        if (p === 'import2') setImportStart({ step: 2, file: 'investors-nov.csv', parsed, map: autoMatch(parsed.headers) })
        else if (p === 'import3') {
          const before = inv.length
          const rows = previewMapped(parsed, autoMatch(parsed.headers), inv).add.map((x) => x.fields)
          const r = await d.importMany(rows, 'investors-nov.csv')
          setImportStart({ step: 3, file: 'investors-nov.csv', result: { added: r.added, ids: r.ids ?? [], before } })
        } else setImportStart({ step: 1 })
        setSearch({ import: true })
      })
  }, [flags?.investors, inv, setSearch, toast, d])

  const q = (s.q ?? '').trim().toLowerCase()
  const rows = useMemo(() => {
    const out = inv.filter(
      (i) =>
        (!only || only.has(i._id)) &&
        (!q || [i.name, i.firm, i.path, i.notes, i.nextStep].join(' ').toLowerCase().includes(q)) &&
        (!s.stage || (s.stage === 'live' ? ACTIVE.has(i.stage) : i.stage === s.stage)) &&
        (!s.warmth || i.warmth === s.warmth) &&
        (!s.type || i.type === s.type) &&
        (!s.geo || i.geo === s.geo) &&
        (!s.tier || i.tier === s.tier) &&
        (!s.wave || i.wave === s.wave),
    )
    const key = s.sort ?? 'lastTouch'
    const dir = s.dir === 'asc' ? 1 : s.dir === 'desc' ? -1 : key === 'lastTouch' || key === 'expected' ? -1 : 1
    const closed = (i: Investor) => (i.stage === 'passed' || i.stage === 'parked' ? 1 : 0)
    const val = (i: Investor): string | number =>
      key === 'stage' ? IDX[i.stage] ?? -1 : key === 'expected' ? +(i.expected || 0) : key === 'wave' ? i.wave : key === 'lastTouch' ? i.lastTouch || '' : String(i[key] ?? '').toLowerCase()
    return out.sort((a, b) => {
      if (key === 'lastTouch' && closed(a) !== closed(b)) return closed(a) - closed(b)
      const x = val(a)
      const y = val(b)
      return (x > y ? 1 : x < y ? -1 : 0) * dir || a.name.localeCompare(b.name)
    })
  }, [inv, only, q, s.stage, s.warmth, s.type, s.geo, s.tier, s.wave, s.sort, s.dir])

  useEffect(() => setLimit(PAGE), [q, s.stage, s.type, s.wave, s.warmth, s.geo, s.tier])
  // Drop selections that no longer exist (deleted elsewhere).
  useEffect(() => {
    setSelected((sel) => {
      const ids = new Set(inv.map((i) => i._id))
      const next = new Set([...sel].filter((id) => ids.has(id)))
      return next.size === sel.size ? sel : next
    })
  }, [inv])

  const shown = rows.slice(0, limit)
  const filtered = !!(q || s.stage || s.type || s.wave || s.warmth || s.geo || s.tier || only)
  const clearAll = () => {
    setOnly(null)
    setSearch({ q: undefined, stage: undefined, type: undefined, wave: undefined, warmth: undefined, geo: undefined, tier: undefined })
  }

  const countText = selected.size ? `${selected.size} selected` : filtered ? `${rows.length} of ${inv.length}` : `${inv.length} investor${inv.length === 1 ? '' : 's'}`

  const footer = (() => {
    if (shown.length < rows.length) return `Showing ${shown.length} of ${rows.length} · scroll for more`
    if (s.stage && s.stage !== 'live' && rows.length && !q) {
      const quiet = rows.filter((i) => isQuiet(i, today, d.round.quietDays)).length
      const label = STAGE_TILE[s.stage as Stage].toLowerCase()
      return quiet
        ? `${rows.length} ${label}, ${quiet === rows.length ? (quiet === 1 ? 'gone quiet' : 'all of them quiet') : `${quiet} of them quiet`}. Nudge from the row menu, or open one to log a touch.`
        : `${rows.length} ${label}. Open one to log a touch.`
    }
    return filtered ? `Showing ${rows.length} of ${inv.length}` : `Showing all ${rows.length}`
  })()

  const sortBy = (k: SortKey) => {
    const cur = s.sort ?? 'lastTouch'
    const curDir = s.dir ?? (cur === 'lastTouch' || cur === 'expected' ? 'desc' : 'asc')
    setSearch({ sort: k, dir: cur === k ? (curDir === 'asc' ? 'desc' : 'asc') : k === 'lastTouch' || k === 'expected' ? 'desc' : 'asc' })
  }

  return (
    <section className="inv">
      <FilterBar
        s={s}
        set={setSearch}
        count={countText}
        onExport={() => exportInvestors(selected.size ? inv.filter((i) => selected.has(i._id)) : rows.length && filtered ? rows : inv, toast)}
        exportLabel={selected.size ? 'Export selected' : filtered ? 'Export these' : 'Export CSV'}
        active={filtered}
        onClear={clearAll}
        resultCount={rows.length}
      />
      <FilterChips s={s} set={setSearch} onClear={clearAll} only={only ? only.size : 0} clearOnly={() => setOnly(null)} />
      <div className={`inv-card${rows.length ? '' : ' is-empty'}`}>
        <InvestorList
          rows={shown}
          today={today}
          quietDays={d.round.quietDays}
          selected={selected}
          setSelected={setSelected}
          allIds={rows.map((i) => i._id)}
          sort={s.sort ?? 'lastTouch'}
          dir={s.dir ?? ((s.sort ?? 'lastTouch') === 'lastTouch' || s.sort === 'expected' ? 'desc' : 'asc')}
          onSort={sortBy}
          onOpen={open}
          onMore={shown.length < rows.length ? () => setLimit((n) => n + PAGE) : undefined}
        />
        {rows.length ? (
          <p className="inv-foot">{footer}</p>
        ) : (
          <NoResults q={(s.q ?? '').trim()} filtered={filtered} onAdd={() => open(null, s.q?.trim() ? { name: titleCase(s.q) } : undefined)} onClearSearch={() => setSearch({ q: undefined })} onClearAll={clearAll} empty={!inv.length} />
        )}
      </div>
      {selected.size ? <BulkBar ids={selected} onClear={() => setSelected(new Set())} /> : null}
      {s.import ? (
        <ImportDialog
          key={importStart ? importStart.step : 0}
          start={importStart}
          onClose={() => {
            setImportStart(undefined)
            setSearch({ import: undefined })
          }}
          onSeeNew={(ids) => {
            clearAll()
            setOnly(new Set(ids))
          }}
        />
      ) : null}
    </section>
  )
}
