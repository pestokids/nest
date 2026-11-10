import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRaise } from '../../../components/data'
import { useUI } from '../../../components/raise-ui'
import { AmountInput, NumberInput } from '../../../components/settings/inputs'
import { F, PhaseList } from '../../../components/settings/PhaseList'
import { ChangeLog, MembersCard } from '../../../components/settings/SideCards'
import { connectMessage, GoogleCard } from '../../../components/settings/GoogleCard'
import { AICard, ClaudeSees } from '../../../components/settings/AICard'
import { CapTableCard } from '../../../components/settings/CapTableCard'
import { AgentsCard, ConnectAgentCard } from '../../../components/settings/AgentsCard'
import { WisprCard } from '../../../components/settings/WisprCard'
import { FeedbackCard } from '../../../components/system/Feedback' // PST-289
import { SoundsCard } from '../../../components/settings/SoundsCard' // PST-304
import { usePreviewState } from '../../../components/preview-state'
import { useSaveAction } from '../../../components/system/useSaveAction'
import { Button, Icon } from '../../../components/ui'
import { dayDiff, todayIST } from '../../../lib/dates'
import { shake } from '../../../lib/motion'
import { diffRound, type Phase, type Round, type RoundErrors } from '../../../lib/round'
import { closeHint, errorCount, fixLine, validateRoundForm } from '../../../lib/settingsForm'
import { play } from '../../../lib/sound'
import { LABEL, PIPELINE_KEYS } from '../../../lib/stages'

export const Route = createFileRoute('/_app/raise/settings')({ component: Settings })

const INSTRUMENTS = ['post-money SAFE', 'pre-money SAFE', 'convertible note', 'priced round']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const add = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
const newPhase = (after: Phase | undefined, today: string): Phase => {
  const from = after?.to ? add(after.to, 1) : today
  return { k: 'p' + Date.now().toString(36), name: 'New phase', from, to: add(from, 6), targets: [], todo: [] }
}

/** Tidy before saving: empty goal lines and blank to-dos go. */
const tidy = (r: Round): Round => ({
  ...r,
  phases: r.phases.map(({ goal, ...p }) => ({ ...p, todo: p.todo.map((t) => t.trim()).filter(Boolean), ...(goal?.trim() ? { goal: goal.trim() } : {}) })),
})

