// PST-279: the morning brief at the top of Today (screens/raise-ai/today-morning-brief.png).
// Built at 08:00 IST (convex/brief.ts): what happened since yesterday and today's
// three moves, each with a reason. It rises in once a day (interactions-ai.png),
// never makes a sound, and stays until Dev dismisses it; then it's one line.
import { useEffect, useState } from 'react'
import { BRIEF_TIME, briefLine, briefStats, moveReason, type Brief } from '../lib/brief'
import { useRaise } from './data'
import { openOnKey, useUI } from './raise-ui'
import { useSaveAction } from './system/useSaveAction'
import { Icon } from './ui'

const ROSE_KEY = 'nest_brief_rose'
const roseOn = () => {
  try {
    return localStorage.getItem(ROSE_KEY)
  } catch {
    return null
  }
}

const COUNT = ['no moves', 'one move', 'two moves', 'three moves']

export function MorningBrief() {
  const { brief } = useRaise()
  return brief ? <BriefCard key={brief._id} b={brief} /> : null
}

function BriefCard({ b }: { b: Brief }) {
  const d = useRaise()
  const ui = useUI()
  const save = useSaveAction()
  // Rises the first time it shows each day (this device), then just sits there.
  const [rise] = useState(() => roseOn() !== b.day)
  useEffect(() => {
    if (!rise) return
    try {
      localStorage.setItem(ROSE_KEY, b.day)
    } catch {
      /* private mode */
    }
  }, [rise, b.day])
  // Collapsing shows at once; the write follows (and puts it back if it fails).
  const [shown, setShown] = useState<boolean | null>(null)
  const open = shown ?? !b.dismissedAt
  const set = (to: boolean) => {
    setShown(to)
    void save(() => d.setBriefDismissed(b._id, !to), { failMessage: 'Couldn’t save that.', onError: () => void setShown(null) })
  }
  const motion = rise ? ' m-rise' : ''

  if (!open)
    return (
      <section className={'brief-line' + motion} aria-label="Morning brief">
        <Icon name="spark" size={16} className="enrich-spark" />
        <span className="brief-line__eyebrow eyebrow-mono">Morning brief</span>
        <span className="brief-line__text">{briefLine(b.since)}</span>
        <button type="button" className="brief-line__show" onClick={() => set(true)}>
          Show
        </button>
      </section>
    )

  const stats = briefStats(b.since)
  return (
    <section className={'brief' + motion} aria-labelledby="brief-title">
      <header className="brief__head">
        <div>
          <p className="brief__eyebrow eyebrow-mono">
            <Icon name="spark" size={16} className="enrich-spark" />
            Morning brief · {BRIEF_TIME}
          </p>
          <h2 id="brief-title" className="brief__title">
            Since yesterday
          </h2>
        </div>
        <button type="button" className="brief__x" onClick={() => set(false)} aria-label="Dismiss the morning brief">
          <Icon name="close" size={18} />
        </button>
      </header>
      <ul className="brief__stats">
        {stats.map((s) => (
          <li key={s.key} className="brief__stat">
            <span className="brief__n num">{s.n}</span>
            <span className="brief__label">{s.label}</span>
            <span className="brief__sub">{s.sub}</span>
          </li>
        ))}
      </ul>
      {b.moves.length ? (
        <div className="brief__moves-wrap">
          <h3 className="brief__h3">Today’s {COUNT[b.moves.length] ?? b.moves.length + ' moves'}, and why</h3>
          <ol className="brief__moves">
            {b.moves.map((m, i) => {
              const id = m.investorId && d.investors.some((x) => x._id === m.investorId) ? m.investorId : null
              const body = (
                <>
                  <span className="brief__move-n">{i + 1}</span>
                  <span className="brief__move-title">{m.title}</span>
                  <span className="brief__move-why">{moveReason(m)}</span>
                </>
              )
              return (
                <li key={m.key} className="brief__move">
                  {id ? (
                    <div className="brief__move-in brief__move-in--open" role="button" tabIndex={0} onClick={() => ui.open(id)} onKeyDown={openOnKey(() => ui.open(id))} aria-label={`${m.title}. Open`}>
                      {body}
                    </div>
                  ) : (
                    <div className="brief__move-in">{body}</div>
                  )}
                </li>
              )
            })}
          </ol>
        </div>
      ) : null}
    </section>
  )
}
