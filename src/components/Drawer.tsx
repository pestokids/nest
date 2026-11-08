// The investor drawer: a side drawer on desktop, a bottom sheet on phones.
// States: view (Details / History / Emails), edit, new, advance stage, log a touch,
// park, and the in-drawer delete confirm. Data logic: useRaise(), the form
// helpers below, and activities.forInvestor (d.useLog).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { parseMoney } from '../lib/csv'
import { dayDiff, shortDate, todayIST } from '../lib/dates'
import {
  addressesOf, agoShort, dayOf, dedupeMeetings, GENERIC_DOMAINS, gmailSearchLink, isWaiting, makeMatcher, nameFromEmail, normDomain, normEmail, splitList, timeOf,
  type SyncedThread,
} from '../lib/google'
import { dayMonth, monDay } from '../lib/home'
import { confetti, replay, shake, shine } from '../lib/motion'
import { money } from '../lib/money'
import { fieldsOf, isBackward, NEW_INVESTOR, quietList, type Activity, type Investor, type InvestorFields } from '../lib/pipeline'
import { changedFields, fieldCopy, keepUntouched } from '../lib/investorForm' // PST-303
import { play } from '../lib/sound'
import {
  advanceConfirm, ALL, GEOS, IDX, LABEL, nextStage, STAGE_RULE, STAGE_SHORT, STAGE_TILE, STAGES, TIERS, TOUCH_LABEL, TOUCH_PICK, TYPES, WARM, WAVES,
  type PipelineStage, type Stage, type TouchKind, type Wave,
} from '../lib/stages'
import { neighbour } from '../lib/listOrder'
import { KEYS, matches, singleKeyOk, type KeyName } from '../lib/shortcuts'
import { useInstant } from './system/useInstant'
import { addDays, celebrates, stageChange } from '../lib/today'
import { useRaise } from './data'
import { InvestorEnrich } from './enrich/InvestorEnrich'
import { LeadSection } from './race/LeadSection' // PST-295
import { DrawerMaterials } from './materials/DrawerMaterials'
import { openDraft } from './drafts/data'
import { confirmAction, openCloseKit } from './close/openKit'
import { DraftHistory } from './drafts/DraftHistory'
import { Egg, EggCracking, EggHatching } from './illustrations'
import { NotesTab } from './qanda/NotesTab'
import { useUI } from './raise-ui'
import { Button, buttonClass, Checkbox, Chip, Icon, Input, Segmented, Select, SubTabButtons, Textarea, Toggle, type ChipTone } from './ui'
import { Link } from '@tanstack/react-router'
import { DecisionSection, useDecisionHistory } from './decisions/DecisionSection' // PST-293
import { useDecide, useDecisions } from './decisions/data'
import { WarmPath } from './introducers/WarmPath' // PST-294
import { ApplicationSection } from './applications/ApplicationSection' // PST-302
import { StageMenu } from './pipeline/StageMenu' // PST-302

export type DrawerStart = 'view' | 'edit' | 'advance' | 'touch' | 'history' | 'emails' | 'materials' | 'notes' | 'delete' | /* PST-293 */ 'decision'
type Mode = 'view' | 'edit' | 'advance' | 'touch' | 'park' | 'delete'
type Tab = 'details' | 'history' | 'emails' | 'materials' | 'notes'

const PROGRESS = STAGES.slice(1) // Asked … Money in
const WARM_SHORT: Record<Investor['warmth'], [string, ChipTone]> = {
  existing: ['Existing', 'live'], warm: ['Warm', 'success'], intro: ['Needs intro', 'outline'], cold: ['Cold', 'muted'],
}
const STAGE_TONE = (s: Stage): ChipTone => (s === 'passed' ? 'error' : s === 'parked' ? 'muted' : 'neutral')
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

/* ---------- form helpers ---------- */

/** Form state: numbers and dates as strings so inputs can be empty. */
type Form = Omit<InvestorFields, 'expected' | 'committed' | 'nextDate' | 'lastTouch' | 'email' | 'parkedUntil' | 'emails' | 'domains'> & {
  expected: string
  committed: string
  nextDate: string
  lastTouch: string
  email: string
  parkedUntil: string
  /** One per line in the form (PST-303). */
  emails: string
  domains: string
}
type FormErrors = Partial<Record<'name' | 'expected' | 'committed' | 'email' | 'emails' | 'domains', string>>

const moneyText = (n: number | undefined) => (n == null ? '' : `$${n.toLocaleString('en-US')}`)
const toForm = (v: InvestorFields): Form => ({
  ...v,
  expected: moneyText(v.expected),
  committed: moneyText(v.committed),
  nextDate: v.nextDate ?? '',
  lastTouch: v.lastTouch ?? '',
  email: v.email ?? '',
  parkedUntil: v.parkedUntil ?? '',
  emails: (v.emails ?? []).join('\n'),
  domains: (v.domains ?? []).join('\n'),
})

/** Validate and convert; errors when a field can't be read. */
function fromForm(f: Form): { body: InvestorFields; errors: FormErrors } {
  const errors: FormErrors = {}
  const amount = (k: 'expected' | 'committed') => {
    if (!f[k].trim()) return undefined
    const n = parseMoney(f[k])
    if (n === null) errors[k] = 'Numbers only, like 25000 or 25K.'
    return n ?? undefined
  }
  const name = f.name.trim()
  if (!name) errors.name = 'Add a name. Everything else can wait.'
  const email = f.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'That doesn’t look like an email address.'
  const emails = splitList(f.emails)
  const badEmail = emails.find((x) => !normEmail(x))
  if (badEmail) errors.emails = `“${badEmail}” doesn’t look like an email address.`
  const domains = splitList(f.domains)
  const badDomain = domains.find((x) => !normDomain(x))
  const generic = domains.map(normDomain).find((x) => GENERIC_DOMAINS.has(x))
  if (badDomain) errors.domains = `“${badDomain}” doesn’t look like a domain, like northstar.vc.`
  else if (generic) errors.domains = `${generic} is personal mail, so it can’t stand for a firm. Add the person’s email instead.`
  const body: InvestorFields = {
    ...f,
    name, firm: f.firm.trim(), path: f.path.trim(), nextStep: f.nextStep.trim(), notes: f.notes.trim(), source: f.source.trim(),
    expected: amount('expected'), committed: amount('committed'), nextDate: f.nextDate || undefined, lastTouch: f.lastTouch || undefined,
    email: email || undefined, parkedUntil: f.stage === 'parked' ? f.parkedUntil || undefined : undefined,
    emails: [...new Set(emails.map(normEmail))], domains: [...new Set(domains.map(normDomain))],
  }
  return { body, errors }
}

