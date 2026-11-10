// PST-296: Find more like these (screens/round5/investors-find-more.png). The
// panel shows what a run starts from (the companies one step ahead of Pesto, as
// editable chips, and the top Priority investors) and what it should cost before
// anything runs; the card below shows the new investors with their fit score,
// reason chips, warm path and sources. "Add" and "Add N to Wave 2" only file
// suggestions: nothing is on the list until Dev accepts them in Suggestions.
import { useNavigate } from '@tanstack/react-router'
import { useRef, useState, type FormEvent } from 'react'
import { cents, initials, sourceHost } from '../../lib/enrich'
import { findChips, kindLine } from '../../lib/findMore'
import { modelName } from '../../lib/models'
import { scoreBand } from '../../lib/priority'
import { play } from '../../lib/sound'
import { useUI } from '../raise-ui'
import { Menu } from '../system/Menu'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Chip, Icon } from '../ui'
import { useFindMore, type FindCandidate, type FindState } from './findMoreData'

/** Rows shown before "N more". */
const FIRST = 5

const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1])

/** The header button: opens and closes the panel. */
export function FindMoreButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="fm-bar">
      <Button variant="primary" onClick={onToggle} aria-expanded={open} aria-controls="fm-panel">
        Find more like these
      </Button>
    </div>
  )
}

export function FindMorePanel() {
  const f = useFindMore()
  const s = f.state
  if (!s) return null
  return (
    <div className="fm" id="fm-panel">
      <Seeds s={s} setCompanies={f.setCompanies} start={f.start} />
      {s.run ? <Results key={s.run._id} s={s} add={f.add} start={f.start} /> : null}
    </div>
  )
}

