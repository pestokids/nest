import { createContext, useContext } from 'react'
import type { MoveRecord } from '../lib/board'
import type { Activity, Investor, InvestorFields, TouchOptions } from '../lib/pipeline'
import type { GoogleData, MeetingAnswer } from '../lib/google'
import type { AIData, AISettings, InvestorAI } from '../lib/enrich'
import type { Round, RoundChange } from '../lib/round'
import type { Stage } from '../lib/stages'
import type { Suggestion } from '../lib/suggestions'
import type { AgentCall, AgentKeyRow, AgentScope, CreatedKey } from '../lib/agents'

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
  /** PST-275: open suggested fixes, best first, and what you can do with them. */
  suggestions: Suggestion[]
  suggest: SuggestionActions
  /** PST-274: enrichment (Claude with web search): spend, toggles, runs, looked-up senders. */
  ai: AIData
  aiDo: AIActions
  /** One investor's latest run, facts and people (the drawer). A hook. */
  useInvestorAI: (investorId: string | null) => InvestorAI | undefined
  /** PST-276: agents' keys (never the keys themselves) and the server URL they connect to. */
  agents: AgentsData
  agentsDo: AgentActions
  /** A key's last 50 calls, newest first. A hook. */
  useAgentActivity: (keyId: string | null) => AgentCall[] | undefined
}

export type AgentsData = { loaded: boolean; serverUrl: string; keys: AgentKeyRow[] }
export type AgentActions = {
  /** Resolves with the key, the only time it's ever available. */
  create: (name: string, scope: AgentScope) => Promise<CreatedKey>
  revoke: (id: string) => Promise<unknown>
}

export type SuggestionActions = {
  /** Accept (or Merge); `applied: false` when it had stopped fitting, so nothing changed. */
  accept: (id: string) => Promise<{ applied: boolean }>
  dismiss: (id: string) => Promise<unknown>
  /** "Accept N safe ones": the ids it accepted, for Undo. */
  acceptSafe: () => Promise<{ ids: string[] }>
  /** Undo accepts or dismissals: they go back to open. */
  undo: (ids: string[]) => Promise<unknown>
  /** Run the rule checks now. */
  check: () => Promise<unknown>
}

export type AIActions = {
  enrich: (investorId: string) => Promise<unknown>
  enrichMany: (ids: string[]) => Promise<unknown>
  lookup: (email: string) => Promise<unknown>
  stop: (runId: string) => Promise<unknown>
  /** Resolves with the clash note when keeping it changed nothing. */
  keep: (factId: string) => Promise<string | null>
  dismiss: (factId: string) => Promise<unknown>
  undoDismiss: (factId: string) => Promise<unknown>
  keepAll: (runId: string) => Promise<number>
  dismissAll: (runId: string) => Promise<number>
  setAuto: (patch: Partial<Pick<AISettings, 'lookups' | 'enrichNew'>>) => Promise<unknown>
  /** Who's this?: a new investor (no id), or this person joins an existing one. Resolves with the investor's id. */
  addSender: (email: string, investorId?: string) => Promise<string>
  addPerson: (investorId: string, p: { name: string; title?: string; email?: string }) => Promise<unknown>
  setPrimary: (personId: string) => Promise<unknown>
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
