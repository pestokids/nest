// PST-292: Jev's pure parts: name similarity, reading answers, and the thresholds each housekeeping check acts on.
import { describe, expect, it } from 'vitest'
import { estimateTokens, jevCost, jevHash, mostSimilar, noteDecision, noteQuestions, overCap, qaDecision, qaQuestions, readAnswers, trigramSimilarity, whoDecision, whoQuestions } from './jev'

describe('trigramSimilarity', () => {
  it('is 1 for the same words and 0 for nothing shared', () => {
    expect(trigramSimilarity('Juniper Seed', 'juniper  seed')).toBe(1)
    expect(trigramSimilarity('Juniper Seed', 'Harbor Light')).toBe(0)
    expect(trigramSimilarity('', 'x')).toBe(0)
  })
  it('puts a typo above 0.6 and a different firm below it', () => {
    expect(trigramSimilarity('Juniper Seed', 'Junipr Seed')).toBeGreaterThanOrEqual(0.6)
    expect(trigramSimilarity('Kite Angels', 'Kite Angel')).toBeGreaterThanOrEqual(0.6)
    expect(trigramSimilarity('Kite Angels', 'Saltmarsh Angels')).toBeLessThan(0.6)
  })
  it('mostSimilar keeps the closest few above the floor', () => {
    const r = mostSimilar('safe for kids', ['Is it safe for kids?', 'Who else is in?', 'Safe for young kids?'], (x) => x, 1, 0.2)
    expect(r.map((x) => x.item)).toEqual(['Is it safe for kids?'])
  })
})

describe('reading answers', () => {
  const qs = { a: whoQuestions().likely_investor, b: qaQuestions(['x', 'y']).same_as }
  it('types each answer by its question', () => {
    expect(readAnswers(qs, { a: { noul: 0.2 }, b: { choice: 'q1', probabilities: { q0: 0.1, q1: 0.9 }, confidence: 0.8 } })).toEqual({
      a: { type: 'noul', noul: 0.2 },
      b: { type: 'choice', choice: 'q1', probabilities: { q0: 0.1, q1: 0.9 }, confidence: 0.8 },
    })
  })
  it('is null when an answer is missing, the wrong shape or an option it wasn’t given', () => {
    expect(readAnswers(qs, { a: { noul: 0.2 } })).toBeNull()
    expect(readAnswers(qs, { a: { noul: '0.2' }, b: { choice: 'q1', probabilities: {} } })).toBeNull()
    expect(readAnswers(qs, { a: { noul: 0.2 }, b: { choice: 'q9', probabilities: { q9: 1 } } })).toBeNull()
  })
})

describe('cost and the cap', () => {
  it('prices input tokens only, and estimates four characters a token', () => {
    expect(jevCost(1_000_000)).toBeCloseTo(0.042, 12)
    expect(estimateTokens('abcd', { q: 1 })).toBe(Math.ceil((6 + 7) / 4))
    expect(overCap(0.49, 0.02, 0.5)).toBe(true)
    expect(overCap(0.48, 0.02, 0.5)).toBe(false)
  })
  it('hashes the model, state and questions together', async () => {
    const a = await jevHash('jev-latest', 's', { q: 1 })
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await jevHash('jev-latest', 's', { q: 1 })).toBe(a)
    expect(await jevHash('jev-latest', 's2', { q: 1 })).not.toBe(a)
  })
})

describe('thresholds', () => {
  it('Who’s this?: skips the lookup below 0.3', () => {
    expect(whoDecision(0.29)).toBe('skip')
    expect(whoDecision(0.3)).toBe('lookup')
  })
  it('Unmatched notes: attaches at 0.9 with the companion below 0.3, else a hint', () => {
    const q = noteQuestions([{ key: 'i0', label: 'A' }, { key: 'i1', label: 'B' }])
    const a = (top: number, none: number) => readAnswers(q, { investor: { choice: 'i1', probabilities: { i0: 1 - top, i1: top } }, none: { noul: none } })!
    expect(noteDecision(a(0.9, 0.29))).toEqual({ attach: 'i1' })
    expect(noteDecision(a(0.89, 0.1))).toEqual({ hint: 'i1', p: 0.89 })
    expect(noteDecision(a(0.95, 0.3))).toEqual({ hint: 'i1', p: 0.95 })
  })
  it('Q&A repeats: the option at 0.85 with the companion below 0.3', () => {
    const q = qaQuestions(['x', 'y'])
    const a = (top: number, none: number) => readAnswers(q, { same_as: { choice: 'q1', probabilities: { q0: 1 - top, q1: top } }, none: { noul: none } })!
    expect(qaDecision(a(0.85, 0.29))).toBe(1)
    expect(qaDecision(a(0.84, 0.1))).toBeNull()
    expect(qaDecision(a(0.95, 0.3))).toBeNull()
  })
})
