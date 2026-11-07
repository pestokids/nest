import { useMutation, useQuery } from 'convex/react'
import { useMemo, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { Question } from '../../lib/qanda'
import { QandaContext, type QandaActions, type QandaData } from './data'

const NONE: Question[] = []
const useNotes = (investorId: string | null) => useQuery(api.qanda.notesFor, investorId ? { investorId: investorId as Id<'investors'> } : 'skip')

type QId = Id<'questions'>
type NId = Id<'notes'>

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
    }),
    [create, save, link, unlink, merge, unmerge, remove, restore, addToDeck, removeFromDeck, addNote, removeNote, restoreNote, markLine, unmarkLine],
  )
  const value = useMemo<QandaData>(() => ({ loaded: !!bank, questions: bank?.questions ?? NONE, noteCount: bank?.noteCount ?? 0, useNotes, act }), [bank, act])
  return <QandaContext.Provider value={value}>{children}</QandaContext.Provider>
}
