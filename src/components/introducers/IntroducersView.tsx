// PST-294: Investors › Introducers (investors-introducers.png). One row per
// person who introduces Dev (committed investors included), with asked, made,
// meetings, money in and what's next; a panel for one of them with each intro's
// six steps. Opening it migrates the old free-text warm paths into people.
// PST-305: Investors › Network. Founders, friends, advisors and angels: filter
// chips, each row's relation, company, roles and how many investors they can
// introduce; the panel adds their roles, an Investing card for someone who
// also invests, Find their investors for a founder, "Who do they know" and one
// ask naming 2–3 investors.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { todayIST } from '../../lib/dates'
import { cents } from '../../lib/enrich'
import { firstName, initials, introLine, introNext, lastDone, personSub, RELATION_LABEL, type Intro } from '../../lib/introducers'
import { money } from '../../lib/money'
import { askable, ASK_MIN, FILTER_LABEL, filterCounts, inFilter, LOOKUP_MAX, NETWORK_FILTERS, networkRows, ROLE_LABEL, roleChips, roundLine, type NetworkFilter, type NetworkRow } from '../../lib/network'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { LABEL } from '../../lib/stages'
import { PREVIEW_NETWORK_PERSON } from '../../preview/networkFixture'
import { useRaise } from '../data'
import { openDraft } from '../drafts/data'
import { usePreviewState } from '../preview-state'
import { openOnKey, useUI } from '../raise-ui'
import { Modal, useTitleId } from '../system/Modal'
import { SkeletonRows } from '../system/Skeleton'
import { Button, Card, Checkbox, Chip, Toggle } from '../ui'
import { useIntroducers, useIntroInvestors, useMigrate } from './data'
import { AskDialog, ImportPeopleDialog, IntroducerDialog } from './Dialogs'
import { StepBar, useToggleStep } from './Steps'

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

type ViewProps = {
  person?: string
  onPerson: (key: string | undefined) => void
  adding: boolean
  onAdding: (on: boolean) => void
  /* PST-305 */
  filter: NetworkFilter
  onFilter: (f: NetworkFilter) => void
  importing: boolean
  onImporting: (on: boolean) => void
}

