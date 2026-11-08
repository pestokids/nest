// Suggested fixes (PST-275): every one in a list with filters and "Accept N
// safe ones" (suggestions-all.png), opened from the Inbox's fix rows and ⌘K's
// "Review N suggestions" (PST-297: the Inbox replaced the card on Today). Motion and sound follow
// interactions-ai.png: sounds only follow a click, one per action; the checks
// running and an agent adding a row are silent.
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { confetti, pop, usePop } from '../lib/motion'
import { play } from '../lib/sound'
import {
  acceptsTogether, actionOf, filterChips, firstTidyToday, KIND_LABEL, sourceLabel, thingsToFix, type Suggestion, type SuggestionFilter,
} from '../lib/suggestions'
import { notesDiff, type SuggestionPatch } from '../lib/suggestions' // PST-302
import { useRaise } from './data'
import { NestSleeping } from './illustrations'
import { usePreviewState } from './preview-state'
import { useUI } from './raise-ui'
import { Modal, useTitleId } from './system/Modal'
import { useSaveAction } from './system/useSaveAction'
import { Button, Chip, Icon, type ChipTone } from './ui'

declare module '@tanstack/react-router' {
  interface HistoryState {
    /** Open the suggestions list on Today (the ⌘K "Review N suggestions" row). */
    suggestions?: boolean
  }
}

/** How long a row takes to fold away, and the gap between rows in a cascade. */
const FOLD_MS = 200
const CASCADE_MS = 40
/** Confetti for a cleared list is the small burst. */
const TIDY_CONFETTI = 24

type Leaving = { how: 'accept' | 'merge' | 'dismiss'; i: number }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const chipTone = (s: Suggestion): ChipTone => (s.source === 'agent' ? 'waiting' : s.kind === 'duplicate' ? 'error' : 'neutral')

/** The full list of suggestions, when it's open. */
export function Suggestions({ today }: { today: string }) {
  const d = useRaise()
  const ui = useUI()
  const save = useSaveAction()
  const preview = usePreviewState()
  const [open, setOpen] = useState(() => ['all', 'tidy', 'agent', 'jev', /* PST-302 */ 'notes', 'outreach', 'application'].includes(preview?.suggestions ?? ''))

  // Rows folding away, then hidden until their write lands.
  const [leaving, setLeaving] = useState<ReadonlyMap<string, Leaving>>(() => new Map())
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const list = useMemo(() => d.suggestions.filter((s) => !gone.has(s._id)), [d.suggestions, gone])
  const names = useMemo(() => new Map(d.investors.map((i) => [i._id, i.name])), [d.investors])

  // The list was emptied by a click here: "All tidy.", and celebrate once a day.
  const acted = useRef(false)
  const tidyAt = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (list.length || !acted.current) return
    acted.current = false
    if (!firstTidyToday(today)) return
    play('target-hit')
    requestAnimationFrame(() => confetti(tidyAt.current, { count: TIDY_CONFETTI }))
  }, [list.length, today])

  // Run the checks when Today opens and each time the list opens, so it reflects the latest edits. Silent.
  const checkNow = useRef(d.suggest.check)
  useEffect(() => {
    checkNow.current = d.suggest.check
  })
  const checked = useRef(false)
  useEffect(() => {
    if (checked.current && !open) return
    checked.current = true
    checkNow.current().catch(() => {})
  }, [open])

  // "Review N suggestions" in ⌘K: open the list, then drop the request.
  const navigate = useNavigate()
  const request = useRouterState({ select: (s) => s.location.state.suggestions })
  useEffect(() => {
    if (!request) return
    setOpen(true)
    void navigate({ to: '.', search: true, hash: true, replace: true, state: (s) => ({ ...s, suggestions: undefined }) })
  }, [request, navigate])

  const fold = async (ids: string[], how: Leaving['how']) => {
    acted.current = true
    setLeaving((m) => new Map([...m, ...ids.map((id, i) => [id, { how, i }] as const)]))
    await wait(FOLD_MS + CASCADE_MS * (ids.length - 1))
    setGone((s) => new Set([...s, ...ids]))
    setLeaving((m) => new Map([...m].filter(([id]) => !ids.includes(id))))
  }
  const unhide = (ids: string[]) => setGone((s) => new Set([...s].filter((id) => !ids.includes(id))))

  const undo = (ids: string[]) => {
    play('undo')
    void save(() => d.suggest.undo(ids), { failMessage: 'Couldn’t undo that.' })
  }

  async function accept(s: Suggestion) {
    const merge = actionOf(s) === 'merge'
    play(merge ? 'card-drop' : 'rule-check')
    await fold([s._id], merge ? 'merge' : 'accept')
    const r = await save(() => d.suggest.accept(s._id), { failMessage: merge ? 'Couldn’t merge them.' : 'Couldn’t apply that.' })
    unhide([s._id])
    if (!r) return void (acted.current = false)
    if (!r.applied) return ui.toast({ tone: 'info', message: 'That had already changed, so there was nothing to do.' })
    const keep = names.get(s.investorId ?? '') ?? 'the card'
    const message = merge ? `Merged into ${keep}. Both histories kept.` : s.patch.op === 'new_investor' ? `${s.patch.name} is in the nest.` : `${keep}: ${s.fix}.`
    ui.toast({ message, action: { label: 'Undo', onClick: () => undo([s._id]) } })
  }

  async function dismiss(s: Suggestion) {
    await fold([s._id], 'dismiss')
    const ok = await save(async () => (await d.suggest.dismiss(s._id), true), { failMessage: 'Couldn’t dismiss that.' })
    unhide([s._id])
    if (!ok) return void (acted.current = false)
    ui.toast({ tone: 'info', message: 'Dismissed. Nest won’t suggest it again.', action: { label: 'Undo', onClick: () => undo([s._id]) } })
  }

  function review(s: Suggestion) {
    setOpen(false)
    if (s.investorId) ui.open(s.investorId)
  }

  async function acceptSafe() {
    const ids = list.filter(acceptsTogether).map((s) => s._id)
    if (!ids.length) return
    await fold(ids, 'accept')
    // One sound for the whole batch, at the end of the cascade.
    play('stage-up')
    const r = await save(() => d.suggest.acceptSafe(), { failMessage: 'Couldn’t accept them.' })
    unhide(ids)
    if (!r) return void (acted.current = false)
    const n = r.ids.length
    ui.toast({ message: `Accepted ${n} safe ${n === 1 ? 'one' : 'ones'}.`, action: { label: 'Undo', onClick: () => undo(r.ids) } })
  }

  const rowProps = { leaving, onAccept: accept, onDismiss: dismiss, onReview: review }
  return (
    <>
      {open ? <AllDialog list={list} tidyAt={tidyAt} onClose={() => setOpen(false)} onAcceptSafe={acceptSafe} {...rowProps} /> : null}
    </>
  )
}

