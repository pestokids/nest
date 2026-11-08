// PST-298: the Q&A bank's and the Notes tab's writes show at once (Convex
// optimistic updates), the way convex/qanda.ts and convex/noteReads.ts make
// them. Undo of a delete puts back the row the delete took out (take/given).
import type { OptimisticLocalStore } from 'convex/browser'
import type { FunctionArgs } from 'convex/server'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { todayIST } from '../../lib/dates'
import { cleanQuestion, cleanTheme, guessTheme, LIMITS, needsAnswer, nextDeck, noteLines, sameText } from '../../lib/qanda'
import { given, take } from '../optimistic'

type Store = OptimisticLocalStore
type Bank = NonNullable<ReturnType<typeof bankOf>>
type Q = Bank['questions'][number]
type Ask = Q['asks'][number]

const bankOf = (store: Store) => store.getQuery(api.qanda.bank, {})
const tempId = <T>() => `optimistic-${crypto.randomUUID()}` as T
const withAsks = (q: Q, asks: Ask[]): Q => ({ ...q, asks, askedCount: asks.length })

/** Every question through `fn` (null drops it). */
function eachQuestion(store: Store, fn: (q: Q) => Q | null, extra: Q[] = []) {
  const b = bankOf(store)
  if (b) store.setQuery(api.qanda.bank, {}, { ...b, questions: [...b.questions.flatMap((q) => fn(q) ?? []), ...extra] })
}

/** The Answer panel saved: wording, best answer (a changed one becomes a version), theme and slide. */
export function showQuestionSave(store: Store, a: FunctionArgs<typeof api.qanda.save>, by: string) {
  const text = cleanQuestion(a.text.trim().slice(0, LIMITS.question))
  if (!text) return
  eachQuestion(store, (q) => {
    if (q._id !== a.id) return q
    const best = a.bestAnswer.trim().slice(0, LIMITS.answer)
    const slide = a.slideRef?.trim().slice(0, LIMITS.slide) || undefined
    const changed = best !== q.bestAnswer.trim()
    return {
      ...q, text, theme: cleanTheme(a.theme) || q.theme, bestAnswer: best, slideRef: slide, onDeck: !!slide, deckGap: slide ? undefined : q.deckGap, updatedAt: Date.now(),
      answerVersions: changed && best ? [...q.answerVersions, { text: best, at: Date.now(), by }] : q.answerVersions,
    }
  })
}

/** An investor linked as asking it (or the Undo of an unlink). */
export function showLink(store: Store, a: FunctionArgs<typeof api.qanda.link>, today = todayIST()) {
  const ask = { _id: tempId<Id<'questionAsks'>>(), investorId: a.investorId, date: a.date || today, source: a.source ?? ('manual' as const), noteId: a.noteId, noteLine: a.noteLine, quote: undefined, label: undefined }
  eachQuestion(store, (q) => (q._id === a.questionId ? withAsks(q, [...q.asks, ask]) : q))
}

/** One ask unlinked. */
export function hideAsk(store: Store, askId: Id<'questionAsks'>) {
  eachQuestion(store, (q) => (q.asks.some((x) => x._id === askId) ? withAsks(q, q.asks.filter((x) => x._id !== askId)) : q))
}

/** "Same question": every ask moves to the kept one, which takes the other's answer and slide where it has none. */
export function showMerge(store: Store, a: { dropId: Id<'questions'>; keepId: Id<'questions'> }) {
  const b = bankOf(store)
  const drop = b?.questions.find((q) => q._id === a.dropId)
  const keep = b?.questions.find((q) => q._id === a.keepId)
  if (!drop || !keep || drop === keep) return
  take(a.dropId, { drop, keep })
  eachQuestion(store, (q) =>
    q === drop
      ? null
      : q === keep
        ? {
            ...withAsks(keep, [...keep.asks, ...drop.asks]),
            bestAnswer: needsAnswer(keep) ? drop.bestAnswer : keep.bestAnswer,
            answerVersions: [...keep.answerVersions, ...drop.answerVersions].sort((x, y) => x.at - y.at),
            slideRef: keep.slideRef ?? drop.slideRef,
            onDeck: keep.onDeck || drop.onDeck,
          }
        : q,
  )
}

