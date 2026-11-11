// PST-308: an answer drawn in the order the model wrote it (the same body the
// thread, the ⌘J panel and the phone show), and an answer saved before that still
// showing its words, then its blocks. Investors are made up; nothing calls Convex.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AdvisorMessage } from '../../lib/advisor'
import type { Block } from '../../lib/advisorBlocks'
import type { Investor } from '../../lib/pipeline'
import { BlockEnvContext, type BlockEnv } from './Blocks'
import { AnswerBody } from './Thread'

const lantern = { _id: 'inv1', name: 'Lantern Ventures', type: 'Seed fund', stage: 'm1', lead: true } as Investor
const noop = () => {}
const env: BlockEnv = {
  today: '2026-11-11', done: true, investor: (id) => (id === lantern._id ? lantern : undefined), openInvestor: noop, openDraft: noop, prep: noop, hasMeeting: () => false,
  ask: noop, update: noop, tick: noop, pick: noop, suggestMove: noop, tryAnother: async () => null, useInStory: noop, blankToPlan: noop, saveToQanda: noop, editDraft: noop,
  sendSuggestion: noop, answerMemory: noop, openSource: noop, copy: noop,
}
const plan: Block = { kind: 'plan', title: 'Today', items: [{ text: 'Ask Lantern what they’d need to lead', date: '2026-11-11', investorId: 'inv1' }], ticked: [] }
const card: Block = { kind: 'investor_card', investorId: 'inv1', note: 'Can lead' }
const follow: Block = { kind: 'follow_ups', questions: ['Draft the ask', 'Who should I drop?', 'What if they say no?'] }

type M = Pick<AdvisorMessage, 'text' | 'blocks' | 'parts' | 'status'>
const html = (m: M) => renderToString(createElement(BlockEnvContext.Provider, { value: { ...env, done: m.status !== 'streaming' } }, createElement(AnswerBody, { m, investor: env.investor, onInvestor: noop })))
describe('an answer, in the order written', () => {
  it('shows a lead-in, the block, then the words written after it', () => {
    const h = html({ text: '', blocks: [plan, follow], parts: [{ text: 'In the plan, tick what you’ll do today.' }, { block: 0 }, { text: 'Do [[investor:inv1|Lantern Ventures]] first.' }, { block: 1 }], status: 'done' })
    expect(h.indexOf('In the plan, tick')).toBeLessThan(h.indexOf('Ask Lantern what they’d need to lead'))
    expect(h.indexOf('Ask Lantern what they’d need to lead')).toBeLessThan(h.indexOf('first.'))
    expect(h).toContain('>Lantern Ventures</button>')
    expect(h).not.toContain('Draft the ask')
  })

  it('keeps two blocks written together in one column, between their words', () => {
    const h = html({ text: '', blocks: [card, plan], parts: [{ text: 'Lantern can lead.' }, { block: 0 }, { block: 1 }, { text: 'Start before lunch.' }], status: 'done' })
    const columns = h.split('class="adv-blocks"').length - 1
    expect(columns).toBe(1)
    expect(h.indexOf('Lantern can lead.')).toBeLessThan(h.indexOf('class="adv-blocks"'))
    expect(h.indexOf('Start before lunch.')).toBeGreaterThan(h.indexOf('Ask Lantern what they’d need to lead'))
  })

  it('an answer saved before parts still shows its words, then its blocks', () => {
    const h = html({ text: 'Lantern is closest to a decision.', blocks: [plan, follow], status: 'done' })
    expect(h).toContain('Lantern is closest to a decision.')
    expect(h.indexOf('Lantern is closest')).toBeLessThan(h.indexOf('Ask Lantern what they’d need to lead'))
  })

  it('while streaming, words that arrive after a block show after it', () => {
    const h = html({ text: '', blocks: [plan], parts: [{ text: 'In the plan, tick what you’ll do today.' }, { block: 0 }, { text: 'Do Lantern first: a clear' }], status: 'streaming' })
    expect(h.indexOf('Ask Lantern what they’d need to lead')).toBeLessThan(h.indexOf('Do Lantern first: a clear'))
    expect(html({ text: '', blocks: [], parts: [], status: 'streaming' })).toContain('Reading Nest…')
  })
})
