// PST-274: the drawer's enrichment, at the top of Details. One of: Enrich (nothing
// found yet), the progress card while Claude looks, the review card (keep or dismiss
// each fact), then the fund card, People and Fit once facts are kept. On a phone
// sheet the fund card is compact and Refresh sits at the bottom. Motion and sound
// follow interactions-ai.png: sounds only after a click, one per action.
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  asRank, cardState, cents, factOrder, fieldLabel, fit, initials, investorWrite, RANK_LABEL, sourceHost, timeLeft,
  type Fact, type Person, type Run,
} from '../../lib/enrich'
import { formatDay } from '../../lib/dates'
import { estimate, MODEL_INFO, modelFor, MODELS, type Model } from '../../lib/models'
import { pop, replay, rise, shine, useCountUp, wobble } from '../../lib/motion'
import type { Investor, InvestorFields } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { Menu } from '../system/Menu'
import { Button, Icon, Input } from '../ui'

const rankText = (v: string) => {
  const r = asRank(v)
  return r ? RANK_LABEL[r] : v
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many)

/** "kite.example.com/team" for a team or FAQ page, else just the host. */
function sourceLabel(url: string): string {
  const host = sourceHost(url)
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0] ?? ''
    return /^(team|people|about|faq|portfolio|thesis|contact)$/i.test(seg) ? host + '/' + seg : host
  } catch {
    return host
  }
}
/** The source link is noise when the value is the link (a LinkedIn URL). */
const showSource = (f: Fact) => !!f.source && !f.source.replace(/^https?:\/\/(www\.)?/, '').startsWith(f.value.replace(/^https?:\/\/(www\.)?/, ''))

/** The Details row a kept fact fills flashes lime (Expected is the one Details shows). */
function flashFields(from: Element | null, patches: (Partial<InvestorFields> | undefined)[]) {
  const drawer = from?.closest('.drawer')
  for (const k of new Set(patches.flatMap((p) => Object.keys(p ?? {})))) replay(drawer?.querySelector('[data-field="' + k + '"]'), 'enrich-flash')
}

export function InvestorEnrich({ inv, sheet }: { inv: Investor; sheet: boolean }) {
  const d = useRaise()
  const ui = useUI()
  const x = d.useInvestorAI(inv._id)
  const [starting, setStarting] = useState(false)
  const pending = (x?.facts ?? []).filter((f) => f.status === 'pending').sort((a, b) => factOrder(a) - factOrder(b))
  const kept = (x?.facts ?? []).filter((f) => f.status === 'kept')
  const state = cardState({ connected: d.ai.connected, run: x?.run, pending: pending.length, kept: kept.length })
  // The review card counts up and shines only when it follows a run you watched.
  const [prev, setPrev] = useState(state)
  const [fresh, setFresh] = useState(false)
  if (prev !== state) {
    setPrev(state)
    setFresh(prev === 'running' && state === 'review')
  }
  if (!x || !d.ai.loaded) return null

  /** Enrich, Refresh, or (PST-273) Redo with another model, just this once. */
  async function start(model?: Model) {
    setStarting(true)
    play('save')
    try {
      await d.aiDo.enrich(inv._id, model)
    } catch (e) {
      ui.fail(e)
    } finally {
      setStarting(false)
    }
  }

  const run = x.run
  return (
    <div className="enrich">
      {state === 'running' && run ? <Progress run={run} name={inv.name} /> : null}
      {state === 'review' && run ? <Review inv={inv} run={run} facts={pending} fresh={fresh} onRedo={start} /> : null}
      {state === 'nokey' ? <NotSetUp /> : null}
      {state === 'idle' || state === 'failed' ? <Start inv={inv} run={state === 'failed' ? run : null} starting={starting} onStart={start} /> : null}
      {kept.length ? <FundCard inv={inv} facts={kept} people={x.people} run={run} sheet={sheet} busy={starting || state === 'running'} onRefresh={start} /> : null}
      {x.people.length || kept.length ? <People inv={inv} people={x.people} sheet={sheet} canFind={state !== 'running' && d.ai.connected} onFind={() => start()} /> : null}
      {!sheet && kept.length ? <FitCard facts={kept} /> : null}
      {sheet && kept.length ? (
        <Button variant="secondary" block icon="spark" className="enrich-refresh" loading={starting} loadingLabel="Starting…" disabled={state === 'running'} onClick={() => start()}>
          Refresh
        </Button>
      ) : null}
    </div>
  )
}

