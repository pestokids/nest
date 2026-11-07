// "Remind": the text of a polite reminder, to copy or share on WhatsApp. The
// first copy or share logs a Nudged touch on the investor.
import { useState } from 'react'
import { reminderKind, reminderText, whatsappUrl, type CloseRow, type Closing } from '../../lib/close'
import { todayIST } from '../../lib/dates'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { Button, buttonClass, Textarea } from '../ui'

export function ReminderDialog({ row, closing, onClose }: { row: CloseRow; closing: Closing; onClose: () => void }) {
  const d = useRaise()
  const { toast, fail } = useUI()
  const id = useTitleId()
  const kind = reminderKind(closing) ?? 'sign'
  const [msg] = useState(() => reminderText({ kind, investorName: row.investor.name, closing, me: d.me, today: todayIST() }))
  const [text, setText] = useState(msg.text)
  const [logged, setLogged] = useState(false)
  const who = closing.signerName?.trim().split(/\s+/)[0] || row.investor.name

  /** Once per reminder: a Nudged touch, so Today knows you followed up. */
  const log = () => {
    play('nudge')
    if (logged) return
    setLogged(true)
    d.logNote(row.investor._id, kind === 'sign' ? 'Reminded them to sign the SAFE' : 'Reminded them about the wire', { touch: 'nudge' }).catch(fail)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      log()
      toast({ tone: 'success', icon: 'check', message: 'Copied. Paste it wherever you talk to them.' })
    } catch {
      play('nope')
      toast({ tone: 'error', message: 'Couldn’t copy here. Select the text and copy it yourself.' })
    }
  }

  return (
    <Modal onClose={onClose} labelledBy={id} className="close-dialog close-remind">
      <div className="close-dialog__head">
        <div className="eyebrow-mono">Reminder · {kind === 'sign' ? 'signature' : 'wire'}</div>
        <h2 id={id}>Remind {who}</h2>
        <p>A short, polite nudge. Edit it if you like, then copy it or share it on WhatsApp.</p>
      </div>
      <p className="close-remind__subject">
        <span className="eyebrow-mono">Subject</span> {msg.subject}
      </p>
      <Textarea id="remind-text" label="Message" value={text} onChange={(e) => setText(e.target.value)} rows={9} />
      {/* TODO(PST-282): once convex/lib/email.ts (sendEmail({ to, subject, text })) is on main, add "Send by email"
          to closing.signerEmail here when RESEND_API_KEY is set, through a Convex action that calls sendEmail. */}
      <footer className="close-dialog__foot">
        <p>{closing.signerEmail ? `Signer: ${closing.signerEmail}` : 'Add the signer’s email on the SAFE to have it handy.'}</p>
        <a className={buttonClass({ variant: 'secondary' })} href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer" onClick={log}>
          Share on WhatsApp
        </a>
        <Button variant="primary" onClick={copy}>
          Copy text
        </Button>
      </footer>
    </Modal>
  )
}
