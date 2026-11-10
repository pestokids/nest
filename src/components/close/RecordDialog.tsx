// "Record SAFE sent" (screens/raise-close/send-safe.png, reworked): Nest doesn't
// send or sign anything. You note what went out, to whom and when, and an
// optional link to the signing request in whatever tool you used.
import { useMemo, useRef, useState } from 'react'
import { checkTick, CLOSE_INSTRUMENTS, cleanTerms, DEFAULT_INSTRUMENT, stepMap, validateTerms, type CloseRow, type ClosingTerms } from '../../lib/close'
import { todayIST } from '../../lib/dates'
import { exactMoney } from '../../lib/money'
import { shake } from '../../lib/motion'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { AmountInput, NumberInput } from '../settings/inputs'
import { Modal, useTitleId } from '../system/Modal'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Input, Select, Toggle } from '../ui'
import { useClose } from './CloseData'

type Draft = Omit<ClosingTerms, 'amount' | 'cap' | 'discount'> & { amount?: number; cap?: number; discountPct?: number; sentAt: string }

export function RecordDialog({ row, onClose, onSaved }: { row: CloseRow; onClose: () => void; onSaved: () => void }) {
  const d = useRaise()
  const c = useClose()
  const { toast } = useUI()
  const save = useSaveAction()
  const id = useTitleId()
  const today = todayIST()
  const { investor, closing } = row
  const sent = stepMap(closing).sent
  const recording = !sent
  const otherCaps = c.closings.map((x) => x.cap)
  const [f, setF] = useState<Draft>(() => ({
    amount: closing?.amount ?? (row.amount || undefined),
    cap: closing?.cap ?? d.round.cap ?? otherCaps[0],
    discountPct: closing?.discount ? Math.round(closing.discount * 100) : undefined,
    instrument: closing?.instrument ?? (d.round.instrument.toLowerCase().includes('safe') ? d.round.instrument : DEFAULT_INSTRUMENT),
    proRata: closing?.proRata ?? false,
    mfn: closing?.mfn ?? false,
    sideLetter: closing?.sideLetter ?? '',
    signerName: closing?.signerName ?? '',
    signerEmail: closing?.signerEmail ?? investor.email ?? '',
    requestUrl: closing?.requestUrl ?? '',
    signedUrl: closing?.signedUrl,
    sentAt: today,
  }))
  const [attempted, setAttempted] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const form = useRef<HTMLDivElement>(null)

  const terms: ClosingTerms = {
    amount: f.amount ?? NaN, cap: f.cap ?? NaN, instrument: f.instrument, proRata: f.proRata, mfn: f.mfn,
    discount: f.discountPct === undefined ? undefined : f.discountPct / 100,
    sideLetter: f.sideLetter, signerName: f.signerName, signerEmail: f.signerEmail, requestUrl: f.requestUrl, signedUrl: f.signedUrl,
  }
  const errors = useMemo(() => {
    const e: Record<string, string> = { ...validateTerms(cleanTerms(terms)), ...serverErrors }
    if (terms.discount !== undefined && !(terms.discount >= 0 && terms.discount < 1)) e.discount = 'Between 0% and 99%, or leave empty.'
    if (recording) {
      const err = checkTick(closing?.steps ?? [], 'sent', f.sentAt, today)
      if (err) e.sentAt = err
    }
    return e
  }, [f, serverErrors]) // eslint-disable-line react-hooks/exhaustive-deps
  const err = (k: string) => (attempted ? errors[k] : undefined)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setServerErrors({})
    setF((x) => ({ ...x, [k]: v }))
  }

  async function submit() {
    if (Object.keys(errors).length) {
      setAttempted(true)
      play('nope')
      requestAnimationFrame(() => form.current?.querySelectorAll('.field--error .input, .field--error .select').forEach((el) => shake(el)))
      return
    }
    setBusy(true)
    await save(() => c.save(investor._id, terms, recording ? f.sentAt : undefined), {
      failMessage: `Couldn’t save ${investor.name}’s SAFE.`,
      onError: (e) => {
        const data = (e as { data?: { errors?: Record<string, string> } }).data
        if (!data?.errors) return false
        setServerErrors(data.errors)
        setAttempted(true)
        play('nope')
        return true
      },
      onDone: () => {
        play('save')
        toast({ tone: 'success', message: recording ? `Recorded the SAFE sent to ${investor.name}.` : `Saved ${investor.name}’s terms.` })
        onSaved()
      },
    })
    setBusy(false)
  }

  const instruments: string[] = (CLOSE_INSTRUMENTS as readonly string[]).includes(f.instrument) ? [...CLOSE_INSTRUMENTS] : [f.instrument, ...CLOSE_INSTRUMENTS]
  const ok = (f.amount ?? 0) > 0 && (f.cap ?? 0) > 0
  const extras = [f.discountPct ? `a ${f.discountPct}% discount` : '', f.proRata ? 'pro-rata rights' : '', f.mfn ? 'MFN' : ''].filter(Boolean)

  return (
    <Modal onClose={onClose} labelledBy={id} className="close-dialog">
      <div className="close-dialog__head">
        <div className="eyebrow-mono">SAFE · {recording ? 'record it' : 'terms'}</div>
        <h2 id={id}>{recording ? `Record the SAFE sent to ${investor.name}` : `${investor.name}’s terms`}</h2>
        <p>Signing happens in your own tool. Note what went out, and Nest keeps track of where it is.</p>
      </div>
      <div className="close-form" ref={form}>
        <Amount id="r-amount" label="Investment amount" value={f.amount} onChange={(v) => set('amount', v)} err={err('amount')} placeholder="$50,000" />
        <Amount id="r-cap" label="Valuation cap" value={f.cap} onChange={(v) => set('cap', v)} err={err('cap')} placeholder="$16,000,000" />
        <Select id="r-instrument" label="Instrument" value={f.instrument} onChange={(e) => set('instrument', e.target.value)} error={err('instrument')}>
          {instruments.map((x) => (
            <option key={x} value={x}>
              {x.charAt(0).toUpperCase() + x.slice(1)}
            </option>
          ))}
        </Select>
        <div className={`field${err('discount') ? ' field--error' : ''}`}>
          <label className="field__label" htmlFor="r-discount">
            Discount
          </label>
          <span className="input input--suffix">
            <NumberInput id="r-discount" value={f.discountPct} onChange={(v) => set('discountPct', v)} placeholder="None" />
            <span className="input__suffix">%</span>
          </span>
          {err('discount') ? <span className="field__error" role="alert">{err('discount')}</span> : <span className="field__help">Optional. Most post-money SAFEs have none.</span>}
        </div>
        <Input id="r-signer" label="Signer’s name" value={f.signerName} onChange={(e) => set('signerName', e.target.value)} placeholder="Who signs for them" autoComplete="off" />
        <Input id="r-email" label="Signer’s email" type="email" value={f.signerEmail} onChange={(e) => set('signerEmail', e.target.value)} error={err('signerEmail')} placeholder="name@example.com" autoComplete="off" />
        {recording ? <Input id="r-sent" label="Sent on" type="date" value={f.sentAt} max={today} onChange={(e) => set('sentAt', e.target.value)} error={err('sentAt')} /> : null}
        <Input
          id="r-link"
          label="Link to the signing request"
          className={recording ? '' : 'close-form__wide'}
          value={f.requestUrl}
          onChange={(e) => set('requestUrl', e.target.value)}
          error={err('requestUrl')}
          help="Optional. Wherever you sent it from."
          placeholder="https://"
          inputMode="url"
        />
      </div>

      <div className="close-toggles">
        <p className="close-sub">Side letter</p>
        <Toggle label="Pro-rata rights" checked={f.proRata} onChange={(e) => set('proRata', e.target.checked)} />
        <Toggle label="Most favoured nation (MFN)" checked={f.mfn} onChange={(e) => set('mfn', e.target.checked)} />
        <Input id="r-side" label="Anything else in the side letter" value={f.sideLetter} onChange={(e) => set('sideLetter', e.target.value)} placeholder="e.g. information rights" />
      </div>

      {ok ? (
        <div className="close-quote">
          <span className="eyebrow-mono">In one line</span>
          <p>
            “{investor.name} invests {exactMoney(f.amount!)} on a {f.instrument} with a {exactMoney(f.cap!)} valuation cap{extras.length ? `, ${extras.join(', ')}` : ''}.”
          </p>
        </div>
      ) : null}

      <footer className="close-dialog__foot">
        <p>{recording ? `Nothing moves on the pipeline yet. ${investor.name} moves to Signed when you tick “Signed by them”.` : 'Dates and ticks are on the timeline.'}</p>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" loading={busy} onClick={submit}>
          {recording ? 'Record SAFE sent' : 'Save terms'}
        </Button>
      </footer>
    </Modal>
  )
}

function Amount({ id, label, value, onChange, err, placeholder }: { id: string; label: string; value: number | undefined; onChange: (v: number | undefined) => void; err?: string; placeholder: string }) {
  return (
    <div className={`field${err ? ' field--error' : ''}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <span className="input">
        <AmountInput id={id} value={value} onChange={onChange} placeholder={placeholder} />
      </span>
      {err ? (
        <span className="field__error" role="alert">
          {err}
        </span>
      ) : null}
    </div>
  )
}
