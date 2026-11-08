import { describe, expect, it } from 'vitest'
import { applyMove, applyUndo, type MoveRecord } from './board'
import { stepIn } from './listOrder'
import { NEW_INVESTOR } from './pipeline'
import { applyTouch, undoTouchPatch } from './touch'

const T = '2030-03-10'

describe('logging a touch, and Undo', () => {
  const before = { lastTouch: '2030-03-01', nextStep: 'Send the deck', nextDate: '2030-03-12' }

  it('moves lastTouch forward to the day, never back and never into the future', () => {
    expect(applyTouch(before, { date: '2030-03-08' }, T)).toEqual({ day: '2030-03-08', patch: { ...before, lastTouch: '2030-03-08' } })
    expect(applyTouch({ ...before, lastTouch: '2030-03-09' }, { date: '2030-03-08' }, T).patch.lastTouch).toBe('2030-03-09')
    expect(applyTouch(before, { date: '2030-04-01' }, T).day).toBe(T)
  })

  it('replaces the next step only when asked', () => {
    expect(applyTouch(before, { next: { step: ' Call back ', date: '2030-03-14' } }, T).patch).toEqual({ lastTouch: T, nextStep: 'Call back', nextDate: '2030-03-14' })
    expect(applyTouch(before, { next: { step: '' } }, T).patch).toEqual({ lastTouch: T, nextStep: '', nextDate: undefined })
  })

  it('Undo puts every field back', () => {
    const { patch } = applyTouch(before, { next: { step: 'Call back', date: '2030-03-14' } }, T)
    expect(undoTouchPatch(patch, { from: before, set: patch })).toEqual(before)
  })

  it('Undo keeps a field that changed again since', () => {
    const { patch } = applyTouch(before, { next: { step: 'Call back', date: '2030-03-14' } }, T)
    expect(undoTouchPatch({ ...patch, nextStep: 'Edited since' }, { from: before, set: patch })).toEqual({ ...before, nextStep: 'Edited since' })
  })
})

describe('parking from the drawer or ⌘K, and Undo', () => {
  const i = { ...NEW_INVESTOR, name: 'Made-up Ventures', stage: 'm1' as const, maxStage: 'm1' as const, lastTouch: '2030-03-01' }

  it('sets the day they come back, and Undo clears it', () => {
    const { patch } = applyMove(i, 'parked', T, '2030-04-01')
    expect(patch).toEqual({ stage: 'parked', lastTouch: T, maxStage: 'm1', parkedUntil: '2030-04-01' })
    const rec: MoveRecord = { id: 'a', to: 'parked', from: { stage: 'm1', lastTouch: '2030-03-01', maxStage: 'm1', parkedUntil: null } }
    expect(applyUndo({ ...i, ...patch }, rec)).toEqual({ stage: 'm1', lastTouch: '2030-03-01', maxStage: 'm1', parkedUntil: undefined })
  })

  it('leaves the date alone on other moves', () => {
    expect('parkedUntil' in applyMove(i, 'm2', T).patch).toBe(false)
    expect('parkedUntil' in applyUndo({ stage: 'm2' }, { id: 'a', to: 'm2', from: { stage: 'm1', maxStage: 'm1' } })!).toBe(false)
  })
})

describe('the drawer’s ← and →', () => {
  it('steps through the list it was opened from', () => {
    const ids = ['a', 'b', 'c']
    expect(stepIn(ids, 'b', 1)).toBe('c')
    expect(stepIn(ids, 'b', -1)).toBe('a')
    expect(stepIn(ids, 'c', 1)).toBeNull()
    expect(stepIn(ids, 'a', -1)).toBeNull()
    expect(stepIn(ids, 'z', 1)).toBeNull()
  })
})
