// PST-302: the drawer's Application row, under the stage: not applied, or the
// status (submitted, interview invited or done, accepted, not accepted,
// withdrawn) with the programme and dates. Changes save at once with Undo, and
// never move the stage. Clear means "not applied".
import { useState } from 'react'
import { APPLICATION_LABEL, APPLICATION_STATUSES, applicationChip, applicationTone, isDecisionPassed, type ApplicationChanges, type ApplicationStatus } from '../../lib/applications'
import { formatDay, todayIST } from '../../lib/dates'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { errorMessage, useRaise } from '../data'
import { usePreviewState } from '../preview-state'
import { Button, Chip, Input, useToast } from '../ui'

export function ApplicationSection({ inv }: { inv: Investor }) {
  const d = useRaise()
  const toast = useToast()
  const preview = usePreviewState()
  const [editing, setEditing] = useState(preview?.drawer === 'application')
  const a = inv.application
  const today = todayIST()

  // PST-303's save rule: a status or date change writes only that field, merged with the application as it is now.
  // Clear and Undo put back a whole application.
  const write = (next: ApplicationChanges | null, message?: string) => {
    const saved = next ? d.changeApplication(inv._id, next) : d.setApplication(inv._id, null)
    saved.catch((e) => {
      play('save-failed')
      toast({ tone: 'error', message: errorMessage(e) })
    })
    if (message)
      toast({
        message,
        action: {
          label: 'Undo',
          onClick: () => {
            play('undo')
            saved.then((r) => d.setApplication(inv._id, r.before)).catch((e) => toast({ tone: 'error', message: errorMessage(e) }))
          },
        },
      })
  }
  const pick = (status: ApplicationStatus) => {
    if (a?.status === status) return
    play('card-drop', { volume: 0.6 })
    write({ status }, inv.name + ': ' + applicationChip({ ...a, status }) + '.')
  }
  const field = (k: 'program' | 'submittedOn' | 'decisionBy', value: string) => {
    if (!a || (a[k] ?? '') === value.trim()) return
    write({ [k]: value.trim() || null })
  }
  const clear = () => {
    play('card-pickup', { volume: 0.6 })
    setEditing(false)
    write(null, inv.name + ': not applied.')
  }

  if (!editing && !a)
    return (
      <div className="app-row app-row--none">
        <span className="app-row__label">Application</span>
        <span className="app-row__value">Not applied</span>
        <button type="button" className="drawer__link app-row__act" onClick={() => setEditing(true)}>
          Add an application
        </button>
      </div>
    )

  if (!editing && a) {
    const passed = isDecisionPassed(a, today)
    const meta = [a.submittedOn ? 'Submitted ' + formatDay(a.submittedOn) : '', a.decisionBy ? (passed ? 'Decision date passed · ' : 'Decision by ') + formatDay(a.decisionBy) : ''].filter(Boolean).join(' · ')
    return (
      <div className="app-row">
        <span className="app-row__label">Application</span>
        <span className="app-row__value">
          <Chip tone={applicationTone(a)} dot={false}>
            {applicationChip(a)}
          </Chip>
          {meta ? <span className={'app-row__meta' + (passed ? ' is-late' : '')}>{meta}</span> : null}
        </span>
        <button type="button" className="drawer__link app-row__act" onClick={() => setEditing(true)}>
          {passed ? 'Update status' : 'Edit'}
        </button>
      </div>
    )
  }

  return (
    <section className="app-edit" aria-labelledby={'app-' + inv._id}>
      <h3 id={'app-' + inv._id} className="app-edit__eyebrow eyebrow-mono">
        Application
      </h3>
      <p className="app-edit__note">Separate from the stage: it never moves {inv.name} along the pipeline.</p>
      <div className="app-edit__chips" role="radiogroup" aria-label={'Application status for ' + inv.name}>
        {APPLICATION_STATUSES.map((st) => (
          <button key={st} type="button" role="radio" aria-checked={a?.status === st} className={'chip ' + (a?.status === st ? 'chip--selected' : 'chip--outline') + ' app-edit__chip'} onClick={() => pick(st)}>
            {APPLICATION_LABEL[st]}
          </button>
        ))}
      </div>
      <div className="app-edit__fields">
        <Input key={'p' + (a?.program ?? '')} label="Programme" placeholder="e.g. W27" defaultValue={a?.program ?? ''} disabled={!a} onBlur={(e) => field('program', e.target.value)} />
        <Input label="Submitted" type="date" value={a?.submittedOn ?? ''} disabled={!a} onChange={(e) => field('submittedOn', e.target.value)} />
        <Input label="Decision by" type="date" value={a?.decisionBy ?? ''} disabled={!a} onChange={(e) => field('decisionBy', e.target.value)} />
      </div>
      <div className="app-edit__foot">
        <button type="button" className="drawer__textbtn" onClick={clear} disabled={!a}>
          Clear · not applied
        </button>
        <Button variant="secondary" onClick={() => setEditing(false)}>
          Done
        </Button>
      </div>
    </section>
  )
}