export function IntroducersView({ person, onPerson, adding, onAdding, filter, onFilter, importing, onImporting }: ViewProps) {
  const x = useIntroducers()
  const investors = useIntroInvestors()
  const ui = useUI()
  const phone = useMedia('(max-width: 720px)')
  const preview = usePreviewState()
  useMigrate()
  const today = todayIST()
  const rows = useMemo(() => networkRows({ introducers: x.introducers, intros: x.intros, investors: investors }, today), [x.introducers, x.intros, investors, today])
  const counts = useMemo(() => filterCounts(rows), [rows])
  const [showAll, setShowAll] = useState(false)
  const inView = rows.filter((r) => inFilter(r, filter))
  const active = inView.filter((r) => r.intros.length)
  const quiet = inView.filter((r) => !r.intros.length)
  const shown = showAll || !active.length || filter !== 'all' ? inView : active

  // &introducer=panel|ask: Ankur's panel (Ask for another intro open), on phones too. PST-305: &network=founder|friend|advisor|lookup.
  const net = preview?.network
  const previewKey =
    preview?.introducer === 'panel' || preview?.introducer === 'ask'
      ? rows.find((r) => r.name.startsWith('Ankur'))?.key
      : net && net in PREVIEW_NETWORK_PERSON ? PREVIEW_NETWORK_PERSON[net as keyof typeof PREVIEW_NETWORK_PERSON] : undefined
  const sel = rows.find((r) => r.key === (person ?? previewKey)) ?? (phone ? undefined : shown[0])

  if (!x.loaded) return <Card className="intro-list" aria-busy="true" />
  const panel = sel ? <PersonPanel key={sel.key} row={sel} today={today} onOpen={(id) => ui.open(id)} /> : null

  return (
    <div className="intro-view">
      <Card className="intro-list" aria-labelledby="intro-list-title">
        <h2 id="intro-list-title" className="intro-list__h">Your network</h2>
        <p className="intro-list__lede">Founders, friends and advisors who can introduce you. A founder’s intro beats every other kind. Thank them the same day, and always report back.</p>
        <div className="net-filters" role="group" aria-label="Show">
          {NETWORK_FILTERS.map((f) => (
            <button key={f} type="button" className={'draft-chip' + (filter === f ? ' is-on' : '')} aria-pressed={filter === f} onClick={() => onFilter(f)}>
              {FILTER_LABEL[f]} <span className="num">{counts[f]}</span>
            </button>
          ))}
        </div>
        {shown.length ? (
          <div className="intro-table" role="table" aria-label="Network">
            <div className="intro-row intro-row--head" role="row">
              <span role="columnheader">Person</span>
              <span role="columnheader" className="intro-row__n" title="Investors they can introduce you to">Can intro</span>
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
                  <span className={'enrich-avatar' + (sel?.key === r.key || r.relation === 'founder' ? ' enrich-avatar--main' : '')} aria-hidden="true">
                    {initials(r.name)}
                  </span>
                  <span className="intro-row__text">
                    <strong>{r.name}</strong>
                    <small>{personSub(r)}</small>
                    <RoleChips row={r} />
                  </span>
                </span>
                <span role="cell" className="intro-row__n num" aria-label={r.canIntroTo + ' they can introduce'}>{r.canIntroTo}</span>
                <span role="cell" className="intro-row__n num" aria-label={r.stats.asked + ' asked'}>{r.stats.asked}</span>
                <span role="cell" className="intro-row__n num" aria-label={r.stats.made + ' made'}>{r.stats.made}</span>
                <span role="cell" className="intro-row__n num" aria-label={r.stats.meetings + ' meetings'}>{r.stats.meetings}</span>
                <span role="cell" className={'intro-row__n num' + (r.stats.committed ? ' is-money' : '')}>{r.stats.committed ? money(r.stats.committed) : '—'}</span>
                <span role="cell" className={'intro-row__next is-' + r.next.tone}>{r.next.text}</span>
              </div>
            ))}
          </div>
        ) : rows.length ? (
          <p className="intro-list__empty">No {FILTER_LABEL[filter].toLowerCase()} yet. Add one, or show everyone.</p>
        ) : (
          <p className="intro-list__empty">Nobody in your Network yet. Add the founders, friends and advisors who can introduce you, or import them from a CSV.</p>
        )}
        {filter === 'all' && quiet.length && active.length ? (
          <button type="button" className="intro-list__more" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
            {showAll ? 'Show only the ones with investors to intro' : quiet.length + ' more · nobody on their list yet'}
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
      {importing ? <ImportPeopleDialog onClose={() => onImporting(false)} /> : null}
    </div>
  )
}

/** A row's roles, and their own stage when they invest too. */
function RoleChips({ row }: { row: NetworkRow }) {
  const chips = row.relation === 'committed' ? [] : roleChips(row.roles).filter((c) => !row.stage || c !== ROLE_LABEL.wantsToInvest)
  if (!chips.length && !row.stage) return null
  return (
    <span className="net-roles">
      {chips.map((c) => (
        <Chip key={c} tone="muted" dot={false}>
          {c}
        </Chip>
      ))}
      {row.stage ? (
        <Chip tone="outline" dot={false}>
          Investing · {LABEL[row.stage]}
        </Chip>
      ) : null}
    </span>
  )
}

const NOTES_LABEL: Partial<Record<NetworkRow['relation'], string>> = { friend: 'How you know them', advisor: 'What they advise on' }

