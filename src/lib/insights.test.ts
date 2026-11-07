import { describe, expect, it } from 'vitest'
import {
  daysInStage, DWELL_TIP, funnelLeaks, isColdPath, leakLine, leakQuestions, leakQuestionsLine, MIN_HISTORY_DAYS, projectClose, projectionCopy, stalledAt, warmVsCold,
} from './insights'
import type { Activity, Investor } from './pipeline'
import { DEFAULT_ODDS } from './round'
import type { Stage } from './stages'
import { addDays } from './today'

const TODAY = '2026-11-07'
const inv = (id: string, stage: Stage, o: Partial<Investor> = {}): Investor =>
  ({
    _id: id, name: o.name ?? id, firm: '', type: 'Angel', geo: 'India', warmth: 'intro', path: 'Ria', tier: 'B', wave: 1, stage, lead: false,
    nextStep: '', notes: '', source: '', maxStage: stage === 'passed' || stage === 'parked' ? 'todo' : stage, ...o,
  }) as Investor
let n = 0
const mv = (investorId: string, stage: Stage, date: string): Activity => ({ _id: 'a' + n++, investorId, kind: 'stage', stage, date })
/** Stage moves for one investor, one per [stage, days ago]. */
const walk = (id: string, steps: [Stage, number][]) => steps.map(([s, ago]) => mv(id, s, addDays(TODAY, -ago)))

describe('funnel leaks', () => {
  const people = [
    inv('a', 'm2'),
    inv('b', 'passed', { maxStage: 'm1' }),
    inv('c', 'm1'),
    inv('d', 'passed', { maxStage: 'ask' }),
    inv('e', 'intro'),
    inv('f', 'todo'),
  ]
  const acts = [
    ...walk('a', [['ask', 30], ['intro', 27], ['booked', 24], ['m1', 20], ['m2', 10]]),
    ...walk('b', [['ask', 30], ['intro', 26], ['booked', 22], ['m1', 18], ['passed', 6]]),
    ...walk('c', [['ask', 25], ['intro', 22], ['booked', 20], ['m1', 15]]),
    ...walk('d', [['ask', 20], ['passed', 5]]),
  ]

  it('shares who reached the next stage of those who reached each one', () => {
    const { steps } = funnelLeaks(people, acts)
    expect(steps.map((s) => [s.label, s.moved, s.reached])).toEqual([
      ['Asked → Intro', 4, 5],
      ['Intro → Booked', 3, 4],
      ['Booked → 1st meeting', 3, 3],
      ['1st → 2nd meeting', 1, 3],
      ['2nd → Diligence', 0, 1],
      ['Diligence → Verbal', 0, 0],
    ])
    expect(steps[0].share).toBe(0.8)
    expect(steps[5].share).toBeNull()
  })

  it('reads stage history, not just the current stage', () => {
    // Passed, with maxStage left at "asked", but the history shows a first meeting.
    const p = [inv('x', 'passed', { maxStage: 'ask' })]
    const { steps } = funnelLeaks(p, walk('x', [['ask', 20], ['intro', 18], ['booked', 15], ['m1', 10], ['passed', 2]]))
    expect(steps[2]).toMatchObject({ reached: 1, moved: 1 })
    expect(steps[3]).toMatchObject({ reached: 1, moved: 0 })
  })

  it('calls out the worst step with enough people through it, in one sentence', () => {
    const { leak } = funnelLeaks(people, acts)
    expect(leak?.from).toBe('m1')
    expect(leakLine(leak!)).toBe('Biggest leak: only 1 of 3 first meetings led to a second.')
    expect(stalledAt(leak!, people, acts).sort()).toEqual(['b', 'c'])
  })

  it('has no leak when every step keeps most people, or too few went through', () => {
    expect(funnelLeaks([inv('a', 'verbal'), inv('b', 'verbal'), inv('c', 'verbal')], []).leak).toBeNull()
    expect(funnelLeaks([inv('a', 'm1'), inv('b', 'ask')], []).leak).toBeNull()
    expect(funnelLeaks([], []).steps.every((s) => s.share === null)).toBe(true)
  })

  it('says none when nobody moved on', () => {
    const p = [inv('a', 'm1'), inv('b', 'm1'), inv('c', 'm1')]
    expect(leakLine(funnelLeaks(p, []).leak!)).toBe('Biggest leak: none of the 3 first meetings led to a second yet.')
  })

  it('links the Q&A bank only when two or more stalled investors asked about the same theme', () => {
    const { leak } = funnelLeaks(people, acts)
    const q = (theme: string, ids: string[]) => ({ theme, asks: ids.map((investorId) => ({ investorId })) })
    const found = leakQuestions(leak!, people, acts, [q('Traction', ['b', 'c']), q('Team', ['b', 'a']), q('Market', ['c'])])
    expect(found).toEqual({ theme: 'Traction', askers: 2, stalled: 2 })
    expect(leakQuestionsLine(found!)).toBe('The Q&A bank shows 2 of them asked about traction.')
    // Only one stalled investor per theme, or askers who got past the leak: no link.
    expect(leakQuestions(leak!, people, acts, [q('Team', ['b', 'a']), q('Market', ['c'])])).toBeNull()
    expect(leakQuestions(leak!, people, acts, [])).toBeNull()
  })
})

