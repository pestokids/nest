// PST-294: an intro's six steps. The panel's bar (each segment ticks or
// unticks) and the drawer's checklist with each step's day. Ticking a step
// ticks the ones before it; unticking one unticks the ones after it.
// PST-298 (interactions-batch-1.png): a tick pops, the next step pulses lime
// once, rule-check; ticking Thanked says who to report back on.
import { useRef } from 'react'
import { formatDay, todayIST } from '../../lib/dates'
import type { DecisionStatus } from '../../lib/decisions'
import { allPeople, firstName, hasDecided, lastDone, personKey, STEP_SHORT, stepLabel, STEPS, thankedLine, type Intro, type Step } from '../../lib/introducers'
import { replay } from '../../lib/motion'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Checkbox } from '../ui'
import { useIntroducers } from './data'

/** Tick (today) or untick a step, with its sound (and Thanked's toast); a failed write shows the save-failed toast. */
export function useToggleStep() {
  const x = useIntroducers()
  const { investors } = useRaise()
  const { fail, toast } = useUI()
  return (intro: Intro, step: Step, on: boolean) => {
    if (on) play('rule-check', { volume: 0.7 })
    else play('undo', { volume: 0.6 })
    x.setStep(intro._id, step, on ? todayIST() : null).catch(fail)
    const who = allPeople(x.introducers, investors).find((p) => p.key === personKey(intro))
    const inv = investors.find((i) => i._id === intro.investorId)
    if (on && step === 'thanked' && who && inv) toast({ tone: 'info', icon: 'check', message: thankedLine(who.name, [inv.name]) })
  }
}

/** The panel's bar: Asked, Yes, Sent, Intro, Thanked, Reported. The last step done is lime. */
export function StepBar({ intro, label }: { intro: Intro; label: string }) {
  const toggle = useToggleStep()
  const done = lastDone(intro.steps)
  const ol = useRef<HTMLOListElement>(null)
  const bar = (k: number) => ol.current?.querySelectorAll('.isteps__bar')[k]
  return (
    <ol className="isteps" aria-label={label} ref={ol}>
      {STEPS.map((s, i) => {
        const on = !!intro.steps[s]
        const state = i < done ? 'done' : i === done ? 'now' : 'todo'
        return (
          <li key={s} className={'isteps__seg isteps__seg--' + state} aria-current={state === 'now' ? 'step' : undefined}>
            <button
              type="button"
              className="isteps__btn"
              aria-pressed={on}
              onClick={() => {
                toggle(intro, s, !on)
                if (on) return
                replay(bar(i), 'isteps__bar--tick')
                if (i + 1 > done) replay(bar(i + 1), 'isteps__bar--pulse')
              }}
              title={on ? 'Untick ' + STEP_SHORT[s] : 'Tick ' + STEP_SHORT[s] + ' today'}
            >
              <span className="isteps__bar" aria-hidden="true" />
              <span className="isteps__label">{STEP_SHORT[s]}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** The drawer's checklist: each step with its day, or what the next one waits on. */
export function StepList({ intro, who, investor }: { intro: Intro; who: string; investor: Pick<Investor, 'name' | 'stage'> & { decision?: DecisionStatus } }) {
  const toggle = useToggleStep()
  const today = todayIST()
  const next = STEPS[lastDone(intro.steps) + 1]
  const ul = useRef<HTMLUListElement>(null)
  const mark = (k: number) => ul.current?.querySelectorAll('.checkbox__mark')[k]
  const hint = (s: Step) => {
    if (s !== next) return ''
    if (s === 'reported') return hasDecided(investor) ? 'they’ve decided: tell ' + who : 'once ' + firstName(investor.name) + ' decides'
    if (s === 'thanked') return intro.steps.made! >= today ? 'today' : 'overdue'
    return ''
  }
  return (
    <ul className="istep-list" ref={ul}>
      {STEPS.map((s, k) => {
        const day = intro.steps[s]
        const h = hint(s)
        return (
          <li key={s} className={'istep-list__row' + (day ? ' is-done' : '')}>
            <Checkbox
              label={stepLabel(s, who)}
              checked={!!day}
              onChange={(e) => {
                const on = e.currentTarget.checked
                toggle(intro, s, on)
                if (!on) return
                replay(mark(k), 'istep-list__tick')
                if (!intro.steps[STEPS[k + 1]]) replay(mark(k + 1), 'istep-list__pulse')
              }}
            />
            <span className={'istep-list__day' + (h && h !== 'today' ? ' is-hint' : '') + (h === 'today' || h === 'overdue' ? ' is-hot' : '')}>{day ? formatDay(day) : h}</span>
          </li>
        )
      })}
    </ul>
  )
}