function Settings() {
  const d = useRaise()
  const { toast } = useUI()
  const save = useSaveAction()
  const flags = usePreviewState()
  const today = todayIST()
  const log = d.useSettingsLog()
  const members = d.useMembers()

  const [draft, setDraft] = useState<Round>(d.round)
  const [dirty, setDirty] = useState(false)
  const [touched, setTouched] = useState<Set<string>>(new Set())
  const [attempted, setAttempted] = useState(false)
  const [serverErrors, setServerErrors] = useState<RoundErrors>({})
  const [busy, setBusy] = useState(false)
  const form = useRef<HTMLDivElement>(null)

  // Follow live changes (another tab) until you start editing.
  useEffect(() => {
    if (!dirty) setDraft(d.round)
  }, [d.round, dirty])

  // Back from Connect Google (?connect=ok|denied|…): say how it went once, then drop the param.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const m = connectMessage(q.get('connect'))
    if (!m) return
    toast({ tone: m.tone, ...(m.tone === 'info' ? { icon: 'check' as const } : {}), message: m.message })
    q.delete('connect')
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${q.size ? `?${q}` : ''}${window.location.hash}`)
  }, [toast])

  // ?preview&settings=errors: room-to under the target and a close date in the past.
  useEffect(() => {
    if (flags?.settings !== 'errors') return
    setDraft((r) => ({ ...r, stretch: Math.round(r.target * 0.75), deadline: add(today, -1) }))
    setDirty(true)
    setAttempted(true)
  }, [flags?.settings, today])

  const errors = useMemo(() => ({ ...validateRoundForm(draft, today, d.round), ...serverErrors }), [draft, today, d.round, serverErrors])
  const show = (k: string) => attempted || touched.has(k)
  const visible = Object.fromEntries(Object.entries(errors).filter(([k]) => show(k)))
  const changes = useMemo(() => diffRound(d.round, draft).length, [d.round, draft])

  const edit = (fn: (r: Round) => Round) => {
    setDirty(true)
    setServerErrors({})
    setDraft(fn)
  }
  const setTop = <K extends keyof Round>(k: K, v: Round[K]) => edit((r) => ({ ...r, [k]: v }))

  /** On leaving a field: if it's wrong, its message slides in and it shakes. */
  const touch = (k: string) => {
    if (touched.has(k)) return
    setTouched((t) => new Set(t).add(k))
    if (errors[k] && !attempted) flag([k])
  }
  /** PST-304: leaving a field shakes it silently; `nope` is for a save you tried. */
  const flag = (keys: string[]) =>
    requestAnimationFrame(() =>
      keys.forEach((k) => {
        const el = form.current?.querySelector(`[data-err="${CSS.escape(k)}"]`) ?? form.current?.querySelector(`[data-field="${CSS.escape(fieldId(k))}"]`)
        shake(el?.querySelector('.input, .select') ?? el)
      }),
    )
  const complain = (keys: string[]) => {
    play('nope')
    flag(keys)
  }

  async function submit() {
    const keys = Object.keys(errors)
    if (keys.length) {
      setAttempted(true)
      return complain(keys)
    }
    setBusy(true)
    await save(() => d.updateRound(tidy(draft)), {
      failMessage: 'Couldn’t save the round.',
      onError: (e) => {
        const data = (e as { data?: { errors?: RoundErrors } }).data
        if (!data?.errors) return false
        setServerErrors(data.errors)
        setAttempted(true)
        complain(Object.keys(data.errors))
        return true
      },
      onDone: (n) => {
        setDirty(false)
        setTouched(new Set())
        setAttempted(false)
        toast(n ? `Saved. ${n} change${n === 1 ? '' : 's'} in the log.` : 'Nothing had changed.')
      },
    })
    setBusy(false)
  }

  const discard = () => {
    setDraft(d.round)
    setDirty(false)
    setTouched(new Set())
    setAttempted(false)
    setServerErrors({})
  }

  const n = errorCount(visible)
  const err = (k: string) => visible[k]
  const instruments = INSTRUMENTS.includes(draft.instrument) ? INSTRUMENTS : [draft.instrument, ...INSTRUMENTS]
  const moreBad = ['kickoff', 'minCheck', ...draft.waves.map((_, i) => `waves.${i}`), ...PIPELINE_KEYS.map((k) => `odds.${k}`)].some((k) => visible[k])

  return (
    <section className="set">
      <div className="set-main">
        <div className="set-card set-round" ref={form}>
          <h2>The round</h2>
          <p className="set-card__lede">Every number on Today and Plan comes from here.</p>
          <div className="set-grid">
            <F id="s-target" label="Target" err={err('target')} help="What you need to close.">
              <AmountInput id="s-target" value={draft.target} onChange={(v) => setTop('target', v ?? NaN)} onBlur={() => touch('target')} placeholder="$1,000,000" />
            </F>
            <F id="s-stretch" label="Room to" err={err('stretch')} help="The most you’d take.">
              <AmountInput id="s-stretch" value={draft.stretch} onChange={(v) => setTop('stretch', v ?? NaN)} onBlur={() => touch('stretch')} placeholder="$1,500,000" />
            </F>
            <SelectField id="s-instrument" label="Instrument" err={err('instrument')} value={draft.instrument} onChange={(v) => setTop('instrument', v)} options={instruments.map((x) => [x, cap(x)])} />
            <F id="s-deadline" label="Close by" err={err('deadline')} help={closeHint(draft.deadline, today)}>
              <input id="s-deadline" type="date" value={draft.deadline} onChange={(e) => setTop('deadline', e.target.value)} onBlur={() => touch('deadline')} />
            </F>
            <F id="s-cap" label="Valuation cap" err={err('cap')} help="Optional. Only shown here.">
              <AmountInput id="s-cap" value={draft.cap} onChange={(v) => setTop('cap', v)} onBlur={() => touch('cap')} placeholder="$10,000,000" />
            </F>
            <SelectField
              id="s-quiet"
              label="Gone quiet after"
              err={err('quietDays')}
              help="When a name lands in Gone quiet."
              value={String(draft.quietDays)}
              onChange={(v) => setTop('quietDays', Number(v))}
              options={[...new Set([...Array.from({ length: 14 }, (_, i) => i + 1), draft.quietDays])].sort((a, b) => a - b).map((x) => [String(x), `${x} day${x === 1 ? '' : 's'}`])}
            />
          </div>

          <h3 className="set-label">Phases</h3>
          {visible.phases ? (
            <p className="field__error" data-err="phases" role="alert">
              {visible.phases}
            </p>
          ) : null}
          <PhaseList round={draft} errors={errors} show={show} touch={touch} onChange={(phases) => edit((r) => ({ ...r, phases }))} />
          <button type="button" className="set-add" onClick={() => edit((r) => ({ ...r, phases: [...r.phases, newPhase(r.phases.at(-1), today)] }))}>
            <Icon name="plus" size={16} strokeWidth={2.2} /> Add a phase
          </button>

          <details className="set-more" open={moreBad || undefined}>
            <summary>
              More round settings <span>kickoff, minimum check, wave names, odds by stage</span>
            </summary>
            <div className="set-grid">
              <F id="s-kickoff" label="Kickoff" err={err('kickoff')} help={draft.kickoff ? `${dayDiff(draft.deadline, draft.kickoff)} days to the close.` : undefined}>
                <input id="s-kickoff" type="date" value={draft.kickoff} onChange={(e) => setTop('kickoff', e.target.value)} onBlur={() => touch('kickoff')} />
              </F>
              <F id="s-min" label="Minimum check" err={err('minCheck')} help="Optional.">
                <AmountInput id="s-min" value={draft.minCheck} onChange={(v) => setTop('minCheck', v)} onBlur={() => touch('minCheck')} placeholder="$25,000" />
              </F>
              <span />
              {draft.waves.map((w, ix) => (
                <F key={ix} id={`s-wave-${ix}`} label={`Wave ${ix + 1} name`} err={err(`waves.${ix}`)}>
                  <input id={`s-wave-${ix}`} value={w} onChange={(e) => edit((r) => ({ ...r, waves: r.waves.map((x, i) => (i === ix ? e.target.value : x)) }))} onBlur={() => touch(`waves.${ix}`)} />
                </F>
              ))}
            </div>
            <p className="set-sub">Odds by stage · 0 to 1, weights the pipeline</p>
            <div className="set-odds">
              {PIPELINE_KEYS.map((k) => (
                <F key={k} id={`s-odds-${k}`} label={LABEL[k]} err={err(`odds.${k}`)}>
                  <NumberInput id={`s-odds-${k}`} value={draft.odds[k]} onChange={(v) => edit((r) => ({ ...r, odds: { ...r.odds, [k]: v ?? NaN } }))} onBlur={() => touch(`odds.${k}`)} />
                </F>
              ))}
            </div>
          </details>

          <div className="set-foot">
            <span className={`set-foot__status${n ? ' is-bad' : ''}`} role="status">
              {n ? fixLine(n) : dirty && changes ? `${changes} unsaved change${changes === 1 ? '' : 's'}` : !d.roundExists ? 'Showing defaults; nothing saved yet.' : 'No changes yet'}
            </span>
            {dirty ? (
              <Button variant="ghost" onClick={discard}>
                Discard
              </Button>
            ) : null}
            <Button variant="primary" className={n ? 'is-blocked' : ''} aria-disabled={n ? true : undefined} disabled={!dirty || !changes} loading={busy} loadingLabel="Saving…" onClick={submit}>
              Save changes
            </Button>
          </div>
        </div>
        <CapTableCard />
        <AICard />
        <AgentsCard />
        <ChangeLog rows={log} />
      </div>
      <aside className="set-side">
        <GoogleCard />
        <WisprCard />
        {/* PST-289 */}
        <FeedbackCard />
        {/* PST-304 */}
        <SoundsCard />
        <ClaudeSees />
        <ConnectAgentCard />
        <MembersCard members={members} />
      </aside>
    </section>
  )
}

/** Which data-field holds an error key (top-level fields only; phase errors show in their editor). */
const fieldId = (k: string) =>
  ({ target: 's-target', stretch: 's-stretch', instrument: 's-instrument', deadline: 's-deadline', cap: 's-cap', quietDays: 's-quiet', kickoff: 's-kickoff', minCheck: 's-min' })[k] ??
  (k.startsWith('odds.') ? `s-odds-${k.slice(5)}` : k.startsWith('waves.') ? `s-wave-${k.slice(6)}` : k)

function SelectField({ id, label, err, help, value, onChange, options }: { id: string; label: string; err?: string; help?: string; value: string; onChange: (v: string) => void; options: (readonly [string, string])[] | [string, string][] }) {
  return (
    <div className={['field', 'set-field', err ? 'field--error' : ''].filter(Boolean).join(' ')} data-field={id}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <span className="select">
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={18} className="select__chevron" />
      </span>
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
