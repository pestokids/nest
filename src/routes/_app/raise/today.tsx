import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRaise } from '../../../components/data'
import { GoogleToday } from '../../../components/GoogleToday'
import { MaterialOpens } from '../../../components/materials/Opens'
import { Suggestions } from '../../../components/Suggestions'
import { UnmatchedNotes } from '../../../components/qanda/UnmatchedNotes'
import { EggHatching, NestSleeping, NestWithEggs } from '../../../components/illustrations'
import { PhaseBar } from '../../../components/PhaseBar'
import { usePreviewState } from '../../../components/preview-state'
import { openOnKey, useUI } from '../../../components/raise-ui'
import { Badge, Button, buttonClass, Card, Checkbox, Chip, Icon, KpiCard } from '../../../components/ui'
import { dayDiff, todayIST } from '../../../lib/dates'
import { dayMonth } from '../../../lib/home'
import { confetti, pop, usePop } from '../../../lib/motion'
import { money } from '../../../lib/money'
import { dueDate, dueList, fieldsOf, funnel, quietList, totals, type Investor } from '../../../lib/pipeline'
import { play } from '../../../lib/sound'
import { STAGE_RULE, STAGE_TILE, type PipelineStage } from '../../../lib/stages'
import { addDays, daysLine, kpis, movesNote, nextMoves, quietDays, type Move } from '../../../lib/today'

export const Route = createFileRoute('/_app/raise/today')({ component: Today })

/** How long the win toast shows; the summary card's Pesto steps aside for Cheer Pesto meanwhile. */
const WIN_MS = 4000

function Today() {
  const d = useRaise()
  const ui = useUI()
  const preview = usePreviewState()
  const [today] = useState(() => todayIST())
  const r = d.round

  // Log the ask (the win): the button becomes the confirmation, confetti from it, sound, Cheer toast.
  const [asked, setAsked] = useState<ReadonlySet<string>>(() => new Set())
  const [winning, setWinning] = useState(false)
  const winTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(winTimer.current), [])
  const moves = useMemo(() => nextMoves({ investors: d.investors, acts: d.acts, round: r, today }, asked), [d.investors, d.acts, r, today, asked])

  const logAsk = useCallback(
    async (id: string, from: HTMLElement | null) => {
      const i = d.investors.find((x) => x._id === id)
      if (!i || asked.has(id)) return
      setAsked((s) => new Set(s).add(id))
      play('ask-logged')
      play('confetti', { delay: 0.15, volume: 0.7 })
      confetti(from)
      setWinning(true)
      clearTimeout(winTimer.current)
      winTimer.current = setTimeout(() => setWinning(false), WIN_MS)
      const follow = addDays(today, 3)
      ui.toast({ tone: 'win', message: `Ask logged. Follow-up set for ${dayMonth(follow)}.`, action: { label: 'View', onClick: () => ui.open(id) }, durationMs: WIN_MS })
      try {
        await d.logNote(id, 'Asked for a specific amount, confirmed in writing.', { touch: 'ask', next: { step: 'Follow up on the ask', date: follow } })
      } catch (e) {
        setAsked((s) => new Set([...s].filter((x) => x !== id)))
        setWinning(false)
        ui.fail(e)
      }
    },
    [d, asked, today, ui],
  )

  // Preview: `&today=win` plays the win once the page has risen (sounds stay gated until a gesture).
  const previewWin = preview?.today === 'win'
  useEffect(() => {
    if (!previewWin) return
    const t = setTimeout(() => {
      const ask = moves.find((m) => m.action.kind === 'ask')
      if (ask?.action.kind !== 'ask') return
      // On phones the moves are a carousel: bring the ask card into view first, as a tap would have.
      const card = document.querySelector<HTMLElement>(`[data-move="${ask.key}"]`)
      const track = card?.parentElement
      if (card && track && track.scrollWidth > track.clientWidth)
        track.scrollTo({ left: track.scrollLeft + card.getBoundingClientRect().left - track.getBoundingClientRect().left - parseFloat(getComputedStyle(track).paddingLeft), behavior: 'instant' })
      const id = ask.action.investorId
      requestAnimationFrame(() => void logAsk(id, card?.querySelector<HTMLElement>('.move__btn') ?? null))
    }, 700)
    return () => clearTimeout(t)
  }, [previewWin]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="today" aria-label="Today">
      <Suggestions today={today} />
      <Summary won={winning} today={today} />
      <Moves moves={moves} note={movesNote(r, today)} asked={asked} onAsk={logAsk} />
      <Kpis today={today} />
      <GoogleToday today={today} />
      <UnmatchedNotes />
      <MaterialOpens />
      <div className="today__lists">
        <DueToday today={today} />
        <GoneQuiet today={today} />
      </div>
      <Conversation />
    </section>
  )
}

