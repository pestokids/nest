// PST-274: Who's this? with lookups (today-whos-this-looked-up.png). Outside people
// from recent meetings, each looked up by Claude: who they are and their firm, then
// Add as investor, Add to an investor already in the list, or Not an investor.
// Shown when AI is set up; otherwise GoogleToday keeps the one-at-a-time card.
// PST-292: someone Jev's pre-check said probably isn't an investor wasn't looked up:
// "Probably not an investor", with Look up anyway.
import { useEffect, useMemo, useRef, useState } from 'react'
import { firmDomain, initials, sourceHost, whoLine, type Fact, type Sender } from '../../lib/enrich'
import { dayOf, normDomain, timeOf, type Stranger } from '../../lib/google'
import { dayLabel } from '../../lib/investorView'
import { pop, shine } from '../../lib/motion'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Button, Card } from '../ui'

const first = (name: string) => name.trim().split(/\s+/)[0] || name
const norm = (s: string | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The investor already in the list that this person's firm is, by name or domain. */
function existingFirm(facts: Fact[], investors: Investor[]): Investor | undefined {
  const name = norm(facts.find((f) => f.group === 'fund' && f.field === 'name')?.value)
  const domain = normDomain(facts.find((f) => f.group === 'fund' && f.field === 'domain')?.value ?? '')
  return investors.find((i) => (name && (norm(i.name) === name || norm(i.firm) === name)) || (domain && firmDomain(i) === domain))
}

export function WhoLookups({ people }: { people: Stranger[] }) {
  const d = useRaise()
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const senders = useMemo(() => new Map(d.ai.senders.map((s) => [s.email, s])), [d.ai.senders])
  const prechecked = useMemo(() => new Map(d.ai.prechecked.map((x) => [x.email, x.likely])), [d.ai.prechecked])
  const left = people.filter((p) => !gone.has(p.email))
  if (!left.length) return null
  const hide = (email: string, on: boolean) => setGone((s) => (on ? new Set(s).add(email) : new Set([...s].filter((x) => x !== email))))
  return (
    <Card riseIndex={8} className="gcard gwho-list" aria-labelledby="gwho-title">
      <header className="gwho-list__head">
        <h2 id="gwho-title" className="today__h2 gcard__title">
          Who’s this?
        </h2>
        <span className="chip chip--neutral">{left.length} new</span>
      </header>
      <p className="gwho__lede">{left.some((p) => prechecked.has(p.email) && !senders.has(p.email)) ? 'New people from your calendar. Nest looked up the likely investors.' : 'New people from your calendar. Nest looked each one up.'}</p>
      <ul className="gwho-list__rows">
        {left.map((p) => (
          <WhoRow key={p.email} p={p} sender={senders.get(p.email)} prechecked={prechecked.has(p.email)} onHide={(on) => hide(p.email, on)} />
        ))}
      </ul>
    </Card>
  )
}

function WhoRow({ p, sender, prechecked, onHide }: { p: Stranger; sender?: Sender; prechecked: boolean; onHide: (on: boolean) => void }) {
  const d = useRaise()
  const ui = useUI()
  const avatar = useRef<HTMLSpanElement>(null)
  const chip = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<'add' | 'lookup' | null>(null)
  const [leaving, setLeaving] = useState(false)
  const run = sender?.run
  const looking = !run || run.status === 'queued' || run.status === 'running'
  const facts = (sender?.facts ?? []).filter((f) => f.status !== 'dismissed')
  const name = facts.find((f) => f.group === 'person' && f.field === 'name')?.value || p.name
  const verdict = looking ? null : run.verdict ?? 'unknown'
  const firm = verdict === 'investor' ? existingFirm(facts, d.investors) : undefined
  const title = facts.find((f) => f.group === 'person' && f.field === 'title')?.value

  // Found: the avatar pops and the chip shines, once, when the answer lands.
  const [wasLooking, setWasLooking] = useState(looking)
  const [found, setFound] = useState(false)
  if (wasLooking !== looking) {
    setWasLooking(looking)
    setFound(wasLooking && !looking)
  }
  useEffect(() => {
    if (!found) return
    pop(avatar.current)
    shine(chip.current)
  }, [found])

  const day = dayOf(p.meeting.start)
  const today = dayOf(Date.now())
  const meta = 'On the invite “' + p.meeting.title + '” · ' + (day === today ? 'today, ' + timeOf(p.meeting.start) : dayLabel(day, today))
  const line = !run
    ? prechecked
      ? 'Probably not an investor'
      : 'Not looked up yet.'
    : looking
      ? 'Looking up…'
      : verdict === 'investor'
        ? firm
          ? (title ? title + ' at ' : '') + firm.name + ', which is already in your list (Wave ' + firm.wave + ')'
          : whoLine(facts) || run.summary || 'An investor.'
        : run.summary || 'Couldn’t tell who this is.'

  async function add() {
    setBusy('add')
    try {
      const id = await d.aiDo.addSender(p.email, firm?._id)
      if (firm) ui.toast({ tone: 'info', icon: 'check', message: first(name) + ' is part of ' + firm.name + ' now. Their meetings count from here.', action: { label: 'Open', onClick: () => ui.open(firm._id) } })
      else {
        play('egg-crack')
        play('pesto-chirp', { delay: 0.45 })
        ui.toast({ tone: 'hatch', message: first(name) + ' is in the nest', action: facts.length ? { label: 'Review ' + facts.length + ' facts', onClick: () => ui.open(id) } : { label: 'Open', onClick: () => ui.open(id) } })
      }
    } catch (e) {
      ui.fail(e)
      setBusy(null)
    }
  }
  async function lookup() {
    setBusy('lookup')
    try {
      await d.aiDo.lookup(p.email)
    } catch (e) {
      ui.fail(e)
    } finally {
      setBusy(null)
    }
  }
  async function notInvestor() {
    play('not-on-list')
    setLeaving(true)
    await new Promise((r) => setTimeout(r, 200))
    onHide(true)
    try {
      await d.googleDo.dismiss(p.email)
    } catch (e) {
      onHide(false)
      setLeaving(false)
      ui.fail(e)
    }
  }

  return (
    <li className={'gwho-row' + (looking && run ? ' is-looking' : '') + (leaving ? ' is-leaving' : '')}>
      <span ref={avatar} className={'enrich-avatar' + (verdict === 'investor' ? ' enrich-avatar--main' : '')} aria-hidden="true">
        {initials(run && !looking ? name : p.email)}
      </span>
      <div className="gwho-row__body">
        <p className="gwho-row__name">
          {run && !looking ? <strong>{name}</strong> : <strong>{p.email}</strong>}
          {run && !looking ? <span className="gwho-row__email">{p.email}</span> : null}
        </p>
        <p className={'gwho-row__line' + (looking && run ? ' is-looking' : '')}>{line}</p>
        <p className="gwho-row__meta">{meta}</p>
        {open && facts.length ? (
          <ul className="gwho-row__facts">
            {facts.map((f) => (
              <li key={f._id}>
                <span>{f.value}</span>
                {f.source ? (
                  <a href={f.source} target="_blank" rel="noreferrer">
                    {sourceHost(f.source)} ↗
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <span ref={chip} className="gwho-row__chip">
        {!run ? (
          prechecked ? (
            <span className="chip chip--outline">Probably not</span>
          ) : null
        ) : looking ? (
          <span className="chip chip--waiting">
            <span className="chip__dot" aria-hidden="true" />
            Looking up
          </span>
        ) : verdict === 'investor' ? (
          <span className="chip chip--live">
            <span className="chip__dot" aria-hidden="true" />
            Investor
          </span>
        ) : (
          <span className="chip chip--outline">{verdict === 'not_investor' ? 'Probably not' : 'Not sure'}</span>
        )}
      </span>
      <div className="gwho-row__actions">
        {!run ? (
          <Button variant="secondary" icon="spark" loading={busy === 'lookup'} loadingLabel="Starting…" onClick={lookup}>
            {prechecked ? 'Look up anyway' : 'Look up'}
          </Button>
        ) : looking ? null : verdict === 'investor' ? (
          <Button variant="primary" loading={busy === 'add'} loadingLabel="Adding…" onClick={add}>
            {firm ? 'Add to ' + firm.name : 'Add as investor'}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => ui.open(null, { name, email: p.email })}>
            Add by hand
          </Button>
        )}
        {!looking || !run ? (
          <div className="gwho-row__links">
            {verdict === 'investor' && !firm && facts.length ? (
              <button type="button" className="enrich-link" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
                {open ? 'Hide facts' : 'Review ' + facts.length + ' facts'}
              </button>
            ) : null}
            <button type="button" className="gask__text" onClick={() => void notInvestor()}>
              Not an investor
            </button>
          </div>
        ) : null}
      </div>
      {looking && run ? <span className="sr-only">Looking up {p.email}</span> : null}
    </li>
  )
}