function PersonPanel({ row, today, onOpen }: { row: NetworkRow; today: string; onOpen: (investorId: string) => void }) {
  const x = useIntroducers()
  const investors = useIntroInvestors()
  const { fail } = useUI()
  const toggle = useToggleStep()
  const uid = useId()
  const titleId = useTitleId()
  const who = firstName(row.name)
  const byId = new Map(investors.map((i) => [i._id, i]))
  const previewAsk = usePreviewState()?.introducer === 'ask'
  const [asking, setAsking] = useState(previewAsk)
  const [editing, setEditing] = useState(false)
  const intros = [...row.intros].sort((a, b) => rank(a, byId.get(a.investorId), today) - rank(b, byId.get(b.investorId), today) || lastDone(b.steps) - lastDone(a.steps))
  const toAsk = row.intros.filter((i) => askable(i, byId.get(i.investorId)))

  const act = (intro: Intro) => {
    const inv = byId.get(intro.investorId)
    const next = introNext(intro, inv, who, today)
    const tick = (step: 'thanked' | 'reported') => () => toggle(intro, step, true)
    if (next.kind === 'thank') return { label: next.text, onClick: tick('thanked'), title: 'Tick Thanked' }
    if (next.kind === 'report') return { label: next.text, onClick: tick('reported'), title: 'Tick Reported' }
    if (next.kind === 'nudge')
      return {
        label: next.text,
        title: 'You nudged ' + who + ': the 3 days start again',
        onClick: () => {
          play('log')
          x.nudged(intro._id).catch(fail)
        },
      }
    if (next.kind === 'send' || next.kind === 'ask') return { label: next.kind === 'ask' ? 'To ask · draft just this one' : next.text, onClick: () => openDraft({ investorId: intro.investorId, type: 'forwardable', introId: intro._id }) }
    return { label: next.text }
  }
  const askAll = () => toAsk.length && openDraft({ investorId: toAsk[0].investorId, type: 'introAsk', personKey: row.key })

  return (
    <Card as="section" className="intro-panel" aria-labelledby={titleId}>
      <header className="intro-panel__head">
        <span className="enrich-avatar enrich-avatar--main intro-panel__avatar" aria-hidden="true">
          {initials(row.name)}
        </span>
        <div className="intro-panel__id">
          <h2 id={titleId} className="intro-panel__name">{row.name}</h2>
          <p className="intro-panel__sub">{[row.company, row.email].filter(Boolean).join(' · ') || RELATION_LABEL[row.relation]}</p>
        </div>
      </header>
      <div className="net-panel__chips">
        <Chip tone="selected" dot={false} className="intro-panel__rel">
          {RELATION_LABEL[row.relation]}
        </Chip>
        {row.relation === 'founder' ? (
          <Chip tone="outline" dot={false} className="intro-panel__rel">
            Best kind of intro
          </Chip>
        ) : null}
      </div>
      {row.introducerId ? <RoleToggles row={row} onOpen={onOpen} /> : null}
      {row.notes.trim() ? (
        <>
          <h3 className="intro-panel__how eyebrow-mono">{NOTES_LABEL[row.relation] ?? 'Notes'}</h3>
          <p className="intro-panel__howtext">{row.notes}</p>
        </>
      ) : null}
      {row.relation === 'founder' && row.introducerId ? <FounderLookup row={row} onEdit={() => setEditing(true)} /> : null}

      <h3 className="intro-panel__how eyebrow-mono" id={uid + '-how'}>
        Investors {who} can introduce{row.intros.length ? ' · ' + row.intros.length : ''}
      </h3>
      <p className="intro-panel__howtext">
        To ask → ask {who} → {who} says yes → send a forwardable email → intro made → thank {who} → report back. Never cc an investor cold.
      </p>
      {toAsk.length ? (
        <div className="net-toask">
          <p>
            <strong>{toAsk.length} to ask.</strong> Ask {who} about 2–3 at once, with a note {who} can forward.
          </p>
          <Button size="sm" variant="primary" icon="spark" onClick={askAll}>
            Ask {who} for intros
          </Button>
        </div>
      ) : null}
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
        <p className="intro-panel__empty">Nobody on {who}’s list yet. Who do they know?</p>
      )}
      <footer className="intro-panel__foot">
        {toAsk.length >= ASK_MIN ? (
          <Button variant="primary" icon="spark" onClick={askAll}>
            Ask {who} for intros
          </Button>
        ) : null}
        <Button variant={toAsk.length >= ASK_MIN ? 'secondary' : 'primary'} icon="plus" onClick={() => setAsking(true)}>
          Who do they know
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

