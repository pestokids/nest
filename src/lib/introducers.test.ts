// PST-294: introducers and intro steps, as pure functions. Every name is made up.
import { describe, expect, it } from 'vitest'
import {
  introLine, introNext, matchIntroducer, migrationPlan, needsMigration, normName, parsePath, pathKey, personNext, personRows, relationFromHint, setStep,
  statsOf, thankedLine, waitingDays, warmPathFor, type Intro, type Introducer,
} from './introducers'
import { blankUnknownNumbers } from './drafts'
import type { Investor } from './pipeline'

const inv = (id: string, name: string, o: Partial<Investor> = {}): Investor =>
  ({ _id: id, name, firm: name, type: 'Seed fund', geo: 'India', warmth: 'intro', path: '', tier: 'B', wave: 1, stage: 'todo', maxStage: 'todo', lead: false, nextStep: '', notes: '', source: '', ...o }) as Investor

describe('names and old warm paths', () => {
  it('normalises names: case, accents and spacing', () => {
    expect(normName('  Ánkur   MEHTA ')).toBe('ankur mehta')
    expect(normName('Ankur Mehta')).toBe(normName('ankur  mehta'))
  })

  it('reads the people a warm path names, never "cold", "Applied" or "Direct"', () => {
    expect(parsePath('Ankur (portfolio founder) / Ria')).toEqual([{ name: 'Ankur', hint: 'portfolio founder' }, { name: 'Ria', hint: '' }])
    expect(parsePath('mira shah and Omar')).toEqual([{ name: 'Mira Shah', hint: '' }, { name: 'Omar', hint: '' }])
    for (const p of ['cold', 'Applied', 'Direct', '', 'cold email', 'via website']) expect(parsePath(p)).toEqual([])
  })

  it('guesses the relation from the note', () => {
    expect(relationFromHint('portfolio founder')).toBe('portfolio')
    expect(relationFromHint('angel')).toBe('angel')
    expect(relationFromHint('ex-colleague')).toBe('friend')
    expect(relationFromHint('')).toBe('other')
  })

  it('matches a first name to the one person with it, and only then', () => {
    const people = [{ name: 'Ria Kapoor' }, { name: 'Mira Shah' }, { name: 'Mira Das' }]
    expect(matchIntroducer('ria', people)?.name).toBe('Ria Kapoor')
    expect(matchIntroducer('Mira', people)).toBeUndefined()
    expect(matchIntroducer('MIRA  SHAH', people)?.name).toBe('Mira Shah')
    expect(matchIntroducer('Ria Sen', people)).toBeUndefined()
  })
})

describe('the migration', () => {
  const investors = [
    inv('a', 'Lantern Ventures', { path: 'Ankur Mehta (portfolio founder)' }),
    inv('b', 'Kite Angels', { path: 'ankur  mehta' }),
    inv('c', 'Orchard Capital', { path: 'Ria / Ankur' }),
    inv('d', 'Pebble Partners', { path: 'cold' }),
    inv('e', 'Quill Capital', { path: '' }),
  ]

  it('makes each person once (by normalised name) and one intro per person and investor', () => {
    const plan = migrationPlan(investors, [], [])
    expect(plan.create.map((c) => [c.name, c.relation, c.notes])).toEqual([
      ['Ankur Mehta', 'portfolio', 'portfolio founder'],
      ['Ria', 'other', ''],
    ])
    expect(plan.link.map((l) => [l.investorId, l.introducer, l.fromPath])).toEqual([
      ['a', 'new:0', 'ankur mehta (portfolio founder)'],
      ['b', 'new:0', 'ankur mehta'],
      ['c', 'new:1', 'ria / ankur'],
      ['c', 'new:0', 'ria / ankur'],
    ])
  })

  it('is idempotent: run on its own result, it plans nothing', () => {
    const plan = migrationPlan(investors, [], [])
    const introducers = plan.create.map((c) => ({ _id: c.key, name: c.name }))
    const intros = plan.link.map((l, i) => ({ _id: 'x' + i, investorId: l.investorId, introducerId: l.introducer, fromPath: l.fromPath }))
    expect(migrationPlan(investors, introducers, intros)).toEqual({ create: [], link: [] })
    expect(investors.some((i) => needsMigration(i, intros))).toBe(false)
  })

  it('links to people already there, and re-links when the text changes without a second intro', () => {
    const people = [{ _id: 'p1', name: 'Ankur Mehta' }]
    const intros = [{ _id: 'x1', investorId: 'b', introducerId: 'p1', fromPath: 'ankur' }]
    const plan = migrationPlan([inv('b', 'Kite Angels', { path: 'Ankur Mehta' })], people, intros)
    expect(plan.create).toEqual([])
    expect(plan.link).toEqual([{ investorId: 'b', introducer: 'p1', fromPath: pathKey('Ankur Mehta'), existing: 'x1' }])
  })
})

