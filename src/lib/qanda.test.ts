// PST-281: the Q&A bank's rules. Made-up investors and questions only.
import { describe, expect, it } from 'vitest'
import {
  askedMost, cleanQuestion, facts, guessTheme, lastTouches, NEXT_DECK, nextDeck, noteLines, prepQuestions, searchQuestions, similarQuestions, themeChips, unanswered, whoTheyAre,
  type Ask, type Question,
} from './qanda'

let n = 0
const ask = (investorId: string, date = '2026-11-05'): Ask => ({ _id: `a${n++}`, investorId, date, source: 'notes' })
const q = (text: string, asks: Ask[], o: Partial<Question> = {}): Question => ({
  _id: `q${n++}`, text, theme: 'Product', bestAnswer: 'An answer.', answerVersions: [], onDeck: false, askedCount: asks.length, createdAt: n, updatedAt: n, asks, ...o,
})

const investors = [
  { _id: 'kite', type: 'Angel' as const },
  { _id: 'saltmarsh', type: 'Angel' as const },
  { _id: 'tidewater', type: 'Angel' as const },
  { _id: 'orchard', type: 'Pre-seed fund' as const },
  { _id: 'lantern', type: 'Micro-VC' as const },
]

describe('the prep brief', () => {
  it('picks what they asked first, then what similar investors asked, then the most asked', () => {
    const theirs = q('What does retention look like after week 4?', [ask('kite'), ask('kite'), ask('orchard')])
    const theirsOnce = q('Who else is in the round?', [ask('kite')], { bestAnswer: '' })
    const angels = q('Why will parents pay when free apps exist?', [ask('saltmarsh'), ask('tidewater'), ask('orchard')])
    const angelOnce = q('Why is this team the one to build it?', [ask('tidewater')])
    const funds = q('How do you reach the first 10,000 families?', [ask('orchard'), ask('orchard'), ask('lantern'), ask('lantern'), ask('orchard')])
    const fundsUnanswered = q('What happens to margins when you add voice?', [ask('orchard'), ask('lantern'), ask('lantern'), ask('orchard'), ask('lantern'), ask('orchard')], { bestAnswer: '' })
    const nobody = q('Would you take a lead with a board seat?', [])
    const all = [nobody, funds, fundsUnanswered, angelOnce, angels, theirsOnce, theirs]

    const picks = prepQuestions({ _id: 'kite', type: 'Angel' }, investors, all, 6)
    expect(picks.map((p) => [p.q.text, p.why, p.n])).toEqual([
      ['What does retention look like after week 4?', 'they', 2],
      ['Who else is in the round?', 'they', 1],
      ['Why will parents pay when free apps exist?', 'similar', 2],
      ['Why is this team the one to build it?', 'similar', 1],
      // Filling up: the bank's most asked, and only ones with an answer to read.
      ['How do you reach the first 10,000 families?', 'most', 5],
    ])
    expect(prepQuestions({ _id: 'kite', type: 'Angel' }, investors, all).map((p) => p.q)).toEqual([theirs, theirsOnce, angels, angelOnce])
    // A fund sees what funds asked: its own first, then the Micro-VC isn't "similar" (another type).
    expect(prepQuestions({ _id: 'lantern', type: 'Micro-VC' }, investors, all, 2).map((p) => [p.q.text, p.why])).toEqual([
      ['What happens to margins when you add voice?', 'they'],
      ['How do you reach the first 10,000 families?', 'they'],
    ])
  })

  it('says who they are from the investor record', () => {
    expect(whoTheyAre({ name: 'Kite Angels', firm: 'Kite Angels', type: 'Angel', expected: 25000, path: 'Ankur (ex-colleague)', lead: false, notes: 'Likes consumer and kids. Asked about week-4 retention. Send the beta numbers.' })).toEqual([
      'Angel. Expected $25K.',
      'Warm path: Ankur (ex-colleague).',
      'Likes consumer and kids. Asked about week-4 retention.',
    ])
    expect(whoTheyAre({ name: 'Orchard', firm: 'Orchard Capital', type: 'Pre-seed fund', path: 'cold', lead: true, notes: '' })).toEqual(['Pre-seed fund at Orchard Capital. Can lead or anchor.'])
  })

  it('lists the last touches, newest first', () => {
    const now = Date.parse('2026-11-07T10:20:00+05:30')
    const touches = lastTouches(
      [
        { kind: 'note', touch: 'call', note: '20 min. Liked the parent angle.', date: '2026-11-05' },
        { kind: 'stage', stage: 'm1', date: '2026-10-30' },
      ],
      [{ subject: 'Re: Deck and the clip', lastAt: Date.parse('2026-11-06T09:00:00+05:30'), lastFrom: 'them' }],
      [
        { title: 'Pesto × Kite Angels', start: Date.parse('2026-11-07T11:00:00+05:30'), end: Date.parse('2026-11-07T11:45:00+05:30') },
        { title: 'Intro call', start: Date.parse('2026-11-02T16:00:00+05:30'), end: Date.parse('2026-11-02T16:30:00+05:30') },
      ],
      now,
      '2026-11-07',
    )
    expect(touches.map((t) => t.text)).toEqual(['Email “Re: Deck and the clip”, they wrote last. Yesterday.', 'Call: 20 min. Liked the parent angle. Thu.', 'Meeting: Intro call. Mon.'])
  })
})