type RowActions = {
  leaving: ReadonlyMap<string, Leaving>
  onAccept: (s: Suggestion) => void
  onDismiss: (s: Suggestion) => void
  onReview: (s: Suggestion) => void
}

/** Rows that turn up after the first render (an agent's, or one back from Undo) rise in. */
function useFresh(list: Suggestion[]) {
  const seen = useRef<Set<string> | null>(null)
  const fresh = new Set(seen.current ? list.filter((s) => !seen.current!.has(s._id)).map((s) => s._id) : [])
  useEffect(() => {
    seen.current = new Set([...(seen.current ?? []), ...list.map((s) => s._id)])
  })
  return fresh
}

function Rows({ list, showSource, leaving, ...a }: RowActions & { list: Suggestion[]; showSource?: boolean }) {
  const fresh = useFresh(list)
  return (
    <ul className="sg-rows">
      {list.map((s) => (
        <Row key={s._id} s={s} showSource={showSource} fresh={fresh.has(s._id)} leaving={leaving.get(s._id)} {...a} />
      ))}
    </ul>
  )
}

function Row({ s, showSource, fresh, leaving, onAccept, onDismiss, onReview }: Omit<RowActions, 'leaving'> & { s: Suggestion; showSource?: boolean; fresh: boolean; leaving?: Leaving }) {
  const btn = useRef<HTMLButtonElement>(null)
  const action = actionOf(s)
  const agent = s.source === 'agent'
  useEffect(() => {
    if (leaving?.how === 'accept') pop(btn.current)
  }, [leaving?.how])
  return (
    <li
      className={['sg-row', leaving && `sg-row--${leaving.how}`, fresh && 'sg-row--fresh m-rise'].filter(Boolean).join(' ')}
      style={leaving ? { transitionDelay: `${leaving.i * CASCADE_MS}ms` } : undefined}
      aria-hidden={leaving ? true : undefined}
    >
      <div className="sg-row__in">
        <span className="sg-row__kind">
          <Chip tone={chipTone(s)} dot={agent} className={agent ? 'sg-chip--agent' : undefined}>
            {KIND_LABEL[s.kind]}
          </Chip>
        </span>
        <div className="sg-row__text">
          <p className="sg-row__title">{s.title}</p>
          {s.patch.op === 'notes' ? <NotesDiff p={s.patch} /> : null}
          <p className="sg-row__fix">
            <span aria-hidden="true">→ </span>
            {s.fix}
          </p>
          {showSource || agent ? <p className="sg-row__src">From {sourceLabel(s)}</p> : null}
        </div>
        <div className="sg-row__actions">
          {action === 'accept' ? (
            <Button ref={btn} variant="primary" className="sg-row__go" icon={leaving?.how === 'accept' ? 'check' : undefined} disabled={!!leaving} onClick={() => onAccept(s)} aria-label={`Accept: ${s.fix}`}>
              Accept
            </Button>
          ) : (
            <Button variant="secondary" className="sg-row__go" disabled={!!leaving} onClick={() => (action === 'merge' ? onAccept(s) : onReview(s))} aria-label={`${action === 'merge' ? 'Merge' : 'Review'}: ${s.fix}`}>
              {action === 'merge' ? 'Merge' : 'Review'}
            </Button>
          )}
          <Button variant="ghost" className="sg-row__dismiss" disabled={!!leaving} onClick={() => onDismiss(s)} aria-label={`Dismiss: ${s.title}`}>
            Dismiss
          </Button>
        </div>
      </div>
    </li>
  )
}

