// PST-281: the Q&A bank (screens/raise-qanda/*.png), meeting notes per investor
// (drawer/notes.png) and what the prep brief reads (raise-today/prep-brief.png).
// The rules (cleaning a note line into a question, themes, counts, which
// questions a brief shows) live in src/lib/qanda.ts. Removing and merging keep
// the row (removedAt, mergedInto) so Undo can put it back; lists leave them out.
//
//
// PST-277: Claude reads saved notes (convex/noteReads.ts) and proposes the
// questions they asked, matched against the bank; applying them goes through
// `addNoteQuestions` here. "Draft from past answers" is noteReads.draftAnswer:
// a draft is never saved on its own, it goes through `save` like a typed one.
import { ConvexError, v, type Infer } from 'convex/values'
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { firstName, requireUser } from './lib/access'
import { vAskSource, type vSuggestionUndo } from './validators'
import { startRead } from './lib/noteRead'
import { checkRepeatLater } from './lib/jevHooks'
import { noteSignalLater } from './lib/signalHooks' // PST-293
import { isISODate, todayIST } from '../src/lib/dates'
import { cleanQuestion, cleanTheme, guessTheme, LIMITS, needsAnswer, nextDeck, noteLines, sameText } from '../src/lib/qanda'

type Q = Doc<'questions'>
const isLive = (q: Q | null): q is Q => !!q && !q.removedAt && !q.mergedInto

async function liveQuestion(ctx: QueryCtx, id: Id<'questions'>) {
  const q = await ctx.db.get(id)
  if (!isLive(q)) throw new ConvexError('That question was merged or deleted.')
  return q
}

const asksOf = (ctx: QueryCtx, questionId: Id<'questions'>) =>
  ctx.db
    .query('questionAsks')
    .withIndex('by_question', (q) => q.eq('questionId', questionId))
    .collect()

/** Keep askedCount in step with the asks. */
async function recount(ctx: MutationCtx, id: Id<'questions'>) {
  const n = (await asksOf(ctx, id)).length
  await ctx.db.patch(id, { askedCount: n, updatedAt: Date.now() })
  return n
}

const dayOr = (d: string | undefined) => (d && isISODate(d) ? d : todayIST())

function required(s: string, max: number, what: string) {
  const t = s.trim()
  if (!t) throw new ConvexError(`Write the ${what} first.`)
  return t.slice(0, max)
}

/** PST-307: the Advisor's Save uses these too. */
export async function sameQuestion(ctx: QueryCtx, text: string) {
  return (await ctx.db.query('questions').collect()).find((q) => isLive(q) && sameText(q.text, text)) ?? null
}

export async function newQuestion(ctx: MutationCtx, text: string, theme?: string) {
  const now = Date.now()
  return await ctx.db.insert('questions', {
    text, theme: cleanTheme(theme ?? '') || guessTheme(text), bestAnswer: '', answerVersions: [], onDeck: false, askedCount: 0, createdAt: now, updatedAt: now,
  })
}

/* ---------- reads ---------- */

/**
 * The bank: every live question with its asks (about investors that still
 * exist), the note line each came from, and how many notes there are.
 */