/* ---------- summary card ---------- */

function Summary({ won, today }: { won: boolean; today: string }) {
  const { investors, round: r } = useRaise()
  const t = totals(investors, r, today)
  const days = Math.max(0, t.daysLeft)
  const daysRef = usePop<HTMLSpanElement>(days)
  const moneyRef = usePop<HTMLSpanElement>(t.committed)
  return (
    <Card tone="forest" riseIndex={0} className="summary" aria-label="Round summary">
      <p className="summary__money">
        <span ref={moneyRef} className="summary__committed num">
          {money(t.committed)}
        </span>
        <span className="summary__of">
          of {money(r.target)} committed<span className="only-desk"> · room to {money(r.stretch)}</span>
        </span>
      </p>
      <PhaseBar round={r} today={today} details className="summary__phases only-desk" />
      <PhaseBar round={r} today={today} short className="summary__phases only-phone" />
      <div className="summary__days">
        <span ref={daysRef} className="summary__n num">
          {days}
        </span>
        <span className="summary__line only-desk">
          {daysLine(r, today)
            .split(/(?<=\.) /)
            .map((x) => (
              <span key={x}>{x}</span>
            ))}
        </span>
        <span className="summary__line only-phone">
          {t.daysLeft < 0 ? `closed ${dayMonth(r.deadline)}` : `${days === 1 ? 'day' : 'days'} to close · ${dayMonth(r.deadline)}`}
        </span>
      </div>
      <div className="summary__mascot" aria-hidden="true">
        {won ? <EggHatching size={110} className="summary__chick" /> : <img className="summary__pesto" src="/mascot/office-salute.webp" alt="" width={224} height={240} />}
      </div>
    </Card>
  )
}

/* ---------- next moves ---------- */

function Moves({ moves, note, asked, onAsk }: { moves: Move[]; note: string; asked: ReadonlySet<string>; onAsk: (id: string, from: HTMLElement | null) => void }) {
  const [at, setAt] = useState(0)
  const track = useRef<HTMLOListElement>(null)
  const onScroll = () => {
    const el = track.current
    if (!el || !el.clientWidth) return
    setAt(Math.round(el.scrollLeft / (el.firstElementChild as HTMLElement | null)!.offsetWidth || 0))
  }
  const go = (i: number) => {
    const el = track.current
    const card = el?.children[i] as HTMLElement | undefined
    if (el && card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: 'smooth' })
  }
  if (!moves.length) return null
  return (
    <Card riseIndex={1} className="moves" aria-labelledby="moves-title">
      <header className="moves__head">
        <h2 id="moves-title" className="today__h2">
          <span className="only-desk">Your next {moves.length === 1 ? 'move' : `${moves.length} moves`}</span>
          <span className="only-phone">Your next move</span>
        </h2>
        <p className="moves__note only-desk">{note}</p>
        <p className="moves__count only-phone" aria-live="polite">
          {Math.min(at, moves.length - 1) + 1} of {moves.length}
        </p>
      </header>
      <ol className="moves__track" ref={track} onScroll={onScroll}>
        {moves.map((m, i) => (
          <MoveCard key={m.key} n={i + 1} move={m} done={m.action.kind === 'ask' && asked.has(m.action.investorId)} onAsk={onAsk} />
        ))}
      </ol>
      {moves.length > 1 ? (
        <div className="moves__dots only-phone">
          {moves.map((m, i) => (
            <button key={m.key} type="button" className={`moves__dot${i === at ? ' is-on' : ''}`} aria-label={`Move ${i + 1}`} aria-current={i === at || undefined} onClick={() => go(i)} />
          ))}
        </div>
      ) : null}
    </Card>
  )
}

