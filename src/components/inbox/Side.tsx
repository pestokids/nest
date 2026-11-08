// PST-297: the Inbox's right column (round5/today-inbox.png): the race with
// PST-295's numbers, the round's numbers and today's meetings. On a phone the
// race is a short card over the list (iphone-today-inbox.png) and the rest
// follows the list.
import { Link } from '@tanstack/react-router'
import { useMemo, type CSSProperties } from 'react'
import { formatDay } from '../../lib/dates'
import { money } from '../../lib/money'
import { totals } from '../../lib/pipeline'
import { canLeadOf, countWord, kickoff, OFFER_TARGET, raceLanes, slowDown, type Kickoff } from '../../lib/race'
import { usePop } from '../../lib/motion'
import { useRaise } from '../data'
import { useRace } from '../race/data'
import { useRaceInput } from '../race/Race'
import { Card, Icon } from '../ui'

const firstWord = (name: string) => name.trim().split(/\s+/)[0] || name
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many)

function useRaceSummary() {
  const input = useRaceInput()
  const { leadId } = useRace()
  return useMemo(() => {
    const k = kickoff(input)
    const lanes = raceLanes(input)
    const lead = leadId ? input.investors.find((i) => i._id === leadId) : undefined
    const canLead = lanes.filter((l) => canLeadOf(l.investor).on).length
    return { k, lanes, slow: slowDown(lanes, input.today), lead, canLead }
  }, [input, leadId])
}

const leadLine = (lead: { name: string } | undefined, canLead: number) => (lead ? 'Lead: ' + firstWord(lead.name) : 'Lead: none yet') + (canLead ? ' · ' + canLead + ' can lead' : '')

function eyebrow(k: Kickoff, short: boolean) {
  const w = k.window
  const label = w.kind === 'kickoff' ? (short ? 'Kickoff' : 'Kickoff week') : 'This week'
  if (!w.day) return label
  return short ? label + ' · Day ' + w.day + ' of ' + w.days.length : label + ', day ' + w.day
}

/** The race on the right: who's in it, how far each got, the lead and the way to Pipeline › Race. */
export function RaceCard() {
  const { k, lanes, slow, lead, canLead } = useRaceSummary()
  const partner = lanes.filter((l) => l.stage === 'm2').length
  const offers = k.offers ? plural(k.offers, 'offer') : 'no offers yet'
  return (
    <Card tone="forest" riseIndex={1} className="inbox-race only-desk" aria-labelledby="inbox-race-title">
      <p className="eyebrow-mono inbox-race__eyebrow">The race · {eyebrow(k, false)}</p>
      <h2 id="inbox-race-title" className="inbox-race__title">
        {k.inRace ? plural(k.inRace, 'firm') + ' in the race' : 'Nobody’s in the race yet'}
      </h2>
      <p className="inbox-race__text">
        {k.inRace ? `${partner} at partner meetings · ${offers}. ` : 'A firm joins when its 1st meeting is booked. '}
        Aim: {countWord(OFFER_TARGET)} offers in the same week{k.window.days.length ? ', by ' + formatDay(k.window.days[k.window.days.length - 1]) : ''}.
      </p>
      {lanes.length ? (
        <ul className="inbox-race__lanes">
          {lanes.slice(0, 4).map((l) => (
            <li key={l.investor._id} className={'inbox-race__lane' + (slow?.leader === l ? ' is-ahead' : '')}>
              <span className="inbox-race__name">{firstWord(l.investor.name)}</span>
              <span className="inbox-race__track" aria-hidden="true">
                <span className="inbox-race__fill" style={{ '--w': ((l.pos + 0.5) / 3.5) * 100 + '%' } as CSSProperties} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="inbox-race__foot">
        <span className="inbox-race__lead">{leadLine(lead, canLead)}</span>
        <Link to="/raise/pipeline" search={{ view: 'race' }} className="inbox-race__link">
          Open the race <Icon name="arrow-right" size={16} strokeWidth={2.2} />
        </Link>
      </div>
    </Card>
  )
}

/** The phone's race card, over the list. */
export function RaceBanner({ today }: { today: string }) {
  const { k, lead, canLead } = useRaceSummary()
  const d = useRaise()
  const t = totals(d.investors, d.round, today)
  return (
    <Link to="/raise/pipeline" search={{ view: 'race' }} className="inbox-banner only-phone">
      <span className="eyebrow-mono inbox-banner__eyebrow">{eyebrow(k, true)}</span>
      <span className="inbox-banner__title">
        {k.inRace} in the race · {k.offers} of {OFFER_TARGET} offers
      </span>
      <span className="inbox-banner__sub">
        {leadLine(lead, canLead)} · {money(t.committed)} committed
      </span>
    </Link>
  )
}

/** The round's numbers: committed of the target and the stretch, and days to close. */
export function RoundCard({ today }: { today: string }) {
  const { investors, round: r } = useRaise()
  const t = totals(investors, r, today)
  const days = Math.max(0, t.daysLeft)
  const moneyRef = usePop<HTMLSpanElement>(t.committed)
  const daysRef = usePop<HTMLSpanElement>(days)
  return (
    <Card tone="mint" riseIndex={2} className="inbox-round" aria-label="The round">
      <p className="inbox-round__top">
        <span ref={moneyRef} className="inbox-round__money num">
          {money(t.committed)}
        </span>
        <span ref={daysRef} className="inbox-round__days num">
          {days}
        </span>
      </p>
      <p className="inbox-round__bottom">
        <span>
          committed of {money(r.target)} · room to {money(r.stretch)}
        </span>
        <span>{t.daysLeft < 0 ? 'closed ' + formatDay(r.deadline) : days === 1 ? 'day to close' : 'days to close'}</span>
      </p>
    </Card>
  )
}

/** A note for anyone who knew the old Today. */
export function WhereNote() {
  return (
    <Card tone="paper" riseIndex={5} className="inbox-where" aria-labelledby="inbox-where-title">
      <h2 id="inbox-where-title" className="eyebrow-mono inbox-where__title">
        Where did things go?
      </h2>
      <p className="inbox-where__text">Waiting on you, Due today, Gone quiet, suggestions, notes, opened links and the next 3 moves are all rows in the Inbox now, ranked together.</p>
    </Card>
  )
}