export const bank = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx)
    const investors = new Set<string>((await ctx.db.query('investors').collect()).map((i) => i._id))
    const notes = await ctx.db.query('notes').collect()
    const noteById = new Map(notes.map((n) => [n._id, n]))
    const asks = new Map<string, Doc<'questionAsks'>[]>()
    for (const a of await ctx.db.query('questionAsks').collect()) if (investors.has(a.investorId)) asks.set(a.questionId, [...(asks.get(a.questionId) ?? []), a])
    const names = new Map<string, string>()
    const nameOf = async (id: Id<'users'> | undefined) => {
      if (!id) return undefined
      if (!names.has(id)) names.set(id, firstName(await ctx.db.get(id)))
      return names.get(id)
    }
    const questions = []
    const all = await ctx.db.query('questions').collect()
    const live = new Map(all.filter(isLive).map((q) => [q._id as string, q]))
    for (const q of all) {
      if (!isLive(q)) continue
      const mine = asks.get(q._id) ?? []
      // PST-292: Jev marked it "Same as …" another live question (Dev hasn't said no).
      const mark = await ctx.db.query('jevMarks').withIndex('by_subject', (x) => x.eq('kind', 'same_question').eq('subject', q._id)).order('desc').first()
      const same = mark && !mark.undoneAt && mark.target ? live.get(mark.target) : undefined
      const versions = []
      for (const x of q.answerVersions) versions.push({ text: x.text, at: x.at, by: await nameOf(x.by) })
      questions.push({
        _id: q._id, text: q.text, theme: q.theme, bestAnswer: q.bestAnswer, answerVersions: versions, slideRef: q.slideRef, onDeck: q.onDeck,
        askedCount: mine.length, deckGap: q.deckGap, createdAt: q.createdAt, updatedAt: q.updatedAt, ...(same ? { sameAs: { id: same._id, text: same.text } } : {}),
        asks: mine.map((a) => {
          const n = a.noteId ? noteById.get(a.noteId) : undefined
          const quote = n && a.noteLine !== undefined ? n.text.split(/\r?\n/)[a.noteLine]?.trim() : undefined
          return { _id: a._id, investorId: a.investorId, date: a.date, source: a.source, noteId: a.noteId, noteLine: a.noteLine, quote, label: n?.title }
        }),
      })
    }
    return { questions, noteCount: notes.filter((n) => !n.removedAt && investors.has(n.investorId)).length }
  },
})

/** One investor's meeting notes, newest first (the drawer's Notes tab). */
export const notesFor = query({
  args: { investorId: v.id('investors') },
  handler: async (ctx, { investorId }) => {
    await requireUser(ctx)
    const rows = (
      await ctx.db
        .query('notes')
        .withIndex('by_investor', (q) => q.eq('investorId', investorId))
        .collect()
    ).filter((n) => !n.removedAt)
    rows.sort((a, b) => b.date.localeCompare(a.date) || b._creationTime - a._creationTime)
    const out = []
    for (const n of rows)
      out.push({
        _id: n._id, investorId: n.investorId, meetingId: n.meetingId, date: n.date, text: n.text, title: n.title, source: n.source,
        by: n.createdBy ? firstName(await ctx.db.get(n.createdBy)) : n.source === 'wispr' ? 'Wispr Flow' : 'an agent', _creationTime: n._creationTime,
      })
    return out
  },
})

/* ---------- questions ---------- */

/**
 * "Add a question". The same wording as a question already in the bank adds to
 * that one instead (`existed`). With an investor, it counts as their ask.
 */
export const create = mutation({
  args: { text: v.string(), theme: v.optional(v.string()), investorId: v.optional(v.id('investors')), date: v.optional(v.string()) },
  handler: async (ctx, a) => {
    await requireUser(ctx)
    const text = cleanQuestion(required(a.text, LIMITS.question, 'question'))
    if (a.investorId && !(await ctx.db.get(a.investorId))) throw new ConvexError('That investor was deleted.')
    const same = await sameQuestion(ctx, text)
    const id = same?._id ?? (await newQuestion(ctx, text, a.theme))
    if (a.investorId) {
      await ctx.db.insert('questionAsks', { questionId: id, investorId: a.investorId, date: dayOr(a.date), source: 'manual' })
      await recount(ctx, id)
    }
    return { id, existed: !!same }
  },
})

/**
 * Save the Answer panel: wording, best answer, theme and slide. A changed
 * answer is kept as a new version (the earlier ones stay). A slide takes the
 * question off the deck-gaps list.
 */
export const save = mutation({
  args: { id: v.id('questions'), text: v.string(), bestAnswer: v.string(), theme: v.string(), slideRef: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    const q = await liveQuestion(ctx, a.id)
    const now = Date.now()
    const best = a.bestAnswer.trim().slice(0, LIMITS.answer)
    const slide = a.slideRef?.trim().slice(0, LIMITS.slide) || undefined
    const changed = best !== q.bestAnswer.trim()
    await ctx.db.patch(q._id, {
      text: cleanQuestion(required(a.text, LIMITS.question, 'question')),
      theme: cleanTheme(a.theme) || q.theme,
      bestAnswer: best,
      answerVersions: changed && best ? [...q.answerVersions, { text: best, at: now, by: userId }] : q.answerVersions,
      slideRef: slide,
      onDeck: !!slide,
      deckGap: slide ? undefined : q.deckGap,
      updatedAt: now,
    })
    return { changed }
  },
})

