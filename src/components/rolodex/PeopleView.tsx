// Rolodex › People: the shortlist from the fundraising research. Chips for who (All,
// Investors, Founders, Execs) with counts, then search, the investor picker (founders
// who raised from any investor picked) and selects that each say how many they'd leave. Rows open the person's panel beside the list
// (a bottom sheet on phones), the same shape as Investors › Network.
import { useMemo, useRef } from 'react'
import {
  BATCHES, batchText, CAMPUSES, countryOptions, flag, initials, matchesPeople, optionCounts, PEOPLE_CSV_HEADERS, PEOPLE_SORT_LABEL,
  PEOPLE_SORTS, peopleCsvRows, peopleFiltered, personSub, roleText, sortPeople, TIERS, WHEN, WHO, WHO_LABEL, whoCounts, companyList, investorPeopleCounts,
  type PeopleSort, type RolodexFirm, type RolodexPerson, type RolodexSearch, type Who,
} from '../../lib/rolodex'
import { openOnKey, useUI } from '../raise-ui'
import { useIsPhone } from '../system/Menu'
import { Modal } from '../system/Modal'
import { useListKeys } from '../system/useListKeys'
import { stickyHeight } from '../system/stickyHeight'
import { Button, Chip } from '../ui'
import { useRolodex } from './data'
import { Bar, exportRows, FilterChips, fmt, InvestorPick, RolodexViews, Sel, useMore, type FilterChip } from './parts'
import { PersonPanel } from './PersonPanel'

type Set = (patch: Partial<RolodexSearch>) => void

const WHEN_LABEL = { now: 'Now', before: 'Before, not now' } as const
const WHEN_HINT: Record<Who, string> = { shortlist: 'Role', investors: 'Investing', founders: 'Founder', execs: 'Exec' }

