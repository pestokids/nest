import { useMutation, useQuery } from 'convex/react'
import { useMemo, type ReactNode } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { DEFAULT_ROUND } from '../lib/round'
import { RaiseContext, type RaiseData } from './data'
import { useSession } from './session'

const useLog = (investorId: string | null) =>
  useQuery(api.activities.forInvestor, investorId ? { investorId: investorId as Id<'investors'> } : 'skip')
const useSettingsLog = () => useQuery(api.settings.log)
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
      advance: (id) => advance({ id: id as Id<'investors'> }),
      logNote: (id, note) => logNote({ id: id as Id<'investors'>, note }),
      remove: (id) => remove({ id: id as Id<'investors'> }),
      importMany: (rows) => importMany({ rows }),
      updateRound: (round) => updateRound({ round }),
      useLog,
      useSettingsLog,
      usePrepTicks,
      setPrepTick: (phaseKey, item, done) => setTick({ phaseKey, item, done }),
    }),
    [investors, acts, settings, me, upsert, advance, logNote, remove, importMany, updateRound, setTick],
  )
  return <RaiseContext.Provider value={value}>{children}</RaiseContext.Provider>
}
