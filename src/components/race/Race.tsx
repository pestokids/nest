// PST-295: Pipeline › Race (round5/pipeline-race.png): kickoff week, who's
// ahead with the "slow down" note, the lead, and who to update. The numbers come
// from src/lib/race.ts; motion and sounds follow interactions-batch-1.png.
import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { initials } from '../../lib/enrich'
import { dayMonth } from '../../lib/home'
import { confetti, replay } from '../../lib/motion'
import type { Investor } from '../../lib/pipeline'
import {
  askNext, canLeadOf, countWord, emailList, kickoff, LANE_STOPS, lastUpdateLine, laneCaption, leadCandidates, leadLine, leadSteps, OFFER_TARGET, raceLanes, slowDown,
  updateGroups, updateEmail, windowEyebrow, type Kickoff, type Lane, type RaceInput,
} from '../../lib/race'
import { play } from '../../lib/sound'
import { signalLine } from '../../lib/signals'
import { STAGE_TILE } from '../../lib/stages'
import { todayIST } from '../../lib/dates'
import { useRaise } from '../data'
import { openDraft } from '../drafts/data'
import { useDecisions } from '../decisions/data'
import { Maybes } from '../pipeline/Maybes'
import { usePreviewState } from '../preview-state'
import { openOnKey, useUI } from '../raise-ui'
import { useListKeys } from '../system/useListKeys'
import { Button, Card, Chip, Icon } from '../ui'
import { useRace } from './data'

const first = (name: string) => name.trim().split(/\s+/)[0] || name
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many)
const LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** What every part of the race reads: the investors with their lead fields, the log, the calendar and the round. */
export function useRaceInput(): RaceInput {
  const d = useRaise()
  const race = useRace()
  const { decisions } = useDecisions()
  const today = todayIST()
  return useMemo(() => {
    const byId = new Map(decisions.map((x) => [x.investorId, x]))
    return { investors: race.investors, acts: d.acts, meetings: d.google.meetings, round: d.round, today, decision: (id: string) => byId.get(id) }
  }, [race.investors, d.acts, d.google.meetings, d.round, today, decisions])
}

export function Race() {
  const input = useRaceInput()
  const k = useMemo(() => kickoff(input), [input])
  const lanes = useMemo(() => raceLanes(input), [input])
  const flags = usePreviewState()
  // ?preview&pipeline=update: straight to Who to update.
  useEffect(() => {
    if (flags?.race === 'update') document.getElementById('race-update')?.scrollIntoView({ block: 'start' })
  }, [flags?.race])
  return (
    <div className="race">
      <KickoffCard k={k} />
      <div className="race-grid">
        <WhosAhead lanes={lanes} today={input.today} />
        <div className="race-side">
          <LeadCard investors={input.investors} />
          <UpdateCard investors={input.investors} today={input.today} />
        </div>
      </div>
      <Maybes />
    </div>
  )
}

/* ---------- kickoff week ---------- */

