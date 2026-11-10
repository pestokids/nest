// PST-281: Answer a question (screens/raise-qanda/answer-a-question.png). Write or
// edit the best answer, set the theme and the slide, link the investors who
// asked, merge it into the same question in other words, and go back to an
// earlier answer. Also "Add a question" (no question yet).
//
// PST-277: "Draft from past answers" sits above Best answer: Claude (the cheap model)
// drafts from this question's earlier answers, similar questions' answers and the
// notes where it was asked (convex/noteReads.ts draftAnswer). The draft fills the
// box to edit; nothing saves until Save.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { formatDay, todayIST } from '../../lib/dates'
import {
  allThemes, askerIds, askKind, cleanTheme, earlierAnswers, guessTheme, LIMITS, needsAnswer, similarQuestions, slideRefs, type Question,
} from '../../lib/qanda'
import { cents } from '../../lib/enrich'
import { shake, shine } from '../../lib/motion'
import { play } from '../../lib/sound'
import { addDays } from '../../lib/today'
import { useRaise } from '../data'
import { useUI } from '../raise-ui'
import { useSaveAction } from '../system/useSaveAction'
import { Button, Icon, Input, Select, Textarea } from '../ui'
import { useQanda } from './data'
import { openPanel, type PanelRequest } from './panels'
import { Panel, type PanelControls } from './Panel'
import { useQandaActions } from './useQandaActions'

const NEW_THEME = '\u0000new'
const NEW_SLIDE = '\u0000new'

