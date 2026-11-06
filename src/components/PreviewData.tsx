// DEV ONLY: renders Home and the Raise views with in-memory writes, so the UI
// can be checked without a Google sign-in. Never used in production builds.
// Data: the fake fixture in src/preview/ (default), or internal/seed.json with `&seed`.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { applyMove, applyUndo } from '../lib/board'
import { todayIST } from '../lib/dates'
import { applyAdvance, applySave, touchDay, type Activity, type Investor } from '../lib/pipeline'
import { DEFAULT_ROUND, diffRound, mergeRound, type Round } from '../lib/round'
import { LABEL } from '../lib/stages'
import { fixtureActs, fixtureBoardExtras, fixtureInvestors, fixtureRound } from '../preview/fixture'
import { addDays } from '../lib/today'
import { ACTIVE } from '../lib/stages'
import { RaiseContext, type LogRow, type RaiseData } from './data'

type Seed = { round?: Partial<Round>; investors: (Omit<Investor, '_id'> & { slug: string })[] }
export type PreviewHome = 'default' | 'firstrun' | 'prepdone'

/** `board`: add the Pipeline board's extra fake cards (`&pipeline=…`). `today`: the Raise · Today preview state. */
export function PreviewData({
  source, home = 'default', board = false, today: todayState = 'default', children,
}: { source: 'fixture' | 'seed'; home?: PreviewHome; board?: boolean; today?: 'default' | 'nothingdue' | 'win'; children: ReactNode }) {
  const [investors, setInvestors] = useState<Investor[] | null>(null)
  const [acts, setActs] = useState<Activity[]>([])
  const [round, setRound] = useState<Round>(DEFAULT_ROUND)
  const [roundExists, setRoundExists] = useState(true)
  const [log, setLog] = useState<LogRow[]>([])
  const [ticks, setTicks] = useState<Record<string, number[]>>({})

  useEffect(() => {
    const t = todayIST()
    const load = (inv: Investor[], r: Round) => {
      if (home === 'firstrun') {
        setInvestors([])
        setRoundExists(false)
        setRound(DEFAULT_ROUND)
        return
      }
      // `&today=nothingdue`: every next step is later and every live conversation was touched yesterday.
      const list =
        todayState === 'nothingdue'
          ? inv.map((i) => ({
              ...i,
              nextDate: i.nextDate && i.nextDate <= t ? addDays(t, 3) : i.nextDate,
              lastTouch: ACTIVE.has(i.stage) ? addDays(t, -1) : i.lastTouch,
            }))
          : inv
      setInvestors(list)
      setRound(r)
      setActs(fixtureActs(list, t))
      if (home === 'prepdone') {
        const p = r.phases.find((x) => t >= x.from && t <= x.to)
        if (p) setTicks({ [p.k]: p.todo.map((_, i) => i) })
      }
    }
    // The real seed file only exists locally; deployed previews always use the fixture.
    if (source === 'fixture' || !import.meta.env.DEV) return load([...fixtureInvestors(t), ...(board ? fixtureBoardExtras(t) : [])], fixtureRound(t))
    fetch('/internal/seed.json')
      .then((r) => r.json() as Promise<Seed>)
      .then((s) => {
        const clean = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as Investor
        load(
          s.investors.map((i) => clean({ ...i, _id: i.slug })),
          mergeRound(s.round),
        )
      })
  }, [source, home, board, todayState])

  const latest = useRef(investors)
  useEffect(() => {
    latest.current = investors
  }, [investors])

  const value = useMemo<RaiseData>(() => {
    const t = todayIST()
    let n = 0
    const act = (a: Omit<Activity, '_id' | 'date' | 'by'> & { date?: string }) => {
      const _id = `p${Date.now()}${n++}`
      setActs((xs) => [{ date: t, ...a, _id, by: 'Dev', _creationTime: Date.now() }, ...xs])
      return _id
    }
    const list = investors ?? []
    return {
      loaded: !!investors,
      investors: list,
      acts,
      round,
      roundExists,
      me: 'Dev',
      save: async (id, f) => {
        const prev = id ? list.find((i) => i._id === id) ?? null : null
        const { lastTouch, maxStage, logStage } = applySave(prev, f, t)
        const nid = id ?? 'new' + Date.now()
        const doc: Investor = {
          ...f, _id: nid, lastTouch, maxStage, email: f.email?.trim() || undefined,
          parkedUntil: f.stage === 'parked' ? f.parkedUntil || undefined : undefined, _creationTime: prev?._creationTime ?? Date.now(),
        }
        setInvestors((xs) => (prev ? (xs ?? []).map((i) => (i._id === id ? doc : i)) : [...(xs ?? []), doc]))
        if (logStage) act({ investorId: nid, kind: 'stage', stage: logStage })
        return nid
      },
      advance: async (id, next) => {
        const i = list.find((x) => x._id === id)
        const nx = i && applyAdvance(i, t)
        if (!i || !nx) return null
        const step = next ? { nextStep: next.step.trim(), nextDate: next.date || undefined } : {}
        setInvestors((xs) => (xs ?? []).map((x) => (x._id === id ? { ...x, stage: nx.stage, lastTouch: t, ...(nx.raiseMax ? { maxStage: nx.stage } : {}), ...step } : x)))
        act({ investorId: id, kind: 'stage', stage: nx.stage })
        return { stage: nx.stage, label: LABEL[nx.stage] }
      },
      move: async (id, stage) => {
        const i = list.find((x) => x._id === id)
        if (!i) throw { data: 'That investor was deleted' }
        const from = { stage: i.stage, lastTouch: i.lastTouch, maxStage: i.maxStage }
        if (i.stage === stage) return { id, to: stage, from, activityId: null }
        const { patch, logStage } = applyMove(i, stage, t)
        setInvestors((xs) => (xs ?? []).map((x) => (x._id === id ? { ...x, ...patch } : x)))
        const activityId = logStage ? act({ investorId: id, kind: 'stage', stage: logStage }) : null
        return { id, to: stage, from, activityId }
      },
      undoMove: async (rec) => {
        // Undo runs from a toast created before the move, so read the latest rows.
        const i = latest.current?.find((x) => x._id === rec.id)
        const back = i && applyUndo(i, rec)
        if (!back) throw { data: 'It moved again since, so there’s nothing to undo' }
        setInvestors((xs) => (xs ?? []).map((x) => (x._id === rec.id ? { ...x, ...back } : x)))
        if (rec.activityId) setActs((xs) => xs.filter((a) => a._id !== rec.activityId))
      },
      logNote: async (id, note, o) => {
        const day = touchDay(o?.date, t)
        act({ investorId: id, kind: 'note', note: note.trim(), touch: o?.touch, date: day })
        setInvestors((xs) =>
          (xs ?? []).map((x) =>
            x._id === id
              ? { ...x, lastTouch: !x.lastTouch || x.lastTouch < day ? day : x.lastTouch, ...(o?.next ? { nextStep: o.next.step.trim(), nextDate: o.next.date || undefined } : {}) }
              : x,
          ),
        )
        return day
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
        setRoundExists(true)
        return ch.length
      },
      useLog: (id) => acts.filter((a) => a.investorId === id),
      useSettingsLog: () => log,
      usePrepTicks: (k) => (k ? ticks[k] ?? [] : undefined),
      setPrepTick: async (k, item, done) =>
        setTicks((m) => ({ ...m, [k]: done ? [...new Set([...(m[k] ?? []), item])] : (m[k] ?? []).filter((x) => x !== item) })),
    }
  }, [investors, acts, round, roundExists, log, ticks])

  return <RaiseContext.Provider value={value}>{children}</RaiseContext.Provider>
}
