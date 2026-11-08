import { describe, expect, it } from 'vitest'
import { dayDiff, formatDay, todayIST, weekdayOf } from './dates'
import { exactMoney, money } from './money'
import {
  applyAdvance, applySave, committedOf, dueList, funnel, meetingsKpi, mixByType, NEW_INVESTOR, nextList, phaseActual,
  quietList, score, totals, warmPaths, weightedOf, type Investor,
} from './pipeline'
import { currentPhase, DEFAULT_ROUND, diffRound, fieldLabel, mergeRound, targetValue, validateRound, type Round } from './round'
import { exportCsv, parseMoney, previewImport } from './csv'

const inv = (o: Partial<Investor>): Investor => ({ ...NEW_INVESTOR, _id: Math.random().toString(36), maxStage: 'todo', ...o }) as Investor

describe('dates', () => {
  it('today is the Asia/Kolkata calendar date', () => {
    expect(todayIST(Date.parse('2030-01-01T18:29:00Z'))).toBe('2030-01-01')
    expect(todayIST(Date.parse('2030-01-01T18:30:00Z'))).toBe('2030-01-02')
  })
  it('dayDiff', () => {
    expect(dayDiff('2030-02-01', '2030-01-01')).toBe(31)
  })
})

describe('formatDay', () => {
  it('writes a day as "Fri 27 Nov"', () => {
    expect(formatDay('2026-11-27')).toBe('Fri 27 Nov')
    expect(formatDay('2030-01-06')).toBe('Sun 6 Jan')
    expect(formatDay('2030-12-04')).toBe('Wed 4 Dec')
    expect(formatDay('2030-11-11')).toBe('Mon 11 Nov')
  })
  it('reads epoch ms as the IST calendar day', () => {
    expect(formatDay(Date.parse('2026-11-26T18:29:00Z'))).toBe('Thu 26 Nov')
    expect(formatDay(Date.parse('2026-11-26T18:30:00Z'))).toBe('Fri 27 Nov')
    expect(formatDay(Date.parse('2026-12-31T20:00:00Z'))).toBe('Fri 1 Jan')
  })
  it('is "–" when empty or not a day', () => {
    expect(formatDay(undefined)).toBe('–')
    expect(formatDay(null)).toBe('–')
    expect(formatDay('')).toBe('–')
    expect(formatDay('27 Nov')).toBe('–')
    expect(formatDay(NaN)).toBe('–')
  })
  it('gives the short weekday', () => expect(weekdayOf('2026-11-27')).toBe('Fri'))
})

describe('money', () => {
  it('formats like the prototype', () => {
    expect(money(1000000)).toBe('$1M')
    expect(money(1500000)).toBe('$1.5M')
    expect(money(1250000)).toBe('$1.3M')
    expect(money(150000)).toBe('$150K')
    expect(money(40)).toBe('$40')
    expect(money(null)).toBe('$0')
  })
  it('keeps whole tens of millions', () => expect(money(10000000)).toBe('$10M'))
  it('keeps at most one decimal on millions, and never a trailing zero', () => {
    expect(money(1200000)).toBe('$1.2M')
    expect(money(1040000)).toBe('$1M')
    expect(money(1960000)).toBe('$2M')
    expect(money(12340000)).toBe('$12.3M')
  })
  it('rounds to whole thousands and dollars', () => {
    expect(money(149600)).toBe('$150K')
    expect(money(1000)).toBe('$1K')
    expect(money(999.4)).toBe('$999')
    expect(money(999.5)).toBe('$1K')
    expect(money(0)).toBe('$0')
  })
  it('rolls over from K to M', () => {
    expect(money(999499)).toBe('$999K')
    expect(money(999500)).toBe('$1M')
  })
  it('reads empty as $0 and negatives with a minus', () => {
    expect(money(undefined)).toBe('$0')
    expect(money('')).toBe('$0')
    expect(money('abc')).toBe('$0')
    expect(money(-50000)).toBe('-$50K')
    expect(money(-1250000)).toBe('-$1.3M')
    expect(money(-40)).toBe('-$40')
  })
})

