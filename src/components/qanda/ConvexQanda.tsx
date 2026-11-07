import { useAction, useMutation, useQuery } from 'convex/react'
import { useMemo, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { Question } from '../../lib/qanda'
import type { NoteRead, UnmatchedNote } from '../../lib/meetingNotes'
import { QandaContext, type QandaActions, type QandaData } from './data'

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
  const bank = useQuery(api.qanda.bank)
  const create = useMutation(api.qanda.create)
  const save = useMutation(api.qanda.save)
  const link = useMutation(api.qanda.link)
  const unlink = useMutation(api.qanda.unlink)
  const merge = useMutation(api.qanda.merge)
  const unmerge = useMutation(api.qanda.unmerge)
  const remove = useMutation(api.qanda.remove)
  const restore = useMutation(api.qanda.restore)
  const addToDeck = useMutation(api.qanda.addToDeck)
  const removeFromDeck = useMutation(api.qanda.removeFromDeck)
  const addNote = useMutation(api.qanda.addNote)
  const removeNote = useMutation(api.qanda.removeNote)
  const restoreNote = useMutation(api.qanda.restoreNote)
  const markLine = useMutation(api.qanda.markLine)
  const unmarkLine = useMutation(api.qanda.unmarkLine)
  const unmatched = useQuery(api.noteReads.unmatched)
  const readNote = useMutation(api.noteReads.read)
  const applyRead = useMutation(api.noteReads.apply)
  const dismissRead = useMutation(api.noteReads.dismiss)
  const undoRead = useMutation(api.noteReads.undo)
  const draftAnswer = useAction(api.noteReads.draftAnswer)
  const matchUnmatched = useMutation(api.noteReads.matchUnmatched)
  const dropUnmatched = useMutation(api.noteReads.dropUnmatched)
  const restoreUnmatched = useMutation(api.noteReads.restoreUnmatched)
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
    }),
    [
      create, save, link, unlink, merge, unmerge, remove, restore, addToDeck, removeFromDeck, addNote, removeNote, restoreNote, markLine, unmarkLine,
      readNote, applyRead, dismissRead, undoRead, draftAnswer, matchUnmatched, dropUnmatched, restoreUnmatched,
    ],
  )
  const value = useMemo<QandaData>(
    () => ({ loaded: !!bank, questions: bank?.questions ?? NONE, noteCount: bank?.noteCount ?? 0, useNotes, useReads, unmatched: unmatched ?? NO_UNMATCHED, act }),
    [bank, unmatched, act],
  )
  return <QandaContext.Provider value={value}>{children}</QandaContext.Provider>
}
