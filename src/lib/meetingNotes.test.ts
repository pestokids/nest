// PST-277: the checks between Claude's answer and what Nest proposes. Names are made up.
import { describe, expect, it } from 'vitest'
import { appliedLine, matchNote, nextStage, proposalText, proposalsFrom, quoteIn, readView, saidAmount, startsTicked, type NoteAnswer, type NoteRead } from './meetingNotes'

const note = 'Liked the retention story.\nSaid “around fifty” if the numbers hold.\nWho else is in the round?\nSam offered an intro to Orchard Capital.'
const empty: NoteAnswer = { summary: [], nextStep: null, stage: null, expected: null, questions: [], warmPaths: [] }
const ctx = { note, investor: { stage: 'booked' as const, nextStep: '' }, bank: [{ _id: 'q1', text: 'Who else is in the round?' }] }

describe('quotes', () => {
  it('finds a quote in the note whatever the case, spacing and curly quotes', () => {
    expect(quoteIn(note, 'said "around fifty"')).toBe(true)
    expect(quoteIn(note, '  WHO ELSE   is in the round  ')).toBe(true)
    expect(quoteIn(note, 'around sixty')).toBe(false)
    expect(quoteIn(note, 'Li')).toBe(false)
    expect(quoteIn(note, null)).toBe(false)
  })
  it('knows when a quote says an amount', () => {
    for (const q of ['around fifty', '$50K', 'a lakh or two', '25k']) expect(saidAmount(q)).toBe(true)
    for (const q of ['if the numbers hold', 'happy to write a cheque']) expect(saidAmount(q)).toBe(false)
  })
})

describe('proposalsFrom', () => {
  it('only ever moves to the next stage, and never a closed card', () => {
    expect(nextStage('booked')).toBe('m1')
    expect(nextStage('wired')).toBeNull()
    expect(nextStage('parked')).toBeNull()
    const say = (to: string) => proposalsFrom({ ...empty, stage: { to, quote: 'Liked the retention story' } }, ctx).proposals
    expect(say('m1')).toMatchObject([{ kind: 'stage', from: 'booked', to: 'm1' }])
    expect(say('m2')).toEqual([])
    expect(say('intro')).toEqual([])
    expect(proposalsFrom({ ...empty, stage: { to: 'm1', quote: 'Liked the retention story' } }, { ...ctx, investor: { stage: 'passed', nextStep: '' } }).proposals).toEqual([])
  })

  it('keeps Expected only with an amount said in the note, and notes a clash with one typed', () => {
    const e = (quote: string, expected?: number) => proposalsFrom({ ...empty, expected: { amount: 50000, quote } }, { ...ctx, investor: { ...ctx.investor, expected } }).proposals
    expect(e('around fifty')).toMatchObject([{ kind: 'expected', amount: 50000 }])
    expect(e('if the numbers hold')).toEqual([])
    expect(e('around eighty')).toEqual([])
    expect(e('around fifty', 50000)).toEqual([])
    const [clash] = e('around fifty', 25000)
    expect(clash).toMatchObject({ clash: 'You wrote $25K as Expected. Applying won’t change it.' })
    expect(startsTicked(clash)).toBe(false)
  })

  it('matches questions to the bank, drops invented ones, and pre-ticks all but warm paths', () => {
    const { proposals, summary } = proposalsFrom(
      {
        ...empty,
        summary: ['One.', 'Two.', 'Three.', 'Four.'],
        questions: [
          { text: 'Who else is in the round?', questionId: 'nope', answer: 'Two angels.', answerQuote: 'not in the note', quote: 'Who else is in the round?' },
          { text: 'What is your CAC?', questionId: null, answer: null, answerQuote: null, quote: 'CAC is $6' },
        ],
        warmPaths: [{ text: 'Sam offered an intro to Orchard Capital', quote: 'offered an intro to Orchard Capital' }],
      },
      ctx,
    )
    expect(summary).toEqual(['One.', 'Two.', 'Three.'])
    expect(proposals).toEqual([
      { id: 'questions', kind: 'questions', items: [{ text: 'Who else is in the round?', questionId: 'q1', quote: 'Who else is in the round?' }] },
      { id: 'warm_path:0', kind: 'warm_path', text: 'Sam offered an intro to Orchard Capital', quote: 'offered an intro to Orchard Capital' },
    ])
    expect(proposals.map(startsTicked)).toEqual([true, false])
  })
})

