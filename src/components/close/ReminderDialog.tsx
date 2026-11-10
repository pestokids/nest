// "Remind": the text of a polite reminder, to copy, share on WhatsApp or (when
// RESEND_API_KEY is set) email to the signer. The first copy or share logs a
// Nudged touch on the investor; an email logs an Email touch on the server.
import { useState } from 'react'
import { reminderKind, reminderText, whatsappUrl, type CloseRow, type Closing } from '../../lib/close'
import { todayIST } from '../../lib/dates'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { Button, buttonClass, Textarea } from '../ui'
import { useClose } from './CloseData'

export function ReminderDialog({ row, closing, onClose }: { row: CloseRow; closing: Closing; onClose: () => void }) {
  const d = useRaise()
  const c = useClose()
  const { toast, fail } = useUI()
  const id = useTitleId()
  const kind = reminderKind(closing) ?? 'sign'
  const [msg] = useState(() => reminderText({ kind, investorName: row.investor.name, closing, me: d.me, today: todayIST() }))
  const [text, setText] = useState(msg.text)
  const [logged, setLogged] = useState(false)
  const [sending, setSending] = useState(false)
  const canEmail = c.emailReady && !!closing.signerEmail?.trim()
  const who = closing.signerName?.trim().split(/\s+/)[0] || row.investor.name

  /** Once per reminder: a Nudged touch, so Today knows you followed up. */
  const log = () => {
    if (logged) return
    play('log')
    setLogged(true)
    d.logNote(row.investor._id, kind === 'sign' ? 'Reminded them to sign the SAFE' : 'Reminded them about the wire', { touch: 'nudge' }).catch(fail)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      log()
      toast({ tone: 'success', icon: 'check', message: 'Copied. Paste it wherever you talk to them.' })
    } catch {
      play('failed')
      toast({ tone: 'error', message: 'Couldn’t copy here. Select the text and copy it yourself.' })
    }
  }

  const email = async () => {
    setSending(true)
    try {
      const { to } = await c.emailReminder(closing._id, msg.subject, text)
      play('log')
      toast({ tone: 'success', icon: 'check', message: `Sent to ${to}.` })
      onClose()
    } catch (e) {
      setSending(false)
      fail(e)
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={id} className="close-dialog close-remind">
      <div className="close-dialog__head">
        <div className="eyebrow-mono">Reminder · {kind === 'sign' ? 'signature' : 'wire'}</div>
        <h2 id={id}>Remind {who}</h2>
        <p>A short, polite nudge. Edit it if you like, then {canEmail ? 'email it, copy it' : 'copy it'} or share it on WhatsApp.</p>
      </div>
      <p className="close-remind__subject">
        <span className="eyebrow-mono">Subject</span> {msg.subject}
      </p>
      <Textarea id="remind-text" label="Message" value={text} onChange={(e) => setText(e.target.value)} rows={9} />
      <footer className="close-dialog__foot">
        <p>{closing.signerEmail ? `Signer: ${closing.signerEmail}` : 'Add the signer’s email on the SAFE to have it handy.'}</p>
        <a className={buttonClass({ variant: 'secondary' })} href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer" onClick={log}>
          Share on WhatsApp
        </a>
        <Button variant={canEmail ? 'secondary' : 'primary'} onClick={copy}>
          Copy text
        </Button>
        {canEmail ? (
          <Button variant="primary" icon="mail" onClick={email} loading={sending} loadingLabel="Sending…">
            Send by email
          </Button>
        ) : null}
      </footer>
    </Modal>
  )
}
