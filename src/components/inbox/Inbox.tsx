// PST-297: Today's Inbox (round5/today-inbox.png, iphone-today-inbox.png): one
// list grouped Do now, Today and When you can, with filter chips, each row's
// deadline and one action. J and K move, E marks done, S snoozes until tomorrow
// 09:00 IST, D drafts and ↵ opens (the shortcut registry's keys, so the ? sheet
// lists them); E and S have Undo. On a phone, swipe right for done and left to
// snooze. When it's clear: the sleeping nest, and small confetti once a day.
import { Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { formatDay } from '../../lib/dates'
import { groupInbox, inboxChips, inboxKey, INBOX_CHIP, INBOX_TYPE_LABEL, type InboxMarkKind, type InboxRow } from '../../lib/inbox'
import { thankedLine } from '../../lib/introducers'
import { confetti, foldAway, MOMENT_MS, usePop } from '../../lib/motion'
import { play } from '../../lib/sound'
import { keyLabel, KEYS, singleKeyOk } from '../../lib/shortcuts'
import { ASK_NOTE, askFollowUp } from '../../lib/today'
import { openCloseKit } from '../close/openKit'
import { useRaise } from '../data'
import { useDecide } from '../decisions/data'
import { openDraft } from '../drafts/data'
import { NestSleeping } from '../illustrations'
import { useIntroducers } from '../introducers/data'
import { useMaterials } from '../materials/data'
import { usePreviewState } from '../preview-state'
import { useUI } from '../raise-ui'
import { Badge, Button, buttonClass, Card, Checkbox, Chip, Icon, Kbd } from '../ui'
import { INBOX_TONE, useInbox } from './data'

/** A done row's tick pops before the row folds up (interactions-batch-1.png). */
const TICK_MS = 160
/** How far a swipe has to travel to count. */
const SWIPE_PX = 96
/** The clear-inbox burst is the small one. */
const CLEAR_CONFETTI = 24
const WIN_MS = 4000

export function Inbox() {
  const inbox = useInbox()
  const run = useRowActions()
  const ui = useUI()
  const preview = usePreviewState()
  const listRef = useRef<HTMLDivElement>(null)

  // Rows folding away: done folds up after its tick pops, snooze slides off. Hidden for good once the mark is written (or back on a failure).
  const [leaving, setLeaving] = useState<ReadonlyMap<string, InboxMarkKind>>(() => new Map())
  const acted = useRef(false)
  const mark = useCallback(
    async (row: InboxRow, kind: InboxMarkKind) => {
      acted.current = true
      if (kind === 'done') play('rule-check', { volume: 0.7 })
      setLeaving((s) => new Map(s).set(row.key, kind))
      await new Promise((r) => setTimeout(r, MOMENT_MS + (kind === 'done' ? TICK_MS : 0)))
      try {
        const prev = await inbox.mark(row, kind)
        ui.toast({
          tone: 'info',
          icon: kind === 'done' ? 'check' : 'clock',
          message: kind === 'done' ? `Done: ${row.name}.` : 'Back tomorrow at 09:00.',
          action: { label: 'Undo', onClick: () => (play('undo'), void inbox.restore(row.key, prev).catch(ui.fail)) },
        })
      } catch (e) {
        ui.fail(e)
      } finally {
        setLeaving((s) => new Map([...s].filter(([k]) => k !== row.key)))
      }
    },
    [inbox, ui],
  )

  const [filter, setFilter] = useState<string | null>(null)
  const chips = useMemo(() => inboxChips(inbox.rows), [inbox.rows])
  const on = filter && chips.some((c) => c.label === filter) ? filter : null
  const shown = useMemo(() => (on ? inbox.rows.filter((r) => INBOX_CHIP[r.type] === on) : inbox.rows), [inbox.rows, on])
  const groups = groupInbox(shown)
  const [current, setCurrent] = useState<string | null>(null)
  const cur = shown.find((r) => r.key === current) ?? shown[0]
  const [unfold, setUnfold] = useState(false)

  // The focus ring glides from row to row as J and K move (120ms), while focus is from the keyboard.
  const [ring, setRing] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const placeRing = useCallback(() => {
    const root = listRef.current
    const el = document.activeElement
    if (!root || !(el instanceof HTMLElement) || !el.dataset.inboxKey || !root.contains(el) || !el.matches(':focus-visible')) return setRing(null)
    const a = root.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    setRing({ x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height })
  }, [])
  useLayoutEffect(() => {
    if (ring) placeRing()
  }, [shown]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keys: J and K move the focus through the rows, E, S and D act on the focused (or current) row, ↵ opens it.
  const latest = useRef({ shown, cur, mark, run })
  useEffect(() => {
    latest.current = { shown, cur, mark, run }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!singleKeyOk(e) || document.querySelector('.sys-modal, [aria-modal="true"]')) return
      const k = inboxKey(e)
      const root = listRef.current
      if (!k || !root) return
      const els = [...root.querySelectorAll<HTMLElement>('[data-inbox-key]')].filter((x) => x.offsetParent !== null)
      if (!els.length) return
      const at = els.findIndex((x) => x.contains(document.activeElement))
      if (k === 'down' || k === 'up') {
        e.preventDefault()
        const from = at >= 0 ? at : els.findIndex((x) => x.dataset.inboxKey === latest.current.cur?.key)
        const n = from < 0 ? 0 : Math.min(els.length - 1, Math.max(0, from + (k === 'down' ? 1 : -1)))
        els[n].focus({ preventScroll: true })
        els[n].scrollIntoView({ block: 'nearest' })
        return
      }
      const { shown: rows, cur: c, mark: m, run: r } = latest.current
      const row = at >= 0 ? rows.find((x) => x.key === els[at].dataset.inboxKey) : c
      if (!row) return
      if (k === 'open') {
        if (at < 0 || document.activeElement !== els[at]) return
        e.preventDefault()
        r.open(row)
      } else if (k === 'done' || k === 'snooze') {
        e.preventDefault()
        const next = els[at + 1] ?? els[at - 1]
        void m(row, k)
        if (at >= 0) next?.focus({ preventScroll: true })
      } else if (k === 'draft') {
        e.preventDefault()
        r.draft(row)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ?preview&system=list-focus: the focus ring on the second row, as after pressing J twice.
  useEffect(() => {
    if (preview?.system !== 'list-focus') return
    const t = setTimeout(() => listRef.current?.querySelectorAll<HTMLElement>('[data-inbox-key]')[1]?.focus({ preventScroll: true }), 600)
    return () => clearTimeout(t)
  }, [preview?.system])

  // ?preview&today=win: log the ask from its row once the page has risen.
  useEffect(() => {
    if (preview?.today !== 'win') return
    const t = setTimeout(() => {
      const row = latest.current.shown.find((r) => r.action.kind === 'move' && r.action.move.kind === 'ask')
      const btn = row && listRef.current?.querySelector<HTMLElement>(`[data-inbox-key="${CSS.escape(row.key)}"] .inbox-row__go`)
      if (row) latest.current.run.primary(row, btn ?? null)
    }, 700)
    return () => clearTimeout(t)
  }, [preview?.today])

  const count = inbox.rows.length
  const countRef = usePop<HTMLSpanElement>(count)
  if (!inbox.loaded) return <Card className="inbox" aria-busy="true" />
  const later = groups.find((g) => g.group === 'later')
  const folded = !unfold && !!later && groups.length > 1

  return (
    <Card riseIndex={0} className="inbox" aria-labelledby="inbox-title">
      <header className="inbox__head">
        <h2 id="inbox-title" className="inbox__title">
          Inbox
          {count ? (
            <Badge ref={countRef} className="inbox__count" aria-label={count + ' to do'}>
              {count}
            </Badge>
          ) : null}
        </h2>
        <p className="inbox__lede">
          <span className="only-desk">Everything that needs you, in one list. Clear it and you’re done for the day.</span>
          <span className="only-phone">Swipe right when it’s done, left to snooze.</span>
        </p>
        {count && chips.length > 1 ? (
          <div className="inbox__chips only-desk" role="group" aria-label="Show">
            <button type="button" className={'chip ' + (on ? 'chip--outline' : 'chip--selected') + ' inbox__chip'} aria-pressed={!on} onClick={() => setFilter(null)}>
              All <span className="num">{count}</span>
            </button>
            {chips.map((c) => (
              <button key={c.label} type="button" className={'chip ' + (on === c.label ? 'chip--selected' : 'chip--outline') + ' inbox__chip'} aria-pressed={on === c.label} onClick={() => setFilter(on === c.label ? null : c.label)}>
                {c.label} <span className="num">{c.n}</span>
              </button>
            ))}
          </div>
        ) : null}
      </header>
      {count ? (
        <div className={'inbox__groups' + (ring ? ' has-ring' : '')} ref={listRef} onFocus={placeRing} onBlur={() => requestAnimationFrame(placeRing)}>
          {ring ? <span className="inbox__ring" aria-hidden="true" style={{ transform: `translate(${ring.x}px, ${ring.y}px)`, width: ring.w, height: ring.h }} /> : null}
          {groups.map((g) => (
            <section key={g.group} className={'inbox-group inbox-group--' + g.group + (folded && g === later ? ' is-folded' : '')} aria-labelledby={'inbox-g-' + g.group}>
              <h3 id={'inbox-g-' + g.group} className="eyebrow-mono inbox-group__title">
                {g.label}
              </h3>
              <ul className="inbox__rows">
                {g.rows.map((r, k) => (
                  <Row
                    key={r.key}
                    row={r}
                    current={r.key === cur?.key}
                    leaving={leaving.get(r.key) ?? null}
                    peek={preview?.today === 'phone' && g === groups[0] && k === 0}
                    onFocus={() => setCurrent(r.key)}
                    onMark={(kind) => void mark(r, kind)}
                    onPrimary={(el) => run.primary(r, el)}
                    onOpen={() => run.open(r)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {folded ? (
            <button type="button" className="inbox__more only-phone" onClick={() => setUnfold(true)}>
              {later.rows.length} more · When you can
            </button>
          ) : null}
        </div>
      ) : (
        <Clear acted={acted} />
      )}
      {count ? (
        <footer className="inbox__keys only-desk" aria-label="Keys">
          {(
            [
              [[KEYS.down, KEYS.up], 'move'],
              [[KEYS.done], 'done'],
              [[KEYS.snooze], 'snooze'],
              [[KEYS.open], 'open'],
              [[KEYS.draft], 'draft'],
              [[KEYS.sheet], 'all keys'],
            ] as const
          ).map(([keys, label]) => (
            <span key={label} className="inbox__key">
              {keys.map((k) => (
                <Kbd key={k}>{keyLabel(k)}</Kbd>
              ))}
              {label}
            </span>
          ))}
        </footer>
      ) : null}
    </Card>
  )
}

/* ---------- one row ---------- */

function Row({ row: r, current, leaving, peek, onFocus, onMark, onPrimary, onOpen }: {
  row: InboxRow
  current: boolean
  leaving: InboxMarkKind | null
  peek: boolean
  onFocus: () => void
  onMark: (kind: InboxMarkKind) => void
  onPrimary: (el: HTMLElement | null) => void
  onOpen: () => void
}) {
  const swipe = useSwipe(onMark, peek)
  const btn = useRef<HTMLButtonElement>(null)
  const li = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (!leaving) return
    let a: Animation | null = null
    const t = setTimeout(() => (a = foldAway(li.current, { slide: leaving === 'snooze' ? -48 : 0 })), leaving === 'done' ? TICK_MS : 0)
    return () => {
      clearTimeout(t)
      a?.cancel()
    }
  }, [leaving])
  const hot = r.late || r.group === 'now'
  return (
    <li
      ref={li}
      className={['inbox-row', current && 'is-current', leaving && 'is-leaving is-leaving--' + leaving, swipe.dx > 0 && 'is-swiping-done', swipe.dx < 0 && 'is-swiping-snooze'].filter(Boolean).join(' ')}
      data-inbox-key={r.key}
      tabIndex={0}
      aria-label={`${INBOX_TYPE_LABEL[r.type]}: ${r.name}. ${r.detail}${r.when ? '. ' + r.when : ''}`}
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault()
          onOpen()
        }
      }}
      {...swipe.handlers}
    >
      <span className="inbox-row__under inbox-row__under--done" aria-hidden="true">
        <Icon name="check" size={16} strokeWidth={2.4} /> Done
      </span>
      <span className="inbox-row__under inbox-row__under--snooze" aria-hidden="true">
        Snooze <Icon name="clock" size={16} strokeWidth={2.2} />
      </span>
      <div className="inbox-row__in" style={swipe.dx ? ({ '--dx': swipe.dx + 'px' } as CSSProperties) : undefined}>
        <Checkbox className="inbox-row__tick only-desk" checked={leaving === 'done'} onChange={() => onMark('done')} tabIndex={-1} aria-label={'Done: ' + r.name} />
        <span className="inbox-row__type">
          <Chip tone={INBOX_TONE[r.type]} dot={false} className="inbox-row__chip">
            {INBOX_TYPE_LABEL[r.type]}
          </Chip>
        </span>
        <div className="inbox-row__text" onClick={swipe.wasSwipe(onOpen)}>
          <span className="inbox-row__name">{r.name}</span>
          <span className="inbox-row__detail">{r.detail}</span>
        </div>
        {r.when ? <span className={'inbox-row__when' + (hot ? ' is-hot' : '')}>{r.when}</span> : <span className="inbox-row__when" />}
        <Button ref={btn} variant={current ? 'primary' : 'secondary'} className="inbox-row__go only-desk" tabIndex={-1} onClick={() => onPrimary(btn.current)}>
          {r.label}
        </Button>
        <button type="button" className="inbox-row__link only-phone" onClick={swipe.wasSwipe(() => onPrimary(null))}>
          {r.label} <Icon name="arrow-right" size={16} strokeWidth={2.2} />
        </button>
      </div>
    </li>
  )
}

/** A touch swipe on a row: right past SWIPE_PX marks it done, left snoozes; a tick of haptics as it arms. */
function useSwipe(onMark: (kind: InboxMarkKind) => void, peek: boolean) {
  const [dx, setDx] = useState(peek ? SWIPE_PX : 0)
  const s = useRef<{ x: number; y: number; axis?: 'x' | 'y'; armed: boolean } | null>(null)
  const moved = useRef(false)
  const end = (e: ReactPointerEvent<HTMLElement>, cancel = false) => {
    const st = s.current
    s.current = null
    if (!st || st.axis !== 'x') return
    if (!cancel && st.armed) {
      const done = dx > 0
      setDx((done ? 1 : -1) * e.currentTarget.offsetWidth)
      onMark(done ? 'done' : 'snooze')
    } else setDx(0)
  }
  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch') return
      s.current = { x: e.clientX, y: e.clientY, armed: false }
      moved.current = false
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const st = s.current
      if (!st) return
      const x = e.clientX - st.x
      const y = e.clientY - st.y
      if (!st.axis) {
        if (Math.abs(x) < 8 && Math.abs(y) < 8) return
        st.axis = Math.abs(x) > Math.abs(y) ? 'x' : 'y'
        if (st.axis === 'x') {
          e.currentTarget.setPointerCapture(e.pointerId)
          moved.current = true
          play('card-pickup', { volume: 0.4 })
        }
      }
      if (st.axis !== 'x') return
      setDx(x)
      const armed = Math.abs(x) >= SWIPE_PX
      if (armed !== st.armed) {
        st.armed = armed
        if (armed) navigator.vibrate?.(8)
      }
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => end(e),
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => end(e, true),
  }
  /** A tap that ended a swipe isn't a click. */
  const wasSwipe = (fn: () => void) => () => {
    if (moved.current) return void (moved.current = false)
    fn()
  }
  return { dx, handlers, wasSwipe }
}

/* ---------- clear ---------- */

function Clear({ acted }: { acted: React.RefObject<boolean> }) {
  const inbox = useInbox()
  const at = useRef<HTMLDivElement>(null)
  const asked = useRef<string | null>(null)
  useEffect(() => {
    if (asked.current === inbox.today) return
    asked.current = inbox.today
    inbox
      .cleared(inbox.today)
      .then((first) => {
        if (!first) return
        if (acted.current) play('target-hit')
        requestAnimationFrame(() => confetti(at.current, { count: CLEAR_CONFETTI }))
      })
      .catch(() => {})
  }, [inbox, acted])
  return (
    <div className="inbox-clear">
      <div ref={at} className="inbox-clear__nest">
        <NestSleeping size={120} />
      </div>
      <p className="inbox-clear__title">Inbox clear.</p>
      <p className="inbox-clear__text">You’re done for the day. Snoozed rows come back tomorrow at 09:00, and anything new lands here.</p>
      <Link to="/raise/pipeline" className={buttonClass({ variant: 'secondary', className: 'empty-state__action' })}>
        Open Pipeline
      </Link>
    </div>
  )
}

/* ---------- what a row does ---------- */

function useRowActions() {
  const d = useRaise()
  const ui = useUI()
  const navigate = useNavigate()
  const decide = useDecide()
  const intro = useIntroducers()
  const m = useMaterials()
  const inbox = useInbox()
  const today = inbox.today

  return useMemo(() => {
    const openPerson = (key: string) => void navigate({ to: '/raise/investors', search: { view: 'introducers', person: key } })
    const openFixes = () => void navigate({ to: '.', search: true, state: (s) => ({ ...s, suggestions: true }) })

    /** Log the ask (the win): confetti from the button, the sounds and the Cheer toast. */
    const logAsk = async (id: string, from: HTMLElement | null) => {
      const i = d.investors.find((x) => x._id === id)
      if (!i) return
      play('ask-logged')
      play('confetti', { delay: 0.15, volume: 0.7 })
      confetti(from)
      const next = askFollowUp(today)
      ui.toast({ tone: 'win', message: `Ask logged. Follow-up set for ${formatDay(next.date)}.`, action: { label: 'View', onClick: () => ui.open(id) }, durationMs: WIN_MS })
      try {
        await d.logNote(id, ASK_NOTE, { touch: 'ask', next })
      } catch (e) {
        ui.fail(e)
      }
    }

    const open = (r: InboxRow) => {
      if (r.investorId && r.action.kind === 'open') return primary(r, null)
      if (r.investorId) return ui.open(r.investorId)
      if (r.personKey) return openPerson(r.personKey)
      if (r.type === 'fix') return openFixes()
      primary(r, null)
    }

    const draft = (r: InboxRow) => {
      if (r.action.kind === 'kit' && r.investorId) return openCloseKit(r.investorId)
      if (!r.investorId) return play('nope')
      openDraft({ investorId: r.investorId, type: r.draft })
    }

    const primary = (r: InboxRow, from: HTMLElement | null) => {
      const a = r.action
      const id = r.investorId
      switch (a.kind) {
        case 'gmail':
          window.open(a.url, '_blank', 'noreferrer')
          return
        case 'draft':
          if (id) openDraft({ investorId: id, type: a.type })
          return
        case 'open':
          if (a.seen?.length) void m.act.seen(a.seen)
          if (id) ui.open(id, a.tab ? { tab: a.tab } : {})
          return
        case 'step': {
          play('rule-check', { volume: 0.7 })
          void Promise.all(a.introIds.map((x) => intro.setStep(x, a.step, today))).catch(ui.fail)
          const firms = a.introIds.flatMap((x) => d.investors.find((i) => i._id === intro.intros.find((y) => y._id === x)?.investorId)?.name ?? [])
          if (a.step === 'thanked' && firms.length) ui.toast({ tone: 'info', icon: 'check', message: thankedLine(r.name, firms) })
          return
        }
        case 'nudge-introducer':
          play('nudge')
          void Promise.all(a.introIds.map((x) => intro.nudged(x))).catch(ui.fail)
          return
        case 'resolve':
          if (id) decide.resolve({ _id: id, name: r.name }, a.signalId, true)
          return
        case 'kit':
          if (id) openCloseKit(id)
          return
        case 'done':
          play('rule-check', { volume: 0.7 })
          void inbox.mark(r, 'done').then(
            (prev) => {
              ui.toast({ tone: 'info', icon: 'check', message: `Done: ${r.name}.`, action: { label: 'Undo', onClick: () => (play('undo'), void inbox.restore(r.key, prev).catch(ui.fail)) } })
            },
            ui.fail,
          )
          return
        case 'accept-fixes':
          play('stage-up')
          void d.suggest.acceptSafe().then((res) => {
            const n = res.ids.length
            ui.toast({ message: `Accepted ${n} safe ${n === 1 ? 'one' : 'ones'}.`, action: { label: 'Undo', onClick: () => (play('undo'), void d.suggest.undo(res.ids).catch(ui.fail)) } })
          }, ui.fail)
          return
        case 'fixes':
          return openFixes()
        case 'move': {
          const mv = a.move
          if (mv.kind === 'ask') return void logAsk(mv.investorId, from)
          if (mv.kind === 'open') return ui.open(mv.investorId)
          if (mv.kind === 'import') return void navigate({ to: '/raise/investors', search: { import: true } })
          if (mv.kind === 'investors') return void navigate({ to: '/raise/investors', search: { wave: mv.wave, stage: mv.stage } })
          if (mv.kind === 'pipeline') return void navigate({ to: '/raise/pipeline' })
          return
        }
      }
    }
    return { open, draft, primary }
  }, [d, ui, navigate, decide, intro, m.act, inbox, today])
}