describe('exactMoney', () => {
  it('reads to the dollar', () => {
    expect(exactMoney(150000)).toBe('$150,000')
    expect(exactMoney(2000000)).toBe('$2,000,000')
    expect(exactMoney(49999.6)).toBe('$50,000')
    expect(exactMoney(0)).toBe('$0')
    expect(exactMoney(-50000)).toBe('-$50,000')
  })
  it('keeps cents for AI spend', () => {
    expect(exactMoney(0.12, true)).toBe('$0.12')
    expect(exactMoney(1.8, true)).toBe('$1.80')
    expect(exactMoney(1234.5, true)).toBe('$1,234.50')
  })
  it('is empty when there is no number', () => {
    expect(exactMoney(undefined)).toBe('')
    expect(exactMoney(null)).toBe('')
    expect(exactMoney(NaN)).toBe('')
  })
})

describe('scoring and pipeline', () => {
  it('score', () => {
    expect(score({ warmth: 'existing', tier: 'A', expected: 250000, lead: true })).toBe(100)
    expect(score({ warmth: 'cold', tier: 'C', expected: undefined, lead: false })).toBe(20)
    expect(score({ warmth: 'intro', tier: 'B', expected: 100000, lead: false })).toBe(50)
  })
  it('committed counts verbal/signed/wired, committed before expected', () => {
    expect(committedOf({ stage: 'verbal', expected: 100000 })).toBe(100000)
    expect(committedOf({ stage: 'signed', expected: 100000, committed: 50000 })).toBe(50000)
    expect(committedOf({ stage: 'm2', expected: 100000 })).toBe(0)
  })
  it('weighted uses the round odds', () => {
    expect(weightedOf({ stage: 'm1', expected: 100000 }, DEFAULT_ROUND.odds)).toBeCloseTo(20000)
    expect(weightedOf({ stage: 'verbal', expected: 100000 }, DEFAULT_ROUND.odds)).toBe(0)
    expect(weightedOf({ stage: 'm1', expected: 100000 }, { ...DEFAULT_ROUND.odds, m1: 0.5 })).toBe(50000)
  })
  it('funnel reads maxStage', () => {
    const f = funnel([inv({ stage: 'passed', maxStage: 'm2' }), inv({ stage: 'ask', maxStage: 'ask' }), inv({})])
    expect(f[0].n).toBe(3)
    expect(f[1]).toMatchObject({ k: 'ask', n: 2, conv: 67 })
    expect(f[5]).toMatchObject({ k: 'm2', n: 1 })
    expect(f[6].n).toBe(0)
  })
  it('due, quiet and next lists', () => {
    const t = '2030-01-20'
    const a = inv({ name: 'a', stage: 'm1', nextDate: '2030-01-19', lastTouch: '2030-01-16' })
    const b = inv({ name: 'b', stage: 'm1', nextDate: '2030-01-20', lastTouch: '2030-01-17' })
    const c = inv({ name: 'c', stage: 'wired', nextDate: '2030-01-01' })
    const d = inv({ name: 'd', stage: 'todo', warmth: 'existing', tier: 'A' })
    expect(dueList([b, a, c, d], t).map((i) => i.name)).toEqual(['a', 'b'])
    expect(quietList([a, b, c], t, 4).map((i) => i.name)).toEqual(['a'])
    expect(quietList([a, b, c], t, 3).map((i) => i.name)).toEqual(['a', 'b'])
    expect(nextList([a, d]).map((i) => i.name)).toEqual(['d'])
  })
  it('warm paths and mix', () => {
    const xs = [inv({ path: 'Alex', stage: 'm1', maxStage: 'm1' }), inv({ path: 'Alex', stage: 'verbal', maxStage: 'verbal', expected: 50000 }), inv({ path: '' })]
    expect(warmPaths(xs)).toEqual([['Alex', { n: 2, asked: 2, met: 2, c: 50000 }], ['(none)', { n: 1, asked: 0, met: 0, c: 0 }]])
    expect(mixByType(xs)).toEqual([{ type: 'Angel', n: 3, talking: 2, c: 50000 }])
  })
})

