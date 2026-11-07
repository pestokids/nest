// One investor's SAFE (screens/raise-close/signing-status.png, reworked as a
// manual timeline): each step is a tick with a date, ticked by hand. A side
// panel on desktop, a bottom sheet on phones.
import { useState } from 'react'
import { checkTick, checkUntick, reminderKind, STEP_KEYS, STEPS, stepMap, termsLine, termsOf, usd, type CloseRow, type Closing, type StepKey } from '../../lib/close'
import { dayDiff, todayIST } from '../../lib/dates'
import { longDay } from '../../lib/investorView'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Confirm } from '../system/Confirm'
import { Modal, useTitleId } from '../system/Modal'
import { useSaveAction } from '../system/useSaveAction'
import { Button, buttonClass, Icon, Input } from '../ui'
import { useClose } from './CloseData'
import { useTick } from './useTick'

export function ClosingPanel({ row, onClose, onRecord, onRemind }: { row: CloseRow; onClose: () => void; onRecord: () => void; onRemind: () => void }) {
  const d = useRaise()
  const ui = useUI()
  const id = useTitleId()
  const { investor, closing } = row
  const [removing, setRemoving] = useState(false)
  const c = useClose()
  const s = stepMap(closing)
  const remind = reminderKind(closing)

  return (
    <Modal onClose={onClose} labelledBy={id} className="close-panel">
      <header className="close-panel__head">
        <div className="eyebrow-mono">SAFE · tracked by hand</div>
        <button type="button" className="drawer__icon close-panel__x" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={20} />
        </button>
        <h2 id={id}>{investor.name}</h2>
        <p className="close-panel__sub">
          {usd(row.amount)}
          {closing ? ` · ${termsLine({ ...closing, sideLetter: undefined })}` : ''}
          {closing?.sideLetter ? ` · side letter: ${closing.sideLetter}` : ''}
        </p>
        <div className="close-panel__actions">
          {!s.sent ? (
            <Button variant="primary" onClick={onRecord}>
              Record SAFE sent
            </Button>
          ) : remind ? (
            <Button variant="primary" onClick={onRemind}>
              {remind === 'sign' ? 'Send a reminder' : 'Remind about the wire'}
            </Button>
          ) : null}
          {closing?.requestUrl ? (
            <a className={buttonClass({ variant: 'secondary' })} href={closing.requestUrl} target="_blank" rel="noopener noreferrer">
              Open the signing request
            </a>
          ) : null}
          {s.sent ? (
            <Button variant="ghost" onClick={onRecord}>
              Edit terms
            </Button>
          ) : null}
        </div>
      </header>

      {closing && s.sent ? (
        <>
          <h3 className="close-panel__h">Where it is</h3>
          <Timeline closing={closing} name={investor.name} me={d.me} />
          <SignedCopy closing={closing} name={investor.name} />
        </>
      ) : (
        <p className="close-panel__none">No SAFE recorded yet. Record it when it goes out, and tick each step here as it happens.</p>
      )}

      <p className="close-note">Signing happens in your own tool. Nest keeps the dates and the links here, not the documents.</p>
      <footer className="close-panel__foot">
        <button type="button" className="drawer__textbtn" onClick={() => ui.open(investor._id)}>
          Open {investor.name}
        </button>
        {closing ? (
          <button type="button" className="drawer__textbtn drawer__textbtn--danger" onClick={() => setRemoving(true)}>
            Remove this record
          </button>
        ) : null}
      </footer>
      {removing && closing ? (
        <Confirm
          title={`Remove ${investor.name}’s SAFE record?`}
          body="The ticks, dates and links go. The pipeline stage stays where it is."
          confirm="Remove"
          onConfirm={async () => {
            await c.remove(closing._id)
            play('card-drop', { rate: 0.85 })
            onClose()
          }}
          onClose={() => setRemoving(false)}
        />
      ) : null}
    </Modal>
  )
}