/** Can intro, Wants to invest (an Angel at Asked, linked both ways) and Gives advice; the Investing card when they invest. */
function RoleToggles({ row, onOpen }: { row: NetworkRow; onOpen: (investorId: string) => void }) {
  const x = useIntroducers()
  const d = useRaise()
  const { toast, fail } = useUI()
  const [offer, setOffer] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = row.introducerId!
  const inv = row.investorId ? d.investors.find((i) => i._id === row.investorId) : undefined
  const offered = offer ? d.investors.find((i) => i._id === offer) : undefined

  async function wants(on: boolean, o?: { linkTo?: string; create?: boolean }) {
    const prev = row.investorId
    const prevName = inv?.name
    setBusy(true)
    try {
      const r = await x.setWantsToInvest(id, on, o)
      setBusy(false)
      if (r.offer) return setOffer(r.offer)
      setOffer(null)
      if (on) {
        play('save')
        const name = d.investors.find((i) => i._id === r.investorId)?.name ?? row.name
        toast({
          tone: 'success', icon: 'check',
          message: r.created ? 'Added ' + row.name + ' to Investors as an Angel at Intro asked.' : row.name + ' is linked to ' + name + '.',
          ...(r.investorId ? { action: { label: 'Open', onClick: () => onOpen(r.investorId!) } } : {}),
        })
        return
      }
      if (!prev) return
      toast({
        tone: 'info',
        message: row.name + ' isn’t linked to ' + (prevName ?? 'the investor') + ' now. The investor card stays.',
        action: { label: 'Undo', onClick: () => (play('undo'), void x.setWantsToInvest(id, true, { linkTo: prev }).catch(fail)) },
      })
    } catch (e) {
      setBusy(false)
      fail(e)
    }
  }

  return (
    <div className="net-roles-panel">
      <h3 className="intro-panel__how eyebrow-mono">Roles</h3>
      <div className="net-toggles">
        <Toggle label={ROLE_LABEL.canIntro} checked={row.roles.canIntro} onChange={(e) => void x.setRoles(id, { canIntro: e.currentTarget.checked }).catch(fail)} />
        <Toggle label={ROLE_LABEL.wantsToInvest} checked={row.roles.wantsToInvest} disabled={busy} onChange={(e) => void wants(e.currentTarget.checked)} />
        <Toggle label={ROLE_LABEL.givesAdvice} checked={row.roles.givesAdvice} onChange={(e) => void x.setRoles(id, { givesAdvice: e.currentTarget.checked }).catch(fail)} />
      </div>
      {offered ? (
        <div className="net-offer" role="status">
          <p>
            <strong>{offered.name}</strong> is already in Investors{offered.email ? ' (' + offered.email + ')' : ''}. Is that {firstName(row.name)}?
          </p>
          <div className="net-offer__acts">
            <Button size="sm" variant="primary" onClick={() => void wants(true, { linkTo: offered._id })} loading={busy}>
              Link to {offered.name}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void wants(true, { create: true })} disabled={busy}>
              Add a new Angel
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOffer(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {row.roles.wantsToInvest && inv ? (
        <Card className="net-invest" aria-label="Investing">
          <p className="net-invest__eyebrow eyebrow-mono">Investing</p>
          <p className="net-invest__name">{inv.name}</p>
          <p className="net-invest__meta">{[inv.type, LABEL[inv.stage], inv.committed ? money(inv.committed) + ' in' : inv.expected ? money(inv.expected) + ' expected' : ''].filter(Boolean).join(' · ')}</p>
          <Button size="sm" variant="secondary" onClick={() => onOpen(inv._id)}>
            Open their card
          </Button>
        </Card>
      ) : null}
    </div>
  )
}

/** A founder's "Find their investors": the estimate first, then the results to tick; nothing is added without a tick. */
function FounderLookup({ row, onEdit }: { row: NetworkRow; onEdit: () => void }) {
  const x = useIntroducers()
  const { toast, fail } = useUI()
  const st = x.useLookup(row.introducerId ?? null)
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const autoRun = usePreviewState()?.network === 'lookup'
  const who = firstName(row.name)
  const run = st?.run
  useEffect(() => {
    if (autoRun && st && !run && row.company && row.introducerId) void x.startLookup(row.introducerId).catch(() => {})
  }, [autoRun, !!st, !!run]) // eslint-disable-line react-hooks/exhaustive-deps
  // A search that finishes while the panel is open: a notification when results are in, caution when it failed.
  const was = useRef(run?.status)
  useEffect(() => {
    const prev = was.current
    was.current = run?.status
    if (prev !== 'running') return
    if (run?.status === 'done') play('import-done')
    else if (run?.status === 'failed') play('failed')
  }, [run?.status])

  async function start() {
    setTicked(new Set())
    try {
      play('pick')
      await x.startLookup(row.introducerId!)
    } catch (e) {
      fail(e)
    }
  }

  async function add() {
    if (!run || !ticked.size) return
    setBusy(true)
    try {
      const r = await x.addFromLookup(run._id, [...ticked])
      play('save')
      toast({ tone: 'success', icon: 'check', message: 'Added ' + r.added + ' to ' + who + '’s list' + (r.created ? ' (' + r.created + ' new to Investors, Not contacted)' : '') + '.' })
      setTicked(new Set())
    } catch (e) {
      fail(e)
    }
    setBusy(false)
  }

  const head = <h3 className="intro-panel__how eyebrow-mono">Find their investors</h3>
  if (!row.company?.trim())
    return (
      <div className="net-lookup">
        {head}
        <p className="intro-panel__howtext">Add {who}’s company, and Nest finds who backed it.</p>
        <Button size="sm" variant="secondary" onClick={onEdit}>
          Add their company
        </Button>
      </div>
    )
  if (st === undefined) return <div className="net-lookup">{head}<SkeletonRows rows={2} action={false} /></div>
  if (!st.connected && !run)
    return (
      <div className="net-lookup">
        {head}
        <p className="intro-panel__howtext">AI isn’t set up here, so Nest can’t search. Add who backed {row.company} with Who do they know.</p>
      </div>
    )
  if (!run || run.status === 'failed')
    return (
      <div className="net-lookup">
        {head}
        <p className="intro-panel__howtext">
          Nest searches the web for who backed {row.company} (up to {LOOKUP_MAX}), and you pick who goes on {who}’s list. About {cents(st.estimateUsd)} with Haiku; only the company name and website leave Nest.
        </p>
        {run?.status === 'failed' ? <p className="net-lookup__error" role="alert">{run.error || 'The search failed.'} {run.costUsd ? 'It cost ' + cents(run.costUsd) + '.' : ''}</p> : null}
        <Button size="sm" variant="secondary" icon="spark" onClick={() => void start()}>
          {run?.status === 'failed' ? 'Try again' : 'Find their investors'}
        </Button>
      </div>
    )
  if (run.status === 'running')
    return (
      <div className="net-lookup" aria-busy="true">
        {head}
        <p className="intro-panel__howtext">Searching for who backed {run.company}…</p>
        <SkeletonRows rows={3} action={false} />
      </div>
    )
  const open = run.results.flatMap((r, k) => (r.added ? [] : [k]))
  return (
    <div className="net-lookup">
      {head}
      <p className="intro-panel__howtext">
        {run.results.length ? run.results.length + ' who backed ' + run.company + '. Tick the ones ' + who + ' could introduce.' : 'Nest found nobody who backed ' + run.company + '.'} Cost {cents(run.costUsd)}.
      </p>
      {run.results.length ? (
        <ul className="net-results">
          {run.results.map((r, k) => (
            <li key={k} className={r.added ? 'is-added' : undefined}>
              <Checkbox
                label={
                  <span className="net-results__text">
                    <strong>{r.firm}</strong>
                    {r.partner ? <span> · {r.partner}</span> : null}
                    <small>
                      {[roundLine(r), new URL(r.url).hostname.replace(/^www\./, '')].filter(Boolean).join(' · ')}{' '}
                      <a href={r.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        Source
                      </a>
                    </small>
                  </span>
                }
                checked={r.added || ticked.has(k)}
                disabled={r.added}
                onChange={(e) => {
                  const on = e.currentTarget.checked
                  setTicked((s) => {
                    const n = new Set(s)
                    if (on) n.add(k)
                    else n.delete(k)
                    return n
                  })
                }}
              />
              {r.added ? (
                <Chip tone="success" dot={false}>Added</Chip>
              ) : r.investorId ? (
                <Chip tone="outline" dot={false}>In Nest</Chip>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="net-lookup__foot">
        {open.length ? (
          <Button size="sm" variant="primary" onClick={() => void add()} loading={busy} disabled={!ticked.size}>
            {ticked.size ? 'Add ' + ticked.size + ' to ' + who + '’s list' : 'Tick who to add'}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => void start()}>
          Search again
        </Button>
      </div>
    </div>
  )
}

/** The panel's order: something to do first, then intros under way, then done. */
function rank(x: Intro, inv: Investor | undefined, today: string) {
  const k = introNext(x, inv, '', today).kind
  return k === 'thank' || k === 'report' ? 0 : k === 'nudge' || k === 'send' ? 1 : k === 'done' ? 3 : 2
}