function Seeds({ s, setCompanies, start }: { s: FindState; setCompanies: (xs: string[]) => Promise<unknown>; start: () => Promise<unknown> }) {
  const save = useSaveAction()
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [starting, setStarting] = useState(false)
  const running = s.run?.status === 'running'
  const set = (companies: string[]) => void save(() => setCompanies(companies), { failMessage: 'Couldn’t save the companies.' })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const t = text.trim()
    if (t) set([...s.companies, t])
    setText('')
    setAdding(false)
  }
  const go = async () => {
    setStarting(true)
    await save(start, { failMessage: 'Couldn’t start the search.' })
    setStarting(false)
  }
  const seeds = s.companies.length + s.investors.length
  return (
    <section className="fm-panel m-rise" aria-labelledby="fm-title">
      <p className="sg-eyebrow">
        <Icon name="spark" size={14} className="sg-eyebrow__spark" />
        Find more · about {cents(s.estimateUsd)} on {modelName(s.model)}
      </p>
      <div className="fm-panel__head">
        <h2 id="fm-title" className="fm-panel__title">
          Investors who back companies one step ahead of Pesto
        </h2>
        <Button variant="dark" size="sm" onClick={go} loading={starting || running} loadingLabel="Searching…" disabled={!s.connected || !seeds} icon="search">
          {s.run ? 'Search again' : 'Search the web'}
        </Button>
      </div>
      <p className="fm-panel__sub">
        Starting from your top Priority investors{s.investors.length ? ' (' + listOf(s.investors) + ')' : ''} and these companies. Only investors active in the last 12 months.
        {s.connected ? '' : ' AI isn’t set up here, so nothing can run.'}
      </p>
      <div className="fm-panel__seeds">
        <ul className="fm-chips" aria-label="Companies one step ahead">
          {s.companies.map((c) => (
            <li key={c}>
              <Chip tone="selected" className="fm-chip">
                {c}
                <button type="button" className="fm-chip__x" onClick={() => set(s.companies.filter((x) => x !== c))} aria-label={'Remove ' + c}>
                  <Icon name="close" size={14} />
                </button>
              </Chip>
            </li>
          ))}
          <li>
            {adding ? (
              <form className="fm-add" onSubmit={submit}>
                <input
                  className="fm-add__input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onBlur={submit}
                  onKeyDown={(e) => e.key === 'Escape' && (setText(''), setAdding(false))}
                  placeholder="Company name"
                  aria-label="Company name"
                  autoFocus
                  maxLength={60}
                />
              </form>
            ) : (
              <button type="button" className="chip chip--outline fm-chip-add" onClick={() => setAdding(true)}>
                <Icon name="plus" size={14} />
                Add a company
              </button>
            )}
          </li>
        </ul>
        <ul className="fm-round" aria-label="What Nest looks for">
          {s.chips.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Results({ s, add, start }: { s: FindState; add: (ids: string[], wave?: 2) => Promise<{ added: number }>; start: () => Promise<unknown> }) {
  const run = s.run!
  const ui = useUI()
  const save = useSaveAction()
  const navigate = useNavigate()
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const review = { label: 'Review', onClick: () => void navigate({ to: '/raise/today', state: (x) => ({ ...x, suggestions: true }) }) }

  const addOne = async (c: FindCandidate) => {
    const r = await save(() => add([c._id]), { failMessage: 'Couldn’t add ' + c.name + '.' })
    if (!r) return
    play('save')
    ui.toast({ message: r.added ? c.name + ' is in Suggestions as Not contacted.' : c.name + ' was already suggested.', action: review })
  }
  const addAll = async () => {
    setBusy(true)
    const r = await save(() => add(s.candidates.map((c) => c._id), 2), { failMessage: 'Couldn’t add them.' })
    setBusy(false)
    if (!r) return
    play('save')
    ui.toast({ message: r.added + (r.added === 1 ? ' investor is' : ' investors are') + ' in Suggestions as Not contacted, ' + s.waveLabel + '.', action: review })
  }

  if (run.status === 'running')
    return (
      <section className="card fm-results" aria-labelledby="fm-results-title" aria-busy="true">
        <div className="fm-results__head">
          <div>
            <h2 id="fm-results-title" className="fm-results__title">
              Searching <Chip tone="live">Live</Chip>
            </h2>
            <p className="fm-results__sub">
              Haiku is looking up who backed {listOf(s.companies.length ? s.companies : s.investors)}, then {s.jev ? 'Jev scores each one' : 'Nest scores each one'}. Usually about a minute.
            </p>
          </div>
        </div>
        <ul className="fm-rows" aria-hidden="true">
          {[0, 1, 2].map((k) => (
            <li key={k} className="fm-row fm-row--ghost">
              <span className="enrich-avatar" />
              <span className="fm-ghost fm-ghost--name" />
              <span className="fm-ghost fm-ghost--why" />
            </li>
          ))}
        </ul>
      </section>
    )

  if (run.status === 'failed')
    return (
      <section className="card fm-results" aria-labelledby="fm-results-title">
        <div className="fm-results__head">
          <div>
            <h2 id="fm-results-title" className="fm-results__title">
              The search didn’t finish
            </h2>
            <p className="fm-results__sub">{run.error === 'NoAIKey' ? 'AI isn’t set up here.' : 'Something went wrong while searching. Nothing was added.'} It cost {cents(run.costUsd)}.</p>
          </div>
          <Button onClick={() => void save(start, { failMessage: 'Couldn’t start the search.' })}>Try again</Button>
        </div>
      </section>
    )

  if (!s.candidates.length)
    return (
      <section className="card fm-results" aria-labelledby="fm-results-title">
        <div className="fm-results__head">
          <div>
            <h2 id="fm-results-title" className="fm-results__title">
              {run.added ? 'All added' : 'No new investors this time'}
            </h2>
            <p className="fm-results__sub">
              {run.added
                ? 'They’re waiting in Suggestions. Nothing is on the list until you accept them there.'
                : 'Everyone Haiku found is already in Nest (' + run.already + ') or hasn’t invested in the last 12 months (' + run.inactive + '). Try another company.'}
            </p>
          </div>
        </div>
      </section>
    )

  const n = s.candidates.length
  const shown = more ? s.candidates : s.candidates.slice(0, FIRST)
  const rest = s.candidates.slice(FIRST)
  const alongside = s.candidates.filter((c) => c.coInvests?.length)
  return (
    <section className="card fm-results m-rise" aria-labelledby="fm-results-title">
      <div className="fm-results__head">
        <div>
          <h2 id="fm-results-title" className="fm-results__title">
            {n} new {n === 1 ? 'investor' : 'investors'}
          </h2>
          <p className="fm-results__sub">They land in Suggestions as “Not contacted”. Nothing is added until you say so.</p>
        </div>
        <Button variant="primary" onClick={addAll} loading={busy} loadingLabel="Adding…">
          Add {n} to {s.waveLabel}
        </Button>
      </div>
      <ul className="fm-rows">
        {shown.map((c) => (
          <Row key={c._id} c={c} onAdd={() => void addOne(c)} />
        ))}
      </ul>
      {rest.length && !more ? (
        <p className="fm-results__foot">
          <button type="button" className="fm-more" onClick={() => setMore(true)}>
            {rest.length} more
          </button>
          {alongside.length ? ' · ' + listOf(alongside.map((c) => c.name.split(/\s+/)[0])) + ' also invest alongside ' + alongside[0].coInvests![0] : ''}
        </p>
      ) : null}
    </section>
  )
}

function Row({ c, onAdd }: { c: FindCandidate; onAdd: () => void }) {
  const [menu, setMenu] = useState(false)
  const src = useRef<HTMLButtonElement>(null)
  const kind = kindLine(c)
  return (
    <li className="fm-row">
      <span className="enrich-avatar" aria-hidden="true">
        {initials(c.name)}
      </span>
      <span className="fm-row__who">
        <span className="fm-row__name">{c.name}</span>
        {kind ? <span className="fm-row__kind">{kind}</span> : null}
      </span>
      <span className={'prio prio--' + scoreBand(c.score) + ' fm-row__score'} title={c.scoredBy === 'jev' ? 'Fit out of 100, from Jev’s four scores' : 'Priority out of 100 (Jev couldn’t score this one)'}>
        <span className="prio__n">{c.score}</span>
      </span>
      <span className="fm-row__why">
        <span className="prio-why">
          {findChips(c).map((x) => (
            <span key={x.label} className={'prio-chip fm-chip--' + x.tone}>
              {x.label}
            </span>
          ))}
        </span>
        {c.warmPath ? <span className="fm-row__warm">Warm path: {c.warmPath}</span> : null}
      </span>
      <button ref={src} type="button" className="fm-row__src" onClick={() => setMenu(true)} aria-haspopup="menu" aria-expanded={menu}>
        Sources
      </button>
      {menu ? (
        <Menu
          anchor={src.current}
          title={'Sources for ' + c.name}
          items={c.sources.map((x) => ({ label: x.title && x.title !== sourceHost(x.url) ? x.title : sourceHost(x.url), icon: 'link' as const, onSelect: () => void window.open(x.url, '_blank', 'noopener') }))}
          onClose={() => setMenu(false)}
        />
      ) : null}
      <Button className="fm-row__add" onClick={onAdd}>
        Add
      </Button>
    </li>
  )
}