/* ---------- before anything is found ---------- */

/**
 * PST-273: Redo with a stronger model, just this once (Settings › AI keeps its
 * model). Each choice shows what a run on it should cost before it starts.
 */
function RedoMenu({ disabled, onRedo }: { disabled?: boolean; onRedo: (m: Model) => void }) {
  const d = useRaise()
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null)
  const current = modelFor(d.ai.models, 'enrich')
  return (
    <>
      <button type="button" className="enrich-link enrich-redo" aria-haspopup="menu" aria-expanded={!!anchor} disabled={disabled} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        Redo
        <Icon name="chevron-down" size={16} />
      </button>
      {anchor ? (
        <Menu
          anchor={anchor}
          title="Redo with another model"
          onClose={() => setAnchor(null)}
          items={MODELS.filter((m) => m !== current).map((m) => ({
            label: 'Redo with ' + MODEL_INFO[m].name + ' · ≈ ' + cents(estimate('enrich', m, d.ai.features.enrich.real).usd),
            onSelect: () => onRedo(m),
          }))}
        />
      ) : null}
    </>
  )
}

function Start({ inv, run, starting, onStart }: { inv: Investor; run: Run | null | undefined; starting: boolean; onStart: (model?: Model) => void }) {
  const d = useRaise()
  const cost = estimate('enrich', modelFor(d.ai.models, 'enrich'), d.ai.features.enrich.real).usd
  return (
    <section className="enrich-card enrich-card--start">
      <div className="enrich-eyebrow eyebrow-mono">
        <Icon name="spark" size={16} className="enrich-spark" />
        Enrich
      </div>
      <h3 className="enrich-card__title">Find out about {inv.name}</h3>
      <p className="enrich-card__text">
        Nest reads their site, LinkedIn and news: who they are, the fund, check size and partners. About 30 seconds and {cents(cost)}. Nothing is saved until you keep it.
      </p>
      {run ? <p className="enrich-card__error">The last try didn’t finish{run.error ? ': ' + run.error : '.'}</p> : null}
      <div className="enrich-card__actions">
        <Button variant="primary" icon="spark" loading={starting} loadingLabel="Starting…" onClick={() => onStart()}>
          {run ? 'Try again' : 'Enrich'}
        </Button>
        {run ? <RedoMenu disabled={starting} onRedo={onStart} /> : null}
      </div>
    </section>
  )
}

function NotSetUp() {
  return (
    <section className="enrich-card enrich-card--off">
      <div className="enrich-eyebrow eyebrow-mono">
        <Icon name="spark" size={16} className="enrich-spark enrich-spark--off" />
        AI
      </div>
      <h3 className="enrich-card__title">AI isn’t set up here</h3>
      <p className="enrich-card__text">
        Enrichment needs an Anthropic key on this deployment (ANTHROPIC_API_KEY in Convex). Once it’s there, Enrich shows up here. <Link to="/raise/settings">See Settings</Link>
      </p>
    </section>
  )
}

/* ---------- while Claude looks ---------- */

