import { describe, expect, it } from 'vitest'
import {
  applyMove, applyUndo, BOARD_KEYS, cardKeyAction, cardText, classifyMove, keyTarget, landingIndex, matchesFilter, moveSounds, moveToast,
  quietDaysOf, swipeTarget, type MoveRecord,
} from './board'
import { NEW_INVESTOR, type Investor } from './pipeline'

const T = '2030-03-10'
const inv = (o: Partial<Investor>): Investor => ({ ...NEW_INVESTOR, _id: Math.random().toString(36), maxStage: 'todo', ...o }) as Investor
const names = (cues: { name: string }[]) => cues.map((c) => c.name)

describe('drop rules', () => {
  it('the next stage moves up with card-drop + stage-up', () => {
    const m = classifyMove('intro', 'booked')
    expect(m).toEqual({ kind: 'next', skipped: [], win: false })
    expect(names(moveSounds(m))).toEqual(['card-drop', 'stage-up'])
    expect(moveToast('Kite Angels', 'booked', m)).toBe('Moved Kite Angels to Booked')
  })
  it('skipping a stage warns that its rule needs checking', () => {
    const m = classifyMove('ask', 'm1')
    expect(m.kind).toBe('skip')
    expect(m.skipped).toEqual(['intro', 'booked'])
    expect(names(moveSounds(m))).toEqual(['rule-check'])
    expect(moveToast('Kite Angels', 'm1', m)).toBe('Moved Kite Angels to 1st meeting. Skipped 2 stages, so check its rule.')
    expect(moveToast('Kite Angels', 'booked', classifyMove('ask', 'booked'))).toContain('Skipped a stage, so check its rule')
  })
  it('a skip onto Signed is a win and still warns', () => {
    const m = classifyMove('m2', 'signed')
    expect(m).toMatchObject({ kind: 'skip', win: true })
    expect(names(moveSounds(m))).toEqual(['signed', 'confetti', 'rule-check'])
    expect(moveToast('X', 'signed', m)).toContain('check its rule')
  })
  it('the next stage onto Money in is a win', () => {
    const m = classifyMove('signed', 'wired')
    expect(m).toMatchObject({ kind: 'next', win: true })
    expect(names(moveSounds(m))).toEqual(['signed', 'confetti'])
  })
  it('back a stage drops lower, no warning', () => {
    const m = classifyMove('m1', 'intro')
    expect(m).toEqual({ kind: 'back', skipped: [], win: false })
    expect(moveSounds(m)).toEqual([{ name: 'card-drop', opts: { rate: 0.85 } }])
    expect(moveToast('X', 'intro', m)).toBe('Moved X back to Intro')
  })
  it('to passed or parked', () => {
    expect(classifyMove('m1', 'passed').kind).toBe('passed')
    expect(classifyMove('ask', 'parked').kind).toBe('parked')
    expect(names(moveSounds(classifyMove('ask', 'parked')))).toEqual(['park'])
    expect(names(moveSounds(classifyMove('ask', 'passed')))).toEqual(['card-drop'])
    expect(moveToast('X', 'parked', classifyMove('ask', 'parked'))).toBe('Parked X. Revisit later.')
    expect(moveToast('X', 'passed', classifyMove('ask', 'passed'))).toBe('X passed. Kept for next round.')
  })
  it('out of passed or parked reopens; same column does nothing', () => {
    expect(classifyMove('parked', 'm1').kind).toBe('reopen')
    expect(classifyMove('passed', 'parked').kind).toBe('parked')
    const same = classifyMove('m1', 'm1')
    expect(same.kind).toBe('same')
    expect(moveToast('X', 'm1', same)).toBeNull()
  })
  it('the board has nine stages then passed and parked', () => {
    expect(BOARD_KEYS).toEqual(['ask', 'intro', 'booked', 'm1', 'm2', 'dd', 'verbal', 'signed', 'wired', 'passed', 'parked'])
  })
})

describe('saving a move and undo', () => {
  it('a move touches today, logs the stage and raises maxStage', () => {
    const i = inv({ stage: 'intro', maxStage: 'intro', lastTouch: '2030-03-01' })
    const r = applyMove(i, 'm1', T)
    expect(r.patch).toEqual({ stage: 'm1', lastTouch: T, maxStage: 'm1' })
    expect(r.logStage).toBe('m1')
  })
  it('back a stage never lowers maxStage', () => {
    const i = inv({ stage: 'm1', maxStage: 'm1', lastTouch: '2030-03-01' })
    expect(applyMove(i, 'intro', T).patch).toEqual({ stage: 'intro', lastTouch: T, maxStage: 'm1' })
  })
  it('undo restores the old stage, lastTouch and maxStage', () => {
    const before = inv({ _id: 'a', stage: 'intro', maxStage: 'intro', lastTouch: '2030-03-01' })
    const { patch } = applyMove(before, 'm1', T)
    const rec: MoveRecord = { id: 'a', to: 'm1', from: { stage: before.stage, lastTouch: before.lastTouch, maxStage: before.maxStage } }
    expect(applyUndo({ ...before, ...patch }, rec)).toEqual({ stage: 'intro', lastTouch: '2030-03-01', maxStage: 'intro' })
  })
  it('undo restores a missing lastTouch as missing', () => {
    const rec: MoveRecord = { id: 'a', to: 'passed', from: { stage: 'ask', maxStage: 'ask' } }
    expect(applyUndo({ stage: 'passed' }, rec)).toEqual({ stage: 'ask', lastTouch: undefined, maxStage: 'ask' })
  })
  it('undo does nothing once the card has moved again', () => {
    const rec: MoveRecord = { id: 'a', to: 'm1', from: { stage: 'intro', maxStage: 'intro' } }
    expect(applyUndo({ stage: 'm2' }, rec)).toBeNull()
  })
})

