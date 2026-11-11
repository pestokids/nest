// PST-307: the Advisor's pure pieces: the chat list's groups, the "From:" chips,
// the cap and its line, the ⌘J panel's "Looking at", and filling a blank into a story.
// PST-308: an answer's words and blocks in the order written.
import { describe, expect, it } from 'vitest'
import { answerParts, capCheck, chatHeadMeta, groupChats, lookingAt, monthLine, partsText, sourceChips, tidyParts, titleFrom, weekStartIST, type AnswerPart } from './advisor'
import { fillInto, planStep, type Block } from './advisorBlocks'
import { SONNET } from './models'

const H = 36e5
// Wednesday 11 Nov 2026, 14:00 IST.
const NOW = Date.parse('2026-11-11T14:00:00+05:30')

describe('the chat list', () => {
  const chat = (title: string, ago: number, pinned = false) => ({ title, pinned, updatedAt: NOW - ago })
  const chats = [chat('Plan my week', 2 * H), chat('Lead strategy', 300 * H, true), chat('Polite no', 12 * 24 * H), chat('Tighten the story', 70 * H), chat('Monday morning', 60 * H)]

  it('groups Pinned, This week (since Monday, IST) and Earlier, newest first', () => {
    expect(new Date(weekStartIST(NOW)).toISOString()).toBe('2026-11-08T18:30:00.000Z')
    expect(groupChats(chats, NOW).map((g) => [g.label, g.chats.map((c) => c.title)])).toEqual([
      ['Pinned', ['Lead strategy']],
      ['This week', ['Plan my week', 'Monday morning']],
      ['Earlier', ['Tighten the story', 'Polite no']],
    ])
  })

  it('search keeps chats with every word, and drops empty groups', () => {
    expect(groupChats(chats, NOW, 'STORY tighten').map((g) => [g.key, g.chats.map((c) => c.title)])).toEqual([['earlier', ['Tighten the story']]])
    expect(groupChats(chats, NOW, 'nothing like it')).toEqual([])
  })

  it('a title is the first question on one line, cut to fit', () => {
    expect(titleFrom('  Who should\n lead?  ')).toBe('Who should lead?')
    expect(titleFrom('x'.repeat(80))).toHaveLength(60)
    expect(chatHeadMeta({ model: SONNET, mode: 'coach', messageCount: 14, totalCostUsd: 0.09, createdAt: NOW - 50 * H }, NOW)).toBe('Started Mon · Sonnet 5.5 · 14 messages · 9¢')
  })
})

describe('sources', () => {
  it('one chip each, web pages folded into one, at most eight', () => {
    const chips = sourceChips([
      { kind: 'investor', label: 'Lantern · enrichment', investorId: 'a' },
      { kind: 'investor', label: 'Lantern · enrichment', investorId: 'a' },
      { kind: 'web', label: 'One', url: 'https://one.example.com' },
      { kind: 'web', label: 'Two', url: 'https://two.example.com' },
      { kind: 'race', label: 'Race · kickoff week' },
    ])
    expect(chips.map((c) => c.text)).toEqual(['Lantern · enrichment', 'Race · kickoff week', 'Web: 2 sources'])
    expect(sourceChips(Array.from({ length: 12 }, (_, k) => ({ kind: 'notes' as const, label: 'Note ' + k })))).toHaveLength(8)
  })
})

describe('the cap', () => {
  it('a run that would pass the cap is refused with the way to Settings', () => {
    expect(capCheck(19.9, 0.05, 20)).toEqual({ ok: true })
    const no = capCheck(19.99, 0.03, 20)
    expect(no.ok).toBe(false)
    expect(!no.ok && no.message).toMatch(/Settings › AI › Advisor/)
    expect(monthLine(3.12, 20)).toEqual({ text: '$3.12 of $20', pct: 16 })
    expect(monthLine(30, 20).pct).toBe(100)
  })
})

describe('the ⌘J panel', () => {
  it('says what Dev is looking at', () => {
    expect(lookingAt({ path: '/raise/pipeline', view: 'race' })).toBe('Pipeline › Race')
    expect(lookingAt({ path: '/raise/investors', investorId: 'x', investorName: 'Lantern Ventures' })).toBe('Investors › Lantern Ventures')
    expect(lookingAt({ path: '/' })).toBe('Home')
  })
})