/** Its Undo: the asks go back, and the kept question gets its own answer and slide back. */
export function showUnmerge(store: Store, id: Id<'questions'>) {
  const m = given<{ drop: Q; keep: Q }>(id)
  const b = bankOf(store)
  if (!m || !b || b.questions.some((q) => q._id === id)) return
  const moved = new Set(m.drop.asks.map((x) => x._id as string))
  const { bestAnswer, answerVersions, slideRef, onDeck } = m.keep
  eachQuestion(store, (q) => (q._id === m.keep._id ? { ...withAsks(q, q.asks.filter((x) => !moved.has(x._id))), bestAnswer, answerVersions, slideRef, onDeck } : q), [m.drop])
}

/** A question deleted. */
export function hideQuestion(store: Store, id: Id<'questions'>) {
  eachQuestion(store, (q) => {
    if (q._id !== id) return q
    take(id, q)
    return null
  })
}

/** Its Undo. */
export function showQuestionBack(store: Store, id: Id<'questions'>) {
  const q = given<Q>(id)
  if (q && !bankOf(store)?.questions.some((x) => x._id === id)) eachQuestion(store, (x) => x, [q])
}

/** Onto the deck-gaps list for the deck after the current one in Materials, or off it. */
export function showDeck(store: Store, id: Id<'questions'>, on: boolean) {
  const m = store.getQuery(api.materials.data, {})
  const deckGap = on ? { deck: nextDeck(m?.materials ?? [], m?.versions ?? []), at: Date.now() } : undefined
  eachQuestion(store, (q) => (q._id === id && (on ? !q.onDeck && !q.deckGap : !!q.deckGap) ? { ...q, deckGap } : q))
}

/** "Not the same" on Jev's "Same as …", and its Undo. */
export function showSame(store: Store, id: Id<'questions'>, same: boolean) {
  eachQuestion(store, (q) => {
    if (q._id !== id) return q
    if (!same) {
      take('same:' + id, q.sameAs)
      return { ...q, sameAs: undefined }
    }
    const sameAs = q.sameAs ?? given<Q['sameAs']>('same:' + id)
    return sameAs ? { ...q, sameAs } : q
  })
}

type Notes = NonNullable<ReturnType<typeof notesOf>[number]['value']>
const notesOf = (store: Store) => store.getAllQueries(api.qanda.notesFor)
const byDate = (xs: Notes) => [...xs].sort((a, b) => b.date.localeCompare(a.date) || (b._creationTime ?? 0) - (a._creationTime ?? 0))

/** Notes pasted for an investor. */
export function showNote(store: Store, a: FunctionArgs<typeof api.qanda.addNote>, by: string, today = todayIST()) {
  const text = a.text.trim()
  const notes = store.getQuery(api.qanda.notesFor, { investorId: a.investorId })
  if (!text || !notes) return
  const title = a.title?.replace(/\s+/g, ' ').trim().slice(0, LIMITS.title) || undefined
  const row = { _id: tempId<Id<'notes'>>(), investorId: a.investorId, meetingId: a.meetingId, date: a.date || today, text, title, source: 'paste' as const, by, _creationTime: Date.now() }
  store.setQuery(api.qanda.notesFor, { investorId: a.investorId }, byDate([row, ...notes]))
  const b = bankOf(store)
  if (b) store.setQuery(api.qanda.bank, {}, { ...b, noteCount: b.noteCount + 1 })
}