function Progress({ run, name }: { run: Run; name: string }) {
  const d = useRaise()
  const ui = useUI()
  const [now, setNow] = useState(() => Date.now())
  const [stopping, setStopping] = useState(false)
  const rows = useRef<(HTMLLIElement | null)[]>([])
  const seen = useRef(run.steps.map((s) => s.state))
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  // Each fact found: its tick pops and the line shines once.
  useEffect(() => {
    run.steps.forEach((s, i) => {
      if (s.state !== 'done' || seen.current[i] === 'done') return
      pop(rows.current[i]?.querySelector('.enrich-step__tick'))
      shine(rows.current[i])
    })
    seen.current = run.steps.map((s) => s.state)
  }, [run.steps])

  async function stop() {
    setStopping(true)
    try {
      await d.aiDo.stop(run._id)
    } catch (e) {
      ui.fail(e)
      setStopping(false)
    }
  }
  const queued = run.status === 'queued'
  return (
    <section className="enrich-card enrich-card--mint" aria-busy="true">
      <div className="enrich-eyebrow eyebrow-mono">
        <Icon name="spark" size={16} className="enrich-spark enrich-spark--spin" />
        {queued ? 'Queued' : 'Enriching'}
      </div>
      <h3 className="enrich-card__title">Finding out about {name}</h3>
      <p className="enrich-card__text">Nest is reading their site, LinkedIn and news. Nothing is saved until you keep it.</p>
      <ol className="enrich-steps">
        {run.steps.map((s, i) => (
          <li
            key={i}
            ref={(el) => {
              rows.current[i] = el
            }}
            className={'enrich-step enrich-step--' + s.state + ' m-rise'}
            style={rise(i)}
          >
            <span className="enrich-step__tick" aria-hidden="true">
              {s.state === 'done' ? <Icon name="check" size={14} strokeWidth={2.5} /> : null}
            </span>
            <span className="enrich-step__label">
              {s.label}
              <span className="sr-only">{s.state === 'done' ? ', done' : s.state === 'running' ? ', in progress' : ', waiting'}</span>
            </span>
            {s.source && s.state !== 'waiting' ? <span className="enrich-step__source">{s.source}</span> : null}
          </li>
        ))}
      </ol>
      <div className="enrich-card__foot">
        <span aria-live="polite">
          {timeLeft(run, now)} · {cents(run.costUsd)} so far
        </span>
        <Button variant="secondary" size="sm" loading={stopping} loadingLabel="Stopping…" onClick={stop}>
          Stop
        </Button>
      </div>
    </section>
  )
}

/* ---------- review ---------- */

