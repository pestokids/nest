import { createContext, useContext } from 'react'
import type { Activity, Investor, InvestorFields } from '../lib/pipeline'
import type { Round, RoundChange } from '../lib/round'

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
  advance: (id: string) => Promise<{ stage: string; label: string } | null>
  logNote: (id: string, note: string) => Promise<string>
  remove: (id: string) => Promise<unknown>
  importMany: (rows: InvestorFields[]) => Promise<{ added: number; skipped: number }>
  updateRound: (round: Round) => Promise<number>
  /** Hooks (stable per provider). */
  useLog: (investorId: string | null) => Activity[] | undefined
  useSettingsLog: () => LogRow[] | undefined
  /** Ticked to-do indexes of a phase's prep checklist (Home). */
  usePrepTicks: (phaseKey: string | null) => number[] | undefined
  setPrepTick: (phaseKey: string, item: number, done: boolean) => Promise<unknown>
}

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
