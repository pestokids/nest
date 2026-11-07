import { useAction, useMutation, useQuery } from 'convex/react'
import { useMemo, type ReactNode } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { applyMove, applyUndo } from '../lib/board'
import { todayIST } from '../lib/dates'
import { NO_GOOGLE, withContact, type GoogleData } from '../lib/google'
import { DEFAULT_ROUND } from '../lib/round'
import { NO_AI, type AIData } from '../lib/enrich'
import type { Suggestion } from '../lib/suggestions'
import type { AgentScope } from '../lib/agents'
import { RaiseContext, type RaiseData } from './data'
import { ConvexQanda } from './qanda/ConvexQanda'

const NO_SUGGESTIONS: Suggestion[] = []
import { useSession } from './session'

const useLog = (investorId: string | null) =>
  useQuery(api.activities.forInvestor, investorId ? { investorId: investorId as Id<'investors'> } : 'skip')
const useSettingsLog = () => useQuery(api.settings.log)
const useMembers = () => useQuery(api.access.members)
const useInvestorAI = (investorId: string | null) => useQuery(api.enrich.forInvestor, investorId ? { investorId: investorId as Id<'investors'> } : 'skip')
const useAgentActivity = (keyId: string | null) => useQuery(api.agents.activity, keyId ? { keyId: keyId as Id<'agentKeys'> } : 'skip')
const NO_AGENTS = { loaded: false, serverUrl: '', keys: [] }
const usePrepTicks = (phaseKey: string | null) => {
  const rows = useQuery(api.prep.list, phaseKey ? { phaseKey } : 'skip')
  return useMemo(() => rows?.map((r) => r.item), [rows])
}