/* ---------- small hooks ---------- */

function useMedia(q: string) {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const fn = () => setOn(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [q])
  return on
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Keep Tab inside `root` (the delete confirm when it's open). */
function trapTab(e: KeyboardEvent, root: HTMLElement | null) {
  if (e.key !== 'Tab' || !root) return
  const els = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
  if (!els.length) return
  const first = els[0]
  const last = els[els.length - 1]
  if (!root.contains(document.activeElement)) {
    e.preventDefault()
    first.focus()
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

/* ---------- the drawer ---------- */

export function Drawer({ id, start = 'view', forceSheet, onClose }: { id: string | null; start?: DrawerStart; forceSheet?: boolean; onClose: () => void }) {
  const d = useRaise()
  const ui = useUI()
  const phone = useMedia('(max-width: 720px)')
  const sheet = !!forceSheet || phone
  const inv = id ? d.investors.find((i) => i._id === id) : undefined
  const isNew = !id
  const startTab: Tab = ui.opening.tab ?? (start === 'history' || start === 'emails' || start === 'materials' || start === 'notes' ? start : 'details')
  const [mode, setMode] = useState<Mode>(isNew ? 'edit' : startTab !== 'details' ? 'view' : start === 'view' && ui.opening.mode ? ui.opening.mode : start === 'decision' ? 'view' : (start as Mode))
  /** PST-290: Y opens the Verbal step, which may be more than one stage on. */
  const [advanceTo, setAdvanceTo] = useState<PipelineStage | null>(null)
  const instant = useInstant()
  const [tab, setTab] = useState<Tab>(startTab)
  const [closing, setClosing] = useState(false)
  /** A touch was just logged: History slides its newest entry in. */
  const [fresh, setFresh] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const confirmBox = useRef<HTMLDivElement>(null)
  const stageChip = useRef<HTMLSpanElement>(null)
  // PST-302: the stage chip opens a picker of every stage, backward or forward.
  const [picking, setPicking] = useState(false)
  const stageBtn = useRef<HTMLButtonElement>(null)
  const uid = useId()
  const log = d.useLog(inv ? inv._id : null)
  const decisions = useDecisions() // PST-293
  const decide = useDecide()
  const emailCount = inv ? d.google.threads.filter((t) => t.investorIds.includes(inv._id)).length : 0

  const close = useCallback(() => {
    if (closing) return
    setClosing(true)
    setTimeout(onClose, 200)
  }, [closing, onClose])

  // Deleted elsewhere (another tab, or Undo-able delete from here): close.
  const existed = useRef(!!inv)
  useEffect(() => {
    if (existed.current && !inv) onClose()
  }, [inv, onClose])

  // Focus: into the drawer on open; Tab stays inside; Esc closes (or backs out of the delete confirm).
  useEffect(() => {
    const root = box.current
    if (!root) return
    const target = root.querySelector<HTMLElement>('[data-autofocus]') ?? root
    target.focus({ preventScroll: true })
  }, [mode])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (mode === 'delete') setMode('view')
        else close()
        return
      }
      trapTab(e, mode === 'delete' ? confirmBox.current : box.current)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode, close])
  // PST-290: the drawer's keys (src/lib/shortcuts.ts), on an investor you're looking at, never while typing.
  useEffect(() => {
    if (!inv || mode !== 'view' || closing) return
    const nope = () => {
      play('nope')
      shake(stageChip.current)
    }
    const onKey = (e: KeyboardEvent) => {
      if (!singleKeyOk(e) || document.querySelector('.sys-modal')) return
      const is = (k: KeyName) => matches(e, KEYS[k])
      const next = nextStage(inv.stage)
      if (is('nextStage')) {
        if (!next) nope()
        else {
          instant.move(inv, next, { from: stageChip.current })
          requestAnimationFrame(() => shine(stageChip.current))
        }
      } else if (is('logTouch')) setMode('touch')
      else if (is('askNumber')) instant.ask(inv)
      else if (is('yes')) {
        // PST-293: Y marks the decision Yes (the Verbal step is still M, or the advance panel).
        if (decisions.decisionOf(inv._id).status === 'yes') nope()
        else decide.status(inv, 'yes')
      } else if (is('no')) {
        if (inv.stage === 'passed') nope()
        else instant.pass(inv, stageChip.current)
      } else if (is('draft')) openDraft({ investorId: inv._id })
      else if (is('prevInvestor') || is('nextInvestor')) {
        const id = neighbour(inv._id, is('nextInvestor') ? 1 : -1)
        if (id) ui.open(id, { swap: true })
        else nope()
      } else return
      e.preventDefault()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [inv, mode, closing, instant, ui, decisions, decide])

  // No page scroll behind the drawer.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Swipe down to close (sheet): drag the handle or the header.
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (!sheet || (e.target as HTMLElement).closest('button, a, input, select, textarea')) return
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    box.current?.classList.add('is-dragging')
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !box.current) return
    drag.current.dy = Math.max(0, e.clientY - drag.current.y)
    box.current.style.transform = `translateY(${drag.current.dy}px)`
  }
  const onPointerUp = () => {
    const g = drag.current
    drag.current = null
    const el = box.current
    if (!g || !el) return
    el.classList.remove('is-dragging')
    const v = g.dy / Math.max(1, performance.now() - g.t)
    if (g.dy > 110 || (g.dy > 30 && v > 0.6)) {
      el.style.transform = ''
      close()
    } else el.style.transform = ''
  }

  // Celebrations: shine the new stage chip.
  const shineStage = () => requestAnimationFrame(() => shine(stageChip.current))

  const title = inv ? inv.name : 'New investor'
  const headerBusy = mode === 'edit' || mode === 'park'
  return (
    <>
      <div className={`scrim${closing ? ' scrim--leaving' : ''}${ui.opening.swap ? ' scrim--swap' : ''}`} onClick={close} aria-hidden="true" />
      <div
        ref={box}
        className={['drawer', sheet ? 'drawer--sheet' : 'drawer--side', closing ? 'drawer--leaving' : '', mode === 'delete' ? 'drawer--confirming' : '', ui.opening.swap && !closing ? 'drawer--swap' : ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        aria-keyshortcuts="M L A Y N D ArrowLeft ArrowRight Escape"
        tabIndex={-1}
      >
        <div className="drawer__top" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {sheet ? <div className="drawer__handle" aria-hidden="true" /> : null}
          <header className="drawer__head">
            <div className="drawer__eyebrow eyebrow-mono">{inv ? `Investor · ${inv.type}` : 'Add to the nest'}</div>
            <div className="drawer__tools">
              {inv && !sheet ? <MoreMenu inv={inv} onPick={(m) => (m === 'pass' ? pass(inv) : setMode(m))} /> : null}
              <button type="button" className="drawer__icon" aria-label="Close" onClick={close}>
                <Icon name="close" size={22} />
              </button>
            </div>
            <h2 id={`${uid}-title`} className="drawer__title">
              {title}
            </h2>
            {inv ? (
              <>
                {inv.firm || inv.email ? (
                  <p className="drawer__sub">
                    {[inv.firm, !sheet ? inv.email : ''].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
                <div className="drawer__chips">
                  <button ref={stageBtn} type="button" className="drawer__stagebtn" aria-haspopup="menu" aria-expanded={picking} aria-label={`Stage: ${STAGE_TILE[inv.stage]}. Move to another stage`} onClick={() => setPicking((x) => !x)}>
                    <Chip ref={stageChip} tone={STAGE_TONE(inv.stage)} dot={false}>
                      {STAGE_TILE[inv.stage]}
                      <Icon name="chevron-down" size={14} className="drawer__stagecaret" />
                    </Chip>
                  </button>
                  <Chip tone="outline" dot={false}>
                    Wave {inv.wave}
                  </Chip>
                  <Chip tone={WARM_SHORT[inv.warmth][1]} dot={inv.warmth === 'warm' || inv.warmth === 'existing'}>
                    {WARM_SHORT[inv.warmth][0]}
                  </Chip>
                  {inv.stage === 'parked' && inv.parkedUntil ? <Chip tone="muted" dot={false}>Until {dayMonth(inv.parkedUntil)}</Chip> : null}
                </div>
                {picking ? (
                  <StageMenu
                    inv={inv}
                    anchor={stageBtn.current}
                    onClose={() => setPicking(false)}
                    onPick={(to) => {
                      instant.move(inv, to, { from: stageChip.current })
                      requestAnimationFrame(() => shine(stageChip.current))
                    }}
                  />
                ) : null}
                <HeadActions inv={inv} sheet={sheet} busy={headerBusy} mode={mode} onAdvance={() => { setAdvanceTo(null); setMode('advance') }} onTouch={() => setMode('touch')} onReopen={() => void reopen(inv)} />
                <StageProgress inv={inv} labels={!sheet} />
              </>
            ) : (
              <p className="drawer__sub">Only the name is required. Everything else can wait.</p>
            )}
          </header>
        </div>
        {inv ? (
          <SubTabButtons
            label="Investor"
            idPrefix={uid}
            value={tab}
            onChange={(t) => {
              setTab(t)
              setFresh(false)
              if (mode !== 'view' && mode !== 'delete') setMode('view')
            }}
            items={[
              { value: 'details', label: 'Details' },
              { value: 'history', label: 'History' },
              ...(d.google.team.length || emailCount
                ? [{ value: 'emails' as const, label: emailCount ? <>Emails <span className="tab-count">{emailCount}</span></> : 'Emails' }]
                : []),
              { value: 'materials', label: 'Materials' },
              { value: 'notes', label: 'Notes' },
            ]}
          />
        ) : null}
        <div className="drawer__body" id={`${uid}-panel`} role={inv ? 'tabpanel' : undefined} aria-labelledby={inv ? `${uid}-tab-${tab}` : undefined}>
          {isNew ? (
            <EditForm inv={null} onDone={close} />
          ) : !inv ? null : mode === 'edit' ? (
            <EditForm inv={inv} onDone={() => setMode('view')} onCelebrate={shineStage} />
          ) : mode === 'advance' ? (
            <AdvancePanel inv={inv} to={advanceTo ?? undefined} onDone={() => { setMode('view'); shineStage() }} onPass={() => pass(inv)} onPark={() => setMode('park')} />
          ) : mode === 'touch' ? (
            <TouchPanel inv={inv} kind={ui.opening.touch} onDone={() => { setMode('view'); setTab('history'); setFresh(true) }} />
          ) : mode === 'park' ? (
            <ParkPanel inv={inv} onDone={() => setMode('view')} />
          ) : tab === 'history' ? (
            <>
              <DraftHistory investorId={inv._id} />
              <History inv={inv} log={log} fresh={fresh} />
            </>
          ) : tab === 'emails' ? (
            <Emails inv={inv} onEdit={() => setMode('edit')} />
          ) : tab === 'materials' ? (
            <DrawerMaterials inv={inv} />
          ) : tab === 'notes' ? (
            <NotesTab inv={inv} />
          ) : (
            <Details inv={inv} log={log} sheet={sheet} onDelete={() => setMode('delete')} onEdit={() => setMode('edit')} />
          )}
        </div>
        <Footer mode={isNew ? 'new' : mode} advanceTo={advanceTo} sheet={sheet} onCancel={isNew ? close : () => setMode('view')} onDelete={() => setMode('delete')} onEdit={() => setMode('edit')} inv={inv} />
        {inv && mode === 'delete' ? (
          <DeleteConfirm
            boxRef={confirmBox}
            inv={inv}
            onCancel={() => setMode('view')}
            onPass={() => pass(inv)}
            onDelete={() => {
              ui.remove(inv)
              onClose()
            }}
          />
        ) : null}
      </div>
    </>
  )

  /** PST-290: shows at once, with Undo. */
  function pass(i: Investor) {
    setMode('view')
    instant.pass(i, stageChip.current)
  }
  async function reopen(i: Investor) {
    const back: Stage = i.maxStage && i.maxStage !== 'todo' ? i.maxStage : 'ask'
    try {
      await d.save(i._id, { ...fieldsOf(i), stage: back })
      ui.toast(`${i.name} is back in ${STAGE_TILE[back]}.`)
    } catch (e) {
      ui.fail(e)
    }
  }
}

/* ---------- header pieces ---------- */

function HeadActions({ inv, sheet, busy, mode, onAdvance, onTouch, onReopen }: { inv: Investor; sheet: boolean; busy: boolean; mode: Mode; onAdvance: () => void; onTouch: () => void; onReopen: () => void }) {
  const next = nextStage(inv.stage)
  const closed = inv.stage === 'passed' || inv.stage === 'parked'
  return (
    <div className="drawer__actions">
      {next ? (
        <Button variant="primary" onClick={onAdvance} disabled={busy} aria-pressed={mode === 'advance' || undefined}>
          Move to {STAGE_TILE[next]}
        </Button>
      ) : closed ? (
        <Button variant="primary" onClick={onReopen} disabled={busy}>
          Reopen
        </Button>
      ) : null}
      <Button variant="secondary" onClick={onTouch} disabled={busy} aria-pressed={mode === 'touch' || undefined} className="drawer__log">
        {sheet ? 'Log' : 'Log a touch'}
      </Button>
      <Button variant="secondary" icon="spark" onClick={() => openDraft({ investorId: inv._id })} disabled={busy} className="drawer__draft">
        Draft
      </Button>
      {inv.stage === 'verbal' || inv.stage === 'signed' ? (
        <Button variant="secondary" onClick={() => openCloseKit(inv._id)} disabled={busy} className="drawer__kit">
          Close kit
        </Button>
      ) : null}
    </div>
  )
}

function StageProgress({ inv, labels }: { inv: Investor; labels: boolean }) {
  const cur = IDX[inv.stage] ?? -1
  const reached = Math.max(cur, IDX[inv.maxStage] ?? -1)
  const closed = cur < 0
  return (
    <ol className={`stageprog${labels ? '' : ' stageprog--bare'}${closed ? ' stageprog--closed' : ''}`} aria-label={`Stage: ${STAGE_TILE[inv.stage]}`}>
      {PROGRESS.map((s) => {
        const ix = IDX[s.k]!
        const state = closed ? (ix <= reached ? 'was' : 'todo') : ix < cur ? 'done' : ix === cur ? 'now' : 'todo'
        return (
          <li key={s.k} className={`stageprog__seg stageprog__seg--${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="stageprog__bar" />
            {labels ? <span className="stageprog__label">{STAGE_SHORT[s.k]}</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

function MoreMenu({ inv, onPick }: { inv: Investor; onPick: (m: 'park' | 'delete' | 'pass') => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', off)
    return () => document.removeEventListener('pointerdown', off)
  }, [open])
  const pick = (m: 'park' | 'delete' | 'pass') => {
    setOpen(false)
    onPick(m)
  }
  return (
    <div className="drawer__more" ref={ref}>
      <button type="button" className="drawer__icon" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <Icon name="more" size={22} />
      </button>
      {open ? (
        <div className="drawer__menu" role="menu">
          {inv.stage !== 'passed' ? (
            <button type="button" role="menuitem" className="drawer__menu-item" onClick={() => pick('pass')}>
              Mark as passed
            </button>
          ) : null}
          <button type="button" role="menuitem" className="drawer__menu-item" onClick={() => pick('park')}>
            {inv.stage === 'parked' ? 'Change the park date' : 'Park until a date'}
          </button>
          <button type="button" role="menuitem" className="drawer__menu-item drawer__menu-item--danger" onClick={() => pick('delete')}>
            Delete investor
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Footer({ mode, advanceTo, sheet, inv, onCancel, onDelete, onEdit }: { mode: Mode | 'new'; advanceTo: PipelineStage | null; sheet: boolean; inv?: Investor; onCancel: () => void; onDelete: () => void; onEdit: () => void }) {
  if (mode === 'view' || mode === 'delete') {
    if (sheet || !inv) return null
    return (
      <footer className="drawer__foot">
        <button type="button" className="drawer__textbtn drawer__textbtn--danger" onClick={onDelete}>
          Delete investor
        </button>
        <button type="button" className="drawer__textbtn" onClick={onEdit}>
          Edit details
        </button>
      </footer>
    )
  }
  const submit = { new: 'Add to the nest', edit: 'Save changes', advance: inv ? `Move to ${STAGE_TILE[advanceTo ?? nextStage(inv.stage) ?? inv.stage]}` : 'Move', touch: 'Log touch', park: 'Park' }[mode]
  return (
    <footer className="drawer__foot drawer__foot--form">
      <button type="button" className="drawer__textbtn" onClick={onCancel}>
        Cancel
      </button>
      <Button variant="primary" type="submit" form="drawer-form">
        {submit}
      </Button>
    </footer>
  )
}

/* ---------- details and history ---------- */

const relDay = (iso: string, today: string) => {
  const n = dayDiff(today, iso)
  return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : `${n} days ago`
}
const waveLabel = (w: Wave, labels: string[]) => {
  const l = labels[w - 1]?.trim()
  return l && l.toLowerCase() !== `wave ${w}` ? `Wave ${w} · ${l}` : `Wave ${w}`
}

function Details({ inv, log, sheet, onDelete, onEdit }: { inv: Investor; log: Activity[] | undefined; sheet: boolean; onDelete: () => void; onEdit: () => void }) {
  const { round } = useRaise()
  const today = todayIST()
  const lastKind = log?.find((a) => a.kind === 'note' && a.date === inv.lastTouch && a.touch && TOUCH_PICK.includes(a.touch as (typeof TOUCH_PICK)[number]))?.touch
  const late = !!inv.nextDate && inv.nextDate < today && inv.stage !== 'passed' && inv.stage !== 'parked' && inv.stage !== 'wired'
  const rows: [string, ReactNode][] = sheet
    ? [
        ['Expected', inv.expected ? money(inv.expected) : '–'],
        ['Warm path', inv.path || '–'],
        ['Next step', inv.nextStep ? `${inv.nextStep}${inv.nextDate ? ` · ${dayMonth(inv.nextDate).replace(/ \w+$/, '')}` : ''}` : '–'],
        ['Last touch', inv.lastTouch ? `${relDay(inv.lastTouch, today)}${lastKind ? ` · ${TOUCH_LABEL[lastKind].toLowerCase()}` : ''}` : 'Never'],
      ]
    : [
        ['Expected amount', inv.expected ? money(inv.expected) : '–'],
        ['Warm path', inv.path || '–'],
        ['Next step', inv.nextStep || '–'],
        ['Due', inv.nextDate ? <span className={late ? 'is-late' : undefined}>{dayMonth(inv.nextDate)}{late ? ' · late' : ''}</span> : '–'],
        ['Last touch', inv.lastTouch ? `${relDay(inv.lastTouch, today)}${lastKind ? ` · ${TOUCH_LABEL[lastKind].toLowerCase()}` : ''}` : 'Never'],
        ['Wave', waveLabel(inv.wave, round.waves)],
      ]
  if (inv.committed) rows.splice(1, 0, ['Committed', money(inv.committed)])
  return (
    <div className="details">
      {/* PST-302: the application, apart from the stage */}
      <ApplicationSection inv={inv} />
      {/* PST-293 */}
      <DecisionSection inv={inv} />
      {/* PST-295: The lead */}
      <LeadSection inv={inv} />
      <WarmPath inv={inv} /> {/* PST-294 */}
      <InvestorEnrich inv={inv} sheet={sheet} />
      <dl className="details__rows">
        {rows.map(([k, v]) => (
          <div className="details__row" key={k} data-field={k.startsWith('Expected') ? 'expected' : undefined}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="details__notes">
        <h3 className="details__label">Notes</h3>
        <p className={`details__note${inv.notes ? '' : ' details__note--empty'}`}>{inv.notes || 'No notes yet.'}</p>
      </div>
      {sheet ? (
        <div className="details__sheetfoot">
          <button type="button" className="drawer__textbtn drawer__textbtn--danger" onClick={onDelete}>
            Delete investor
          </button>
          <button type="button" className="drawer__textbtn" onClick={onEdit}>
            Edit details
          </button>
        </div>
      ) : null}
    </div>
  )
}

function eventText(a: Activity): [string, string] {
  if (a.kind === 'stage') {
    const st = a.stage as Stage
    // PST-302: from → to, as one move ("Intro asked → Not contacted").
    if (a.fromStage) {
      const sub = a.correction ? 'Marked as a correction.' : isBackward(a.fromStage, st) ? 'Moved back.' : (STAGE_RULE[st as PipelineStage] ?? (st === 'passed' ? 'Not this round.' : st === 'parked' ? 'On hold for now.' : ''))
      return [`${LABEL[a.fromStage]} → ${LABEL[st] ?? st}`, sub]
    }
    return [`Moved to ${STAGE_TILE[st] ?? st}`, STAGE_RULE[st as PipelineStage] ?? (st === 'passed' ? 'Not this round.' : st === 'parked' ? 'On hold for now.' : '')]
  }
  if (a.touch) return [TOUCH_LABEL[a.touch], a.note ?? '']
  return ['Note', a.note ?? '']
}

const SOURCE_LABEL = { calendar: 'From Calendar', gmail: 'From Gmail', /* PST-293: a status Nest set from a signal */ auto: 'Auto' } as const

function History({ inv, log, fresh }: { inv: Investor; log: Activity[] | undefined; fresh: boolean }) {
  const today = todayIST()
  const { google } = useRaise()
  const decisions = useDecisionHistory(inv._id) // PST-293
  if (log === undefined) return <div className="history history--loading" aria-busy="true" />
  type Item = { key: string; date: string; title: string; sub: string; by?: string; from?: keyof typeof SOURCE_LABEL; at?: number; /* PST-302 */ fix?: Activity }
  // PST-302: the newest move, when it went back and they're still there, can be marked as a correction.
  const newest = log.find((a) => a.kind === 'stage')
  const fixable = newest && newest.stage === inv.stage && isBackward(newest.fromStage, inv.stage) ? newest : undefined
  const items: Item[] = log.map((a) => {
    const [t, sub] = eventText(a)
    const by = a.kind === 'stage' && a.via ? (a.via === 'agent' ? 'Agent suggestion' : 'Signal') : a.by
    return { key: a._id, date: a.date, title: t, sub, by, from: a.source, at: a._creationTime, fix: a === fixable ? a : undefined }
  })
  // Meetings from Calendar (either founder's), newest first among the log by day.
  const now = Date.now()
  for (const m of dedupeMeetings(google.meetings.filter((x) => x.investorIds.includes(inv._id))))
    items.push({ key: 'm-' + m._id, date: dayOf(m.start), at: m.start, title: m.start > now ? 'Meeting booked' : 'Meeting', sub: `${m.title} · ${timeOf(m.start)}`, by: m.by, from: 'calendar' })
  // PST-293: status changes (Nest's own marked Auto).
  for (const x of decisions) items.push({ key: x.key, date: todayIST(x.at), at: x.at, title: x.title, sub: x.sub, by: x.by, from: x.auto ? 'auto' : undefined })
  items.sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? 0) - (a.at ?? 0))
  if (inv._creationTime)
    items.push({ key: 'added', date: todayIST(inv._creationTime), title: 'Added to the nest', sub: inv.source || '', by: undefined })
  if (!items.length)
    return (
      <div className="drawer-empty">
        <Egg size={40} />
        <p>Nothing logged yet. Moves and touches land here.</p>
      </div>
    )
  return (
    <ol className="history">
      {items.map((x, n) => (
        <li key={x.key} className={`history__item${n === 0 && fresh ? ' history__item--new' : ''}${x.key === 'added' ? ' history__item--first' : ''}`}>
          <span className="history__dot" aria-hidden="true" />
          <span className="history__date eyebrow-mono">
            {x.date === today ? 'Today' : x.date === addDays(today, -1) ? 'Yesterday' : monDay(x.date)}
            {x.by ? <span className="history__by"> · {x.by}</span> : null}
          </span>
          <span className="history__title">
            {x.title}
            {x.from ? <span className="history__src">{SOURCE_LABEL[x.from]}</span> : null}
          </span>
          {x.sub ? <span className="history__sub">{x.sub}</span> : null}
          {x.fix ? <CorrectionToggle act={x.fix} /> : null}
        </li>
      ))}
    </ol>
  )
}

/** PST-302: "Mark as a correction" on the newest move back, or take the mark off. */
function CorrectionToggle({ act }: { act: Activity }) {
  const d = useRaise()
  const ui = useUI()
  const on = !!act.correction
  const toggle = () => {
    play(on ? 'undo' : 'rule-check', { volume: 0.7 })
    d.markCorrection(act._id, !on).then(() => ui.toast({ tone: 'info', message: on ? 'Not a correction any more.' : 'Marked as a correction. It’s left out of the funnel and conversion numbers.' }), ui.fail)
  }
  return (
    <button type="button" className="drawer__link history__fix" onClick={toggle}>
      {on ? 'Not a correction' : 'Mark as a correction'}
    </button>
  )
}

/* ---------- emails (PST-263) ---------- */

/** "2h ago" today-ish, else "Nov 4". */
const emailWhen = (ms: number, now: number) => (now - ms < 24 * 36e5 ? agoShort(ms, now) : shortDate(dayOf(ms)))

/** Who sent the last message, by name: "You", a teammate, or the person at the investor. */
function lastSender(t: SyncedThread, inv: Investor, myEmail: string | undefined) {
  if (t.lastFrom === 'us') return myEmail && t.lastFromEmail === myEmail ? 'You' : nameFromEmail(t.lastFromEmail) || t.by
  return t.lastFromEmail === normEmail(inv.email) ? firstName(inv.name) : nameFromEmail(t.lastFromEmail)
}

/** The Emails tab (screens/drawer/emails.png): recent threads, who wrote last, Open in Gmail. Headers only, never bodies. */
function Emails({ inv, onEdit }: { inv: Investor; onEdit: () => void }) {
  const { google } = useRaise()
  const now = Date.now()
  const mine = google.me?.email
  const threads = google.threads.filter((t) => t.investorIds.includes(inv._id)).sort((a, b) => b.lastAt - a.lastAt)
  const addrs = addressesOf(inv)
  const how = makeMatcher([{ _id: inv._id, email: inv.email, emails: inv.emails, domains: inv.domains }])
  const on = [...new Set(threads.map((t) => how.people(t.participants).how[inv._id]?.on).filter(Boolean))]
  if (!google.team.length)
    return (
      <div className="drawer-empty">
        <Egg size={40} />
        <p>Connect Google in Settings and emails with {firstName(inv.name)} show up here by themselves.</p>
        <Link to="/raise/settings" className={buttonClass({ variant: 'secondary' })}>
          Go to Settings
        </Link>
      </div>
    )
  if (!threads.length)
    return (
      <div className="drawer-empty">
        <Egg size={40} />
        <p>
          No emails with {firstName(inv.name)} in the last 30 days.
          {!addrs.emails.length && !addrs.domains.length ? ' Add their email or firm domain so Nest can match them.' : ''}
        </p>
        {!addrs.emails.length && !addrs.domains.length ? (
          <Button variant="secondary" onClick={onEdit}>
            Add an email
          </Button>
        ) : null}
      </div>
    )
  return (
    <div className="emails">
      <p className="emails__eyebrow eyebrow-mono">From Gmail{on.length ? ` · matched by ${on.slice(0, 2).join(', ')}` : ''}</p>
      <ul className="emails__list">
        {threads.map((t) => {
          const waiting = isWaiting(t, now)
          const body = (
            <>
              <span className="email-card__top">
                <Icon name="mail" size={18} className="email-card__icon" />
                <span className="email-card__subject">{t.subject}</span>
                <span className="email-card__when">{emailWhen(t.lastAt, now)}</span>
              </span>
              <span className="email-card__who">
                {lastSender(t, inv, mine)} wrote last{t.count > 1 ? ` · ${t.count} messages` : ''}
                {t.mine ? '' : ` · in ${t.by}’s inbox`}
              </span>
              {waiting ? <span className="email-card__flag">Waiting on you</span> : null}
            </>
          )
          return (
            <li key={t._id}>
              {t.mine ? (
                <a className={`email-card${waiting ? ' email-card--waiting' : ''}`} href={t.link} target="_blank" rel="noreferrer" aria-label={`${t.subject}, open in Gmail`}>
                  {body}
                </a>
              ) : (
                <div className={`email-card${waiting ? ' email-card--waiting' : ''}`}>{body}</div>
              )}
            </li>
          )
        })}
      </ul>
      {mine ? (
        <a className={buttonClass({ variant: 'secondary', className: 'emails__all' })} href={gmailSearchLink(mine, addrs)} target="_blank" rel="noreferrer">
          Open all in Gmail
        </a>
      ) : null}
    </div>
  )
}

/* ---------- edit / new ---------- */

export function EditForm({ inv, onDone, onCelebrate }: { inv: Investor | null; onDone: () => void; onCelebrate?: () => void }) {
  const d = useRaise()
  const ui = useUI()
  // "New" from a Pipeline column's + starts in that column's stage.
  const [blank] = useState<Form>(() =>
    toForm({ ...NEW_INVESTOR, stage: ui.opening.stage ?? NEW_INVESTOR.stage, name: ui.opening.name?.trim() ?? NEW_INVESTOR.name, email: ui.opening.email ?? NEW_INVESTOR.email }),
  )
  // PST-303: only what Dev changed is kept here. Every other field shows the investor as it is now,
  // so a type set elsewhere while the form is open (enrichment, a suggestion, Jev) shows, and Save keeps it.
  const [edits, setEdits] = useState<Partial<Form>>({})
  const form: Form = { ...(inv ? toForm(fieldsOf(inv)) : blank), ...edits }
  const copy = fieldCopy(form.type)
  const [errors, setErrors] = useState<FormErrors>({})
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setEdits((f) => ({ ...f, [k]: v }))
    if (k in errors) setErrors((e) => ({ ...e, [k]: undefined }))
  }
  const text = (k: 'name' | 'firm' | 'path' | 'nextStep' | 'source' | 'email' | 'expected' | 'committed' | 'emails' | 'domains') => ({
    value: form[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value),
    error: k in errors ? errors[k as keyof FormErrors] : undefined,
  })

  async function submit(e: FormEvent) {
    e.preventDefault()
    const { body: parsed, errors: errs } = fromForm(form)
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs)
      play('nope')
      const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      shake(first?.closest('.field'))
      first?.focus()
      return
    }
    // PST-303: Save never changes a field Dev didn't touch.
    const body = inv ? keepUntouched(fieldsOf(inv), parsed, Object.keys(edits)) : parsed
    if (inv && !changedFields(fieldsOf(inv), body).length) return onDone()
    setBusy(true)
    try {
      await d.save(inv ? inv._id : null, body)
      if (!inv) ui.toast(`Added ${body.name} to the nest.`)
      else if (body.stage !== inv.stage) {
        const how = stageChange(inv.stage, body.stage)
        if (celebrates(inv.stage, body.stage)) {
          hatchSounds()
          ui.toast({ tone: 'hatch', message: `${body.name} moved to ${STAGE_TILE[body.stage]}.`, ...(body.stage === 'verbal' ? { action: confirmAction(inv._id) } : {}) })
          onCelebrate?.()
        } else {
          if (body.stage === 'parked') play('park')
          ui.toast(how === 'closed' ? `${body.name} is ${STAGE_TILE[body.stage].toLowerCase()}.` : `${body.name} moved to ${STAGE_TILE[body.stage]}.`)
        }
      } else ui.toast('Saved.')
      onDone()
    } catch (err) {
      ui.fail(err)
    } finally {
      setBusy(false)
    }
  }

  const field = {
    name: <Input label={inv ? copy.name.label : `${copy.name.label} *`} placeholder={copy.name.placeholder} help={copy.name.help} required data-autofocus {...text('name')} />,
    firm: <Input label={copy.firm.label} placeholder={copy.firm.placeholder} {...text('firm')} />,
    email: <Input label={copy.email.label} type="email" inputMode="email" placeholder={copy.email.placeholder} help={copy.email.help} {...text('email')} />,
    type: (
      <Select label="Type" value={form.type} onChange={(e) => set('type', e.target.value as Form['type'])}>
        {TYPES.map((x) => <option key={x} value={x}>{x}</option>)}
      </Select>
    ),
    expected: <Input label="Expected amount" inputMode="decimal" placeholder="e.g. 25K" {...text('expected')} />,
    wave: (
      <Select label="Wave" value={String(form.wave)} onChange={(e) => set('wave', Number(e.target.value) as Wave)}>
        {WAVES.map((w) => <option key={w} value={w}>{waveLabel(w, d.round.waves)}</option>)}
      </Select>
    ),
    stage: (
      <Select label="Stage" value={form.stage} onChange={(e) => set('stage', e.target.value as Form['stage'])}>
        {ALL.map((s) => <option key={s.k} value={s.k}>{STAGE_TILE[s.k]}</option>)}
      </Select>
    ),
  }
  return (
    <form id="drawer-form" ref={formRef} className="dform" autoComplete="off" noValidate onSubmit={submit} aria-busy={busy || undefined}>
      {inv ? (
        <>
          <div className="dform__row">{field.name}{field.firm}</div>
          <div className="dform__row">{field.email}{field.type}</div>
          <div className="dform__row">{field.expected}{field.wave}</div>
          <Input label={copy.path.label} placeholder={copy.path.placeholder} help={copy.path.help} {...text('path')} />
          <div className="dform__row dform__row--wide">
            <Input label="Next step" placeholder="What happens next, in one line" {...text('nextStep')} />
            <Input label="Due" type="date" value={form.nextDate} onChange={(e) => set('nextDate', e.target.value)} />
          </div>
          <Textarea label="Notes" rows={4} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          <details className="dform__more" open={form.stage !== inv.stage || !!errors.emails || !!errors.domains || undefined}>
            <summary>More details</summary>
            <div className="dform__row">
              {field.stage}
              <Select label="Relationship" value={form.warmth} onChange={(e) => set('warmth', e.target.value as Form['warmth'])}>
                {Object.entries(WARM).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </div>
            {form.stage === 'parked' ? <Input label="Park until" type="date" value={form.parkedUntil} onChange={(e) => set('parkedUntil', e.target.value)} help="They come back to Due today on this day." /> : null}
            <div className="dform__row">
              <Select label="Tier" value={form.tier} onChange={(e) => set('tier', e.target.value as Form['tier'])}>
                {TIERS.map((x) => <option key={x}>{x}</option>)}
              </Select>
              <Select label="Geography" value={form.geo} onChange={(e) => set('geo', e.target.value as Form['geo'])}>
                {GEOS.map((x) => <option key={x}>{x}</option>)}
              </Select>
            </div>
            <div className="dform__row">
              <Input label="Committed" inputMode="decimal" placeholder="Once they say a number" {...text('committed')} />
              <Input label="Last touch" type="date" value={form.lastTouch} onChange={(e) => set('lastTouch', e.target.value)} />
            </div>
            <div className="dform__row">
              <Textarea label={copy.emails.label} rows={3} inputMode="email" placeholder={copy.emails.placeholder} help={copy.emails.help} {...text('emails')} />
              <Textarea label={copy.domains.label} rows={3} placeholder={copy.domains.placeholder} help={copy.domains.help} {...text('domains')} />
            </div>
            <Input label="Source" {...text('source')} />
            <Checkbox label="Can lead or anchor" checked={form.lead} onChange={(e) => set('lead', e.target.checked)} />
          </details>
        </>
      ) : (
        <>
          {field.name}
          <div className="dform__row">{field.firm}{field.type}</div>
          <div className="dform__row">{field.stage}{field.wave}</div>
          <Input label={copy.path.label} placeholder={copy.path.placeholder} help={copy.path.help} {...text('path')} />
          <div className="dform__row">{field.expected}{field.email}</div>
          <p className="drawer-tip">
            <Egg size={28} />
            <span>Tip: add the warm path now. Names without one sit in Asked and go quiet fast.</span>
          </p>
        </>
      )}
    </form>
  )
}

/** egg-crack ×2 → pesto-chirp + stage-up (interactions.png, Raise · Drawer · Advance stage). */
function hatchSounds(win = false) {
  play('egg-crack')
  play('egg-crack', { delay: 0.5 })
  play('pesto-chirp', { delay: 1 })
  if (win) {
    play('signed', { delay: 1.2 })
    play('confetti', { delay: 1.3, volume: 0.7 })
  } else play('stage-up', { delay: 1.2, volume: 0.7 })
}

/* ---------- advance stage ---------- */

function AdvancePanel({ inv, to: target, onDone, onPass, onPark }: { inv: Investor; /** PST-290: Y asks for Verbal, whatever comes next. */ to?: PipelineStage; onDone: () => void; onPass: () => void; onPark: () => void }) {
  const d = useRaise()
  const ui = useUI()
  const to = target ?? nextStage(inv.stage)
  const [ok, setOk] = useState(false)
  const [step, setStep] = useState('')
  const [by, setBy] = useState(() => addDays(todayIST(), 3))
  const [notes, setNotes] = useState('')
  const [hatch, setHatch] = useState<'idle' | 'cracking' | 'hatched'>('idle')
  const okRef = useRef<HTMLDivElement>(null)
  const eggRef = useRef<HTMLSpanElement>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  if (!to) return null
  const rule = STAGE_RULE[to] ?? ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (hatch !== 'idle' || !to) return
    if (!ok) {
      play('nope')
      shake(okRef.current)
      okRef.current?.querySelector('input')?.focus()
      return
    }
    try {
      const nextStep = step.trim() ? { step: step.trim(), date: by || undefined } : undefined
      if (to === nextStage(inv.stage)) {
        const r = await d.advance(inv._id, nextStep)
        if (!r) return onDone()
      } else await d.save(inv._id, { ...fieldsOf(inv), stage: to, ...(nextStep ? { nextStep: nextStep.step, nextDate: nextStep.date } : {}) })
      if (notes.trim()) await d.logNote(inv._id, notes.trim(), { touch: to === 'm1' || to === 'm2' ? 'meeting' : 'note' })
      const win = to === 'signed' || to === 'wired'
      hatchSounds(win)
      setHatch('cracking')
      timers.current.push(
        setTimeout(() => {
          setHatch('hatched')
          if (win) confetti(eggRef.current)
        }, 1000),
        setTimeout(() => {
          ui.toast(win ? { tone: 'win', message: `${to === 'signed' ? 'Signed!' : 'Money in!'} ${inv.name} is in.` } : { tone: 'hatch', message: `${inv.name} moved to ${STAGE_TILE[to]}.`, ...(to === 'verbal' ? { action: confirmAction(inv._id) } : {}) })
          onDone()
        }, 1900),
      )
    } catch (err) {
      ui.fail(err)
    }
  }

  return (
    <form id="drawer-form" className="dform" onSubmit={submit}>
      <div className="advance-card">
        <div>
          <p className="advance-card__eyebrow eyebrow-mono">Moving to {STAGE_TILE[to]}</p>
          <p className="advance-card__rule">The rule: {rule.charAt(0).toLowerCase() + rule.slice(1)}</p>
        </div>
        <span ref={eggRef} className={`advance-card__egg advance-card__egg--${hatch}`} aria-hidden="true">
          {hatch === 'hatched' ? <EggHatching size={56} /> : <EggCracking size={52} />}
        </span>
      </div>
      <div ref={okRef} className={`advance-ok${ok ? ' advance-ok--on' : ''}`}>
        <Checkbox checked={ok} onChange={(e) => setOk(e.target.checked)} label={advanceConfirm(to, inv.name)} data-autofocus />
      </div>
      <Input label="What’s the next step?" placeholder="e.g. Send the data room" value={step} onChange={(e) => setStep(e.target.value)} />
      <Input label="By when" type="date" className="dform__narrow" value={by} onChange={(e) => setBy(e.target.value)} />
      <Textarea label={to === 'm1' || to === 'm2' ? 'Call notes (optional)' : 'Notes (optional)'} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <p className="advance-alt">
        Not moving forward?{' '}
        <button type="button" className="drawer__link" onClick={onPass}>
          Mark as passed
        </button>
        <span aria-hidden="true"> · </span>
        <button type="button" className="drawer__link" onClick={onPark}>
          Park until a date
        </button>
      </p>
      <span className="sr-only" role="status">
        {hatch === 'hatched' ? `${inv.name} moved to ${STAGE_TILE[to]}.` : ''}
      </span>
    </form>
  )
}

/* ---------- log a touch ---------- */

function TouchPanel({ inv, kind: startKind, onDone }: { inv: Investor; kind?: TouchKind; onDone: () => void }) {
  const d = useRaise()
  const instant = useInstant()
  const today = todayIST()
  const [kind, setKind] = useState<TouchKind>(startKind ?? 'call')
  const [what, setWhat] = useState('')
  const [when, setWhen] = useState(today)
  const [setNext, setSetNext] = useState(true)
  const [step, setStep] = useState(inv.nextStep)
  const [due, setDue] = useState(inv.nextDate && inv.nextDate >= today ? inv.nextDate : addDays(today, 3))
  const whatRef = useRef<HTMLTextAreaElement>(null)
  const quiet = useMemo(() => quietList([inv], today, d.round.quietDays).length > 0, [inv, today, d.round.quietDays])
  const days = Array.from({ length: 7 }, (_, n) => addDays(today, -n))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!what.trim()) {
      play('nope')
      shake(whatRef.current?.closest('.field'))
      whatRef.current?.focus()
      return
    }
    // PST-290: shows at once, saves behind, with Undo.
    instant.logTouch(inv, what.trim(), { touch: kind, date: when, next: setNext ? { step: step.trim(), date: due || undefined } : undefined }, `${TOUCH_LABEL[kind]} logged.`)
    onDone()
  }
  return (
    <form id="drawer-form" className="dform" onSubmit={submit}>
      <div className="field">
        <span className="field__label" id="touch-kind">What kind of touch?</span>
        <Segmented label="What kind of touch?" value={kind} onChange={setKind} options={TOUCH_PICK.map((k) => ({ value: k, label: TOUCH_LABEL[k] }))} />
      </div>
      <Textarea ref={whatRef} label="What happened?" rows={4} placeholder="A line or two you’ll want next time." value={what} onChange={(e) => setWhat(e.target.value)} data-autofocus />
      <Select label="When" className="dform__narrow" value={when} onChange={(e) => setWhen(e.target.value)}>
        {days.map((x, n) => (
          <option key={x} value={x}>
            {n === 0 ? 'Today' : n === 1 ? 'Yesterday' : dayMonth(x)}
          </option>
        ))}
      </Select>
      <Toggle label="Also set the next step" checked={setNext} onChange={(e) => setSetNext(e.target.checked)} className="dform__toggle" />
      {setNext ? (
        <div className="dform__row dform__row--wide">
          <Input label="Next step" placeholder="What happens next" value={step} onChange={(e) => setStep(e.target.value)} />
          <Input label="Due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      ) : null}
      <p className="drawer-tip drawer-tip--info">
        <Icon name="clock" size={20} />
        <span>Logging a touch resets the quiet clock.{quiet ? ` ${firstName(inv.name)} drops off “Gone quiet”.` : ''}</span>
      </p>
    </form>
  )
}

/* ---------- park ---------- */

function ParkPanel({ inv, onDone }: { inv: Investor; onDone: () => void }) {
  const d = useRaise()
  const ui = useUI()
  const instant = useInstant()
  const [until, setUntil] = useState(inv.parkedUntil ?? addDays(todayIST(), 14))
  const [note, setNote] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    // PST-290: shows at once, saves behind, with Undo.
    instant.park(inv, until || null)
    if (note.trim()) d.logNote(inv._id, note.trim(), { touch: 'note' }).catch(ui.fail)
    onDone()
  }
  return (
    <form id="drawer-form" className="dform" onSubmit={submit}>
      <p className="drawer-tip">
        <EggCracking size={28} />
        <span>Parking takes {firstName(inv.name)} off Today and Gone quiet until the day you pick.</span>
      </p>
      <Input label="Park until" type="date" className="dform__narrow" value={until} onChange={(e) => setUntil(e.target.value)} data-autofocus />
      <Textarea label="Why (optional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
    </form>
  )
}

/* ---------- delete confirm ---------- */

function DeleteConfirm({ inv, boxRef, onCancel, onPass, onDelete }: { inv: Investor; boxRef: React.RefObject<HTMLDivElement | null>; onCancel: () => void; onPass: () => void; onDelete: () => void }) {
  const egg = useRef<HTMLSpanElement>(null)
  const uid = useId()
  useLayoutEffect(() => {
    replay(egg.current, 'm-shake')
    boxRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  }, [boxRef])
  return (
    <div className="confirm-layer">
      <div ref={boxRef} className="confirm" role="alertdialog" aria-modal="true" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-b`}>
        <span ref={egg} className="confirm__egg">
          <EggCracking size={36} />
        </span>
        <div className="confirm__text">
          <h3 id={`${uid}-t`}>Delete {inv.name}?</h3>
          <p id={`${uid}-b`}>Their notes and history go with them. If it’s just a no, mark them Passed instead.</p>
        </div>
        <div className="confirm__actions">
          <button type="button" className="drawer__textbtn" onClick={onCancel} data-autofocus>
            Cancel
          </button>
          {inv.stage !== 'passed' ? (
            <Button variant="secondary" onClick={onPass}>
              Mark as passed
            </Button>
          ) : null}
          <Button variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  )
}
