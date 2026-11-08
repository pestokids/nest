import { createFileRoute, Link } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { useRaise } from '../../../components/data'
import { Insights } from '../../../components/plan/Insights'
import { useHitShine } from '../../../components/plan/targetHits'
import { buttonClass, Chip } from '../../../components/ui'
import { formatDay, todayIST } from '../../../lib/dates'
import { money } from '../../../lib/money'
import { useInView } from '../../../lib/motion'
import { amountLabel, phaseStatuses, progressLine, type PhaseView } from '../../../lib/plan'
import { currentPhase, targetValue, type Phase, type Round } from '../../../lib/round'
import { ACTIVE } from '../../../lib/stages'
import type { Investor } from '../../../lib/pipeline'

export const Route = createFileRoute('/_app/raise/plan')({ component: Plan })

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const md = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number)
  return { m: MONTHS[m - 1] ?? '', d }
}
/** "NOV 6–10", "NOV 30–DEC 4". */
function rangeLabel(from: string, to: string) {
  const a = md(from)
  const b = md(to)
  return a.m === b.m ? `${a.m} ${a.d}–${b.d}` : `${a.m} ${a.d}–${b.m} ${b.d}`
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** A phase's line when nobody wrote one: its targets in words. */
function goalSentence(round: Round, p: Phase) {
  if (p.goal?.trim()) return p.goal.trim()
  if (!p.targets.length) return p.todo[0] ?? ''
  return cap(p.targets.map((t) => `${amountLabel(t.m, targetValue(round, t))}${t.m === 'committed' ? ' committed' : t.m === 'signed' ? ' signed' : ''}`).join(', ')) + '.'
}

function Plan() {
  const { investors, acts, round } = useRaise()
  const today = todayIST()
  const views = phaseStatuses(round, investors, acts, today)
  const cur = round.phases.find((p) => today >= p.from && today <= p.to)
  const where = cur ? cur.name : today < (round.phases[0]?.from ?? round.kickoff) ? 'Before kickoff' : currentPhase(round, today) ? 'Wrapping up' : ''

  return (
    <section className="plan">
      <Insights />
      <div className="plan-strip m-rise">
        <Cell label="Target" value={money(round.target)} />
        <Cell label="Room to" value={money(round.stretch)} />
        <Cell label="Instrument" value={cap(round.instrument)} />
        <Cell label="Close by" value={formatDay(round.deadline)} />
        <Cell label="Today" value={`${formatDay(today)}${where ? ` · ${where}` : ''}`} today />
      </div>

      <header className="plan-head">
        <div>
          <h2>Phases</h2>
          <p>Each phase has one goal. Hit it, and the next phase starts strong.</p>
        </div>
        <Link to="/raise/settings" className={buttonClass({ variant: 'secondary' })}>
          Edit phases and waves
        </Link>
      </header>
      <div className="plan-phases" style={{ '--n': Math.max(1, views.length) } as CSSProperties}>
        {views.map((v, i) => (
          <PhaseCard key={v.phase.k} v={v} goal={goalSentence(round, v.phase)} i={i} />
        ))}
        {!views.length ? <p className="plan-empty">No phases yet. Add them in Settings.</p> : null}
      </div>

      <header className="plan-head">
        <div>
          <h2>Waves</h2>
          <p>Who you ask, and when. Closest first; a yes from them makes the next ask easier.</p>
        </div>
      </header>
      <div className="plan-waves">
        {round.waves.map((label, i) => (
          <WaveCard key={i} n={i + 1} label={label} round={round} investors={investors} />
        ))}
      </div>
    </section>
  )
}

function Cell({ label, value, today }: { label: string; value: string; today?: boolean }) {
  return (
    <div className="plan-cell">
      <span className="plan-cell__label">{label}</span>
      <span className={`plan-cell__value${today ? ' plan-cell__value--today' : ''}`}>{value}</span>
    </div>
  )
}

const CHIP: Record<PhaseView['state'], { label: string; tone: 'live' | 'outline' | 'muted' | 'success' | 'waiting' }> = {
  now: { label: 'Now', tone: 'live' },
  next: { label: 'Next', tone: 'outline' },
  later: { label: 'Later', tone: 'muted' },
  hit: { label: 'Hit', tone: 'success' },
  done: { label: 'Done', tone: 'muted' },
  missed: { label: 'Missed', tone: 'waiting' },
}

function PhaseCard({ v, goal, i }: { v: PhaseView; goal: string; i: number }) {
  const shineRef = useHitShine<HTMLDivElement>(v.phase.k)
  const [barRef, seen] = useInView<HTMLDivElement>()
  const chip = CHIP[v.state]
  return (
    <article className={`plan-phase plan-phase--${v.state} m-rise`} style={{ '--rise-i': i } as CSSProperties} ref={shineRef}>
      <Chip tone={chip.tone} className="plan-phase__chip" dot={v.state === 'now' || v.state === 'hit' || v.state === 'missed'}>
        {chip.label}
      </Chip>
      <h3 className="plan-phase__name">{v.phase.name}</h3>
      <p className="plan-phase__dates">{rangeLabel(v.phase.from, v.phase.to)}</p>
      <p className="plan-phase__goal">{goal}</p>
      <div className="plan-phase__foot">
        <div className="plan-bar" ref={barRef} role="progressbar" aria-label={`${v.phase.name} goal`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v.pct)}>
          <span className="plan-bar__fill" style={{ width: seen ? `${Math.max(v.pct, v.actual > 0 ? 2 : 0)}%` : 0 }} />
        </div>
        <p className="plan-phase__progress">{progressLine(v)}</p>
      </div>
    </article>
  )
}

function WaveCard({ n, label, round, investors }: { n: number; label: string; round: Round; investors: Investor[] }) {
  const inWave = investors.filter((i) => i.wave === n)
  const phase = round.phases.find((p) => p.name.trim().toLowerCase() === label.trim().toLowerCase()) ?? round.phases[n]
  const date = phase ? md(phase.from) : null
  const angels = inWave.filter((i) => i.type === 'Angel' || i.type === 'Large angel').length
  const accel = inWave.filter((i) => i.type === 'Accelerator').length
  const funds = inWave.length - angels - accel
  const talking = inWave.filter((i) => ACTIVE.has(i.stage)).length
  const mix = [angels && `${angels} angel${angels === 1 ? '' : 's'}`, funds && `${funds} fund${funds === 1 ? '' : 's'}`, accel && `${accel} accelerator${accel === 1 ? '' : 's'}`].filter(Boolean).join(', ')
  return (
    <article className={`plan-wave plan-wave--${Math.min(n, 3)}`}>
      <div className="plan-wave__top">
        <h3>{label || `Wave ${n}`}</h3>
        <span className="plan-wave__count">
          {inWave.length} name{inWave.length === 1 ? '' : 's'}
        </span>
      </div>
      {date ? (
        <p className="plan-wave__when">
          {date.m} {date.d} · {phase.name}
        </p>
      ) : null}
      <p className="plan-wave__about">{inWave.length ? `${cap(mix)}. ${talking ? `${talking} in conversation.` : 'Nobody asked yet.'}` : 'Nobody in this wave yet.'}</p>
      <Link to="/raise/investors" search={{ wave: n as 1 | 2 | 3 }} className="plan-wave__link">
        Open in Investors →
      </Link>
    </article>
  )
}
