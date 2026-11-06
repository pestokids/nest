import { describe, expect, it } from 'vitest'
import { isPaletteShortcut } from './commandPalette'

const k = (o: Partial<KeyboardEvent>) => ({ key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o })
describe('command palette shortcut', () => {
  it('is ⌘K or Ctrl+K only', () => {
    expect(isPaletteShortcut(k({ metaKey: true }))).toBe(true)
    expect(isPaletteShortcut(k({ ctrlKey: true, key: 'K' }))).toBe(true)
    expect(isPaletteShortcut(k({}))).toBe(false)
    expect(isPaletteShortcut(k({ metaKey: true, shiftKey: true }))).toBe(false)
    expect(isPaletteShortcut(k({ metaKey: true, key: 'j' }))).toBe(false)
  })
})
