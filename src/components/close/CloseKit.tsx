// PST-291: the Close kit (screens/round5/close-same-day-kit.png). Left: the
// written confirmation (a "confirm" draft in the drafts system: sent from
// nest@, or copied and ticked "I sent it", which starts the 48-hour offer),
// then the next step's button. Right: the close, step by step, with each
// step's deadline, and the questionnaire.
import { useEffect, useState } from 'react'
import { stepMap, type Questionnaire } from '../../lib/close'
import {
  commitmentTerms, confirmText, currentStep, dueText, istParts, KIT_LABEL, KIT_SUB, kitSteps, offerUntil, OFFER_HOURS, possessive, verbalOf,
  type KitRow, type KitStep,
} from '../../lib/closeKit'
import { formatDay, todayIST } from '../../lib/dates'
import { blanks, isEmail, type DraftInput } from '../../lib/drafts'
import { normEmail } from '../../lib/google'
import { money } from '../../lib/money'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useDrafts } from '../drafts/data'
import { useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Icon, IconButton, Segmented } from '../ui'
import { useClose } from './CloseData'
import { useTick } from './useTick'

const MINUTE = 60_000
const QUESTIONNAIRE: { value: Questionnaire | 'none'; label: string }[] = [
  { value: 'none', label: 'Not sent' },
  { value: 'sent', label: 'Sent' },
  { value: 'received', label: 'Received' },
]

