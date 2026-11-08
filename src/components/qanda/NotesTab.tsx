// PST-281: the drawer's Notes tab (screens/drawer/notes.png). Meeting notes for
// one investor, a "Paste notes" box, and the questions they asked. Picking a
// line marks it as a question: it goes into the Q&A bank linked to this
// investor and the note's date.
//
// PST-277 (screens/raise-ai/drawer-notes-read-by-nest.png): Nest reads saved notes
// (pasted, or from Wispr Flow through MCP) and shows "Nest read your notes": a
// three-line summary and proposed updates, each ticked but warm paths. Apply N
// writes the ticked ones (the rest are dropped), Dismiss drops them all, and both
// can be undone from the toast. The same proposals sit in Suggestions on Today;
// deciding them there shows here. Motion and sound follow interactions-ai.png.
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { formatDay, todayIST } from '../../lib/dates'
import { cents, NO_AI_KEY } from '../../lib/enrich'
import { dayOf } from '../../lib/google'
import { appliedLine, canApply, KIND_LABEL, noteFrom, proposalText, readView, startsTicked, type NoteRead } from '../../lib/meetingNotes'
import { pop, rise, shake, shine, wobble } from '../../lib/motion'
import { looksLikeQuestion, needsAnswer, NOTE_TITLES, noteLines, noteTitleFor, type Note, type Question } from '../../lib/qanda'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { addDays } from '../../lib/today'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Checkbox, Icon, Select, Textarea } from '../ui'
import { useQanda } from './data'
import { openPanel } from './panels'
import { useQandaActions } from './useQandaActions'
import { SkeletonRows } from '../system/Skeleton'

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const plural = (n: number, one: string, many = one + 's') => n + ' ' + (n === 1 ? one : many)