function KickoffCard({ k }: { k: Kickoff }) {
  const ref = useRef<HTMLElement>(null)
  const two = k.offers >= OFFER_TARGET
  // The second offer of the week, while you're looking: lime, one confetti burst, target-hit.
  const prev = useRef(k.offers)
  useEffect(() => {
    if (prev.current < OFFER_TARGET && two) {
      play('target-hit')
      confetti(ref.current)
    }
    prev.current = k.offers
  }, [k.offers, two])
  const max = Math.max(3, ...k.perDay.map((b) => b.n))
  const stats: [string, string, boolean?][] = [
    [`${k.intros.out} / ${k.intros.of}`, 'intros out'],
    [String(k.firstMeetings), `1st meetings in ${plural(k.window.days.length, 'day')}`],
    [String(k.inRace), 'in the race'],
    [String(k.partnerMeetings), plural(k.partnerMeetings, 'partner meeting').replace(/^\d+ /, '')],
    [`${k.offers} / ${OFFER_TARGET}`, 'offers, same week', !two],
  ]
  return (
    <Card ref={ref} tone={two ? 'lime' : 'forest'} riseIndex={0} className="race-kick" aria-labelledby="race-kick-title">
      <div className="race-kick__main">
        <p className="eyebrow-mono race-kick__eyebrow">{windowEyebrow(k.window)}</p>
        <h2 id="race-kick-title" className="race-kick__title">
          {k.headline}
        </h2>
        <dl className="race-kick__stats">
          {stats.map(([value, label, short]) => (
            <div key={label} className={short ? 'is-short' : undefined}>
              <dt>{label}</dt>
              <dd className="num">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="race-kick__days">
        <p className="eyebrow-mono race-kick__eyebrow" id="race-days-title">
          Meetings per day
        </p>
        <ol className="race-bars" aria-labelledby="race-days-title">
          {k.perDay.map((b) => (
            <li key={b.day} className={`race-bar${b.today ? ' is-today' : b.past ? ' is-past' : ''}`}>
              <span className="race-bar__today" aria-hidden={!b.today}>
                {b.today ? 'today' : ''}
              </span>
              <span className="race-bar__track" aria-hidden="true">
                <span className="race-bar__fill" style={{ height: `${(b.n / max) * 100}%` }} />
              </span>
              <span className="race-bar__day" aria-hidden="true">
                {LETTER[new Date(b.day + 'T00:00:00Z').getUTCDay()]}
              </span>
              <span className="sr-only">
                {dayMonth(b.day)}: {plural(b.n, 'meeting')}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  )
}

/* ---------- who's ahead ---------- */

function WhosAhead({ lanes, today }: { lanes: Lane[]; today: string }) {
  const { latestSignal } = useDecisions()
  const ref = useRef<HTMLDivElement>(null)
  useListKeys(ref)
  const slow = slowDown(lanes, today)
  const signalOf = (id: string) => {
    const s = latestSignal(id)
    const line = s ? signalLine(s) : ''
    return line === 'Nothing to act on' ? '' : line
  }
  return (
    <Card riseIndex={1} className="race-ahead" aria-labelledby="race-ahead-title">
      <h2 id="race-ahead-title" className="race-card__title">
        Who’s ahead
      </h2>
      <p className="race-card__text">Aim for two offers in the same week. Slow down whoever gets too far ahead.</p>
      {lanes.length ? (
        <div className="race-lanes" ref={ref}>
          <div className="race-lanes__head" aria-hidden="true">
            <span />
            <span className="race-lanes__stops">
              {LANE_STOPS.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </span>
            <span>Decide by</span>
            <span />
          </div>
          {lanes.map((l) => (
            <div key={l.investor._id} className="race-lanes__item">
              <LaneRow lane={l} today={today} ahead={slow?.leader === l} signal={signalOf(l.investor._id)} />
              {slow?.leader === l ? (
                <p className="race-slow m-rise" role="note">
                  <Icon name="arrow-right" size={16} strokeWidth={2.2} className="race-slow__icon" />
                  {slow.text}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="race-empty">Nobody’s in the race yet. A firm joins it when its 1st meeting is booked.</p>
      )}
    </Card>
  )
}

function LaneRow({ lane: l, today, ahead, signal }: { lane: Lane; today: string; ahead: boolean; signal: string }) {
  const { open } = useUI()
  const i = l.investor
  const cl = canLeadOf(i)
  const late = !!l.decideBy && l.decideBy < today
  const go = () => open(i._id)
  return (
    <div
      className={`race-lane${ahead ? ' is-ahead' : ''}`}
      role="button"
      tabIndex={0}
      data-nav-id={i._id}
      onClick={go}
      onKeyDown={openOnKey(go)}
      aria-label={`${i.name}: ${STAGE_TILE[l.stage]}${l.decideBy ? `, decide by ${dayMonth(l.decideBy)}` : ''}`}
    >
      <span className="race-lane__who">
        <span className={`avatar race-avatar${cl.on ? '' : ' race-avatar--pale'}`} aria-hidden="true">
          {initials(i.name)}
        </span>
        <span className="race-lane__name">
          <b>{i.name}</b>
          {cl.on ? (
            <Chip tone="selected" dot={false} className="chip--sm">
              Can lead
            </Chip>
          ) : cl.value === 'no' ? (
            <span className="race-lane__follows">Follows</span>
          ) : null}
        </span>
      </span>
      <span className="race-lane__track">
        <span className="race-track" style={{ '--pos': l.pos } as CSSProperties} aria-hidden="true">
          <span className="race-track__line" />
          <span className="race-track__fill" />
          {LANE_STOPS.map((s, k) => (
            <span key={s} className={`race-track__stop${k <= l.pos ? ' is-done' : ''}`} style={{ '--k': k } as CSSProperties} />
          ))}
          <span className="race-track__marker" />
        </span>
        <span className="race-lane__caption">{signal || laneCaption(l, today)}</span>
      </span>
      <span className={`race-lane__decide${late ? ' is-late' : ''}`}>{l.decideBy ? dayMonth(l.decideBy) : '–'}</span>
      <Icon name="chevron-right" size={18} className="race-lane__go" />
    </div>
  )
}

/* ---------- the lead ---------- */

function LeadCard({ investors }: { investors: readonly Investor[] }) {
  const { open } = useUI()
  const { leadId } = useRace()
  const ref = useRef<HTMLElement>(null)
  const candidates = leadCandidates(investors, leadId)
  const lead = leadId ? investors.find((i) => i._id === leadId) : undefined
  const next = askNext(candidates, leadId)
  const racing = candidates.filter((c) => c._id !== leadId).length
  // A firm agrees to lead: the card flips to forest.
  const prev = useRef(leadId)
  useEffect(() => {
    if (leadId && leadId !== prev.current) replay(ref.current, 'race-lead--flip')
    prev.current = leadId
  }, [leadId])
  return (
    <Card ref={ref} tone={lead ? 'forest' : 'white'} riseIndex={2} className="race-lead" aria-labelledby="race-lead-title">
      <p className="eyebrow-mono race-lead__eyebrow">The lead</p>
      <h2 id="race-lead-title" className="race-card__title">
        {lead ? `${first(lead.name)} is leading` : 'No lead yet'}
      </h2>
      <p className="race-card__text">
        {lead
          ? 'Tell the rest: most were waiting for a lead.'
          : racing
            ? `Most will wait for one. ${countWord(racing)} ${racing === 1 ? 'firm' : 'firms'} in the race can lead.`
            : 'Most will wait for one. Nobody in the race can lead yet: switch on Can lead in a firm’s drawer when you know.'}
      </p>
      {candidates.length ? (
        <ul className="race-list">
          {candidates.map((c) => {
            const asked = leadSteps(c, leadId).asked
            const action = c._id !== leadId && !asked ? 'Ask' : 'Open'
            return (
              <li key={c._id} className="race-list__row">
                <span className={`avatar race-avatar${c._id === leadId || c._id === candidates[0]._id ? '' : ' race-avatar--pale'}`} aria-hidden="true">
                  {initials(c.name)}
                </span>
                <span className="race-list__who">
                  <b>{c.name}</b>
                  <span>{leadLine(c, leadId)}</span>
                </span>
                <button
                  type="button"
                  className="race-link"
                  aria-label={action === 'Ask' ? `Ask ${c.name} if they’ll lead` : `Open ${c.name}`}
                  onClick={() => (action === 'Ask' ? openDraft({ investorId: c._id, type: 'lead' }) : open(c._id))}
                >
                  {action}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
      {next ? (
        <Button variant="primary" className="race-lead__ask" onClick={() => openDraft({ investorId: next._id, type: 'lead' })}>
          Ask {first(next.name)} if they’ll lead
        </Button>
      ) : null}
    </Card>
  )
}

/* ---------- who to update ---------- */

function namesOf(xs: Investor[]) {
  const names = xs.map((i) => i.name)
  return names.length <= 2 ? names.join(' and ') : names.slice(0, 2).join(', ') + ` and ${names.length - 2} more`
}

function UpdateCard({ investors, today }: { investors: readonly Investor[]; today: string }) {
  const ui = useUI()
  const race = useRace()
  const { decisions } = useDecisions()
  const maybe = new Set(decisions.filter((x) => x.status === 'maybe').map((x) => x.investorId))
  const groups = updateGroups(investors, (i) => maybe.has(i._id))
  const everyone = groups.flatMap((g) => g.investors)
  const all = [...new Set(groups.flatMap((g) => g.emails))]

  async function copy(list: Investor[], emails: string[]) {
    try {
      await navigator.clipboard.writeText(emailList(emails))
    } catch {
      play('nope')
      ui.toast({ tone: 'error', message: 'Couldn’t copy: the browser didn’t allow it. Try again.' })
      return
    }
    const missing = list.filter((i) => !updateEmail(i))
    ui.toast({ tone: 'info', icon: 'check', message: `Copied ${plural(emails.length, 'email')}.${missing.length ? ` No email for ${namesOf(missing)}.` : ''}` })
  }

  function markSent() {
    play('rule-check')
    const saved = race.markUpdateSent(all.length)
    saved.catch(ui.fail)
    ui.toast({
      message: 'Update marked sent today.',
      action: {
        label: 'Undo',
        onClick: () => {
          play('undo')
          saved.then(race.undoUpdateSent).catch(ui.fail)
        },
      },
    })
  }

  return (
    <Card riseIndex={3} className="race-update" id="race-update" aria-labelledby="race-update-title">
      <p className="eyebrow-mono race-update__eyebrow">Who to update</p>
      <h2 id="race-update-title" className="race-card__title">
        Share every win with them
      </h2>
      <p className="race-card__text">
        {race.loaded ? lastUpdateLine(race.lastUpdate?.sentOn, today) : ' '}
        {race.lastUpdate?.by ? ` · ${race.lastUpdate.by}` : ''}
      </p>
      <ul className="race-groups">
        {groups.map((g) => (
          <li key={g.key} className="race-groups__row">
            <b>{g.label}</b>
            <span className="num">{g.investors.length}</span>
            <button type="button" className="race-link" disabled={!g.emails.length} onClick={() => void copy(g.investors, g.emails)} aria-label={`Copy the emails of ${g.label.toLowerCase()}`}>
              Copy emails
            </button>
          </li>
        ))}
      </ul>
      <div className="race-update__foot">
        <Button variant="dark" disabled={!all.length} onClick={() => void copy(everyone, all)}>
          Copy all {plural(all.length, 'email')}
        </Button>
        <Button variant="ghost" onClick={markSent}>
          Mark sent
        </Button>
      </div>
      <p className="race-update__note">Nest never sends these. Write the update from your own email, then mark it sent.</p>
    </Card>
  )
}
