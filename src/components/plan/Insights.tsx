// PST-284: Plan › Insights (screens/raise-plan/insights.png). Everything comes
// from Nest's own data (src/lib/insights.ts); no AI.
import { Link } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { todayIST } from '../../lib/dates'
import {
  daysInStage, DWELL_TIP, funnelLeaks, leakLine, leakQuestions, leakQuestionsLine, projectClose, projectionCopy, warmVsCold, type FunnelStep, type PathShare,
} from '../../lib/insights'
import { useInView } from '../../lib/motion'
import { useRaise } from '../data'
import { useQanda } from '../qanda/data'
import { buttonClass } from '../ui'

const pct = (share: number | null) => (share === null ? '–' : `${Math.round(share * 100)}%`)

export function Insights() {
  const { investors, acts, round, roundExists } = useRaise()
  const { questions } = useQanda()
  const today = todayIST()
  const projection = projectClose({ investors, acts, round, today, hasTarget: roundExists })
  const copy = projectionCopy(projection)
  const tone = projection.kind === 'empty' ? 'empty' : projection.kind === 'reached' ? 'reached' : projection.status
  const funnel = funnelLeaks(investors, acts)
  const asked = funnel.leak ? leakQuestions(funnel.leak, investors, acts, questions) : null
  const paths = warmVsCold(investors, acts)
  const dwell = daysInStage(investors, acts, today)
  const tiles = dwell.stages.filter((s) => s.avg !== null)

  return (
    <section className="ins m-rise" aria-labelledby="ins-title">
      <header className="ins-head">
        <h2 id="ins-title">Insights</h2>
        <p>What the numbers say about this round so far. Updated as you work.</p>
      </header>

      <div className={`ins-close ins-close--${tone}`}>
        <div className="ins-close__when">
          <span className="ins-eyebrow">Projected close</span>
          <strong className="ins-close__date m-pop">{copy.title}</strong>
        </div>
        <div className="ins-close__body">
          <p className="ins-close__line">{copy.line}</p>
          <p className="ins-close__next">{copy.next}</p>
        </div>
        {projection.kind === 'pace' ? (
          <Link to="/raise/investors" search={{ sort: 'priority' }} className={buttonClass({ variant: 'primary', className: 'ins-close__btn' })}>
            See who to ask
          </Link>
        ) : projection.kind === 'empty' ? (
          <Link to={projection.noTarget ? '/raise/settings' : '/raise/pipeline'} className={buttonClass({ variant: 'secondary', className: 'ins-close__btn' })}>
            {projection.noTarget ? 'Set up the round' : 'Open Pipeline'}
          </Link>
        ) : null}
      </div>

      <div className="ins-grid">
        <div className="ins-block">
          <h3>Where the funnel leaks</h3>
          <p className="ins-sub">Share who moved on from each stage</p>
          {funnel.steps[0].reached ? (
            <>
              <ul className="ins-funnel">
                {funnel.steps.map((s, i) => (
                  <FunnelRow key={s.from} s={s} leak={s.from === funnel.leak?.from} i={i} />
                ))}
              </ul>
              {funnel.leak ? (
                <div className="ins-leak">
                  <p>
                    {leakLine(funnel.leak)}
                    {asked ? ` ${leakQuestionsLine(asked)}` : ''}
                  </p>
                  {asked ? (
                    <Link to="/raise/qanda" className="ins-link">
                      Open the Q&A bank →
                    </Link>
                  ) : null}
                </div>
              ) : (
                <p className="ins-calm">No stage loses more than a quarter of the people who reach it.</p>
              )}
            </>
          ) : (
            <p className="ins-calm">No asks yet. The funnel fills in as conversations move.</p>
          )}
        </div>

        <div className="ins-block">
          <h3>Warm vs cold</h3>
          <p className="ins-sub">Asks that reached a first meeting</p>
          {paths.warm.asked || paths.cold.asked ? (
            <div className="ins-paths">
              <PathRow label="Warm intro" p={paths.warm} />
              <PathRow label="Cold, no introducer" p={paths.cold} cold />
            </div>
          ) : (
            <p className="ins-calm">No asks yet, warm or cold.</p>
          )}

          <h3 className="ins-block__second">Days in each stage</h3>
          <p className="ins-sub">Average so far</p>
          {tiles.length ? (
            <>
              <ul className="ins-days">
                {tiles.map((s, i) => (
                  <li key={s.stage} className={`ins-day m-rise${s.stage === dwell.slowest?.stage ? ' is-slowest' : ''}`} style={{ '--rise-i': i } as CSSProperties}>
                    <strong>{Math.round(s.avg!)}d</strong>
                    <span>{s.label}</span>
                  </li>
                ))}
              </ul>
              {dwell.slowest ? <p className="ins-tip">{DWELL_TIP[dwell.slowest.stage]}</p> : null}
            </>
          ) : (
            <p className="ins-calm">No stage moves logged yet.</p>
          )}
        </div>
      </div>
    </section>
  )
}

function FunnelRow({ s, leak, i }: { s: FunnelStep; leak: boolean; i: number }) {
  const [ref, seen] = useInView<HTMLSpanElement>()
  return (
    <li className={`ins-funnel__row${leak ? ' is-leak' : ''}`}>
      <span className="ins-funnel__label">{s.label}</span>
      <span className="ins-bar" ref={ref} role="img" aria-label={s.share === null ? `${s.label}: nobody yet` : `${s.label}: ${s.moved} of ${s.reached}`}>
        <span className="ins-bar__fill" style={{ width: seen ? `${(s.share ?? 0) * 100}%` : 0, transitionDelay: `${i * 60}ms` }} />
      </span>
      <span className="ins-funnel__pct">{pct(s.share)}</span>
    </li>
  )
}

function PathRow({ label, p, cold }: { label: string; p: PathShare; cold?: boolean }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  return (
    <div className={`ins-path${cold ? ' is-cold' : ''}`}>
      <div className="ins-path__top">
        <span>{label}</span>
        <span className="ins-path__n">
          {p.met} of {p.asked}
        </span>
      </div>
      <div className="ins-path__bar" ref={ref} role="img" aria-label={`${label}: ${p.met} of ${p.asked} asks reached a first meeting`}>
        <span className="ins-bar__fill" style={{ width: seen ? `${(p.share ?? 0) * 100}%` : 0 }} />
        <span className="ins-path__pct">{pct(p.share)}</span>
      </div>
    </div>
  )
}