describe('[ and ] keyboard moves', () => {
  it('] is the next stage, [ the previous', () => {
    expect(cardKeyAction(']', 'intro')).toEqual({ do: 'move', to: 'booked' })
    expect(cardKeyAction('[', 'intro')).toEqual({ do: 'move', to: 'ask' })
    expect(cardKeyAction(']', 'verbal')).toEqual({ do: 'move', to: 'signed' })
  })
  it('nope at either end and on passed or parked', () => {
    expect(cardKeyAction('[', 'ask')).toEqual({ do: 'nope' })
    expect(cardKeyAction(']', 'wired')).toEqual({ do: 'nope' })
    expect(cardKeyAction(']', 'passed')).toEqual({ do: 'nope' })
    expect(cardKeyAction('[', 'parked')).toEqual({ do: 'nope' })
  })
  it('Enter opens; modifiers and other keys are ignored', () => {
    expect(cardKeyAction('Enter', 'm1')).toEqual({ do: 'open' })
    expect(cardKeyAction(']', 'm1', { meta: true })).toBeNull()
    expect(cardKeyAction('a', 'm1')).toBeNull()
  })
  it('a moved card keeps moving from its new stage', () => {
    let s = keyTarget('ask', ']')!
    s = keyTarget(s, ']')!
    expect(s).toBe('booked')
    expect(keyTarget(s, '[')).toBe('intro')
  })
  it('a phone swipe right is the next stage', () => {
    expect(swipeTarget('booked')).toBe('m1')
    expect(swipeTarget('wired')).toBeNull()
  })
})

describe('columns', () => {
  it('quiet cards first, then by next date', () => {
    const a = inv({ name: 'A', stage: 'intro', lastTouch: T, nextDate: '2030-03-12' })
    const b = inv({ name: 'B', stage: 'intro', lastTouch: T, nextDate: '2030-03-20' })
    const q = inv({ name: 'Q', stage: 'intro', lastTouch: '2030-03-01', nextDate: '2030-03-30' })
    expect(quietDaysOf(q, T, 4)).toBe(9)
    expect(quietDaysOf(a, T, 4)).toBeNull()
    const card = inv({ name: 'C', stage: 'ask', nextDate: '2030-03-15', lastTouch: '2030-01-01' })
    // moved cards are touched today, so they are no longer quiet
    expect(landingIndex([q, a, b], card, 'intro', 'attention', T, 4)).toBe(2)
    expect(landingIndex([a, b, q], card, 'intro', 'name', T, 4)).toBe(2)
    expect(landingIndex([], card, 'intro', 'attention', T, 4)).toBe(0)
  })
  it('filters by search, wave and type', () => {
    const i = inv({ name: 'Kite Angels', path: 'Ria', wave: 1, type: 'Angel' })
    expect(matchesFilter(i, { q: 'ria', wave: null, type: null })).toBe(true)
    expect(matchesFilter(i, { q: '', wave: 2, type: null })).toBe(false)
    expect(matchesFilter(i, { q: 'kite', wave: 1, type: 'Seed fund' })).toBe(false)
  })
})

describe('card text', () => {
  const money = (n: number) => `$${n / 1000}K`
  it('next step with weekday, warmth and path', () => {
    const c = cardText(inv({ name: 'Kite', firm: 'Kite Co', type: 'Angel', warmth: 'warm', path: 'Ria', stage: 'intro', expected: 25000, nextStep: 'Send deck', nextDate: '2030-03-14', lastTouch: T }), T, 4, money)
    expect(c).toEqual({ sub: 'Angel · Kite Co', chip: 'Warm · via Ria', app: null, amount: '$25K', foot: 'Next: send deck · Thu 14', tone: 'default' })
  })
  it('quiet cards say how long', () => {
    const c = cardText(inv({ name: 'Q', stage: 'ask', lastTouch: '2030-03-04', path: 'Direct', warmth: 'warm' }), T, 4, money)
    expect(c).toMatchObject({ foot: '6 days quiet · nudge or park', tone: 'quiet', chip: 'Warm · direct', amount: '–' })
  })
  it('passed cards', () => {
    const c = cardText(inv({ name: 'P', stage: 'passed', lastTouch: '2030-02-26', expected: 50000 }), T, 4, money)
    expect(c).toMatchObject({ chip: 'Passed', amount: '–', foot: 'Passed 12 days ago', tone: 'closed' })
  })
})
