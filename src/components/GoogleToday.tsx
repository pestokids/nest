// Raise · Today with Calendar and Gmail (PST-263, screens/raise-today/calendar-gmail-connected.png):
// Meetings today (and tomorrow, and the morning-after "How did it go?"),
// Waiting on you, and Who's this?. Shown once anyone on the team has connected Google.
import { useMemo, useState } from 'react'
import { addDays } from '../lib/today'
import { classifyMove, moveSounds, moveToast } from '../lib/board'
import {
  agoShort, calendarWeekLink, dayOf, domainOf, followUps, GENERIC_DOMAINS, meetingsOn, nameFromEmail, normEmail, timeOf, waitingOnYou, whoIsThis,
  type MeetingAnswer, type Stranger, type SyncedMeeting, type SyncedThread,
} from '../lib/google'
import { fieldsOf, type Investor } from '../lib/pipeline'
import { play } from '../lib/sound'
import { IDX, STAGE_TILE, STAGES, type Stage } from '../lib/stages'
import { dayLabel } from '../lib/investorView'
import { useRaise } from './data'
import { WhoLookups } from './enrich/WhoLookups'
import { openOnKey, useUI } from './raise-ui'
import { useSaveAction } from './system/useSaveAction'
import { Badge, Button, Card, Icon } from './ui'

const first = (name: string) => name.trim().split(/\s+/)[0] || name
const ANSWER_LABEL: Record<MeetingAnswer, string> = { m1: 'Move to 1st meeting', m2: '2nd meeting', passed: 'Passed' }

export function GoogleToday({ today }: { today: string }) {
  const { google, investors, ai } = useRaise()
  const now = Date.now()
  const strangers = useMemo(() => whoIsThis(google.meetings.filter((m) => m.mine), investors, now), [google.meetings, investors, now])
  if (!google.team.length) return null
  return (
    <div className={`today__google${strangers.length && !ai.connected ? '' : ' today__google--two'}`}>
      <Meetings today={today} now={now} />
      <Waiting now={now} />
      {strangers.length ? ai.connected ? <WhoLookups people={strangers} /> : <WhoIsThis people={strangers} /> : null}
    </div>
  )
}

/* ---------- Meetings today ---------- */

