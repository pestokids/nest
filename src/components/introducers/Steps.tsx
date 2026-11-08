// PST-294: an intro's six steps. The panel's bar (each segment ticks or
// unticks) and the drawer's checklist with each step's day. Ticking a step
// ticks the ones before it; unticking one unticks the ones after it.
import { todayIST } from '../../lib/dates'
import type { DecisionStatus } from '../../lib/decisions'
import { dayMonth } from '../../lib/home'
import { firstName, hasDecided, lastDone, STEP_SHORT, stepLabel, STEPS, type Intro, type Step } from '../../lib/introducers'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { useUI } from '../raise-ui'
import { Checkbox } from '../ui'
import { useIntroducers } from './data'

/** Tick (today) or untick a step, with its sound; a failed write shows the save-failed toast. */
export function useToggleStep() {
  const x = useIntroducers()
  const { fail } = useUI()
  return (intro: Intro, step: Step, on: boolean) => {
    if (on) play(step === 'made' ? 'stage-up' : 'card-pickup', { rate: 1.2, volume: 0.6 })
    else play('undo', { volume: 0.6 })
    x.setStep(intro._id, step, on ? todayIST() : null).catch(fail)
  }
}

/** The panel's bar: Asked, Yes, Sent, Intro, Thanked, Reported. The last step done is lime. */
export function StepBar({ intro, label }: { intro: Intro; label: string }) {
  const toggle = useToggleStep()
  const done = lastDone(intro.steps)
  return (
    <ol className="isteps" aria-label={label}>
      {STEPS.map((s, i) => {
        const on = !!intro.steps[s]
        const state = i < done ? 'done' : i === done ? 'now' : 'todo'
        return (
          <li key={s} className={'isteps__seg isteps__seg--' + state} aria-current={state === 'now' ? 'step' : undefined}>
            <button type="button" className="isteps__btn" aria-pressed={on} onClick={() => toggle(intro, s, !on)} title={on ? 'Untick ' + STEP_SHORT[s] : 'Tick ' + STEP_SHORT[s] + ' today'}>
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
  const hint = (s: Step) => {
    if (s !== next) return ''
    if (s === 'reported') return hasDecided(investor) ? 'they’ve decided: tell ' + who : 'once ' + firstName(investor.name) + ' decides'
    if (s === 'thanked') return intro.steps.made! >= today ? 'today' : 'overdue'
    return ''
  }
  return (
    <ul className="istep-list">
      {STEPS.map((s) => {
        const day = intro.steps[s]
        const h = hint(s)
        return (
          <li key={s} className={'istep-list__row' + (day ? ' is-done' : '')}>
            <Checkbox label={stepLabel(s, who)} checked={!!day} onChange={(e) => toggle(intro, s, e.currentTarget.checked)} />
            <span className={'istep-list__day' + (h && h !== 'today' ? ' is-hint' : '') + (h === 'today' || h === 'overdue' ? ' is-hot' : '')}>{day ? dayMonth(day) : h}</span>
          </li>
        )
      })}
    </ul>
  )
}
