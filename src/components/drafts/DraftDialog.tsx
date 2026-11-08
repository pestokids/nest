// PST-278: the Draft dialog (screens/raise-ai/draft-follow-up.png). Nest writes
// the message, Dev edits it, then copies it, shares it on WhatsApp or sends it
// from nest@pestokids.com. Sending plays ask-logged and logs an email touch;
// Copy and WhatsApp log nothing until "I sent it" is ticked. Writing is silent.
import { useEffect, useRef, useState } from 'react'
import { todayIST } from '../../lib/dates'
import {
  blanks, PICK_TYPES, draftTitle, hasLinkSlot, isAiType, isEmail, pickType, recipientFor, TWEAK_LABEL, TWEAKS, TYPE_LABEL, whatsappUrl,
  type DraftInput, type DraftType, type Tweak,
} from '../../lib/drafts'
import { cents, NO_AI_KEY } from '../../lib/enrich'
import { normEmail } from '../../lib/google'
import { quietList, type Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { errorMessage, useRaise } from '../data'
import { usePreviewState } from '../preview-state'
import { useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { Button, Checkbox, Icon, IconButton } from '../ui'
import { useDrafts, type DraftOpen } from './data'

type Phase = 'loading' | 'writing' | 'ready' | 'nokey' | 'failed'
type Via = 'copy' | 'whatsapp'

const isNoKey = (e: unknown) => (e as { data?: { code?: string } })?.data?.code === NO_AI_KEY
const firstName = (s: string) => s.trim().split(/\s+/)[0] || s

/** Write to the clipboard inside the click, even when the text (links filled in) is still on its way. */
export function toClipboard(text: string | Promise<string>): Promise<void> {
  try {
    if (typeof text === 'string') return navigator.clipboard.writeText(text)
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write)
      return navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })])
    return text.then((t) => navigator.clipboard.writeText(t))
  } catch (e) {
    return Promise.reject(e)
  }
}

