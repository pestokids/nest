// Rolodex › Investors: one investor's panel. What they are, every company of ours they
// backed (rounds, our founders there and when, where the link comes from), and two
// ways in: Add to Investors list (the Add investor drawer, filled in) or In your
// pipeline when they're there already, and their founders in People.
import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { normName } from '../../lib/introducers'
import { COMPANY_STATUS_LABEL, flag, INVESTOR_KIND_LABEL, initials, SOURCE_TEXT, TIMING_TEXT, type RolodexInvestor, type RolodexInvestorFull } from '../../lib/rolodex'
import type { InvestorType } from '../../lib/stages'
import { useRaise } from '../data'
import { useUI, type OpenOptions } from '../raise-ui'
import { useTitleId } from '../system/Modal'
import { Button, Card, Chip, type ChipTone } from '../ui'
import { useRolodex } from './data'
import { fmt, LinkButton, TIER_TONE } from './parts'

const TIER_SOURCE: Record<string, string> = { high: 'well known.', med: 'fairly sure.', low: 'a guess.' }
const STATUS_TONE: Record<string, ChipTone> = { funded: 'success', acquired: 'selected', public: 'selected', not_funded: 'muted', unknown: 'outline', no_crustdata_id: 'outline' }
const PIPELINE_TYPE: Partial<Record<RolodexInvestor['kind'], InvestorType>> = { micro_vc: 'Micro-VC', vc: 'Seed fund', pe_growth: 'Multi-stage VC', accelerator: 'Accelerator', angel: 'Angel', angel_network: 'Angel' }

/** The Add investor drawer, filled in: an angel (or network) by name, a fund as the Fund with the partner left to fill. */
export function pipelineDraft(r: Pick<RolodexInvestorFull, 'name' | 'kind' | 'geo' | 'companies'>): OpenOptions {
  const person = r.kind === 'angel' || r.kind === 'angel_network'
  const backed = r.companies
    .slice(0, 8)
    .map((c) => `${c.name}${c.founders.length ? ` (${c.founders.map((f) => f.name).join(', ')})` : ''}`)
    .join('; ')
  return {
    name: person ? r.name : '',
    firm: person ? '' : r.name,
    type: PIPELINE_TYPE[r.kind] ?? 'Seed fund',
    geo: r.geo === 'India' || r.geo === 'US' ? r.geo : undefined,
    source: 'Rolodex',
    notes: backed ? `From the Rolodex. Backed founders from our list: ${backed}${r.companies.length > 8 ? '…' : '.'}` : 'From the Rolodex.',
  }
}

