import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { errorMessage, useRaise } from '../../components/data'
import { useUI, WarmChip } from '../../components/ui'
import { exportCsv, IMPORT_HEADERS, previewImport, type ImportPreview } from '../../lib/csv'
import { shortDate, todayIST } from '../../lib/dates'
import { money } from '../../lib/money'
import { isLate, score, type Investor } from '../../lib/pipeline'
import { ACTIVE, ALL, GEOS, IDX, isStage, LABEL, TIERS, TYPES, WARM, WARMTHS, type Stage } from '../../lib/stages'

const COLS = [
  ['score', 'Score', 'r'], ['name', 'Investor'], ['type', 'Type'], ['geo', 'Geo'], ['warmth', 'Relationship'], ['path', 'Warm path'],
  ['tier', 'Tier'], ['wave', 'Wave'], ['stage', 'Stage'], ['expected', 'Expected', 'r'], ['nextStep', 'Next step'], ['nextDate', 'Next'], ['lastTouch', 'Last touch'],
] as const
type SortKey = (typeof COLS)[number][0]
const SORT_KEYS = COLS.map((c) => c[0]) as SortKey[]

/** Filters and sort live in the URL, so a filtered view is a link. */
export type InvestorSearch = {
  q?: string
  stage?: 'live' | Stage
  warmth?: (typeof WARMTHS)[number]
  type?: (typeof TYPES)[number]
  geo?: (typeof GEOS)[number]
  tier?: (typeof TIERS)[number]
  sort?: SortKey
  dir?: 'asc' | 'desc'
}

const oneOf = <T extends string>(xs: readonly T[], v: unknown): T | undefined => (typeof v === 'string' && (xs as readonly string[]).includes(v) ? (v as T) : undefined)

export const Route = createFileRoute('/raise/investors')({
  validateSearch: (s: Record<string, unknown>): InvestorSearch => ({
    q: typeof s.q === 'string' && s.q ? s.q : undefined,
    stage: s.stage === 'live' ? 'live' : isStage(s.stage) ? s.stage : undefined,
    warmth: oneOf(WARMTHS, s.warmth),
    type: oneOf(TYPES, s.type),
    geo: oneOf(GEOS, s.geo),
    tier: oneOf(TIERS, s.tier),
    sort: oneOf(SORT_KEYS, s.sort),
    dir: oneOf(['asc', 'desc'] as const, s.dir),
  }),
  component: Investors,
})

const defaultDir = (k: SortKey) => (k === 'score' || k === 'expected' ? -1 : 1)

