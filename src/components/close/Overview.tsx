// Close › overview (screens/raise-close/overview.png; phones: */close.png): the
// money ladder, the five rungs and the closing table with each row's next action.
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ACTION_LABEL, ladder, RUNG_LABEL, RUNGS, safeStatus, stepMap, termsLine, wireStatus, type CloseRow, type Rung } from '../../lib/close'
import { closeDue, dueText, istParts, oversubscribed, trancheOf } from '../../lib/closeKit'
import { dayDiff, formatDay, todayIST } from '../../lib/dates'
import { subLine } from '../../lib/investorView'
import { money } from '../../lib/money'
import { rise, useCountUp, useInView } from '../../lib/motion'
import { closePreview, isKitState } from '../../preview/closeFixture'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Button, buttonClass, Chip, type ChipTone } from '../ui'
import { useClose } from './CloseData'
import { ClosingPanel } from './ClosingPanel'
import { openCloseKit } from './openKit'
import { RecordDialog } from './RecordDialog'
import { ReminderDialog } from './ReminderDialog'
import { useTick } from './useTick'

export const RUNG_COLOR: Record<Rung, string> = { soft: '#d4e6cf', verbal: '#8fc49c', sent: '#14a35a', signed: '#0d7a4b', wired: 'var(--brand-lime)' }
const RUNG_TONE: Record<Rung, ChipTone> = { soft: 'muted', verbal: 'neutral', sent: 'live', signed: 'success', wired: 'selected' }

type Open = { kind: 'record' | 'remind' | 'panel'; investorId: string } | null

/** ?preview&close=record|status|remind opens that dialog once per page load. */
let previewDialogShown = false

