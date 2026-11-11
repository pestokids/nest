// PST-307: every Advisor block rendered to HTML with a made-up answer env: what
// each shows and which buttons it offers in each state. Nothing here calls Convex.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Block } from '../../lib/advisorBlocks'
import type { Investor } from '../../lib/pipeline'
import { BlockEnvContext, BlockView, dayLabel, SourceChips, suggestionTitle, type BlockEnv } from './Blocks'
import type { Source } from '../../lib/advisor'

const TODAY = '2026-11-11'
const lantern = { _id: 'inv1', name: 'Lantern Ventures', type: 'Seed fund', stage: 'm1', lead: true } as Investor
const juniper = { _id: 'inv2', name: 'Juniper Seed', type: 'Seed fund', stage: 'm2', lead: false } as Investor
const noop = () => {}
const env = (o: Partial<BlockEnv> = {}): BlockEnv => ({
  today: TODAY, done: true, investor: (id) => [lantern, juniper].find((i) => i._id === id), openInvestor: noop, openDraft: noop, prep: noop, hasMeeting: () => false,
  ask: noop, update: noop, tick: noop, pick: noop, suggestMove: noop, tryAnother: async () => null, useInStory: noop, blankToPlan: noop, saveToQanda: noop, editDraft: noop,
  sendSuggestion: noop, answerMemory: noop, openSource: noop, copy: noop, ...o,
})
const clean = (h: string) => h.replace(/<!-- -->/g, '').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const render = (block: Block, o?: Partial<BlockEnv>) => clean(renderToString(createElement(BlockEnvContext.Provider, { value: env(o) }, createElement(BlockView, { block, index: 0 }))))
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const buttons = (h: string) => [...h.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => text(m[1])).filter(Boolean)