function Investors() {
  const s = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { investors: inv } = useRaise()
  const { open } = useUI()
  const [importing, setImporting] = useState(false)
  const t = todayIST()
  const sortKey: SortKey = s.sort ?? 'score'
  const sortDir = s.dir ? (s.dir === 'asc' ? 1 : -1) : defaultDir(sortKey)

  const setSearch = (patch: Partial<InvestorSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })

  const q = (s.q ?? '').trim().toLowerCase()
  const rows = inv.filter(
    (i) =>
      (!q || [i.name, i.firm, i.path, i.notes, i.nextStep].join(' ').toLowerCase().includes(q)) &&
      (!s.stage || (s.stage === 'live' ? ACTIVE.has(i.stage) : i.stage === s.stage)) &&
      (!s.warmth || i.warmth === s.warmth) &&
      (!s.type || i.type === s.type) &&
      (!s.geo || i.geo === s.geo) &&
      (!s.tier || i.tier === s.tier),
  )
  const val = (i: Investor): string | number =>
    sortKey === 'score' ? score(i)
      : sortKey === 'stage' ? (IDX[i.stage] ?? (i.stage === 'passed' ? -2 : -1))
        : sortKey === 'expected' ? +(i.expected || 0)
          : sortKey === 'wave' ? +i.wave || 9
            : (i[sortKey] as string | undefined) || ''
  rows.sort((a, b) => {
    const x = val(a), y = val(b)
    return (x > y ? 1 : x < y ? -1 : 0) * sortDir || score(b) - score(a)
  })

  const sortBy = (k: SortKey) => {
    const dir = sortKey === k ? -sortDir : defaultDir(k)
    setSearch({ sort: k, dir: dir > 0 ? 'asc' : 'desc' })
  }

  function download() {
    const blob = new Blob([exportCsv(inv)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `nest-investors-${t}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <section>
      <div className="filters" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Search name, firm, warm path, notes" aria-label="Search" value={s.q ?? ''} onChange={(e) => setSearch({ q: e.target.value || undefined })} />
        <select aria-label="Stage" value={s.stage ?? ''} onChange={(e) => setSearch({ stage: (e.target.value || undefined) as InvestorSearch['stage'] })}>
          <option value="">Any stage</option>
          <option value="live">Live conversations</option>
          {ALL.map((x) => <option key={x.k} value={x.k}>{x.l}</option>)}
        </select>
        <select aria-label="Relationship" value={s.warmth ?? ''} onChange={(e) => setSearch({ warmth: (e.target.value || undefined) as InvestorSearch['warmth'] })}>
          <option value="">Any relationship</option>
          {Object.entries(WARM).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select aria-label="Type" value={s.type ?? ''} onChange={(e) => setSearch({ type: (e.target.value || undefined) as InvestorSearch['type'] })}>
          <option value="">Any type</option>
          {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select aria-label="Geography" value={s.geo ?? ''} onChange={(e) => setSearch({ geo: (e.target.value || undefined) as InvestorSearch['geo'] })}>
          <option value="">Any geography</option>
          {GEOS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select aria-label="Tier" value={s.tier ?? ''} onChange={(e) => setSearch({ tier: (e.target.value || undefined) as InvestorSearch['tier'] })}>
          <option value="">Any tier</option>
          {TIERS.map((x) => <option key={x}>{x}</option>)}
        </select>
        <span className="muted num">{rows.length} of {inv.length}</span>
        <span className="tools">
          <button className="btn small" type="button" onClick={() => setImporting((x) => !x)} aria-expanded={importing}>
            Import CSV
          </button>
          <button className="btn small" type="button" onClick={download}>
            Export CSV
          </button>
        </span>
      </div>
      {importing ? <CsvImport onDone={() => setImporting(false)} /> : null}
      <div className="tbl">
        <table>
          <thead>
            <tr>
              {COLS.map(([k, l, c]) => (
                <th key={k} className={c ?? ''} onClick={() => sortBy(k)} aria-sort={sortKey === k ? (sortDir > 0 ? 'ascending' : 'descending') : undefined}>
                  {l}
                  {sortKey === k ? (sortDir > 0 ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((i) => {
                const sc = score(i)
                const late = isLate(i, t)
                return (
                  <tr key={i._id} onClick={() => open(i._id)}>
                    <td className="r"><span className={`score ${sc >= 75 ? 'hi' : ''}`}>{sc}</span></td>
                    <td>
                      <strong>{i.name}</strong>
                      {i.firm ? <div className="muted">{i.firm}</div> : null}
                    </td>
                    <td>{i.type}</td>
                    <td>{i.geo}</td>
                    <td><WarmChip w={i.warmth} /></td>
                    <td>{i.path}</td>
                    <td><span className="chip tier">{i.tier}</span></td>
                    <td className="num">{i.wave}</td>
                    <td><span className="chip stage">{LABEL[i.stage] || i.stage}</span></td>
                    <td className="r num">{i.expected ? money(i.expected) : '–'}</td>
                    <td style={{ maxWidth: 240 }}>{i.nextStep}</td>
                    <td className="num">{i.nextDate ? <span className={late ? 'chip late' : ''}>{shortDate(i.nextDate)}</span> : '–'}</td>
                    <td className="num">{shortDate(i.lastTouch)}</td>
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={COLS.length} className="muted" style={{ cursor: 'default' }}>
                  No investors match. Clear a filter, or add one with + Add investor.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Paste or upload, preview (rows to add, rows skipped and why), then import. */
function CsvImport({ onDone }: { onDone: () => void }) {
  const { investors, importMany } = useRaise()
  const { toast } = useUI()
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(f: File | undefined) {
    if (!f) return
    const s = await f.text()
    setText(s)
    setPreview(previewImport(s, investors))
  }
  async function run() {
    if (!preview?.add.length) return
    setBusy(true)
    try {
      const r = await importMany(preview.add.map((x) => x.fields))
      toast(`Imported ${r.added} investor${r.added === 1 ? '' : 's'}${r.skipped ? `, ${r.skipped} already tracked` : ''}`)
      onDone()
    } catch (e) {
      toast(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <header>
        <h2>Import investors from CSV</h2>
        <button className="btn small" type="button" onClick={onDone}>Close</button>
      </header>
      <div className="import">
        <div className="hint">
          Headers: <span className="mono">{IMPORT_HEADERS.join(', ')}</span>. Only name is required; the rest default as in a new investor. Rows with the same name and firm as one already tracked are skipped.
        </div>
        <textarea
          aria-label="CSV"
          placeholder={'name,firm,type,warmth,expected\nAsha Rao,Alpha Fund,Seed fund,warm,250000'}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setPreview(null)
          }}
        />
        <div className="actions">
          <input type="file" accept=".csv,text/csv" aria-label="Upload CSV" onChange={(e) => void onFile(e.target.files?.[0])} />
          <span className="sp" style={{ flex: 1 }} />
          <button className="btn small" type="button" onClick={() => setPreview(previewImport(text, investors))} disabled={!text.trim()}>
            Preview
          </button>
          <button className="btn primary small" type="button" onClick={run} disabled={busy || !preview?.add.length}>
            {preview?.add.length ? `Import ${preview.add.length}` : 'Import'}
          </button>
        </div>
        {preview ? (
          preview.error ? (
            <div className="err">{preview.error}</div>
          ) : (
            <>
              {preview.unknownHeaders.length ? <div className="hint">Ignored columns: {preview.unknownHeaders.join(', ')}</div> : null}
              <div className="eyebrow">{preview.add.length} to add</div>
              {preview.add.length ? (
                <div className="tbl">
                  <table style={{ minWidth: 640 }}>
                    <thead>
                      <tr><th>Line</th><th>Investor</th><th>Type</th><th>Relationship</th><th>Tier</th><th>Wave</th><th className="r">Expected</th><th>Next</th></tr>
                    </thead>
                    <tbody>
                      {preview.add.map(({ line, fields: f }) => (
                        <tr key={line} style={{ cursor: 'default' }}>
                          <td className="num">{line}</td>
                          <td><strong>{f.name}</strong>{f.firm ? <div className="muted">{f.firm}</div> : null}</td>
                          <td>{f.type}</td>
                          <td><WarmChip w={f.warmth} /></td>
                          <td><span className="chip tier">{f.tier}</span></td>
                          <td className="num">{f.wave}</td>
                          <td className="r num">{f.expected ? money(f.expected) : '–'}</td>
                          <td className="num">{shortDate(f.nextDate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <div className="eyebrow">{preview.skipped.length} skipped</div>
              {preview.skipped.length ? (
                <div className="tbl">
                  <table style={{ minWidth: 480 }}>
                    <thead><tr><th>Line</th><th>Name</th><th>Why</th></tr></thead>
                    <tbody>
                      {preview.skipped.map((x) => (
                        <tr key={x.line} style={{ cursor: 'default' }}>
                          <td className="num">{x.line}</td>
                          <td>{x.name}</td>
                          <td>{x.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )
        ) : null}
      </div>
    </div>
  )
}