describe('write rules', () => {
  it('new investor at todo: no stage log, maxStage todo', () => {
    expect(applySave(null, { ...NEW_INVESTOR, name: 'x' }, '2030-01-06')).toEqual({ lastTouch: undefined, maxStage: 'todo', logStage: null })
  })
  it('stage change logs, touches and raises maxStage', () => {
    const prev = { stage: 'ask' as const, maxStage: 'ask' as const }
    expect(applySave(prev, { ...NEW_INVESTOR, stage: 'm1' }, '2030-01-06')).toEqual({ lastTouch: '2030-01-06', maxStage: 'm1', logStage: 'm1' })
  })
  it('moving back or to passed keeps maxStage', () => {
    const prev = { stage: 'm2' as const, maxStage: 'm2' as const }
    expect(applySave(prev, { ...NEW_INVESTOR, stage: 'passed' }, '2030-01-06')).toEqual({ lastTouch: '2030-01-06', maxStage: 'm2', logStage: 'passed' })
  })
  it('advance', () => {
    expect(applyAdvance({ stage: 'todo', maxStage: 'todo' }, 't')).toEqual({ stage: 'ask', lastTouch: 't', raiseMax: true })
    expect(applyAdvance({ stage: 'ask', maxStage: 'm1' }, 't')).toEqual({ stage: 'intro', lastTouch: 't', raiseMax: false })
    expect(applyAdvance({ stage: 'wired', maxStage: 'wired' }, 't')).toBeNull()
    expect(applyAdvance({ stage: 'passed', maxStage: 'm1' }, 't')).toBeNull()
  })
})

describe('round', () => {
  it('merges the seed round over the defaults', () => {
    const r = mergeRound({ target: 1000000, stretch: 1500000, deadline: '2030-02-01', kickoff: '2030-01-01' })
    expect(r).toEqual(DEFAULT_ROUND)
  })
  it('default dollar targets are shares of the target', () => {
    const dollars = DEFAULT_ROUND.phases.flatMap((p) => p.targets.filter((x) => x.m === 'committed' || x.m === 'signed').map((x) => targetValue(DEFAULT_ROUND, x)))
    expect(dollars).toEqual([150000, 600000, 1000000, 1000000])
  })
  it('changing the target from $1M to $1.5M rescales everything derived', () => {
    const r3: Round = { ...DEFAULT_ROUND, target: 1500000, stretch: 2500000 }
    const xs = [inv({ stage: 'verbal', expected: 300000 }), inv({ stage: 'm1', expected: 250000 })]
    const t2 = totals(xs, DEFAULT_ROUND, '2030-01-18')
    const t3 = totals(xs, r3, '2030-01-18')
    expect(t2).toMatchObject({ committed: 300000, weighted: 50000, need: 700000, pctOfTarget: 30, scale: 1500000 })
    expect(t2.targetPct).toBeCloseTo(66.667, 2)
    expect(t3).toMatchObject({ committed: 300000, need: 1200000, pctOfTarget: 20, scale: 2500000, targetPct: 60 })
    expect(t3.perDay).toBeCloseTo(1200000 / 14)
    const dollars = r3.phases.flatMap((p) => p.targets.filter((x) => x.m === 'committed').map((x) => targetValue(r3, x)))
    expect(dollars).toEqual([225000, 900000, 1500000])
  })
  it('scale grows past the stretch when the pipeline does', () => {
    const t = totals([inv({ stage: 'signed', expected: 1750000 })], DEFAULT_ROUND, '2030-01-18')
    expect(t.scale).toBe(1750000)
    expect(t.committedPct).toBe(100)
  })
  it('current phase and the meetings KPI', () => {
    expect(currentPhase(DEFAULT_ROUND, '2029-12-01')?.k).toBe('p1')
    expect(currentPhase(DEFAULT_ROUND, '2030-01-10')?.k).toBe('p2')
    expect(currentPhase(DEFAULT_ROUND, '2031-01-01')?.k).toBe('p4')
    const acts = [{ kind: 'stage' as const, stage: 'm1' as const, date: '2030-01-10' }, { kind: 'stage' as const, stage: 'm1' as const, date: '2030-01-03' }]
    expect(meetingsKpi(DEFAULT_ROUND, acts, '2030-01-10')).toMatchObject({ m1: 1, target: 10 })
    const p = DEFAULT_ROUND.phases[0]
    expect(phaseActual(p, 'pathed', [inv({ path: 'Alex' }), inv({ path: 'cold' }), inv({ path: '' })], [], 0)).toBe(1)
  })
  it('validates edits', () => {
    expect(validateRound(DEFAULT_ROUND)).toEqual({})
    const bad: Round = {
      ...DEFAULT_ROUND, target: 0, stretch: -1, odds: { ...DEFAULT_ROUND.odds, m1: 1.2 },
      phases: [DEFAULT_ROUND.phases[0], { ...DEFAULT_ROUND.phases[1], from: '2030-01-05', to: '2030-01-04' }],
    }
    const e = validateRound(bad)
    expect(Object.keys(e).sort()).toEqual(['odds.m1', 'phases.1.from', 'phases.1.to', 'stretch', 'target'])
    expect(validateRound({ ...DEFAULT_ROUND, stretch: 500000 })).toHaveProperty('stretch')
  })
  it('diffs changes with readable labels', () => {
    const r2 = { ...DEFAULT_ROUND, target: 1500000, odds: { ...DEFAULT_ROUND.odds, m1: 0.25 } }
    expect(diffRound(DEFAULT_ROUND, r2)).toEqual([
      { field: 'target', from: '1000000', to: '1500000' },
      { field: 'odds.m1', from: '0.2', to: '0.25' },
    ])
    expect(fieldLabel('phases.1.targets.2.t')).toBe('Phase 2 · target 3 target')
    expect(fieldLabel('odds.m1')).toBe('Odds · 1st meeting')
  })
})

