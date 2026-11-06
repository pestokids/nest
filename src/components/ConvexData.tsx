import { useMutation, useQuery } from 'convex/react'
import { useMemo, type ReactNode } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { applyMove, applyUndo } from '../lib/board'
import { todayIST } from '../lib/dates'
import { DEFAULT_ROUND } from '../lib/round'
import { RaiseContext, type RaiseData } from './data'
import { useSession } from './session'

const useLog = (investorId: string | null) =>
  useQuery(api.activities.forInvestor, investorId ? { investorId: investorId as Id<'investors'> } : 'skip')
const useSettingsLog = () => useQuery(api.settings.log)
const useMembers = () => useQuery(api.access.members)
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

  const value = useMemo<RaiseData>(
    () => ({
      loaded: !!investors && !!acts && !!settings,
      investors: investors ?? [],
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
    }),
    [investors, acts, settings, me, upsert, advance, move, undoMove, logNote, remove, importMany, updateRound, setTick],
  )
  return <RaiseContext.Provider value={value}>{children}</RaiseContext.Provider>
}