describe('the bank', () => {
  it('cleans a note line into a question and guesses its theme', () => {
    expect(cleanQuestion('  - "who else is in the round?"  ')).toBe('Who else is in the round?')
    expect(cleanQuestion('Q2: what happens to margins when you add voice?')).toBe('What happens to margins when you add voice?')
    expect(cleanQuestion('3) Why  this team?')).toBe('Why this team?')
    expect(guessTheme('What happens to margins when you add voice?')).toBe('Business model')
    expect(guessTheme('What does retention look like after week 4?')).toBe('Traction')
    expect(guessTheme('Would you take a lead with a board seat?')).toBe('Round')
    expect(guessTheme('How is this different from the incumbents?')).toBe('Competition')
    expect(guessTheme('How do you keep the stories safe for a 4-year-old?')).toBe('Product')
    expect(noteLines('One\n\n  - Two?\n---\n')).toEqual([{ line: 0, text: 'One' }, { line: 2, text: '- Two?' }])
  })

  it('counts the facts row and the theme chips, and splits the lists', () => {
    const qs = [
      q('Why will parents pay?', [ask('kite')], { theme: 'Business model', onDeck: true, slideRef: 'p8' }),
      q('Retention after week 4?', [ask('kite'), ask('orchard')], { theme: 'Traction' }),
      q('Who else is in the round?', [ask('orchard')], { theme: 'Round', bestAnswer: ' ' }),
      q('Why storytelling?', [], { theme: 'Mission' }),
    ]
    expect(facts(qs, 14)).toEqual({ questions: 4, fromMeetings: 14, needAnswer: 1, onSlide: 1 })
    expect(themeChips(qs)).toEqual([
      { theme: 'Traction', n: 1 }, { theme: 'Business model', n: 1 }, { theme: 'Round', n: 1 }, { theme: 'Mission', n: 1 },
    ])
    expect(unanswered(qs).map((x) => x.text)).toEqual(['Who else is in the round?'])
    expect(askedMost(qs).map((x) => x.text)).toEqual(['Retention after week 4?', 'Why will parents pay?', 'Why storytelling?'])
    expect(askedMost(qs, 'Traction').map((x) => x.text)).toEqual(['Retention after week 4?'])
  })

  it('finds similar questions and searches questions and answers', () => {
    const safe = q('How do you moderate content?', [ask('kite')])
    const wrong = q('What stops the AI saying something wrong?', [ask('kite')], { bestAnswer: 'Every story passes two filters before a child hears it.' })
    const pay = q('Why will parents pay?', [])
    const all = [safe, wrong, pay]
    expect(similarQuestions({ _id: 'new', text: 'How do you moderate the content kids see?' }, all)).toEqual([safe])
    expect(searchQuestions(all, 'parents').map((r) => r.q)).toEqual([pay])
    expect(searchQuestions(all, 'two filters')).toEqual([{ q: wrong, quote: 'Every story passes two filters before a child hears it.' }])
    expect(searchQuestions(all, 'x')).toEqual([])
  })
})

describe('nextDeck', () => {
  const deck = (id: string, currentVersionId: string | undefined, createdAt: number) => ({ kind: 'deck' as const, currentVersionId, createdAt, _id: id })
  it('is the version after the newest pitch deck’s current one', () => {
    const versions = [{ _id: 'v3', n: 3 }, { _id: 'v4', n: 4 }, { _id: 'v8', n: 8 }, { _id: 'm9', n: 9 }]
    expect(nextDeck([deck('a', 'v3', 1), { kind: 'memo', currentVersionId: 'm9', createdAt: 5 }], versions)).toBe(4)
    expect(nextDeck([deck('a', 'v3', 1), deck('b', 'v8', 2)], versions)).toBe(9)
  })
  it('falls back to the constant without a deck', () => {
    expect(nextDeck([], [])).toBe(NEXT_DECK)
    expect(nextDeck([deck('a', undefined, 1)], [])).toBe(NEXT_DECK)
  })
})
