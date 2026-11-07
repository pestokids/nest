// PST-279: how an Ask Nest answer reads. Made-up investors only.
import { describe, expect, it } from 'vitest'
import { citedIds, parseAnswer, sourcesLine, suggestedQuestions, workingLine, type AnswerBlock, type Inline } from './ask'

/** All the plain text an answer shows. */
const shown = (blocks: AnswerBlock[]) =>
  blocks
    .flatMap((b): Inline[] => (b.kind === 'p' ? b.parts : b.items.flat()))
    .map((p) => (p.kind === 'investor' ? p.name : p.text))
    .join('')

const ANSWER = [
  'Three people, in this order:',
  '',
  '1. [[investor:k1|Orchard Capital]] opened deck v4 this morning (4 min). Send the data room.',
  '2. [[investor:k2|Lantern Ventures]] has been at Intro for 9 days. Book the first call.',
  '   Ankur can nudge.',
  '3. [[investor:k3|Kite Angels]] asked for week-8 retention.',
  '',
  'All **three** are warm.',
  '[[action:open|k1]]',
  '[[action:prep|m9]]',
  '[[action:open|k1]]',
  '[[action:draft|k2]]',
].join('\n')

describe('parseAnswer', () => {
  it('turns citations into investor chips, numbered lines into a list, and action lines into buttons', () => {
    const { blocks, actions } = parseAnswer(ANSWER)
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'ol', 'p'])
    const ol = blocks[1]
    if (ol.kind !== 'ol') throw new Error('not a list')
    expect(ol.items).toHaveLength(3)
    expect(ol.items[0][0]).toEqual({ kind: 'investor', id: 'k1', name: 'Orchard Capital' })
    expect(ol.items[0][1]).toEqual({ kind: 'text', text: ' opened deck v4 this morning (4 min). Send the data room.' })
    // An indented line belongs to the item above it.
    expect(ol.items[1].map((p) => ('text' in p ? p.text : p.name)).join('')).toContain('Book the first call. Ankur can nudge.')
    expect(blocks[2]).toEqual({ kind: 'p', parts: [{ kind: 'text', text: 'All ' }, { kind: 'bold', text: 'three' }, { kind: 'text', text: ' are warm.' }] })
    // Each action once, and never as text.
    expect(actions).toEqual([{ kind: 'open', id: 'k1' }, { kind: 'prep', id: 'm9' }, { kind: 'draft', id: 'k2' }])
    expect(shown(blocks)).not.toContain('[')
    expect(citedIds(ANSWER)).toEqual(['k1', 'k2', 'k3'])
  })

  it('holds back a half-written citation while it streams', () => {
    const half = parseAnswer('Chase [[investor:k1|Orch', true)
    expect(half.blocks).toEqual([{ kind: 'p', parts: [{ kind: 'text', text: 'Chase' }] }])
    expect(shown(parseAnswer('Chase [', true).blocks)).toBe('Chase')
    const whole = parseAnswer('Chase [[investor:k1|Orchard Capital]] today', true)
    expect(whole.blocks[0]).toEqual({ kind: 'p', parts: [{ kind: 'text', text: 'Chase ' }, { kind: 'investor', id: 'k1', name: 'Orchard Capital' }, { kind: 'text', text: ' today' }] })
  })

  it('leaves odd markers alone and keeps at most three actions', () => {
    expect(parseAnswer('See [[investor:k1]] and [[action:delete|k1]].').blocks[0]).toEqual({ kind: 'p', parts: [{ kind: 'text', text: 'See [[investor:k1]] and [[action:delete|k1]].' }] })
    expect(parseAnswer(['a', 'b', 'c', 'd'].map((x) => `[[action:open|${x}]]`).join('\n')).actions.map((a) => a.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('the lines around it', () => {
  it('says what it read and what it cost', () => {
    expect(sourcesLine({ investors: 40, threads: 12, meetings: 3 }, 0.012)).toBe('From 40 investors, 12 email threads and 3 meetings · 1¢')
    expect(sourcesLine({ investors: 1, threads: 0, meetings: 2 }, 0.004)).toBe('From 1 investor and 2 meetings · 0.4¢')
    expect(sourcesLine({ investors: 3, threads: 0, meetings: 0 }, 0.004, 'claude-haiku-5-5')).toBe('From 3 investors · Haiku · 0.4¢')
    expect(sourcesLine({ investors: 0, threads: 0, meetings: 0 }, 0.031)).toBe('From Nest’s data · 3¢')
  })
  it('says what it is doing while it reads', () => {
    expect(workingLine([])).toBe('Thinking…')
    expect(workingLine(['todays_moves', 'round_totals'])).toBe('Adding up the round…')
  })
  it('suggests the deck by its current version', () => {
    expect(suggestedQuestions(4)).toEqual(['How much is verbal but not signed?', 'Prep me for my 4pm', 'Who hasn’t seen deck v4?'])
    expect(suggestedQuestions()[2]).toBe('Who hasn’t seen the deck?')
  })
})