describe('csv', () => {
  it('previews an import: defaults, duplicates and bad rows', () => {
    const text = [
      'Name,Firm,Type,Warmth,Wave,Expected,Next step,Next date',
      'Asha,Alpha Fund,Seed fund,Warm,1,250k,Call,2030-01-12',
      'asha,ALPHA FUND,,,,,,',
      'Ravi,,,cold,,,,',
      ',No name,,,,,,',
      'Mo,,Hedge fund,,,,,',
      'Old,Existing Co,,,,,,',
    ].join('\n')
    const p = previewImport(text, [{ name: 'old', firm: 'existing co' }])
    expect(p.error).toBeUndefined()
    expect(p.add.map((r) => r.fields.name)).toEqual(['Asha', 'Ravi'])
    expect(p.add[0].fields).toMatchObject({ type: 'Seed fund', warmth: 'warm', wave: 1, expected: 250000, nextStep: 'Call', nextDate: '2030-01-12', geo: 'India', tier: 'B', stage: 'todo' })
    expect(p.add[1].fields).toMatchObject({ warmth: 'cold', type: 'Angel', wave: 2, expected: undefined })
    expect(p.skipped.map((s) => [s.line, s.reason.split(' ')[0]])).toEqual([[3, 'Already'], [5, 'No'], [6, 'type'], [7, 'Already']])
  })
  it('needs a name column', () => expect(previewImport('firm\nx', []).error).toMatch(/name/))
  it('parses money', () => {
    expect(parseMoney('1.5m')).toBe(1500000)
    expect(parseMoney('25000')).toBe(25000)
    expect(parseMoney('abc')).toBeNull()
  })
  it('exports every investor', () => {
    const csv = exportCsv([inv({ name: 'B, Inc', expected: 5 }), inv({ name: 'A' })])
    const lines = csv.split(/\r?\n/)
    expect(lines[0]).toMatch(/^name,firm,type/)
    expect(lines[1].startsWith('A,')).toBe(true)
    expect(lines[2].startsWith('"B, Inc"')).toBe(true)
  })
})