/** The clock, a tick a minute, so deadlines and "Due 23:59" stay current while the kit is open. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), MINUTE)
    return () => clearInterval(t)
  }, [])
  return now
}

export function CloseKit({ investor, onClose }: { investor: Investor; onClose: () => void }) {
  const d = useRaise()
  const c = useClose()
  const x = useDrafts()
  const { toast, fail } = useUI()
  const save = useSaveAction()
  const tick = useTick()
  const titleId = useTitleId()
  const now = useNow()
  const info = x.useInvestorDrafts(investor._id)
  const closing = c.closings.find((k) => k.investorId === investor._id) ?? null
  const verbal = verbalOf(investor._id, d.acts)
  const today = todayIST(now)
  const rows = kitSteps(closing, { verbalDay: verbal?.day, now })
  const cur = currentStep(rows)
  const confirmed = rows[0].done
  const terms = commitmentTerms(investor, closing, d.round, c.tranche2)
  const contact = info?.contact ?? null

  const [to, setTo] = useState<string | null>(null)
  const [edited, setEdited] = useState<{ subject: string; body: string } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const textAt = (at: number) => confirmText({ investorName: investor.name, contactName: contact?.name ?? closing?.signerName, terms, now: at, verbalToday: verbal?.day === todayIST(at), me: d.me })
  const text = edited ?? textAt(now)
  const toValue = to ?? contact?.email ?? closing?.signerEmail ?? investor.email ?? ''
  const gaps = blanks(text.subject + '\n' + text.body)
  const input = (t = text): DraftInput => ({ investorId: investor._id, type: 'confirm', to: toValue, subject: t.subject, body: t.body })
  const offerEnds = closing?.confirmationSentAt ? closing.confirmationSentAt + OFFER_HOURS * 3600_000 : null

  async function send() {
    setBusy(true)
    try {
      const r = await x.send(input(edited ?? textAt(Date.now())))
      play('log')
      toast({ tone: 'success', icon: 'check', message: `Sent to ${r.to}. The 48-hour offer is running.` })
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    const t = edited ?? textAt(Date.now())
    try {
      const [r] = await Promise.all([x.copied(input(t), 'copy'), navigator.clipboard.writeText(t.body)])
      setCopiedId(r.draftId)
      toast({ tone: 'success', icon: 'check', message: 'Copied. Once it’s gone, tick “I sent it” to start the 48-hour clock.' })
    } catch (e) {
      fail(e)
    }
  }

  async function sentIt() {
    if (!copiedId) return
    await save(() => x.markSent(copiedId), {
      failMessage: 'Couldn’t start the clock.',
      onDone: () => {
        play('log')
        toast({ tone: 'success', icon: 'check', message: 'Logged. The 48-hour offer is running.' })
      },
    })
  }

  const kit = (patch: Parameters<typeof c.setKit>[1], message: string) =>
    closing && save(() => c.setKit(closing._id, patch), { failMessage: `Couldn’t update ${possessive(investor.name)} close.`, onDone: () => toast({ tone: 'success', message }) })

  const amount = terms.amount ? money(terms.amount) : 'the amount'
  const title = !confirmed
    ? verbal?.day === today ? `Lock in ${possessive(investor.name)} ${amount} today` : `Lock in ${possessive(investor.name)} ${amount} in writing`
    : cur === 'accept' ? `Offer out to ${investor.name}`
    : cur ? `Close ${possessive(investor.name)} ${amount}`
    : `${possessive(investor.name)} money is in`
  const verbalWhen = verbal ? (verbal.day === today ? 'today' : istParts(Date.parse(verbal.day + 'T12:00:00+05:30')).weekday) + (verbal.at ? ' ' + istParts(verbal.at).time : '') : ''

  return (
    <Modal onClose={onClose} labelledBy={titleId} className="kit" initialFocus="panel">
      <IconButton icon="close" label="Close" className="draft__close" onClick={onClose} />
      <p className="draft__eyebrow eyebrow-mono">
        <Icon name="spark" size={14} className="draft__spark" />
        {['Same-day close', investor.name, verbalWhen ? 'Verbal ' + verbalWhen : ''].filter(Boolean).join(' · ')}
      </p>
      <h2 id={titleId} className="draft__title">
        {title}
      </h2>
      <p className="kit__sub">A verbal is only real once it’s in writing. Confirm today, then send the SAFE.</p>

      <div className="kit__grid">
        <div className="kit__main">
          {!confirmed ? (
            <>
              <div className="kit-mail">
                <dl className="draft__head">
                  <dt>
                    <label htmlFor={titleId + '-to'}>To</label>
                  </dt>
                  <dd className="draft__to">
                    {contact?.name && normEmail(toValue) === contact.email ? <span className="draft__name">{contact.name} ·</span> : null}
                    <input id={titleId + '-to'} type="email" value={toValue} onChange={(e) => setTo(e.target.value)} placeholder="Add their email" autoComplete="off" spellCheck={false} />
                  </dd>
                  <dt>
                    <label htmlFor={titleId + '-subject'}>Subject</label>
                  </dt>
                  <dd>
                    <input id={titleId + '-subject'} value={text.subject} onChange={(e) => setEdited({ ...text, subject: e.target.value })} />
                  </dd>
                </dl>
                <div className="draft__body kit-mail__body">
                  <label htmlFor={titleId + '-body'} className="sr-only">
                    Message
                  </label>
                  <textarea id={titleId + '-body'} value={text.body} onChange={(e) => setEdited({ ...text, body: e.target.value })} rows={11} />
                </div>
                <p className="kit-mail__caption">
                  {gaps ? <strong>{gaps === 1 ? '1 blank' : gaps + ' blanks'} to fill ([__]): add the amount and the round’s cap in Settings. </strong> : null}
                  Amount, cap and dates come from Close and Settings. Nothing is guessed.
                </p>
              </div>
              <div className="kit__btns">
                <Button variant="secondary" onClick={() => void copy()} disabled={!text.body.trim()}>
                  Copy
                </Button>
                {copiedId ? (
                  <Button variant="secondary" icon="check" onClick={() => void sentIt()}>
                    I sent it · start the 48 h clock
                  </Button>
                ) : null}
                {info?.emailReady ? (
                  <Button variant="primary" onClick={() => void send()} loading={busy} loadingLabel="Sending…" disabled={!isEmail(toValue) || gaps > 0}>
                    Send from nest@ and start the 48 h clock
                  </Button>
                ) : null}
              </div>
              <p className="kit__fine">{info?.emailReady ? 'Sent from nest@pestokids.com; replies go to dev@pestokids.com. Sending logs an email touch.' : 'Email isn’t set up here: copy it, send it yourself, then tick “I sent it”.'}</p>
            </>
          ) : (
            <Next
              step={cur}
              name={investor.name}
              sentAt={closing?.confirmationSentAt}
              offerEnds={offerEnds}
              now={now}
              onAccept={() => kit({ accepted: true }, `${investor.name} accepted. Send the SAFE and the questionnaire today.`)}
              onSafe={async (el) => {
                if (!closing) return
                if (!stepMap(closing).sent) await tick(closing, investor.name, 'sent', today, { from: el })
                if (!closing.questionnaire) await kit({ questionnaire: 'sent' }, 'SAFE and questionnaire sent.')
              }}
              onTick={(key, el) => closing && void tick(closing, investor.name, key, today, { from: el })}
              signed={!!stepMap(closing).signed}
              safeSent={!!stepMap(closing).sent}
            />
          )}
          {closing && c.tranche2 ? (
            <div className="kit__tranche">
              <span>Tranche</span>
              <Segmented
                label="Tranche"
                value={String(terms.tranche) as '1' | '2'}
                onChange={(v) => void kit({ tranche: v === '2' ? 2 : 1 }, `${investor.name} is in tranche ${v}. Same terms as everyone in it.`)}
                options={[
                  { value: '1', label: `1 · ${money(d.round.cap ?? closing.cap)} post` },
                  { value: '2', label: `2 · ${money(c.tranche2.cap)} post` },
                ]}
              />
            </div>
          ) : null}
        </div>

        <aside className="kit__side">
          <section className="kit-steps card">
            <p className="eyebrow-mono kit-steps__h">The close, step by step</p>
            <ol>
              {rows.map((r, i) => (
                <Step key={r.key} row={r} n={i + 1} now={now} on={r.key === cur} verbalToday={verbal?.day === today} />
              ))}
            </ol>
            <div className="kit-q">
              <h3>Questionnaire</h3>
              <p>Confirms they can invest (accredited, entity, address). Sent with the SAFE; Nest tracks the reply.</p>
              {closing ? (
                <Segmented
                  label="Questionnaire"
                  value={closing.questionnaire ?? 'none'}
                  onChange={(v) => void kit({ questionnaire: v }, v === 'received' ? 'Questionnaire back.' : v === 'sent' ? 'Questionnaire sent.' : 'Questionnaire not sent.')}
                  options={QUESTIONNAIRE}
                />
              ) : null}
            </div>
          </section>
          <p className="kit__warn">Big checks: don’t commit in the room. Say you’ll come back within 2–3 days, then allocate.</p>
        </aside>
      </div>
    </Modal>
  )
}

function Step({ row, n, now, on, verbalToday }: { row: KitRow; n: number; now: number; on: boolean; verbalToday: boolean }) {
  const due = dueText(row, now)
  const late = due.startsWith('Due') || due === 'Overdue'
  return (
    <li className={`kit-step${row.done ? ' is-done' : ''}${on ? ' is-now' : ''}`}>
      <span className="kit-step__n" aria-hidden="true">
        {row.done ? <Icon name="check" size={14} strokeWidth={2.6} /> : n}
      </span>
      <div className="kit-step__text">
        <strong>{KIT_LABEL[row.key]}</strong>
        <span>{row.key === 'confirm' && verbalToday ? 'Today, within the day' : KIT_SUB[row.key]}</span>
      </div>
      <span className={`kit-step__due${late ? ' is-late' : ''}`}>{row.done ? <span className="sr-only">Done</span> : due}</span>
    </li>
  )
}

/** After the confirmation: what's next, and its one button. */
function Next({ step, name, sentAt, offerEnds, now, onAccept, onSafe, onTick, signed, safeSent }: {
  step: KitStep | null
  name: string
  sentAt?: number
  offerEnds: number | null
  now: number
  onAccept: () => void
  onSafe: (el: HTMLElement) => void
  onTick: (key: 'signed' | 'countersigned' | 'wired', el: HTMLElement) => void
  signed: boolean
  safeSent: boolean
}) {
  const first = name.split(/\s+/)[0]
  const left = offerEnds ? Math.max(0, Math.round((offerEnds - now) / 3600_000)) : 0
  const sent = sentAt ? `Confirmation sent ${formatDay(sentAt)} at ${istParts(sentAt).time}.` : ''
  const body: Record<KitStep, { h: string; p: string; btn?: [string, (el: HTMLElement) => void] }> = {
    confirm: { h: '', p: '' },
    accept: {
      h: `Waiting on ${possessive(name)} yes`,
      p: offerEnds ? (offerEnds > now ? `The offer stands until ${offerUntil(offerEnds)}: ${left} h left.` : `The offer ran out at ${offerUntil(offerEnds)}. Chase ${first}, or send a new confirmation.`) : '',
      btn: ['They accepted', () => onAccept()],
    },
    safe: { h: 'Send the SAFE and the questionnaire today', p: 'Same day as the yes, while it’s warm. Tick it once both have gone.', btn: [safeSent ? 'Questionnaire sent' : 'SAFE and questionnaire sent', onSafe] },
    signed: signed
      ? { h: 'Countersign today', p: `${first} signed. Countersign the same day.`, btn: ['Countersigned', (el) => onTick('countersigned', el)] }
      : { h: `Waiting on ${possessive(name)} signature`, p: 'Tick it when their signature is in.', btn: [`${first} signed`, (el) => onTick('signed', el)] },
    wire: { h: 'Waiting on the wire', p: '10 business days from their yes.', btn: ['Wire in', (el) => onTick('wired', el)] },
  }
  if (!step) return <div className="kit-next card"><h3>Money in</h3><p>Every step is done. {sent}</p></div>
  const b = body[step]
  return (
    <div className="kit-next card">
      <p className="eyebrow-mono">Next · {KIT_LABEL[step]}</p>
      <h3>{b.h}</h3>
      <p>{[b.p, sent].filter(Boolean).join(' ')}</p>
      {b.btn ? (
        <Button variant="primary" onClick={(e) => b.btn![1](e.currentTarget)}>
          {b.btn[0]}
        </Button>
      ) : null}
    </div>
  )
}

