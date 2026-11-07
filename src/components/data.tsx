import { createContext, useContext } from 'react'
import type { MoveRecord } from '../lib/board'
import type { Activity, Investor, InvestorFields, TouchOptions } from '../lib/pipeline'
import type { GoogleData, MeetingAnswer } from '../lib/google'
import type { Round, RoundChange } from '../lib/round'
import type { Stage } from '../lib/stages'

export type LogRow = RoundChange & { _id: string; at: number; by: string }

/** Everything Home and the /raise views read and write. Backed by Convex (or local seed data in dev preview). */
export type RaiseData = {
  loaded: boolean
  investors: Investor[]
  acts: Activity[]
  round: Round
  roundExists: boolean
  me: string
  save: (id: string | null, fields: InvestorFields) => Promise<string>
  /** One stage forward; `next` also sets the next step. Null at Money in or a closed stage. */
  advance: (id: string, next?: TouchOptions['next']) => Promise<{ stage: string; label: string } | null>
  /** Move to any stage (Pipeline board); resolves with what `undoMove` needs. Applied optimistically. */
  move: (id: string, stage: Stage) => Promise<MoveRecord>
  /** Put a moved investor back; rejects if it has moved again since. */
  undoMove: (rec: MoveRecord) => Promise<unknown>
  /** Log a touch; returns the day it was logged on. */
  logNote: (id: string, note: string, opts?: TouchOptions) => Promise<string>
  remove: (id: string) => Promise<unknown>
  /** `file` names the CSV in the change log; `ids` are the new rows (Undo, "See the new names"). */
  importMany: (rows: InvestorFields[], file?: string) => Promise<{ added: number; skipped: number; ids?: string[] }>
  updateRound: (round: Round) => Promise<number>
  /** Hooks (stable per provider). */
  useLog: (investorId: string | null) => Activity[] | undefined
  useSettingsLog: () => LogRow[] | undefined
  /** Ticked to-do indexes of a phase's prep checklist (Home). */
  usePrepTicks: (phaseKey: string | null) => number[] | undefined
  setPrepTick: (phaseKey: string, item: number, done: boolean) => Promise<unknown>
  /** Who can get in (the access list), you first. */
  useMembers: () => Member[] | undefined
  /** PST-263: Calendar and Gmail (your connection, the team's meetings and threads). Never holds a token. */
  google: GoogleData
  googleDo: GoogleActions
}

export type GoogleActions = {
  /** The Google consent URL to send the browser to. */
  connect: () => Promise<string>
  disconnect: () => Promise<unknown>
  syncNow: () => Promise<unknown>
  /** "How did it go?" answered (the stage move itself goes through `move`). */
  answer: (eventId: string, answer: MeetingAnswer) => Promise<unknown>
  /** "Not about the round" on Who's this?. */
  dismiss: (email: string) => Promise<unknown>
}

export type Member = { email: string; name: string; me: boolean }

export const RaiseContext = createContext<RaiseData | null>(null)

export function useRaise(): RaiseData {
  const v = useContext(RaiseContext)
  if (!v) throw new Error('useRaise outside RaiseContext')
  return v
}

/** Message for a failed write: our own ConvexError text, else the prototype's copy. */
export function errorMessage(e: unknown): string {
  const data = (e as { data?: unknown })?.data
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && 'message' in data) return String((data as { message: string }).message)
  return 'Couldn’t save. Check your connection and try again.'
}
