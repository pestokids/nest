import { describe, expect, it } from 'vitest'
import { investorActions, parseActionQuery, type ActionFeatures } from './paletteActions'
import type { Stage } from './stages'

// Made-up investors.
const inv = (name: string, stage: Stage, firm = '') => ({ _id: name.toLowerCase().replace(/\W+/g, '-'), name, firm, stage })
const LIST = [
  inv('Orchard Capital', 'm2'),
  inv('Kite Angels', 'dd'),
  inv('Fernhill Ventures', 'booked'),
  inv('First Light Capital', 'intro'),
  inv('Monarch Seed', 'm1'),
  inv('Partner Fund', 'ask'),
]
const NONE: ActionFeatures = { decideBy: false, askLead: false }
const parse = (q: string) => {
  const r = parseActionQuery(LIST, q)
  return { who: r.investor?.name ?? null, intent: r.intent }
}

describe('⌘K: the investor and what to do', () => {
  it('reads a stage abbreviation after a partial name', () => {
    expect(parse('orch dd')).toEqual({ who: 'Orchard Capital', intent: { kind: 'move', stage: 'dd' } })
    expect(parse('kite verbal')).toEqual({ who: 'Kite Angels', intent: { kind: 'move', stage: 'verbal' } })
    expect(parse('fern 1st')).toEqual({ who: 'Fernhill Ventures', intent: { kind: 'move', stage: 'm1' } })
  })

  it('reads verbs before the name, and the kind of touch', () => {
    expect(parse('log call fern')).toEqual({ who: 'Fernhill Ventures', intent: { kind: 'log', touch: 'call' } })
    expect(parse('email kite')).toEqual({ who: 'Kite Angels', intent: { kind: 'log', touch: 'email' } })
    expect(parse('log orch')).toEqual({ who: 'Orchard Capital', intent: { kind: 'log', touch: 'call' } })
  })

  it('reads no, park and draft, with the small words around them', () => {
    expect(parse('mark kite as no')).toEqual({ who: 'Kite Angels', intent: { kind: 'no' } })
    expect(parse('park orchard')).toEqual({ who: 'Orchard Capital', intent: { kind: 'park' } })
    expect(parse('follow up fern')).toEqual({ who: 'Fernhill Ventures', intent: { kind: 'draft' } })
    expect(parse('move orch to dd')).toEqual({ who: 'Orchard Capital', intent: { kind: 'move', stage: 'dd' } })
  })

  it('takes prefixes of long command words', () => {
    expect(parse('orch dilig')).toEqual({ who: 'Orchard Capital', intent: { kind: 'move', stage: 'dd' } })
    expect(parse('kite verb')).toEqual({ who: 'Kite Angels', intent: { kind: 'move', stage: 'verbal' } })
  })

  it('keeps a command word that is part of the matched name', () => {
    expect(parse('first light dd')).toEqual({ who: 'First Light Capital', intent: { kind: 'move', stage: 'dd' } })
    expect(parse('mon dd')).toEqual({ who: 'Monarch Seed', intent: { kind: 'move', stage: 'dd' } })
  })

  it('is a plain search when nothing else names an investor', () => {
    expect(parse('orch')).toEqual({ who: 'Orchard Capital', intent: null })
    expect(parse('partner')).toEqual({ who: 'Partner Fund', intent: null })
    expect(parse('dd')).toEqual({ who: null, intent: null })
    expect(parse('nightjar dd')).toEqual({ who: null, intent: null })
  })
})

describe('⌘K: actions for the matched investor', () => {
  const orchard = LIST[0]

  it('puts the asked-for action first, with its key', () => {
    const acts = investorActions(orchard, { kind: 'move', stage: 'dd' }, NONE)
    expect(acts[0]).toMatchObject({ kind: 'move', label: 'Move Orchard Capital to Diligence', stage: 'dd', key: 'm' })
    expect(acts.map((a) => a.label)).toEqual(['Move Orchard Capital to Diligence', 'Log a call with Orchard Capital', 'Draft a follow-up', 'Mark as no', 'Park until a date'])
    expect(acts.map((a) => a.key)).toEqual(['m', 'l', 'd', 'n', undefined])
  })

  it('shows M only for the next stage', () => {
    expect(investorActions(orchard, { kind: 'move', stage: 'verbal' }, NONE)[0]).toMatchObject({ label: 'Move Orchard Capital to Verbal', key: undefined })
    expect(investorActions(orchard, null, NONE)[0]).toMatchObject({ label: 'Move Orchard Capital to Diligence', key: 'm' })
  })

  it('logs the kind of touch asked for', () => {
    expect(investorActions(orchard, { kind: 'log', touch: 'meeting' }, NONE)[0].label).toBe('Log a meeting with Orchard Capital')
    expect(investorActions(orchard, { kind: 'log', touch: 'email' }, NONE)[0].label).toBe('Log an email with Orchard Capital')
  })

  it('shows decide-by and ask-to-lead only once those features exist', () => {
    expect(investorActions(orchard, null, NONE).some((a) => a.kind === 'decide' || a.kind === 'lead')).toBe(false)
    const all = investorActions(orchard, null, { decideBy: true, askLead: true }).map((a) => a.label)
    expect(all).toEqual([
      'Move Orchard Capital to Diligence', 'Log a call with Orchard Capital', 'Ask Orchard if they’ll lead', 'Set a decide-by date', 'Draft a follow-up', 'Mark as no', 'Park until a date',
    ])
    expect(investorActions(orchard, { kind: 'lead' }, NONE)[0].kind).toBe('move')
  })

  it('has nothing to move at Money in, and no "no" once passed', () => {
    expect(investorActions(inv('Wired Co', 'wired'), null, NONE)[0].kind).toBe('log')
    const passed = investorActions(inv('Gone Co', 'passed'), null, NONE)
    expect(passed.some((a) => a.kind === 'no' || a.kind === 'move')).toBe(false)
    expect(investorActions(inv('Gone Co', 'passed'), { kind: 'move', stage: 'm1' }, NONE)[0]).toMatchObject({ label: 'Move Gone Co to 1st meeting', key: undefined })
    expect(investorActions(inv('Later Co', 'parked'), null, NONE).at(-1)!.label).toBe('Change the park date')
  })
})