describe('steps', () => {
  it('ticking a step ticks the ones before it that day; none stays later than it', () => {
    expect(setStep({}, 'made', '2026-11-05')).toEqual({ asked: '2026-11-05', yes: '2026-11-05', sent: '2026-11-05', made: '2026-11-05' })
    expect(setStep({ asked: '2026-11-02' }, 'sent', '2026-11-03')).toEqual({ asked: '2026-11-02', yes: '2026-11-03', sent: '2026-11-03' })
    expect(setStep({ asked: '2026-11-06', yes: '2026-11-06' }, 'yes', '2026-11-04')).toEqual({ asked: '2026-11-04', yes: '2026-11-04' })
  })

  it('keeps later steps that are on or after the new day, and drops the ones before it', () => {
    const s = { asked: '2026-11-02', yes: '2026-11-03', sent: '2026-11-03', made: '2026-11-05' }
    expect(setStep(s, 'yes', '2026-11-03')).toEqual(s)
    expect(setStep(s, 'yes', '2026-11-04')).toEqual({ asked: '2026-11-02', yes: '2026-11-04' })
  })

  it('unticking a step unticks it and every step after it', () => {
    const s = { asked: '2026-11-02', yes: '2026-11-03', sent: '2026-11-03', made: '2026-11-05', thanked: '2026-11-05' }
    expect(setStep(s, 'sent', null)).toEqual({ asked: '2026-11-02', yes: '2026-11-03' })
    expect(setStep(s, 'asked', null)).toEqual({})
  })

  it('waits 3 days for a reply, counting again from a nudge', () => {
    const x = { steps: { asked: '2026-11-02' } }
    expect(waitingDays(x, '2026-11-04')).toBeNull()
    expect(waitingDays(x, '2026-11-05')).toBe(3)
    expect(waitingDays({ ...x, nudgedAt: '2026-11-05' }, '2026-11-06')).toBeNull()
    expect(waitingDays({ steps: { asked: '2026-11-02', yes: '2026-11-03' } }, '2026-11-09')).toBeNull()
  })
})

