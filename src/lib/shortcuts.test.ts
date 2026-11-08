import { describe, expect, it } from 'vitest'
import { isTyping, KEYS, keyLabel, matches, SHORTCUTS, singleKeyOk, type KeyEventLike } from './shortcuts'

const key = (o: Partial<KeyEventLike>): KeyEventLike => ({ key: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o })

describe('the shortcut registry', () => {
  it('has the four groups of the ? sheet, in order, none empty', () => {
    expect(SHORTCUTS.map((g) => g.title)).toEqual(['Anywhere', 'Lists and Inbox', 'Investor drawer', 'Pipeline'])
    for (const g of SHORTCUTS) expect(g.rows.length).toBeGreaterThan(0)
  })

  it('lists ⌘. (feedback) and V (pipeline views), whose handlers other tickets build', () => {
    const rows = SHORTCUTS.flatMap((g) => g.rows)
    expect(rows.find((r) => r.keys.includes(KEYS.feedback))?.label).toBe('Send feedback')
    expect(SHORTCUTS.find((g) => g.id === 'pipeline')!.rows.find((r) => r.keys.includes(KEYS.views))?.label).toBe('Board, Race, Maybes')
  })

  it('shows every key the handlers use, and no key twice in a group', () => {
    const shown = new Set(SHORTCUTS.flatMap((g) => g.rows.flatMap((r) => r.keys)))
    for (const combo of Object.values(KEYS)) expect(shown.has(combo), combo).toBe(true)
    for (const g of SHORTCUTS) {
      const keys = g.rows.flatMap((r) => r.keys)
      expect(new Set(keys).size, g.title).toBe(keys.length)
    }
  })

  it('labels keys the way the sheet shows them', () => {
    expect(keyLabel(KEYS.palette)).toBe('⌘K')
    expect(keyLabel(KEYS.feedback)).toBe('⌘.')
    expect(keyLabel(KEYS.density)).toBe('⇧D')
    expect(keyLabel(KEYS.selectRange)).toBe('⇧X')
    expect(keyLabel(KEYS.prevInvestor)).toBe('←')
    expect(keyLabel(KEYS.open)).toBe('↵')
    expect(keyLabel(KEYS.close)).toBe('Esc')
    expect(keyLabel(KEYS.cardOn)).toBe(']')
    expect(keyLabel(KEYS.down)).toBe('J')
  })
})

describe('matching keys', () => {
  it('reads ⌘ as Ctrl on Windows', () => {
    expect(matches(key({ key: 'k', metaKey: true }), KEYS.palette)).toBe(true)
    expect(matches(key({ key: 'k', ctrlKey: true }), KEYS.palette)).toBe(true)
    expect(matches(key({ key: '.', ctrlKey: true }), KEYS.feedback)).toBe(true)
    expect(matches(key({ key: 'k' }), KEYS.palette)).toBe(false)
  })

  it('keeps single keys single: no ⌘, Ctrl or Alt', () => {
    expect(matches(key({ key: 'j' }), KEYS.down)).toBe(true)
    expect(matches(key({ key: 'j', metaKey: true }), KEYS.down)).toBe(false)
    expect(matches(key({ key: 'm', altKey: true }), KEYS.nextStage)).toBe(false)
  })

  it('tells X from ⇧X and D from ⇧D', () => {
    expect(matches(key({ key: 'x' }), KEYS.select)).toBe(true)
    expect(matches(key({ key: 'X', shiftKey: true }), KEYS.select)).toBe(false)
    expect(matches(key({ key: 'X', shiftKey: true }), KEYS.selectRange)).toBe(true)
    expect(matches(key({ key: 'D', shiftKey: true }), KEYS.density)).toBe(true)
    expect(matches(key({ key: 'd' }), KEYS.density)).toBe(false)
  })

  it('takes ? however Shift was used to type it', () => {
    expect(matches(key({ key: '?', shiftKey: true }), KEYS.sheet)).toBe(true)
    expect(matches(key({ key: '?' }), KEYS.sheet)).toBe(true)
    expect(matches(key({ key: '/' }), KEYS.sheet)).toBe(false)
  })

  it('matches arrows and Escape by name', () => {
    expect(matches(key({ key: 'ArrowRight' }), KEYS.nextInvestor)).toBe(true)
    expect(matches(key({ key: 'ArrowRight', shiftKey: true }), KEYS.nextInvestor)).toBe(false)
    expect(matches(key({ key: 'Escape' }), KEYS.close)).toBe(true)
  })
})

describe('single keys never fire while typing', () => {
  const ev = (target: unknown, o: Partial<KeyEventLike> & { isComposing?: boolean; defaultPrevented?: boolean } = {}) =>
    ({ ...key({ key: 'm' }), isComposing: false, defaultPrevented: false, target, ...o }) as Parameters<typeof singleKeyOk>[0]

  it('treats text fields, text areas, selects and editable text as typing', () => {
    expect(isTyping({ tagName: 'INPUT', type: 'text' })).toBe(true)
    expect(isTyping({ tagName: 'INPUT', type: 'search' })).toBe(true)
    expect(isTyping({ tagName: 'INPUT' })).toBe(true)
    expect(isTyping({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTyping({ tagName: 'SELECT' })).toBe(true)
    expect(isTyping({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('lets keys through on rows, buttons and checkboxes', () => {
    expect(isTyping({ tagName: 'DIV' })).toBe(false)
    expect(isTyping({ tagName: 'BUTTON' })).toBe(false)
    expect(isTyping({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(isTyping(null)).toBe(false)
  })

  it('guards a single-key shortcut', () => {
    expect(singleKeyOk(ev({ tagName: 'DIV' }))).toBe(true)
    expect(singleKeyOk(ev({ tagName: 'TEXTAREA' }))).toBe(false)
    expect(singleKeyOk(ev({ tagName: 'DIV' }, { isComposing: true }))).toBe(false)
    expect(singleKeyOk(ev({ tagName: 'DIV' }, { defaultPrevented: true }))).toBe(false)
    expect(singleKeyOk(ev({ tagName: 'DIV' }, { metaKey: true }))).toBe(false)
    expect(singleKeyOk(ev({ tagName: 'DIV' }, { key: 'D', shiftKey: true }))).toBe(true)
  })
})
