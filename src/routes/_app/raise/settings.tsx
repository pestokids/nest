import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { errorMessage, useRaise } from '../../../components/data'
import { useUI } from '../../../components/raise-ui'
import { shortDate, todayIST } from '../../../lib/dates'
import { money } from '../../../lib/money'
import { totals } from '../../../lib/pipeline'
import {
  DEFAULT_ROUND, fieldLabel, isDollarMetric, METRIC_LABEL, METRICS, validateRound,
  type Metric, type Phase, type Round, type RoundErrors,
} from '../../../lib/round'
import { PIPELINE_KEYS, LABEL, type PipelineStage } from '../../../lib/stages'
import { Button } from '../../../components/ui'

export const Route = createFileRoute('/_app/raise/settings')({ component: Settings })

/** A number input that keeps what you type; reports NaN while it isn't a number, undefined when empty. */
function Num({ value, onChange, step, min, max, id, placeholder }: {
  value: number | undefined; onChange: (n: number | undefined) => void; step?: string; min?: string; max?: string; id?: string; placeholder?: string
}) {
  const [s, setS] = useState(value === undefined || Number.isNaN(value) ? '' : String(value))
  useEffect(() => {
    setS((cur) => (Number(cur) === value || (cur === '' && value === undefined) || (Number.isNaN(value) && cur !== '') ? cur : value === undefined ? '' : String(value)))
  }, [value])
  return (
    <input
      id={id} type="number" inputMode="decimal" step={step ?? 'any'} min={min} max={max} placeholder={placeholder} value={s}
      onChange={(e) => {
        setS(e.target.value)
        onChange(e.target.value === '' ? undefined : Number(e.target.value))
      }}
    />
  )
}

