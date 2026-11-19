// Rolodex › Investors: every fund, angel network, accelerator and angel who backed a
// company our founders started. Chips by kind with counts; search by name or by a
// company they backed; the investor picker narrows the list to the ones picked. Rows
// open the investor's panel: the companies they backed, our founders there, and Add
// to Investors list.
import { useMemo, useRef } from 'react'
import {
  groupCounts, INVESTOR_CSV_HEADERS, INVESTOR_GROUP_LABEL, INVESTOR_GROUPS, INVESTOR_KIND_LABEL, INVESTOR_SORT_LABEL, INVESTOR_SORTS, investorCsvRows,
  investorsFiltered, initials, matchesInvestor, sortInvestors, TIERS, type InvestorFilters, type InvestorSort, type RolodexInvestor, type RolodexSearch,
} from '../../lib/rolodex'
import { openOnKey, useUI } from '../raise-ui'
import { useIsPhone } from '../system/Menu'
import { Modal } from '../system/Modal'
import { useListKeys } from '../system/useListKeys'
import { stickyHeight } from '../system/stickyHeight'
import { Button, Chip } from '../ui'
import { useRolodex } from './data'
import { InvestorPanel } from './InvestorPanel'
import { Bar, exportRows, FilterChips, fmt, InvestorPick, RolodexViews, Sel, TIER_TONE, useMore, type FilterChip } from './parts'

type Set = (patch: Partial<RolodexSearch>) => void

