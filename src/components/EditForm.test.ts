// PST-303: the drawer's edit form on a fund, an accelerator and an angel, rendered to HTML.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EditForm } from './Drawer'
import { RaiseContext, type RaiseData } from './data'
import { UIContext, type UI } from './raise-ui'
import { NEW_INVESTOR, type Investor } from '../lib/pipeline'

const raise = { round: { waves: ['Wave 1', 'Wave 2', 'Wave 3'] }, save: async () => 'x' } as unknown as RaiseData
const ui = { opening: {}, toast: () => {}, fail: () => {} } as unknown as UI
const investor = (x: Partial<Investor>): Investor => ({ ...NEW_INVESTOR, _id: 'i1', maxStage: 'ask', ...x }) as Investor
const render = (inv: Investor | null) =>
  renderToString(createElement(RaiseContext.Provider, { value: raise }, createElement(UIContext.Provider, { value: ui }, createElement(EditForm, { inv, onDone: () => {} }))))
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
const labels = (html: string) => [...html.matchAll(/<label class="field__label"[^>]*>([^<]*)<\/label>/g)].map((m) => m[1])
const selected = (html: string) => [...html.matchAll(/<option value="([^"]*)" selected="">/g)].map((m) => m[1])

describe('the edit form by type', () => {
  it('an accelerator: the Type select shows Accelerator, not the first option', () => {
    const html = render(investor({ name: 'Northwind S27', firm: 'Northwind', type: 'Accelerator', wave: 1, stage: 'ask' }))
    // Type, Wave, Stage, Relationship
    expect(selected(html)).toEqual(['Accelerator', '1', 'ask', 'intro'])
    expect(labels(html).slice(0, 4)).toEqual(['Programme', 'Accelerator', 'Contact email (optional)', 'Type'])
    expect(html).toContain('The programme and batch, e.g. Northwind S27.')
    expect(html).toContain('Leave it empty if it’s cold.')
  })

  it('a fund: Partner, Fund, Partner’s email', () => {
    const html = render(investor({ name: 'Asha Linden', firm: 'Northstar Ventures', type: 'Seed fund', wave: 3, stage: 'm1' }))
    expect(selected(html).slice(0, 3)).toEqual(['Seed fund', '3', 'm1'])
    expect(labels(html).slice(0, 3)).toEqual(['Partner', 'Fund', 'Partner’s email'])
    expect(html).toContain('One card per fund.')
  })

  it('an angel: Name, Title or company, Their email', () => {
    const html = render(investor({ name: 'Asha Linden', type: 'Large angel' }))
    expect(selected(html)[0]).toBe('Large angel')
    expect(labels(html).slice(0, 3)).toEqual(['Name', 'Title or company', 'Their email'])
  })

  it('other emails and domains: one per line', () => {
    const html = render(investor({ type: 'Seed fund', emails: ['leo@northstar.vc', 'maya@northstar.vc'], domains: ['northstar.vc'] }))
    expect(html).toContain('leo@northstar.vc\nmaya@northstar.vc')
    expect(labels(html)).toEqual(expect.arrayContaining(['Other emails', 'Fund domains']))
  })

  it('Add investor starts as an angel with its labels', () => {
    const html = render(null)
    expect(labels(html).slice(0, 3)).toEqual(['Name *', 'Title or company', 'Type'])
  })
})