/** PST-302: a notes fix's before and after (what's there now and what it adds, for a correction). */
function NotesDiff({ p }: { p: Extract<SuggestionPatch, { op: 'notes' }> }) {
  const x = notesDiff(p)
  return (
    <div className="sg-diff">
      {x.before ? (
        <p className="sg-diff__line">
          <span className="sg-diff__tag">{x.added ? 'Now' : 'Before'}</span>
          {x.added ? <span className="sg-diff__now">{x.before}</span> : <del className="sg-diff__before">{x.before}</del>}
        </p>
      ) : null}
      <p className="sg-diff__line">
        <span className="sg-diff__tag">{x.added ? 'Adds' : 'After'}</span>
        <ins className="sg-diff__after">{x.after}</ins>
      </p>
    </div>
  )
}

function Eyebrow() {
  return (
    <p className="sg-eyebrow">
      <Icon name="spark" size={14} className="sg-eyebrow__spark" />
      Suggestions
    </p>
  )
}

function Tidy({ at }: { at: React.RefObject<HTMLDivElement | null> }) {
  return (
    <div className="sg-tidy">
      <div ref={at} className="sg-tidy__nest">
        <NestSleeping size={104} />
      </div>
      <div>
        <p className="sg-tidy__title">All tidy.</p>
        <p>Nothing to fix in your list. Nest looks again every morning and after each Google sync.</p>
      </div>
    </div>
  )
}

/** Every suggestion: filter chips by kind, the rows, and "Accept N safe ones". */
function AllDialog({ list, tidyAt, onClose, onAcceptSafe, ...a }: RowActions & { list: Suggestion[]; tidyAt: React.RefObject<HTMLDivElement | null>; onClose: () => void; onAcceptSafe: () => void }) {
  const titleId = useTitleId()
  const [filter, setFilter] = useState<SuggestionFilter>('all')
  const chips = filterChips(list)
  const at = chips.some((c) => c.k === filter) ? filter : 'all'
  const shown = at === 'all' ? list : list.filter((s) => (s.source === 'agent' ? 'agents' : s.kind) === at)
  const safe = list.filter(acceptsTogether).length
  const n = list.length
  const countRef = usePop<HTMLSpanElement>(n)
  return (
    <Modal onClose={onClose} labelledBy={titleId} className="sg-dialog" initialFocus="panel">
      <header className="sg-dialog__head">
        <Eyebrow />
        <h2 id={titleId} className="sg-dialog__title">
          {n ? (
            <>
              <span ref={countRef} className="num">
                {n}
              </span>{' '}
              {thingsToFix(n).replace(/^\d+ /, '')}
            </>
          ) : (
            'Suggestions'
          )}
        </h2>
        <button type="button" className="sg-dialog__close" onClick={onClose} aria-label="Close suggestions">
          <Icon name="close" size={22} />
        </button>
        {n ? (
          <div className="sg-filters" role="group" aria-label="Show suggestions">
            {chips.map((c) => (
              <button key={c.k} type="button" className={`chip ${at === c.k ? 'chip--selected' : 'chip--outline'} sg-filter`} aria-pressed={at === c.k} onClick={() => setFilter(c.k)}>
                {c.label} <span className="num">{c.n}</span>
              </button>
            ))}
          </div>
        ) : null}
      </header>
      <div className="sg-dialog__body">{n ? <Rows list={shown} showSource {...a} /> : <Tidy at={tidyAt} />}</div>
      {n ? (
        <footer className="sg-dialog__foot">
          <p className="sg-dialog__note">Accept all safe ones skips merges, reviews and anything from agents.</p>
          <Button variant="primary" disabled={!safe} onClick={onAcceptSafe}>
            {safe ? `Accept ${safe} safe ${safe === 1 ? 'one' : 'ones'}` : 'Nothing safe to accept together'}
          </Button>
        </footer>
      ) : null}
    </Modal>
  )
}
