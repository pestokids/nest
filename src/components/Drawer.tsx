import { useEffect, useRef, useState, type FormEvent } from 'react'
import { shortDate, todayIST } from '../lib/dates'
import { NEW_INVESTOR, type InvestorFields } from '../lib/pipeline'
import { ALL, GEOS, LABEL, TIERS, TYPES, WARM, WAVES, type Wave } from '../lib/stages'
import { errorMessage, useRaise } from './data'
import { useUI } from './raise-ui'
import { Button } from './ui'

/** Form state: numbers as strings so inputs can be empty. */
type Form = Omit<InvestorFields, 'expected' | 'committed' | 'nextDate' | 'lastTouch'> & {
  expected: string
  committed: string
  nextDate: string
  lastTouch: string
}

const toForm = (v: InvestorFields): Form => ({
  ...v,
  expected: v.expected == null ? '' : String(v.expected),
  committed: v.committed == null ? '' : String(v.committed),
  nextDate: v.nextDate ?? '',
  lastTouch: v.lastTouch ?? '',
})

const fromForm = (f: Form): InvestorFields => {
  const num = (x: string) => (x === '' ? undefined : Math.max(0, Number(x)))
  return {
    ...f,
    name: f.name.trim(), firm: f.firm.trim(), path: f.path.trim(), nextStep: f.nextStep.trim(), notes: f.notes.trim(), source: f.source.trim(),
    expected: num(f.expected), committed: num(f.committed), nextDate: f.nextDate || undefined, lastTouch: f.lastTouch || undefined,
  }
}

