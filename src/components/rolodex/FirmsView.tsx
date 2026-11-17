// Rolodex › Firms: every investing organisation (and ones we couldn't identify) someone
// from the shortlist works or worked at. Chips by kind (VC funds, Micro VCs, Accelerators, Angels…) with counts, then
// tier and location (India, US, a US firm with an India office…). Rows open the
// firm's panel: what it is, where it is, and our people there.
import { useMemo, useRef } from 'react'
import {
  FIRM_CSV_HEADERS, FIRM_SORT_LABEL, FIRM_SORTS, firmCsvRows, firmOptionCounts, firmsFiltered, flag, initials, kindCounts, KIND_LABEL, LOCATION_LABEL, LOCATIONS,
  matchesFirm, sortFirms, TIERS, type FirmFilters, type FirmSort, type Kind, type RolodexFirm, type RolodexSearch,
} from '../../lib/rolodex'
import { openOnKey, useUI } from '../raise-ui'
import { useIsPhone } from '../system/Menu'
import { Modal } from '../system/Modal'
import { useListKeys } from '../system/useListKeys'
import { stickyHeight } from '../system/stickyHeight'
import { Button, Chip } from '../ui'
import { useRolodex } from './data'
import { FirmPanel } from './FirmPanel'
import { Bar, exportRows, FilterChips, fmt, RolodexViews, Sel, TIER_TONE, useMore, type FilterChip } from './parts'

type Set = (patch: Partial<RolodexSearch>) => void
/** The chips shown ("Everything" is investors and unknown together). */
const KIND_CHIPS: Kind[] = ['investors', 'vc', 'micro', 'acc', 'angels', 'other', 'unknown']

