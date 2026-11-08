// PST-295: the Raise card's race slots on Home (round5/home-company-overview.png):
// in the race, offers this week against two, and the lead ("None" yet, in orange).
import { useMemo } from 'react'
import { kickoff, OFFER_TARGET } from '../../lib/race'
import { useRace } from './data'
import { useRaceInput } from './Race'

const first = (name: string) => name.trim().split(/\s+/)[0] || name

export function RaceStats() {
  const input = useRaceInput()
  const { leadId } = useRace()
  const k = useMemo(() => kickoff(input), [input])
  const lead = leadId ? input.investors.find((i) => i._id === leadId) : undefined
  return (
    <>
      <div>
        <dt>in the race</dt>
        <dd className="num">{k.inRace}</dd>
      </div>
      <div>
        <dt>offers</dt>
        <dd className="num">
          {k.offers} / {OFFER_TARGET}
        </dd>
      </div>
      <div>
        <dt>{lead ? 'leading' : 'lead yet'}</dt>
        <dd className={lead ? undefined : 'raise-card__none'}>{lead ? first(lead.name) : 'None'}</dd>
      </div>
    </>
  )
}
