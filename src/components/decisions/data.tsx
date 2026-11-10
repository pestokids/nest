// PST-293: what the decision features read and write: every investor's decision
// (status, decide-by date, calls, maybe-since), the signals Jev read from emails
// and notes, and the drawer's log. Convex when signed in, an in-memory store over
// made-up rows under ?preview (src/preview/decisionsFixture.ts).
import { useMutation, useQuery } from 'convex/react'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { buildDecisions, STATUS_PHRASE, withStatus, type Decision, type DecisionFields, type DecisionStatus } from '../../lib/decisions'
import { latestSignal as latestOf, type SignalView } from '../../lib/signals'
import { todayIST } from '../../lib/dates'
import { play } from '../../lib/sound'
import { fixtureAutoSignal, fixtureDecisions, type PreviewLogEntry, type PreviewSignal } from '../../preview/decisionsFixture'
import { errorMessage, useRaise } from '../data'
import { showDecisionBack, showDoneAsk, showResolve, showUndoSignal } from '../optimistic-interactions' // PST-298
import { usePreviewState } from '../preview-state'
import { useToast } from '../ui'

export type DecisionLogEntry = Omit<PreviewLogEntry, 'investorId'>

export type DecisionsValue = {
  loaded: boolean
  decisions: Decision[]
  signals: SignalView[]
  /** One investor's decision (no status and no calls when there's nothing yet). */
  decisionOf: (investorId: string) => Decision
  /** The newest signal about an investor, for PST-295's race lanes. */
  latestSignal: (investor: { _id: string } | string) => SignalView | null
  /** Null clears it. Resolves with the log row Undo takes (null: nothing changed). */
  setStatus: (investorId: string, status: DecisionStatus | null, reason?: string) => Promise<string | null>
  undo: (logId: string) => Promise<unknown>
  /** Undo the change Nest made from a signal. */
  undoSignal: (signalId: string) => Promise<unknown>
  /** A day, or null to clear it. */
  setDecideBy: (investorId: string, date: string | null) => Promise<unknown>
  /** A Decide row: take its change, or not. Resolves with the log row, if any. */
  resolve: (signalId: string, accept: boolean) => Promise<string | null>
  doneAsk: (signalId: string) => Promise<unknown>
  /** One investor's status changes, newest first. A hook. */
  useLog: (investorId: string | null) => DecisionLogEntry[] | undefined
}

const Ctx = createContext<DecisionsValue | null>(null)

export function useDecisions(): DecisionsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDecisions outside DecisionsProvider')
  return v
}

/** The newest signal about an investor (PST-295's race lanes). */
export const useLatestSignal = (investor: { _id: string } | string) => useDecisions().latestSignal(investor)

const empty = (investorId: string): Decision => ({ investorId, calls: 0 })

function shape(decisions: Decision[], signals: SignalView[]) {
  const byId = new Map(decisions.map((d) => [d.investorId, d]))
  return {
    decisions,
    signals,
    decisionOf: (id: string) => byId.get(id) ?? empty(id),
    latestSignal: (i: { _id: string } | string) => latestOf(signals.filter((s) => !s.undoneAt), typeof i === 'string' ? i : i._id),
  }
}

/** Wrap the app (inside Drafts): Convex, or the preview store under ?preview. */
export function DecisionsProvider({ children }: { children: ReactNode }) {
  const preview = usePreviewState()
  return preview ? <PreviewDecisions state={(preview.signal as PreviewSignal | null | undefined) ?? null}>{children}</PreviewDecisions> : <ConvexDecisions>{children}</ConvexDecisions>
}

/**
 * Status changes with the toast and Undo (the drawer's chips, Mark as no,
 * Pipeline › Maybes, the Inbox rows). Shows at once; saves behind.
 */
export function useDecide() {
  const x = useDecisions()
  const toast = useToast()
  return useMemo(() => {
    const failed = (e: unknown) => {
      play('save-failed')
      toast({ tone: 'error', message: errorMessage(e) })
    }
    const undo = (saved: Promise<string | null>) => ({
      label: 'Undo',
      onClick: () => {
        play('undo')
        saved.then((logId) => (logId ? x.undo(logId) : null)).catch((e) => {
          play('save-failed')
          toast({ tone: 'error', message: errorMessage(e) })
        })
      },
    })
    return {
      status: (inv: { _id: string; name: string }, to: DecisionStatus | null, reason?: string) => {
        play('select')
        const saved = x.setStatus(inv._id, to, reason)
        saved.catch(failed)
        toast({ message: to ? inv.name + ' is ' + STATUS_PHRASE[to] + ' now.' : 'Cleared ' + inv.name + '’s status.', action: undo(saved) })
      },
      decideBy: (inv: { _id: string; name: string }, date: string | null) => {
        x.setDecideBy(inv._id, date).catch(failed)
      },
      /** A Decide row answered. */
      resolve: (inv: { _id: string; name: string }, signalId: string, accept: boolean) => {
        play('save')
        const saved = x.resolve(signalId, accept)
        saved.catch(failed)
        if (accept) toast({ message: 'Done. ' + inv.name + '’s status changed.', action: undo(saved) })
      },
      doneAsk: (signalId: string) => {
        play('save')
        x.doneAsk(signalId).catch(failed)
      },
      failed,
    }
  }, [x, toast])
}