/** Add/edit drawer with activity log, advance and in-page delete confirm. */
export function Drawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const d = useRaise()
  const { toast } = useUI()
  const inv = id ? d.investors.find((i) => i._id === id) : undefined
  const [form, setForm] = useState<Form>(() => toForm(inv ?? NEW_INVESTOR))
  const [touch, setTouch] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [busy, setBusy] = useState(false)
  const log = d.useLog(inv ? id : null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => nameRef.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  // Deleted elsewhere (another tab): close.
  const existed = useRef(!!inv)
  useEffect(() => {
    if (existed.current && !inv) onClose()
  }, [inv, onClose])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  async function save(e: FormEvent) {
    e.preventDefault()
    const body = fromForm(form)
    if (!body.name) return nameRef.current?.focus()
    setBusy(true)
    try {
      await d.save(inv ? inv._id : null, body)
      toast('Saved')
      onClose()
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  async function advance() {
    if (!inv) return
    try {
      const r = await d.advance(inv._id)
      if (r) {
        toast(`${inv.name} → ${r.label}. Set the next step.`)
        setForm((f) => ({ ...f, stage: r.stage as Form['stage'], lastTouch: todayIST() }))
      }
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) })
    }
  }

  async function logTouch() {
    const note = touch.trim()
    if (!note || !inv) return
    try {
      const day = await d.logNote(inv._id, note)
      setTouch('')
      set('lastTouch', day)
      toast('Logged')
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) })
    }
  }

  async function del() {
    if (!inv) return
    try {
      await d.remove(inv._id)
      toast({ tone: 'info', icon: 'trash', message: 'Deleted' })
      onClose()
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) })
    }
  }

  const text = (k: 'name' | 'firm' | 'path' | 'nextStep' | 'source') => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value),
  })

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" aria-labelledby="dTitle" role="dialog">
        <header>
          <h2 id="dTitle">{inv ? inv.name : 'New investor'}</h2>
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            Close
          </Button>
        </header>
        <form className="scroll" id="form" autoComplete="off" onSubmit={save}>
          <div className="fgrid">
            <div className="f"><label htmlFor="i-name">Name</label><input id="i-name" ref={nameRef} required {...text('name')} /></div>
            <div className="f"><label htmlFor="i-firm">Fund / company</label><input id="i-firm" {...text('firm')} /></div>
            <div className="f">
              <label htmlFor="i-type">Type</label>
              <select id="i-type" value={form.type} onChange={(e) => set('type', e.target.value as Form['type'])}>
                {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div className="f">
              <label htmlFor="i-geo">Geography</label>
              <select id="i-geo" value={form.geo} onChange={(e) => set('geo', e.target.value as Form['geo'])}>
                {GEOS.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </div>
            <div className="f">
              <label htmlFor="i-warmth">Relationship</label>
              <select id="i-warmth" value={form.warmth} onChange={(e) => set('warmth', e.target.value as Form['warmth'])}>
                {Object.entries(WARM).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="f"><label htmlFor="i-path">Warm path (who intros)</label><input id="i-path" placeholder="e.g. a name, or direct" {...text('path')} /></div>
            <div className="f">
              <label htmlFor="i-tier">Tier</label>
              <select id="i-tier" value={form.tier} onChange={(e) => set('tier', e.target.value as Form['tier'])}>
                {TIERS.map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
            <div className="f">
              <label htmlFor="i-wave">Wave</label>
              <select id="i-wave" value={String(form.wave)} onChange={(e) => set('wave', Number(e.target.value) as Wave)}>
                {WAVES.map((w, ix) => <option key={w} value={w}>{w} · {d.round.waves[ix] ?? ''}</option>)}
              </select>
            </div>
            <div className="f">
              <label htmlFor="i-stage">Stage</label>
              <select id="i-stage" value={form.stage} onChange={(e) => set('stage', e.target.value as Form['stage'])}>
                {ALL.map((s) => <option key={s.k} value={s.k}>{s.l}</option>)}
              </select>
            </div>
            <div className="f">
              <label className="chk" htmlFor="i-lead" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--ink)', marginTop: 20 }}>
                <input id="i-lead" type="checkbox" checked={form.lead} onChange={(e) => set('lead', e.target.checked)} /> Can lead or anchor
              </label>
            </div>
            <div className="f"><label htmlFor="i-expected">Expected check ($)</label><input id="i-expected" type="number" min="0" step="5000" inputMode="numeric" value={form.expected} onChange={(e) => set('expected', e.target.value)} /></div>
            <div className="f"><label htmlFor="i-committed">Committed ($)</label><input id="i-committed" type="number" min="0" step="5000" inputMode="numeric" value={form.committed} onChange={(e) => set('committed', e.target.value)} /></div>
            <div className="f full"><label htmlFor="i-next">Next step</label><input id="i-next" placeholder="What happens next, in one line" {...text('nextStep')} /></div>
            <div className="f"><label htmlFor="i-nextDate">Next step date</label><input id="i-nextDate" type="date" value={form.nextDate} onChange={(e) => set('nextDate', e.target.value)} /></div>
            <div className="f"><label htmlFor="i-last">Last touch</label><input id="i-last" type="date" value={form.lastTouch} onChange={(e) => set('lastTouch', e.target.value)} /></div>
            <div className="f full"><label htmlFor="i-notes">Notes</label><textarea id="i-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
            <div className="f full"><label htmlFor="i-source">Source</label><input id="i-source" {...text('source')} /></div>
          </div>
          {inv ? (
            <div className="log">
              <div className="eyebrow">Activity</div>
              <div className="add">
                <input
                  placeholder="Log a touch: emailed, called, sent update…"
                  aria-label="Log a touch"
                  value={touch}
                  onChange={(e) => setTouch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void logTouch()
                    }
                  }}
                />
                <Button variant="secondary" size="sm" type="button" onClick={logTouch}>
                  Log
                </Button>
              </div>
              <div className="log">
                {log === undefined ? null : log.length ? (
                  log.map((a) => (
                    <div className="ev" key={a._id}>
                      <span className="mono">{shortDate(a.date)}</span>
                      <span>
                        {a.kind === 'stage' ? (
                          <>
                            Moved to <strong>{LABEL[a.stage!] || a.stage}</strong>
                          </>
                        ) : (
                          a.note
                        )}
                        {a.by ? <span className="who"> · {a.by}</span> : null}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="muted">No activity logged yet.</div>
                )}
              </div>
            </div>
          ) : null}
        </form>
        <footer>
          <Button variant="primary" type="submit" form="form" disabled={busy}>
            Save
          </Button>
          {inv ? (
            <Button variant="secondary" type="button" onClick={advance}>
              Advance stage →
            </Button>
          ) : null}
          <span className="sp" />
          {inv ? (
            <span>
              {confirmDel ? (
                <>
                  <span className="muted" style={{ fontSize: 12 }}>Delete for good?</span>{' '}
                  <Button variant="ghost" size="sm" className="btn--danger" type="button" onClick={del}>
                    Yes, delete
                  </Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" className="btn--danger" type="button" onClick={() => setConfirmDel(true)}>
                  Delete
                </Button>
              )}
            </span>
          ) : null}
        </footer>
      </aside>
    </>
  )
}
