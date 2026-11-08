// PST-296: the fit score's weights, the facts Jev reads, the hash that skips an
// unchanged rescore, and Priority with and without Jev. Made-up investors only.
import { describe, expect, it } from 'vitest'
import type { Fact } from './enrich'
import { factsHash, FIT_PARTS, FIT_WEIGHTS, fitQuestions, fitScore, investorFacts, needsRescore, roundFacts, type FitAnswers } from './fitScore'
import { priorities, withJev } from './priority'
import type { ScoreAnswer } from './jev'

/** Jev's answers at these positions (0 is the lowest level). */
function answers(at: Record<keyof typeof FIT_WEIGHTS, number>): FitAnswers {
  const a = (score: number): ScoreAnswer => ({ type: 'score', score, legend: {}, probabilities: {}, confidence: 0.8 })
  return { stage: a(at.stage), check: a(at.check), thesis: a(at.thesis), activity: a(at.activity) }
}
const top = { stage: 2, check: 2, thesis: 3, activity: 3 }
const fact = (field: string, value: string, o: Partial<Fact> = {}): Fact => ({ _id: field + value, runId: 'r', investorId: 'i', group: 'fund', field, value, source: 'https://example.com', confidence: 0.9, status: 'kept', keptAt: 1, ...o })

describe('fitScore', () => {
  it('weighs stage and thesis most, then check size, then recent activity, adding up to 1', () => {
    expect(FIT_WEIGHTS).toEqual({ stage: 0.3, check: 0.25, thesis: 0.3, activity: 0.15 })
    expect(FIT_PARTS.reduce((s, k) => s + FIT_WEIGHTS[k], 0)).toBeCloseTo(1, 10)
  })

  it('is 100 at the top of every scale and 0 at the bottom', () => {
    expect(fitScore(answers(top)).score).toBe(100)
    expect(fitScore(answers({ stage: 0, check: 0, thesis: 0, activity: 0 })).score).toBe(0)
  })

  it('reads each answer as its position over the top level, and weighs it', () => {
    const f = fitScore(answers({ stage: 2, check: 2, thesis: 3, activity: 0 }))
    expect(f.parts).toEqual({ stage: 1, check: 1, thesis: 1, activity: 0 })
    expect(f.score).toBe(85)
    // A score between two levels (Jev's 1.43 of 0–2) counts in between.
    expect(fitScore(answers({ stage: 1.43, check: 0, thesis: 0, activity: 0 })).parts.stage).toBeCloseTo(0.715, 10)
    // Out of range is held to 0–1.
    expect(fitScore(answers({ stage: 9, check: -1, thesis: 0, activity: 0 })).parts).toMatchObject({ stage: 1, check: 0 })
  })

  it('so a thesis match counts twice what recent activity does', () => {
    const thesisOnly = fitScore(answers({ stage: 0, check: 0, thesis: 3, activity: 0 })).score
    const activeOnly = fitScore(answers({ stage: 0, check: 0, thesis: 0, activity: 3 })).score
    expect([thesisOnly, activeOnly]).toEqual([30, 15])
  })

  it('asks four Score questions with their levels low to high', () => {
    const q = fitQuestions()
    expect(Object.keys(q)).toEqual(['stage', 'check', 'thesis', 'activity'])
    expect(Object.values(q).every((x) => x.type === 'score' && x.criteria.length >= 3)).toBe(true)
  })
})

describe('what Jev reads', () => {
  it('gives the round as stage, size and check range from the settings, with no investor in it', () => {
    expect(roundFacts({ target: 1_000_000, minCheck: 25_000, instrument: 'post-money SAFE' })).toEqual({
      stage: 'Pre-seed', instrument: 'post-money SAFE', round_size_usd: 1_000_000, check_min_usd: 25_000, check_max_usd: 250_000, focus: expect.any(Array),
    })
  })

  it('takes an investor’s latest kept fund facts and nothing pending or dismissed', () => {
    const facts = [
      fact('stage', 'Seed', { keptAt: 1 }),
      fact('stage', 'Pre-seed and seed', { keptAt: 2 }),
      fact('check', '$25K–$50K', { amount: 35_000 }),
      fact('thesis', 'Robots', { status: 'pending' }),
      fact('geography', 'Mars', { status: 'dismissed' }),
    ]
    expect(investorFacts('Pebblebrook Angels', 'Angel', facts)).toEqual({ name: 'Pebblebrook Angels', type: 'Angel', stage: 'Pre-seed and seed', check: '$25K–$50K', check_usd: 35_000 })
    expect(investorFacts('Pebblebrook Angels', 'Angel', [fact('thesis', 'Kids', { status: 'pending' })])).toBeNull()
  })
})

describe('the enrichment hash', () => {
  const round = roundFacts({ target: 1_000_000, minCheck: 25_000, instrument: 'post-money SAFE' })
  const investor = { name: 'Pebblebrook Angels', type: 'Angel', stage: 'Pre-seed' }

  it('is the same for the same facts and changes when one does, so only a change asks Jev again', async () => {
    const a = await factsHash({ round, investor })
    expect(await factsHash({ round, investor: { ...investor } })).toBe(a)
    const b = await factsHash({ round, investor: { ...investor, stage: 'Seed' } })
    expect(b).not.toBe(a)
    expect(needsRescore({ hash: a }, a)).toBe(false)
    expect(needsRescore({ hash: a }, b)).toBe(true)
    expect(needsRescore(null, a)).toBe(true)
  })
})

describe('Priority with Jev', () => {
  const inv = [
    { _id: 'a', name: 'Alder', stage: 'todo' as const, warmth: 'warm' as const, path: 'Ria', expected: 50_000 },
    { _id: 'b', name: 'Birch', stage: 'todo' as const, warmth: 'warm' as const, path: 'Ria', expected: 50_000 },
  ]
  const fits = { a: { score: 40, headline: '', reasons: ['Seed'] }, b: { score: 70, headline: '', reasons: ['Pre-seed'] } }

  it('uses the Jev fit score in place of the light Fit, keeping the Fit’s reasons as chips', () => {
    const p = priorities(inv, fits, '2026-11-08', { a: 95 })
    expect(p.get('a')!.score).toBeGreaterThan(p.get('b')!.score)
    expect(p.get('a')!.chips[0]).toEqual({ label: 'Seed', tone: 'why' })
    expect(withJev(undefined, 80)).toEqual({ score: 80, headline: '', reasons: [] })
  })

  it('without a Jev score (null from Jev, or never asked) is exactly the Priority it was', () => {
    expect([...priorities(inv, fits, '2026-11-08', {})]).toEqual([...priorities(inv, fits, '2026-11-08')])
    expect(withJev(fits.a, undefined)).toBe(fits.a)
  })
})