describe('blanks and plan steps', () => {
  const story: Block = {
    kind: 'story',
    beats: [
      { label: 'HOOK', text: 'Every night, [__] kids ask for the same story.' },
      { label: 'PROOF', text: 'Week-8 retention of [__]%, and parents start [__] in 5 sessions.' },
    ],
  }
  it('a blank fills the line that mentions it, without typing its unit twice', () => {
    const hit = fillInto([{ kind: 'follow_ups', questions: ['a', 'b', 'c'] }, story], 'Week-8 retention', '42 %', '%')
    expect(hit?.index).toBe(1)
    expect(hit?.block.kind === 'story' && hit.block.beats.map((b) => b.text)).toEqual(['Every night, [__] kids ask for the same story.', 'Week-8 retention of 42%, and parents start [__] in 5 sessions.'])
  })
  it('never guesses which number a line wants', () => {
    expect(fillInto([story], 'Monthly burn', '30000')).toBeNull()
  })
  it('a ticked step becomes the next step, and Undo puts the old one back', () => {
    expect(planStep({ nextStep: 'Send deck', nextDate: '2026-11-12' }, { text: 'Book the partner slot', date: '2026-11-13' })).toEqual({
      set: { nextStep: 'Book the partner slot', nextDate: '2026-11-13' },
      undo: { nextStep: 'Send deck', nextDate: '2026-11-12' },
    })
  })
})

/* ---------- PST-308: an answer's parts, in the order written ---------- */

describe('an answer’s parts', () => {
  const plan: Block = { kind: 'plan', title: 'Today', items: [{ text: 'Ask Lantern what they’d need to lead', date: '2026-11-11' }], ticked: [] }
  const options: Block = { kind: 'options', options: [{ label: 'Ask for a week', upside: 'Time', risk: 'Cools off' }, { label: 'Take it', upside: 'A lead', risk: 'Less room' }] }
  const follow: Block = { kind: 'follow_ups', questions: ['Draft the ask', 'Who should I drop?', 'What if they say no?'] }

  it('keeps words and blocks in the order written, and leaves the follow-ups for the end', () => {
    const parts: AnswerPart[] = [{ text: 'In the plan, tick what you’ll do today.' }, { block: 0 }, { text: 'Do Lantern first.' }, { block: 1 }, { block: 2 }]
    expect(answerParts({ text: '', blocks: [plan, options, follow], parts, status: 'done' })).toEqual([{ text: 'In the plan, tick what you’ll do today.' }, { block: 0 }, { text: 'Do Lantern first.' }, { block: 1 }])
  })

  it('reads an answer saved before parts as its text, then its blocks', () => {
    expect(answerParts({ text: 'You can tick the steps in the plan.', blocks: [plan, follow], status: 'done' })).toEqual([{ text: 'You can tick the steps in the plan.' }, { block: 0 }])
    expect(answerParts({ text: '', blocks: [plan], status: 'done' })).toEqual([{ block: 0 }])
  })

  it('hides a block not placed yet while streaming, and shows it at the end once the answer is over', () => {
    const m = { text: 'Lead-in.', blocks: [plan], parts: [{ text: 'Lead-in.' }] }
    expect(answerParts({ ...m, status: 'streaming' })).toEqual([{ text: 'Lead-in.' }])
    expect(answerParts({ ...m, status: 'failed' })).toEqual([{ text: 'Lead-in.' }, { block: 0 }])
  })

  it('trims text, drops empty runs and joins runs that meet as paragraphs', () => {
    expect(tidyParts([{ text: '  One. ' }, { text: '' }, { text: 'Two.' }, { block: 0 }, { text: ' ' }, { text: 'Three.' }])).toEqual([{ text: 'One.\n\nTwo.' }, { block: 0 }, { text: 'Three.' }])
    expect(answerParts({ text: '', blocks: [follow], parts: [{ text: 'Before.' }, { block: 0 }, { text: 'After.' }], status: 'done' })).toEqual([{ text: 'Before.\n\nAfter.' }])
    expect(partsText([{ text: 'Before.' }, { block: 0 }, { text: 'After.' }])).toBe('Before.\n\nAfter.')
  })
})
