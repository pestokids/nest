// PST-281: Raise › Q&A (screens/raise-qanda/bank.png; phones: iphone-17-pro-max/qanda.png,
// galaxy-s25-ultra/qanda.png). The facts row, theme chips, the new questions
// from meetings that need an answer, the most asked questions with the best
// answer and its slide, and the deck-gaps list.
import { useMemo, useState } from 'react'
import { todayIST } from '../../lib/dates'
import { pop, usePop } from '../../lib/motion'
import { askedMost, askerIds, askLine, facts, themeChips, unanswered, type Question } from '../../lib/qanda'
import { useRaise } from '../data'
import { NestEmpty } from '../illustrations'
import { useUI } from '../raise-ui'
import { ViewSkeleton } from '../system/Skeleton'
import { Button, Card, Chip } from '../ui'
import { useNextDeck, useQanda } from './data'
import { openPanel } from './panels'
import { useQandaActions } from './useQandaActions'

const SHOWN_ASKERS = 3

export function Bank() {
  const { loaded, questions, noteCount } = useQanda()
  const [theme, setTheme] = useState<string | null>(null)
  if (!loaded) return <ViewSkeleton />
  const chips = themeChips(questions)
  const at = theme && chips.some((c) => c.theme === theme) ? theme : null
  const fresh = unanswered(questions)
  const cards = askedMost(questions, at)
  const gaps = questions.filter((q) => q.deckGap).sort((a, b) => a.deckGap!.at - b.deckGap!.at)

  return (
    <section className="qa" aria-label="Questions investors ask">
      <Facts questions={questions} noteCount={noteCount} />
      <header className="qa-head">
        <div>
          <h2 className="qa-h2">Questions investors ask</h2>
          <p className="qa-lede">From your meeting notes. Write the best answer once and reuse it.</p>
        </div>
        <Button variant="primary" className="qa-head__add" onClick={() => openPanel({ kind: 'new' })}>
          Add a question
        </Button>
      </header>
      {!questions.length ? (
        <Empty />
      ) : (
        <>
          <div className="qa-chips" role="group" aria-label="Show a theme">
            <button type="button" className={`chip qa-chip${at ? '' : ' chip--selected'}`} aria-pressed={!at} onClick={(e) => (pop(e.currentTarget), setTheme(null))}>
              All <span className="num">{questions.length}</span>
            </button>
            {chips.map((c) => (
              <button key={c.theme} type="button" className={`chip qa-chip${at === c.theme ? ' chip--selected' : ''}`} aria-pressed={at === c.theme} onClick={(e) => (pop(e.currentTarget), setTheme(c.theme))}>
                {c.theme} <span className="num">{c.n}</span>
              </button>
            ))}
          </div>
          {fresh.length ? <NewFromMeetings list={fresh} /> : null}
          <h3 className="qa-h3">{at ? `Asked most · ${at}` : 'Asked most'}</h3>
          {cards.length ? (
            <div className="qa-grid">
              {cards.map((q, i) => (
                <QuestionCard key={q._id} q={q} i={i} />
              ))}
            </div>
          ) : (
            <p className="qa-none">{at ? `No answered questions in ${at} yet.` : 'No answers written yet. Start with the questions above.'}</p>
          )}
          {gaps.length ? <DeckGaps list={gaps} /> : null}
        </>
      )}
    </section>
  )
}

function Facts({ questions, noteCount }: { questions: Question[]; noteCount: number }) {
  const f = facts(questions, noteCount)
  const qRef = usePop<HTMLSpanElement>(f.questions)
  const needRef = usePop<HTMLSpanElement>(f.needAnswer)
  const slideRef = usePop<HTMLSpanElement>(f.onSlide)
  return (
    <Card riseIndex={0} className="qa-facts" aria-label="The bank in numbers">
      <dl className="qa-facts__row">
        <div className="qa-fact">
          <dt className="eyebrow-mono">Questions</dt>
          <dd ref={qRef} className="qa-fact__v num">
            {f.questions}
          </dd>
        </div>
        <div className="qa-fact">
          <dt className="eyebrow-mono">From meetings</dt>
          <dd className="qa-fact__v">
            <span className="num">{f.fromMeetings}</span> {f.fromMeetings === 1 ? 'note' : 'notes'}
          </dd>
        </div>
        <div className="qa-fact">
          <dt className="eyebrow-mono">Need an answer</dt>
          <dd ref={needRef} className={`qa-fact__v num${f.needAnswer ? ' qa-fact__v--hot' : ''}`}>
            {f.needAnswer}
          </dd>
        </div>
        <div className="qa-fact">
          <dt className="eyebrow-mono">On a slide</dt>
          <dd ref={slideRef} className="qa-fact__v qa-fact__v--good">
            <span className="num">{f.onSlide}</span> of <span className="num">{f.questions}</span>
          </dd>
        </div>
        <div className="qa-fact">
          <dt className="eyebrow-mono">Wispr Flow</dt>
          <dd className="qa-fact__v qa-fact__v--muted">Paste notes for now</dd>
        </div>
      </dl>
    </Card>
  )
}