function Meetings({ today, now }: { today: string; now: number }) {
  const d = useRaise()
  const ui = useUI()
  const save = useSaveAction()
  const byId = useMemo(() => new Map(d.investors.map((i) => [i._id, i])), [d.investors])
  const asks = followUps(d.google.meetings, d.investors, today, now)
  const todays = meetingsOn(d.google.meetings, today)
  const tomorrows = meetingsOn(d.google.meetings, addDays(today, 1))
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set())

  async function answer(m: SyncedMeeting, i: Investor, a: MeetingAnswer) {
    const to: Stage = a
    setDone((s) => new Set(s).add(m.eventId))
    await save(
      async () => {
        const rec = i.stage === to ? null : await d.move(i._id, to)
        await d.googleDo.answer(m.eventId, a)
        return rec
      },
      {
        failMessage: `Couldn’t move ${i.name}.`,
        onError: () => {
          setDone((s) => new Set([...s].filter((x) => x !== m.eventId)))
          return false
        },
        onDone: (rec) => {
          if (!rec) return
          const how = classifyMove(i.stage, to)
          for (const c of moveSounds(how)) play(c.name, c.opts)
          const msg = moveToast(i.name, to, how)
          if (msg) ui.toast({ message: msg, action: { label: 'Undo', onClick: () => void d.undoMove(rec).catch(ui.fail) } })
        },
      },
    )
  }

  const row = (m: SyncedMeeting) => {
    const invs = m.investorIds.map((id) => byId.get(id)).filter((x): x is Investor => !!x)
    if (invs.length) {
      const i = invs[0]
      const ix = IDX[i.stage]
      const next = ix !== undefined && ix >= IDX.booked! && ix < IDX.m2! ? STAGES[ix + 1] : null
      const sub = next ? `${STAGE_TILE[i.stage]} → ${STAGE_TILE[next.k]} after this call` : `${STAGE_TILE[i.stage]} · ${m.title}`
      return (
        <li key={m._id} className={`gmeet${m.end <= now ? ' gmeet--past' : ''}`}>
          <div className="gmeet__main" role="button" tabIndex={0} onClick={() => ui.open(i._id)} onKeyDown={openOnKey(() => ui.open(i._id))} aria-label={`${timeOf(m.start)}, ${invs.map((x) => x.name).join(' and ')}. Open`}>
            <span className="gmeet__time">{timeOf(m.start)}</span>
            <span className="gmeet__name">{invs.map((x) => x.name).join(' · ')}</span>
            <span className="gmeet__sub">{sub}</span>
          </div>
        </li>
      )
    }
    const p = m.people[0]
    const who = p ? [p.name || nameFromEmail(p.email), GENERIC_DOMAINS.has(domainOf(p.email)) ? '' : domainOf(p.email)].filter(Boolean).join(' · ') : m.title
    const inner = (
      <>
        <span className="gmeet__time">{timeOf(m.start)}</span>
        <span className="gmeet__name">{who}</span>
        <span className="gmeet__sub gmeet__sub--new">{m.title} · not in Raise yet</span>
      </>
    )
    return (
      <li key={m._id} className="gmeet gmeet--new">
        {m.link ? (
          <a className="gmeet__main" href={m.link} target="_blank" rel="noreferrer">
            {inner}
          </a>
        ) : (
          <div className="gmeet__main">{inner}</div>
        )}
      </li>
    )
  }

  const pending = asks.filter((a) => !done.has(a.meeting.eventId))
  const empty = !pending.length && !todays.length && !tomorrows.length
  return (
    <Card riseIndex={6} className="gcard" aria-labelledby="gmeet-title">
      <header className="gcard__head">
        <h2 id="gmeet-title" className="today__h2 gcard__title">
          <Icon name="calendar" size={20} />
          Meetings today
        </h2>
        <span className="gcard__from eyebrow-mono">From Calendar</span>
      </header>
      {pending.map(({ meeting: m, investor: i, options }) => (
        <div key={m._id} className="gask" role="group" aria-label={`How did it go with ${i.name}?`}>
          <p className="gask__q">How did it go with {first(i.name)}?</p>
          <p className="gask__sub">
            {m.title} · yesterday {timeOf(m.start)}
          </p>
          <div className="gask__actions">
            {options.map((a, k) =>
              a === 'passed' ? (
                <button key={a} type="button" className="gask__text" onClick={() => void answer(m, i, a)}>
                  {ANSWER_LABEL[a]}
                </button>
              ) : (
                <Button key={a} size="sm" variant={k === 0 ? 'primary' : 'secondary'} onClick={() => void answer(m, i, a)}>
                  {k === 0 ? ANSWER_LABEL[a] : ANSWER_LABEL[a].replace(/^Move to /, '')}
                </Button>
              ),
            )}
          </div>
        </div>
      ))}
      {todays.length ? <ul className="gmeet__list">{todays.map(row)}</ul> : null}
      {tomorrows.length ? (
        <>
          <p className="gcard__day eyebrow-mono">Tomorrow</p>
          <ul className="gmeet__list">{tomorrows.map(row)}</ul>
        </>
      ) : null}
      {empty ? <p className="gcard__empty">No investor meetings today or tomorrow.</p> : null}
      <a className="gcard__link" href={calendarWeekLink(d.google.me?.email)} target="_blank" rel="noreferrer">
        Open the week <Icon name="arrow-right" size={16} />
      </a>
    </Card>
  )
}

/* ---------- Waiting on you ---------- */

const MAX_ROWS = 3