describe('Advisor blocks', () => {
  it('an investor card: name, note, stage, and Move only as a suggestion', () => {
    const h = render({ kind: 'investor_card', investorId: 'inv1', note: 'Can lead · 1st meeting Wed' })
    expect(text(h)).toContain('Lantern Ventures Can lead · 1st meeting Wed')
    expect(buttons(h)).toEqual(['Open', 'Move to 2nd meeting'])
    expect(h).toContain('aria-haspopup="menu"')
    expect(h).toContain('Sends the move to Suggestions')
    expect(buttons(render({ kind: 'investor_card', investorId: 'inv1' }, { hasMeeting: () => true }))).toContain('Prep brief')
    expect(render({ kind: 'investor_card', investorId: 'gone' })).toBe('')
  })

  it('a plan: each step with its day and box, and Add all to Today while two are open', () => {
    const plan: Block = { kind: 'plan', title: 'Kickoff week', items: [{ text: 'Send Sam the intro ask', date: TODAY }, { text: 'Book Lantern’s partner slot', date: '2026-11-13', investorId: 'inv1' }, { text: 'Wire', date: '2026-11-30' }], ticked: [0] }
    const h = render(plan)
    expect(text(h)).toContain('Send Sam the intro ask Today')
    expect(text(h)).toContain('Book Lantern’s partner slot Fri')
    expect(text(h)).toContain('Wire Mon 30 Nov')
    expect(h.match(/type="checkbox"/g)).toHaveLength(3)
    expect(h.match(/checked=""/g)).toHaveLength(1)
    expect(buttons(h)).toEqual(['Add all to Today'])
    expect(buttons(render({ ...plan, ticked: [0, 1] }))).toEqual([])
    expect(dayLabel('2026-11-12', TODAY)).toBe('Tomorrow')
  })

  it('options: upside and risk each, and the picked one says so', () => {
    const b: Block = { kind: 'options', question: 'Slow Juniper down?', options: [{ label: 'Slow down', upside: 'Two offers.', risk: 'Cools off.' }, { label: 'Take it', upside: 'Money now.', risk: 'No leverage.' }] }
    expect(buttons(render(b))).toEqual(['Choose A', 'Choose B'])
    const picked = render({ ...b, picked: 0 })
    expect(text(picked)).toContain('Going with A')
    expect(text(picked)).toContain('Risk: No leverage.')
    expect(picked).toMatch(/<button[^>]*disabled=""[^>]*><span[^>]*>Choose B/)
  })

  it('the race: a bar per investor, the one ahead in orange, and the link to Race', () => {
    const h = render({ kind: 'race', investorIds: ['inv1', 'inv2'], note: 'Juniper is a stage ahead' })
    expect(h.match(/adv-race__bar/g)).toHaveLength(2)
    expect(h.match(/is-ahead/g)).toHaveLength(1)
    expect(h).toContain('href="/raise/pipeline?view=race"')
    expect(text(h)).toContain('Juniper is a stage ahead · Open the race')
  })

  it('a story: beats in order with their blanks drawn, Try another on each', () => {
    const h = render({ kind: 'story', beats: [{ label: 'HOOK', text: 'Every night, [__] kids ask again.' }, { label: 'ASK', text: 'We’d love Lantern to lead.' }] })
    expect(text(h)).toMatch(/HOOK Every night, \[__\] kids ask again\..*ASK We’d love Lantern to lead\./)
    expect(h).toContain('adv-blank-mark')
    expect(buttons(h).filter((b) => b === 'Try another')).toHaveLength(2)
    expect(text(h)).toContain('Drag to reorder')
    expect(buttons(render({ kind: 'story', beats: [{ label: 'HOOK', text: 'x' }, { label: 'ASK', text: 'y' }] }, { compact: true }))).not.toContain('Try another')
  })

  it('a blank: the number with its unit, Use in this story and Save to Plan', () => {
    const h = render({ kind: 'blank', label: 'Week-8 retention', unit: '%', why: 'Cohort people ask first.' })
    expect(text(h)).toContain('Week-8 retention Cohort people ask first. %')
    expect(buttons(h)).toEqual(['Use in this story', 'Save to Plan'])
    expect(buttons(render({ kind: 'blank', label: 'Week-8 retention', value: '42', saved: 'plan' }))).toEqual(['Use in this story', 'Sent to Suggestions'])
  })

  it('drafts: an email opens in Drafts and says nothing is sent; an answer saves to Q&A', () => {
    const email = render({ kind: 'draft', draftKind: 'email', title: 'Email to Sam for 2 intros', subject: 'Two intros?', body: 'Hi Sam', investorId: 'inv1', draftId: 'd1' })
    expect(text(email)).toContain('Two intros? · Opens in Drafts; nothing is sent.')
    expect(buttons(email)).toEqual(['Hi Sam', 'Copy', 'Open draft'])
    expect(email).toContain('title="Click to edit"')
    const qa = render({ kind: 'draft', draftKind: 'story', title: 'Lantern open', body: 'Every night…', investorId: 'inv1' })
    expect(text(qa)).toContain('Save as “Lantern open” in Q&A')
    expect(text(qa)).toContain('so prep for Lantern uses it')
    expect(buttons(qa)).toEqual(['Every night…', 'Copy', 'Save'])
    expect(buttons(render({ kind: 'draft', draftKind: 'qa', title: 'Why now', question: 'Why now?', body: 'x', questionId: 'q1' }))).toEqual(['x', 'Copy', 'Saved'])
    expect(buttons(render({ kind: 'draft', draftKind: 'email', title: 'Note', body: 'Hi', investorId: 'inv1' }, { compact: true }))).toEqual(['Open'])
  })

  it('follow-ups are buttons that ask', () => {
    expect(buttons(render({ kind: 'follow_ups', questions: ['Who else could lead?', 'Draft the note', 'What if they say no?'] }))).toEqual(['Who else could lead?', 'Draft the note', 'What if they say no?'])
  })

  it('a suggestion waits for Send to Suggestions, then says where it went', () => {
    const b: Block = { kind: 'suggestion', investorId: 'inv2', change: 'decide_by', date: '2026-11-20', why: 'Keeps both offers close.', state: 'proposed' }
    const h = render(b)
    expect(text(h)).toContain('Set Juniper’s decide-by to Fri 20 Nov')
    expect(text(h)).toContain('Nest won’t change anything on its own.')
    expect(buttons(h)).toEqual(['Send to Suggestions'])
    expect(buttons(render({ ...b, state: 'sent' }))).toEqual([])
    expect(text(render({ ...b, state: 'not_added', note: 'A suggestion like this is already waiting.' }))).toContain('already waiting')
    expect(suggestionTitle({ ...b, change: 'stage', value: 'dd' }, 'Juniper Seed')).toBe('Move Juniper to Diligence')
  })

  it('memory asks first; nothing says remembered until Yes', () => {
    const asked = render({ kind: 'memory', fact: 'Dev prefers a call before the deck.', state: 'asked' })
    expect(text(asked)).toContain('Remember this?')
    expect(buttons(asked)).toEqual(['Yes, remember', 'No'])
    expect(text(render({ kind: 'memory', fact: 'Dev prefers a call before the deck.', state: 'saved', memoryId: 'm1' }))).toContain('Remembered: “Dev prefers a call before the deck.”')
    expect(text(render({ kind: 'memory', fact: 'x', state: 'dismissed' }))).toBe('Not remembered.')
  })

  it('while the answer streams, its buttons wait', () => {
    const h = render({ kind: 'suggestion', investorId: 'inv2', change: 'next_step', value: 'Send the deck', why: 'They asked.', state: 'proposed' }, { done: false })
    expect(h).toMatch(/<button[^>]*disabled=""[^>]*><span[^>]*>Send to Suggestions/)
  })

  it('From: chips link investors and views, and web pages open outside', () => {
    const sources: Source[] = [{ kind: 'investor', label: 'Lantern · enrichment', investorId: 'inv1' }, { kind: 'plan', label: 'Plan · metrics' }, { kind: 'web', label: 'A', url: 'https://a.example.com' }]
    const h = clean(renderToString(createElement(BlockEnvContext.Provider, { value: env() }, createElement(SourceChips, { sources }))))
    expect(buttons(h)).toEqual(['Lantern · enrichment', 'Plan · metrics'])
    expect(h).toMatch(/<a[^>]*href="https:\/\/a.example.com"[^>]*target="_blank"[^>]*>Web: 1 source<\/a>/)
  })
})
