// PST-303: the form's words for each investor type, and Save writing only what Dev changed.
import { describe, expect, it } from 'vitest'
import { changedFields, fieldCopy, fieldKind, keepUntouched } from './investorForm'
import { fieldsOf, NEW_INVESTOR, type InvestorFields } from './pipeline'
import { TYPES } from './stages'

const hf: InvestorFields = { ...NEW_INVESTOR, name: 'Northwind S27', firm: 'Northwind', type: 'Accelerator', wave: 1, stage: 'ask', path: 'Applied', expected: 125000 }

describe('field copy by type', () => {
  it('every type is a fund, an accelerator or an angel', () => {
    expect(TYPES.map(fieldKind)).toEqual(['angel', 'angel', 'vc', 'vc', 'vc', 'vc', 'accelerator'])
  })

  it('VCs: Partner, Fund, Partner’s email', () => {
    for (const t of ['Micro-VC', 'Pre-seed fund', 'Seed fund', 'Multi-stage VC'] as const) {
      const c = fieldCopy(t)
      expect([c.name.label, c.firm.label, c.email.label]).toEqual(['Partner', 'Fund', 'Partner’s email'])
      expect(c.name.help).toBe('The partner you’re talking to. One card per fund.')
      expect(c.email.help).toBe('Matches their Gmail and Calendar. Add other partners’ emails or the fund’s domain under More details.')
    }
  })

  it('Accelerator: Programme, Accelerator, Contact email (optional)', () => {
    const c = fieldCopy('Accelerator')
    expect([c.name.label, c.firm.label, c.email.label]).toEqual(['Programme', 'Accelerator', 'Contact email (optional)'])
    expect(c.name.help).toBe('The programme and batch, e.g. Northwind S27.')
    expect(c.email.help).toBe('The partner or programme address you write to. The accelerator’s domain matches the rest.')
  })

  it('Angels: Name, Title or company, Their email', () => {
    for (const t of ['Angel', 'Large angel'] as const) {
      const c = fieldCopy(t)
      expect([c.name.label, c.firm.label, c.email.label]).toEqual(['Name', 'Title or company', 'Their email'])
      expect(c.name.help).toBe('The person.')
      expect(c.firm.placeholder).toBe('e.g. ex-founder, angel')
    }
  })

  it('the warm path and the address lists read the same for every type', () => {
    for (const t of TYPES) {
      const c = fieldCopy(t)
      expect(c.path.help).toBe('Who can introduce you, and how you know them. Leave it empty if it’s cold.')
      expect(c.emails.help).toMatch(/^One per line\./)
      expect(c.domains.help).toMatch(/^One per line\./)
    }
  })
})

describe('Save writes only what Dev changed', () => {
  it('a field Dev didn’t touch keeps its stored value, even when the form shows something older', () => {
    // The form opened while the card was still an Angel; enrichment then set it to Accelerator.
    const form = { ...hf, type: 'Angel' as const, name: 'Northwind S27 (batch 2)' }
    const out = keepUntouched(hf, form, ['name'])
    expect(out.type).toBe('Accelerator')
    expect(out.name).toBe('Northwind S27 (batch 2)')
    expect(changedFields(hf, out)).toEqual(['name'])
  })

  it('wave and stage too', () => {
    const now = { ...hf, wave: 2 as const, stage: 'intro' as const }
    const out = keepUntouched(now, { ...hf, notes: 'Demo day in March.' }, ['notes'])
    expect([out.wave, out.stage, out.notes]).toEqual([2, 'intro', 'Demo day in March.'])
  })

  it('a field Dev changed is written, and Park until follows the stage', () => {
    const parked = { ...hf, stage: 'parked' as const, parkedUntil: '2026-12-01' }
    const out = keepUntouched(parked, { ...parked, type: 'Seed fund', stage: 'ask', parkedUntil: undefined }, ['type', 'stage'])
    expect(out.type).toBe('Seed fund')
    expect(out.stage).toBe('ask')
    expect(out.parkedUntil).toBeUndefined()
  })

  it('nothing touched: nothing changes', () => {
    const tidied = { ...hf, name: '  Northwind S27 ', notes: '' }
    expect(changedFields(hf, keepUntouched(hf, tidied, []))).toEqual([])
    expect(keepUntouched(fieldsOf(hf), tidied, [])).toEqual(fieldsOf(hf))
  })
})