/** Notes deleted (their questions stay in the bank), and the Undo. */
export function showNoteGone(store: Store, id: Id<'notes'>, gone: boolean) {
  const back = gone ? undefined : given<Notes[number]>(id)
  let changed = false
  for (const q of notesOf(store)) {
    const n = q.value?.find((x) => x._id === id)
    if (!q.value || (gone ? !n : !back || n || back.investorId !== q.args.investorId)) continue
    if (n) take(id, n)
    store.setQuery(api.qanda.notesFor, q.args, n ? q.value.filter((x) => x !== n) : byDate([...q.value, back!]))
    changed = true
  }
  const b = bankOf(store)
  if (changed && b) store.setQuery(api.qanda.bank, {}, { ...b, noteCount: Math.max(0, b.noteCount + (gone ? -1 : 1)) })
}

/** A note line picked as a question: onto the question with the same words, or in as a new one. */
export function showMark(store: Store, a: { noteId: Id<'notes'>; line: number }, now = Date.now()) {
  const b = bankOf(store)
  const note = notesOf(store).flatMap((q) => q.value ?? []).find((n) => n._id === a.noteId)
  const text = cleanQuestion(noteLines(note?.text ?? '').find((l) => l.line === a.line)?.text ?? '')
  if (!b || !note || !text || b.questions.some((q) => q.asks.some((x) => x.noteId === a.noteId && x.noteLine === a.line))) return
  const ask = { _id: tempId<Id<'questionAsks'>>(), investorId: note.investorId, date: note.date, source: 'notes' as const, noteId: a.noteId, noteLine: a.line, quote: text, label: note.title }
  const same = b.questions.find((q) => sameText(q.text, text))
  if (same) return eachQuestion(store, (q) => (q === same ? withAsks(q, [...q.asks, ask]) : q))
  const q: Q = { _id: tempId<Id<'questions'>>(), text, theme: guessTheme(text), bestAnswer: '', answerVersions: [], slideRef: undefined, onDeck: false, deckGap: undefined, askedCount: 1, createdAt: now, updatedAt: now, asks: [ask] }
  eachQuestion(store, (x) => x, [q])
}

/** Un-picked: a question only that line asked, with no answer yet, leaves the bank with it. */
export function hideMark(store: Store, a: { noteId: Id<'notes'>; line: number }) {
  eachQuestion(store, (q) => {
    const asks = q.asks.filter((x) => !(x.noteId === a.noteId && x.noteLine === a.line))
    if (asks.length === q.asks.length) return q
    return asks.length || !needsAnswer(q) ? withAsks(q, asks) : null
  })
}

/** Nest's read of a note applied (the ticked proposals) or dismissed, and the Undo of either. */
export function showRead(store: Store, a: { readId: Id<'noteReads'>; ids?: string[] } | { undo: Id<'noteReads'> }) {
  for (const q of store.getAllQueries(api.noteReads.forInvestor)) {
    if (!q.value) continue
    const reads = q.value.flatMap((r) => {
      if ('undo' in a) return r._id === a.undo ? [given<typeof r>(a.undo) ?? r] : [r]
      if (r._id !== a.readId || r.status !== 'ready') return [r]
      take(r._id, r)
      const ids = a.ids
      const proposals = r.proposals.map((p) => (p.state !== 'open' ? p : { ...p, state: ids?.includes(p.id) ? ('applied' as const) : ('dropped' as const) }))
      return [{ ...r, status: ids ? ('applied' as const) : ('dismissed' as const), proposals }]
    })
    store.setQuery(api.noteReads.forInvestor, q.args, reads)
  }
}

/** "Unmatched notes" on Today: matched to an investor or not about the round, and the Undo. */
export function showUnmatched(store: Store, id: Id<'unmatchedNotes'>, gone: boolean) {
  const list = store.getQuery(api.noteReads.unmatched, {})
  if (!list) return
  const u = gone ? list.find((x) => x._id === id) : given<(typeof list)[number]>(id)
  if (!u || list.includes(u) !== gone) return
  if (gone) take(id, u)
  store.setQuery(api.noteReads.unmatched, {}, gone ? list.filter((x) => x !== u) : [...list, u].sort((x, y) => y.createdAt - x.createdAt))
}