/** Link an investor who asked (or put back an ask that Undo restores). */
export const link = mutation({
  args: {
    questionId: v.id('questions'), investorId: v.id('investors'), date: v.string(), source: v.optional(vAskSource),
    noteId: v.optional(v.id('notes')), noteLine: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    await requireUser(ctx)
    await liveQuestion(ctx, a.questionId)
    if (!(await ctx.db.get(a.investorId))) throw new ConvexError('That investor was deleted.')
    const date = dayOr(a.date)
    const dup = (await asksOf(ctx, a.questionId)).find((x) => x.investorId === a.investorId && x.date === date && x.noteId === a.noteId && x.noteLine === a.noteLine)
    if (dup) return dup._id
    const id = await ctx.db.insert('questionAsks', { questionId: a.questionId, investorId: a.investorId, date, source: a.source ?? 'manual', noteId: a.noteId, noteLine: a.noteLine })
    await recount(ctx, a.questionId)
    return id
  },
})

/** Unlink one ask. Returns what `link` needs to put it back (Undo). */
export const unlink = mutation({
  args: { askId: v.id('questionAsks') },
  handler: async (ctx, { askId }) => {
    await requireUser(ctx)
    const a = await ctx.db.get(askId)
    if (!a) return null
    await ctx.db.delete(askId)
    await recount(ctx, a.questionId)
    return { questionId: a.questionId, investorId: a.investorId, date: a.date, source: a.source, noteId: a.noteId, noteLine: a.noteLine }
  },
})

/**
 * "Same question": merge `dropId` into `keepId`. Every ask moves over, so
 * nobody who asked is lost; the kept question takes the other's answer, slide
 * and earlier answers where it has none. `unmerge` undoes it exactly.
 */
export const merge = mutation({
  args: { dropId: v.id('questions'), keepId: v.id('questions') },
  handler: async (ctx, { dropId, keepId }) => {
    await requireUser(ctx)
    if (dropId === keepId) throw new ConvexError('That’s the same question.')
    const drop = await liveQuestion(ctx, dropId)
    const keep = await liveQuestion(ctx, keepId)
    const asks = await asksOf(ctx, dropId)
    for (const a of asks) await ctx.db.patch(a._id, { questionId: keepId })
    const keepBefore = { bestAnswer: keep.bestAnswer, answerVersions: keep.answerVersions, slideRef: keep.slideRef, onDeck: keep.onDeck }
    await ctx.db.patch(keepId, {
      bestAnswer: needsAnswer(keep) ? drop.bestAnswer : keep.bestAnswer,
      answerVersions: [...keep.answerVersions, ...drop.answerVersions].sort((a, b) => a.at - b.at),
      slideRef: keep.slideRef ?? drop.slideRef,
      onDeck: keep.onDeck || drop.onDeck,
    })
    const asked = await recount(ctx, keepId)
    await ctx.db.patch(dropId, { mergedInto: keepId, merge: { askIds: asks.map((a) => a._id), keepBefore }, updatedAt: Date.now() })
    return { keepId, asked }
  },
})

/** Undo a merge: the asks go back, the kept question gets its own answer and slide back. */
export const unmerge = mutation({
  args: { id: v.id('questions') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const drop = await ctx.db.get(id)
    if (!drop?.mergedInto || !drop.merge) return false
    const keepId = drop.mergedInto
    for (const askId of drop.merge.askIds) {
      const a = await ctx.db.get(askId)
      if (a && a.questionId === keepId) await ctx.db.patch(askId, { questionId: id })
    }
    if (await ctx.db.get(keepId)) {
      await ctx.db.patch(keepId, { ...drop.merge.keepBefore, slideRef: drop.merge.keepBefore.slideRef })
      await recount(ctx, keepId)
    }
    await ctx.db.patch(id, { mergedInto: undefined, merge: undefined })
    await recount(ctx, id)
    return true
  },
})

/** Delete a question (Undo: `restore`). */
export const remove = mutation({
  args: { id: v.id('questions') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    await liveQuestion(ctx, id)
    await ctx.db.patch(id, { removedAt: Date.now() })
    return id
  },
})

export const restore = mutation({
  args: { id: v.id('questions') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const q = await ctx.db.get(id)
    if (q?.removedAt) await ctx.db.patch(id, { removedAt: undefined })
    return id
  },
})

