import { describe, expect, it } from 'vitest'
import { dueList, NEW_INVESTOR, quietList, type Activity, type Investor } from './pipeline'
import { DEFAULT_ROUND, type Round } from './round'
import { advanceConfirm } from './stages'
import { askMove, byWhen, celebrates, dateRange, daysLine, kpis, movesNote, nextMoves, phaseDetail, shortPhaseName, stageChange } from './today'

let n = 0
const inv = (o: Partial<Investor>): Investor => ({ ...NEW_INVESTOR, _id: `i${n++}`, maxStage: 'todo', ...o }) as Investor
const TODAY = '2030-01-03' // inside Phase 1 (Jan 1–7) of DEFAULT_ROUND

/** A round whose current phase has the two list targets, like Prep. */
const round: Round = {
  ...DEFAULT_ROUND,
  phases: [
    { k: 'prep', name: 'Prep', from: '2030-01-01', to: '2030-01-07', targets: [{ l: 'Names', m: 'count', t: 10 }, { l: 'Warm', m: 'pathed', t: 4 }], todo: [] },
    { k: 'w1', name: 'Wave 1', from: '2030-01-08', to: '2030-01-14', targets: [{ l: 'Committed', m: 'committed', t: 0.3 }], todo: [] },
  ],
}

describe('next moves', () => {
  const list = [
    inv({ name: 'A', path: 'Ria' }),
    inv({ name: 'B', path: 'cold' }),
    inv({ name: 'C' }),
    inv({ name: 'Met', stage: 'm1', expected: 25000, nextDate: '2030-01-08', path: 'Ria' }),
  ]

  it('orders the phase targets first, in phase order, and puts the ask last', () => {
    const m = nextMoves({ investors: list, acts: [], round, today: TODAY })
    expect(m.map((x) => x.key)).toEqual(['t:prep:0', 't:prep:1', `ask:${list[3]._id}`])
    expect(m[0].title).toBe('Grow the list to 10')
    expect(m[1].title).toBe('Find a warm path for each name')
    expect(m[2]).toMatchObject({ tone: 'hot', title: 'Ask Met for a number', label: 'Log the ask', count: 'Due Tue 8 Jan' })
    expect(m[2].meta).toBe('Expected $25K · 1st meeting done')
  })

  it('reports progress as have / goal, between 0 and 1', () => {
    const [count, pathed] = nextMoves({ investors: list, acts: [], round, today: TODAY })
    expect(count.progress).toBeCloseTo(4 / 10)
    expect(count.count).toBe('4 / 10 names')
    expect(count.why).toBe('You have 4. Add 6 more names before Monday: angels, funds and operators who can intro.')
    expect(pathed.progress).toBeCloseTo(2 / 4) // "cold" isn't a warm path
    expect(pathed.count).toBe('2 / 4 warm')
    expect(pathed.label).toBe('Open Wave 1 names')
  })

  it('skips targets already met and fills in from what is due, quiet or next', () => {
    const full = Array.from({ length: 10 }, (_, i) => inv({ name: `N${i}`, path: 'Ria' }))
    const due = inv({ name: 'Due', stage: 'intro', nextDate: TODAY, lastTouch: TODAY })
    const m = nextMoves({ investors: [...full, due], acts: [], round, today: TODAY })
    expect(m.map((x) => x.key)).toEqual(['due', `reach:${full[0]._id}`])
  })

  it('never shows more than three and keeps the ask in the last slot', () => {
    const r: Round = { ...round, phases: [{ ...round.phases[0], targets: [...round.phases[0].targets, { l: 'Asks', m: 'stage:ask', t: 5 }] }] }
    const m = nextMoves({ investors: list, acts: [], round: r, today: TODAY })
    expect(m).toHaveLength(3)
    expect(m[2].tone).toBe('hot')
    const noAsk = nextMoves({ investors: list.slice(0, 3), acts: [], round: r, today: TODAY })
    expect(noAsk.map((x) => x.key)).toEqual(['t:prep:0', 't:prep:1', 't:prep:2'])
  })

  it('picks the furthest-along unasked conversation, biggest check first', () => {
    const a = inv({ name: 'Small', stage: 'm1', expected: 10000 })
    const b = inv({ name: 'Big', stage: 'm1', expected: 90000 })
    const c = inv({ name: 'Diligence', stage: 'dd', expected: 5000 })
    const v = inv({ name: 'Verbal', stage: 'verbal', expected: 500000 })
    expect(askMove([a, b, v], [], undefined, TODAY)?.title).toBe('Ask Big for a number')
    expect(askMove([a, b, c], [], undefined, TODAY)?.title).toBe('Ask Diligence for a number')
    const asked: Pick<Activity, 'investorId' | 'touch'>[] = [{ investorId: b._id, touch: 'ask' }]
    expect(askMove([a, b], asked, undefined, TODAY)?.title).toBe('Ask Small for a number')
    // Just asked: stays put so the button can show its confirmation.
    expect(askMove([a, b], asked, undefined, TODAY, new Set([b._id]))?.title).toBe('Ask Big for a number')
  })

  it('says which phase it works from', () => {
    expect(movesNote(round, TODAY)).toBe('Prep ends Mon 7 Jan. Do these in order.')
    expect(movesNote(round, '2029-12-30')).toBe('Prep starts Tue 1 Jan. Do these in order.')
  })

  it('byWhen names the weekday within a week', () => {
    expect(byWhen('2030-01-03', TODAY)).toBe('today')
    expect(byWhen('2030-01-04', TODAY)).toBe('tomorrow')
    expect(byWhen('2030-01-07', TODAY)).toBe('Monday')
    expect(byWhen('2030-01-20', TODAY)).toBe('Sun 20 Jan')
  })
})

