import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useRaise } from '../../components/data'
import { NestEmpty, NestWithEggs } from '../../components/illustrations'
import { useSession } from '../../components/session'
import { Badge, buttonClass, Card, Chip, Icon, type ChipTone } from '../../components/ui'
import { todayIST } from '../../lib/dates'
import { dateEyebrow, dayMonth, greeting, isChecklistDone, nextPhase, phaseLine, phaseOn, raiseStats, thisWeek, weekDay } from '../../lib/home'
import { INBOX_LABEL, inboxPreview, type InboxKind, type InboxRow } from '../../lib/inbox'
import { rise, usePop } from '../../lib/motion'
import { money } from '../../lib/money'
import { totals } from '../../lib/pipeline'
import type { Round } from '../../lib/round'

export const Route = createFileRoute('/_app/')({ component: Home })

/** Home, the company overview (round5/home-company-overview.png): the greeting, the Raise card, the Inbox's top rows and this week. */
function Home() {
  const d = useRaise()
  const { me } = useSession()
  const [now] = useState(() => Date.now())
  const today = todayIST(now)
  const r = d.round
  const firstRun = d.loaded && d.investors.length === 0
  const phase = phaseOn(r, today) ?? nextPhase(r, today) ?? r.phases[r.phases.length - 1]
  const ticks = d.usePrepTicks(phase?.k ?? null)
  const phaseDone = !!phase && !!ticks && phaseOn(r, today) === phase && isChecklistDone(phase.todo, ticks)

  if (!d.loaded) return <div className="page home" aria-busy="true" />

  return (
    <div className="page home">
      <section className="home-hello m-rise" style={rise(0)}>
        <div>
          <p className="eyebrow-mono home-hello__date">{dateEyebrow(now)}</p>
          <h1 className="home-hello__title">
            <span className="home-hello__greet">{greeting(now, me.firstName, firstRun)}</span>
            <span className="home-hello__line">{d.roundExists || firstRun ? phaseLine(r, today, { firstRun, phaseDone }) : 'Set up the round to get going.'}</span>
          </h1>
        </div>
        <NestWithEggs size={150} className="home-hello__nest" />
      </section>

      <div className="home-grid">
        <RaiseCard round={r} roundExists={d.roundExists} today={today} />
        <InboxCard today={today} now={now} />
        <WeekCard round={r} roundExists={d.roundExists} today={today} />
      </div>
    </div>
  )
}

function RaiseCard({ round: r, roundExists, today }: { round: Round; roundExists: boolean; today: string }) {
  const { investors: inv } = useRaise()
  const t = totals(inv, r, today)
  const committedRef = usePop<HTMLSpanElement>(t.committed)
  if (!roundExists)
    return (
      <Card tone="forest" riseIndex={1} className="raise-card raise-card--empty" aria-labelledby="raise-card-title">
        <p className="eyebrow-mono raise-card__eyebrow">Raise · Not set up</p>
        <h2 id="raise-card-title" className="raise-card__setup">
          Your round isn’t set up yet.
        </h2>
        <p className="raise-card__body">Add the target, the close date and your phases. It takes about two minutes, and every number on this page fills in after.</p>
        <Link to="/raise/settings" className={buttonClass({ variant: 'primary' })}>
          Set up the round
        </Link>
      </Card>
    )
  const s = raiseStats(inv)
  const days = Math.max(0, t.daysLeft)
  return (
    <Card tone="forest" riseIndex={1} className="raise-card" aria-label="Raise">
      <div className="raise-card__top">
        <p className="eyebrow-mono raise-card__eyebrow">Raise · Pre-seed</p>
        <Link to="/raise/today" className="raise-card__open">
          Open Raise <Icon name="arrow-right" size={16} strokeWidth={2.2} />
        </Link>
      </div>
      <p className="raise-card__money">
        <span ref={committedRef} className="raise-card__committed num">
          {money(t.committed)}
        </span>
        <span className="raise-card__of">
          of {money(r.target)} committed · {t.daysLeft < 0 ? `closed ${dayMonth(r.deadline)}` : `${days} day${days === 1 ? '' : 's'} to close`}
        </span>
      </p>
      <dl className="raise-card__stats">
        {/* PST-295 fills three slots here, before "intros out": "in the race", "offers" (n / m) and "lead" ("None" yet in orange).
            They stay out until it ships: no placeholder values. */}
        <div>
          <dt>in conversation</dt>
          <dd className="num">{s.inConversation}</dd>
        </div>
        <div>
          <dt>intros out</dt>
          <dd className="num">{s.introsOut}</dd>
        </div>
      </dl>
    </Card>
  )
}