export function InvestorsView({ s, set, peopleCount }: { s: RolodexSearch; set: Set; peopleCount: number | null }) {
  const x = useRolodex()
  const { toast } = useUI()
  const phone = useIsPhone()
  const f: InvestorFilters = useMemo(() => ({ q: s.iq, group: s.group, pick: s.pick, web: s.web, tier: s.itier }), [s.iq, s.group, s.pick, s.web, s.itier])
  const group = s.group ?? 'all'

  const rows = useMemo(() => sortInvestors(x.investors.filter((r) => matchesInvestor(r, f)), s.isort), [x.investors, f, s.isort])
  const counts = useMemo(() => groupCounts(x.investors, f), [x.investors, f])
  const tierN = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of x.investors) if (r.tier && matchesInvestor(r, f, 'tier')) m.set(r.tier, (m.get(r.tier) ?? 0) + 1)
    return m
  }, [x.investors, f])
  const byKey = useMemo(() => new Map(x.investors.map((r) => [r.key, r])), [x.investors])

  const { limit, sentinel } = useMore(rows.length, JSON.stringify(f) + s.isort)
  const shown = rows.slice(0, limit)
  const list = useRef<HTMLDivElement>(null)
  useListKeys(list)
  const sel = rows.find((r) => r.key === s.open) ?? byKey.get(s.open ?? '') ?? (phone ? undefined : shown[0])

  const chips: FilterChip[] = []
  for (const k of s.pick ?? []) chips.push({ k: 'pick:' + k, label: byKey.get(k)?.name ?? k, clear: () => set({ pick: s.pick?.filter((p) => p !== k).length ? s.pick.filter((p) => p !== k) : undefined }) })
  if (s.itier) chips.push({ k: 'tier', label: s.itier, clear: () => set({ itier: undefined }) })
  if (s.web) chips.push({ k: 'web', label: 'Checked on the web', clear: () => set({ web: undefined }) })
  const clearAll = () => set({ iq: undefined, pick: undefined, itier: undefined, web: undefined })
  const active = [s.pick?.length, s.itier, s.web].filter(Boolean).length
  const total = x.meta?.investors ?? x.investors.length
  const count = !x.investorsDone
    ? `Loading ${fmt(x.investors.length)} of ${fmt(total)}…`
    : investorsFiltered(f)
      ? `${fmt(rows.length)} of ${fmt(counts[group])}`
      : `${fmt(rows.length)} ${rows.length === 1 ? 'investor' : 'investors'}`

  const selects = (
    <>
      <InvestorPick label="Investor" investors={x.investors} value={s.pick} onChange={(pick) => set({ pick, open: undefined })} />
      <Sel label="Sort" allLabel="Most founders" value={s.isort === 'founders' ? undefined : s.isort} options={INVESTOR_SORTS.filter((k) => k !== 'founders').map((k) => ({ value: k, label: INVESTOR_SORT_LABEL[k] }))} onChange={(v) => set({ isort: v as InvestorSort | undefined })} />
      <Sel label="Tier" value={s.itier} options={TIERS.map((t) => ({ value: t, label: t, n: tierN.get(t) ?? 0 }))} onChange={(v) => set({ itier: v as RolodexSearch['itier'] })} />
      <Sel label="Source" value={s.web ? 'web' : undefined} allLabel="Web and Crustdata" options={[{ value: 'web', label: 'Checked on the web' }]} onChange={(v) => set({ web: v ? true : undefined })} />
    </>
  )

  const panel = sel ? <InvestorPanel key={sel.key} row={sel} /> : null

  return (
    <section className="inv rdx">
      <div className="raise-sticky" ref={stickyHeight}>
        <RolodexViews
          view="investors"
          people={peopleCount}
          investors={total}
          right={
            <Button variant="secondary" icon="download" onClick={() => exportRows('investors', INVESTOR_CSV_HEADERS, investorCsvRows(rows), toast)} disabled={!rows.length}>
              {investorsFiltered(f) || group !== 'all' ? 'Export these' : 'Export CSV'}
            </Button>
          }
        />
        <div className="net-filters rdx-who" role="group" aria-label="Show">
          {INVESTOR_GROUPS.map((g) => (
            <button key={g} type="button" className={'draft-chip' + (group === g ? ' is-on' : '')} aria-pressed={group === g} onClick={() => set({ group: g === 'all' ? undefined : g, open: undefined })}>
              {INVESTOR_GROUP_LABEL[g]} <span className="num">{fmt(counts[g])}</span>
            </button>
          ))}
        </div>
        <Bar
          q={s.iq}
          onQ={(iq) => set({ iq })}
          placeholder="Search investors or companies…"
          selects={selects}
          active={active}
          count={count}
          onClear={clearAll}
          resultLabel={`Show ${fmt(rows.length)} ${rows.length === 1 ? 'investor' : 'investors'}`}
        />
        <FilterChips chips={chips} onClear={clearAll} />
      </div>
      <div className="intro-view rdx-view">
        <div className={`inv-card rdx-card${rows.length ? '' : ' is-empty'}`} ref={list}>
          {rows.length ? (
            <div className="intro-table rdx-table" role="table" aria-label="Investors" aria-rowcount={rows.length + 1}>
              <div className="intro-row intro-row--head rdx-irow" role="row">
                <span role="columnheader">Investor</span>
                <span role="columnheader">Backed</span>
                <span role="columnheader" className="intro-row__n" title="Founders from the list whose companies they backed">
                  Founders
                </span>
                <span role="columnheader" className="intro-row__n" title="Companies of ours they backed">
                  Cos
                </span>
              </div>
              {shown.map((r) => (
                <InvestorRow key={r.key} r={r} on={sel?.key === r.key} onOpen={() => set({ open: r.key })} />
              ))}
            </div>
          ) : (
            <div className="rdx-empty">
              {x.investors.length || !x.investorsDone ? (
                <>
                  <p className="rdx-empty__h">{s.iq ? `No investor matches “${s.iq}”${investorsFiltered({ ...f, q: undefined }) ? ' with these filters' : ''}.` : 'No investor matches these filters.'}</p>
                  <div className="rdx-empty__acts">
                    {investorsFiltered(f) ? (
                      <Button variant="secondary" onClick={clearAll}>
                        Clear filters
                      </Button>
                    ) : null}
                    {group !== 'all' ? (
                      <Button variant="ghost" onClick={() => set({ group: undefined })}>
                        Look in All
                      </Button>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <p className="rdx-empty__h">No investors in the Rolodex yet.</p>
                  <p className="rdx-empty__p">
                    They come from the investor research on our founders’ companies: run <code>pnpm rolodex:prod</code> with the export in <code>internal/rolodex.json</code>.
                  </p>
                </>
              )}
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

function InvestorRow({ r, on, onOpen }: { r: RolodexInvestor; on: boolean; onOpen: () => void }) {
  const more = r.companyNames.length - 2
  return (
    <div role="row" tabIndex={0} data-nav-id={r.key} className={'intro-row rdx-irow' + (on ? ' is-selected' : '')} aria-selected={on} onClick={onOpen} onKeyDown={openOnKey(onOpen)}>
      <span role="cell" className="intro-row__who">
        <span className={'enrich-avatar' + (on ? ' enrich-avatar--main' : '')} aria-hidden="true">
          {initials(r.name)}
        </span>
        <span className="intro-row__text">
          <strong>{r.name}</strong>
          <small className="rdx-irow__kind">
            {INVESTOR_KIND_LABEL[r.kind]}
            {r.tier ? (
              <Chip tone={TIER_TONE[r.tier] ?? 'neutral'} dot={false} className="rdx-chip rdx-chip--sm">
                {r.tier.replace('Tier ', 'T')}
              </Chip>
            ) : null}
          </small>
        </span>
      </span>
      <span role="cell" className="rdx-irow__cos">
        {r.companyNames.slice(0, 2).join(', ')}
        {more > 0 ? <span className="rdx-dim"> +{more}</span> : null}
      </span>
      <span role="cell" className="intro-row__n num">
        {r.founderCount}
      </span>
      <span role="cell" className="intro-row__n num">
        {r.companyCount}
      </span>
    </div>
  )
}