export function PeopleView({ s, set, investorCount }: { s: RolodexSearch; set: Set; investorCount: number | null }) {
  const x = useRolodex()
  const { toast } = useUI()
  const phone = useIsPhone()
  const who = s.who ?? 'shortlist'
  const f = s
  const firmsByKey = useMemo(() => new Map(x.firms.map((r) => [r.key, r])), [x.firms])

  const rows = useMemo(() => sortPeople(x.people.filter((p) => matchesPeople(p, f)), s.sort), [x.people, f, s.sort])
  const counts = useMemo(() => whoCounts(x.people, f), [x.people, f])
  const countries = useMemo(() => countryOptions(x.people, f), [x.people, f])
  const opt = useMemo(
    () => ({
      when: optionCounts(x.people, f, 'when', WHEN),
      tier: optionCounts(x.people, f, 'tier', TIERS),
      campus: optionCounts(x.people, f, 'campus', CAMPUSES),
      batch: optionCounts(x.people, f, 'batch', BATCHES),
    }),
    [x.people, f],
  )
  const invCounts = useMemo(() => investorPeopleCounts(x.people, f), [x.people, f])
  const invByKey = useMemo(() => new Map(x.investors.map((r) => [r.key, r])), [x.investors])
  const { limit, sentinel } = useMore(rows.length, JSON.stringify(f) + s.sort)
  const shown = rows.slice(0, limit)
  const list = useRef<HTMLDivElement>(null)
  useListKeys(list)

  const selected = rows.find((p) => p._id === s.person) ?? x.people.find((p) => p._id === s.person)
  const sel = selected ?? (phone ? undefined : shown[0])
  const open = (id: string) => set({ person: id })

  const chips: FilterChip[] = []
  for (const k of s.inv ?? []) {
    const rest = (s.inv ?? []).filter((i) => i !== k)
    chips.push({ k: 'inv:' + k, label: `Raised from ${invByKey.get(k)?.name ?? k}`, clear: () => set({ inv: rest.length ? rest : undefined }) })
  }
  if (s.when) chips.push({ k: 'when', label: `${WHEN_HINT[who]}: ${WHEN_LABEL[s.when]}`, clear: () => set({ when: undefined }) })
  if (s.country) chips.push({ k: 'country', label: `${flag(s.country)} ${countries.find((c) => c.code === s.country)?.name ?? s.country}`, clear: () => set({ country: undefined }) })
  if (s.tier) chips.push({ k: 'tier', label: `Firm: ${s.tier}`, clear: () => set({ tier: undefined }) })
  if (s.campus) chips.push({ k: 'campus', label: `Campus: ${s.campus}`, clear: () => set({ campus: undefined }) })
  if (s.batch) chips.push({ k: 'batch', label: `Batch: ${s.batch === 'earlier' ? 'before 1990' : s.batch}`, clear: () => set({ batch: undefined }) })
  const clearAll = () => set({ q: undefined, when: undefined, country: undefined, tier: undefined, campus: undefined, batch: undefined, inv: undefined })

  const total = x.meta?.people ?? x.people.length
  const loading = !x.peopleDone
  const count = loading ? `Loading ${fmt(x.people.length)} of ${fmt(total)}…` : peopleFiltered(f) ? `${fmt(rows.length)} of ${fmt(counts[who])}` : `${fmt(rows.length)} ${rows.length === 1 ? 'person' : 'people'}`
  const active = [s.when, s.country, s.tier, s.campus, s.batch, s.inv?.length].filter(Boolean).length

  const selects = (
    <>
      <InvestorPick label="Investor" investors={x.investors} value={s.inv} counts={invCounts} onlyCounted onChange={(inv) => set({ inv, person: undefined })} />
      <Sel label="Sort" allLabel="Name" value={s.sort === 'name' ? undefined : s.sort} options={PEOPLE_SORTS.filter((k) => k !== 'name').map((k) => ({ value: k, label: PEOPLE_SORT_LABEL[k] }))} onChange={(v) => set({ sort: v as PeopleSort | undefined })} />
      <Sel label={WHEN_HINT[who]} value={s.when} options={WHEN.map((w) => ({ value: w, label: WHEN_LABEL[w], n: opt.when.get(w) }))} onChange={(v) => set({ when: v as RolodexSearch['when'] })} />
      <Sel label="Country" wide value={s.country} options={countries.map((c) => ({ value: c.code, label: `${flag(c.code)} ${c.name}`, n: c.n }))} onChange={(v) => set({ country: v })} />
      <Sel label="Firm tier" value={s.tier} options={TIERS.map((t) => ({ value: t, label: t, n: opt.tier.get(t) }))} onChange={(v) => set({ tier: v as RolodexSearch['tier'] })} />
      <Sel label="Campus" value={s.campus} options={CAMPUSES.map((c) => ({ value: c, label: c, n: opt.campus.get(c) }))} onChange={(v) => set({ campus: v as RolodexSearch['campus'] })} />
      <Sel label="Batch" value={s.batch} options={BATCHES.map((b) => ({ value: b, label: b === 'earlier' ? 'Before 1990' : b, n: opt.batch.get(b) }))} onChange={(v) => set({ batch: v as RolodexSearch['batch'] })} />
    </>
  )

  const panel = sel ? <PersonPanel key={sel._id} id={sel._id} row={sel} firmsByKey={firmsByKey} /> : null

  return (
    <section className="inv rdx">
      <div className="raise-sticky" ref={stickyHeight}>
        <RolodexViews
          view="people"
          people={total}
          investors={investorCount}
          right={
            <Button variant="secondary" icon="download" onClick={() => exportRows('people', PEOPLE_CSV_HEADERS, peopleCsvRows(rows), toast)} disabled={!rows.length}>
              {peopleFiltered(f) || who !== 'shortlist' ? 'Export these' : 'Export CSV'}
            </Button>
          }
        />
        <div className="net-filters rdx-who" role="group" aria-label="Show">
          {WHO.map((w) => (
            <button key={w} type="button" className={'draft-chip' + (who === w ? ' is-on' : '')} aria-pressed={who === w} onClick={() => set({ who: w === 'shortlist' ? undefined : w, person: undefined })}>
              {WHO_LABEL[w]} <span className="num">{fmt(counts[w])}</span>
            </button>
          ))}
        </div>
        <Bar
          q={s.q}
          onQ={(q) => set({ q })}
          placeholder="Search people, companies, titles…"
          selects={selects}
          active={active}
          count={count}
          onClear={clearAll}
          resultLabel={`Show ${fmt(rows.length)} ${rows.length === 1 ? 'person' : 'people'}`}
        />
        <FilterChips chips={chips} onClear={clearAll} />
      </div>
      <div className="intro-view rdx-view">
        <div className={`inv-card rdx-card${rows.length ? '' : ' is-empty'}`} ref={list}>
          {rows.length ? (
            <div className="intro-table rdx-table" role="table" aria-label="People" aria-rowcount={rows.length + 1}>
              <div className="intro-row intro-row--head rdx-prow" role="row">
                <span role="columnheader">Person</span>
                <span role="columnheader">Role</span>
                <span role="columnheader">Firm · company</span>
                <span role="columnheader">Where</span>
                <span role="columnheader">Batch</span>
              </div>
              {shown.map((p) => (
                <PersonRow key={p._id} p={p} on={sel?._id === p._id} firmsByKey={firmsByKey} onOpen={() => open(p._id)} />
              ))}
            </div>
          ) : (
            <Empty filtered={peopleFiltered(f)} q={s.q} who={who} onClear={clearAll} onAll={() => set({ who: undefined })} />
          )}
          {sentinel}
          {rows.length ? <p className="inv-foot">{shown.length < rows.length ? `Showing ${fmt(shown.length)} of ${fmt(rows.length)} · scroll for more` : `Showing all ${fmt(rows.length)}`}</p> : null}
        </div>
        {phone ? (
          sel && s.person ? (
            <Modal onClose={() => set({ person: undefined })} label={sel.name} className="intro-sheet">
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

/** The firm or company to show on a row: their best firm for investors, else a funded company, else today's company. */
function placeOf(p: RolodexPerson, firmsByKey: Map<string, RolodexFirm>) {
  const firms = (p.firmKeys ?? []).map((k) => firmsByKey.get(k)).filter((f): f is RolodexFirm => !!f)
  const rank = (t?: string) => (t === 'Tier 1' ? 1 : t === 'Tier 2' ? 2 : t === 'Tier 3' ? 3 : 9)
  const best = firms.sort((a, b) => rank(a.tier) - rank(b.tier))[0]
  if (best && (p.vc || p.angel)) return { name: best.name, tag: best.tier ?? best.type }
  // The company they're at now when it's one of theirs, else the first: never a company they only worked at long ago by alphabet.
  const fundedAll = companyList(p.fundedCompanies)
  const now = (p.currentCompany ?? '').toLowerCase()
  const funded = fundedAll.find((c) => now && c.name.toLowerCase() === now) ?? fundedAll[0]
  if (funded) return { name: funded.name, tag: funded.status === 'funded' ? 'Funded' : funded.status === 'acquired' ? 'Acquired' : funded.status === 'public' ? 'Public' : '' }
  return { name: p.currentCompany ?? '—', tag: '' }
}

function PersonRow({ p, on, firmsByKey, onOpen }: { p: RolodexPerson; on: boolean; firmsByKey: Map<string, RolodexFirm>; onOpen: () => void }) {
  const place = placeOf(p, firmsByKey)
  const tone = p.roleStatus === 'current' ? 'selected' : 'outline'
  return (
    <div role="row" tabIndex={0} data-nav-id={p._id} className={'intro-row rdx-prow' + (on ? ' is-selected' : '')} aria-selected={on} onClick={onOpen} onKeyDown={openOnKey(onOpen)}>
      <span role="cell" className="intro-row__who">
        <span className={'enrich-avatar' + (on ? ' enrich-avatar--main' : '')} aria-hidden="true">
          {initials(p.name)}
        </span>
        <span className="intro-row__text">
          <strong>{p.name}</strong>
          <small>{personSub(p)}</small>
        </span>
      </span>
      <span role="cell" className="rdx-prow__role">
        <Chip tone={p.role === 'none' ? 'muted' : tone} dot={false} className="rdx-chip">
          {roleText(p)}
        </Chip>
      </span>
      <span role="cell" className="rdx-prow__place">
        <span className="rdx-prow__placename">{place.name}</span>
        {place.tag ? <small className={'rdx-tag' + (place.tag === 'Tier 1' ? ' is-top' : '')}>{place.tag}</small> : null}
      </span>
      <span role="cell" className="rdx-prow__where" title={[p.city, p.country].filter(Boolean).join(', ')}>
        {p.countryCode ? (
          <>
            <span aria-hidden="true">{flag(p.countryCode)}</span> {p.city || p.country}
          </>
        ) : (
          '—'
        )}
      </span>
      <span role="cell" className="rdx-prow__batch num">
        {batchText(p)}
      </span>
    </div>
  )
}

function Empty({ filtered, q, who, onClear, onAll }: { filtered: boolean; q?: string; who: Who; onClear: () => void; onAll: () => void }) {
  const x = useRolodex()
  if (!x.meta && !x.people.length)
    return (
      <div className="rdx-empty">
        <p className="rdx-empty__h">Nothing in the Rolodex yet.</p>
        <p className="rdx-empty__p">It fills from the fundraising research: run <code>pnpm rolodex:prod</code> with the export in <code>internal/rolodex.json</code>.</p>
      </div>
    )
  return (
    <div className="rdx-empty">
      <p className="rdx-empty__h">{q ? `No one matches “${q}”${filtered ? ' with these filters' : ''}.` : 'No one matches these filters.'}</p>
      <div className="rdx-empty__acts">
        {filtered ? (
          <Button variant="secondary" onClick={onClear}>
            Clear filters
          </Button>
        ) : null}
        {who !== 'shortlist' ? (
          <Button variant="ghost" onClick={onAll}>
            Look in All
          </Button>
        ) : null}
      </div>
    </div>
  )
}

