import { useAction, useMutation, useQuery } from 'convex/react'
import { useMemo, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { Question } from '../../lib/qanda'
import type { NoteRead, UnmatchedNote } from '../../lib/meetingNotes'
import { useSession } from '../session'
import { QandaContext, type QandaActions, type QandaData } from './data'
import { hideAsk, hideMark, hideQuestion, showDeck, showLink, showMark, showMerge, showNote, showNoteGone, showQuestionBack, showQuestionSave, showRead, showSame, showUnmatched, showUnmerge } from './optimistic'

const NONE: Question[] = []
const NO_UNMATCHED: UnmatchedNote[] = []
const useNotes = (investorId: string | null) => useQuery(api.qanda.notesFor, investorId ? { investorId: investorId as Id<'investors'> } : 'skip')
const useReads = (investorId: string | null): NoteRead[] | undefined => useQuery(api.noteReads.forInvestor, investorId ? { investorId: investorId as Id<'investors'> } : 'skip')

type QId = Id<'questions'>
type NId = Id<'notes'>
type RId = Id<'noteReads'>
type UId = Id<'unmatchedNotes'>

/** PST-281: the Q&A bank from Convex, live in every open tab. */
export function ConvexQanda({ children }: { children: ReactNode }) {
  const me = useSession().me.firstName
  const bank = useQuery(api.qanda.bank)
  // PST-298: every write shows at once (./optimistic.ts) but a new question (it opens by its id), a read and a draft (Claude).
  const create = useMutation(api.qanda.create)
  const save = useMutation(api.qanda.save).withOptimisticUpdate((store, a) => showQuestionSave(store, a, me))
  const link = useMutation(api.qanda.link).withOptimisticUpdate((store, a) => showLink(store, a))
  const unlink = useMutation(api.qanda.unlink).withOptimisticUpdate((store, { askId }) => hideAsk(store, askId))
  const merge = useMutation(api.qanda.merge).withOptimisticUpdate((store, a) => showMerge(store, a))
  const unmerge = useMutation(api.qanda.unmerge).withOptimisticUpdate((store, { id }) => showUnmerge(store, id))
  const remove = useMutation(api.qanda.remove).withOptimisticUpdate((store, { id }) => hideQuestion(store, id))
  const restore = useMutation(api.qanda.restore).withOptimisticUpdate((store, { id }) => showQuestionBack(store, id))
  const addToDeck = useMutation(api.qanda.addToDeck).withOptimisticUpdate((store, { id }) => showDeck(store, id, true))
  const removeFromDeck = useMutation(api.qanda.removeFromDeck).withOptimisticUpdate((store, { id }) => showDeck(store, id, false))
  const addNote = useMutation(api.qanda.addNote).withOptimisticUpdate((store, a) => showNote(store, a, me))
  const removeNote = useMutation(api.qanda.removeNote).withOptimisticUpdate((store, { id }) => showNoteGone(store, id, true))
  const restoreNote = useMutation(api.qanda.restoreNote).withOptimisticUpdate((store, { id }) => showNoteGone(store, id, false))
  const markLine = useMutation(api.qanda.markLine).withOptimisticUpdate((store, a) => showMark(store, a))
  const unmarkLine = useMutation(api.qanda.unmarkLine).withOptimisticUpdate((store, a) => hideMark(store, a))
  const unmatched = useQuery(api.noteReads.unmatched)
  const readNote = useMutation(api.noteReads.read)
  const applyRead = useMutation(api.noteReads.apply).withOptimisticUpdate((store, a) => showRead(store, a))
  const dismissRead = useMutation(api.noteReads.dismiss).withOptimisticUpdate((store, { readId }) => showRead(store, { readId }))
  const undoRead = useMutation(api.noteReads.undo).withOptimisticUpdate((store, { readId }) => showRead(store, { undo: readId }))
  const draftAnswer = useAction(api.noteReads.draftAnswer)
  const matchUnmatched = useMutation(api.noteReads.matchUnmatched).withOptimisticUpdate((store, { id }) => showUnmatched(store, id, true))
  const dropUnmatched = useMutation(api.noteReads.dropUnmatched).withOptimisticUpdate((store, { id }) => showUnmatched(store, id, true))
  const restoreUnmatched = useMutation(api.noteReads.restoreUnmatched).withOptimisticUpdate((store, { id }) => showUnmatched(store, id, false))
  const notSame = useMutation(api.jevHousekeeping.notSame).withOptimisticUpdate((store, { questionId }) => showSame(store, questionId, false))
  const restoreSame = useMutation(api.jevHousekeeping.restoreSame).withOptimisticUpdate((store, { questionId }) => showSame(store, questionId, true))
  const act = useMemo<QandaActions>(
    () => ({
      create: (a) => create({ ...a, investorId: a.investorId as Id<'investors'> | undefined }),
      save: (a) => save({ ...a, id: a.id as QId }),
      link: (a) => link({ ...a, questionId: a.questionId as QId, investorId: a.investorId as Id<'investors'>, noteId: a.noteId as NId | undefined }),
      unlink: (askId) => unlink({ askId: askId as Id<'questionAsks'> }),
      merge: (dropId, keepId) => merge({ dropId: dropId as QId, keepId: keepId as QId }),
      unmerge: (id) => unmerge({ id: id as QId }),
      remove: (id) => remove({ id: id as QId }),
      restore: (id) => restore({ id: id as QId }),
      addToDeck: (id) => addToDeck({ id: id as QId }),
      removeFromDeck: (id) => removeFromDeck({ id: id as QId }),
      addNote: (a) => addNote({ ...a, investorId: a.investorId as Id<'investors'>, meetingId: a.meetingId as Id<'meetings'> | undefined }),
      removeNote: (id) => removeNote({ id: id as NId }),
      restoreNote: (id) => restoreNote({ id: id as NId }),
      markLine: (noteId, line) => markLine({ noteId: noteId as NId, line }),
      unmarkLine: (noteId, line) => unmarkLine({ noteId: noteId as NId, line }),
      readNote: (noteId) => readNote({ noteId: noteId as NId }),
      applyRead: (readId, ids) => applyRead({ readId: readId as RId, ids }),
      dismissRead: (readId) => dismissRead({ readId: readId as RId }),
      undoRead: (readId) => undoRead({ readId: readId as RId }),
      draftAnswer: (questionId) => draftAnswer({ questionId: questionId as QId }),
      matchUnmatched: (id, investorId) => matchUnmatched({ id: id as UId, investorId: investorId as Id<'investors'> }),
      dropUnmatched: (id) => dropUnmatched({ id: id as UId }),
      restoreUnmatched: (id) => restoreUnmatched({ id: id as UId }),
      notSame: (id) => notSame({ questionId: id as QId }),
      restoreSame: (id) => restoreSame({ questionId: id as QId }),
    }),
    [
      create, save, link, unlink, merge, unmerge, remove, restore, addToDeck, removeFromDeck, addNote, removeNote, restoreNote, markLine, unmarkLine,
      readNote, applyRead, dismissRead, undoRead, draftAnswer, matchUnmatched, dropUnmatched, restoreUnmatched, notSame, restoreSame,
    ],
  )
  const value = useMemo<QandaData>(
    () => ({ loaded: !!bank, questions: bank?.questions ?? NONE, noteCount: bank?.noteCount ?? 0, useNotes, useReads, unmatched: unmatched ?? NO_UNMATCHED, act }),
    [bank, unmatched, act],
  )
  return <QandaContext.Provider value={value}>{children}</QandaContext.Provider>
}