function Review({ inv, run, facts, fresh, onRedo }: { inv: Investor; run: Run; facts: Fact[]; fresh: boolean; onRedo: (m: Model) => void }) {
  const d = useRaise()
  const ui = useUI()
  const card = useRef<HTMLElement>(null)
  const [folding, setFolding] = useState<ReadonlySet<string>>(new Set())
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState<'keep' | 'dismiss' | null>(null)
  const total = Math.max(run.factCount ?? 0, facts.length)
  const count = useCountUp(total, { from: fresh ? 0 : total })
  // All found: the card shines once.
  useEffect(() => {
    if (!fresh) return
    shine(card.current)
    play('prep-done')
  }, [fresh])

  const add = (s: ReadonlySet<string>, id: string) => new Set(s).add(id)
  const drop = (s: ReadonlySet<string>, id: string) => new Set([...s].filter((x) => x !== id))

  async function keep(f: Fact, row: HTMLElement | null) {
    pop(row?.querySelector('.enrich-fact__keep'))
    play('save')
    setFolding((s) => add(s, f._id))
    const { patch } = investorWrite(inv, f)
    try {
      await Promise.all([d.aiDo.keep(f._id), sleep(240)])
      flashFields(card.current, [patch])
    } catch (e) {
      setFolding((s) => drop(s, f._id))
      ui.fail(e)
    }
  }
  async function dismiss(f: Fact) {
    setLeaving((s) => add(s, f._id))
    try {
      await Promise.all([d.aiDo.dismiss(f._id), sleep(240)])
      ui.toast({
        message: 'Dismissed ' + fieldLabel(f.group, f.field).toLowerCase() + '. It won’t come back.',
        action: { label: 'Undo', onClick: () => { play('undo'); d.aiDo.undoDismiss(f._id).catch(ui.fail) } },
      })
    } catch (e) {
      setLeaving((s) => drop(s, f._id))
      ui.fail(e)
    }
  }
  async function keepAll() {
    setBusy('keep')
    const ids = facts.map((f) => f._id)
    ids.forEach((id, i) => setTimeout(() => setFolding((s) => add(s, id)), i * 40))
    const patches = facts.map((f) => investorWrite(inv, f).patch)
    try {
      const [n] = await Promise.all([d.aiDo.keepAll(run._id), sleep(ids.length * 40 + 240)])
      play('save')
      flashFields(card.current, patches)
      ui.toast({ tone: 'success', icon: 'check', message: 'Kept ' + plural(n, 'fact') + ' about ' + inv.name + '.' })
    } catch (e) {
      setFolding(new Set())
      ui.fail(e)
    } finally {
      setBusy(null)
    }
  }
  async function dismissAll() {
    setBusy('dismiss')
    const ids = facts.map((f) => f._id)
    setLeaving(new Set(ids))
    try {
      const [n] = await Promise.all([d.aiDo.dismissAll(run._id), sleep(240)])
      ui.toast({
        message: 'Dismissed ' + plural(n, 'fact') + '.',
        action: { label: 'Undo', onClick: () => { play('undo'); Promise.all(ids.map((id) => d.aiDo.undoDismiss(id))).catch(ui.fail) } },
      })
    } catch (e) {
      setLeaving(new Set())
      ui.fail(e)
    } finally {
      setBusy(null)
    }
  }

  const groups: [string, Fact[]][] = [
    ['The person', facts.filter((f) => f.group === 'person')],
    ['The fund', facts.filter((f) => f.group === 'fund')],
  ]
  return (
    <section ref={card} className="enrich-card enrich-card--review">
      <div className="enrich-review__head">
        <div className="enrich-eyebrow eyebrow-mono">
          <Icon name="spark" size={16} className="enrich-spark" />
          Found · <span className="num">{count}</span> {total === 1 ? 'thing' : 'things'} · {cents(run.costUsd)}
        </div>
        <h3 className="enrich-card__title">Keep what’s right</h3>
        <p className="enrich-card__text">Kept facts fill the investor’s fields. Dismissed ones won’t come back.</p>
        <div className="enrich-review__all">
          <Button variant="primary" loading={busy === 'keep'} loadingLabel="Keeping…" disabled={!!busy} onClick={keepAll}>
            Keep all {facts.length}
          </Button>
          <Button variant="ghost" loading={busy === 'dismiss'} loadingLabel="Dismissing…" disabled={!!busy} onClick={dismissAll}>
            Dismiss all
          </Button>
          <RedoMenu disabled={!!busy} onRedo={onRedo} />
        </div>
      </div>
      {groups.map(([title, list]) =>
        list.length ? (
          <div className="enrich-review__group" key={title}>
            <h4 className="enrich-review__label eyebrow-mono">{title}</h4>
            <ul className="enrich-facts">
              {list.map((f) => (
                <FactRow key={f._id} f={f} folding={folding.has(f._id)} leaving={leaving.has(f._id)} disabled={!!busy} onKeep={keep} onDismiss={dismiss} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </section>
  )
}

function FactRow({ f, folding, leaving, disabled, onKeep, onDismiss }: { f: Fact; folding: boolean; leaving: boolean; disabled: boolean; onKeep: (f: Fact, row: HTMLElement | null) => void; onDismiss: (f: Fact) => void }) {
  const row = useRef<HTMLLIElement>(null)
  const label = fieldLabel(f.group, f.field)
  const gone = folding || leaving
  return (
    <li ref={row} className={'enrich-fact' + (folding ? ' is-folding' : '') + (leaving ? ' is-leaving' : '')} aria-hidden={gone || undefined}>
      <div className="enrich-fact__inner">
        <span className="enrich-fact__label">{label}</span>
        <div className="enrich-fact__body">
          <span className="enrich-fact__value">{f.field === 'rank' ? rankText(f.value) : f.value}</span>
          {showSource(f) ? (
            <a className="enrich-fact__source" href={f.source} target="_blank" rel="noreferrer">
              {sourceLabel(f.source)} ↗
            </a>
          ) : null}
          {f.clash ? <Clash text={f.clash} /> : null}
        </div>
        <div className="enrich-fact__btns">
          <button type="button" className="enrich-fact__keep" aria-label={'Keep ' + label} title="Keep" disabled={disabled || gone} onClick={() => onKeep(f, row.current)}>
            <Icon name="check" size={16} strokeWidth={2.5} />
          </button>
          <button type="button" className="enrich-fact__dismiss" aria-label={'Dismiss ' + label} title="Dismiss" disabled={disabled || gone} onClick={() => onDismiss(f)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      </div>
    </li>
  )
}

/** "You wrote $50K as Expected. Keeping this won't change it." It wobbles once when it appears. */
function Clash({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  useEffect(() => wobble(ref.current), [])
  return (
    <p ref={ref} className="enrich-fact__clash">
      {text}
    </p>
  )
}

/* ---------- what was kept ---------- */

const keptValue = (facts: Fact[], field: string) =>
  facts.filter((f) => f.group === 'fund' && f.field === field).sort((a, b) => (b.keptAt ?? 0) - (a.keptAt ?? 0))[0]?.value

function FundCard({ inv, facts, people, run, sheet, busy, onRefresh }: { inv: Investor; facts: Fact[]; people: Person[]; run: Run | null; sheet: boolean; busy: boolean; onRefresh: (model?: Model) => void }) {
  const v = (k: string) => keptValue(facts, k)
  const partners = people.length || (facts.some((f) => f.field === 'partner') ? facts.filter((f) => f.field === 'partner').length + 1 : 0)
  const stats: [string, string | undefined][] = sheet
    ? [['Fund size', v('size')], ['Average check', v('check')], ['Stage', v('stage')], ['Leads', v('leads')]]
    : [['Fund size', v('size')], ['Stage', v('stage')], ['Average check', v('check')], ['Leads', v('leads')], ['Geography', v('geography')], ['Partners', partners ? String(partners) : undefined]]
  const deals = sheet ? [] : (v('recentDeals') ?? '').split(/,\s*|;\s*/).map((s) => s.trim().replace(/\s*\(([^)]+)\)$/, ' · $1')).filter(Boolean)
  const sources = new Set(facts.map((f) => sourceHost(f.source))).size
  const at = run?.status === 'done' && run.finishedAt ? run.finishedAt : Math.max(...facts.map((f) => f.keptAt ?? f._creationTime ?? 0))
  return (
    <section className="enrich-card enrich-card--mint enrich-fund">
      <div className="enrich-eyebrow eyebrow-mono enrich-eyebrow--plain">The fund</div>
      {!sheet ? <h3 className="enrich-card__title">{v('name') || inv.firm || inv.name}</h3> : null}
      {!sheet && v('thesis') ? <p className="enrich-card__text">{v('thesis')}</p> : null}
      <dl className="enrich-fund__stats">
        {stats
          .filter((s): s is [string, string] => !!s[1])
          .map(([k, val]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
      </dl>
      {sheet && v('thesis') ? <p className="enrich-card__text">{v('thesis')}</p> : null}
      {deals.length ? (
        <div className="enrich-fund__deals">
          <span className="enrich-fund__k">Recent deals</span>
          <div className="enrich-fund__chips">
            {deals.map((x) => (
              <span className="chip chip--outline" key={x}>
                {x}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="enrich-fund__foot">
        <span className="enrich-eyebrow eyebrow-mono">
          <Icon name="spark" size={16} className="enrich-spark" />
          Found by Nest{at ? ' · ' + formatDay(at) : ''}
          {!sheet && sources ? ' · ' + plural(sources, 'source') : ''}
        </span>
        <span className="enrich-fund__redo">
          {!sheet ? (
            <button type="button" className="enrich-link" disabled={busy} onClick={() => onRefresh()}>
              Refresh
            </button>
          ) : null}
          <RedoMenu disabled={busy} onRedo={onRefresh} />
        </span>
      </div>
    </section>
  )
}

function People({ inv, people, sheet, canFind, onFind }: { inv: Investor; people: Person[]; sheet: boolean; canFind: boolean; onFind: () => void }) {
  const d = useRaise()
  const ui = useUI()
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', title: '', email: '' })
  const [error, setError] = useState('')

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return setError('Add a name.')
    setSaving(true)
    try {
      await d.aiDo.addPerson(inv._id, { name: form.name.trim(), ...(form.title.trim() ? { title: form.title.trim() } : {}), ...(form.email.trim() ? { email: form.email.trim() } : {}) })
      setForm({ name: '', title: '', email: '' })
      setAdding(false)
      setError('')
    } catch (err) {
      ui.fail(err)
    } finally {
      setSaving(false)
    }
  }
  async function makeMain(p: Person) {
    try {
      await d.aiDo.setPrimary(p._id)
      ui.toast({ tone: 'success', icon: 'check', message: p.name + ' is the main contact for ' + inv.name + '.' })
    } catch (e) {
      ui.fail(e)
    }
  }

  const addButton = (
    <button type="button" className="enrich-link" onClick={() => setAdding((x) => !x)} aria-expanded={adding}>
      + Add a person
    </button>
  )
  return (
    <section className="enrich-card enrich-people">
      <div className="enrich-people__head">
        <h3 className="enrich-review__label eyebrow-mono">People</h3>
        {!sheet ? addButton : null}
      </div>
      {adding ? (
        <form className="enrich-people__form" onSubmit={add}>
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={error || undefined} autoFocus />
          <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Principal" />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="enrich-people__formbtns">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" loading={saving} loadingLabel="Adding…">
              Add
            </Button>
          </div>
        </form>
      ) : null}
      {people.length ? (
        <ul className="enrich-people__list">
          {people.map((p) => (
            <li className="enrich-person" key={p._id}>
              <span className={'enrich-avatar' + (p.primary ? ' enrich-avatar--main' : '')} aria-hidden="true">
                {initials(p.name)}
              </span>
              <div className="enrich-person__body">
                <div className="enrich-person__name">
                  <strong>{p.name}</strong>
                  {p.primary && !sheet ? (
                    <span className="chip chip--live">
                      <span className="chip__dot" aria-hidden="true" />
                      Main contact
                    </span>
                  ) : null}
                  {!p.primary && !sheet ? (
                    <button type="button" className="enrich-person__main" onClick={() => void makeMain(p)}>
                      Make main contact
                    </button>
                  ) : null}
                </div>
                <span className="enrich-person__sub">{[p.title || (p.rank ? RANK_LABEL[p.rank] : ''), p.covers].filter(Boolean).join(' · ')}</span>
                {!sheet && p.email ? <span className="enrich-person__email">{p.email}</span> : null}
              </div>
              {!sheet ? (
                <div className="enrich-person__icons">
                  {p.linkedin ? (
                    <a href={p.linkedin.startsWith('http') ? p.linkedin : 'https://' + p.linkedin} target="_blank" rel="noreferrer" aria-label={p.name + ' on LinkedIn'} title="LinkedIn">
                      <Icon name="link" size={18} />
                    </a>
                  ) : null}
                  {p.email ? (
                    <a href={'mailto:' + p.email} aria-label={'Email ' + p.name} title={p.email}>
                      <Icon name="mail" size={18} />
                    </a>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="enrich-card__text">Nobody here yet. Keep the person Nest found, or add one.</p>
      )}
      {sheet ? addButton : canFind ? (
        <button type="button" className="enrich-link enrich-people__find" onClick={onFind}>
          Find more partners at {inv.firm || inv.name}
        </button>
      ) : null}
    </section>
  )
}

function FitCard({ facts }: { facts: Fact[] }) {
  const { round } = useRaise()
  const f = fit(facts, round)
  if (!f) return null
  return (
    <section className="enrich-card enrich-fit">
      <span className="enrich-fit__score num" aria-label={'Fit score ' + f.score + ' out of 100'}>
        {f.score}
      </span>
      <div>
        <h3 className="enrich-fit__title">{f.headline}</h3>
        <div className="enrich-fit__chips">
          {f.reasons.map((r) => (
            <span className="chip chip--outline" key={r}>
              {r}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
