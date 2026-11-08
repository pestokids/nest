import { useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { formatDay } from '../../lib/dates'
import { goalLabel } from '../../lib/plan'
import { isDollarMetric, METRIC_LABEL, METRICS, type Metric, type Phase, type PhaseTarget, type Round, type RoundErrors } from '../../lib/round'
import { money } from '../../lib/money'
import { Button, Icon } from '../ui'
import { NumberInput } from './inputs'


type Props = {
  round: Round
  errors: RoundErrors
  show: (key: string) => boolean
  touch: (key: string) => void
  onChange: (phases: Phase[]) => void
}

/**
 * The phases in Settings (raise-settings/default.png): drag to reorder (or
 * focus the handle and use ↑/↓), the pencil opens the phase's fields under its
 * row, the bin removes it. Nothing is stored until Save changes.
 */
export function PhaseList({ round, errors, show, touch, onChange }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const list = useRef<HTMLOListElement>(null)
  const phases = round.phases

  const move = (from: number, to: number) => {
    if (to < 0 || to >= phases.length || from === to) return
    const ps = [...phases]
    const [p] = ps.splice(from, 1)
    ps.splice(to, 0, p)
    onChange(ps)
  }
  const set = (ix: number, fn: (p: Phase) => Phase) => onChange(phases.map((p, i) => (i === ix ? fn(p) : p)))

  const startDrag = (e: RPointerEvent, k: string) => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget as HTMLElement
    handle.setPointerCapture(e.pointerId)
    setDragging(k)
    let order = phases
    const onMove = (ev: PointerEvent) => {
      const rows = [...(list.current?.querySelectorAll<HTMLElement>(':scope > li') ?? [])]
      const from = order.findIndex((p) => p.k === k)
      let to = rows.findIndex((r) => {
        const b = r.getBoundingClientRect()
        return ev.clientY < b.top + b.height / 2
      })
      if (to === -1) to = rows.length - 1
      if (to !== from) {
        const ps = [...order]
        const [p] = ps.splice(from, 1)
        ps.splice(to, 0, p)
        order = ps
        onChange(ps)
      }
    }
    const end = () => {
      setDragging(null)
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  return (
    <ol className="set-phases" ref={list}>
      {phases.map((p, ix) => {
        const at = `phases.${ix}`
        const bad = Object.keys(errors).some((k) => k.startsWith(at + '.') && show(k))
        const open = editing === p.k || bad
        return (
          <li key={p.k} className={`set-phase${dragging === p.k ? ' is-dragging' : ''}${bad ? ' is-bad' : ''}${open ? ' is-open' : ''}`}>
            <div className="set-phase__row">
              <button
                type="button"
                className="set-phase__drag"
                aria-label={`Reorder ${p.name || 'phase'} (use the arrow keys)`}
                onPointerDown={(e) => startDrag(e, p.k)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault()
                    move(ix, ix + (e.key === 'ArrowUp' ? -1 : 1))
                    requestAnimationFrame(() => list.current?.querySelectorAll<HTMLElement>('.set-phase__drag')[ix + (e.key === 'ArrowUp' ? -1 : 1)]?.focus())
                  }
                }}
              >
                <Icon name="drag" size={18} />
              </button>
              <span className="set-phase__name">{p.name || 'Untitled phase'}</span>
              <span className="set-phase__dates">
                {formatDay(p.from)} <Icon name="arrow-right" size={12} strokeWidth={2.2} /> {formatDay(p.to)}
              </span>
              <span className="set-phase__goal">{goalLabel(round, p)}</span>
              <button type="button" className="set-phase__btn" aria-label={`Edit ${p.name}`} aria-expanded={open} onClick={() => setEditing(editing === p.k ? null : p.k)}>
                <Icon name="edit" size={18} />
              </button>
              <button type="button" className="set-phase__btn" aria-label={`Remove ${p.name}`} onClick={() => onChange(phases.filter((_, i) => i !== ix))}>
                <Icon name="trash" size={18} />
              </button>
            </div>
            {open ? <PhaseEditor p={p} ix={ix} round={round} errors={errors} show={show} touch={touch} set={(fn) => set(ix, fn)} /> : null}
          </li>
        )
      })}
    </ol>
  )
}

