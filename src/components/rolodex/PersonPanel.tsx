// Rolodex › People: one person's panel. Everything the research kept about them, who
// invested in the companies they founded (each investor opens in Investors), their
// firms and companies with funding status, why they're on the shortlist, and two ways
// in: Add to pipeline (investors: the Add investor drawer with their name) or Add to
// Network (founders and execs).
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { normName } from '../../lib/introducers'
import {
  backingTiming, batchText, companyList, yearsText, type CompanyRole, COMPANY_STATUS_LABEL, CURRENT_LABEL, flag, initials, ROLE_LABEL, SOURCE_TEXT, TIMING_LABEL, TIMING_TEXT, whyText,
  type RoleKey, type RolodexCompany, type RolodexFirm, type RolodexPerson,
} from '../../lib/rolodex'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useIntroducers } from '../introducers/data'
import { useUI } from '../raise-ui'
import { useTitleId } from '../system/Modal'
import { Button, Card, Chip, type ChipTone } from '../ui'
import { useRolodex } from './data'
import { LinkButton } from './parts'

const ROLES: RoleKey[] = ['vc', 'angel', 'founder', 'exec']
const STATUS_TONE: Record<string, ChipTone> = { funded: 'success', acquired: 'selected', public: 'selected', not_funded: 'muted', unknown: 'outline', not_checked: 'outline' }