describe('due today and gone quiet', () => {
  it('due today: dated today or earlier, live only, oldest first', () => {
    const late = inv({ name: 'Late', stage: 'intro', nextDate: '2030-01-01' })
    const today = inv({ name: 'Today', stage: 'ask', nextDate: TODAY })
    const later = inv({ name: 'Later', stage: 'ask', nextDate: '2030-01-04' })
    const passed = inv({ name: 'Passed', stage: 'passed', nextDate: '2030-01-01' })
    const wired = inv({ name: 'Wired', stage: 'wired', nextDate: '2030-01-01' })
    const none = inv({ name: 'None', stage: 'm1' })
    expect(dueList([today, later, passed, wired, none, late], TODAY).map((i) => i.name)).toEqual(['Late', 'Today'])
  })

  it('due today: a parked investor comes back on its park-until day, not on an old next step', () => {
    const back = inv({ name: 'Back', stage: 'parked', parkedUntil: TODAY, nextDate: '2029-12-01' })
    const notYet = inv({ name: 'NotYet', stage: 'parked', parkedUntil: '2030-01-09' })
    const plain = inv({ name: 'Plain', stage: 'parked', nextDate: '2029-12-01' })
    expect(dueList([back, notYet, plain], TODAY).map((i) => i.name)).toEqual(['Back'])
  })

  it('gone quiet: live, uncommitted, no touch in quietDays or more, oldest touch first', () => {
    const q = 4
    const quiet = inv({ name: 'Quiet', stage: 'intro', lastTouch: '2029-12-30' })
    const edge = inv({ name: 'Edge', stage: 'ask', lastTouch: '2029-12-28' })
    const never = inv({ name: 'Never', stage: 'm1' })
    const fresh = inv({ name: 'Fresh', stage: 'intro', lastTouch: '2030-01-01' })
    const verbal = inv({ name: 'Verbal', stage: 'verbal', lastTouch: '2029-12-01' })
    const todo = inv({ name: 'Todo', stage: 'todo' })
    const parked = inv({ name: 'Parked', stage: 'parked', lastTouch: '2029-12-01' })
    expect(quietList([quiet, edge, never, fresh, verbal, todo, parked], TODAY, q).map((i) => i.name)).toEqual(['Never', 'Edge', 'Quiet'])
  })
})

describe('advance stage', () => {
  it('forward celebrates', () => {
    expect(stageChange('booked', 'm1')).toBe('forward')
    expect(celebrates('booked', 'm1')).toBe(true)
    expect(celebrates('todo', 'ask')).toBe(true)
    expect(celebrates('ask', 'm2')).toBe(true) // skipping ahead still counts
  })
  it('back, passed, parked and reopening do not', () => {
    expect(stageChange('m1', 'booked')).toBe('back')
    expect(celebrates('m1', 'booked')).toBe(false)
    expect(stageChange('m1', 'passed')).toBe('closed')
    expect(celebrates('m1', 'passed')).toBe(false)
    expect(celebrates('m1', 'parked')).toBe(false)
    expect(stageChange('parked', 'm1')).toBe('reopened')
    expect(celebrates('parked', 'm1')).toBe(false)
    expect(celebrates('m1', 'm1')).toBe(false)
  })
  it('the confirm line names the person', () => {
    expect(advanceConfirm('m1', 'Ada Lovelace')).toBe('The first call with Ada happened')
  })
})

describe('summary card', () => {
  it('phase details: dates and the headline target', () => {
    expect(dateRange('2030-11-06', '2030-11-10')).toBe('NOV 6–10')
    expect(dateRange('2030-11-30', '2030-12-04')).toBe('NOV 30–DEC 4')
    expect(phaseDetail(round, round.phases[0])).toBe('JAN 1–7')
    expect(phaseDetail(round, round.phases[1])).toBe('JAN 8–14 · $300K')
    expect(phaseDetail(round, { ...round.phases[1], targets: [{ l: 'Asks', m: 'stage:ask', t: 80 }] })).toBe('JAN 8–14 · 80 asks')
    expect(shortPhaseName('Wave 1')).toBe('W1')
    expect(shortPhaseName('Kickoff')).toBe('Kickoff')
  })
  it('days line', () => {
    expect(daysLine(round, TODAY)).toBe('days to close on Fri 1 Feb. Wave 1 opens Tue 8 Jan.')
  })
  it('KPI notes', () => {
    const k = kpis(
      [inv({ name: 'Yes', stage: 'signed', committed: 250000 }), inv({ name: 'P', stage: 'passed' }), inv({ name: 'A', stage: 'ask' }), inv({ name: 'Z', stage: 'parked' })],
      round,
      TODAY,
    )
    expect(k.committed).toEqual({ value: '$250K', note: 'Yes, signed.' })
    expect(k.still.value).toBe('$750K')
    expect(k.talking).toEqual({ value: 2, note: '1 is waiting on an intro.' })
    expect(k.passed).toEqual({ value: 1, note: 'P. 1 parked.' })
    expect(kpis([], round, TODAY).committed.note).toBe('Counts only verbal or signed, confirmed in writing.')
  })
})