export function AnswerPanel({ req, level, onClose }: { req: Extract<PanelRequest, { kind: 'answer' } | { kind: 'new' }>; level: number; onClose: () => void }) {
  const { questions, act } = useQanda()
  const d = useRaise()
  const ui = useUI()
  const save = useSaveAction()
  const acts = useQandaActions()
  const today = todayIST()
  const q = req.kind === 'answer' ? questions.find((x) => x._id === req.id) : undefined
  const names = useMemo(() => new Map(d.investors.map((i) => [i._id, i.name])), [d.investors])

  const existed = useRef(!!q)
  useEffect(() => {
    if (existed.current && !q) onClose()
  }, [q, onClose])

  const [text, setText] = useState(q?.text ?? '')
  const [answer, setAnswer] = useState(q?.bestAnswer ?? '')
  const [theme, setTheme] = useState<string | null>(q?.theme ?? null)
  const [newTheme, setNewTheme] = useState<string | null>(null)
  const [slide, setSlide] = useState(q?.slideRef ?? '')
  const [newSlide, setNewSlide] = useState<string | null>(null)
  const [rewording, setRewording] = useState(!q)
  const [who, setWho] = useState('')
  const [when, setWhen] = useState(today)
  const [busy, setBusy] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [drafted, setDrafted] = useState<string | null>(null)
  const textRef = useRef<HTMLInputElement>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  if (req.kind === 'answer' && !q) return null

  const themes = allThemes(questions)
  const slides = slideRefs(questions)
  const pickedTheme = newTheme !== null ? cleanTheme(newTheme) : theme ?? guessTheme(text)
  const pickedSlide = newSlide !== null ? newSlide.trim() : slide
  const similar = q ? similarQuestions(q, questions, 2) : []
  const earlier = q ? earlierAnswers(q) : []
  const first = q ? names.get(askerIds(q)[0] ?? '') : undefined
  const people = [...d.investors].sort((a, b) => a.name.localeCompare(b.name))
  const days = Array.from({ length: 14 }, (_, n) => addDays(today, -n))

  async function submit(e: FormEvent, c: PanelControls) {
    e.preventDefault()
    const t = text.trim()
    if (!t) {
      play('nope')
      setRewording(true)
      requestAnimationFrame(() => {
        shake(textRef.current?.closest('.field'))
        textRef.current?.focus()
      })
      return
    }
    setBusy(true)
    const r = await save(
      async () => {
        if (q) {
          await act.save({ id: q._id, text: t, bestAnswer: answer, theme: pickedTheme, slideRef: pickedSlide || null })
          return { id: q._id, existed: false }
        }
        const made = await act.create({ text: t, theme: pickedTheme, investorId: who || undefined, date: when })
        if (!made.existed) await act.save({ id: made.id, text: t, bestAnswer: answer, theme: pickedTheme, slideRef: pickedSlide || null })
        return made
      },
      { failMessage: q ? 'Couldn’t save the answer.' : 'Couldn’t add the question.' },
    )
    setBusy(false)
    if (!r) return
    if (r.existed) {
      ui.toast({ tone: 'info', message: 'That question is already in the bank, so it went there.' })
      c.close()
      openPanel({ kind: 'answer', id: r.id })
      return
    }
    play('save')
    ui.toast(!q ? 'Added to the bank.' : answer.trim() && answer.trim() !== q.bestAnswer.trim() ? 'Answer saved. The earlier one is kept.' : 'Saved.')
    c.close()
  }

  async function draft() {
    if (!q) return
    setDrafting(true)
    try {
      const r = await act.draftAnswer(q._id)
      setAnswer(r.text)
      setDrafted(`Drafted from ${r.from === 1 ? '1 past answer or note' : r.from + ' past answers and notes'} · ${cents(r.costUsd)}. Edit it, then save.`)
      shine(answerRef.current?.closest('.field'))
      answerRef.current?.focus()
    } catch (e) {
      ui.fail(e)
    } finally {
      setDrafting(false)
    }
  }

  const linkWho = (investorId: string) => {
    if (!q || !investorId) return
    void save(() => act.link({ questionId: q._id, investorId, date: today, source: 'manual' }), { failMessage: 'Couldn’t link them.' })
  }
  const openInvestor = (id: string, c: PanelControls) => {
    c.close()
    ui.open(id)
  }

  const eyebrow = !q ? 'Add a question' : needsAnswer(q) ? `New${first ? ` · from ${first}` : ''}` : `Edit · ${q.theme}`
  return (
    <Panel
      level={level}
      onClose={onClose}
      tone={q && needsAnswer(q) ? 'new' : undefined}
      eyebrow={eyebrow}
      title={q ? q.text : 'What did they ask?'}
      footer={(c) => (
        <>
          {q ? (
            <button type="button" className="drawer__textbtn drawer__textbtn--danger qa-panel__delete" onClick={() => void acts.remove(q).then((ok) => ok && c.close())}>
              Delete question
            </button>
          ) : null}
          <button type="button" className="drawer__textbtn" onClick={c.close}>
            Cancel
          </button>
          <Button type="submit" form="qa-answer-form" variant="primary" loading={busy} loadingLabel="Saving…">
            {q ? 'Save answer' : 'Add to the bank'}
          </Button>
        </>
      )}
    >
      {(c) => (
        <form id="qa-answer-form" className="dform qa-answer" noValidate onSubmit={(e) => void submit(e, c)} aria-busy={busy || undefined}>
          {rewording ? (
            <Input ref={textRef} label="Question" placeholder="In their words, as one question" maxLength={LIMITS.question} value={text} onChange={(e) => setText(e.target.value)} data-autofocus={!q || undefined} />
          ) : (
            <button type="button" className="qa-link qa-answer__reword" onClick={() => setRewording(true)}>
              <Icon name="edit" size={16} /> Reword the question
            </button>
          )}

          {q ? (
            <section className="qa-sec" aria-labelledby="qa-where">
              <h3 id="qa-where" className="qa-sec__h">
                Where it came up
              </h3>
              {q.asks.length ? (
                <ul className="qa-where">
                  {[...q.asks]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((a) => {
                      const name = names.get(a.investorId) ?? 'Someone'
                      return (
                        <li key={a._id} className="qa-where__row">
                          <p className="qa-where__meta">
                            <button type="button" className="qa-where__who" onClick={() => openInvestor(a.investorId, c)}>
                              {name}
                            </button>
                            {' · '}
                            {askKind(a)} · {formatDay(a.date)}
                          </p>
                          {a.quote ? <p className="qa-where__quote">“{a.quote}”</p> : null}
                          <button type="button" className="qa-where__x" aria-label={`${name} didn’t ask this`} title="Unlink" onClick={() => void acts.unlink(a, name)}>
                            <Icon name="close" size={16} />
                          </button>
                        </li>
                      )
                    })}
                </ul>
              ) : (
                <p className="qa-sec__empty">Nobody linked yet.</p>
              )}
              <Select label="Who else asked it?" className="qa-inline" value="" onChange={(e) => linkWho(e.target.value)}>
                <option value="">Link an investor…</option>
                {people.map((i) => (
                  <option key={i._id} value={i._id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </section>
          ) : (
            <div className="dform__row">
              <Select label="Who asked?" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Nobody yet</option>
                {people.map((i) => (
                  <option key={i._id} value={i._id}>
                    {i.name}
                  </option>
                ))}
              </Select>
              <Select label="When" value={when} onChange={(e) => setWhen(e.target.value)} disabled={!who}>
                {days.map((x, n) => (
                  <option key={x} value={x}>
                    {n === 0 ? 'Today' : n === 1 ? 'Yesterday' : formatDay(x)}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {similar.length && q ? (
            <section className="qa-sec" aria-labelledby="qa-similar">
              <h3 id="qa-similar" className="qa-sec__h">
                Similar questions
              </h3>
              <ul className="qa-similar">
                {similar.map((o: Question) => (
                  <li key={o._id} className="qa-similar__row">
                    <div>
                      <p className="qa-similar__q">{o.text}</p>
                      <p className="qa-similar__meta">
                        Asked {o.askedCount}× · {o.theme}
                      </p>
                    </div>
                    <button type="button" className="qa-textbtn" onClick={() => void acts.merge(q, o).then((ok) => ok && c.close())} aria-label={`Same question: merge into “${o.text}”`}>
                      Merge
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {q && d.ai.connected ? (
            <div className="qa-draft">
              <Button type="button" variant="secondary" size="sm" icon="spark" loading={drafting} loadingLabel="Drafting…" onClick={() => void draft()}>
                Draft from past answers
              </Button>
              {drafted ? <p className="qa-draft__note">{drafted}</p> : null}
            </div>
          ) : null}
          <Textarea
            ref={answerRef}
            label="Best answer"
            className="qa-answer__best"
            rows={6}
            maxLength={LIMITS.answer}
            placeholder="What you’d say in the room, in two or three sentences."
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            data-autofocus={(q && needsAnswer(q)) || undefined}
          />

          <Select label="Theme" className="qa-inline" value={newTheme !== null ? NEW_THEME : pickedTheme} onChange={(e) => (e.target.value === NEW_THEME ? setNewTheme('') : (setNewTheme(null), setTheme(e.target.value)))}>
            {[...new Set([...themes, pickedTheme])].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            <option value={NEW_THEME}>New theme…</option>
          </Select>
          {newTheme !== null ? <Input label="New theme" placeholder="e.g. Safety" maxLength={LIMITS.theme} value={newTheme} onChange={(e) => setNewTheme(e.target.value)} autoFocus /> : null}

          <Select label="Covered on" className="qa-inline" value={newSlide !== null ? NEW_SLIDE : slide} onChange={(e) => (e.target.value === NEW_SLIDE ? setNewSlide('') : (setNewSlide(null), setSlide(e.target.value)))}>
            <option value="">Not on a slide</option>
            {[...new Set([...slides, ...(slide ? [slide] : [])])].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            <option value={NEW_SLIDE}>Another slide…</option>
          </Select>
          {newSlide !== null ? <Input label="Slide" placeholder="e.g. p8 · Pricing" maxLength={LIMITS.slide} value={newSlide} onChange={(e) => setNewSlide(e.target.value)} autoFocus /> : null}

          {earlier.length ? (
            <section className="qa-sec" aria-labelledby="qa-earlier">
              <h3 id="qa-earlier" className="qa-sec__h">
                Earlier answers
              </h3>
              <ul className="qa-versions">
                {earlier.map((v) => (
                  <li key={v.at} className="qa-versions__row">
                    <p className="qa-versions__text">{v.text}</p>
                    <p className="qa-versions__meta">
                      {[v.by, formatDay(todayIST(v.at))].filter(Boolean).join(' · ')}
                      <button type="button" className="qa-textbtn" onClick={() => setAnswer(v.text)}>
                        Use this
                      </button>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </form>
      )}
    </Panel>
  )
}
