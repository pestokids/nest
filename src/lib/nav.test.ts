import { describe, expect, it } from 'vitest'
import { SECTIONS, shownSections } from './nav'

describe('top bar sections (PST-289)', () => {
  it('shows only Home and Raise', () => {
    expect(shownSections().map((s) => s.label)).toEqual(['Home', 'Raise'])
    expect(shownSections().map((s) => s.to)).toEqual(['/', '/raise'])
  })
  it('keeps the empty sections, hidden, so they come back with one flag', () => {
    expect(SECTIONS.filter((s) => s.hidden).map((s) => s.label)).toEqual(['Growth', 'Families', 'Hiring', 'Ops & Legal'])
    expect(shownSections([...SECTIONS.slice(0, 2), { ...SECTIONS[2], hidden: false }]).map((s) => s.label)).toEqual(['Home', 'Raise', 'Growth'])
  })
  it('only shows sections that link somewhere', () => {
    expect(shownSections().every((s) => s.to.startsWith('/'))).toBe(true)
  })
})