export function InvestorPanel({ row }: { row: RolodexInvestor }) {
  const x = useRolodex()
  const d = useRaise()
  const ui = useUI()
  const navigate = useNavigate()
  const titleId = useTitleId()
  const full = x.useInvestor(row.key)
  const personByCid = useMemo(() => new Map(x.people.map((p) => [p.crustdataId, p])), [x.people])
  const key = normName(row.name)
  const inPipeline = d.investors.filter((i) => normName(i.firm || '') === key || normName(i.name) === key)

  const openPerson = (cid: number) => {
    const p = personByCid.get(cid)
    if (p) void navigate({ from: '/raise/rolodex', to: '/raise/rolodex', search: (s) => ({ ...s, view: undefined, who: undefined, person: p._id }) })
  }
  const seeFounders = () => void navigate({ from: '/raise/rolodex', to: '/raise/rolodex', search: (s) => ({ ...s, view: undefined, who: 'founders' as const, inv: [row.key], person: undefined }) })

  return (
    <Card as="section" className="intro-panel rdx-panel" aria-labelledby={titleId}>
      <header className="intro-panel__head">
        <span className="enrich-avatar enrich-avatar--main intro-panel__avatar" aria-hidden="true">
          {initials(row.name)}
        </span>
        <div className="intro-panel__id">
          <h2 id={titleId} className="intro-panel__name">
            {row.name}
          </h2>
          <p className="intro-panel__sub">
            Backed {fmt(row.founderCount)} {row.founderCount === 1 ? 'founder' : 'founders'} from our list across {fmt(row.companyCount)} {row.companyCount === 1 ? 'company' : 'companies'}
          </p>
        </div>
      </header>

      <div className="net-panel__chips rdx-panel__chips">
        <Chip tone="selected" dot={false}>
          {INVESTOR_KIND_LABEL[row.kind]}
        </Chip>
        {row.tier ? (
          <Chip tone={TIER_TONE[row.tier] ?? 'neutral'} dot={false}>
            {row.tier}
          </Chip>
        ) : null}
        {row.geo && row.geo !== 'Unknown' ? (
          <Chip tone="outline" dot={false}>
            {row.hqCountryCode ? flag(row.hqCountryCode) + ' ' : ''}
            {row.geo}
          </Chip>
        ) : null}
        {row.indiaPresence === 'yes' && row.hqCountryCode && row.hqCountryCode !== 'IN' && !row.geo?.includes('India') ? (
          <Chip tone="outline" dot={false}>
            {flag('IN')} Invests in India
          </Chip>
        ) : null}
      </div>

      <div className="rdx-panel__acts">
        {inPipeline.length ? (
          <Button variant="secondary" icon="user" onClick={() => ui.open(inPipeline[0]._id)}>
            In your pipeline{inPipeline.length > 1 ? ` (${inPipeline.length})` : ''}
          </Button>
        ) : (
          <Button variant="primary" icon="plus" disabled={!full} onClick={() => full && ui.open(null, pipelineDraft(full))}>
            Add to Investors list
          </Button>
        )}
        <Button variant="secondary" icon="user" onClick={seeFounders}>
          Their founders in People
        </Button>
        {full?.website ? <LinkButton href={full.website}>Website</LinkButton> : null}
      </div>

      <h3 className="intro-panel__how eyebrow-mono">Companies they backed · {fmt(row.companyCount)}</h3>
      {full ? (
        <ul className="rdx-list rdx-backed">
          {full.companies.map((c) => (
            <li key={c.key} className="rdx-backed__co">
              <div className="rdx-backed__head">
                <span className="rdx-co">{c.name}</span>
                <Chip tone={STATUS_TONE[c.status] ?? 'neutral'} dot={false} className="rdx-chip">
                  {COMPANY_STATUS_LABEL[c.status] ?? (c.status === 'no_crustdata_id' ? 'Not in Crustdata' : c.status)}
                </Chip>
              </div>
              {c.rounds?.length || c.lead ? <p className="rdx-backed__rounds">{[c.lead ? 'Led a round' : '', ...(c.rounds ?? [])].filter(Boolean).join(' · ')}</p> : null}
              <p className="rdx-backed__founders">
                {c.founders.map((f, i) => (
                  <span key={f.personId}>
                    {i ? ', ' : ''}
                    {personByCid.has(f.personId) ? (
                      <button type="button" className="intro-panel__inv" onClick={() => openPerson(f.personId)}>
                        {f.name}
                      </button>
                    ) : (
                      f.name
                    )}
                    {TIMING_TEXT[f.timing] ? <span className="rdx-dim"> ({TIMING_TEXT[f.timing]})</span> : null}
                  </span>
                ))}
              </p>
              {c.source === 'crustdata' ? <p className="rdx-backed__src">{SOURCE_TEXT.crustdata}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="intro-panel__howtext">{full === null ? 'This investor isn’t in the Rolodex any more.' : 'Loading…'}</p>
      )}

      {full?.aliases?.length ? <p className="intro-panel__line">Also listed as {full.aliases.slice(0, 4).join(', ')}</p> : null}
      <p className="rdx-source">
        From research on our founders’ companies: the web, checked by an agent, and Crustdata’s investor lists. {fmt(row.webCount)} of {fmt(row.companyCount)} checked on the web.
        {row.tier || row.hqCountryCode ? ` Tier and location: ${TIER_SOURCE[row.tierConfidence ?? ''] ?? 'judged from what’s known about them.'}` : ''}
      </p>
    </Card>
  )
}