export function Overview() {
  const d = useRaise()
  const c = useClose()
  const ui = useUI()
  const tick = useTick()
  const today = todayIST()
  const l = useMemo(() => ladder(d.investors, c.closings), [d.investors, c.closings])
  const [open, setOpen] = useState<Open>(null)
  const row = open ? l.rows.find((r) => r.investor._id === open.investorId) : undefined

  // ?preview&close=kit|kit-sent (PST-291): the Close kit on Heron Angels, once.
  useEffect(() => {
    const p = closePreview()
    const heron = l.rows.find((r) => r.investor.name === 'Heron Angels')
    if (previewDialogShown || !isKitState(p) || !heron) return
    previewDialogShown = true
    openCloseKit(heron.investor._id)
  }, [l.rows])

  // ?preview&close=record|status|remind: open that dialog once, on Marigold (or the first to record).
  useEffect(() => {
    const p = closePreview()
    if (previewDialogShown || !p || !['record', 'status', 'remind'].includes(p)) return
    const pick = p === 'record' ? l.rows.find((r) => r.action === 'record') : l.rows.find((r) => r.rung === 'sent')
    if (!pick) return
    previewDialogShown = true
    setOpen({ kind: p === 'status' ? 'panel' : (p as 'record' | 'remind'), investorId: pick.investor._id })
  }, [l.rows])

  const act = (r: CloseRow, el: HTMLElement) => {
    if (needsKit(r)) return openCloseKit(r.investor._id)
    if (r.action === 'confirm') return ui.open(r.investor._id)
    if (r.action === 'record') return setOpen({ kind: 'record', investorId: r.investor._id })
    if (r.action === 'remind') return setOpen({ kind: 'remind', investorId: r.investor._id })
    if (r.closing && (r.action === 'countersign' || r.action === 'wired'))
      void tick(r.closing, r.investor.name, r.action === 'countersign' ? 'countersigned' : 'wired', today, { from: el, undo: true })
  }
  const openRow = (r: CloseRow) => (r.rung === 'soft' ? ui.open(r.investor._id) : setOpen({ kind: 'panel', investorId: r.investor._id }))

  return (
    <div className="close-ov">
      <Hero committed={l.committed} total={l.total} rungs={l.rungs} today={today} />
      <ul className="close-rungs" aria-label="The money ladder">
        {RUNGS.map((k, i) => (
          <li key={k} className={`close-rung close-rung--${k} m-rise`} style={rise(i + 1)}>
            <span className="close-rung__label">
              <span className="close-dot" style={{ background: RUNG_COLOR[k] }} aria-hidden="true" />
              {RUNG_LABEL[k]}
            </span>
            <span className="close-rung__amount num">{money(l.rungs[k].amount)}</span>
            <span className="close-rung__count">
              {l.rungs[k].count} investor{l.rungs[k].count === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>

      {oversubscribed(l.total, d.round.stretch) ? (
        <section className="kit-over card m-rise" aria-label="Oversubscribed">
          <div>
            <p className="eyebrow-mono">Oversubscribed</p>
            <p>
              {money(l.total)} wanted against {money(d.round.stretch)} of room. Decide who gets what before anyone signs.
            </p>
          </div>
          <Link to="/raise/close" search={{ view: 'allocation' }} className={buttonClass({ variant: 'primary' })}>
            Allocate
          </Link>
        </section>
      ) : null}
      <DueSteps />

      <header className="close-head">
        <div>
          <h2>Commitments</h2>
          <p>Every number someone has said, from a soft circle to money in the bank.</p>
        </div>
      </header>

      {l.rows.length ? (
        <div className="close-table card" role="table" aria-label="Commitments">
          <div className="close-tr close-tr--head" role="row">
            {['Investor', 'Amount', 'Stage', 'Terms', 'SAFE', 'Wire', ''].map((h, i) => (
              <span key={i} role="columnheader" className={i === 6 ? 'sr-only-cell' : undefined}>
                {h || <span className="sr-only">Next step</span>}
              </span>
            ))}
          </div>
          {l.rows.map((r, i) => {
            const safe = safeStatus(r.closing, today)
            return (
              <div key={r.investor._id} className="close-tr m-rise" role="row" style={rise(Math.min(i, 8))} onClick={() => openRow(r)}>
                <span role="cell" className="close-td-name">
                  <button type="button" className="close-name" onClick={(e) => {
                    e.stopPropagation()
                    openRow(r)
                  }}>
                    <strong>{r.investor.name}</strong>
                    <small>{subLine(r.investor) || '–'}</small>
                  </button>
                </span>
                <span role="cell" className="close-td-amount num">
                  {money(r.amount)}
                </span>
                <span role="cell">
                  <Chip tone={RUNG_TONE[r.rung]} dot={r.rung === 'sent' || r.rung === 'signed'} className="chip--sm">
                    {RUNG_LABEL[r.rung]}
                  </Chip>
                </span>
                <span role="cell" className="close-td-terms">
                  {r.rung === 'soft' ? '–' : termsLine(r.closing ?? (d.round.cap ? { cap: d.round.cap, instrument: d.round.instrument } : null))}
                  {r.closing && trancheOf(r.closing) === 2 ? <small className="kit-t2">Tranche 2</small> : null}
                </span>
                <span role="cell" className={`close-td-safe${safe.waiting ? ' is-waiting' : ''}`}>
                  {r.rung === 'soft' ? '–' : safe.text}
                </span>
                <span role="cell" className="close-td-wire">
                  {r.rung === 'soft' ? '–' : wireStatus(r.closing, today)}
                </span>
                <span role="cell" className="close-td-act" onClick={(e) => e.stopPropagation()}>
                  <RowAction row={r} onAct={act} />
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="close-empty card">
          <h3>Nobody in Verbal yet</h3>
          <p>When someone says a number, move them to Verbal on the pipeline. They show up here with their amount, and you record the SAFE when it goes out.</p>
          <Link to="/raise/pipeline" className={buttonClass({ variant: 'secondary' })}>
            Open Pipeline
          </Link>
        </div>
      )}

      <ul className="close-cards" aria-label="Commitments">
        {l.rows.map((r, i) => {
          const safe = safeStatus(r.closing, today)
          return (
            <li key={r.investor._id} className="close-card m-rise" style={rise(Math.min(i, 8))}>
              <button type="button" className="close-card__open" onClick={() => openRow(r)} aria-label={`Open ${r.investor.name}`} />
              <div className="close-card__top">
                <strong>{r.investor.name}</strong>
                <span className="num">{money(r.amount)}</span>
              </div>
              <div className="close-card__bottom">
                <div>
                  <Chip tone={RUNG_TONE[r.rung]} dot={r.rung === 'sent' || r.rung === 'signed'} className="chip--sm">
                    {RUNG_LABEL[r.rung]}
                  </Chip>
                  <span className={`close-card__status${safe.waiting ? ' is-waiting' : ''}`}>{r.rung === 'soft' ? 'Soft circle · confirm it' : r.rung === 'wired' ? wireStatus(r.closing, today) : safe.text}</span>
                </div>
                <RowAction row={r} onAct={act} />
              </div>
            </li>
          )
        })}
      </ul>

      {open?.kind === 'record' && row ? <RecordDialog row={row} onClose={() => setOpen(null)} onSaved={() => setOpen({ kind: 'panel', investorId: row.investor._id })} /> : null}
      {open?.kind === 'remind' && row?.closing ? <ReminderDialog row={row} closing={row.closing} onClose={() => setOpen(null)} /> : null}
      {open?.kind === 'panel' && row ? (
        <ClosingPanel row={row} onClose={() => setOpen(null)} onRecord={() => setOpen({ kind: 'record', investorId: row.investor._id })} onRemind={() => setOpen({ kind: 'remind', investorId: row.investor._id })} />
      ) : null}
    </div>
  )
}

/** PST-291: a verbal with nothing in writing yet: the row offers the Close kit before the SAFE. */
const needsKit = (r: CloseRow) => r.rung === 'verbal' && !r.closing?.confirmationSentAt && !stepMap(r.closing).sent

function RowAction({ row, onAct }: { row: CloseRow; onAct: (r: CloseRow, el: HTMLElement) => void }) {
  if (!row.action) return <span className="close-done">Money in</span>
  if (needsKit(row))
    return (
      <Button variant="primary" size="sm" className="close-act" onClick={(e) => onAct(row, e.currentTarget)}>
        Confirm in writing
      </Button>
    )
  const variant = row.action === 'record' || row.action === 'countersign' ? 'primary' : row.action === 'confirm' ? 'ghost' : 'secondary'
  return (
    <Button variant={variant} size="sm" className="close-act" onClick={(e) => onAct(row, e.currentTarget)}>
      {ACTION_LABEL[row.action]}
    </Button>
  )
}

/** PST-291: close steps due today or overdue (the same list PST-297's Inbox reads), each opening the Close kit. */
function DueSteps() {
  const d = useRaise()
  const c = useClose()
  const [now] = useState(() => Date.now())
  const due = useMemo(() => closeDue(now, { investors: d.investors, closings: c.closings, acts: d.acts }), [now, d.investors, c.closings, d.acts])
  if (!due.length) return null
  return (
    <section className="kit-due card m-rise" aria-label="Close steps due">
      <p className="eyebrow-mono">Due in the close · {due.length}</p>
      <ul>
        {due.map((x) => (
          <li key={x.investorId + x.step}>
            <span>
              <strong>{x.name}</strong> · {x.label}
            </span>
            <span className="kit-due__when">{x.overdue ? 'Overdue · was due ' + istParts(x.dueAt).weekday + ' ' + istParts(x.dueAt).time : dueText({ key: x.step, done: false, dueAt: x.dueAt, projected: false }, now)}</span>
            <Button size="sm" variant="secondary" onClick={() => openCloseKit(x.investorId)}>
              Open kit
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The forest card: committed, the ladder bar with the target, and what's left to raise. */
function Hero({ committed, total, rungs, today }: { committed: number; total: number; rungs: ReturnType<typeof ladder>['rungs']; today: string }) {
  const { round } = useRaise()
  const shown = useCountUp(committed)
  const [bar, seen] = useInView<HTMLDivElement>()
  const scale = Math.max(round.stretch, total, 1)
  const need = Math.max(0, round.target - committed)
  const days = dayDiff(round.deadline, today)
  return (
    <section className="close-hero card card--forest m-rise" aria-label="Committed so far">
      <div className="close-hero__main">
        <p className="close-hero__money">
          <span className="close-hero__n num">{money(shown)}</span>
          <span className="close-hero__of">
            committed of {money(round.target)} · room to {money(round.stretch)}
          </span>
          <span className="close-hero__togo">{need ? `${money(need)} to go` : 'Target reached'}</span>
        </p>
        <div className={`close-bar${seen ? ' is-seen' : ''}`} ref={bar} aria-hidden="true">
          {RUNGS.map((k) =>
            rungs[k].amount ? <span key={k} className="close-bar__seg" style={{ '--w': `${(rungs[k].amount / scale) * 100}%`, background: RUNG_COLOR[k] } as CSSProperties} /> : null,
          )}
          <span className="close-bar__target" style={{ left: `${Math.min(100, (round.target / scale) * 100)}%` }}>
            <span>Target {money(round.target)}</span>
          </span>
        </div>
        <ul className="close-legend">
          {RUNGS.map((k) => (
            <li key={k}>
              <span className="close-dot" style={{ background: RUNG_COLOR[k] }} aria-hidden="true" />
              {RUNG_LABEL[k]} {money(rungs[k].amount)}
            </li>
          ))}
        </ul>
      </div>
      <div className="close-hero__side">
        <span className={`close-hero__gap num${need ? '' : ' is-hit'}`}>{need ? money(need) : 'Target hit'}</span>
        <p>
          {need ? 'to reach the target.' : `${money(committed - round.target)} over the target.`}
          <br />
          Close by {formatDay(round.deadline)} · {days >= 0 ? `${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} late`}.
        </p>
      </div>
    </section>
  )
}
