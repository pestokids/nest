// PST-281: the drawer's Notes tab (screens/drawer/notes.png). Meeting notes for
// one investor, a "Paste notes" box, and the questions they asked. Picking a
// line marks it as a question: it goes into the Q&A bank linked to this
// investor and the note's date.
//
// Wispr Flow import is PST-277; until then its place says "Paste notes for now".
// TODO(PST-274): "Pull questions out of notes" (enrichment's Anthropic client,
// convex/lib/anthropic.ts) would suggest the lines to pick here; picking stays a click.
import { useMemo, useRef, useState, type FormEvent } from 'react'
import { todayIST } from '../../lib/dates'
import { dayOf } from '../../lib/google'
import { dayMonth } from '../../lib/home'
import { pop, shake } from '../../lib/motion'
import { looksLikeQuestion, needsAnswer, NOTE_TITLES, noteLines, noteTitleFor, type Note, type Question } from '../../lib/qanda'
import type { Investor } from '../../lib/pipeline'
import { play } from '../../lib/sound'
import { addDays } from '../../lib/today'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Icon, Select, Textarea } from '../ui'
import { useQanda } from './data'
import { openPanel } from './panels'
import { useQandaActions } from './useQandaActions'

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

export function NotesTab({ inv }: { inv: Investor }) {
  const { useNotes, questions } = useQanda()
  const notes = useNotes(inv._id)
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

  return (
    <div className="qa-notes">
      <PasteBox inv={inv} open={notes !== undefined && !notes.length} />
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
        <div className="history--loading" aria-busy="true" />
      ) : notes.length ? (
        notes.map((n) => <NoteCard key={n._id} n={n} inv={inv} picked={picked.get(n._id)} />)
      ) : (
        <p className="qa-notes__empty">No notes for {firstName(inv.name)} yet. Paste them after a call, then pick the lines that were questions.</p>
      )}
    </div>
  )
}

function PasteBox({ inv, open: startOpen }: { inv: Investor; open: boolean }) {
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
    ui.toast('Notes saved. Pick the lines that were questions.')
  }

  if (!startOpen && !opened)
    return (
      <div className="qa-paste qa-paste--closed">
        <div className="qa-wispr">
          <span className="eyebrow-mono">Wispr Flow</span>
          <span className="qa-wispr__state">Paste notes for now</span>
        </div>
        <Button variant="secondary" icon="plus" onClick={() => setOpened(true)}>
          Paste notes
        </Button>
      </div>
    )
  return (
    <form className="qa-paste" onSubmit={submit} aria-busy={busy || undefined}>
      <div className="qa-wispr">
        <span className="eyebrow-mono">Wispr Flow</span>
        <span className="qa-wispr__state">Paste notes for now</span>
      </div>
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
              {n === 0 ? 'Today' : n === 1 ? 'Yesterday' : dayMonth(x)}
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

function NoteCard({ n, inv, picked }: { n: Note; inv: Investor; picked?: Map<number, Question> }) {
  const acts = useQandaActions()
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
    <article className="qa-note">
      <header className="qa-note__head">
        <p className="eyebrow-mono qa-note__eyebrow">{[n.title, dayMonth(n.date)].filter(Boolean).join(' · ')}</p>
        <p className="qa-note__by">Pasted by {n.by}</p>
      </header>
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
