// PST-281: what the Q&A bank, the Notes tab and the prep brief read and write.
// Backed by Convex (ConvexQanda) or an in-memory store in preview (src/preview/PreviewQanda.tsx).
import { createContext, useContext } from 'react'
import { nextDeck, type AskSource, type Note, type Question } from '../../lib/qanda'
import type { Draft, NoteRead, UnmatchedNote } from '../../lib/meetingNotes'
import { useMaterials } from '../materials/data'

/** One ask, as `link` takes it (and `unlink` hands it back for Undo). */
export type AskInput = { questionId: string; investorId: string; date: string; source?: AskSource; noteId?: string; noteLine?: number }

export type QandaActions = {
  /** "Add a question"; the same wording as a question in the bank adds to that one (`existed`). */
  create: (a: { text: string; theme?: string; investorId?: string; date?: string }) => Promise<{ id: string; existed: boolean }>
  /** The Answer panel: wording, best answer (a changed one becomes a new version), theme and slide. */
  save: (a: { id: string; text: string; bestAnswer: string; theme: string; slideRef: string | null }) => Promise<unknown>
  link: (a: AskInput) => Promise<unknown>
  unlink: (askId: string) => Promise<AskInput | null>
  /** "Same question": every ask of `dropId` moves to `keepId`. */
  merge: (dropId: string, keepId: string) => Promise<{ keepId: string; asked: number }>
  unmerge: (id: string) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
  restore: (id: string) => Promise<unknown>
  /** Onto the deck-gaps list; resolves with the deck version. `deck` is the one the button showed: Convex works it out again itself, the preview store uses it. */
  addToDeck: (id: string, deck: number) => Promise<number>
  removeFromDeck: (id: string) => Promise<unknown>
  addNote: (a: { investorId: string; text: string; date?: string; title?: string; meetingId?: string }) => Promise<string>
  removeNote: (id: string) => Promise<unknown>
  restoreNote: (id: string) => Promise<unknown>
  /** Pick a note line as a question. */
  markLine: (noteId: string, line: number) => Promise<{ questionId: string; askId: string; created: boolean }>
  unmarkLine: (noteId: string, line: number) => Promise<unknown>
  /* PST-277: Nest reads the notes (convex/noteReads.ts). */
  /** "Read with Nest" or Try again. */
  readNote: (noteId: string) => Promise<unknown>
  /** Apply the ticked proposals (by id); the rest are dropped. */
  applyRead: (readId: string, ids: string[]) => Promise<{ applied: number }>
  dismissRead: (readId: string) => Promise<unknown>
  /** Undo Apply or Dismiss. */
  undoRead: (readId: string) => Promise<unknown>
  /** "Draft from past answers": nothing is saved. */
  draftAnswer: (questionId: string) => Promise<Draft>
  /** "Unmatched notes" on Today: whose notes they are, or not about the round (Undo: restoreUnmatched). */
  matchUnmatched: (id: string, investorId: string) => Promise<unknown>
  dropUnmatched: (id: string) => Promise<unknown>
  restoreUnmatched: (id: string) => Promise<unknown>
  /** PST-292: "Not the same" on a question Jev marked "Same as …" (Undo: restoreSame). */
  notSame: (id: string) => Promise<unknown>
  restoreSame: (id: string) => Promise<unknown>
}

export type QandaData = {
  loaded: boolean
  questions: Question[]
  /** Notes from meetings, for the facts row. */
  noteCount: number
  /** One investor's notes, newest first (a hook, stable per provider). */
  useNotes: (investorId: string | null) => Note[] | undefined
  /** PST-277: the latest read of each of an investor's notes (a hook). */
  useReads: (investorId: string | null) => NoteRead[] | undefined
  /** PST-277: notes nobody could be matched to. */
  unmatched: UnmatchedNote[]
  act: QandaActions
}

export const QandaContext = createContext<QandaData | null>(null)

export function useQanda(): QandaData {
  const v = useContext(QandaContext)
  if (!v) throw new Error('useQanda outside QandaContext')
  return v
}

/** "Add to deck vN": the version after the current pitch deck in Materials (NEXT_DECK while there is none). */
export function useNextDeck(): number {
  const m = useMaterials()
  return nextDeck(m.materials, m.versions)
}