describe('the Introducers table', () => {
  const today = '2026-11-08'
  const investors = [
    inv('l', 'Lantern Ventures', { stage: 'intro', maxStage: 'intro' }),
    inv('o', 'Orchard Capital', { stage: 'verbal', maxStage: 'verbal', committed: 50000 }),
    inv('k', 'Kite Angels', { stage: 'm1', maxStage: 'm1' }),
    inv('s', 'Sable Fund', { stage: 'signed', maxStage: 'signed', committed: 25000, email: 'gp@sable.example' }),
  ]
  const people: Introducer[] = [{ _id: 'p1', name: 'Ankur Mehta', relation: 'portfolio', notes: 'Founder of Tinkerly' }]
  const intros: Intro[] = [
    { _id: 'i1', investorId: 'l', introducerId: 'p1', steps: { asked: '2026-11-02', yes: '2026-11-03', sent: '2026-11-03', made: today } },
    { _id: 'i2', investorId: 'o', introducerId: 'p1', steps: { asked: '2026-10-20', yes: '2026-10-21', sent: '2026-10-21', made: '2026-10-22', thanked: '2026-10-22' } },
    { _id: 'i3', investorId: 'k', introducerId: 'p1', steps: { asked: '2026-10-25', yes: '2026-10-26', sent: '2026-10-26', made: '2026-10-28', thanked: '2026-10-28' } },
  ]

  it('counts asked, made, meetings and money in', () => {
    expect(statsOf(intros, investors)).toEqual({ asked: 3, made: 3, meetings: 2, committed: 50000 })
  })

  it('puts the most pressing thing next: a thank-you due today first', () => {
    expect(personNext(intros, investors, 'Ankur', today)).toEqual({ tone: 'hot', text: 'Thank Ankur for Lantern today' })
    expect(personNext(intros.slice(1), investors, 'Ankur', today)).toEqual({ tone: 'hot', text: 'Report back on Orchard' })
    expect(introNext(intros[2], investors[2], 'Ankur', today)).toMatchObject({ kind: 'wait', text: 'Once Kite decides' })
    expect(introLine(intros[0], investors[0], 'Ankur', today)).toBe('Intro made today')
  })

  it('shows committed investors as introducers too, derived from the list', () => {
    const rows = personRows({ introducers: people, intros, investors }, today)
    expect(rows.map((r) => [r.key, r.relation])).toEqual([
      ['p1', 'portfolio'],
      ['inv:o', 'committed'],
      ['inv:s', 'committed'],
    ])
  })

  it('finds the warm path to an investor, in the list or not', () => {
    const src = { introducers: [...people, { _id: 'p2', name: 'Mira Shah', email: 'mira@brightpath.example', relation: 'angel' as const, notes: 'Knows the partners at Cedar Angels' }], intros, investors }
    expect(warmPathFor(investors[0], src)).toMatchObject({ person: { key: 'p1' }, intro: { _id: 'i1' }, line: 'Ankur · intro' })
    expect(warmPathFor({ name: 'Cedar Angels' }, src)).toMatchObject({ person: { key: 'p2' }, line: 'Mira knows them' })
    expect(warmPathFor({ name: 'Brightpath Ventures', domains: ['brightpath.example'] }, src)).toMatchObject({ person: { key: 'p2' }, line: 'Mira works there' })
    expect(warmPathFor({ name: 'Nowhere Capital' }, src)).toBeNull()
  })
})

describe('the forwardable intro never makes numbers up', () => {
  const known = 'Expected: $25,000. Week-4 retention 38%. Raising $1.2M on a post-money SAFE.'
  it('blanks amounts, percentages, multiples and counts the input did not give', () => {
    const out = blankUnknownNumbers('We have 2,400 families, 61% retention, $40K MRR, 3x growth and 500 users. Raising $1.2M; 38% at week 4.', known)
    expect(out).toBe('We have [__] families, [__]% retention, [__] MRR, [__]x growth and [__] users. Raising $1.2M; 38% at week 4.')
  })
  it('keeps years, small plain numbers and numbers the input gave', () => {
    expect(blankUnknownNumbers('Since 2026, a 30-minute call. Expected $25,000.', known)).toBe('Since 2026, a 30-minute call. Expected $25,000.')
  })
  it('a percentage has to be one the input gave as a percentage', () => {
    expect(blankUnknownNumbers('4% of families pay; 38% play weekly.', known)).toBe('[__]% of families pay; 38% play weekly.')
  })
})

// ---------- PST-298 interactions ----------
describe('the thanks toast', () => {
  it('names the introducer and who to report back on, by first name', () => {
    expect(thankedLine('Ankur Mehta', ['Lantern Ventures'])).toBe('Ankur thanked · report back after Lantern decides')
    expect(thankedLine('Ankur Mehta', ['Lantern Ventures', 'Kite Angels'])).toBe('Ankur thanked · report back after Lantern and Kite decide')
    expect(thankedLine('Ankur', ['Lantern Ventures', 'Kite Angels', 'Orchard Capital'])).toBe('Ankur thanked · report back after Lantern, Kite and Orchard decide')
  })
})
// ---------- end PST-298 interactions ----------
