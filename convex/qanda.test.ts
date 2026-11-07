// @vitest-environment edge-runtime
// PST-281: the Q&A bank. Questions and answers, merging, picking note lines, and the facts row's counts.
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './_generated/api'
import type { Doc } from './_generated/dataModel'
import schema from './schema'
import { todayIST } from '../src/lib/dates'
import { earlierAnswers, facts } from '../src/lib/qanda'
import { addDays } from '../src/lib/today'

const modules = import.meta.glob('./**/*.ts')

beforeEach(() => {
  vi.stubEnv('ALLOWED_EMAILS', 'founder@pestokids.com')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

const base = { type: 'Angel' as const, geo: 'India' as const, warmth: 'warm' as const, path: '', tier: 'B' as const, wave: 1 as const, lead: false, nextStep: '', notes: '', source: '', updatedAt: 0 }

/** Two made-up investors: Kite Angels (an angel) and Orchard Capital (a pre-seed fund). */
async function setup() {
  const t = convexTest(schema, modules)
  const today = todayIST()
  const ids = await t.run(async (ctx) => {
    const dev = await ctx.db.insert('users', { email: 'founder@pestokids.com', name: 'Dev', emailVerificationTime: 1 })
    const inv = (f: Pick<Doc<'investors'>, 'name' | 'firm' | 'stage' | 'maxStage'> & Partial<Doc<'investors'>>) => ctx.db.insert('investors', { ...base, ...f })
    const kite = await inv({ name: 'Kite Angels', firm: 'Kite Angels', stage: 'm1', maxStage: 'm1' })
    const orchard = await inv({ name: 'Orchard Capital', firm: 'Orchard Capital', stage: 'm2', maxStage: 'm2', type: 'Pre-seed fund' })
    return { dev, kite, orchard }
  })
  const as = t.withIdentity({ subject: `${ids.dev}|s1` })
  const bank = () => as.query(api.qanda.bank, {})
  const find = async (id: string) => (await bank()).questions.find((q) => q._id === id)
  return { t, as, today, bank, find, ...ids }
}

describe('questions and answers', () => {
  it('creates a question, answers it, and keeps the earlier answer as a version', async () => {
    const s = await setup()
    const { id, existed } = await s.as.mutation(api.qanda.create, { text: '  - why will parents pay when free apps exist?', investorId: s.kite, date: addDays(s.today, -1) })
    expect(existed).toBe(false)
    expect(await s.find(id)).toMatchObject({
      text: 'Why will parents pay when free apps exist?', theme: 'Business model', bestAnswer: '', askedCount: 1, onDeck: false,
      asks: [{ investorId: s.kite, date: addDays(s.today, -1), source: 'manual' }],
    })

    await s.as.mutation(api.qanda.save, { id, text: 'Why will parents pay when free apps exist?', bestAnswer: 'They already pay for screen time they trust.', theme: 'Business model', slideRef: 'p8 · Pricing' })
    await s.as.mutation(api.qanda.save, { id, text: 'Why will parents pay when free apps exist?', bestAnswer: '41% of beta families chose the paid plan in week one.', theme: 'Business model', slideRef: 'p8 · Pricing' })
    const q = (await s.find(id))!
    expect(q).toMatchObject({ bestAnswer: '41% of beta families chose the paid plan in week one.', slideRef: 'p8 · Pricing', onDeck: true })
    expect(q.answerVersions.map((v) => [v.text, v.by])).toEqual([
      ['They already pay for screen time they trust.', 'Dev'],
      ['41% of beta families chose the paid plan in week one.', 'Dev'],
    ])
    expect(earlierAnswers(q).map((v) => v.text)).toEqual(['They already pay for screen time they trust.'])

    // The same wording again adds an ask to the same question rather than a second question.
    const again = await s.as.mutation(api.qanda.create, { text: 'Why will parents pay when free apps exist', investorId: s.orchard })
    expect(again).toEqual({ id, existed: true })
    expect((await s.bank()).questions).toHaveLength(1)
    expect((await s.find(id))!.askedCount).toBe(2)
  })

  it('needs words, and a deleted question comes back with Undo', async () => {
    const s = await setup()
    await expect(s.as.mutation(api.qanda.create, { text: '   ' })).rejects.toThrow(/Write the question first/)
    const { id } = await s.as.mutation(api.qanda.create, { text: 'Who else is in the round?' })
    await s.as.mutation(api.qanda.remove, { id })
    expect((await s.bank()).questions).toHaveLength(0)
    await expect(s.as.mutation(api.qanda.save, { id, text: 'x', bestAnswer: '', theme: 'Round', slideRef: null })).rejects.toThrow(/merged or deleted/)
    await s.as.mutation(api.qanda.restore, { id })
    expect(await s.find(id)).toMatchObject({ text: 'Who else is in the round?', theme: 'Round' })
  })

  it('a slide takes a question off the deck-gaps list', async () => {
    const s = await setup()
    const { id } = await s.as.mutation(api.qanda.create, { text: 'What does retention look like after week 4?' })
    expect(await s.as.mutation(api.qanda.addToDeck, { id })).toBe(5)
    expect((await s.find(id))!.deckGap).toMatchObject({ deck: 5 })
    await s.as.mutation(api.qanda.save, { id, text: 'What does retention look like after week 4?', bestAnswer: '62% at week 4.', theme: 'Traction', slideRef: 'p6 · Traction' })
    expect((await s.find(id))!.deckGap).toBeUndefined()
    await expect(s.as.mutation(api.qanda.addToDeck, { id })).rejects.toThrow(/already on a slide/)
  })

  it('Add to deck targets the version after the current pitch deck in Materials', async () => {
    const s = await setup()
    await s.t.run(async (ctx) => {
      const deck = await ctx.db.insert('materials', { kind: 'deck', title: 'Pitch deck', createdAt: 1, createdBy: s.dev })
      const version = (n: number) => ctx.db.insert('materialVersions', { materialId: deck, n, url: `https://slides.example.com/v${n}`, note: '', createdAt: n, createdBy: s.dev })
      await version(5)
      await ctx.db.patch(deck, { currentVersionId: await version(6) })
      const memo = await ctx.db.insert('materials', { kind: 'memo', title: 'Investment memo', createdAt: 2, createdBy: s.dev })
      await ctx.db.patch(memo, { currentVersionId: await ctx.db.insert('materialVersions', { materialId: memo, n: 9, url: 'https://docs.example.com/memo', note: '', createdAt: 3, createdBy: s.dev }) })
    })
    const { id } = await s.as.mutation(api.qanda.create, { text: 'How do you reach parents?' })
    expect(await s.as.mutation(api.qanda.addToDeck, { id })).toBe(7)
    expect((await s.find(id))!.deckGap).toMatchObject({ deck: 7 })
  })
})

describe('merging the same question', () => {
  it('keeps every ask from both, and Undo splits them back', async () => {
    const s = await setup()
    const keep = (await s.as.mutation(api.qanda.create, { text: 'What stops the AI saying something wrong?', investorId: s.orchard, date: addDays(s.today, -9) })).id
    await s.as.mutation(api.qanda.link, { questionId: keep, investorId: s.kite, date: addDays(s.today, -6) })
    await s.as.mutation(api.qanda.save, { id: keep, text: 'What stops the AI saying something wrong?', bestAnswer: 'Every story passes two filters.', theme: 'Product', slideRef: null })
    const drop = (await s.as.mutation(api.qanda.create, { text: 'How do you keep the stories safe for a 4-year-old?', investorId: s.kite, date: addDays(s.today, -1) })).id
    await s.as.mutation(api.qanda.save, { id: drop, text: 'How do you keep the stories safe for a 4-year-old?', bestAnswer: '', theme: 'Product', slideRef: 'p7 · Safety' })

    expect(await s.as.mutation(api.qanda.merge, { dropId: drop, keepId: keep })).toEqual({ keepId: keep, asked: 3 })
    const after = await s.bank()
    expect(after.questions.map((q) => q._id)).toEqual([keep])
    const kept = after.questions[0]
    expect(kept.askedCount).toBe(3)
    expect(kept.asks.map((a) => [a.investorId, a.date]).sort()).toEqual(
      [[s.orchard, addDays(s.today, -9)], [s.kite, addDays(s.today, -6)], [s.kite, addDays(s.today, -1)]].sort(),
    )
    // Its own answer stays; the slide it lacked comes from the merged one.
    expect(kept).toMatchObject({ bestAnswer: 'Every story passes two filters.', slideRef: 'p7 · Safety', onDeck: true })
    await expect(s.as.mutation(api.qanda.merge, { dropId: drop, keepId: keep })).rejects.toThrow(/merged or deleted/)

    expect(await s.as.mutation(api.qanda.unmerge, { id: drop })).toBe(true)
    const back = await s.bank()
    expect(back.questions).toHaveLength(2)
    expect(await s.find(keep)).toMatchObject({ askedCount: 2, bestAnswer: 'Every story passes two filters.', onDeck: false })
    expect((await s.find(keep))!.slideRef).toBeUndefined()
    expect(await s.find(drop)).toMatchObject({ askedCount: 1, slideRef: 'p7 · Safety', asks: [{ investorId: s.kite, date: addDays(s.today, -1) }] })
    expect(await s.as.mutation(api.qanda.unmerge, { id: drop })).toBe(false)
  })

  it('refuses to merge a question into itself', async () => {
    const s = await setup()
    const { id } = await s.as.mutation(api.qanda.create, { text: 'Who else is in the round?' })
    await expect(s.as.mutation(api.qanda.merge, { dropId: id, keepId: id })).rejects.toThrow(/same question/)
  })
})

describe('meeting notes', () => {
  const NOTES = ['1st meeting with Kite', '- Loved the founding-families story', 'Q: How do you keep the stories safe for a 4-year-old?', '', '  who else is in the round?'].join('\n')

  it('marking a note line as a question links the investor and the note’s date', async () => {
    const s = await setup()
    const noteDate = addDays(s.today, -2)
    const noteId = await s.as.mutation(api.qanda.addNote, { investorId: s.kite, text: NOTES, date: noteDate, title: '1st meeting' })
    expect(await s.as.query(api.qanda.notesFor, { investorId: s.kite })).toMatchObject([{ _id: noteId, date: noteDate, title: '1st meeting', by: 'Dev' }])

    const r = await s.as.mutation(api.qanda.markLine, { noteId, line: 2 })
    expect(r.created).toBe(true)
    expect(await s.find(r.questionId)).toMatchObject({
      text: 'How do you keep the stories safe for a 4-year-old?', theme: 'Product', bestAnswer: '', askedCount: 1,
      asks: [{ investorId: s.kite, date: noteDate, source: 'notes', noteId, noteLine: 2, quote: 'Q: How do you keep the stories safe for a 4-year-old?', label: '1st meeting' }],
    })
    // Picking the same line twice changes nothing.
    expect(await s.as.mutation(api.qanda.markLine, { noteId, line: 2 })).toEqual({ ...r, created: false })
    expect((await s.find(r.questionId))!.askedCount).toBe(1)

    // A line with the wording of a question already in the bank adds Orchard's ask to it.
    const round = (await s.as.mutation(api.qanda.create, { text: 'Who else is in the round?' })).id
    const orchardNote = await s.as.mutation(api.qanda.addNote, { investorId: s.orchard, text: 'Who else is in the round?', date: addDays(s.today, -1) })
    expect(await s.as.mutation(api.qanda.markLine, { noteId: orchardNote, line: 0 })).toMatchObject({ questionId: round, created: false })
    expect(await s.find(round)).toMatchObject({ askedCount: 1, asks: [{ investorId: s.orchard, date: addDays(s.today, -1) }] })

    await expect(s.as.mutation(api.qanda.markLine, { noteId, line: 3 })).rejects.toThrow(/no longer in the note/)
  })

  it('un-picking a line takes a question only that line asked out of the bank', async () => {
    const s = await setup()
    const noteId = await s.as.mutation(api.qanda.addNote, { investorId: s.kite, text: NOTES })
    const { questionId } = await s.as.mutation(api.qanda.markLine, { noteId, line: 4 })
    expect(await s.find(questionId)).toMatchObject({ text: 'Who else is in the round?' })
    expect(await s.as.mutation(api.qanda.unmarkLine, { noteId, line: 4 })).toBe(1)
    expect((await s.bank()).questions).toHaveLength(0)
    // A deleted note can come back, and the facts row stops counting it meanwhile.
    await s.as.mutation(api.qanda.removeNote, { id: noteId })
    expect((await s.bank()).noteCount).toBe(0)
    await s.as.mutation(api.qanda.restoreNote, { id: noteId })
    expect((await s.bank()).noteCount).toBe(1)
  })
})

describe('the facts row', () => {
  it('counts questions, notes, the ones needing an answer and the ones on a slide', async () => {
    const s = await setup()
    const add = async (text: string, bestAnswer = '', slideRef: string | null = null) => {
      const { id } = await s.as.mutation(api.qanda.create, { text, investorId: s.kite })
      if (bestAnswer || slideRef) await s.as.mutation(api.qanda.save, { id, text, bestAnswer, theme: 'Traction', slideRef })
      return id
    }
    await add('What does retention look like after week 4?', '62% at week 4.')
    await add('Why will parents pay?', 'They pay for trust.', 'p8 · Pricing')
    await add('How do you reach the first 10,000 families?', 'Referrals.', 'p9 · Go to market')
    await add('Who else is in the round?')
    const merged = await add('Who else is in this round?')
    const removed = await add('Would you take a lead with a board seat?')
    await s.as.mutation(api.qanda.merge, { dropId: merged, keepId: (await s.bank()).questions.find((q) => q.text === 'Who else is in the round?')!._id })
    await s.as.mutation(api.qanda.remove, { id: removed })
    await s.as.mutation(api.qanda.addNote, { investorId: s.kite, text: 'Notes one' })
    await s.as.mutation(api.qanda.addNote, { investorId: s.orchard, text: 'Notes two' })

    const b = await s.bank()
    expect(facts(b.questions, b.noteCount)).toEqual({ questions: 4, fromMeetings: 2, needAnswer: 1, onSlide: 2 })
  })
})