function Field({ label, id, err, hint, full, children }: { label: string; id: string; err?: string; hint?: ReactNode; full?: boolean; children: ReactNode }) {
  return (
    <div className={`f${full ? ' full' : ''}${err ? ' bad' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children}
      {err ? <span className="err">{err}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

const newPhase = (after?: Phase): Phase => ({
  k: 'p' + Date.now().toString(36),
  name: 'New phase',
  from: after?.to ?? todayIST(),
  to: after?.to ?? todayIST(),
  targets: [],
  todo: [],
})

function Settings() {
  const d = useRaise()
  const { toast } = useUI()
  const [draft, setDraft] = useState<Round>(d.round)
  const [errors, setErrors] = useState<RoundErrors>({})
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const log = d.useSettingsLog()

  // Follow live changes (another tab) until you start editing.
  useEffect(() => {
    if (!dirty) setDraft(d.round)
  }, [d.round, dirty])

  const edit = (fn: (r: Round) => Round) => {
    setDirty(true)
    setDraft((r) => {
      const next = fn(r)
      if (Object.keys(errors).length) setErrors(validateRound(next))
      return next
    })
  }
  const setTop = <K extends keyof Round>(k: K, v: Round[K]) => edit((r) => ({ ...r, [k]: v }))
  const setPhase = (ix: number, fn: (p: Phase) => Phase) => edit((r) => ({ ...r, phases: r.phases.map((p, i) => (i === ix ? fn(p) : p)) }))
  const movePhase = (ix: number, by: number) =>
    edit((r) => {
      const ps = [...r.phases]
      const [p] = ps.splice(ix, 1)
      ps.splice(ix + by, 0, p)
      return { ...r, phases: ps }
    })

  async function save() {
    const e = validateRound(draft)
    setErrors(e)
    if (Object.keys(e).length) return toast({ tone: 'error', message: 'Fix the highlighted fields' })
    setBusy(true)
    try {
      const n = await d.updateRound(draft)
      setDirty(false)
      toast(n ? `Saved ${n} change${n === 1 ? '' : 's'}` : 'No changes')
    } catch (err) {
      const data = (err as { data?: { errors?: RoundErrors } }).data
      if (data?.errors) setErrors(data.errors)
      toast({ tone: 'error', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  const preview = totals(d.investors, draft.target > 0 ? draft : d.round, todayIST())
  const errCount = Object.keys(errors).length

  return (
    <section className="settings">
      <div className="panel">
        <header>
          <h2>Round</h2>
          <span className="muted">every number and date on the tracker comes from here</span>
        </header>
        <div className="pad">
          <div className="fgrid">
            <Field label="Raise target ($)" id="s-target" err={errors.target} hint={draft.target > 0 ? `${money(draft.target)} · still to raise ${money(preview.need)}` : undefined}>
              <Num id="s-target" step="50000" min="0" value={draft.target} onChange={(v) => setTop('target', v ?? NaN)} />
            </Field>
            <Field label="Stretch, maximum ($)" id="s-stretch" err={errors.stretch} hint={draft.stretch > 0 ? money(draft.stretch) : undefined}>
              <Num id="s-stretch" step="50000" min="0" value={draft.stretch} onChange={(v) => setTop('stretch', v ?? NaN)} />
            </Field>
            <Field label="Kickoff date" id="s-kickoff" err={errors.kickoff}>
              <input id="s-kickoff" type="date" value={draft.kickoff} onChange={(e) => setTop('kickoff', e.target.value)} />
            </Field>
            <Field label="Close date" id="s-deadline" err={errors.deadline} hint={draft.deadline ? shortDate(draft.deadline) : undefined}>
              <input id="s-deadline" type="date" value={draft.deadline} onChange={(e) => setTop('deadline', e.target.value)} />
            </Field>
            <Field label="Instrument" id="s-instrument" err={errors.instrument}>
              <input id="s-instrument" placeholder="post-money SAFE" value={draft.instrument} onChange={(e) => setTop('instrument', e.target.value)} />
            </Field>
            <Field label="Gone quiet after (days)" id="s-quiet" err={errors.quietDays}>
              <Num id="s-quiet" step="1" min="1" value={draft.quietDays} onChange={(v) => setTop('quietDays', v ?? NaN)} />
            </Field>
            <Field label="Valuation cap ($, optional)" id="s-cap" err={errors.cap} hint={draft.cap ? money(draft.cap) : 'Leave empty if not set'}>
              <Num id="s-cap" step="500000" min="0" value={draft.cap} onChange={(v) => setTop('cap', v)} />
            </Field>
            <Field label="Minimum check ($, optional)" id="s-min" err={errors.minCheck} hint={draft.minCheck ? money(draft.minCheck) : 'Leave empty if not set'}>
              <Num id="s-min" step="5000" min="0" value={draft.minCheck} onChange={(v) => setTop('minCheck', v)} />
            </Field>
          </div>
        </div>
      </div>

      <div className="panel">
        <header>
          <h2>Odds by stage</h2>
          <span className="muted">0 to 1; weights the pipeline</span>
        </header>
        <div className="pad">
          <div className="odds">
            {PIPELINE_KEYS.map((k: PipelineStage) => (
              <Field key={k} label={LABEL[k]} id={`s-odds-${k}`} err={errors[`odds.${k}`]}>
                <Num id={`s-odds-${k}`} step="0.01" min="0" max="1" value={draft.odds[k]} onChange={(v) => edit((r) => ({ ...r, odds: { ...r.odds, [k]: v ?? NaN } }))} />
              </Field>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <header>
          <h2>Waves</h2>
          <span className="muted">labels in the investor form</span>
        </header>
        <div className="pad">
          <div className="fgrid">
            {draft.waves.map((w, ix) => (
              <Field key={ix} label={`Wave ${ix + 1}`} id={`s-wave-${ix}`} err={errors[`waves.${ix}`]}>
                <input id={`s-wave-${ix}`} value={w} onChange={(e) => edit((r) => ({ ...r, waves: r.waves.map((x, i) => (i === ix ? e.target.value : x)) }))} />
              </Field>
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <header>
          <h2>Phases and targets</h2>
          <span className="muted">dollar targets are a share of the raise target</span>
        </header>
        <div className="pad">
          {errors.phases ? <span className="err">{errors.phases}</span> : null}
          {draft.phases.map((p, ix) => {
            const at = `phases.${ix}`
            return (
              <div className="ph" key={p.k}>
                <div className="top">
                  <span className="eyebrow">Phase {ix + 1}</span>
                  <span className="sp" />
                  <Button variant="secondary" size="sm" type="button" disabled={ix === 0} onClick={() => movePhase(ix, -1)} aria-label={`Move ${p.name} up`}>↑</Button>
                  <Button variant="secondary" size="sm" type="button" disabled={ix === draft.phases.length - 1} onClick={() => movePhase(ix, 1)} aria-label={`Move ${p.name} down`}>↓</Button>
                  <Button variant="ghost" size="sm" className="btn--danger" type="button" onClick={() => edit((r) => ({ ...r, phases: r.phases.filter((_, i) => i !== ix) }))}>Remove</Button>
                </div>
                <div className="fgrid">
                  <Field label="Name" id={`s-${p.k}-name`} err={errors[`${at}.name`]} full>
                    <input id={`s-${p.k}-name`} value={p.name} onChange={(e) => setPhase(ix, (x) => ({ ...x, name: e.target.value }))} />
                  </Field>
                  <Field label="Starts" id={`s-${p.k}-from`} err={errors[`${at}.from`]}>
                    <input id={`s-${p.k}-from`} type="date" value={p.from} onChange={(e) => setPhase(ix, (x) => ({ ...x, from: e.target.value }))} />
                  </Field>
                  <Field label="Ends" id={`s-${p.k}-to`} err={errors[`${at}.to`]}>
                    <input id={`s-${p.k}-to`} type="date" value={p.to} onChange={(e) => setPhase(ix, (x) => ({ ...x, to: e.target.value }))} />
                  </Field>
                </div>
                <div className="eyebrow">Targets</div>
                {p.targets.map((x, j) => {
                  const te = errors[`${at}.targets.${j}.t`]
                  const le = errors[`${at}.targets.${j}.l`]
                  const dollar = isDollarMetric(x.m)
                  const setT = (fn: (t: typeof x) => typeof x) => setPhase(ix, (ph) => ({ ...ph, targets: ph.targets.map((y, k) => (k === j ? fn(y) : y)) }))
                  return (
                    <div key={j}>
                      <div className="tg">
                        <input aria-label="Target label" value={x.l} onChange={(e) => setT((y) => ({ ...y, l: e.target.value }))} />
                        <select aria-label="Measures" value={x.m} onChange={(e) => setT((y) => ({ ...y, m: e.target.value as Metric }))}>
                          {METRICS.map((m) => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
                        </select>
                        <Num value={x.t} step={dollar ? '0.05' : '1'} min="0" placeholder={dollar ? 'share, e.g. 0.15' : 'count'} onChange={(v) => setT((y) => ({ ...y, t: v ?? NaN }))} />
                        <Button variant="ghost" size="sm" className="btn--danger" type="button" aria-label="Remove target" onClick={() => setPhase(ix, (ph) => ({ ...ph, targets: ph.targets.filter((_, k) => k !== j) }))}>×</Button>
                      </div>
                      {le || te ? <span className="err">{le || te}</span> : dollar && x.t > 0 && draft.target > 0 ? <span className="hint">{Math.round(x.t * 100)}% of the target = {money(x.t * draft.target)}</span> : null}
                    </div>
                  )
                })}
                <div>
                  <Button variant="secondary" size="sm" type="button" onClick={() => setPhase(ix, (ph) => ({ ...ph, targets: [...ph.targets, { l: '1st meetings', m: 'stage:m1', t: 10 }] }))}>
                    + Target
                  </Button>
                </div>
                <Field label="To-do list (one per line)" id={`s-${p.k}-todo`} full>
                  <textarea id={`s-${p.k}-todo`} value={p.todo.join('\n')} onChange={(e) => setPhase(ix, (x) => ({ ...x, todo: e.target.value.split('\n') }))} />
                </Field>
              </div>
            )
          })}
          <div>
            <Button variant="secondary" size="sm" type="button" onClick={() => edit((r) => ({ ...r, phases: [...r.phases, newPhase(r.phases.at(-1))] }))}>
              + Add phase
            </Button>
          </div>
        </div>
      </div>

      <div className="actions">
        <Button variant="primary" type="button" onClick={save} disabled={busy}>
          Save round settings
        </Button>
        <Button variant="secondary" type="button" disabled={!dirty} onClick={() => { setDraft(d.round); setErrors({}); setDirty(false) }}>
          Discard changes
        </Button>
        <Button variant="secondary" size="sm" type="button" onClick={() => edit(() => DEFAULT_ROUND)}>
          Fill in defaults
        </Button>
        {errCount ? <span className="err">{errCount} field{errCount === 1 ? '' : 's'} to fix</span> : dirty ? <span className="muted">Unsaved changes</span> : null}
        {!d.roundExists ? <span className="muted">Showing defaults; nothing saved yet.</span> : null}
      </div>

      <div className="panel">
        <header>
          <h2>Recent changes</h2>
          <span className="muted">who changed what</span>
        </header>
        <div className="body">
          {log === undefined ? null : log.length ? (
            <div className="tbl" style={{ border: 0 }}>
              <table style={{ minWidth: 560 }}>
                <thead><tr><th>When</th><th>Who</th><th>Field</th><th>From</th><th>To</th></tr></thead>
                <tbody>
                  {log.map((x) => (
                    <tr key={x._id} style={{ cursor: 'default' }}>
                      <td className="num">{new Date(x.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                      <td>{x.by}</td>
                      <td>{fieldLabel(x.field)}</td>
                      <td className="mono">{x.from || '–'}</td>
                      <td className="mono">{x.to || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No changes yet.</div>
          )}
        </div>
      </div>
    </section>
  )
}
