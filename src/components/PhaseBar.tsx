import { phaseSegments } from '../lib/home'
import type { Round } from '../lib/round'
import { phaseDetail, shortPhaseName } from '../lib/today'

/**
 * The round's phases as one bar (Home's Raise card, Today's summary card).
 * `details` adds each phase's dates and headline target; `short` uses phone
 * labels ("W1") and drops "· now".
 */
export function PhaseBar({ round, today, details, short, className }: { round: Round; today: string; details?: boolean; short?: boolean; className?: string }) {
  const segs = phaseSegments(round, today)
  const last = round.phases[round.phases.length - 1]
  return (
    <ol className={['phasebar', className].filter(Boolean).join(' ')} aria-label="Phases">
      {segs.map((s, i) => {
        const p = round.phases[i]
        const close = p === last && p.to >= round.deadline
        return (
          <li key={s.key} className={`phasebar__seg phasebar__seg--${s.state}${close ? ' phasebar__seg--close' : ''}`} style={{ flexGrow: s.grow }}>
            <span className="phasebar__bar" />
            <span className="phasebar__label">
              {short ? shortPhaseName(s.name) : s.name}
              {s.state === 'now' && !short ? ' · now' : ''}
              {s.state === 'now' && short ? <span className="sr-only"> (now)</span> : null}
            </span>
            {details ? <span className="phasebar__detail">{phaseDetail(round, p)}</span> : null}
          </li>
        )
      })}
    </ol>
  )
}
