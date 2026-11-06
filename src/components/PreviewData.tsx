// DEV ONLY: renders the views from internal/seed.json with in-memory writes, so
// the UI can be checked without a Google sign-in. Never used in production builds.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { todayIST } from '../lib/dates'
import { applyAdvance, applySave, type Activity, type Investor } from '../lib/pipeline'
import { DEFAULT_ROUND, diffRound, mergeRound, type Round } from '../lib/round'
import { LABEL } from '../lib/stages'
import { RaiseContext, type LogRow, type RaiseData } from './data'

type Seed = { round?: Partial<Round>; investors: (Omit<Investor, '_id'> & { slug: string })[] }

export function PreviewData({ children }: { children: ReactNode }) {
  const [investors, setInvestors] = useState<Investor[] | null>(null)
  const [acts, setActs] = useState<Activity[]>([])
  const [round, setRound] = useState<Round>(DEFAULT_ROUND)
  const [log, setLog] = useState<LogRow[]>([])

  useEffect(() => {
    fetch('/internal/seed.json')
      .then((r) => r.json() as Promise<Seed>)
      .then((s) => {
        const clean = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as Investor
        setInvestors(s.investors.map((i) => clean({ ...i, _id: i.slug })))
        setRound(mergeRound(s.round))
        const t = todayIST()
        setActs(
          s.investors.filter((i) => i.stage !== 'todo').map((i, n) => ({ _id: 'a' + n, investorId: i.slug, kind: 'stage', stage: i.stage, date: t, by: 'Dev' })),
        )
      })
  }, [])

  const value = useMemo<RaiseData>(() => {
    const t = todayIST()
    let n = 0
    const act = (a: Omit<Activity, '_id' | 'date' | 'by'>) => setActs((xs) => [{ ...a, _id: `p${Date.now()}${n++}`, date: t, by: 'Dev' }, ...xs])
    const list = investors ?? []
    return {
      loaded: !!investors,
      investors: list,
      acts,
      round,
      roundExists: true,
      me: 'Dev',
      save: async (id, f) => {
        const prev = id ? list.find((i) => i._id === id) ?? null : null
        const { lastTouch, maxStage, logStage } = applySave(prev, f, t)
        const nid = id ?? 'new' + Date.now()
        const doc: Investor = { ...f, _id: nid, lastTouch, maxStage }
        setInvestors((xs) => (prev ? (xs ?? []).map((i) => (i._id === id ? doc : i)) : [...(xs ?? []), doc]))
        if (logStage) act({ investorId: nid, kind: 'stage', stage: logStage })
        return nid
      },
      advance: async (id) => {
        const i = list.find((x) => x._id === id)
        const nx = i && applyAdvance(i, t)
        if (!i || !nx) return null
        setInvestors((xs) => (xs ?? []).map((x) => (x._id === id ? { ...x, stage: nx.stage, lastTouch: t, ...(nx.raiseMax ? { maxStage: nx.stage } : {}) } : x)))
        act({ investorId: id, kind: 'stage', stage: nx.stage })
        return { stage: nx.stage, label: LABEL[nx.stage] }
      },
      logNote: async (id, note) => {
        act({ investorId: id, kind: 'note', note })
        setInvestors((xs) => (xs ?? []).map((x) => (x._id === id ? { ...x, lastTouch: t } : x)))
        return t
      },
      remove: async (id) => {
        setInvestors((xs) => (xs ?? []).filter((x) => x._id !== id))
        setActs((xs) => xs.filter((a) => a.investorId !== id))
      },
      importMany: async (rows) => {
        setInvestors((xs) => [...(xs ?? []), ...rows.map((f, k) => ({ ...f, _id: `imp${Date.now()}${k}`, maxStage: 'todo' as const }))])
        return { added: rows.length, skipped: 0 }
      },
      updateRound: async (r) => {
        const ch = diffRound(round, r)
        setLog((l) => [...ch.map((c, k) => ({ ...c, _id: `l${Date.now()}${k}`, at: Date.now(), by: 'Dev' })), ...l])
        setRound(r)
        return ch.length
      },
      useLog: (id) => acts.filter((a) => a.investorId === id),
      useSettingsLog: () => log,
      signOut: () => {},
    }
  }, [investors, acts, round, log])

  return <RaiseContext.Provider value={value}>{children}</RaiseContext.Provider>
}
