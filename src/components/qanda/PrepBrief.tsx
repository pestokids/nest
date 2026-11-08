// PST-281: Today › prep brief (screens/raise-today/prep-brief.png). Before a
// meeting on the calendar with an investor in Raise: who they are, the last
// touches, their open next step, and the answers to have ready (the bank's
// questions they or investors like them asked most). Opening it plays prep-done
// once per meeting (interactions.png).
import { useEffect, useState } from 'react'
import { formatDay, todayIST } from '../../lib/dates'
import { timeOf, type SyncedMeeting } from '../../lib/google'
import { money } from '../../lib/money'
import { lastTouches, needsAnswer, prepQuestions, startsIn, whoTheyAre } from '../../lib/qanda'
import { STAGE_TILE } from '../../lib/stages'
import { useRaise } from '../data'
import { openDraft } from '../drafts/data'
import { Button } from '../ui'
import { useUI } from '../raise-ui'
import { useQanda } from './data'
import { openPanel, playPrepOpen, usePanels } from './panels'
import { Panel } from './Panel'

/** The "Prep" button on a Meetings today row; "Prep brief open" while it's open. */
export function PrepButton({ meeting, now }: { meeting: SyncedMeeting; now: number }) {
  const open = usePanels().some((p) => p.kind === 'prep' && p.meetingId === meeting._id)
  if (meeting.end <= now) return null
  return (
    <button
      type="button"
      className={`qa-prep${open ? ' qa-prep--open' : ''}`}
      aria-pressed={open}
      onClick={() => {
        if (open) return
        playPrepOpen(meeting._id)
        openPanel({ kind: 'prep', meetingId: meeting._id })
      }}
    >
      {open ? (
        <>
          <span className="qa-prep__dot" aria-hidden="true" />
          Prep brief open
        </>
      ) : (
        'Prep'
      )}
    </button>
  )
}

export function PrepBrief({ meetingId, level, onClose }: { meetingId: string; level: number; onClose: () => void }) {
  const d = useRaise()
  const ui = useUI()
  const { questions } = useQanda()
  const m = d.google.meetings.find((x) => x._id === meetingId)
  const inv = m ? d.investors.find((i) => m.investorIds.includes(i._id)) : undefined
  const log = d.useLog(inv?._id ?? null)
  const [now] = useState(() => Date.now())
  const [reading, setReading] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    if (!m || !inv) onClose()
  }, [m, inv, onClose])
  if (!m || !inv) return null

  const today = todayIST(now)
  const picks = prepQuestions(inv, d.investors, questions, 4)
  const theirs = d.google.threads.filter((t) => t.investorIds.includes(inv._id))
  const met = d.google.meetings.filter((x) => x._id !== m._id && x.investorIds.includes(inv._id))
  const touches = lastTouches(log ?? d.acts.filter((a) => a.investorId === inv._id), theirs, met, now, today)
  const open = questions.filter((q) => needsAnswer(q) && q.asks.some((a) => a.investorId === inv._id) && !picks.some((p) => p.q._id === q._id))
  const joining = m.people.map((p) => p.name?.split(/\s+/)[0]).filter(Boolean)
  const where = m.link?.includes('meet.google.com') ? 'Google Meet' : ''
  const step = inv.nextStep.trim()

  return (
    <Panel
      level={level}
      onClose={onClose}
      tone="new"
      className="qa-brief"
      eyebrow={`Prep brief · ${timeOf(m.start)} · ${startsIn(m.start, m.end, now, today)}`}
      title={inv.name}
      sub={[STAGE_TILE[inv.stage], joining.length ? `${joining.join(' and ')} ${joining.length === 1 ? 'joins' : 'join'}` : '', where].filter(Boolean).join(' · ')}
      footer={(c) => (
        <>
          <button
            type="button"
            className="drawer__textbtn"
            onClick={() => {
              c.close()
              ui.open(inv._id)
            }}
          >
            Open {inv.name}
          </button>
          <Button variant="secondary" icon="spark" onClick={() => openDraft({ investorId: inv._id, type: 'followup' })}>
            Follow up
          </Button>
        </>
      )}
    >
      {() => (
        <div className="qa-brief__body">
          <section className="qa-sec">
            <h3 className="qa-sec__h">Who they are</h3>
            <ul className="qa-dots">
              {whoTheyAre(inv).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
          <section className="qa-sec">
            <h3 className="qa-sec__h">Since last time</h3>
            {touches.length ? (
              <ul className="qa-dots">
                {touches.map((t, k) => (
                  <li key={k}>{t.text}</li>
                ))}
              </ul>
            ) : (
              <p className="qa-sec__empty">Nothing logged with them yet.</p>
            )}
          </section>
          <section className="qa-sec">
            <h3 className="qa-sec__h">Open next step</h3>
            <ul className="qa-dots qa-dots--open">
              <li>{step ? `${step.replace(/[.\s]+$/, '')}.${inv.nextDate ? ` ${inv.nextDate < today ? 'Was due' : 'Due'} ${formatDay(inv.nextDate)}.` : ''}` : 'No next step set. Agree one before you hang up.'}</li>
              {open.map((q) => (
                <li key={q._id}>{q.text} No answer saved yet.</li>
              ))}
            </ul>
          </section>
          <section className="qa-sec">
            <h3 className="qa-sec__h">Answers to have ready</h3>
            {picks.length ? (
              <ul className="qa-ready">
                {picks.map(({ q, why }) => {
                  const fresh = needsAnswer(q)
                  const isOpen = reading.has(q._id)
                  return (
                    <li key={q._id} className={`qa-ready__row${fresh ? ' qa-ready__row--new' : ''}`}>
                      <div className="qa-ready__top">
                        <div>
                          <p className="qa-ready__q">{q.text}</p>
                          <p className="qa-ready__meta">
                            {fresh
                              ? now < m.start
                                ? `New · write it before ${timeOf(m.start)}`
                                : 'New · no answer saved yet'
                              : [`Asked ${q.askedCount}×`, q.slideRef?.split(' · ')[0], why === 'similar' ? 'by investors like them' : why === 'they' ? 'by them' : ''].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        {fresh ? (
                          <button type="button" className="qa-textbtn" onClick={() => openPanel({ kind: 'answer', id: q._id })}>
                            Write
                          </button>
                        ) : (
                          <button type="button" className="qa-textbtn" aria-expanded={isOpen} onClick={() => setReading((s) => (s.has(q._id) ? new Set([...s].filter((x) => x !== q._id)) : new Set(s).add(q._id)))}>
                            {isOpen ? 'Hide' : 'Read'}
                          </button>
                        )}
                      </div>
                      {isOpen ? <p className="qa-ready__answer m-rise">{q.bestAnswer}</p> : null}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="qa-sec__empty">No questions in the bank yet. Paste your meeting notes in the investor’s Notes tab and pick the questions.</p>
            )}
          </section>
          {inv.expected ? (
            <div className="qa-ask">
              <p className="eyebrow-mono qa-ask__eyebrow">What to ask for</p>
              <p className="qa-ask__text">
                A {money(inv.expected)} commitment{inv.lead ? ', and whether they’ll lead' : ''}.
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  )
}
