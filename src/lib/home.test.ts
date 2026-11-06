import { describe, expect, it } from 'vitest'
import { dateEyebrow, dayMonth, greeting, isChecklistDone, monDay, partOfDay, phaseLine, phaseSegments, upNext } from './home'
import { NEW_INVESTOR, type Investor } from './pipeline'
import { DEFAULT_ROUND, type Phase, type Round } from './round'

// 2030-01-01 is a Tuesday. IST is UTC+5:30.
const ist = (hhmm: string, day = '2030-01-01') => Date.parse(`${day}T${hhmm}:00+05:30`)

describe('greeting', () => {
  it('follows the time of day in Asia/Kolkata', () => {
    expect(greeting(ist('04:00'), 'Dev')).toBe('Morning, Dev.')
    expect(greeting(ist('11:59'), 'Dev')).toBe('Morning, Dev.')
    expect(greeting(ist('12:00'), 'Dev')).toBe('Afternoon, Dev.')
    expect(greeting(ist('16:59'), 'Dev')).toBe('Afternoon, Dev.')
    expect(greeting(ist('17:00'), 'Dev')).toBe('Evening, Dev.')
    expect(greeting(ist('23:59'), 'Dev')).toBe('Evening, Dev.')
    expect(greeting(ist('02:30'), 'Dev')).toBe('Up late, Dev.')
  })
  it('uses IST even when UTC is on another day', () => {
    // 20:00 UTC on Jan 1 is 01:30 IST on Jan 2.
    const t = Date.parse('2030-01-01T20:00:00Z')
    expect(partOfDay(t)).toBe('Up late')
    expect(dateEyebrow(t)).toBe('Wednesday 2 January')
  })
  it('says hi on first run, and copes with a missing name', () => {
    expect(greeting(ist('18:00'), 'Dev', true)).toBe('Hi, Dev.')
    expect(greeting(ist('09:00'), '  ')).toBe('Morning, there.')
  })
  it('formats dates for the eyebrow and cards', () => {
    expect(dateEyebrow(ist('10:00', '2030-11-08'))).toBe('Friday 8 November')
    expect(dayMonth('2030-12-04')).toBe('Wed 4 Dec')
    expect(monDay('2030-11-11')).toBe('NOV 11')
  })
})

const phase = (k: string, name: string, from: string, to: string, todo: string[] = []): Phase => ({ k, name, from, to, targets: [], todo })
const round = (phases: Phase[], deadline = '2030-02-01'): Round => ({ ...DEFAULT_ROUND, phases, deadline })

describe('phase line', () => {
  const r = round([phase('p', 'Prep', '2030-01-01', '2030-01-07', ['a']), phase('w', 'Wave 1', '2030-01-08', '2030-01-20')])
  it('names the current phase', () => {
    expect(phaseLine(r, '2030-01-03')).toBe('Prep week is on.')
    expect(phaseLine(r, '2030-01-10')).toBe('Wave 1 is on.')
  })
  it('says what is next once the phase is done', () => {
    expect(phaseLine(r, '2030-01-03', { phaseDone: true })).toBe('Prep is done. Wave 1 next.')
  })
  it('handles before, after and first run', () => {
    expect(phaseLine(r, '2029-12-30')).toBe('Prep starts Tue 1 Jan.')
    expect(phaseLine(r, '2030-03-01')).toBe('The round has closed.')
    expect(phaseLine(r, '2030-01-03', { firstRun: true })).toBe('Welcome to the nest.')
  })
  it('marks past, current and future segments', () => {
    expect(phaseSegments(r, '2030-01-10').map((s) => s.state)).toEqual(['past', 'now'])
  })
})

describe('up next', () => {
  const inv = (o: Partial<Investor>): Investor => ({ ...NEW_INVESTOR, _id: o.name ?? 'x', maxStage: 'todo', ...o }) as Investor
  const phases = [phase('p', 'Prep', '2030-01-01', '2030-01-07', ['Finish the deck']), phase('k', 'Kickoff', '2030-01-10', '2030-01-20', ['Release every held intro']), phase('c', 'Close', '2030-01-25', '2030-02-01')]
  const today = '2030-01-05'

  it('merges next steps and phase starts, soonest first, three at most', () => {
    const items = upNext(
      [
        inv({ name: 'Later', stage: 'm1', nextStep: 'Follow up', nextDate: '2030-01-20' }),
        inv({ name: 'Soon', stage: 'intro', nextStep: 'Book a call', nextDate: '2030-01-08' }),
        inv({ name: 'Same day', stage: 'ask', nextStep: 'Send deck', nextDate: '2030-01-10' }),
      ],
      phases,
      today,
    )
    expect(items.map((x) => x.text)).toEqual(['Soon: Book a call', 'Kickoff: Release every held intro', 'Same day: Send deck'])
  })
  it('includes today, skips the past, finished deals and undated steps', () => {
    const items = upNext(
      [
        inv({ name: 'Today', stage: 'm1', nextStep: 'Call', nextDate: today }),
        inv({ name: 'Overdue', stage: 'm1', nextStep: 'Call', nextDate: '2030-01-01' }),
        inv({ name: 'Passed', stage: 'passed', nextStep: 'Call', nextDate: '2030-01-06' }),
        inv({ name: 'Wired', stage: 'wired', nextStep: 'Thank', nextDate: '2030-01-06' }),
        inv({ name: 'No date', stage: 'm1', nextStep: 'Call' }),
      ],
      phases,
      today,
      10,
    )
    expect(items.map((x) => x.text)).toEqual(['Today: Call', 'Kickoff: Release every held intro', 'Close starts'])
  })
  it('puts a phase start before a next step on the same day', () => {
    const items = upNext([inv({ name: 'A', stage: 'm1', nextStep: 'Call', nextDate: '2030-01-10' })], phases, today)
    expect(items.map((x) => x.kind)).toEqual(['phase', 'investor', 'phase'])
  })
  it('is empty with nothing dated ahead', () => expect(upNext([], [], today)).toEqual([]))
})

describe('prep checklist', () => {
  const todo = ['Deck', 'Data room', 'SAFE']
  it('is done only when every to-do is ticked', () => {
    expect(isChecklistDone(todo, [0, 1, 2])).toBe(true)
    expect(isChecklistDone(todo, [2, 0, 1, 1])).toBe(true)
    expect(isChecklistDone(todo, [0, 2])).toBe(false)
    expect(isChecklistDone(todo, [])).toBe(false)
  })
  it('ignores ticks for to-dos that no longer exist', () => {
    expect(isChecklistDone(todo, [0, 1, 5])).toBe(false)
    expect(isChecklistDone(['Deck'], [0, 3])).toBe(true)
  })
  it('a phase with no to-dos is never "done"', () => expect(isChecklistDone([], [0])).toBe(false))
})
