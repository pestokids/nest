// Rolodex › Firms: one firm's panel. What it is (type, tier, how sure), where it is
// (HQ, offices, India), links, whether it's in the pipeline, and our people there,
// each opening in People.
import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import { normName } from '../../lib/introducers'
import { flag, initials, ROLE_LABEL, TIMING_LABEL, type RoleKey, type RolodexFirm, type RolodexPerson } from '../../lib/rolodex'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { useTitleId } from '../system/Modal'
import { Button, Card, Chip } from '../ui'
import { useRolodex } from './data'
import { fmt, LinkButton, TIER_TONE } from './parts'

const CONFIDENCE: Record<string, string> = { high: 'Type and tier: well known.', med: 'Type and tier: fairly sure.', low: 'Type and tier: a guess from the name and size.' }
const GEO_SOURCE: Record<string, string> = { crustdata: 'Location from Crustdata.', job_record: 'Location from our people’s job records.', knowledge: 'Location corrected by hand (Crustdata’s was missing or wrong).' }

export function FirmPanel({ firm: f }: { firm: RolodexFirm }) {
  const x = useRolodex()
  const d = useRaise()
  const ui = useUI()
  const navigate = useNavigate()
  const titleId = useTitleId()
  const people = useMemo(() => {
    const ids = new Set(f.personIds)
    return x.people.filter((p) => ids.has(p.crustdataId)).sort((a, b) => Number(isThereNow(b)) - Number(isThereNow(a)) || a.name.localeCompare(b.name))
  }, [x.people, f.personIds])
  const missing = f.personIds.length - people.length
  const inPipeline = d.investors.filter((i) => normName(i.firm || i.name) === normName(f.name))
  const offices = (f.officeCountries ?? []).filter((c) => c !== f.hqCountryCode)

  const openPerson = (id: string) => navigate({ from: '/raise/rolodex', to: '/raise/rolodex', search: (s) => ({ ...s, view: undefined, who: 'everyone' as const, firm: f.key, person: id }) })

  return (
    <Card as="section" className="intro-panel rdx-panel" aria-labelledby={titleId}>
      <header className="intro-panel__head">
        <span className="enrich-avatar enrich-avatar--main intro-panel__avatar" aria-hidden="true">
          {initials(f.name)}
        </span>
        <div className="intro-panel__id">
          <h2 id={titleId} className="intro-panel__name">
            {f.name}
          </h2>
          <p className="intro-panel__sub">{f.hq || f.geo}</p>
        </div>
      </header>

      <div className="net-panel__chips rdx-panel__chips">
        <Chip tone="selected" dot={false}>
          {f.type}
        </Chip>
        {f.tier ? (
          <Chip tone={TIER_TONE[f.tier] ?? 'neutral'} dot={false}>
            {f.tier}
          </Chip>
        ) : null}
        <Chip tone="outline" dot={false}>
          {f.hqCountryCode ? flag(f.hqCountryCode) + ' ' : ''}
          {f.geo}
        </Chip>
      </div>

      <div className="rdx-panel__acts">
        {f.website ? <LinkButton href={f.website}>Website</LinkButton> : null}
        {f.linkedinUrl ? <LinkButton href={f.linkedinUrl}>LinkedIn</LinkButton> : null}
        {inPipeline.length ? (
          <Button variant="secondary" icon="user" onClick={() => ui.open(inPipeline[0]._id)}>
            In your pipeline{inPipeline.length > 1 ? ` (${inPipeline.length})` : ''}
          </Button>
        ) : null}
      </div>

      {f.note ? <p className="intro-panel__howtext rdx-note">{f.note[0].toUpperCase() + f.note.slice(1)}.</p> : null}

      <h3 className="intro-panel__how eyebrow-mono">Where</h3>
      <p className="intro-panel__howtext">
        HQ: {f.hq || (f.hqCountryCode ? f.geo : 'not known')}
        {offices.length ? (
          <>
            <br />
            Offices: {offices.map((c) => flag(c) + ' ' + c).join('  ')}
          </>
        ) : null}
        <br />
        India: {f.indiaPresence === 'yes' ? (f.hqCountryCode === 'IN' ? 'based here' : 'has an office') : f.indiaPresence === 'no' ? 'no office found' : 'not known'}
      </p>

      <h3 className="intro-panel__how eyebrow-mono">
        Our people here · {fmt(f.people)}
        {f.peopleThereNow ? ` · ${fmt(f.peopleThereNow)} now` : ''}
      </h3>
      {people.length ? (
        <ul className="rdx-list rdx-list--rows">
          {people.slice(0, 25).map((p) => (
            <li key={p._id}>
              <button type="button" className="intro-panel__inv" onClick={() => openPerson(p._id)}>
                {p.name}
              </button>
              <span className="rdx-meta">{roleHere(p)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="intro-panel__howtext">{x.peopleDone ? 'No one from the list.' : 'Loading people…'}</p>
      )}
      {people.length > 25 || missing > 0 ? (
        <button type="button" className="intro-list__more" onClick={() => void navigate({ from: '/raise/rolodex', to: '/raise/rolodex', search: (s) => ({ ...s, view: undefined, who: 'everyone' as const, firm: f.key, person: undefined }) })}>
          {people.length > 25 ? `See all ${fmt(f.people)} in People` : 'See them in People'}
        </button>
      ) : null}

      <p className="rdx-source">
        {[f.confidence ? CONFIDENCE[f.confidence] : 'Type and tier: not recognised.', f.geoSource ? GEO_SOURCE[f.geoSource] : '', f.headcount ? `${fmt(f.headcount)} on LinkedIn.` : ''].filter(Boolean).join(' ')}
      </p>
    </Card>
  )
}

const ROLES: RoleKey[] = ['vc', 'angel', 'founder', 'exec']
const isThereNow = (p: RolodexPerson) => p.vc === 'current' || p.angel === 'current'
function roleHere(p: RolodexPerson) {
  const r = ROLES.filter((k) => p[k]).map((k) => `${ROLE_LABEL[k]} ${TIMING_LABEL[p[k]!]}`)
  return [p.currentTitle, ...r].filter(Boolean).slice(0, 2).join(' · ')
}
