import { describe, expect, it } from 'vitest'
import type { Fact, Fit } from './enrich'
import type { Investor } from './pipeline'
import { averageCheck, fitsByInvestor, priorities, priority, priorityFactors, PRIORITY_FORMULA, scoreBand } from './priority'

const TODAY = '2026-11-07'
const inv = (o: Partial<Investor> = {}): Investor =>
  ({ _id: 'i', name: 'Kite Angels', firm: '', type: 'Angel', geo: 'India', warmth: 'intro', path: 'Ria', tier: 'B', wave: 1, stage: 'booked', lead: false, nextStep: '', notes: '', source: '', maxStage: 'booked', ...o }) as Investor
const fit = (score: number, reasons: string[]): Fit => ({ score, headline: '', reasons })

describe('priority', () => {
  it('is the weighted product of fit, warmth, check size and recent activity', () => {
    const i = inv({ warmth: 'warm', path: 'Ankur', expected: 100_000, lastTouch: '2026-11-05' })
    expect(priorityFactors(i, fit(92, []), 100_000, TODAY)).toEqual({ fit: 0.92, warmth: 0.9, check: 0.7, activity: 1 })
    // 100 × 0.92^0.35 × 0.9^0.3 × 0.7^0.2 × 1^0.15
    expect(priority(i, fit(92, []), 100_000, TODAY).score).toBe(88)
    expect(PRIORITY_FORMULA).toBe('Priority = fit × warmth × check size × recent activity')
  })

  it('ranks a warm, strong-fit, big-check, active investor above a cold, quiet one', () => {
    const hot = priority(inv({ warmth: 'existing', expected: 250_000, lastTouch: '2026-11-07' }), fit(95, []), 100_000, TODAY).score
    const cold = priority(inv({ warmth: 'cold', path: 'Applied', expected: 25_000, lastTouch: '2026-10-01' }), fit(30, []), 100_000, TODAY).score
    expect(hot).toBeGreaterThan(90)
    expect(cold).toBeLessThan(45)
    expect(hot).toBeLessThanOrEqual(100)
    expect(cold).toBeGreaterThan(0)
  })

  it('puts unknowns in the middle, and done conversations at the bottom', () => {
    expect(priorityFactors(inv({ stage: 'todo', maxStage: 'todo' }), null, null, TODAY)).toEqual({ fit: 0.55, warmth: 0.6, check: 0.5, activity: 0.55 })
    expect(priorityFactors(inv({ stage: 'ask' }), null, null, TODAY).activity).toBe(0.4)
    const passed = priority(inv({ stage: 'passed', warmth: 'warm', lastTouch: TODAY }), fit(90, []), null, TODAY).score
    const live = priority(inv({ stage: 'm1', warmth: 'warm', lastTouch: TODAY }), fit(90, []), null, TODAY).score
    expect(passed).toBeLessThan(live)
  })

  it('counts email and meeting touches as activity', () => {
    const i = inv({ lastTouch: '2026-10-01', contact: { email: '2026-11-06' } })
    expect(priorityFactors(i, null, null, TODAY).activity).toBe(1)
  })

  it('shows two or three chips saying why: fit reasons first, then warmth, check size and activity', () => {
    const p = priority(inv({ warmth: 'warm', expected: 50_000, lastTouch: TODAY }), fit(92, ['Kids + consumer', 'Checks $25K–$50K', 'Pre-seed']), 50_000, TODAY)
    expect(p.chips).toEqual([
      { label: 'Kids + consumer', tone: 'why' },
      { label: 'Checks $25K–$50K', tone: 'why' },
      { label: 'Warm', tone: 'why' },
    ])
    const big = priority(inv({ warmth: 'warm', expected: 250_000, lastTouch: TODAY }), null, 100_000, TODAY)
    expect(big.chips.map((c) => c.label)).toEqual(['Warm', '$250K check', 'Active this week'])
    expect(priority(inv({ warmth: 'cold', path: 'Applied' }), fit(60, ['Pre-seed']), null, TODAY).chips).toEqual([
      { label: 'Pre-seed', tone: 'why' },
      { label: 'Cold', tone: 'cold' },
    ])
  })

  it('adds a conflict chip when the Fit reasons flag one', () => {
    const p = priority(inv(), fit(40, ['B2B focus', 'Possible conflict: a competitor in their portfolio']), null, TODAY)
    expect(p.chips).toEqual([
      { label: 'B2B focus', tone: 'why' },
      { label: 'Possible conflict', tone: 'conflict' },
    ])
    expect(priority(inv(), fit(40, ['B2B focus']), null, TODAY).chips.some((c) => c.tone === 'conflict')).toBe(false)
  })

  it('bands the score for the pill', () => {
    expect([92, 80, 79, 55, 54, 0].map(scoreBand)).toEqual(['high', 'high', 'mid', 'mid', 'low', 'low'])
  })
})

describe('the round’s average check and every investor’s priority', () => {
  it('averages Expected over investors that have one', () => {
    expect(averageCheck([{ expected: 100_000 }, { expected: 50_000 }, {}])).toBe(75_000)
    expect(averageCheck([{}])).toBeNull()
  })

  it('scores everyone against that average', () => {
    const list = [inv({ _id: 'a', expected: 200_000 }), inv({ _id: 'b', expected: 50_000 })]
    const p = priorities(list, {}, TODAY)
    expect(p.get('a')!.score).toBeGreaterThan(p.get('b')!.score)
  })

  it('works out Fit from each investor’s kept fund facts only', () => {
    const f = (investorId: string, field: string, value: string, status: Fact['status'] = 'kept', amount?: number): Fact =>
      ({ _id: field + investorId, runId: 'r', investorId, group: 'fund', field, value, source: 'https://example.com', confidence: 0.9, status, amount, keptAt: 1 })
    const facts = [
      f('a', 'stage', 'Pre-seed'), f('a', 'check', '$50K', 'kept', 50_000), f('a', 'thesis', 'Kids and consumer'),
      f('b', 'stage', 'Pre-seed', 'pending'), f('b', 'thesis', 'Kids', 'pending'),
    ]
    const fits = fitsByInvestor(facts, { target: 1_000_000, minCheck: 25_000 })
    expect(Object.keys(fits)).toEqual(['a'])
    expect(fits.a.score).toBe(81)
    expect(fits.a.reasons).toEqual(['Pre-seed', 'Kids + consumer', 'Checks $50K'])
  })
})