/** "Add to deck vN": onto the deck-gaps list for the version after the current pitch deck in Materials. */
export const addToDeck = mutation({
  args: { id: v.id('questions') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const q = await liveQuestion(ctx, id)
    if (q.onDeck) throw new ConvexError('It’s already on a slide.')
    const materials = await ctx.db.query('materials').collect()
    const versions = []
    for (const m of materials) if (m.kind === 'deck' && m.currentVersionId) versions.push(await ctx.db.get(m.currentVersionId))
    const deck = nextDeck(materials, versions.filter((x) => x !== null))
    await ctx.db.patch(id, { deckGap: { deck, at: Date.now() } })
    return deck
  },
})

/** Off the deck-gaps list (Undo: `addToDeck`). */
export const removeFromDeck = mutation({
  args: { id: v.id('questions') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const q = await ctx.db.get(id)
    if (q?.deckGap) await ctx.db.patch(id, { deckGap: undefined })
    return id
  },
})

/* ---------- notes ---------- */

/** "Paste notes": one meeting's notes for an investor. Nest reads them when that's on in Settings (PST-277). */
export const addNote = mutation({
  args: { investorId: v.id('investors'), text: v.string(), date: v.optional(v.string()), title: v.optional(v.string()), meetingId: v.optional(v.id('meetings')) },
  handler: async (ctx, a) => {
    const { userId } = await requireUser(ctx)
    if (!(await ctx.db.get(a.investorId))) throw new ConvexError('That investor was deleted.')
    const text = required(a.text, LIMITS.note, 'notes')
    const title = a.title?.replace(/\s+/g, ' ').trim().slice(0, LIMITS.title) || undefined
    const id = await ctx.db.insert('notes', { investorId: a.investorId, meetingId: a.meetingId, date: dayOr(a.date), text, title, createdBy: userId, source: 'paste' })
    await startRead(ctx, id, { auto: true })
    await noteSignalLater(ctx, id) // PST-293
    return id
  },
})

/** Delete a note (Undo: `restoreNote`). Questions picked from it stay in the bank. */
export const removeNote = mutation({
  args: { id: v.id('notes') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const n = await ctx.db.get(id)
    if (n && !n.removedAt) await ctx.db.patch(id, { removedAt: Date.now() })
    return id
  },
})

export const restoreNote = mutation({
  args: { id: v.id('notes') },
  handler: async (ctx, { id }) => {
    await requireUser(ctx)
    const n = await ctx.db.get(id)
    if (n?.removedAt) await ctx.db.patch(id, { removedAt: undefined })
    return id
  },
})

/**
 * Pick a note line as a question: it goes into the bank (or onto the question
 * with the same wording) as an ask by the note's investor, on the note's date.
 */
export const markLine = mutation({
  args: { noteId: v.id('notes'), line: v.number() },
  handler: async (ctx, { noteId, line }) => {
    await requireUser(ctx)
    const note = await ctx.db.get(noteId)
    if (!note || note.removedAt) throw new ConvexError('That note was deleted.')
    const picked = noteLines(note.text).find((l) => l.line === line)
    const text = picked ? cleanQuestion(picked.text) : ''
    if (!text) throw new ConvexError('That line is no longer in the note.')
    const onLine = (
      await ctx.db
        .query('questionAsks')
        .withIndex('by_note', (q) => q.eq('noteId', noteId))
        .collect()
    ).filter((a) => a.noteLine === line)
    for (const a of onLine) {
      if (isLive(await ctx.db.get(a.questionId))) return { questionId: a.questionId, askId: a._id, created: false }
      await ctx.db.delete(a._id)
    }
    const same = await sameQuestion(ctx, text)
    const questionId = same?._id ?? (await newQuestion(ctx, text))
    const askId = await ctx.db.insert('questionAsks', { questionId, investorId: note.investorId, date: note.date, source: 'notes', noteId, noteLine: line })
    await recount(ctx, questionId)
    // PST-292: a new question from notes: does it repeat one in the bank?
    if (!same) await checkRepeatLater(ctx, questionId)
    return { questionId, askId, created: !same }
  },
})

/**
 * Un-pick a note line. A question that only that line asked, and that has no
 * answer yet, leaves the bank with it. Undo: `markLine` again.
 */