export function NotesTab({ inv }: { inv: Investor }) {
  const { useNotes, useReads, questions } = useQanda()
  const { ai } = useRaise()
  const notes = useNotes(inv._id)
  const reads = useReads(inv._id)
  const readOf = useMemo(() => new Map((reads ?? []).map((r) => [r.noteId, r])), [reads])
  const asked = useMemo(() => {
    const mine = questions.filter((q) => q.asks.some((a) => a.investorId === inv._id))
    const last = (q: Question) => q.asks.filter((a) => a.investorId === inv._id).reduce((m, a) => (a.date > m ? a.date : m), '')
    return mine.sort((a, b) => Number(needsAnswer(b)) - Number(needsAnswer(a)) || last(b).localeCompare(last(a)))
  }, [questions, inv._id])
  /** Per note, its picked lines and the question each became. */
  const picked = useMemo(() => {
    const m = new Map<string, Map<number, Question>>()
    for (const q of questions)
      for (const a of q.asks) if (a.noteId && a.noteLine !== undefined) m.set(a.noteId, new Map(m.get(a.noteId)).set(a.noteLine, q))
    return m
  }, [questions])
  // Notes Nest is reading or waiting on you go first, as in the design; the rest keep their order below.
  const waiting = (notes ?? []).filter((n) => ['reading', 'review'].includes(readView(readOf.get(n._id))))
  const rest = (notes ?? []).filter((n) => !waiting.includes(n))
  const block = (n: Note) => <NoteBlock key={n._id} n={n} inv={inv} read={readOf.get(n._id)} picked={picked.get(n._id)} connected={ai.connected} />

  return (
    <div className="qa-notes">
      {ai.loaded && !ai.connected && notes?.length ? <NotSetUp /> : null}
      {waiting.map(block)}
      <PasteBox inv={inv} open={notes !== undefined && !notes.length} reads={ai.connected && ai.settings.meetingNotes} />
      {asked.length ? (
        <section className="qa-sec" aria-labelledby="qa-asked">
          <h3 id="qa-asked" className="qa-sec__h">
            Questions they asked
          </h3>
          <ul className="qa-asked">
            {asked.map((q) => {
              const fresh = needsAnswer(q)
              return (
                <li key={q._id} className={`qa-asked__row${fresh ? ' qa-asked__row--new' : ''}`}>
                  <div>
                    <p className="qa-asked__q">{q.text}</p>
                    <p className="qa-asked__sub">{fresh ? 'New · needs an answer' : 'In the bank · answered'}</p>
                  </div>
                  <button type="button" className="qa-textbtn" onClick={() => openPanel({ kind: 'answer', id: q._id })}>
                    {fresh ? 'Answer' : 'See answer'}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
      {notes === undefined ? (
        <SkeletonRows action={false} />
      ) : notes.length ? (
        rest.map(block)
      ) : (
        <p className="qa-notes__empty">
          No notes for {firstName(inv.name)} yet. Paste them after a call{ai.connected ? ' and Nest reads them for you' : ', then pick the lines that were questions'}.
        </p>
      )}
    </div>
  )
}

function NotSetUp() {
  return (
    <section className="nr-card nr-card--off">
      <p className="nr-eyebrow eyebrow-mono">
        <Icon name="spark" size={16} className="enrich-spark enrich-spark--off" />
        AI isn’t set up here
      </p>
      <p className="nr-card__text">
        Nest can’t read notes on this deployment (ANTHROPIC_API_KEY isn’t set in Convex). Notes still save, and you can pick the questions yourself. <Link to="/raise/settings">See Settings</Link>
      </p>
    </section>
  )
}

/** One note: Nest's card while it reads or waits on you, a one-line card once decided, else the note itself. */
function NoteBlock({ n, inv, read, picked, connected }: { n: Note; inv: Investor; read?: NoteRead; picked?: Map<number, Question>; connected: boolean }) {
  const { act } = useQanda()
  const save = useSaveAction()
  const [full, setFull] = useState(false)
  const [starting, setStarting] = useState(false)
  const view = readView(read)
  const start = async () => {
    setStarting(true)
    await save(() => act.readNote(n._id), { failMessage: 'Couldn’t start reading the notes.' })
    setStarting(false)
  }
  const toggle = (
    <button type="button" className="nr-link" aria-expanded={full} onClick={() => setFull((x) => !x)}>
      {full ? 'Hide the full notes' : 'Show the full notes'}
    </button>
  )
  const fullNotes = full ? <NoteCard n={n} inv={inv} picked={picked} embedded /> : null

  if (read && view === 'review') return <ReadCard n={n} inv={inv} read={read} toggle={toggle} full={fullNotes} />
  if (read && view === 'reading') return <Reading n={n} inv={inv} />
  const marked = picked?.size ?? 0
  if (read && view === 'done')
    return (
      <article className="nr-done">
        <p className="nr-done__title">{[n.title ?? 'Meeting', formatDay(n.date)].join(' · ')}</p>
        <p className="nr-done__line">
          {read.status === 'dismissed' ? 'Dismissed what Nest proposed' : appliedLine(read.proposals)}
          {marked ? ' · ' + (marked === 1 ? '1 line marked as a question' : marked + ' lines marked as questions') : ''}
        </p>
        {toggle}
        {fullNotes}
      </article>
    )
  const failed = view === 'failed' && read ? (read.error === NO_AI_KEY ? 'AI isn’t set up here.' : 'Nest couldn’t read these notes' + (read.error ? ': ' + read.error : '.')) : null
  return (
    <NoteCard
      n={n}
      inv={inv}
      picked={picked}
      error={failed}
      action={
        connected ? (
          <Button variant="secondary" size="sm" icon="spark" loading={starting} loadingLabel="Starting…" onClick={() => void start()}>
            {failed ? 'Try again' : 'Read with Nest'}
          </Button>
        ) : null
      }
    />
  )
}

/** "Nest is reading your notes": the shimmer runs until the answer lands. */
function Reading({ n, inv }: { n: Note; inv: Investor }) {
  const meeting = useMeeting(n)
  return (
    <section className="nr-card nr-card--reading" aria-busy="true">
      <p className="nr-eyebrow eyebrow-mono">
        <Icon name="spark" size={16} className="enrich-spark enrich-spark--spin" />
        Nest is reading your notes
      </p>
      <h3 className="nr-card__title">{[n.title ?? 'Meeting', formatDay(n.date)].join(' · ')}</h3>
      <p className="nr-card__sub">{noteFrom(n, meeting)}</p>
      <div className="nr-summary nr-summary--loading" aria-hidden="true">
        <span className="sk" />
        <span className="sk" />
        <span className="sk" />
      </div>
      <p className="nr-card__text">Usually under 20 seconds. Nothing changes for {firstName(inv.name)} until you apply.</p>
    </section>
  )
}

function useMeeting(n: Note) {
  const { google } = useRaise()
  return n.meetingId ? google.meetings.find((m) => m._id === n.meetingId) : undefined
}

/** "Nest read your notes": the summary, the proposed updates with a tick each, Apply N, Dismiss. */
function ReadCard({ n, inv, read, toggle, full }: { n: Note; inv: Investor; read: NoteRead; toggle: ReactNode; full: ReactNode }) {
  const { act } = useQanda()
  const ui = useUI()
  const card = useRef<HTMLElement>(null)
  const meeting = useMeeting(n)
  const open = read.proposals.filter((p) => p.state === 'open')
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(open.filter(startsTicked).map((p) => p.id)))
  const [folding, setFolding] = useState(false)
  const [busy, setBusy] = useState<'apply' | 'dismiss' | null>(null)
  const count = open.filter((p) => ticked.has(p.id) && canApply(p)).length
  // The card shines once when it arrives.
  useEffect(() => shine(card.current), [read._id])

  const undo = () => {
    play('undo')
    act.undoRead(read._id).catch(ui.fail)
  }
  async function apply() {
    setBusy('apply')
    setFolding(true)
    try {
      const [r] = await Promise.all([act.applyRead(read._id, [...ticked]), sleep(open.length * 40 + 240)])
      play('stage-up')
      ui.toast({ message: `Applied ${plural(r.applied, 'update')} for ${inv.name}.`, action: { label: 'Undo', onClick: undo } })
    } catch (e) {
      setFolding(false)
      ui.fail(e)
    } finally {
      setBusy(null)
    }
  }
  async function dismiss() {
    setBusy('dismiss')
    try {
      await act.dismissRead(read._id)
      ui.toast({ tone: 'info', message: 'Dismissed. Nothing changed.', action: { label: 'Undo', onClick: undo } })
    } catch (e) {
      ui.fail(e)
    } finally {
      setBusy(null)
    }
  }
  const tick = (id: string, on: boolean, el: Element | null) => {
    if (on) pop(el)
    setTicked((s) => (on ? new Set(s).add(id) : new Set([...s].filter((x) => x !== id))))
  }

  return (
    <section ref={card} className="nr-card nr-card--mint" aria-labelledby={'nr-' + read._id}>
      <p className="nr-eyebrow eyebrow-mono">
        <Icon name="spark" size={16} className="enrich-spark" />
        Nest read your notes · {cents(read.costUsd)}
      </p>
      <h3 id={'nr-' + read._id} className="nr-card__title">
        {[n.title ?? 'Meeting', formatDay(n.date)].join(' · ')}
      </h3>
      <p className="nr-card__sub">{noteFrom(n, meeting)}</p>
      {read.summary.length ? (
        <div className="nr-summary">
          {read.summary.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
        </div>
      ) : null}
      {open.length ? (
        <>
          <h4 className="nr-label eyebrow-mono">Proposed updates</h4>
          <ul className="nr-rows">
            {open.map((p, i) => (
              <li key={p.id} className={'nr-row m-rise' + (folding && ticked.has(p.id) ? ' is-folding' : '')} style={{ ...rise(i), transitionDelay: folding ? i * 40 + 'ms' : undefined }}>
                <Checkbox
                  checked={ticked.has(p.id) && canApply(p)}
                  disabled={!canApply(p) || !!busy}
                  onChange={(e) => tick(p.id, e.target.checked, e.currentTarget.closest('.checkbox'))}
                  aria-label={KIND_LABEL[p.kind] + ': ' + proposalText(p)}
                />
                <span className="nr-row__kind">{KIND_LABEL[p.kind]}</span>
                <span className="nr-row__body">
                  <span className="nr-row__value">{proposalText(p)}</span>
                  {p.kind === 'expected' && p.clash ? <Clash text={p.clash} /> : null}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="nr-card__text">Nothing to update from these notes.</p>
      )}
      <div className="nr-foot">
        {open.length ? (
          <Button variant="primary" loading={busy === 'apply'} loadingLabel="Applying…" disabled={!count || !!busy} onClick={() => void apply()}>
            Apply {count}
          </Button>
        ) : null}
        <button type="button" className="nr-dismiss" disabled={!!busy} onClick={() => void dismiss()}>
          {open.length ? 'Dismiss' : 'Got it'}
        </button>
        <span className="nr-foot__gap" />
        {toggle}
      </div>
      {full}
    </section>
  )
}

/** "You wrote $25K as Expected…": wobbles once when it appears. */
function Clash({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => wobble(ref.current), [])
  return (
    <span ref={ref} className="nr-row__clash">
      {text}
    </span>
  )
}

function PasteBox({ inv, open: startOpen, reads }: { inv: Investor; open: boolean; reads: boolean }) {
  const { act } = useQanda()
  const d = useRaise()
  const ui = useUI()
  const save = useSaveAction()
  const [now] = useState(() => Date.now())
  const today = todayIST(now)
  const lastMet = d.google.meetings.filter((m) => m.investorIds.includes(inv._id) && m.end <= now).sort((a, b) => b.start - a.start)[0]
  const [text, setText] = useState('')
  const [title, setTitle] = useState(() => noteTitleFor(inv.stage))
  const [date, setDate] = useState(() => (lastMet && dayOf(lastMet.start) >= addDays(today, -13) ? dayOf(lastMet.start) : today))
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const days = Array.from({ length: 14 }, (_, n) => addDays(today, -n))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) {
      play('nope')
      shake(box.current?.closest('.field'))
      box.current?.focus()
      return
    }
    const meeting = d.google.meetings.find((m) => m.investorIds.includes(inv._id) && dayOf(m.start) === date && m.end <= now)
    setBusy(true)
    const id = await save(() => act.addNote({ investorId: inv._id, text, date, title, meetingId: meeting?._id }), { failMessage: 'Couldn’t save the notes.' })
    setBusy(false)
    if (!id) return
    setText('')
    setOpened(false)
    ui.toast(reads ? 'Notes saved. Nest is reading them.' : 'Notes saved. Pick the lines that were questions.')
  }

  const wispr = (
    <div className="qa-wispr">
      <span className="eyebrow-mono">Wispr Flow</span>
      <span className="qa-wispr__state">{reads ? 'Notes it sends land here' : 'Paste notes for now'}</span>
    </div>
  )
  if (!startOpen && !opened)
    return (
      <div className="qa-paste qa-paste--closed">
        {wispr}
        <Button variant="secondary" icon="plus" onClick={() => setOpened(true)}>
          Paste notes
        </Button>
      </div>
    )
  return (
    <form className="qa-paste" onSubmit={submit} aria-busy={busy || undefined}>
      {wispr}
      <Textarea ref={box} label="Paste notes" rows={4} autoFocus={opened} placeholder="Notes from the meeting, one point per line, so you can pick out the questions." value={text} onChange={(e) => setText(e.target.value)} />
      <div className="qa-paste__row">
        <Select label="Meeting" value={title} onChange={(e) => setTitle(e.target.value)}>
          {NOTE_TITLES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <Select label="When" value={date} onChange={(e) => setDate(e.target.value)}>
          {days.map((x, n) => (
            <option key={x} value={x}>
              {n === 0 ? 'Today' : n === 1 ? 'Yesterday' : formatDay(x)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="secondary" loading={busy} className="qa-paste__save">
          Save notes
        </Button>
      </div>
    </form>
  )
}

function NoteCard({ n, inv, picked, embedded, error, action }: { n: Note; inv: Investor; picked?: Map<number, Question>; embedded?: boolean; error?: string | null; action?: ReactNode }) {
  const acts = useQandaActions()
  const meeting = useMeeting(n)
  const lines = noteLines(n.text)
  const [busy, setBusy] = useState<number | null>(null)
  const toggle = async (line: number, el: HTMLElement) => {
    if (busy !== null) return
    setBusy(line)
    if (picked?.has(line)) await acts.unmarkLine(n, line)
    else if (await acts.markLine(n, line, inv.name)) requestAnimationFrame(() => pop(el.querySelector('.qa-line__tick')))
    setBusy(null)
  }
  return (
    <article className={'qa-note' + (embedded ? ' qa-note--embedded' : '')}>
      {!embedded ? (
        <header className="qa-note__head">
          <div>
            <p className="eyebrow-mono qa-note__eyebrow">{[n.title, formatDay(n.date)].filter(Boolean).join(' · ')}</p>
            <p className="qa-note__by">{noteFrom(n, meeting)}</p>
          </div>
          {action}
        </header>
      ) : null}
      {error ? <p className="qa-note__error">{error}</p> : null}
      <p className="qa-note__hint">Pick a line to put it in the Q&amp;A bank as a question they asked.</p>
      <ul className="qa-lines">
        {lines.map((l) => {
          const q = picked?.get(l.line)
          return (
            <li key={l.line}>
              <button
                type="button"
                className={['qa-line', q && 'is-picked', !q && looksLikeQuestion(l.text) && 'qa-line--q'].filter(Boolean).join(' ')}
                aria-pressed={!!q}
                aria-busy={busy === l.line || undefined}
                onClick={(e) => void toggle(l.line, e.currentTarget)}
              >
                <span className="qa-line__tick" aria-hidden="true">
                  <Icon name={q ? 'check' : 'plus'} size={14} strokeWidth={2.4} />
                </span>
                <span className="qa-line__text">{l.text}</span>
                {q ? <span className="qa-line__tag">{needsAnswer(q) ? 'In the bank · needs an answer' : 'In the bank'}</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
      <footer className="qa-note__foot">
        <button type="button" className="drawer__textbtn drawer__textbtn--danger" onClick={() => void acts.removeNote(n)}>
          Delete these notes
        </button>
      </footer>
    </article>
  )
}
