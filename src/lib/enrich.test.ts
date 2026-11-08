import { describe, expect, it } from 'vitest'
import { cardState, cents, enrichedCell, fit, investorWrite, mapGeo, sourceShort, timeLeft, whoLine, type Fact } from './enrich'
import { NEW_INVESTOR, type InvestorFields } from './pipeline'

const inv = (o: Partial<InvestorFields> = {}): InvestorFields => ({ ...NEW_INVESTOR, name: 'Kite Angels', ...o })
const kept = (field: string, value: string, amount?: number): Fact => ({
  _id: field, runId: 'r1', group: 'fund', field, value, source: 'https://kite.example.com', confidence: 0.9, status: 'kept', keptAt: 1, ...(amount ? { amount } : {}),
})

describe('investorWrite', () => {
  it('fills an empty Expected from the check size, and leaves a typed one alone with a note', () => {
    expect(investorWrite(inv(), { group: 'fund', field: 'check', value: '$25K–$50K, about $35K', amount: 35e3 })).toEqual({ patch: { expected: 35e3 } })
    const typed = investorWrite(inv({ expected: 50e3 }), { group: 'fund', field: 'check', value: '$35K', amount: 35e3 })
    expect(typed.patch).toBeUndefined()
    expect(typed.clash).toBe('You wrote $50K as Expected. Keeping this won’t change it.')
  })
  it('treats the new-investor type and geography as empty', () => {
    expect(investorWrite(inv(), { group: 'fund', field: 'type', value: 'seed fund' })).toEqual({ patch: { type: 'Seed fund' } })
    expect(investorWrite(inv(), { group: 'fund', field: 'geography', value: 'India and the US' })).toEqual({ patch: { geo: 'Global' } })
    expect(investorWrite(inv({ type: 'Micro-VC' }), { group: 'fund', field: 'type', value: 'Seed fund' }).clash).toMatch(/You set Type to Micro-VC/)
  })
  it('adds a firm domain only when none is set, and skips personal mail', () => {
    expect(investorWrite(inv(), { group: 'fund', field: 'domain', value: 'https://www.kite.example.com/' })).toEqual({ patch: { domains: ['kite.example.com'] } })
    expect(investorWrite(inv(), { group: 'fund', field: 'domain', value: 'gmail.com' })).toEqual({})
    expect(investorWrite(inv({ domains: ['kite.example.com'] }), { group: 'fund', field: 'domain', value: 'kite.example.com' })).toEqual({})
  })
  it('never writes person facts other than an empty email', () => {
    expect(investorWrite(inv(), { group: 'person', field: 'title', value: 'Partner' })).toEqual({})
    expect(investorWrite(inv(), { group: 'person', field: 'email', value: 'Sam@Kite.example.com' })).toEqual({ patch: { email: 'sam@kite.example.com' } })
  })
})

describe('mapGeo', () => {
  it('maps places to the geographies Nest has', () => {
    expect(mapGeo('Bengaluru')).toBe('India')
    expect(mapGeo('San Francisco and New York')).toBe('US')
    expect(mapGeo('Dubai')).toBe('MENA')
    expect(mapGeo('Europe')).toBe('Global')
    expect(mapGeo('Mars')).toBeUndefined()
  })
})

describe('fit', () => {
  it('needs two kept fund facts, then scores stage, check, thesis and geography', () => {
    expect(fit([kept('stage', 'Pre-seed')], { target: 1e6, minCheck: 25e3 })).toBeNull()
    const f = fit(
      [kept('stage', 'Pre-seed and seed'), kept('check', '$25K–$50K, about $35K', 35e3), kept('thesis', 'Consumer and kids at pre-seed'), kept('geography', 'India')],
      { target: 1e6, minCheck: 25e3 },
    )
    expect(f?.score).toBe(96)
    expect(f?.headline).toBe('Strong fit for this round')
    expect(f?.reasons).toEqual(['Pre-seed', 'Kids + consumer', 'Checks $25K–$50K'])
  })
})

describe('labels', () => {
  it('prices in cents under a dollar', () => {
    expect(cents(0.04)).toBe('4¢')
    expect(cents(0.004)).toBe('0.4¢')
    expect(cents(0.0002)).toBe('<0.1¢')
    expect(cents(0.0098)).toBe('1¢')
    expect(cents(0)).toBe('0¢')
    expect(cents(1.84)).toBe('$1.84')
  })
  it('shows the Enriched cell from the latest run', () => {
    expect(enrichedCell(undefined)).toEqual({ text: '—', tone: 'none' })
    expect(enrichedCell({ status: 'queued' }).text).toBe('Queued')
    expect(enrichedCell({ status: 'running' }).text).toBe('Running…')
    expect(enrichedCell({ status: 'done', finishedAt: Date.parse('2026-11-07T06:00:00Z') }).text).toBe('✓ Sat 7 Nov')
  })
  it('estimates time left from the finished steps', () => {
    const steps = (done: number) => Array.from({ length: 5 }, (_, i) => ({ label: String(i), state: i < done ? ('done' as const) : ('waiting' as const) }))
    expect(timeLeft({ status: 'running', startedAt: 0, steps: steps(2) }, 20e3)).toBe('About 30 seconds left')
    expect(timeLeft({ status: 'queued', startedAt: 0, steps: steps(0) }, 0)).toBe('Waiting for a free slot')
    expect(timeLeft({ status: 'running', startedAt: 0, steps: steps(5) }, 40e3)).toBe('Almost done')
  })
  it('picks the drawer card', () => {
    expect(cardState({ connected: false, run: null, pending: 0, kept: 0 })).toBe('nokey')
    expect(cardState({ connected: false, run: null, pending: 0, kept: 3 })).toBe('done')
    expect(cardState({ connected: true, run: { status: 'running' }, pending: 4, kept: 3 })).toBe('running')
    expect(cardState({ connected: true, run: { status: 'done' }, pending: 4, kept: 3 })).toBe('review')
    expect(cardState({ connected: true, run: { status: 'stopped' }, pending: 0, kept: 0 })).toBe('idle')
  })
  it('writes the Who’s this? line', () => {
    const f = (group: 'person' | 'fund', field: string, value: string) => ({ group, field, value, status: 'pending' as const })
    expect(whoLine([f('person', 'title', 'Principal'), f('fund', 'name', 'Larkspur Ventures'), f('fund', 'size', '$40M'), f('fund', 'stage', 'Pre-seed'), f('person', 'covers', 'Consumer and kids')])).toBe(
      'Principal at Larkspur Ventures · $40M pre-seed fund · covers consumer and kids',
    )
    expect(sourceShort('https://www.kite.example.com/team/sam')).toBe('kite.example.com/team')
  })
})