function Timeline({ closing, name, me }: { closing: Closing; name: string; me: string }) {
  const tick = useTick()
  const today = todayIST()
  const s = stepMap(closing)
  const who = closing.signerName?.trim() || name
  const first = who.split(/\s+/)[0]
  const now = STEP_KEYS.find((k) => !s[k] && !STEPS[k].optional && !checkTick(closing.steps, k, today, today))
  const title: Record<StepKey, [string, string]> = {
    sent: [`Sent to ${who}`, 'SAFE sent'],
    viewed: [`Opened by ${first}`, `${first} opens it`],
    signed: [`${first} signed`, `${first} signs`],
    countersigned: [me ? `Countersigned by ${me}` : 'Countersigned', me ? `${me} countersigns` : 'You countersign'],
    wireSent: ['Wire instructions sent', 'Wire instructions go out'],
    wired: ['Money in', 'Money in'],
  }
  const todo: Record<StepKey, string> = {
    sent: '',
    viewed: 'If your signing tool shows it. Optional.',
    signed: 'Tick it when their signature is in.',
    countersigned: 'Your signature, in your signing tool.',
    wireSent: 'Optional. Send them once both sides have signed.',
    wired: 'Tick it when the wire lands. It moves them to Money in.',
  }
  return (
    <ol className="close-steps">
      {STEP_KEYS.map((k) => {
        const at = s[k]
        const why = at ? checkUntick(closing.steps, k) : checkTick(closing.steps, k, today, today)
        const prev = STEPS[k].after ? s[STEPS[k].after!] : undefined
        const waiting = k === now && prev ? dayDiff(today, prev) : 0
        const sub = at
          ? [longDay(at), k === 'sent' && closing.signerEmail ? closing.signerEmail : ''].filter(Boolean).join(' · ')
          : k === now && waiting > 0
            ? `Waiting ${waiting} day${waiting === 1 ? '' : 's'}. ${todo[k]}`
            : todo[k]
        return (
          <li key={k} className={`close-step${at ? ' is-done' : ''}${k === now ? ' is-now' : ''}`}>
            <button
              type="button"
              role="checkbox"
              aria-checked={!!at}
              aria-label={STEPS[k].label}
              aria-disabled={why ? true : undefined}
              title={why ?? undefined}
              className="close-step__dot"
              onClick={(e) => {
                if (why) {
                  play('nope')
                  return
                }
                void tick(closing, name, k, at ? null : today, { from: e.currentTarget })
              }}
            >
              {at ? <Icon name="check" size={14} strokeWidth={2.6} /> : null}
            </button>
            <div className="close-step__text">
              <strong>{at ? title[k][0] : title[k][1]}</strong>
              <span>{sub}</span>
            </div>
            {at ? (
              <label className="close-step__date">
                <span className="sr-only">{STEPS[k].label} on</span>
                <input
                  type="date"
                  value={at}
                  max={today}
                  onChange={(e) => {
                    const v = e.target.value
                    if (!v || v === at) return
                    if (checkTick(closing.steps, k, v, today)) return void play('nope')
                    void tick(closing, name, k, v)
                  }}
                />
              </label>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

/** The link to the countersigned copy, wherever it's stored. */
function SignedCopy({ closing, name }: { closing: Closing; name: string }) {
  const c = useClose()
  const save = useSaveAction()
  const { toast } = useUI()
  const [url, setUrl] = useState(closing.signedUrl ?? '')
  const [error, setError] = useState<string>()
  const changed = url.trim() !== (closing.signedUrl ?? '')
  const submit = async () => {
    await save(() => c.save(closing.investorId, { ...termsOf(closing), signedUrl: url.trim() || undefined }), {
      failMessage: `Couldn’t save the link for ${name}.`,
      onError: (e) => {
        const m = (e as { data?: { errors?: Record<string, string> } }).data?.errors?.signedUrl
        if (!m) return false
        setError(m)
        play('nope')
        return true
      },
      onDone: () => {
        setError(undefined)
        toast({ tone: 'success', icon: 'link', message: url.trim() ? 'Saved the link to the signed copy.' : 'Removed the link.' })
      },
    })
  }
  return (
    <div className="close-signed">
      <Input
        id="c-signed"
        label="Signed copy"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value)
          setError(undefined)
        }}
        error={error}
        help={closing.signedUrl ? undefined : 'Optional. A link to the countersigned PDF, wherever you keep it.'}
        placeholder="https://"
        inputMode="url"
      />
      <div className="close-signed__btns">
        {closing.signedUrl && !changed ? (
          <a className={buttonClass({ variant: 'secondary', size: 'sm' })} href={closing.signedUrl} target="_blank" rel="noopener noreferrer">
            Open
          </a>
        ) : null}
        {changed ? (
          <Button size="sm" variant="primary" onClick={submit}>
            Save link
          </Button>
        ) : null}
      </div>
    </div>
  )
}
