// PST-305: "Ask <name> for intros" (draft-forwardable-intro.png's layout, one
// email). Pick 2–3 investors from the person's list that are still "to ask" (the
// three highest by Priority come ticked); Haiku writes a line on why each fits,
// from Nest's facts only, and a short note about Pesto they can forward. Numbers
// Nest doesn't have stay [__], and a missing reason stays [why they fit]. Copy
// it, or send it from nest@ (replies go to Dev): sending ticks "Asked" on each.
import { useEffect, useMemo, useRef, useState } from 'react'
import { blanks, isEmail, type DraftInput } from '../../lib/drafts'
import { cents, NO_AI_KEY } from '../../lib/enrich'
import { normEmail } from '../../lib/google'
import { allPeople, firstName, personKey } from '../../lib/introducers'
import { askable, askBlanks, askPicks, askTitle, ASK_MAX, composeAsk, WHY_SLOT } from '../../lib/network'
import { priorities } from '../../lib/priority'
import { play } from '../../lib/sound'
import { LABEL } from '../../lib/stages'
import { todayIST } from '../../lib/dates'
import { errorMessage, useRaise } from '../data'
import { useIntroducers } from '../introducers/data'
import { usePreviewState } from '../preview-state'
import { useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { Button, Checkbox, Icon, IconButton } from '../ui'
import { useDrafts, type DraftOpen } from './data'
import { toClipboard } from './DraftDialog'

type Phase = 'pick' | 'loading' | 'writing' | 'ready' | 'failed'
const isNoKey = (e: unknown) => (e as { data?: { code?: string } })?.data?.code === NO_AI_KEY

export function IntroAskDialog({ start, onClose }: { start: DraftOpen; onClose: () => void }) {
  const x = useDrafts()
  const intro = useIntroducers()
  const d = useRaise()
  const fits = d.useFits()
  const { toast, fail } = useUI()
  const titleId = useTitleId()
  const autoWrite = usePreviewState()?.draft === 'intro-ask'
  const info = x.useInvestorDrafts(start.investorId)
  const saved = start.draftId ? info?.drafts.find((y) => y._id === start.draftId) : undefined
  const key = start.personKey ?? (saved?.introIds?.[0] ? personKey(intro.intros.find((i) => i._id === saved.introIds![0]) ?? {}) : undefined)
  const person = key ? allPeople(intro.introducers, d.investors).find((p) => p.key === key) : undefined
  const who = person?.name ?? 'them'
  const byId = useMemo(() => new Map(d.investors.map((i) => [i._id, i])), [d.investors])
  const options = intro.intros.filter((i) => personKey(i) === key && (askable(i, byId.get(i.investorId)) || saved?.introIds?.includes(i._id)))
  const prio = useMemo(() => priorities(d.investors, fits, todayIST()), [d.investors, fits])
  const [picked, setPicked] = useState<string[]>([])
  const [draftId, setDraftId] = useState(start.draftId)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [cost, setCost] = useState(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [nokey, setNokey] = useState(false)
  const [problem, setProblem] = useState('')
  const [dirty, setDirty] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState(false)
  const [sending, setSending] = useState(false)
  const started = useRef(false)
  const run = useRef(0)
  const names = (ids: readonly string[]) => ids.map((id) => byId.get(intro.intros.find((i) => i._id === id)?.investorId ?? '')?.name ?? '').filter(Boolean)
  const input = (): DraftInput => ({ draftId, investorId: byId.has(intro.intros.find((i) => i._id === picked[0])?.investorId ?? '') ? intro.intros.find((i) => i._id === picked[0])!.investorId : start.investorId, type: 'introAsk', to, subject, body, introIds: picked })

  // Once the drafts and the person are in: reopen a saved ask, or pick (the top 3 by Priority ticked).
  useEffect(() => {
    if (info === undefined || !intro.loaded || started.current) return
    started.current = true
    if (info === null || !person) return onClose()
    setNokey(!info.aiReady)
    if (saved) {
      setPicked(saved.introIds ?? [])
      setTo(saved.to ?? normEmail(person.email))
      setSubject(saved.subject)
      setBody(saved.body)
      setCost(saved.costUsd)
      setCopied(saved.status === 'copied')
      setSent(saved.status === 'sent')
      setPhase('ready')
      return
    }
    const picks = askPicks(options, (id) => byId.get(id)?.name ?? '', (id) => prio.get(id)?.score ?? 0)
    setPicked(picks)
    setTo(normEmail(person.email))
    setPhase('pick')
    if (autoWrite && picks.length) void write(picks)
  }, [info, intro.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  async function write(ids = picked) {
    if (!ids.length) return
    if (nokey || info?.aiReady === false) {
      const text = composeAsk({}, { who, me: 'Dev', picked: names(ids), known: '' })
      setSubject(text.subject)
      setBody(text.body)
      setDirty(true)
      return setPhase('ready')
    }
    const n = ++run.current
    setPhase('writing')
    setProblem('')
    try {
      const r = await x.writeAsk({ draftId, introIds: ids })
      if (n !== run.current) return
      setDraftId(r.draftId)
      setSubject(r.subject)
      setBody(r.body)
      if (r.to && !to) setTo(r.to)
      setCost(r.costUsd)
      setDirty(false)
      setPhase('ready')
    } catch (e) {
      if (n !== run.current) return
      if (isNoKey(e)) {
        setNokey(true)
        const text = composeAsk({}, { who, me: 'Dev', picked: names(ids), known: '' })
        setSubject(text.subject)
        setBody(text.body)
        return setPhase('ready')
      }
      setProblem(errorMessage(e))
      setPhase('failed')
    }
  }

  function close() {
    if (dirty && !sent && phase === 'ready' && body.trim()) void x.save(input()).catch(() => {})
    onClose()
  }

  async function copy() {
    const going = x.copied(input(), 'copy')
    const clip = toClipboard(going.then((r) => 'Subject: ' + subject + '\n\n' + r.body))
    let r
    try {
      r = await going
    } catch (e) {
      clip.catch(() => {})
      return fail(e)
    }
    setDraftId(r.draftId)
    setBody(r.body)
    setDirty(false)
    setCopied(true)
    try {
      await clip
      toast({ tone: 'success', icon: 'check', message: sent ? 'Copied.' : 'Copied. Tick “I sent it” once it’s gone, and Nest marks each intro Asked.' })
    } catch {
      play('failed')
      toast({ tone: 'error', message: 'Couldn’t copy here. Select the text and copy it yourself.' })
    }
  }

  async function tick() {
    if (!draftId || sent) return
    setSent(true)
    try {
      await x.markSent(draftId)
      play('log')
      toast({ tone: 'success', icon: 'check', message: 'Asked ' + firstName(who) + ' about ' + picked.length + '. Nest nudges you in 3 days if there’s no reply.' })
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
      toast({ tone: 'success', icon: 'check', message: 'Sent to ' + r.to + '. ' + picked.length + ' intros are Asked; Nest nudges you in 3 days if there’s no reply.' })
      setSent(true)
      setDirty(false)
      onClose()
    } catch (e) {
      setSending(false)
      fail(e)
    }
  }

  const writing = phase === 'writing' || phase === 'loading'
  const left = askBlanks(subject + '\n' + body)
  const canSend = phase === 'ready' && !sent && isEmail(to) && !!subject.trim() && !!body.trim()
  const eyebrow = 'Draft · Ask for intros' + (phase === 'writing' ? ' · writing…' : cost > 0 ? ' · ' + cents(cost) : '')
  const edit = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value)
    setDirty(true)
  }
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id].slice(0, ASK_MAX) : p.filter((y) => y !== id)))

  return (
    <Modal onClose={close} labelledBy={titleId} className="draft draft--fwd" initialFocus="panel">
      <IconButton icon="close" label="Close" className="draft__close" onClick={close} />
      <p className="draft__eyebrow eyebrow-mono">
        <Icon name="spark" size={14} className="draft__spark" />
        {eyebrow}
      </p>
      <h2 id={titleId} className="draft__title">
        {askTitle(who)}
      </h2>
      <p className="draft__lede">One email to {firstName(who)} naming 2–3 investors, why each fits, and a short note about Pesto {firstName(who)} can forward.</p>

      {phase === 'pick' || phase === 'loading' ? (
        <div className="net-askpick">
          <p className="net-askpick__h eyebrow-mono">Which investors · {picked.length} of {ASK_MAX}</p>
          {options.length ? (
            <ul className="net-pick">
              {options.map((i) => {
                const inv = byId.get(i.investorId)!
                const on = picked.includes(i._id)
                return (
                  <li key={i._id}>
                    <Checkbox
                      label={<><strong>{inv.name}</strong> <span className="net-pick__meta">{[inv.type, LABEL[inv.stage], prio.get(inv._id) ? 'Priority ' + prio.get(inv._id)!.score : ''].filter(Boolean).join(' · ')}</span></>}
                      checked={on}
                      disabled={!on && picked.length >= ASK_MAX}
                      onChange={(e) => toggle(i._id, e.currentTarget.checked)}
                    />
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="draft__fine">Nobody on {firstName(who)}’s list is still to ask.</p>
          )}
          <footer className="draft__foot">
            <p className="draft__send-off">{picked.length < 2 ? 'Two or three works best.' : 'Nest writes from what it knows about each investor, and never makes facts up.'}</p>
            <Button variant="primary" icon="spark" onClick={() => void write()} disabled={!picked.length}>
              {nokey ? 'Start the email' : 'Write the ask'}
            </Button>
          </footer>
        </div>
      ) : (
        <>
          <dl className="draft__head">
            <dt>
              <label htmlFor={titleId + '-to'}>To</label>
            </dt>
            <dd className="draft__to">
              {person?.email && normEmail(to) === normEmail(person.email) ? <span className="draft__name">{person.name} ·</span> : null}
              <input id={titleId + '-to'} type="email" value={to} onChange={edit(setTo)} placeholder={'Add ' + firstName(who) + '’s email'} autoComplete="off" spellCheck={false} />
            </dd>
            <dt>
              <label htmlFor={titleId + '-subject'}>Subject</label>
            </dt>
            <dd>
              <input id={titleId + '-subject'} value={subject} onChange={edit(setSubject)} placeholder={writing ? 'Writing…' : 'Subject'} disabled={writing} />
            </dd>
          </dl>
          {nokey ? (
            <p className="draft__note draft__note--nokey">
              <Icon name="spark" size={16} />
              <span>
                <strong>AI isn’t set up here,</strong> so Nest started it for you. Say why each fits; Copy{info?.emailReady ? ' and Send' : ''} still work.
              </span>
            </p>
          ) : null}
          <div className={'draft__body' + (writing ? ' is-writing' : '')} aria-busy={writing || undefined}>
            <label htmlFor={titleId + '-body'} className="sr-only">
              The ask
            </label>
            <textarea id={titleId + '-body'} value={body} onChange={edit(setBody)} disabled={writing} rows={14} />
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
              <Button size="sm" variant="secondary" onClick={() => void write()}>
                Try again
              </Button>
            </p>
          ) : null}
          <p className="draft__caption">
            {left ? <strong>{left === 1 ? '1 blank' : left + ' blanks'} to fill ([__]{body.includes(WHY_SLOT) ? ', ' + WHY_SLOT : ''}). </strong> : null}
            Nest never makes numbers or facts up.{' '}
            {!sent ? (
              <button type="button" className="net-link" onClick={() => setPhase('pick')}>
                Change investors
              </button>
            ) : null}
          </p>
          <footer className="draft__foot">
            <div className="draft__share">
              <Button variant="secondary" onClick={() => void copy()} disabled={writing || !body.trim()}>
                Copy
              </Button>
              {copied && draftId ? <Checkbox className="draft__sent" label="I sent it" checked={sent} disabled={sent} onChange={() => void tick()} /> : null}
            </div>
            {info?.emailReady ? (
              <div className="draft__send">
                <Button variant="primary" onClick={() => void send()} loading={sending} loadingLabel="Sending…" disabled={!canSend}>
                  {sent ? 'Sent' : 'Send from nest@'}
                </Button>
                <p>{(blanks(subject + '\n' + body) || body.includes(WHY_SLOT)) && !sent ? 'Fill the blanks first. ' : ''}Sending marks each intro “Asked”; replies go to you.</p>
              </div>
            ) : (
              <p className="draft__send-off">Copy it. Tick “I sent it” once it’s gone, and Nest marks each intro Asked.</p>
            )}
          </footer>
        </>
      )}
    </Modal>
  )
}