/** One move: number, title, why, progress (or a mono meta line), then a divider and the action with its count. */
function MoveCard({ n, move: m, done, onAsk }: { n: number; move: Move; done: boolean; onAsk: (id: string, from: HTMLElement | null) => void }) {
  const ui = useUI()
  const btn = useRef<HTMLButtonElement>(null)
  const [filled, setFilled] = useState(false)
  useEffect(() => {
    const t = requestAnimationFrame(() => setFilled(true))
    return () => cancelAnimationFrame(t)
  }, [])
  const a = m.action
  const variant = m.tone === 'hot' ? 'orange' : 'secondary'
  let action: ReactNode
  if (a.kind === 'import') action = <Link to="/raise/investors" search={{ import: true }} className={buttonClass({ variant, className: 'move__btn' })}>{m.label}</Link>
  else if (a.kind === 'investors') action = <Link to="/raise/investors" search={{ wave: a.wave, stage: a.stage }} className={buttonClass({ variant, className: 'move__btn' })}>{m.label}</Link>
  else if (a.kind === 'pipeline') action = <Link to="/raise/pipeline" className={buttonClass({ variant, className: 'move__btn' })}>{m.label}</Link>
  else if (a.kind === 'ask')
    action = done ? (
      <Button ref={btn} variant="dark" className="move__btn move__btn--done" aria-disabled="true" icon="check">
        Ask logged. Fingers crossed.
      </Button>
    ) : (
      <Button ref={btn} variant="orange" className="move__btn" onClick={() => onAsk(a.investorId, btn.current)}>
        {m.label}
      </Button>
    )
  else if (a.kind === 'open') action = <Button variant={variant} className="move__btn" onClick={() => ui.open(a.investorId)}>{m.label}</Button>
  else action = <Button variant={variant} className="move__btn" onClick={() => document.getElementById(`today-${a.to}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{m.label}</Button>
  return (
    <li className={`move move--${m.tone}`} data-move={m.key} aria-label={`Move ${n}: ${m.title}`}>
      <span className="move__n" aria-hidden="true">
        {n}
      </span>
      <h3 className="move__title">{m.title}</h3>
      <p className="move__why">
        <span className={m.short ? 'only-desk' : undefined}>{m.why}</span>
        {m.short ? <span className="only-phone">{m.short}</span> : null}
      </p>
      {m.progress !== undefined ? (
        <div className="move__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(m.progress * 100)} aria-label={m.count}>
          <div className="move__fill" style={{ width: `${filled ? m.progress * 100 : 0}%` }} />
        </div>
      ) : m.meta ? (
        <p className="move__meta">{m.meta}</p>
      ) : null}
      <div className="move__foot">
        {action}
        <span className="move__count">{m.count}</span>
      </div>
    </li>
  )
}

/* ---------- KPIs ---------- */

function Kpis({ today }: { today: string }) {
  const { investors, round } = useRaise()
  const k = kpis(investors, round, today)
  return (
    <div className="today__kpis">
      <KpiCard riseIndex={2} label="Committed" value={k.committed.value} note={k.committed.note} />
      <KpiCard riseIndex={3} tone="warning" label="Still to raise" value={k.still.value} note={k.still.note} />
      <KpiCard riseIndex={4} tone="good" label="In conversation" value={k.talking.value} note={k.talking.note} />
      <KpiCard riseIndex={5} label="Passed" value={k.passed.value} note={k.passed.note} />
    </div>
  )
}

/* ---------- due today ---------- */

function DueToday({ today }: { today: string }) {
  const d = useRaise()
  const ui = useUI()
  const all = dueList(d.investors, today)
  // Ticked rows slide away, then stay hidden until the write lands.
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set())
  const rows = all.filter((i) => !gone.has(i._id))
  const countRef = usePop<HTMLSpanElement>(rows.length)

  async function tick(i: Investor) {
    setLeaving((s) => new Set(s).add(i._id))
    play('card-pickup', { rate: 1.2, volume: 0.6 })
    await new Promise((r) => setTimeout(r, 300))
    setGone((s) => new Set(s).add(i._id))
    try {
      if (i.stage === 'parked') {
        await d.save(i._id, { ...fieldsOf(i), parkedUntil: undefined })
        await d.logNote(i._id, 'Checked back in.', { touch: 'done' })
      } else await d.logNote(i._id, i.nextStep || 'Next step done.', { touch: 'done', next: { step: '' } })
    } catch (e) {
      setGone((s) => new Set([...s].filter((x) => x !== i._id)))
      ui.fail(e)
    } finally {
      setLeaving((s) => new Set([...s].filter((x) => x !== i._id)))
    }
  }

  return (
    <Card riseIndex={6} className="list-panel" id="today-due" aria-labelledby="due-title">
      <header className="list-panel__head">
        <h2 id="due-title" className="today__h2">
          Due today
          {rows.length ? (
            <Badge ref={countRef} className="list-panel__badge" aria-label={`${rows.length} due`}>
              {rows.length}
            </Badge>
          ) : null}
        </h2>
      </header>
      {rows.length ? (
        <ul className="rows">
          {rows.map((i) => {
            const due = dueDate(i)!
            const late = dayDiff(today, due)
            return (
              <li key={i._id} className={`due-row${leaving.has(i._id) ? ' due-row--leaving' : ''}`}>
                <Checkbox className="due-row__tick" checked={leaving.has(i._id)} onChange={() => void tick(i)} aria-label={`Done: ${i.name}, ${i.nextStep || 'next step'}`} />
                <div className="due-row__main" role="button" tabIndex={0} onClick={() => ui.open(i._id)} onKeyDown={openOnKey(() => ui.open(i._id))} aria-label={`Open ${i.name}`}>
                  <span className="row__text">
                    <span className="row__name">{i.name}</span>
                    <span className="row__sub">
                      {i.stage === 'parked' ? 'Parked until today. Check back in.' : i.nextStep || 'No next step written down'}
                      {late > 0 ? <span className="row__late"> · {late === 1 ? '1 day late' : `${late} days late`}</span> : null}
                    </span>
                  </span>
                  <Chip tone={i.stage === 'ask' || i.stage === 'parked' ? 'outline' : 'neutral'} dot={false} className="due-row__chip only-desk">
                    {STAGE_TILE[i.stage]}
                  </Chip>
                  <Icon name="chevron-right" size={20} className="due-row__chev" />
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="empty-state empty-state--cream">
          <NestSleeping size={88} />
          <div>
            <p className="empty-state__title">Nothing due. The nest is quiet.</p>
            <p>Give every live conversation a next step and a date, and it will show up here on the day.</p>
          </div>
        </div>
      )}
    </Card>
  )
}

/* ---------- gone quiet ---------- */

function GoneQuiet({ today }: { today: string }) {
  const d = useRaise()
  const ui = useUI()
  const q = d.round.quietDays
  const base = quietList(d.investors, today, q)
  // After a nudge the row stays put with its "Nudged" chip (it's no longer quiet).
  const [nudged, setNudged] = useState<ReadonlySet<string>>(() => new Set())
  const [pinned, setPinned] = useState<string[] | null>(null)
  const byId = new Map(d.investors.map((i) => [i._id, i]))
  const rows = pinned
    ? [...pinned.map((id) => byId.get(id)).filter((i): i is Investor => !!i && (nudged.has(i._id) || base.includes(i))), ...base.filter((i) => !pinned.includes(i._id))]
    : base

  async function nudge(i: Investor, el: HTMLElement | null) {
    setPinned((p) => p ?? rows.map((x) => x._id))
    setNudged((s) => new Set(s).add(i._id))
    play('nudge')
    requestAnimationFrame(() => pop(el?.closest('.quiet-row')?.querySelector('.quiet-row__nudged')))
    try {
      await d.logNote(i._id, 'Sent a nudge.', { touch: 'nudge' })
    } catch (e) {
      setNudged((s) => new Set([...s].filter((x) => x !== i._id)))
      ui.fail(e)
    }
  }

  return (
    <Card riseIndex={7} className="list-panel" id="today-quiet" aria-labelledby="quiet-title">
      <header className="list-panel__head">
        <h2 id="quiet-title" className="today__h2">
          Gone quiet
        </h2>
        <p className="list-panel__note">
          No touch in {q}+ days.<span className="only-desk"> Nudge or park.</span>
        </p>
      </header>
      {rows.length ? (
        <ul className="rows">
          {rows.map((i) => {
            const n = quietDays(i, today)
            const quietFor = n === null ? 'Never touched' : `${n} days quiet`
            return (
              <li key={i._id} className="quiet-row">
                <div className="quiet-row__main" role="button" tabIndex={0} onClick={() => ui.open(i._id)} onKeyDown={openOnKey(() => ui.open(i._id))} aria-label={`Open ${i.name}`}>
                  <span className="row__name">{i.name}</span>
                  <span className="row__sub only-desk">
                    {STAGE_TILE[i.stage]} · {i.nextStep || quietFor.toLowerCase()}
                  </span>
                  <span className="row__sub row__sub--warn only-phone">{quietFor}</span>
                </div>
                {nudged.has(i._id) ? (
                  <Chip tone="live" className="quiet-row__nudged">
                    Nudged
                  </Chip>
                ) : (
                  <Button variant="secondary" className="quiet-row__btn" onClick={(e) => void nudge(i, e.currentTarget)} aria-label={`Nudge ${i.name}`}>
                    Nudge
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="empty-state empty-state--mint">
          <NestWithEggs size={88} />
          <div>
            <p className="empty-state__title">Everyone’s warm.</p>
            <p>Every live conversation has a touch in the last {q} days. Nice.</p>
          </div>
        </div>
      )}
    </Card>
  )
}

/* ---------- how a conversation moves ---------- */

function Conversation() {
  const { investors } = useRaise()
  const steps = funnel(investors).slice(1)
  return (
    <Card riseIndex={8} className="convo" aria-labelledby="convo-title">
      <header className="convo__head">
        <h2 id="convo-title" className="today__h2">
          How a conversation moves
        </h2>
        <p className="convo__note">Number = how many have reached that stage. Move a card only when the rule is true.</p>
      </header>
      <ol className="convo__tiles">
        {steps.map((s, i) => (
          <li key={s.k} className={`convo__tile convo__tile--${i}`}>
            <span className="convo__name">{STAGE_TILE[s.k as PipelineStage]}</span>
            <span className="convo__n num">{s.n}</span>
            <span className="convo__rule">{STAGE_RULE[s.k as PipelineStage]}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

