// PST-294: the drawer's warm path (drawer-decision-lead-warm-path.png): the
// person, their relation, and the intro's six steps, each tickable. Loading a
// drawer whose investor still has only a free-text warm path migrates it.
// PST-305: an investor who is someone in the Network too (an advisor who
// invests) says so at the top, with a link back to their Network entry.
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { todayIST } from '../../lib/dates'
import { allPeople, firstName, initials, introNext, lastDone, parsePath, personKey, personSub, RELATION_LABEL, type Person } from '../../lib/introducers'
import type { Investor } from '../../lib/pipeline'
import { alsoLine } from '../../lib/network' // PST-305
import { play } from '../../lib/sound'
import { openDraft } from '../drafts/data'
import { usePreviewState } from '../preview-state'
import { useUI } from '../raise-ui'
import { Button, Card, Chip, Select } from '../ui'
import { useIntroducers, useIntroInvestors, useMigrate } from './data'
import { IntroducerDialog } from './Dialogs'
import { StepList } from './Steps'

const NEW = '+new'

export function WarmPath({ inv }: { inv: Investor }) {
  const x = useIntroducers()
  const investors = useIntroInvestors()
  const { fail } = useUI()
  useMigrate(inv)
  const box = useRef<HTMLElement>(null)
  const warmPreview = usePreviewState()?.warmPath
  useEffect(() => {
    if (warmPreview && x.loaded) requestAnimationFrame(() => box.current?.scrollIntoView({ block: 'start' }))
  }, [warmPreview, x.loaded])
  const [adding, setAdding] = useState(false)
  const [pick, setPick] = useState('')
  if (!x.loaded) return null

  const people = allPeople(x.introducers, investors).filter((p) => p.investorId !== inv._id)
  const byKey = new Map(people.map((p) => [p.key, p]))
  const decided = investors.find((i) => i._id === inv._id) ?? inv
  const today = todayIST()
  const intros = x.intros
    .filter((i) => i.investorId === inv._id && byKey.has(personKey(i)))
    .sort((a, b) => lastDone(b.steps) - lastDone(a.steps) || (a.createdAt ?? 0) - (b.createdAt ?? 0))
  const linked = new Set(intros.map(personKey))
  const free = people.filter((p) => !linked.has(p.key))

  async function link(p: Person) {
    try {
      await x.link(inv._id, p)
      play('save')
      setPick('')
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Card as="section" className="wpath" ref={box} aria-labelledby={'wpath-' + inv._id}>
      <h3 id={'wpath-' + inv._id} className="wpath__h eyebrow-mono">
        Warm path
      </h3>
      {intros.map((intro) => {
        const p = byKey.get(personKey(intro))!
        const who = firstName(p.name)
        const next = introNext(intro, decided, who, today)
        return (
          <div key={intro._id} className="wpath__intro">
            <div className="wpath__who">
              <span className={'enrich-avatar' + (p.relation === 'founder' ? ' enrich-avatar--main' : '')} aria-hidden="true">
                {initials(p.name)}
              </span>
              <span className="wpath__text">
                <span className="wpath__name">{p.name}</span>
                <span className="wpath__sub">{personSub(p)}</span>
              </span>
              {p.relation === 'founder' ? (
                <Chip tone="selected" dot={false} className="wpath__best">
                  Best kind of intro
                </Chip>
              ) : p.relation === 'committed' ? (
                <Chip tone="outline" dot={false} className="wpath__best">
                  {RELATION_LABEL.committed}
                </Chip>
              ) : null}
            </div>
            <StepList intro={intro} who={who} investor={decided} />
            {next.kind === 'ask' || next.kind === 'send' ? (
              <Button size="sm" variant="secondary" icon="spark" className="wpath__act" onClick={() => openDraft({ investorId: inv._id, type: 'forwardable', introId: intro._id })}>
                {next.kind === 'ask' ? 'Draft the ask to ' + who : 'Draft the forwardable'}
              </Button>
            ) : next.kind === 'nudge' ? (
              <Button
                size="sm"
                variant="secondary"
                className="wpath__act"
                onClick={() => {
                  play('log')
                  x.nudged(intro._id).catch(fail)
                }}
              >
                I nudged {who}
              </Button>
            ) : null}
          </div>
        )
      })}
      {!intros.length ? <p className="wpath__none">No warm path yet{inv.path.trim() && !parsePath(inv.path).length ? ' (“' + inv.path.trim() + '”)' : ''}. Who could introduce you?</p> : null}
      <div className="wpath__add">
        <Select
          aria-label={intros.length ? 'Add another warm path' : 'Who makes the intro'}
          value={pick}
          onChange={(e) => {
            const v = e.target.value
            if (v === NEW) return setAdding(true)
            setPick(v)
            const p = byKey.get(v)
            if (p) void link(p)
          }}
        >
          <option value="">{intros.length ? 'Add another warm path…' : 'Who makes the intro?'}</option>
          {free.map((p) => (
            <option key={p.key} value={p.key}>
              {p.name} · {RELATION_LABEL[p.relation].toLowerCase()}
            </option>
          ))}
          <option value={NEW}>Someone new…</option>
        </Select>
      </div>
      {adding ? (
        <IntroducerDialog
          onClose={() => setAdding(false)}
          onSaved={(id) => void link({ key: id, name: '', relation: 'other', notes: '', introducerId: id })}
        />
      ) : null}
    </Card>
  )
}

/** PST-305: the drawer's line for an investor who is someone in the Network too ("Also your advisor · Neha Rao"), linking back to them. */
export function AlsoInNetwork({ inv }: { inv: Pick<Investor, '_id'> }) {
  const x = useIntroducers()
  const p = x.introducers.find((y) => y.investorId === inv._id)
  if (!p) return null
  return (
    <p className="wpath__also">
      <Link to="/raise/investors" search={{ view: 'network', person: p._id }}>
        {alsoLine(p)}
      </Link>
    </p>
  )
}
