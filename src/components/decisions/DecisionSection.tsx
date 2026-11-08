// PST-293: the drawer's decision (drawer-decision-lead-warm-path.png): the
// status chips, the decide-by date, the calls so far (ask or drop at the 3rd),
// how long they've been a maybe, and the latest signal Nest read.
import { useEffect, useRef } from 'react'
import { ASK_OR_DROP_CALLS, callsLine, DECIDE_BY_DAYS, DECISION_LABEL, DECISION_STATUSES, maybeDays, type DecisionStatus } from '../../lib/decisions'
import { formatDay } from '../../lib/dates'
import type { Investor } from '../../lib/pipeline'
import { signalLine } from '../../lib/signals'
import { useUI } from '../raise-ui'
import { Icon, Input } from '../ui'
import { useDecide, useDecisions } from './data'

export function DecisionSection({ inv }: { inv: Investor }) {
  const x = useDecisions()
  const decide = useDecide()
  const ui = useUI()
  const d = x.decisionOf(inv._id)
  const signal = x.latestSignal(inv)
  const date = useRef<HTMLInputElement>(null)
  // ⌘K "Set a decide-by date" and Maybes' "Set a date" open here, on the date.
  const focusDate = !!ui.opening.decide
  useEffect(() => {
    if (!focusDate) return
    const t = setTimeout(() => {
      date.current?.focus()
      try {
        date.current?.showPicker?.()
      } catch {
        /* not allowed without a click; the field still has focus */
      }
    }, 250)
    return () => clearTimeout(t)
  }, [focusDate])
  if (!x.loaded) return <section className="decision decision--loading" aria-busy="true" aria-label="The decision" />

  const pick = (s: DecisionStatus) => decide.status(inv, d.status === s ? null : s)
  const autoMade = signal && signal.outcome === 'auto' && !signal.undoneAt && signal.change && d.status === signal.change.to
  const calls = Math.min(d.calls, ASK_OR_DROP_CALLS)
  return (
    <section className="decision" aria-labelledby={'decision-' + inv._id}>
      <div className="decision__top">
        <div className="decision__status">
          <h3 id={'decision-' + inv._id} className="decision__eyebrow eyebrow-mono">
            The decision
          </h3>
          <div className="decision__chips" role="radiogroup" aria-label={'Decision on ' + inv.name}>
            {DECISION_STATUSES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={d.status === s} className={'chip ' + (d.status === s ? 'chip--selected' : 'chip--outline') + ' decision__chip'} onClick={() => pick(s)}>
                {DECISION_LABEL[s]}
              </button>
            ))}
          </div>
        </div>
        <div className="decision__by">
          <Input
            ref={date}
            type="date"
            label={<span className="eyebrow-mono">Decide by</span>}
            value={d.decideBy ?? ''}
            onChange={(e) => decide.decideBy(inv, e.target.value || null)}
            help={
              d.decideBy ? (
                <button type="button" className="decision__clear" onClick={() => decide.decideBy(inv, null)}>
                  {d.decideByManual ? 'Clear' : DECIDE_BY_DAYS + ' days after the 1st call · Clear'}
                </button>
              ) : undefined
            }
          />
        </div>
      </div>

      <div className="decision__calls">
        <span className="decision__label">Calls so far</span>
        <span className="decision__meter">
          <span className="decision__bar" aria-hidden="true">
            {Array.from({ length: ASK_OR_DROP_CALLS }, (_, k) => (
              <i key={k} className={k < calls ? 'is-on' : undefined} />
            ))}
          </span>
          <span className={'decision__callnote' + (d.calls >= ASK_OR_DROP_CALLS - 1 ? ' is-hot' : '')}>{callsLine(d.calls)}</span>
        </span>
      </div>

      {d.status === 'maybe' && d.maybeSince !== undefined ? (
        <p className="decision__maybe">
          A maybe for {maybeDays(d.maybeSince, Date.now()) === 1 ? '1 day' : maybeDays(d.maybeSince, Date.now()) + ' days'}
          {d.reason ? ' · ' + d.reason : ''}
        </p>
      ) : null}

      {signal ? (
        <p className="decision__signal">
          <Icon name="spark" size={16} className="decision__spark" />
          {signalLine(signal)}
        </p>
      ) : null}

      <div className="decision__foot">
        <span className="decision__source">
          {signal ? 'Read by Nest from ' + (signal.source === 'email' ? 'their ' + formatDay(signal.day) + ' email' : 'your ' + formatDay(signal.day) + ' notes') : 'Nest reads their emails and your notes for signals.'}
          {autoMade ? (
            <>
              {' · '}
              <button type="button" className="decision__undo" onClick={() => void x.undoSignal(signal._id).catch(decide.failed)}>
                Undo
              </button>
            </>
          ) : null}
        </span>
        {d.status !== 'no' ? (
          <button type="button" className="drawer__textbtn drawer__textbtn--danger decision__no" onClick={() => decide.status(inv, 'no')}>
            Mark as no
          </button>
        ) : null}
      </div>
    </section>
  )
}

/** The drawer's History: status changes, Nest's own marked "Auto". */
export function useDecisionHistory(investorId: string) {
  const log = useDecisions().useLog(investorId)
  return (log ?? []).map((l) => ({
    key: 'dl-' + l._id,
    at: l.at,
    title: l.to ? 'Marked ' + DECISION_LABEL[l.to].toLowerCase() + (l.reason ? ' · ' + l.reason : '') : 'Cleared the decision',
    sub: [l.auto ? 'From ' + (l.source === 'email' ? 'their email' : 'your notes') : '', l.from ? 'was ' + DECISION_LABEL[l.from].toLowerCase() : '', l.undoneAt ? 'undone' : ''].filter(Boolean).join(' · '),
    by: l.by,
    auto: l.auto,
  }))
}
