// PST-298: a move's cheer plays for your own click only.
import { describe, expect, it } from 'vitest'
import { isOwnMove, noteOwnMove, OWN_MOVE_MS } from './ownMove'

describe('your own move', () => {
  it('counts a move made here a moment ago, to that stage only', () => {
    noteOwnMove('inv1', 'verbal', 1000)
    expect(isOwnMove('verbal', 1200)).toBe(true)
    expect(isOwnMove('dd', 1200)).toBe(false)
  })

  it('stops counting a few seconds later (a sync after that is not yours)', () => {
    noteOwnMove('inv1', 'verbal', 1000)
    expect(isOwnMove('verbal', 1000 + OWN_MOVE_MS)).toBe(true)
    expect(isOwnMove('verbal', 1001 + OWN_MOVE_MS)).toBe(false)
  })

  it('the latest move wins', () => {
    noteOwnMove('inv1', 'verbal', 1000)
    noteOwnMove('inv2', 'm2', 1100)
    expect(isOwnMove('verbal', 1200)).toBe(false)
    expect(isOwnMove('m2', 1200)).toBe(true)
  })
})