describe('the card', () => {
  it('reads like the design', () => {
    expect(proposalText({ id: 'stage', kind: 'stage', from: 'booked', to: 'm1', quote: 'x' })).toBe('Booked → 1st meeting')
    expect(proposalText({ id: 'expected', kind: 'expected', amount: 50000, quote: 'around fifty' })).toBe('$50K (“around fifty”)')
    expect(proposalText({ id: 'next_step', kind: 'next_step', step: 'Send week-8 retention', date: '2026-11-20', quote: 'x' })).toBe('Send week-8 retention · Fri 20 Nov')
    expect(
      proposalText({ id: 'questions', kind: 'questions', items: [{ text: 'How do you keep the stories safe for a 4-year-old?', quote: 'x' }, { text: 'Who else is in the round?', quote: 'x' }] }),
    ).toBe('2 questions: keep the stories safe for a 4-year-old, who else is in the round')
  })
  it('says what was applied, and which state a read is in', () => {
    const read = (o: Partial<NoteRead>): NoteRead => ({ _id: 'r', noteId: 'n', investorId: 'i', status: 'ready', summary: [], proposals: [], costUsd: 0, startedAt: 0, ...o })
    const p = [
      { id: 'next_step', kind: 'next_step' as const, step: 'a', quote: 'b', state: 'applied' as const },
      { id: 'warm_path:0', kind: 'warm_path' as const, text: 'a', quote: 'b', state: 'applied' as const },
      { id: 'stage', kind: 'stage' as const, from: 'booked' as const, to: 'm1' as const, quote: 'b', state: 'dropped' as const },
    ]
    expect(appliedLine(p)).toBe('Applied: next step, warm path')
    expect(readView(undefined)).toBe('none')
    expect(readView(read({ status: 'reading' }))).toBe('reading')
    expect(readView(read({}))).toBe('review')
    expect(readView(read({ proposals: p }))).toBe('done')
    expect(readView(read({ proposals: [{ ...p[0], state: 'open' }] }))).toBe('review')
  })
})

describe('matchNote', () => {
  const investors = [
    { _id: 'kite', name: 'Kite Angels', firm: 'Kite Angels', email: 'sam@kite.example.com' },
    { _id: 'orchard', name: 'Orchard Capital', firm: 'Orchard Capital', domains: ['orchard.example.com'] },
    { _id: 'lantern', name: 'Lantern Ventures', firm: 'Lantern Ventures' },
  ]
  const day = '2026-11-06'
  const at = Date.parse(day + 'T10:00:00+05:30')
  const meetings = [{ _id: 'm1', title: 'Pesto x Lantern', start: at, investorIds: ['lantern'] }]
  it('matches by address, person, domain, meeting, then a title naming one investor', () => {
    expect(matchNote({ email: 'SAM@kite.example.com', meetingTitle: 'Call', date: day }, investors, [], meetings)).toEqual({ investorId: 'kite' })
    expect(matchNote({ email: 'rhea@kite.example.com', meetingTitle: 'Call', date: day }, investors, [{ investorId: 'kite', email: 'rhea@kite.example.com' }], meetings)).toEqual({ investorId: 'kite' })
    expect(matchNote({ email: 'ana@orchard.example.com', meetingTitle: 'Call', date: day }, investors, [], meetings)).toEqual({ investorId: 'orchard' })
    expect(matchNote({ meetingTitle: 'pesto x lantern', date: day }, investors, [], meetings)).toEqual({ investorId: 'lantern', meetingId: 'm1' })
    expect(matchNote({ meetingTitle: 'Catch-up with Orchard', date: day }, investors, [], meetings)).toEqual({ investorId: 'orchard' })
  })
  it('gives up when nothing, or more than one, fits', () => {
    expect(matchNote({ email: 'someone@gmail.com', meetingTitle: 'Coffee', date: day }, investors, [], meetings)).toBeNull()
    expect(matchNote({ meetingTitle: 'Kite Angels and Orchard dinner', date: day }, investors, [], meetings)).toBeNull()
  })
})
