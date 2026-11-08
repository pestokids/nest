import { describe, expect, it } from 'vitest'
import { isView, nextView } from './views'

describe('Pipeline views (V)', () => {
  it('V goes Board, Race, Maybes, and round to Board', () => {
    expect(nextView('board')).toBe('race')
    expect(nextView('race')).toBe('maybes')
    expect(nextView('maybes')).toBe('board')
  })
  it('only the three views are views', () => {
    expect(isView('maybes')).toBe(true)
    expect(isView('list')).toBe(false)
  })
})