describe('warm vs cold', () => {
  it('splits asks by path and counts those that reached a first meeting', () => {
    const people = [
      inv('w1', 'm1', { path: 'Ankur (ex-colleague)' }),
      inv('w2', 'intro', { warmth: 'warm', path: 'Direct' }),
      inv('w3', 'passed', { maxStage: 'm2' }),
      inv('c1', 'ask', { warmth: 'cold', path: 'Applied' }),
      inv('c2', 'm1', { path: 'Applied' }),
      inv('c3', 'booked', { warmth: 'cold', path: '' }),
      inv('n', 'todo', { warmth: 'cold' }),
    ]
    expect(warmVsCold(people, [])).toEqual({ warm: { asked: 3, met: 2, share: 2 / 3 }, cold: { asked: 3, met: 1, share: 1 / 3 } })
  })

  it('treats cold warmth and cold or applied paths as cold', () => {
    expect(isColdPath({ warmth: 'cold', path: 'Ria' })).toBe(true)
    expect(isColdPath({ warmth: 'intro', path: 'Applied' })).toBe(true)
    expect(isColdPath({ warmth: 'intro', path: 'cold email' })).toBe(true)
    expect(isColdPath({ warmth: 'warm', path: 'Applepie Ventures partner' })).toBe(false)
  })

  it('has no share without asks', () => {
    expect(warmVsCold([inv('a', 'todo')], [])).toEqual({ warm: { asked: 0, met: 0, share: null }, cold: { asked: 0, met: 0, share: null } })
  })
})

describe('days in each stage', () => {
  it('averages each stay, counts a current stay up to today, and skips stays with no known end', () => {
    const people = [inv('a', 'm1'), inv('b', 'm2'), inv('c', 'dd')]
    const acts = [
      ...walk('a', [['ask', 20], ['intro', 16], ['booked', 12], ['m1', 10]]), // m1 for 10 days so far
      ...walk('b', [['ask', 30], ['intro', 28], ['booked', 26], ['m1', 24], ['m2', 20]]), // m1: 4 days; m2: 20 so far
      ...walk('c', [['ask', 15], ['intro', 13]]), // now in diligence without a logged move: intro's end is unknown
    ]
    const { stages, slowest } = daysInStage(people, acts, TODAY)
    const by = Object.fromEntries(stages.map((s) => [s.stage, [s.avg, s.n]]))
    expect(by.ask[0]).toBeCloseTo(8 / 3)
    expect(by.ask[1]).toBe(3)
    expect(by.intro).toEqual([3, 2])
    expect(by.booked).toEqual([2, 2])
    expect(by.m1).toEqual([7, 2])
    expect(by.m2).toEqual([20, 1])
    expect(by.dd).toEqual([null, 0])
    expect(slowest?.stage).toBe('m2')
    expect(stages.map((s) => s.label)).toEqual(['Asked', 'Intro', 'Booked', '1st', '2nd', 'DD'])
    expect(DWELL_TIP.m1).toBe('First meetings wait longest for a next step. Set one before you hang up.')
  })

  it('has no slowest stage without history', () => {
    expect(daysInStage([inv('a', 'ask')], [], TODAY).slowest).toBeNull()
  })
})

