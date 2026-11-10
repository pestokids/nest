// PST-294: the forwardable intro draft (draft-forwardable-intro.png). Two emails,
// both to the introducer: the ask, and a short note they can forward to the
// investor as it is. Numbers Nest doesn't have stay [__]; the deck link is the
// investor's tracked Materials link (made when it's copied or sent). Copy both,
// or send the ask from nest@ (replies go to Dev): sending ticks "Asked".
import { useEffect, useRef, useState } from 'react'
import { blanks, DECK_LINK, hasLinkSlot, isEmail, type DraftInput, type Forward } from '../../lib/drafts'
import { cents, NO_AI_KEY } from '../../lib/enrich'
import { normEmail } from '../../lib/google'
import { allPeople, firstName, personKey } from '../../lib/introducers'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { errorMessage, useRaise } from '../data'
import { useIntroducers } from '../introducers/data'
import { useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { Button, Checkbox, Icon, IconButton } from '../ui'
import { useDrafts, type DraftOpen } from './data'
import { toClipboard } from './DraftDialog'

type Phase = 'loading' | 'writing' | 'ready' | 'nokey' | 'failed'
type Tab = 'ask' | 'forward'
const isNoKey = (e: unknown) => (e as { data?: { code?: string } })?.data?.code === NO_AI_KEY
const EMPTY: Forward = { subject: '', body: '' }

/** Both emails as one text to paste: the ask, then the note to forward. */
const both = (ask: { subject: string; body: string }, fwd: Forward) =>
  ['The ask', 'Subject: ' + ask.subject, '', ask.body, '', '', 'To forward', 'Subject: ' + fwd.subject, '', fwd.body].join('\n')

export function ForwardableDialog({ start, introId, investor, onClose }: { start: DraftOpen; introId: string; investor: Investor; onClose: () => void }) {
  const x = useDrafts()
  const intro = useIntroducers()
  const d = useRaise()
  const { toast, fail } = useUI()
  const titleId = useTitleId()
  const info = x.useInvestorDrafts(investor._id)
  const row = intro.intros.find((i) => i._id === introId)
  const person = row ? allPeople(intro.introducers, d.investors).find((p) => p.key === personKey(row)) : undefined
  const who = firstName(person?.name ?? 'them')
  const [tab, setTab] = useState<Tab>('ask')
  const [draftId, setDraftId] = useState(start.draftId)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [fwd, setFwd] = useState<Forward>(EMPTY)
  const [cost, setCost] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [problem, setProblem] = useState('')
  const [dirty, setDirty] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const started = useRef(false)
  const run = useRef(0)

  const input = (): DraftInput => ({ draftId, investorId: investor._id, type: 'forwardable', to, subject, body, introId, forward: fwd })

  async function write() {
    const n = ++run.current
    setPhase('writing')
    setProblem('')
    try {
      const r = await x.generate({ draftId, investorId: investor._id, type: 'forwardable', introId })
      if (n !== run.current) return
      setDraftId(r.draftId)
      setSubject(r.subject)
      setBody(r.body)
      setFwd(r.forward ?? EMPTY)
      setCost(r.costUsd)
      setDirty(false)
      setPhase('ready')
    } catch (e) {
      if (n !== run.current) return
      if (isNoKey(e)) return setPhase('nokey')
      setProblem(errorMessage(e))
      setPhase('failed')
    }
  }

  // Once the investor's keys and the introducer are in: reopen a saved draft, or write a new one.
  useEffect(() => {
    if (info === undefined || !intro.loaded || started.current) return
    started.current = true
    if (info === null || !row || !person) return onClose()
    const saved = start.draftId ? info.drafts.find((y) => y._id === start.draftId) : undefined
    if (saved) {
      setTo(saved.to ?? person.email ?? '')
      setSubject(saved.subject)
      setBody(saved.body)
      setFwd(saved.forward ?? EMPTY)
      setCost(saved.costUsd)
      setCopied(saved.status === 'copied')
      setSent(saved.status === 'sent')
      setPhase(info.aiReady ? 'ready' : 'nokey')
      return
    }
    setTo(normEmail(person.email))
    if (info.aiReady) void write()
    else setPhase('nokey')
  }, [info, intro.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    if (dirty && !sent && phase !== 'writing' && (body.trim() || fwd.body.trim())) void x.save(input()).catch(() => {})
    onClose()
  }

  async function copy() {
    const going = x.copied(input(), 'copy')
    const clip = toClipboard(hasLinkSlot(body + fwd.body) ? going.then((r) => both({ subject, body: r.body }, r.forward ?? fwd)) : both({ subject, body }, fwd))
    let r
    try {
      r = await going
    } catch (e) {
      clip.catch(() => {})
      return fail(e)
    }
    setDraftId(r.draftId)
    setBody(r.body)
    if (r.forward) setFwd(r.forward)
    setDirty(false)
    setCopied(true)
    try {
      await clip
      toast({ tone: 'success', icon: 'check', message: sent ? 'Copied both.' : 'Copied both. Tick “I sent it” once the ask is gone, and Nest marks it Asked.' })
    } catch {
      play('failed')
      toast({ tone: 'error', message: 'Couldn’t copy here. Select the text and copy it yourself.' })
    }
  }

  async function tick() {
    if (!draftId || sent) return
    setSent(true)
    try {
      const r = await x.markSent(draftId)
      if (!r.logged) return
      play('log')
      toast({ tone: 'success', icon: 'check', message: 'Asked ' + who + '. Nest nudges you in 3 days if there’s no reply.' })
    } catch (e) {
      setSent(false)
      fail(e)
    }
  }

  async function send() {
    setSending(true)
    try {
      const r = await x.send(input())
      play('log')
      toast({ tone: 'success', icon: 'check', message: 'Sent to ' + r.to + '. ' + who + ' is Asked; Nest nudges you in 3 days if there’s no reply.' })
      setSent(true)
      setDirty(false)
      onClose()
    } catch (e) {
      setSending(false)
      fail(e)
    }
  }

  const writing = phase === 'writing' || phase === 'loading'
  const n = blanks(subject + '\n' + body + '\n' + fwd.subject + '\n' + fwd.body)
  const askBlanks = blanks(subject + '\n' + body)
  const canSend = !writing && !sent && isEmail(to) && !!subject.trim() && !!body.trim()
  const eyebrow = 'Draft · Forwardable intro' + (writing && phase !== 'loading' ? ' · writing…' : cost > 0 ? ' · ' + cents(cost) : '')
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value)
    setDirty(true)
  }
  const onAsk = tab === 'ask'
  const deckLine = !(body + fwd.body).includes(DECK_LINK)
    ? ''
    : info?.hasDeck
      ? 'The deck link is a tracked Materials link for ' + investor.name + ', made when you copy or send.'
      : 'There’s no deck in Materials yet. Add it there, or take ' + DECK_LINK + ' out.'

  return (
    <Modal onClose={close} labelledBy={titleId} className="draft draft--fwd" initialFocus="panel">
      <IconButton icon="close" label="Close" className="draft__close" onClick={close} />
      <p className="draft__eyebrow eyebrow-mono">
        <Icon name="spark" size={14} className="draft__spark" />
        {eyebrow}
      </p>
      <h2 id={titleId} className="draft__title">
        Ask {who} for an intro to {investor.name}
      </h2>
      <p className="draft__lede">Two emails: a short ask to {who}, and one {who} can forward as it is.</p>

      <div className="draft__types" role="tablist" aria-label="Which email">
        {(['ask', 'forward'] as const).map((t, i) => (
          <button key={t} type="button" role="tab" id={titleId + '-tab-' + t} aria-selected={tab === t} aria-controls={titleId + '-panel'} className={'draft-chip' + (tab === t ? ' is-on' : '')} onClick={() => setTab(t)}>
            {i + 1} {t === 'ask' ? 'The ask' : 'Forwardable'}
          </button>
        ))}
      </div>

      <div id={titleId + '-panel'} role="tabpanel" aria-labelledby={titleId + '-tab-' + tab}>
        <dl className="draft__head">
          <dt>
            <label htmlFor={titleId + '-to'}>To</label>
          </dt>
          <dd className="draft__to">
            {person?.name && normEmail(to) === normEmail(person.email) && to ? <span className="draft__name">{person.name} ·</span> : null}
            {onAsk ? (
              <input id={titleId + '-to'} type="email" value={to} onChange={edit(setTo)} placeholder={'Add ' + who + '’s email'} autoComplete="off" spellCheck={false} />
            ) : (
              <input id={titleId + '-to'} value={to || person?.name || ''} readOnly title={'You send it to ' + who + ', who forwards it'} />
            )}
          </dd>
          <dt>
            <label htmlFor={titleId + '-subject'}>Subject</label>
          </dt>
          <dd>
            <input
              id={titleId + '-subject'}
              value={onAsk ? subject : fwd.subject}
              onChange={edit(onAsk ? setSubject : (v) => setFwd((f) => ({ ...f, subject: v })))}
              placeholder={writing ? 'Writing…' : 'Subject'}
              disabled={writing}
            />
          </dd>
        </dl>

        {phase === 'nokey' ? (
          <p className="draft__note draft__note--nokey">
            <Icon name="spark" size={16} />
            <span>
              <strong>AI isn’t set up here,</strong> so Nest can’t write these. Write them yourself; Copy{info?.emailReady ? ' and Send' : ''} still work.
            </span>
          </p>
        ) : null}

        <div className={'draft__body' + (writing ? ' is-writing' : '')} aria-busy={writing || undefined}>
          <label htmlFor={titleId + '-body'} className="sr-only">
            {onAsk ? 'The ask' : 'The note to forward'}
          </label>
          <textarea
            id={titleId + '-body'}
            value={onAsk ? body : fwd.body}
            onChange={edit(onAsk ? setBody : (v) => setFwd((f) => ({ ...f, body: v })))}
            disabled={writing}
            placeholder={writing ? '' : phase === 'nokey' ? 'Hi ' + who + ',' : ''}
            rows={12}
          />
          {writing ? (
            <div className="draft__writing" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          ) : null}
        </div>
      </div>

      {phase === 'failed' ? (
        <p className="draft__note draft__note--failed" role="alert">
          <span>{problem}</span>
          <Button size="sm" variant="secondary" onClick={() => void write()}>
            Try again
          </Button>
        </p>
      ) : null}

      <p className="draft__caption">
        {n ? <strong>{n === 1 ? '1 blank' : n + ' blanks'} to fill ([__]). </strong> : null}
        Nest never makes numbers up.
      </p>
      {deckLine ? <p className="draft__fine">{deckLine}</p> : null}

      <footer className="draft__foot">
        <div className="draft__share">
          <Button variant="secondary" onClick={() => void copy()} disabled={writing || !(body.trim() || fwd.body.trim())}>
            Copy both
          </Button>
          {copied && draftId ? <Checkbox className="draft__sent" label="I sent it" checked={sent} disabled={sent} onChange={() => void tick()} /> : null}
        </div>
        {info?.emailReady ? (
          <div className="draft__send">
            <Button variant="primary" onClick={() => void send()} loading={sending} loadingLabel="Sending…" disabled={!canSend}>
              {sent ? 'Sent' : 'Send the ask from nest@'}
            </Button>
            <p>{askBlanks && !sent ? 'Fill the ask’s blanks first. ' : ''}Sending marks the intro “Asked” and starts the clock.</p>
          </div>
        ) : (
          <p className="draft__send-off">Copy both. Tick “I sent it” once the ask is gone, and Nest marks it Asked.</p>
        )}
      </footer>
    </Modal>
  )
}