/** Live Convex subscriptions; every open tab stays in sync. */
export function ConvexData({ children }: { children: ReactNode }) {
  const me = useSession().me.firstName
  const investors = useQuery(api.investors.list)
  const acts = useQuery(api.activities.recent)
  const settings = useQuery(api.settings.get)
  const upsert = useMutation(api.investors.upsert)
  const advance = useMutation(api.investors.advance)
  // Board moves show at once; Convex replaces the guess with the saved row.
  const move = useMutation(api.investors.move).withOptimisticUpdate((store, { id, stage }) => {
    const list = store.getQuery(api.investors.list, {})
    if (list) store.setQuery(api.investors.list, {}, list.map((i) => (i._id === id ? { ...i, ...applyMove(i, stage, todayIST()).patch } : i)))
  })
  const undoMove = useMutation(api.investors.undoMove).withOptimisticUpdate((store, rec) => {
    const list = store.getQuery(api.investors.list, {})
    if (!list) return
    store.setQuery(api.investors.list, {}, list.map((i) => {
      const back = i._id === rec.id ? applyUndo(i, rec) : null
      return back ? { ...i, ...back } : i
    }))
  })
  const logNote = useMutation(api.investors.logNote)
  const remove = useMutation(api.investors.remove)
  const importMany = useMutation(api.investors.importMany)
  const updateRound = useMutation(api.settings.update)
  const setTick = useMutation(api.prep.set)
  const g = useQuery(api.google.data)
  const gConnect = useAction(api.google.connect)
  const gDisconnect = useMutation(api.google.disconnect)
  const gSync = useMutation(api.google.syncNow)
  const gAnswer = useMutation(api.google.answerMeeting)
  const gDismiss = useMutation(api.google.dismissPerson)
  const suggestionRows = useQuery(api.suggestions.list)
  const sAccept = useMutation(api.suggestions.accept)
  const sDismiss = useMutation(api.suggestions.dismiss)
  const sAcceptSafe = useMutation(api.suggestions.acceptSafe)
  const sUndo = useMutation(api.suggestions.undo)
  const sRun = useMutation(api.suggestions.run)
  const suggest = useMemo(
    () => ({
      accept: (id: string) => sAccept({ id: id as Id<'suggestions'> }),
      dismiss: (id: string) => sDismiss({ id: id as Id<'suggestions'> }),
      acceptSafe: () => sAcceptSafe({}),
      undo: (ids: string[]) => sUndo({ ids: ids as Id<'suggestions'>[] }),
      check: () => sRun({}),
    }),
    [sAccept, sDismiss, sAcceptSafe, sUndo, sRun],
  )
  const google = useMemo<GoogleData>(() => (g ? { loaded: true, ...g } : { ...NO_GOOGLE, loaded: false }), [g])
  const a = useQuery(api.enrich.data)
  const ai = useMemo<AIData>(() => (a ? { loaded: true, ...a } : NO_AI), [a])
  const aiEnrich = useMutation(api.enrich.enrich)
  const aiEnrichMany = useMutation(api.enrich.enrichMany)
  const aiLookup = useMutation(api.enrich.lookupSender)
  const aiStop = useMutation(api.enrich.stop)
  const aiKeep = useMutation(api.enrich.keepFact)
  const aiDismiss = useMutation(api.enrich.dismissFact)
  const aiUndo = useMutation(api.enrich.undoDismiss)
  const aiKeepAll = useMutation(api.enrich.keepAll)
  const aiDismissAll = useMutation(api.enrich.dismissAll)
  const aiSetAuto = useMutation(api.enrich.setAuto)
  const aiAddSender = useMutation(api.enrich.addSender)
  const aiAddPerson = useMutation(api.enrich.addPerson)
  const aiSetPrimary = useMutation(api.enrich.setPrimary)
  const aiDo = useMemo(
    () => ({
      enrich: (id: string) => aiEnrich({ investorId: id as Id<'investors'> }),
      enrichMany: (ids: string[]) => aiEnrichMany({ ids: ids as Id<'investors'>[] }),
      lookup: (email: string) => aiLookup({ email }),
      stop: (runId: string) => aiStop({ runId: runId as Id<'enrichRuns'> }),
      keep: (factId: string) => aiKeep({ factId: factId as Id<'facts'> }),
      dismiss: (factId: string) => aiDismiss({ factId: factId as Id<'facts'> }),
      undoDismiss: (factId: string) => aiUndo({ factId: factId as Id<'facts'> }),
      keepAll: (runId: string) => aiKeepAll({ runId: runId as Id<'enrichRuns'> }),
      dismissAll: (runId: string) => aiDismissAll({ runId: runId as Id<'enrichRuns'> }),
      setAuto: (patch: { lookups?: boolean; enrichNew?: boolean }) => aiSetAuto(patch),
      addSender: (email: string, investorId?: string) => aiAddSender({ email, investorId: investorId as Id<'investors'> | undefined }),
      addPerson: (investorId: string, p: { name: string; title?: string; email?: string }) => aiAddPerson({ investorId: investorId as Id<'investors'>, ...p }),
      setPrimary: (personId: string) => aiSetPrimary({ personId: personId as Id<'people'> }),
    }),
    [aiEnrich, aiEnrichMany, aiLookup, aiStop, aiKeep, aiDismiss, aiUndo, aiKeepAll, aiDismissAll, aiSetAuto, aiAddSender, aiAddPerson, aiSetPrimary],
  )
  const agentRows = useQuery(api.agents.list)
  const agents = useMemo(() => (agentRows ? { loaded: true, ...agentRows } : NO_AGENTS), [agentRows])
  const agentCreate = useMutation(api.agents.create)
  const agentRevoke = useMutation(api.agents.revoke)
  const agentsDo = useMemo(
    () => ({
      create: (name: string, scope: AgentScope) => agentCreate({ name, scope }),
      revoke: (id: string) => agentRevoke({ id: id as Id<'agentKeys'> }),
    }),
    [agentCreate, agentRevoke],
  )
  // Gone quiet reads email and meeting dates too (`lastContact`): attach them to each investor.
  const withSignals = useMemo(() => withContact(investors ?? [], google, Date.now()), [investors, google])
  const googleDo = useMemo(
    () => ({
      connect: () => gConnect({}),
      disconnect: () => gDisconnect({}),
      syncNow: () => gSync({}),
      answer: (eventId: string, answer: 'm1' | 'm2' | 'passed') => gAnswer({ eventId, answer }),
      dismiss: (email: string) => gDismiss({ email }),
    }),
    [gConnect, gDisconnect, gSync, gAnswer, gDismiss],
  )

  const value = useMemo<RaiseData>(
    () => ({
      loaded: !!investors && !!acts && !!settings,
      investors: withSignals,
      acts: acts ?? [],
      round: settings?.round ?? DEFAULT_ROUND,
      roundExists: settings?.exists ?? false,
      me,
      save: (id, fields) => upsert({ id: (id ?? undefined) as Id<'investors'> | undefined, fields }),
      advance: (id, next) => advance({ id: id as Id<'investors'>, next }),
      move: async (id, stage) => {
        const r = await move({ id: id as Id<'investors'>, stage })
        return { id, to: stage, from: r.from, activityId: r.activityId }
      },
      undoMove: (rec) =>
        undoMove({ id: rec.id as Id<'investors'>, to: rec.to, from: rec.from, activityId: (rec.activityId ?? null) as Id<'activities'> | null }),
      logNote: (id, note, o) => logNote({ id: id as Id<'investors'>, note, touch: o?.touch, date: o?.date, next: o?.next }),
      remove: (id) => remove({ id: id as Id<'investors'> }),
      importMany: (rows, file) => importMany({ rows, file }),
      updateRound: (round) => updateRound({ round }),
      useLog,
      useSettingsLog,
      usePrepTicks,
      setPrepTick: (phaseKey, item, done) => setTick({ phaseKey, item, done }),
      useMembers,
      google,
      googleDo,
      suggestions: suggestionRows ?? NO_SUGGESTIONS,
      suggest,
      ai,
      aiDo,
      useInvestorAI,
      agents,
      agentsDo,
      useAgentActivity,
    }),
    [investors, withSignals, acts, settings, me, upsert, advance, move, undoMove, logNote, remove, importMany, updateRound, setTick, google, googleDo, suggestionRows, suggest, ai, aiDo, agents, agentsDo],
  )
  return (
    <RaiseContext.Provider value={value}>
      <ConvexQanda>{children}</ConvexQanda>
    </RaiseContext.Provider>
  )
}