describe('projected close', () => {
  const round = { target: 1_000_000, deadline: '2026-12-05', odds: DEFAULT_ODDS }
  const base = () => {
    const people = [
      inv('v1', 'verbal', { name: 'Kite Angels', expected: 300_000 }),
      inv('v2', 'verbal', { name: 'Orchard Capital', expected: 200_000 }),
      inv('a1', 'ask', { expected: 50_000 }),
      inv('a2', 'ask', { expected: 50_000 }),
      inv('a3', 'ask', { expected: 50_000 }),
      inv('m', 'm2', { name: 'Lantern Ventures', expected: 75_000 }),
    ]
    const acts = [
      ...walk('v1', [['ask', 28], ['m1', 18], ['verbal', 3]]),
      ...walk('v2', [['ask', 27], ['m1', 20], ['verbal', 13]]),
      ...walk('a1', [['ask', 4]]),
      ...walk('a2', [['ask', 26]]),
      ...walk('a3', [['ask', 20]]),
      ...walk('m', [['ask', 25], ['m2', 9]]),
    ]
    return { people, acts }
  }

  it('says what is missing when there is no history or no target date', () => {
    const { people } = base()
    expect(projectClose({ investors: people, acts: [], round, today: TODAY, hasTarget: true })).toEqual({ kind: 'empty', noTarget: false, noHistory: true, days: 0 })
    const short = walk('a1', [['ask', MIN_HISTORY_DAYS - 4]])
    const p = projectClose({ investors: people, acts: short, round, today: TODAY, hasTarget: true })
    expect(p).toEqual({ kind: 'empty', noTarget: false, noHistory: true, days: 10 })
    expect(projectionCopy(p).line).toBe('Only 10 days of activity so far. Two weeks is enough to project a close.')
    const noTarget = projectClose({ investors: people, acts: base().acts, round, today: TODAY, hasTarget: false })
    expect(noTarget).toMatchObject({ kind: 'empty', noTarget: true, noHistory: false })
    expect(projectionCopy(noTarget).title).toBe('No target date yet')
    expect(projectClose({ investors: people, acts: base().acts, round: { ...round, deadline: '' }, today: TODAY, hasTarget: true })).toMatchObject({ kind: 'empty', noTarget: true })
    expect(projectionCopy({ kind: 'empty', noTarget: true, noHistory: true, days: 0 }).line).toBe('Set the round’s target and close date in Settings.')
  })

  it('is already there when committed reaches the target', () => {
    const { people, acts } = base()
    const p = projectClose({ investors: people, acts, round: { ...round, target: 500_000 }, today: TODAY, hasTarget: true })
    expect(p).toEqual({ kind: 'reached', committed: 500_000, target: 500_000 })
    expect(projectionCopy(p)).toEqual({ title: 'Target reached', line: '$500K committed against your $500K target.', next: 'Now get the SAFEs signed and the money in.' })
  })

  it('projects at this week’s committed pace, on track', () => {
    const { people, acts } = base()
    const p = projectClose({ investors: people, acts, round, today: TODAY, hasTarget: true })
    // $500K to go at $300K a week: 12 days, Nov 19, 16 days early.
    expect(p).toMatchObject({ kind: 'pace', status: 'on', basis: 'committed', weekly: 300_000, projected: '2026-11-19', days: -16, committedThisWeek: 300_000, asksThisWeek: 1, extraAsks: null, convert: [] })
    expect(projectionCopy(p)).toEqual({
      title: 'Thu 19 Nov',
      line: '16 days before your Sat 5 Dec target, at this week’s pace.',
      next: 'On track: 1 ask and $300K committed in the last 7 days.',
    })
  })

  it('falls back to asks a week when nothing was committed this week, and says how to catch up', () => {
    const { people, acts } = base()
    const older = acts.map((a) => (a.investorId === 'v1' && a.stage === 'verbal' ? { ...a, date: addDays(TODAY, -10) } : a))
    const p = projectClose({ investors: people, acts: older, round, today: TODAY, hasTarget: true })
    // An ask has been worth $500K / 6 asks; 1 ask this week → $83,333 a week → 42 days.
    expect(p).toMatchObject({ kind: 'pace', status: 'behind', basis: 'asks', asksThisWeek: 1, projected: '2026-12-19', days: 14 })
    if (p.kind !== 'pace') throw new Error()
    expect(p.needed).toBe(125_000)
    expect(p.extraAsks).toBe(1)
    expect(p.convert).toEqual(['Lantern Ventures'])
    expect(projectionCopy(p)).toEqual({
      title: 'Sat 19 Dec',
      line: '14 days after your Sat 5 Dec target, at this week’s pace of asks.',
      next: 'To get back on track: 1 more ask this week, or turn Lantern Ventures into a verbal.',
    })
  })

  it('is behind once the target date has passed', () => {
    const { people, acts } = base()
    const p = projectClose({ investors: people, acts, round: { ...round, deadline: '2026-11-01' }, today: TODAY, hasTarget: true })
    expect(p).toMatchObject({ kind: 'pace', status: 'behind', projected: '2026-11-19', days: 18, needed: 500_000 })
    expect(projectionCopy(p).line).toBe('18 days after your Sun 1 Nov target, at this week’s pace.')
  })

  it('has no date without a pace, and still says what it takes', () => {
    const { people, acts } = base()
    const quiet = acts.filter((a) => a.date < addDays(TODAY, -7))
    const p = projectClose({ investors: people, acts: quiet, round, today: TODAY, hasTarget: true })
    expect(p).toMatchObject({ kind: 'pace', status: 'behind', projected: null, days: null, weekly: 0 })
    const copy = projectionCopy(p)
    expect(copy.title).toBe('No pace yet')
    expect(copy.line).toBe('Nothing was committed or asked for in the last 7 days, so there’s no pace to project.')
    expect(copy.next).toMatch(/^To get back on track: \d+ more asks this week\.$/)
  })

  it('uses the round odds before anything is committed', () => {
    const people = [inv('a', 'ask', { expected: 100_000 }), inv('b', 'ask', { expected: 100_000 })]
    const acts = [...walk('a', [['ask', 20]]), ...walk('b', [['ask', 2]])]
    const p = projectClose({ investors: people, acts, round, today: TODAY, hasTarget: true })
    // 1 ask this week × $100K × 3% = $3K a week: too slow to show a date.
    expect(p).toMatchObject({ kind: 'pace', basis: 'asks', weekly: 3000, projected: null })
  })
})
