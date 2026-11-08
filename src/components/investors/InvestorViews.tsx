// PST-294: the chip row over Investors: the list, or Introducers.
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { allPeople } from '../../lib/introducers'
import { useRaise } from '../data'
import { useIntroducers } from '../introducers/data'

export function InvestorViews({ view, right }: { view: 'list' | 'introducers'; right?: ReactNode }) {
  const d = useRaise()
  const x = useIntroducers()
  const people = x.loaded ? allPeople(x.introducers, d.investors).length : null
  return (
    <div className="inv-views">
      <nav className="inv-views__chips" aria-label="Investors views">
        <Link to="/raise/investors" search={(s) => ({ ...s, view: undefined, person: undefined })} className={'draft-chip' + (view === 'list' ? ' is-on' : '')} aria-current={view === 'list' ? 'page' : undefined}>
          Investors {d.investors.length}
        </Link>
        <Link to="/raise/investors" search={(s) => ({ ...s, view: 'introducers' as const })} className={'draft-chip' + (view === 'introducers' ? ' is-on' : '')} aria-current={view === 'introducers' ? 'page' : undefined}>
          Introducers{people === null ? '' : ' ' + people}
        </Link>
      </nav>
      {right ? <div className="inv-views__right">{right}</div> : null}
    </div>
  )
}
