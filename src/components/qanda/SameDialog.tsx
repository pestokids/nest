// PST-281: "Same as another" on a new question: pick the question in the bank it
// repeats, and it merges in with every ask (Undo in the toast).
import { useState } from 'react'
import { matchScore } from '../../lib/palette'
import { similarQuestions, type Question } from '../../lib/qanda'
import { Modal, useTitleId } from '../system/Modal'
import { Icon } from '../ui'
import { useQanda } from './data'
import { useQandaActions } from './useQandaActions'

export function SameDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { questions } = useQanda()
  const acts = useQandaActions()
  const titleId = useTitleId()
  const [find, setFind] = useState('')
  const q = questions.find((x) => x._id === id)
  if (!q) return null
  const similar = similarQuestions(q, questions, 3)
  const others = questions.filter((o) => o._id !== q._id)
  const query = find.trim()
  const shown: { o: Question; similar: boolean }[] = query
    ? others
        .map((o) => ({ o, s: Math.max(matchScore(o.text, query), o.text.toLowerCase().includes(query.toLowerCase()) ? 30 : 0) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8)
        .map(({ o }) => ({ o, similar: similar.includes(o) }))
    : [...similar.map((o) => ({ o, similar: true })), ...others.filter((o) => !similar.includes(o)).sort((a, b) => b.askedCount - a.askedCount).slice(0, 8 - similar.length).map((o) => ({ o, similar: false }))]

  const pick = async (o: Question) => {
    if (await acts.merge(q, o)) onClose()
  }
  return (
    <Modal onClose={onClose} labelledBy={titleId} className="qa-same">
      <header className="qa-same__head">
        <p className="eyebrow-mono qa-eyebrow--new">Same as another</p>
        <h2 id={titleId} className="qa-same__title">
          Which question is it?
        </h2>
        <p className="qa-same__q">“{q.text}”</p>
        <button type="button" className="sg-dialog__close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={22} />
        </button>
      </header>
      <div className="qa-same__find">
        <Icon name="search" size={18} />
        <input className="qa-same__input" placeholder="Search the bank" aria-label="Search the bank" value={find} onChange={(e) => setFind(e.target.value)} data-autofocus autoComplete="off" />
      </div>
      <ul className="qa-same__list">
        {shown.map(({ o, similar: like }) => (
          <li key={o._id}>
            <button type="button" className="qa-same__row" onClick={() => void pick(o)}>
              <span className="qa-same__text">
                <span className="qa-same__rq">{o.text}</span>
                <span className="qa-same__meta">
                  {like ? 'Looks similar · ' : ''}Asked {o.askedCount}× · {o.theme}
                </span>
              </span>
              <span className="qa-same__go">Merge</span>
            </button>
          </li>
        ))}
        {!shown.length ? <li className="qa-same__none">Nothing in the bank matches “{query}”.</li> : null}
      </ul>
      <p className="qa-same__note">Merging keeps every investor who asked either one, and the answer already written.</p>
    </Modal>
  )
}