function Waiting({ now }: { now: number }) {
  const { google, investors } = useRaise()
  const byId = new Map(investors.map((i) => [i._id, i]))
  const rows = waitingOnYou(google.threads, now)
  const shown = rows.slice(0, MAX_ROWS)
  const who = (t: SyncedThread) => {
    const i = byId.get(t.investorIds[0])
    const person = t.lastFromEmail === normEmail(i?.email) && i ? '' : nameFromEmail(t.lastFromEmail)
    return [person, i?.name].filter(Boolean).join(' · ') || t.lastFromEmail
  }
  const top = shown.find((t) => t.mine)
  return (
    <Card riseIndex={7} className="gcard" aria-labelledby="gwait-title">
      <header className="gcard__head">
        <h2 id="gwait-title" className="today__h2 gcard__title">
          <Icon name="mail" size={20} />
          Waiting on you
          {rows.length ? (
            <Badge className="list-panel__badge" aria-label={`${rows.length} waiting`}>
              {rows.length}
            </Badge>
          ) : null}
        </h2>
        <span className="gcard__from eyebrow-mono">From Gmail</span>
      </header>
      {shown.length ? (
        <ul className="gwait__list">
          {shown.map((t, k) => {
            const inner = (
              <>
                <span className="gwait__top">
                  <span className="gwait__name">{who(t)}</span>
                  <span className="gwait__when">{agoShort(t.lastAt, now)}</span>
                </span>
                <span className="gwait__sub">
                  {t.subject}
                  {t.mine ? '' : ` · in ${t.by}’s inbox`}
                </span>
              </>
            )
            return (
              <li key={t._id} className={`gwait${k === 0 ? ' gwait--first' : ''}`}>
                {t.mine ? (
                  <a className="gwait__main" href={t.link} target="_blank" rel="noreferrer" aria-label={`${who(t)}: ${t.subject}. Open in Gmail`}>
                    {inner}
                  </a>
                ) : (
                  <div className="gwait__main">{inner}</div>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="gcard__empty">Nothing waiting on you. Every investor who wrote has an answer.</p>
      )}
      {rows.length > MAX_ROWS ? <p className="gcard__more">{rows.length - MAX_ROWS} more in the drawer’s Emails tab.</p> : null}
      {top ? (
        <a className="gcard__link" href={top.link} target="_blank" rel="noreferrer">
          Reply in Gmail <Icon name="arrow-right" size={16} />
        </a>
      ) : null}
    </Card>
  )
}

/* ---------- Who's this? ---------- */

function WhoIsThis({ people }: { people: Stranger[] }) {
  const d = useRaise()
  const ui = useUI()
  const save = useSaveAction()
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const left = people.filter((p) => !gone.has(p.email))
  const p = left[0]
  const options = useMemo(() => [...d.investors].sort((a, b) => a.name.localeCompare(b.name)), [d.investors])
  if (!p) return null
  const hide = (email: string, on: boolean) => setGone((s) => (on ? new Set(s).add(email) : new Set([...s].filter((x) => x !== email))))

  const link = (id: string) => {
    const i = d.investors.find((x) => x._id === id)
    if (!i) return
    hide(p.email, true)
    void save(() => d.save(i._id, { ...fieldsOf(i), emails: [...(i.emails ?? []), p.email] }), {
      failMessage: `Couldn’t link ${p.name}.`,
      onError: () => (hide(p.email, false), false),
      onDone: () => ui.toast({ tone: 'info', icon: 'check', message: `${p.name} is now part of ${i.name}. Their meetings and emails count from here.` }),
    })
  }
  const dismiss = () => {
    hide(p.email, true)
    void save(() => d.googleDo.dismiss(p.email), { failMessage: 'Couldn’t save that.', onError: () => (hide(p.email, false), false) })
  }
  const now = Date.now()
  const today = dayOf(now)
  const day = dayOf(p.meeting.start)
  return (
    <Card riseIndex={8} tone="peach" className="gcard gwho" aria-labelledby="gwho-title">
      <header className="gcard__head">
        <h2 id="gwho-title" className="today__h2 gcard__title">
          <Icon name="user" size={20} />
          Who’s this?
          {left.length > 1 ? (
            <Badge className="list-panel__badge" aria-label={`${left.length} people`}>
              {left.length}
            </Badge>
          ) : null}
        </h2>
      </header>
      <p className="gwho__lede">Someone from a recent meeting who isn’t in Raise yet.</p>
      <div className="gwho__box">
        <p className="gwho__name">
          {p.name} · <span className="gwho__email">{p.email}</span>
        </p>
        <p className="gwho__meet">
          “{p.meeting.title}” · {day === today ? 'today' : dayLabel(day, today)}, {timeOf(p.meeting.start)}
        </p>
      </div>
      <div className="gwho__actions">
        <Button variant="primary" onClick={() => ui.open(null, { name: p.name, email: p.email })}>
          Add as investor
        </Button>
        <button type="button" className="gask__text" onClick={dismiss}>
          Not about the round
        </button>
      </div>
      <label className="gwho__link">
        <span>Already in Raise?</span>
        <select value="" onChange={(e) => e.target.value && link(e.target.value)} aria-label={`Link ${p.name} to an investor`}>
          <option value="">Link to an investor…</option>
          {options.map((i) => (
            <option key={i._id} value={i._id}>
              {i.name}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" size={16} />
      </label>
    </Card>
  )
}