export const unmarkLine = mutation({
  args: { noteId: v.id('notes'), line: v.number() },
  handler: async (ctx, { noteId, line }) => {
    await requireUser(ctx)
    const rows = (
      await ctx.db
        .query('questionAsks')
        .withIndex('by_note', (q) => q.eq('noteId', noteId))
        .collect()
    ).filter((a) => a.noteLine === line)
    for (const a of rows) {
      await ctx.db.delete(a._id)
      const left = await recount(ctx, a.questionId)
      const q = await ctx.db.get(a.questionId)
      if (!left && isLive(q) && needsAnswer(q)) await ctx.db.patch(q._id, { removedAt: Date.now() })
    }
    return rows.length
  },
})

/* ---------- PST-277: questions from a note Claude read ---------- */

type QuestionsUndo = Extract<Infer<typeof vSuggestionUndo>, { op: 'questions' }>
type NoteQuestionInput = { text: string; questionId?: Id<'questions'>; answer?: string; quote: string }

/** The note line a quote came from, so the Notes tab shows it as picked. */
function lineOf(text: string, quote: string): number | undefined {
  const q = quote.toLowerCase().replace(/\s+/g, ' ').replace(/^["“'\s]+|["”'.,\s]+$/g, '')
  return noteLines(text).find((l) => l.text.toLowerCase().replace(/\s+/g, ' ').includes(q))?.line
}

/**
 * Apply "Q&A" from a note: each question onto the one already in the bank (by
 * id, or the same words) or in as a new one, asked by the note's investor on
 * its date, from its line. Dev's answer from the call fills in a question that
 * has none yet; an answer already in the bank stays. Returns what Undo needs.
 */
export async function addNoteQuestions(ctx: MutationCtx, userId: Id<'users'>, noteId: Id<'notes'>, items: NoteQuestionInput[]): Promise<QuestionsUndo | null> {
  const note = await ctx.db.get(noteId)
  if (!note || note.removedAt || !(await ctx.db.get(note.investorId))) return null
  const undo: QuestionsUndo = { op: 'questions', askIds: [], created: [], answered: [] }
  for (const it of items) {
    const text = cleanQuestion(it.text)
    if (!text) continue
    const byId = it.questionId ? await ctx.db.get(it.questionId) : null
    let q = isLive(byId) ? byId : await sameQuestion(ctx, text)
    if (!q) {
      const id = await newQuestion(ctx, text)
      undo.created.push(id)
      q = (await ctx.db.get(id))!
      // PST-292: does it repeat one in the bank?
      await checkRepeatLater(ctx, id)
    }
    const noteLine = lineOf(note.text, it.quote)
    const asks = await asksOf(ctx, q._id)
    if (!asks.some((a) => a.investorId === note.investorId && a.noteId === noteId)) {
      undo.askIds.push(await ctx.db.insert('questionAsks', { questionId: q._id, investorId: note.investorId, date: note.date, source: 'notes', noteId, ...(noteLine !== undefined ? { noteLine } : {}) }))
      await recount(ctx, q._id)
    }
    const answer = it.answer?.trim().slice(0, LIMITS.answer)
    if (answer && needsAnswer(q)) {
      undo.answered.push({ id: q._id, bestAnswer: q.bestAnswer, answerVersions: q.answerVersions })
      await ctx.db.patch(q._id, { bestAnswer: answer, answerVersions: [...q.answerVersions, { text: answer, at: Date.now(), by: userId }], updatedAt: Date.now() })
    }
  }
  return undo
}

/** Undo `addNoteQuestions`: the asks go, answers go back, and a question it created leaves the bank once nobody else asked it. */
export async function removeNoteQuestions(ctx: MutationCtx, u: QuestionsUndo) {
  const touched = new Set<Id<'questions'>>()
  for (const id of u.askIds) {
    const a = await ctx.db.get(id)
    if (!a) continue
    await ctx.db.delete(id)
    touched.add(a.questionId)
  }
  for (const id of touched) await recount(ctx, id)
  for (const x of u.answered) if (await ctx.db.get(x.id)) await ctx.db.patch(x.id, { bestAnswer: x.bestAnswer, answerVersions: x.answerVersions })
  for (const id of u.created) {
    const q = await ctx.db.get(id)
    if (isLive(q) && !q.askedCount) await ctx.db.patch(id, { removedAt: Date.now() })
  }
}
