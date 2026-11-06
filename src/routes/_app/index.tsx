import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage, useRaise } from '../../components/data'
import { Egg, EggCracking, NestEmpty } from '../../components/illustrations'
import { LogoTile } from '../../components/LogoTile'
import { useSession } from '../../components/session'
import { buttonClass, Card, Checkbox, Icon, useToast } from '../../components/ui'
import { todayIST } from '../../lib/dates'
import { dateEyebrow, dayMonth, greeting, isChecklistDone, monDay, nextPhase, phaseLine, phaseOn, phaseSegments, upNext } from '../../lib/home'
import { confetti, rise, usePop } from '../../lib/motion'
import { money } from '../../lib/money'
import { phaseActual, totals } from '../../lib/pipeline'
import { targetValue, type Metric, type Round } from '../../lib/round'
import { play } from '../../lib/sound'
import { ACTIVE } from '../../lib/stages'

export const Route = createFileRoute('/_app/')({ component: Home })

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
            {greeting(now, me.firstName, firstRun)}
            <br />
            <span className="home-hello__line">{d.roundExists || firstRun ? phaseLine(r, today, { firstRun, phaseDone }) : 'Set up the round to get going.'}</span>
          </h1>
        </div>
        <LogoTile hello={`Hi, ${me.firstName}!`} />
      </section>

      <div className="bento">
        <RaiseCard round={r} roundExists={d.roundExists} today={today} />
        <DaysCard round={r} roundExists={d.roundExists} today={today} />
        <Checklist key={phase?.k ?? 'none'} />
        <ListCard round={r} today={today} />
        <UpNextCard round={r} roundExists={d.roundExists} today={today} />
      </div>

      <section className="eggs m-rise" style={rise(6)} aria-labelledby="eggs-title">
        <h2 id="eggs-title" className="t-heading-l">
          Still in the egg
        </h2>
        <p className="eggs__sub">Tools we haven’t built yet. They hatch one at a time.</p>
        <ul className="eggs__grid">
          {EGGS.map((e) => (
            <li key={e.name} className={`egg-card m-wobble-hover ${e.next ? 'egg-card--next' : ''}`}>
              <span className="m-wobble-target egg-card__egg">{e.next ? <EggCracking size={44} /> : <Egg size={40} />}</span>
              <span>
                <span className="egg-card__name">{e.name}</span>
                <span className="egg-card__sub">{e.next ? 'Hatching next' : e.sub}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

const EGGS = [
  { name: 'Growth', sub: 'Ad spend, waitlist, installs' },
  { name: 'Families & beta', sub: 'Parents and beta testers', next: true },
  { name: 'Hiring', sub: 'Roles and candidates' },
  { name: 'Ops & Legal', sub: 'Contracts and to-dos' },
]

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
  const segs = phaseSegments(r, today)
  const talking = inv.filter((i) => ACTIVE.has(i.stage)).length
  const passed = inv.filter((i) => i.stage === 'passed').length
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
        <span className="raise-card__of">of {money(r.target)} committed</span>
      </p>
      <ol className="phasebar" aria-label="Phases">
        {segs.map((s) => (
          <li key={s.key} className={`phasebar__seg phasebar__seg--${s.state}`} style={{ flexGrow: s.grow }}>
            <span className="phasebar__bar" />
            <span className="phasebar__label">
              {s.name}
              {s.state === 'now' ? ' · now' : ''}
            </span>
          </li>
        ))}
      </ol>
      <p className="raise-card__stats">
        <span>
          <b className="num">{talking}</b> in conversation
        </span>
        <span>
          <b className="num">{money(t.weighted)}</b> weighted
        </span>
        <span>
          <b className="num">{passed}</b> passed
        </span>
      </p>
    </Card>
  )
}

function DaysCard({ round: r, roundExists, today }: { round: Round; roundExists: boolean; today: string }) {
  const { investors } = useRaise()
  const t = totals(investors, r, today)
  const days = Math.max(0, t.daysLeft)
  const ref = usePop<HTMLSpanElement>(days)
  return (
    <Card tone="lime" riseIndex={2} className="days-card" aria-label="Days to close">
      <p className="days-card__label">Days to close</p>
      {roundExists ? (
        <>
          <span ref={ref} className="days-card__n num">
            {days}
          </span>
          <p className="days-card__note">
            {t.daysLeft < 0
              ? `Closed on ${dayMonth(r.deadline)}.`
              : `Close on ${dayMonth(r.deadline)}. ${t.need > 0 ? `That’s ${money(t.perDay)} a day from here.` : 'The target is covered.'}`}
          </p>
        </>
      ) : (
        <>
          <span className="days-card__dash" aria-label="Not set" />
          <p className="days-card__note">Pick a close date and the countdown starts.</p>
        </>
      )}
    </Card>
  )
}

function Checklist() {
  const d = useRaise()
  const toast = useToast()
  const today = todayIST()
  const r = d.round
  const phase = phaseOn(r, today) ?? nextPhase(r, today) ?? r.phases[r.phases.length - 1]
  const next = phase ? r.phases[r.phases.indexOf(phase) + 1] : undefined
  const saved = d.usePrepTicks(phase?.k ?? null)
  // Optimistic ticks so the box answers instantly; Convex catches up.
  const [pending, setPending] = useState<Record<number, boolean>>({})
  const ticked = useMemo(() => {
    const s = new Set(saved ?? [])
    for (const [k, v] of Object.entries(pending)) {
      if (v) s.add(+k)
      else s.delete(+k)
    }
    return s
  }, [saved, pending])
  const todo = phase?.todo ?? []
  const done = isChecklistDone(todo, ticked)
  const count = todo.filter((_, i) => ticked.has(i)).length
  const card = useRef<HTMLElement>(null)
  const [celebrate, setCelebrate] = useState(false)
  const wasDone = useRef<boolean | null>(null)
  const countRef = usePop<HTMLSpanElement>(count)

  // Prep done: banner, spark, confetti and sound, only when it becomes done here.
  useEffect(() => {
    if (saved === undefined) return
    if (wasDone.current === false && done) {
      setCelebrate(true)
      confetti(card.current)
      play('prep-done', { delay: 0.12 })
      play('confetti', { delay: 0.25, volume: 0.7 })
    }
    wasDone.current = done
  }, [done, saved])

  async function toggle(i: number, on: boolean) {
    if (!phase) return
    setPending((p) => ({ ...p, [i]: on }))
    const willBeDone = on && todo.every((_, j) => j === i || ticked.has(j))
    if (on && !willBeDone) play('card-pickup', { rate: 1.2 + count * 0.04, volume: 0.6 })
    try {
      await d.setPrepTick(phase.k, i, on)
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
    } finally {
      setPending((p) => {
        const { [i]: _drop, ...rest } = p
        return rest
      })
    }
  }

  return (
    <Card ref={card} tone={done ? 'mint' : 'white'} riseIndex={3} className={`checklist ${done ? 'checklist--done' : ''}`} aria-labelledby="checklist-title">
      <header className="checklist__head">
        <h2 id="checklist-title" className="t-heading-m">
          {phase ? `${phase.name} checklist` : 'Checklist'}
        </h2>
        <span className="checklist__count num" ref={countRef}>
          {count} / {todo.length}
        </span>
      </header>
      {todo.length ? (
        <ul className="checklist__items">
          {todo.map((item, i) => (
            <li key={i}>
              <Checkbox checked={ticked.has(i)} onChange={(e) => void toggle(i, e.target.checked)} label={item} disabled={saved === undefined} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="checklist__empty">Nothing to tick for this phase. Add to-dos in Raise settings.</p>
      )}
      {done ? (
        <p className={`checklist__banner ${celebrate ? 'm-rise' : ''}`}>
          <Icon name="spark" size={18} className={`checklist__spark ${celebrate ? 'is-twinkle' : ''}`} />
          {phase!.name}’s done.{next ? ` ${next.name} is ready to fly.` : ' Nice work.'}
        </p>
      ) : null}
    </Card>
  )
}

const METRIC_ROWS: { m: Metric; label: string }[] = [
  { m: 'count', label: 'Names on the list' },
  { m: 'pathed', label: 'With a warm path' },
]

function ListCard({ round: r, today }: { round: Round; today: string }) {
  const { investors, acts } = useRaise()
  const empty = investors.length === 0
  const t = totals(investors, r, today)
  const next = nextPhase(r, today)
  const waveIx = next ? r.waves.findIndex((w) => w.trim().toLowerCase() === next.name.trim().toLowerCase()) : -1
  const waveNames = waveIx >= 0 ? investors.filter((i) => i.wave === waveIx + 1 && i.stage === 'todo').length : 0
  return (
    <Card riseIndex={4} className="list-card" aria-labelledby="list-title">
      <h2 id="list-title" className="t-heading-m">
        The list
      </h2>
      <div className="list-card__rows">
        {METRIC_ROWS.map(({ m, label }) => {
          // The target comes from whichever phase sets one for this measure (the current phase first).
          const ph = [phaseOn(r, today), ...r.phases].find((p) => p?.targets.some((x) => x.m === m))
          const tgt = ph?.targets.find((x) => x.m === m)
          const goal = tgt ? targetValue(r, tgt) : 0
          const have = ph ? phaseActual(ph, m, investors, acts, t.committed) : 0
          return (
            <div key={m} className="meter">
              <div className="meter__top">
                <span>{label}</span>
                <span className="meter__n num">
                  {have} / {goal || '–'}
                </span>
              </div>
              <div className="meter__track">
                <div className="meter__fill" style={{ width: `${goal ? Math.min(100, (have / goal) * 100) : 0}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      <div className="list-card__foot">
        <p>
          {empty
            ? 'Start with a CSV of names, or add them one by one.'
            : next
              ? waveIx >= 0
                ? `${next.name} opens ${dayMonth(next.from)} with ${waveNames} name${waveNames === 1 ? '' : 's'}.`
                : `${next.name} starts ${dayMonth(next.from)}.`
              : `${investors.length} names tracked.`}
        </p>
        {empty ? (
          <Link to="/raise/investors" search={{ import: true }} className={buttonClass({ variant: 'secondary' })}>
            Import a CSV
          </Link>
        ) : null}
      </div>
    </Card>
  )
}

function UpNextCard({ round: r, roundExists, today }: { round: Round; roundExists: boolean; today: string }) {
  const { investors } = useRaise()
  // Until the round is set up its phases are placeholders, so only real next steps count.
  const items = upNext(investors, roundExists ? r.phases : [], today)
  return (
    <Card tone="peach" riseIndex={5} className="upnext" aria-labelledby="upnext-title">
      <h2 id="upnext-title" className="t-heading-m">
        Up next
      </h2>
      {items.length ? (
        <ul className="upnext__list">
          {items.map((x) => (
            <li key={x.kind + x.id}>
              <span className="upnext__date">{monDay(x.date)}</span>
              <span className="upnext__text">{x.text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="upnext__empty">
          <NestEmpty size={96} />
          <div>
            <p className="upnext__empty-title">Nothing on the calendar yet.</p>
            <p>Dates from your round phases and investor next steps land here.</p>
          </div>
        </div>
      )}
    </Card>
  )
}