/* ---------- Convex ---------- */

const useConvexLog = (investorId: string | null) => useQuery(api.decisions.log, investorId ? { investorId: investorId as Id<'investors'> } : 'skip')

function ConvexDecisions({ children }: { children: ReactNode }) {
  const data = useQuery(api.decisions.data)
  const setStatus = useMutation(api.decisions.setStatus).withOptimisticUpdate((store, a) => {
    const cur = store.getQuery(api.decisions.data, {})
    if (cur) store.setQuery(api.decisions.data, {}, { ...cur, decisions: cur.decisions.map((d) => (d.investorId === a.investorId ? withStatus(d, a.status ?? undefined, a.reason, Date.now()) : d)) })
  })
  const setDecideBy = useMutation(api.decisions.setDecideBy).withOptimisticUpdate((store, a) => {
    const cur = store.getQuery(api.decisions.data, {})
    if (cur)
      store.setQuery(api.decisions.data, {}, {
        ...cur,
        decisions: cur.decisions.map((d) => {
          if (d.investorId !== a.investorId) return d
          const { decideBy: _b, ...rest } = d
          return { ...rest, decideByManual: true, ...(a.date ? { decideBy: a.date } : {}) }
        }),
      })
  })
  // PST-298: what each logged change replaced, so its Undo shows at once.
  const before = useRef(new Map<string, { prior: Decision; after: DecisionStatus | undefined }>())
  const undo = useMutation(api.decisions.undo).withOptimisticUpdate((store, a) => {
    const b = before.current.get(a.logId)
    if (b) showDecisionBack(store, b.prior, b.after)
  })
  const undoSignal = useMutation(api.decisions.undoSignal).withOptimisticUpdate((store, a) => showUndoSignal(store, a))
  const resolve = useMutation(api.decisions.resolve).withOptimisticUpdate((store, a) => showResolve(store, a))
  const doneAsk = useMutation(api.decisions.doneAsk).withOptimisticUpdate((store, a) => showDoneAsk(store, a))
  const value = useMemo<DecisionsValue>(
    () => ({
      loaded: !!data,
      ...shape(data?.decisions ?? [], data?.signals ?? []),
      setStatus: async (id, status, reason) => {
        const prior = data?.decisions.find((d) => d.investorId === id)
        const logId = await setStatus({ investorId: id as Id<'investors'>, status, ...(reason ? { reason } : {}) })
        if (logId && prior) before.current.set(logId, { prior, after: status ?? undefined })
        return logId
      },
      undo: (logId) => undo({ logId: logId as Id<'decisionLog'> }),
      undoSignal: (signalId) => undoSignal({ signalId: signalId as Id<'signals'> }),
      setDecideBy: (id, date) => setDecideBy({ investorId: id as Id<'investors'>, date }),
      resolve: async (signalId, accept) => {
        const s = data?.signals.find((x) => x._id === signalId)
        const prior = s && data?.decisions.find((d) => d.investorId === s.investorId)
        const logId = await resolve({ signalId: signalId as Id<'signals'>, accept })
        if (logId && prior && s.change) before.current.set(logId, { prior, after: s.change.to })
        return logId
      },
      doneAsk: (signalId) => doneAsk({ signalId: signalId as Id<'signals'> }),
      useLog: useConvexLog,
    }),
    [data, setStatus, undo, undoSignal, setDecideBy, resolve, doneAsk],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/* ---------- preview ---------- */

type Store = { rows: (DecisionFields & { investorId: string })[]; acts: ReturnType<typeof fixtureDecisions>['acts']; signals: SignalView[]; log: PreviewLogEntry[] }

function PreviewDecisions({ state, children }: { state: PreviewSignal | null; children: ReactNode }) {
  const d = useRaise()
  const [store, setStore] = useState<Store | null>(null)
  useEffect(() => {
    if (d.loaded && !store) setStore(fixtureDecisions(d.investors, todayIST(), Date.now(), state))
  }, [d.loaded, d.investors, store, state])
  // &signal=auto: a note arrives a moment after load, and Nest acts on it by itself.
  const arrived = useRef(false)
  useEffect(() => {
    if (state !== 'auto' || !store || arrived.current) return
    arrived.current = true
    const t = setTimeout(() => {
      const s = fixtureAutoSignal(d.investors, todayIST(), Date.now())
      if (!s?.change) return
      setStore((x) => {
        if (!x) return x
        const row = x.rows.find((r) => r.investorId === s.investorId) ?? { investorId: s.investorId }
        const logId = 'pl-auto'
        return {
          ...x,
          rows: [...x.rows.filter((r) => r.investorId !== s.investorId), withStatus(row, s.change!.to, s.change!.reason, s.at)],
          signals: [...x.signals, { ...s, change: { ...s.change!, ...(row.status ? { from: row.status } : {}) }, logId } as SignalView],
          log: [{ _id: logId, investorId: s.investorId, at: s.at, from: row.status, to: s.change!.to, reason: s.change!.reason, auto: true, source: s.source, day: s.day }, ...x.log],
        }
      })
    }, 500)
    return () => clearTimeout(t)
  }, [state, store, d.investors])

  const value = useMemo<DecisionsValue>(() => {
    const now = Date.now()
    const x = store ?? { rows: [], acts: [], signals: [], log: [] }
    const decisions = buildDecisions(d.investors.map((i) => i._id), x.rows, d.google.meetings, [...x.acts, ...d.acts], now)
    const fail = <T,>(): Promise<T> => Promise.reject({ data: 'Preview: writes fail (&fail)' })
    let n = 0
    const change = (investorId: string, to: DecisionStatus | undefined, reason: string | undefined, o: { auto?: boolean; signalId?: string } = {}): string | null => {
      const row = x.rows.find((r) => r.investorId === investorId) ?? { investorId }
      if (row.status === to && row.reason === (to ? reason : undefined)) return null
      const logId = 'pl' + Date.now() + n++
      setStore((s) => s && {
        ...s,
        rows: [...s.rows.filter((r) => r.investorId !== investorId), withStatus(row, to, reason, Date.now())],
        log: [{ _id: logId, investorId, at: Date.now(), from: row.status, to, reason: to ? reason : undefined, by: o.auto ? undefined : 'Dev', auto: !!o.auto }, ...s.log],
      })
      return logId
    }
    const undoLog = (logId: string) => {
      setStore((s) => {
        if (!s) return s
        const l = s.log.find((y) => y._id === logId)
        if (!l || l.undoneAt) return s
        const row = s.rows.find((r) => r.investorId === l.investorId) ?? { investorId: l.investorId }
        return {
          ...s,
          rows: [...s.rows.filter((r) => r.investorId !== l.investorId), withStatus(row, l.from, undefined, Date.now())],
          log: s.log.map((y) => (y._id === logId ? { ...y, undoneAt: Date.now() } : y)),
          signals: s.signals.map((y) => ((y as SignalView & { logId?: string }).logId === logId ? { ...y, undoneAt: Date.now() } : y)),
        }
      })
    }
    const patchSignal = (id: string, p: Partial<SignalView>) => setStore((s) => s && { ...s, signals: s.signals.map((y) => (y._id === id ? { ...y, ...p } : y)) })
    const failing = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fail')
    return {
      loaded: !!store,
      ...shape(decisions, x.signals),
      setStatus: async (id, status, reason) => (failing ? fail() : change(id, status ?? undefined, reason)),
      undo: async (logId) => (failing ? fail() : undoLog(logId)),
      undoSignal: async (signalId) => {
        const s = x.signals.find((y) => y._id === signalId) as (SignalView & { logId?: string }) | undefined
        if (s?.logId) undoLog(s.logId)
      },
      setDecideBy: async (id, date) => {
        if (failing) return fail()
        setStore((s) => {
          if (!s) return s
          const row = s.rows.find((r) => r.investorId === id) ?? { investorId: id }
          return { ...s, rows: [...s.rows.filter((r) => r.investorId !== id), { ...row, decideBy: date ?? undefined, decideByManual: true }] }
        })
      },
      resolve: async (signalId, accept) => {
        if (failing) return fail()
        const s = x.signals.find((y) => y._id === signalId)
        if (!s || s.doneAt) throw { data: 'That one was already decided' }
        const logId = accept && s.change ? change(s.investorId, s.change.to, s.change.reason, { signalId }) : null
        patchSignal(signalId, { doneAt: Date.now() })
        return logId
      },
      doneAsk: async (signalId) => patchSignal(signalId, { askDoneAt: Date.now() }),
      useLog: (id) => (id ? x.log.filter((l) => l.investorId === id) : undefined),
    }
  }, [store, d.investors, d.acts, d.google.meetings])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