export function PersonPanel({ id, row, firmsByKey }: { id: string; row: RolodexPerson; firmsByKey: Map<string, RolodexFirm> }) {
  const x = useRolodex()
  const full = x.usePerson(id)
  const p = full ?? row
  const titleId = useTitleId()
  const navigate = useNavigate()
  const firms = (row.firmKeys ?? []).map((k) => firmsByKey.get(k)).filter((f): f is RolodexFirm => !!f)
  const roles = ROLES.filter((r) => p[r])
  const companies = [...companyList(p.fundedCompanies), ...companyList(full?.unfundedCompanies), ...companyList(full?.unverifiableCompanies)]
  const now = (full?.currentRoles ?? '').split(' | ').map((s) => s.trim()).filter(Boolean)
  const raised = x.useCompanies(full?.companyKeys)

  const openInvestor = (key: string) => navigate({ from: '/raise/rolodex', to: '/raise/rolodex', search: (s) => ({ ...s, view: 'investors' as const, open: key }) })

  return (
    <Card as="section" className="intro-panel rdx-panel" aria-labelledby={titleId}>
      <header className="intro-panel__head">
        <span className="enrich-avatar enrich-avatar--main intro-panel__avatar" aria-hidden="true">
          {initials(p.name)}
        </span>
        <div className="intro-panel__id">
          <h2 id={titleId} className="intro-panel__name">
            {p.name}
          </h2>
          <p className="intro-panel__sub">{p.headline || [p.currentTitle, p.currentCompany].filter(Boolean).join(' · ')}</p>
        </div>
      </header>

      <div className="net-panel__chips rdx-panel__chips">
        {roles.map((r) => (
          <Chip key={r} tone={p[r] === 'current' ? 'selected' : 'outline'} dot={false}>
            {ROLE_LABEL[r]} {TIMING_LABEL[p[r]!]}
          </Chip>
        ))}
        {p.bestFirmTier ? (
          <Chip tone={p.bestFirmTier === 'Tier 1' ? 'live' : 'neutral'} dot={false}>
            {p.bestFirmTier} firm
          </Chip>
        ) : null}
      </div>

      <Actions p={p} />

      {now.length ? (
        <>
          <h3 className="intro-panel__how eyebrow-mono">Now</h3>
          <ul className="rdx-list">
            {now.map((t) => (
              <li key={t}>{t.replace(' @ ', ' · ')}</li>
            ))}
          </ul>
        </>
      ) : p.currentRole !== 'none' ? (
        <>
          <h3 className="intro-panel__how eyebrow-mono">Now</h3>
          <p className="intro-panel__howtext">
            {CURRENT_LABEL[p.currentRole]}
            {p.currentCompany ? ` · ${p.currentCompany}` : ''}
          </p>
        </>
      ) : null}

      {raised?.some((c) => c.investors.length) ? <Raised companies={raised} personId={p.crustdataId} onInvestor={openInvestor} /> : null}

      {firms.length ? (
        <>
          <h3 className="intro-panel__how eyebrow-mono">Investor firms they work or worked at</h3>
          <ul className="rdx-list rdx-list--rows">
            {firms.map((f) => (
              <li key={f.key}>
                <span className="rdx-co">{f.name}</span>
                <span className="rdx-meta">{[f.type, f.tier, f.geo].filter((v) => v && v !== 'Unknown').join(' · ')}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {full?.companyRoles?.length ? (
        <>
          <h3 className="intro-panel__how eyebrow-mono">Companies they founded or ran</h3>
          <ul className="rdx-list rdx-backed">
            {sortRoles(full.companyRoles).map((c) => (
              <li key={c.key} className="rdx-backed__co">
                <div className="rdx-backed__head">
                  <span className="rdx-co">{c.name}</span>
                  {c.status ? (
                    <Chip tone={STATUS_TONE[c.status] ?? 'neutral'} dot={false} className="rdx-chip">
                      {COMPANY_STATUS_LABEL[c.status] ?? c.status}
                    </Chip>
                  ) : null}
                </div>
                {c.jobs.map((j, i) => (
                  <p key={i} className="rdx-backed__rounds">
                    {[j.title, yearsText(j.from, j.to)].filter(Boolean).join(' · ')}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </>
      ) : companies.length ? (
        <>
          <h3 className="intro-panel__how eyebrow-mono">Companies they founded or ran</h3>
          <ul className="rdx-list rdx-list--rows">
            {companies.map((c) => (
              <li key={c.name + c.status}>
                <span className="rdx-co">{c.name}</span>
                {c.status ? (
                  <Chip tone={STATUS_TONE[c.status] ?? 'neutral'} dot={false} className="rdx-chip">
                    {COMPANY_STATUS_LABEL[c.status] ?? c.status}
                  </Chip>
                ) : null}
              </li>
            ))}
          </ul>
          {!full ? <p className="intro-panel__line">Loading the rest…</p> : null}
        </>
      ) : null}

      <h3 className="intro-panel__how eyebrow-mono">Why they’re here</h3>
      <p className="intro-panel__howtext">{whyText(full?.whyIncluded).join(' · ') || roleTextFor(p)}</p>

      <h3 className="intro-panel__how eyebrow-mono">BITS and where</h3>
      <p className="intro-panel__howtext">
        {[batchText(p), full?.degree].filter(Boolean).join(' · ')}
        <br />
        {p.countryCode ? <span aria-hidden="true">{flag(p.countryCode)} </span> : null}
        {full?.location || [p.city, p.country].filter(Boolean).join(', ') || 'Location not known'}
      </p>
      {full?.otherSchools ? <p className="intro-panel__line">Also studied at {full.otherSchools.split('; ').slice(0, 3).join(', ')}</p> : null}
      {full?.twitter || full?.githubUrl ? (
        <p className="intro-panel__line">
          {full.twitter ? (
            <a className="rdx-a" href={`https://x.com/${full.twitter}`} target="_blank" rel="noopener noreferrer">
              @{full.twitter}
            </a>
          ) : null}
          {full.twitter && full.githubUrl ? ' · ' : ''}
          {full.githubUrl ? (
            <a className="rdx-a" href={full.githubUrl} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          ) : null}
        </p>
      ) : null}
      {x.meta ? <p className="rdx-source">From Crustdata · imported {new Date(x.meta.importedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p> : null}
    </Card>
  )
}

/** Who invested in each company they founded: investors open in Investors; lead, rounds, and "after they left" where it applies. */
function Raised({ companies, personId, onInvestor }: { companies: RolodexCompany[]; personId: number; onInvestor: (key: string) => void }) {
  const withInvestors = companies.filter((c) => c.investors.length)
  return (
    <>
      <h3 className="intro-panel__how eyebrow-mono">Who invested in their companies</h3>
      <ul className="rdx-list rdx-backed">
        {withInvestors.map((c) => {
          const me = c.founders.find((f) => f.personId === personId)
          return (
            <li key={c.key} className="rdx-backed__co">
              <div className="rdx-backed__head">
                <span className="rdx-co">{c.name}</span>
                {c.totalRaised && c.totalRaised !== 'undisclosed' ? <span className="rdx-meta">{c.totalRaised} raised</span> : null}
              </div>
              <p className="rdx-backed__founders">
                {c.investors.map((inv, i) => {
                  const when = TIMING_TEXT[backingTiming(inv.firstYear, me?.from, me?.to)]
                  return (
                    <span key={inv.key}>
                      {i ? ', ' : ''}
                      <button type="button" className="intro-panel__inv" onClick={() => onInvestor(inv.key)} title={inv.rounds?.join(' · ') || undefined}>
                        {inv.name}
                      </button>
                      {inv.lead || when ? <span className="rdx-dim"> ({[inv.lead ? 'lead' : '', when].filter(Boolean).join(', ')})</span> : null}
                    </span>
                  )
                })}
              </p>
              {c.research === 'crustdata' ? <p className="rdx-backed__src">{SOURCE_TEXT.crustdata}</p> : null}
            </li>
          )
        })}
      </ul>
    </>
  )
}

const STATUS_RANK: Record<string, number> = { funded: 0, acquired: 0, public: 0, not_funded: 1, unknown: 2, not_checked: 2 }
/** Funded, acquired and public first, then the rest; newest job first within each. */
function sortRoles(rows: CompanyRole[]) {
  const latest = (c: CompanyRole) => c.jobs.reduce((m, j) => (j.to === 'now' ? '9999' : (j.to ?? j.from ?? '') > m ? (j.to ?? j.from ?? '') : m), '')
  return [...rows].sort((a, b) => (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3) || latest(b).localeCompare(latest(a)) || a.name.localeCompare(b.name))
}

const roleTextFor = (p: RolodexPerson) => (p.role === 'none' ? 'Matched the search, but not as a founder, exec or investor.' : `${ROLE_LABEL[p.role]} ${p.roleStatus ? TIMING_LABEL[p.roleStatus] : ''}`)

/** LinkedIn, and the one way into Nest that fits: the pipeline for investors, the Network for founders and execs. Says so when they're in already. */
function Actions({ p }: { p: RolodexPerson }) {
  const d = useRaise()
  const net = useIntroducers()
  const ui = useUI()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const key = normName(p.name)
  const investor = d.investors.find((i) => normName(i.name) === key)
  const person = net.introducers.find((i) => normName(i.name) === key)
  const isInvestor = !!(p.vc || p.angel)

  const addToNetwork = async () => {
    setBusy(true)
    try {
      const r = await net.add({
        name: p.name,
        relation: p.founder ? 'founder' : 'other',
        company: p.currentCompany,
        notes: ['From the Rolodex.', p.headline, p.linkedinUrl].filter(Boolean).join(' '),
      })
      play('save')
      ui.toast({
        message: r.existed ? `${p.name} is already in your Network.` : `Added ${p.name} to your Network.`,
        action: { label: 'Open', onClick: () => void navigate({ to: '/raise/investors', search: { view: 'network' } }) },
      })
    } catch (e) {
      ui.fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rdx-panel__acts">
      {p.linkedinUrl ? <LinkButton href={p.linkedinUrl}>LinkedIn</LinkButton> : null}
      {investor ? (
        <Button variant="secondary" icon="user" onClick={() => ui.open(investor._id)}>
          In your pipeline
        </Button>
      ) : isInvestor ? (
        <Button variant="primary" icon="plus" onClick={() => ui.open(null, { name: p.name })}>
          Add to pipeline
        </Button>
      ) : null}
      {person ? (
        <Button variant="secondary" icon="user" onClick={() => void navigate({ to: '/raise/investors', search: { view: 'network' } })}>
          In your Network
        </Button>
      ) : !isInvestor && p.role !== 'none' ? (
        <Button variant="secondary" icon="plus" loading={busy} loadingLabel="Adding…" onClick={() => void addToNetwork()}>
          Add to Network
        </Button>
      ) : null}
    </div>
  )
}