export function DraftDialog({ start, investor, onClose }: { start: DraftOpen; investor: Investor; onClose: () => void }) {
  const x = useDrafts()
  const d = useRaise()
  const { toast, fail } = useUI()
  const previewCopied = usePreviewState()?.drafts === 'copied'
  const titleId = useTitleId()
  const info = x.useInvestorDrafts(investor._id)
  const [type, setType] = useState<DraftType>(() => start.type ?? pickType(investor.stage, { quiet: quietList([investor], todayIST(), d.round.quietDays).length > 0 }))
  const [draftId, setDraftId] = useState(start.draftId)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [cost, setCost] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [problem, setProblem] = useState('')
  const [dirty, setDirty] = useState(false)
  const [via, setVia] = useState<Via | null>(null)
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const run = useRef(0)
  const started = useRef(false)

  const input = (): DraftInput => ({ draftId, investorId: investor._id, type, to, subject, body })

  async function write(t: DraftType, tweak?: Tweak) {
    const n = ++run.current
    setPhase('writing')
    setProblem('')
    try {
      const r = await x.generate({ draftId, investorId: investor._id, type: t, tweak, current: tweak ? { subject, body } : undefined })
      if (n !== run.current) return
      setDraftId(r.draftId)
      setSubject(r.subject)
      setBody(r.body)
      setCost(r.costUsd)
      setDirty(false)
      setPhase('ready')
      if (previewCopied) setVia('copy')
    } catch (e) {
      if (n !== run.current) return
      if (isNoKey(e)) return setPhase('nokey')
      if (tweak) {
        setPhase('ready')
        return fail(e)
      }
      setProblem(errorMessage(e))
      setPhase('failed')
    }
  }

  // Once the investor's contact and keys are in: reopen a saved draft, or write a new one.
  useEffect(() => {
    if (info === undefined || started.current) return
    started.current = true
    if (info === null) return onClose()
    const saved = start.draftId ? info.drafts.find((y) => y._id === start.draftId) : undefined
    if (saved) {
      setType(saved.type)
      setTo(saved.to ?? '')
      setSubject(saved.subject)
      setBody(saved.body)
      setCost(saved.costUsd)
      setVia(saved.status === 'copied' ? (saved.via === 'whatsapp' ? 'whatsapp' : 'copy') : null)
      setSent(saved.status === 'sent')
      setPhase(info.aiReady || !isAiType(saved.type) ? 'ready' : 'nokey')
      return
    }
    setTo(recipientFor(type, info.contact, info.warm)?.email ?? '')
    if (info.aiReady) void write(type)
    else setPhase('nokey')
  }, [info]) // eslint-disable-line react-hooks/exhaustive-deps

  function pick(t: DraftType) {
    if (t === type || phase === 'loading' || !info) return
    setType(t)
    setTo(recipientFor(t, info.contact, info.warm)?.email ?? '')
    if (phase !== 'nokey' && !sent) void write(t)
  }

  function close() {
    if (dirty && !sent && phase !== 'writing' && body.trim()) void x.save(input()).catch(() => {})
    onClose()
  }

  const done = (r: { draftId: string; body: string }, how: Via) => {
    setDraftId(r.draftId)
    setBody(r.body)
    setDirty(false)
    setVia(how)
  }

  async function copy() {
    const going = x.copied(input(), 'copy')
    const clip = toClipboard(hasLinkSlot(body) ? going.then((r) => r.body) : body)
    let r
    try {
      r = await going
    } catch (e) {
      clip.catch(() => {})
      return fail(e)
    }
    done(r, 'copy')
    try {
      await clip
      toast({ tone: 'success', icon: 'check', message: sent ? 'Copied.' : 'Copied. Tick “I sent it” once it’s gone, and Nest logs the touch.' })
    } catch {
      play('nope')
      toast({ tone: 'error', message: 'Couldn’t copy here. Select the text and copy it yourself.' })
    }
  }

  function whatsapp() {
    const slot = hasLinkSlot(body)
    // Open the tab inside the click (popup blockers), then point it at WhatsApp once the links are in.
    const tab = slot ? window.open('', '_blank') : null
    if (!slot) window.open(whatsappUrl(body), '_blank', 'noopener,noreferrer')
    x.copied(input(), 'whatsapp').then(
      (r) => {
        done(r, 'whatsapp')
        if (tab) {
          tab.opener = null
          tab.location.href = whatsappUrl(r.body)
        }
      },
      (e) => {
        tab?.close()
        fail(e)
      },
    )
  }

  async function tick() {
    if (!draftId || sent) return
    setSent(true)
    try {
      const r = await x.markSent(draftId)
      if (!r.logged) return
      play('ask-logged')
      toast({ tone: 'success', icon: 'check', message: 'Logged. ' + firstName(investor.name) + '’s last touch is today.' })
    } catch (e) {
      setSent(false)
      fail(e)
    }
  }

  async function send() {
    setSending(true)
    try {
      const r = await x.send(input())
      play('ask-logged')
      toast({ tone: 'success', icon: 'check', message: 'Sent to ' + r.to + '. Logged as an email touch.' })
      setSent(true)
      setDirty(false)
      onClose()
    } catch (e) {
      setSending(false)
      fail(e)
    }
  }

  const rec = info ? recipientFor(type, info.contact, info.warm) : null
  const writing = phase === 'writing' || phase === 'loading'
  const n = blanks(subject + '\n' + body)
  const canSend = !writing && !sent && isEmail(to) && !!subject.trim() && !!body.trim()
  const eyebrow = phase === 'nokey' ? 'Draft' : writing ? 'Draft · writing…' : cost > 0 ? 'Draft · ' + cents(cost) : 'Draft'
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value)
    setDirty(true)
  }

  return (
    <Modal onClose={close} labelledBy={titleId} className="draft" initialFocus="panel">
      <IconButton icon="close" label="Close" className="draft__close" onClick={close} />
      <p className="draft__eyebrow eyebrow-mono">
        <Icon name="spark" size={14} className="draft__spark" />
        {eyebrow}
      </p>
      <h2 id={titleId} className="draft__title">
        {draftTitle(type, investor.name, type === 'intro' ? info?.warm : null)}
      </h2>

      <div className="draft__types" role="group" aria-label="What to write">
        {PICK_TYPES.map((t) => (
          <button key={t} type="button" className={'draft-chip' + (t === type ? ' is-on' : '')} aria-pressed={t === type} disabled={writing && t !== type} onClick={() => pick(t)}>
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>

      <dl className="draft__head">
        <dt>
          <label htmlFor={titleId + '-to'}>To</label>
        </dt>
        <dd className="draft__to">
          {rec && normEmail(to) === rec.email && rec.name ? <span className="draft__name">{rec.name} ·</span> : null}
          <input
            id={titleId + '-to'}
            type="email"
            value={to}
            onChange={edit(setTo)}
            placeholder={type === 'intro' ? 'Nobody yet: forward it, or add an email' : 'Add their email'}
            autoComplete="off"
            spellCheck={false}
          />
        </dd>
        <dt>
          <label htmlFor={titleId + '-subject'}>Subject</label>
        </dt>
        <dd>
          <input id={titleId + '-subject'} value={subject} onChange={edit(setSubject)} placeholder={writing ? 'Writing…' : 'Subject'} disabled={writing} />
        </dd>
      </dl>

      {phase === 'nokey' ? (
        <p className="draft__note draft__note--nokey">
          <Icon name="spark" size={16} />
          <span>
            <strong>AI isn’t set up here,</strong> so Nest can’t write this one. Write it yourself; Copy, WhatsApp{info?.emailReady ? ' and Send' : ''} still work.
          </span>
        </p>
      ) : null}

      <div className={'draft__body' + (writing ? ' is-writing' : '')} aria-busy={writing || undefined}>
        <label htmlFor={titleId + '-body'} className="sr-only">
          Message
        </label>
        <textarea id={titleId + '-body'} value={body} onChange={edit(setBody)} disabled={writing} placeholder={writing ? '' : phase === 'nokey' ? 'Hi …' : ''} rows={14} />
        {writing ? (
          <div className="draft__writing" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
        ) : null}
      </div>

      {phase === 'failed' ? (
        <p className="draft__note draft__note--failed" role="alert">
          <span>{problem}</span>
          <Button size="sm" variant="secondary" onClick={() => void write(type)}>
            Try again
          </Button>
        </p>
      ) : null}

      <p className="draft__caption">
        {n ? <strong>{n === 1 ? '1 blank' : n + ' blanks'} to fill ([__]). </strong> : null}
        {isAiType(type) ? 'Numbers come from your notes and Materials. Nest never makes them up; check before sending.' : 'Amount, cap and dates come from Close and Settings. Nothing is guessed.'}
      </p>

      {phase !== 'nokey' && !sent && isAiType(type) ? (
        <div className="draft__tweaks" role="group" aria-label="Rewrite it">
          {TWEAKS.filter((t) => t !== 'deck' || info?.hasDeck).map((t) => (
            <button key={t} type="button" className="draft-chip draft-chip--tweak" disabled={writing || phase === 'failed' || !body.trim()} onClick={() => void write(type, t)}>
              {TWEAK_LABEL[t]}
            </button>
          ))}
        </div>
      ) : null}

      <footer className="draft__foot">
        <div className="draft__share">
          <Button variant="secondary" onClick={() => void copy()} disabled={writing || !body.trim()}>
            Copy
          </Button>
          <Button variant="secondary" onClick={whatsapp} disabled={writing || !body.trim()}>
            WhatsApp
          </Button>
          {via && draftId ? <Checkbox className="draft__sent" label="I sent it" checked={sent} disabled={sent} onChange={() => void tick()} /> : null}
        </div>
        {info?.emailReady ? (
          <div className="draft__send">
            <Button variant="primary" onClick={() => void send()} loading={sending} loadingLabel="Sending…" disabled={!canSend}>
              {sent ? 'Sent' : 'Send from nest@pestokids.com'}
            </Button>
            <p>Replies go to dev@pestokids.com. Sending logs an email touch.</p>
          </div>
        ) : (
          <p className="draft__send-off">Copy it or share it on WhatsApp. Tick “I sent it” once it’s gone, and Nest logs the touch.</p>
        )}
      </footer>
    </Modal>
  )
}