export function FirmsView({ s, set, peopleCount }: { s: RolodexSearch; set: Set; peopleCount: number | null }) {
  const x = useRolodex()
  const { toast } = useUI()
  const phone = useIsPhone()
  const f: FirmFilters = { q: s.fq, kind: s.kind, tier: s.ftier, loc: s.loc, india: s.india }
  const kind = s.kind ?? 'investors'

  const rows = useMemo(() => sortFirms(x.firms.filter((r) => matchesFirm(r, f)), s.fsort), [x.firms, s.fq, s.kind, s.ftier, s.loc, s.india, s.fsort]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => kindCounts(x.firms, f), [x.firms, s.fq, s.ftier, s.loc, s.india]) // eslint-disable-line react-hooks/exhaustive-deps
  const tierN = useMemo(() => firmOptionCounts(x.firms, f, 'tier', TIERS), [x.firms, s.fq, s.kind, s.loc, s.india]) // eslint-disable-line react-hooks/exhaustive-deps
  const locN = useMemo(() => firmOptionCounts(x.firms, f, 'loc', LOCATIONS), [x.firms, s.fq, s.kind, s.ftier, s.india]) // eslint-disable-line react-hooks/exhaustive-deps
  const investing = useMemo(() => x.firms.filter((r) => matchesFirm(r, { kind: 'investors' })).length, [x.firms])

  const { limit, sentinel } = useMore(rows.length, JSON.stringify(f) + s.fsort)
  const shown = rows.slice(0, limit)
  const list = useRef<HTMLDivElement>(null)
  useListKeys(list)
  const sel = rows.find((r) => r.key === s.open) ?? x.firms.find((r) => r.key === s.open) ?? (phone ? undefined : shown[0])

  const chips: FilterChip[] = []
  if (s.ftier) chips.push({ k: 'tier', label: s.ftier, clear: () => set({ ftier: undefined }) })
  if (s.loc) chips.push({ k: 'loc', label: `Location: ${LOCATION_LABEL[s.loc]}`, clear: () => set({ loc: undefined }) })
  if (s.india) chips.push({ k: 'india', label: 'Has an India presence', clear: () => set({ india: undefined }) })
  const clearAll = () => set({ fq: undefined, ftier: undefined, loc: undefined, india: undefined })
  const active = [s.ftier, s.loc, s.india].filter(Boolean).length
  const count = firmsFiltered(f) ? `${fmt(rows.length)} of ${fmt(counts[kind])}` : `${fmt(rows.length)} ${rows.length === 1 ? 'firm' : 'firms'}`

  const selects = (
    <>
      <Sel label="Sort" allLabel="Most of our people" value={s.fsort === 'people' ? undefined : s.fsort} options={FIRM_SORTS.filter((k) => k !== 'people').map((k) => ({ value: k, label: FIRM_SORT_LABEL[k] }))} onChange={(v) => set({ fsort: v as FirmSort | undefined })} />
      <Sel label="Tier" value={s.ftier} options={TIERS.map((t) => ({ value: t, label: t, n: tierN.get(t) }))} onChange={(v) => set({ ftier: v as RolodexSearch['ftier'] })} />
      <Sel label="Location" wide value={s.loc} options={LOCATIONS.map((l) => ({ value: l, label: LOCATION_LABEL[l], n: locN.get(l) }))} onChange={(v) => set({ loc: v as RolodexSearch['loc'] })} />
      <Sel label="India" value={s.india ? 'yes' : undefined} options={[{ value: 'yes', label: 'Has a presence' }]} onChange={(v) => set({ india: v ? true : undefined })} />
    </>
  )

  const panel = sel ? <FirmPanel key={sel.key} firm={sel} /> : null

  return (
    <section className="inv rdx">
      <div className="raise-sticky" ref={stickyHeight}>
        <RolodexViews
          view="firms"
          people={peopleCount}
          firms={investing}
          right={
            <Button variant="secondary" icon="download" onClick={() => exportRows('firms', FIRM_CSV_HEADERS, firmCsvRows(rows), toast)} disabled={!rows.length}>
              Export these
            </Button>
          }
        />
        <div className="net-filters rdx-who" role="group" aria-label="Show">
          {KIND_CHIPS.map((k) => (
            <button key={k} type="button" className={'draft-chip' + (kind === k ? ' is-on' : '')} aria-pressed={kind === k} onClick={() => set({ kind: k === 'investors' ? undefined : k, open: undefined })}>
              {KIND_LABEL[k]} <span className="num">{fmt(counts[k])}</span>
            </button>
          ))}
        </div>
        <Bar q={s.fq} onQ={(fq) => set({ fq })} placeholder="Search firms, cities…" selects={selects} active={active} count={count} onClear={clearAll} resultLabel={`Show ${fmt(rows.length)} ${rows.length === 1 ? 'firm' : 'firms'}`} />
        <FilterChips chips={chips} onClear={clearAll} />
      </div>
      <div className="intro-view rdx-view">
        <div className={`inv-card rdx-card${rows.length ? '' : ' is-empty'}`} ref={list}>
          {rows.length ? (
            <div className="intro-table rdx-table" role="table" aria-label="Firms" aria-rowcount={rows.length + 1}>
              <div className="intro-row intro-row--head rdx-frow" role="row">
                <span role="columnheader">Firm</span>
                <span role="columnheader">Type</span>
                <span role="columnheader">Tier</span>
                <span role="columnheader">Location</span>
                <span role="columnheader" className="intro-row__n" title="People from the list who work or worked there">
                  Ours
                </span>
                <span role="columnheader" className="intro-row__n" title="Of them, there now">
                  Now
                </span>
              </div>
              {shown.map((r) => (
                <FirmRow key={r.key} r={r} on={sel?.key === r.key} onOpen={() => set({ open: r.key })} />
              ))}
            </div>
          ) : (
            <div className="rdx-empty">
              <p className="rdx-empty__h">{x.firms.length ? (s.fq ? `No firm matches “${s.fq}”.` : 'No firm matches these filters.') : 'No firms in the Rolodex yet.'}</p>
              {x.firms.length ? (
                <div className="rdx-empty__acts">
                  {firmsFiltered(f) ? (
                    <Button variant="secondary" onClick={clearAll}>
                      Clear filters
                    </Button>
                  ) : null}
                  {kind !== 'all' ? (
                    <Button variant="ghost" onClick={() => set({ kind: 'all' })}>
                      Look in Everything
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          {sentinel}
          {rows.length ? <p className="inv-foot">{shown.length < rows.length ? `Showing ${fmt(shown.length)} of ${fmt(rows.length)} · scroll for more` : `Showing all ${fmt(rows.length)}`}</p> : null}
        </div>
        {phone ? (
          sel && s.open ? (
            <Modal onClose={() => set({ open: undefined })} label={sel.name} className="intro-sheet">
              {panel}
            </Modal>
          ) : null
        ) : (
          panel
        )}
      </div>
    </section>
  )
}

function FirmRow({ r, on, onOpen }: { r: RolodexFirm; on: boolean; onOpen: () => void }) {
  return (
    <div role="row" tabIndex={0} data-nav-id={r.key} className={'intro-row rdx-frow' + (on ? ' is-selected' : '')} aria-selected={on} onClick={onOpen} onKeyDown={openOnKey(onOpen)}>
      <span role="cell" className="intro-row__who">
        <span className={'enrich-avatar' + (on ? ' enrich-avatar--main' : '')} aria-hidden="true">
          {initials(r.name)}
        </span>
        <span className="intro-row__text">
          <strong>{r.name}</strong>
          <small>{r.hq || r.website?.replace(/^https?:\/\/(www\.)?/, '') || '—'}</small>
        </span>
      </span>
      <span role="cell" className="rdx-frow__type">
        {r.type}
      </span>
      <span role="cell">
        {r.tier ? (
          <Chip tone={TIER_TONE[r.tier] ?? 'neutral'} dot={false} className="rdx-chip">
            {r.tier.replace('Tier ', 'T')}
          </Chip>
        ) : (
          <span className="rdx-dim">—</span>
        )}
      </span>
      <span role="cell" className="rdx-frow__loc">
        {r.hqCountryCode ? <span aria-hidden="true">{flag(r.hqCountryCode)} </span> : null}
        {r.geo}
        {r.indiaPresence === 'yes' && r.hqCountryCode !== 'IN' ? <span aria-hidden="true"> · {flag('IN')}</span> : null}
      </span>
      <span role="cell" className="intro-row__n num">
        {r.people}
      </span>
      <span role="cell" className={'intro-row__n num' + (r.peopleThereNow ? ' rdx-now' : '')}>
        {r.peopleThereNow || '—'}
      </span>
    </div>
  )
}