function PhaseEditor({ p, ix, round, errors, show, touch, set }: { p: Phase; ix: number; round: Round; errors: RoundErrors; show: (k: string) => boolean; touch: (k: string) => void; set: (fn: (p: Phase) => Phase) => void }) {
  const at = `phases.${ix}`
  const err = (k: string) => (show(`${at}.${k}`) ? errors[`${at}.${k}`] : undefined)
  const setT = (j: number, fn: (t: PhaseTarget) => PhaseTarget) => set((ph) => ({ ...ph, targets: ph.targets.map((x, k) => (k === j ? fn(x) : x)) }))
  const id = (k: string) => `ph-${p.k}-${k}`
  return (
    <div className="set-phase__edit">
      <div className="set-phase__grid">
        <F id={id('name')} label="Name" err={err('name')} className="set-span-2">
          <input id={id('name')} value={p.name} onChange={(e) => set((x) => ({ ...x, name: e.target.value }))} onBlur={() => touch(`${at}.name`)} />
        </F>
        <F id={id('from')} label="Starts" err={err('from')}>
          <input id={id('from')} type="date" value={p.from} onChange={(e) => set((x) => ({ ...x, from: e.target.value }))} onBlur={() => touch(`${at}.from`)} />
        </F>
        <F id={id('to')} label="Ends" err={err('to')}>
          <input id={id('to')} type="date" value={p.to} onChange={(e) => set((x) => ({ ...x, to: e.target.value }))} onBlur={() => touch(`${at}.to`)} />
        </F>
        <F id={id('goal')} label="One line for the Plan card" className="set-span-4" help="e.g. List of 150, warm paths for 100, data room ready.">
          <input id={id('goal')} value={p.goal ?? ''} placeholder="Say what this phase is for" onChange={(e) => set((x) => ({ ...x, goal: e.target.value || undefined }))} />
        </F>
      </div>
      <p className="set-sub">Targets · the first one is the phase’s goal</p>
      {p.targets.map((x, j) => {
        const dollar = isDollarMetric(x.m)
        const e = err(`targets.${j}.l`) || err(`targets.${j}.t`)
        return (
          <div className={`set-target${e ? ' is-bad' : ''}`} key={j}>
            <span className="input">
              <input aria-label="Target label" value={x.l} onChange={(ev) => setT(j, (y) => ({ ...y, l: ev.target.value }))} onBlur={() => touch(`${at}.targets.${j}.l`)} />
            </span>
            <span className="select">
              <select aria-label="Measures" value={x.m} onChange={(ev) => setT(j, (y) => ({ ...y, m: ev.target.value as Metric }))}>
                {METRICS.map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABEL[m]}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={16} className="select__chevron" />
            </span>
            <span className="input">
              <NumberInput
                aria-label={dollar ? 'Share of the target' : 'Count'}
                value={x.t}
                placeholder={dollar ? 'share, e.g. 0.15' : 'count'}
                onChange={(v) => setT(j, (y) => ({ ...y, t: v ?? NaN }))}
                onBlur={() => touch(`${at}.targets.${j}.t`)}
              />
            </span>
            <button type="button" className="set-phase__btn" aria-label="Remove target" onClick={() => set((ph) => ({ ...ph, targets: ph.targets.filter((_, k) => k !== j) }))}>
              <Icon name="close" size={16} />
            </button>
            {e ? (
              <span className="field__error set-target__msg" role="alert">
                {e}
              </span>
            ) : dollar && x.t > 0 && round.target > 0 ? (
              <span className="field__help set-target__msg">
                {Math.round(x.t * 100)}% of the target = {money(x.t * round.target)}
              </span>
            ) : null}
          </div>
        )
      })}
      <Button variant="ghost" size="sm" icon="plus" onClick={() => set((ph) => ({ ...ph, targets: [...ph.targets, { l: '1st meetings', m: 'stage:m1', t: 10 }] }))}>
        Add a target
      </Button>
      <F id={id('todo')} label="Prep checklist (one per line)" help="Shown on Home while this phase is on.">
        <textarea id={id('todo')} className="textarea" value={p.todo.join('\n')} onChange={(e) => set((x) => ({ ...x, todo: e.target.value.split('\n') }))} />
      </F>
    </div>
  )
}

/** Label, control, then the error (slides in) or help. Matches the ui Field look. */
export function F({ id, label, err, help, className, children }: { id: string; label: string; err?: string; help?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={['field', 'set-field', err ? 'field--error' : '', className].filter(Boolean).join(' ')} data-field={id}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <span className="input">{children}</span>
      {err ? (
        <span className="field__error" role="alert">
          {err}
        </span>
      ) : help ? (
        <span className="field__help">{help}</span>
      ) : null}
    </div>
  )
}
