// PST-294: Investors › Introducers (investors-introducers.png). One row per
// person who introduces Dev (committed investors included), with asked, made,
// meetings, money in and what's next; a panel for one of them with each intro's
// six steps. Opening it migrates the old free-text warm paths into people.
import { useEffect, useId, useMemo, useState } from 'react'
import { todayIST } from '../../lib/dates'
import { firstName, initials, introLine, introNext, lastDone, personRows, personSub, RELATION_LABEL, type Intro, type PersonRow } from '../../lib/introducers'
import { money } from '../../lib/money'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { openDraft } from '../drafts/data'
import { usePreviewState } from '../preview-state'
import { openOnKey, useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { Button, Card, Chip } from '../ui'
import { useIntroducers, useIntroInvestors, useMigrate } from './data'
import { AskDialog, IntroducerDialog } from './Dialogs'
import { StepBar } from './Steps'

function useMedia(q: string) {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const fn = () => setOn(mq.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [q])
  return on
}

export function IntroducersView({ person, onPerson, adding, onAdding }: { person?: string; onPerson: (key: string | undefined) => void; adding: boolean; onAdding: (on: boolean) => void }) {
  const x = useIntroducers()
  const investors = useIntroInvestors()
  const ui = useUI()
  const phone = useMedia('(max-width: 720px)')
  const preview = usePreviewState()
  useMigrate()
  const today = todayIST()
  const rows = useMemo(() => personRows({ introducers: x.introducers, intros: x.intros, investors: investors }, today), [x.introducers, x.intros, investors, today])
  const [showAll, setShowAll] = useState(false)
  const active = rows.filter((r) => r.intros.length)
  const quiet = rows.filter((r) => !r.intros.length)
  const shown = showAll || !active.length ? rows : active

  // &introducer=panel|ask: Ankur's panel (Ask for another intro open), on phones too.
  const previewKey = preview?.introducer === 'panel' || preview?.introducer === 'ask' ? rows.find((r) => r.name.startsWith('Ankur'))?.key : undefined
  const sel = rows.find((r) => r.key === (person ?? previewKey)) ?? (phone ? undefined : rows[0])

  if (!x.loaded) return <Card className="intro-list" aria-busy="true" />
  const panel = sel ? <PersonPanel row={sel} today={today} onOpen={(id) => ui.open(id)} /> : null

  return (
    <div className="intro-view">
      <Card className="intro-list" aria-labelledby="intro-list-title">
        <h2 id="intro-list-title" className="intro-list__h">People who introduce you</h2>
        <p className="intro-list__lede">A portfolio founder’s intro beats every other kind. Thank them the same day, and always report back.</p>
        {rows.length ? (
          <div className="intro-table" role="table" aria-label="Introducers">
            <div className="intro-row intro-row--head" role="row">
              <span role="columnheader">Person</span>
              <span role="columnheader" className="intro-row__n">Asked</span>
              <span role="columnheader" className="intro-row__n">Made</span>
              <span role="columnheader" className="intro-row__n">Meetings</span>
              <span role="columnheader" className="intro-row__n" title="Committed by the investors they introduced">In</span>
              <span role="columnheader">Next</span>
            </div>
            {shown.map((r) => (
              <div
                key={r.key}
                role="row"
                tabIndex={0}
                data-nav-id={r.key}
                className={'intro-row' + (sel?.key === r.key ? ' is-selected' : '')}
                aria-selected={sel?.key === r.key}
                onClick={() => onPerson(r.key)}
                onKeyDown={openOnKey(() => onPerson(r.key))}
              >
                <span role="cell" className="intro-row__who">
                  <span className={'enrich-avatar' + (sel?.key === r.key || r.relation === 'portfolio' ? ' enrich-avatar--main' : '')} aria-hidden="true">
                    {initials(r.name)}
                  </span>
                  <span className="intro-row__text">
                    <strong>{r.name}</strong>
                    <small>{personSub(r)}</small>
                  </span>
                </span>
                <span role="cell" className="intro-row__n num" aria-label={r.stats.asked + ' asked'}>{r.stats.asked}</span>
                <span role="cell" className="intro-row__n num" aria-label={r.stats.made + ' made'}>{r.stats.made}</span>
                <span role="cell" className="intro-row__n num" aria-label={r.stats.meetings + ' meetings'}>{r.stats.meetings}</span>
                <span role="cell" className={'intro-row__n num' + (r.stats.committed ? ' is-money' : '')}>{r.stats.committed ? money(r.stats.committed) : '—'}</span>
                <span role="cell" className={'intro-row__next is-' + r.next.tone}>{r.next.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="intro-list__empty">No introducers yet. Add the people who can introduce you, or give an investor a warm path.</p>
        )}
        {quiet.length && active.length ? (
          <button type="button" className="intro-list__more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? 'Show only the ones you’ve asked' : quiet.length + ' more · people you haven’t asked yet'}
          </button>
        ) : null}
      </Card>
      {phone ? (
        sel && (person || previewKey) ? (
          <Modal onClose={() => onPerson(undefined)} label={sel.name} className="intro-sheet">
            {panel}
          </Modal>
        ) : null
      ) : (
        panel
      )}
      {adding ? <IntroducerDialog onClose={() => onAdding(false)} onSaved={(id) => onPerson(id)} /> : null}
    </div>
  )
}

function PersonPanel({ row, today, onOpen }: { row: PersonRow; today: string; onOpen: (investorId: string) => void }) {
  const x = useIntroducers()
  const investors = useIntroInvestors()
  const { fail } = useUI()
  const uid = useId()
  const titleId = useTitleId()
  const who = firstName(row.name)
  const byId = new Map(investors.map((i) => [i._id, i]))
  const previewAsk = usePreviewState()?.introducer === 'ask'
  const [asking, setAsking] = useState(previewAsk)
  const [editing, setEditing] = useState(false)
  const intros = [...row.intros].sort((a, b) => rank(a, byId.get(a.investorId), today) - rank(b, byId.get(b.investorId), today) || lastDone(b.steps) - lastDone(a.steps))

  const act = (intro: Intro) => {
    const inv = byId.get(intro.investorId)
    const next = introNext(intro, inv, who, today)
    const tick = (step: 'thanked' | 'reported') => () => {
      play('card-pickup', { rate: 1.2, volume: 0.6 })
      x.setStep(intro._id, step, today).catch(fail)
    }
    if (next.kind === 'thank') return { label: next.text, onClick: tick('thanked'), title: 'Tick Thanked' }
    if (next.kind === 'report') return { label: next.text, onClick: tick('reported'), title: 'Tick Reported' }
    if (next.kind === 'nudge')
      return {
        label: next.text,
        title: 'You nudged ' + who + ': the 3 days start again',
        onClick: () => {
          play('nudge')
          x.nudged(intro._id).catch(fail)
        },
      }
    if (next.kind === 'send' || next.kind === 'ask') return { label: next.kind === 'ask' ? 'Draft the ask' : next.text, onClick: () => openDraft({ investorId: intro.investorId, type: 'forwardable', introId: intro._id }) }
    return { label: next.text }
  }

  return (
    <Card as="section" className="intro-panel" aria-labelledby={titleId}>
      <header className="intro-panel__head">
        <span className="enrich-avatar enrich-avatar--main intro-panel__avatar" aria-hidden="true">
          {initials(row.name)}
        </span>
        <div className="intro-panel__id">
          <h2 id={titleId} className="intro-panel__name">{row.name}</h2>
          <p className="intro-panel__sub">{[row.notes, row.email].filter(Boolean).join(' · ') || RELATION_LABEL[row.relation]}</p>
        </div>
      </header>
      <Chip tone="selected" dot={false} className="intro-panel__rel">
        {RELATION_LABEL[row.relation]}
      </Chip>
      <h3 className="intro-panel__how eyebrow-mono" id={uid + '-how'}>How an intro goes</h3>
      <p className="intro-panel__howtext">
        Ask {who} → {who} says yes → send a forwardable email → intro made → thank {who} → report back. Never cc an investor cold.
      </p>
      {intros.length ? (
        <ul className="intro-panel__list">
          {intros.map((intro) => {
            const inv = byId.get(intro.investorId)
            if (!inv) return null
            const next = introNext(intro, inv, who, today)
            const a = act(intro)
            return (
              <li key={intro._id} className="intro-panel__intro">
                <div className="intro-panel__top">
                  <button type="button" className="intro-panel__inv" onClick={() => onOpen(inv._id)}>
                    {inv.name}
                  </button>
                  {a.onClick ? (
                    <button type="button" className={'intro-panel__act is-' + next.tone} onClick={a.onClick} title={a.title}>
                      {a.label}
                    </button>
                  ) : (
                    <span className="intro-panel__act is-plain">{a.label}</span>
                  )}
                </div>
                <StepBar intro={intro} label={'Intro to ' + inv.name + ': steps'} />
                <p className="intro-panel__line">{introLine(intro, inv, who, today)}</p>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="intro-panel__empty">No intros from {who} yet.</p>
      )}
      <footer className="intro-panel__foot">
        <Button variant="primary" icon="spark" onClick={() => setAsking(true)}>
          {row.intros.length ? 'Ask for another intro' : 'Ask for an intro'}
        </Button>
        {row.introducerId ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit details
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => row.investorId && onOpen(row.investorId)}>
            Open investor
          </Button>
        )}
      </footer>
      {asking ? <AskDialog person={row} onClose={() => setAsking(false)} /> : null}
      {editing ? <IntroducerDialog edit={row} onClose={() => setEditing(false)} /> : null}
    </Card>
  )
}

/** The panel's order: something to do first, then intros under way, then done. */
function rank(x: Intro, inv: Investor | undefined, today: string) {
  const k = introNext(x, inv, '', today).kind
  return k === 'thank' || k === 'report' ? 0 : k === 'nudge' || k === 'send' ? 1 : k === 'done' ? 3 : 2
}