/** The Inbox's top 4, from Today's lists (lib/inbox.ts). A row opens that investor on Today; a suggestion opens the list. */
function InboxCard({ today, now }: { today: string; now: number }) {
  const d = useRaise()
  const { total, rows } = inboxPreview({ investors: d.investors, threads: d.google.threads, suggestions: d.suggestions, quietDays: d.round.quietDays, today, now })
  return (
    <Card riseIndex={2} className="home-inbox" aria-labelledby="home-inbox-title">
      <header className="home-card__head">
        <h2 id="home-inbox-title" className="home-card__title">
          Inbox
          {total ? (
            <Badge className="home-inbox__count" aria-label={`${total} in the inbox`}>
              {total}
            </Badge>
          ) : null}
        </h2>
        <Link to="/raise/today" className="home-card__link">
          Open Today <Icon name="arrow-right" size={16} strokeWidth={2.2} />
        </Link>
      </header>
      {rows.length ? (
        <ul className="home-inbox__rows">
          {rows.map((x) => (
            <li key={x.key}>
              <InboxLink row={x} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="home-card__empty">
          <NestEmpty size={88} />
          <p>Nothing waiting. Replies owed, steps due and quiet conversations land here.</p>
        </div>
      )}
    </Card>
  )
}

const KIND_TONE: Record<InboxKind, ChipTone> = { reply: 'success', due: 'waiting', quiet: 'error', review: 'neutral' }

function InboxLink({ row: x }: { row: InboxRow }) {
  const body = (
    <>
      <Chip tone={KIND_TONE[x.kind]} dot={false}>
        {INBOX_LABEL[x.kind]}
      </Chip>
      <span className="home-inbox__text">
        <b>{x.name}</b> · {x.detail}
      </span>
    </>
  )
  if (x.kind === 'review' || !x.investorId)
    return (
      <Link to="/raise/today" state={(s) => ({ ...s, suggestions: true })} className="home-inbox__row">
        {body}
      </Link>
    )
  const id = x.investorId
  return (
    <Link to="/raise/today" state={(s) => ({ ...s, drawer: { id } })} className="home-inbox__row">
      {body}
    </Link>
  )
}

function WeekCard({ round: r, roundExists, today }: { round: Round; roundExists: boolean; today: string }) {
  const d = useRaise()
  const week = thisWeek({ investors: d.investors, meetings: d.google.meetings, phases: roundExists ? r.phases : [], today })
  return (
    <Card riseIndex={3} className="home-week" aria-labelledby="home-week-title">
      <header className="home-card__head">
        <h2 id="home-week-title" className="home-card__title">
          This week
        </h2>
      </header>
      <ol className="home-week__days">
        {week.map((w) => (
          <li key={w.day} className={`home-week__day${w.today ? ' is-today' : ''}`} aria-current={w.today ? 'date' : undefined}>
            <p className="eyebrow-mono home-week__date">
              {weekDay(w.day)}
              {w.today ? ' · Today' : ''}
            </p>
            {w.items.length ? (
              <ul className="home-week__items">
                {w.items.map((x) => (
                  <li key={x.key} className={`home-week__item home-week__item--${x.kind}`}>
                    {x.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="home-week__none">Nothing yet</p>
            )}
          </li>
        ))}
      </ol>
    </Card>
  )
}