function NewFromMeetings({ list }: { list: Question[] }) {
  const { investors } = useRaise()
  const names = useMemo(() => new Map(investors.map((i) => [i._id, i.name])), [investors])
  const today = todayIST()
  const countRef = usePop<HTMLSpanElement>(list.length)
  return (
    <Card riseIndex={1} tone="peach" className="qa-new" aria-labelledby="qa-new-title">
      <header className="qa-new__head">
        <h3 id="qa-new-title" className="qa-new__title">
          New from meetings
        </h3>
        <Chip tone="waiting" className="qa-new__count">
          <span ref={countRef} className="num">
            {list.length}
          </span>
          <span className="only-desk">need{list.length === 1 ? 's' : ''} an answer</span>
        </Chip>
      </header>
      <ul className="qa-new__list">
        {list.map((q) => {
          const last = [...q.asks].sort((a, b) => b.date.localeCompare(a.date))[0]
          return (
            <li key={q._id} className="qa-new__row m-rise">
              <button type="button" className="qa-new__q" onClick={() => openPanel({ kind: 'answer', id: q._id })}>
                {q.text}
              </button>
              <span className="qa-new__meta">{last ? askLine(last, names.get(last.investorId) ?? 'Someone', today) : 'Added by hand'}</span>
              <span className="qa-new__actions">
                <button type="button" className="qa-textbtn" onClick={() => openPanel({ kind: 'same', id: q._id })}>
                  Same as another
                </button>
                <Button variant="secondary" size="sm" className="qa-new__answer" onClick={() => openPanel({ kind: 'answer', id: q._id })}>
                  Answer
                </Button>
              </span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function QuestionCard({ q, i }: { q: Question; i: number }) {
  const { investors } = useRaise()
  const ui = useUI()
  const acts = useQandaActions()
  const next = useNextDeck()
  const who = askerIds(q)
    .map((id) => investors.find((x) => x._id === id))
    .filter((x): x is NonNullable<typeof x> => !!x)
  const more = who.length - SHOWN_ASKERS
  const edit = () => openPanel({ kind: 'answer', id: q._id })
  return (
    <Card as="article" riseIndex={Math.min(i + 2, 8)} className="qa-card">
      <span className={`qa-count${q.askedCount >= 5 ? ' qa-count--hot' : ''}`} aria-label={`Asked ${q.askedCount} times`}>
        {q.askedCount}×
      </span>
      <div className="qa-card__main">
        <div className="qa-card__top">
          <h4 className="qa-card__q">
            <button type="button" className="qa-card__open" onClick={edit}>
              {q.text}
            </button>
          </h4>
          <Chip tone="outline" dot={false} className="qa-card__theme">
            {q.theme}
          </Chip>
        </div>
        {who.length ? (
          <p className="qa-card__by">
            Asked by{' '}
            {who.slice(0, SHOWN_ASKERS).map((x, k) => (
              <span key={x._id}>
                {k ? ', ' : ''}
                <button type="button" className="qa-card__who" onClick={() => ui.open(x._id)}>
                  {x.name}
                </button>
              </span>
            ))}
            {more > 0 ? ` +${more}` : ''}
          </p>
        ) : null}
        <p className="qa-card__answer">{q.bestAnswer}</p>
        <div className="qa-card__foot">
          <p className="qa-card__slide">
            <span className="eyebrow-mono qa-card__slide-label">Slide</span>
            {q.slideRef ? <span className="qa-slide">{q.slideRef}</span> : <span className="qa-slide qa-slide--none">Not on a slide</span>}
          </p>
          {q.onDeck ? null : q.deckGap ? (
            <button type="button" className="chip chip--waiting qa-card__gap" onClick={() => void acts.removeFromDeck(q)} title="Take it off the list">
              On the deck v{q.deckGap.deck} list
            </button>
          ) : (
            <Button variant="secondary" size="sm" className="qa-card__deck" onClick={() => void acts.addToDeck(q)}>
              Add to deck v{next}
            </Button>
          )}
          <button type="button" className="qa-textbtn qa-card__edit" onClick={edit}>
            Edit answer
          </button>
        </div>
      </div>
    </Card>
  )
}

function DeckGaps({ list }: { list: Question[] }) {
  const acts = useQandaActions()
  const next = useNextDeck()
  const deck = list[0]?.deckGap?.deck ?? next
  return (
    <Card riseIndex={3} tone="paper" className="qa-gaps" aria-labelledby="qa-gaps-title">
      <header className="qa-gaps__head">
        <h3 id="qa-gaps-title" className="qa-h3">
          Deck gaps · for v{deck}
        </h3>
        <p className="qa-lede">What investors ask that no slide answers yet.</p>
      </header>
      <ul className="qa-gaps__list">
        {list.map((q) => (
          <li key={q._id} className="qa-gaps__row">
            <button type="button" className="qa-gaps__q" onClick={() => openPanel({ kind: 'answer', id: q._id })}>
              {q.text}
            </button>
            <span className="qa-gaps__meta">Asked {q.askedCount}×</span>
            <button type="button" className="qa-textbtn" onClick={() => void acts.removeFromDeck(q)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Empty() {
  return (
    <Card riseIndex={1} className="qa-empty">
      <NestEmpty size={88} />
      <div>
        <p className="qa-empty__title">No questions in the bank yet.</p>
        <p>Open an investor, paste your meeting notes in the Notes tab and pick the lines that were questions. Or add one here.</p>
      </div>
    </Card>
  )
}
