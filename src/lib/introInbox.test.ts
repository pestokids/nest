// PST-294: the introducer rows PST-297's Inbox (and Today, for now) shows. Every name is made up.
import { describe, expect, it } from 'vitest'
import { introNudges, introReports, introThanks } from './inbox'
import type { Intro, Introducer } from './introducers'
import type { Investor } from './pipeline'

const inv = (id: string, name: string, o: Partial<Investor> = {}): Investor =>
  ({ _id: id, name, firm: name, type: 'Seed fund', geo: 'India', warmth: 'intro', path: '', tier: 'B', wave: 1, stage: 'intro', maxStage: 'intro', lead: false, nextStep: '', notes: '', source: '', ...o }) as Investor

const today = '2026-11-08'
const introducers: Introducer[] = [
  { _id: 'p1', name: 'Ankur Mehta', relation: 'portfolio', notes: '' },
  { _id: 'p2', name: 'Dana Lee', relation: 'friend', notes: '' },
]
const investors = [
  inv('l', 'Lantern Ventures'),
  inv('j', 'Juniper Seed', { stage: 'verbal', maxStage: 'verbal', lastTouch: '2026-11-07' }),
  inv('pb', 'Pebble Partners', { stage: 'passed', maxStage: 'm1', lastTouch: '2026-11-06' }),
  inv('h', 'Harbor Light', { stage: 'ask', maxStage: 'ask' }),
  inv('m', 'Morrow Ventures', { stage: 'ask', maxStage: 'ask' }),
  inv('s', 'Sable Fund', { stage: 'signed', maxStage: 'signed' }),
  inv('q', 'Quill Capital', { stage: 'ask', maxStage: 'ask' }),
]
const intro = (id: string, investorId: string, steps: Intro['steps'], o: Partial<Intro> = {}): Intro => ({ _id: id, investorId, introducerId: 'p1', steps, ...o })
const done = (made: string) => ({ asked: '2026-10-30', yes: '2026-10-31', sent: '2026-10-31', made })

describe('thank them the same day the intro is made', () => {
  it('is due the day of the intro, and late after it', () => {
    const rows = introThanks({ introducers, investors, today, intros: [intro('a', 'l', done(today)), intro('b', 'h', done('2026-11-06'), { introducerId: 'p2' }), intro('c', 'm', { ...done('2026-11-05'), thanked: '2026-11-05' })] })
    expect(rows.map((r) => [r.key, r.title, r.detail, r.late])).toEqual([
      ['thank:b', 'Thank Dana for the intro to Harbor Light', 'Intro made 2 days ago', 2],
      ['thank:a', 'Thank Ankur for the intro to Lantern Ventures', 'Intro made today', 0],
    ])
  })
  it('a committed investor making the intro is thanked too', () => {
    const rows = introThanks({ introducers, investors, today, intros: [intro('a', 'l', done(today), { introducerId: undefined, viaInvestorId: 's' })] })
    expect(rows.map((r) => [r.personKey, r.name])).toEqual([['inv:s', 'Sable Fund']])
  })
})

describe('report back after the investor decides', () => {
  it('shows once they said yes or passed, never before', () => {
    const intros = [
      intro('a', 'j', { ...done('2026-11-01'), thanked: '2026-11-01' }),
      intro('b', 'pb', { ...done('2026-10-28'), thanked: '2026-10-28' }),
      intro('c', 'l', { ...done('2026-11-01'), thanked: '2026-11-01' }),
      intro('d', 's', { ...done('2026-11-01'), thanked: '2026-11-01', reported: '2026-11-03' }),
    ]
    const rows = introReports({ introducers, investors, today, intros })
    expect(rows.map((r) => [r.key, r.title, r.detail])).toEqual([
      ['report:b', 'Tell Ankur how Pebble Partners went', 'Pebble Partners passed'],
      ['report:a', 'Tell Ankur how Juniper Seed went', 'Juniper Seed said yes'],
    ])
  })
  it('a Yes or No on the decision (PST-293) counts as deciding, before the stage moves', () => {
    const intros = [intro('a', 'h', { ...done('2026-11-01'), thanked: '2026-11-01' }), intro('b', 'm', { ...done('2026-11-01'), thanked: '2026-11-02' }), intro('c', 'q', { ...done('2026-11-01'), thanked: '2026-11-01' })]
    const decided = investors.map((i) => ({ ...i, decision: i._id === 'h' ? ('no' as const) : i._id === 'm' ? ('yes' as const) : i._id === 'q' ? ('maybe' as const) : undefined }))
    const rows = introReports({ introducers, investors: decided, today, intros })
    expect(rows.map((r) => [r.key, r.detail])).toEqual([
      ['report:a', 'Harbor Light passed'],
      ['report:b', 'Morrow Ventures said yes'],
    ])
    expect(introNudges({ introducers, investors: decided, today, intros: [intro('n', 'h', { asked: '2026-11-01' })] })).toEqual([])
  })
})

describe('nudge an introducer after 3 days with no reply', () => {
  it('only after 3 days, never once they said yes (or the investor decided), and the clock restarts on a nudge', () => {
    const intros = [
      intro('a', 'h', { asked: '2026-11-05' }, { introducerId: 'p2' }),
      intro('b', 'm', { asked: '2026-11-06' }),
      intro('c', 'q', { asked: '2026-11-01', yes: '2026-11-02' }),
      intro('d', 'l', { asked: '2026-11-01' }, { nudgedAt: '2026-11-07' }),
      intro('e', 'pb', { asked: '2026-11-01' }),
      intro('f', 'j', { asked: '2026-11-03' }),
      intro('g', 'm', { asked: '2026-11-03' }, { introducerId: 'p2' }),
    ]
    const rows = introNudges({ introducers, investors, today, intros })
    expect(rows.map((r) => [r.key, r.title, r.detail, r.due])).toEqual([
      ['nudge-introducer:g', 'Nudge Dana about Morrow Ventures', 'Asked 5 days ago, no reply', '2026-11-06'],
      ['nudge-introducer:a', 'Nudge Dana about Harbor Light', 'Asked 3 days ago, no reply', '2026-11-08'],
    ])
  })
})
