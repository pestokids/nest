// PST-283: what the Close tab and the Settings cap table card read and write.
// Its own provider, so the shared Raise data layer stays as it is: Convex when
// signed in, an in-memory store over the preview fixture under ?preview.
import { useMutation, useQuery } from 'convex/react'
import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { cleanCapTable, cleanTerms, planTick, setStep, checkTick, validateCapTable, validateTerms, type CapTable, type Closing, type ClosingTerms, type StepKey } from '../../lib/close'
import { todayIST } from '../../lib/dates'
import { fieldsOf } from '../../lib/pipeline'
import { COMMIT, type Stage } from '../../lib/stages'
import { closePreview, fixtureCloseStore } from '../../preview/closeFixture'
import { useRaise } from '../data'
import { usePreviewState } from '../preview-state'

export type TickResult = { to: Stage | null; firstMoney: boolean }

export type CloseData = {
  loaded: boolean
  closings: Closing[]
  /** Null until someone fills in Settings › Round › Cap table. */
  capTable: CapTable | null
  /** Create or update a record (every term, links included). `sentAt` also ticks "SAFE sent". Resolves with its id. */
  save: (investorId: string, terms: ClosingTerms, sentAt?: string) => Promise<string>
  /** Tick, re-date or (with null) untick a step; signed and wired move the pipeline stage. */
  tick: (id: string, key: StepKey, at: string | null) => Promise<TickResult>
  remove: (id: string) => Promise<unknown>
  /** Resolves with 1 when it changed, 0 when nothing had. */
  setCapTable: (c: CapTable | null) => Promise<number>
}

const CloseContext = createContext<CloseData | null>(null)

export function useClose(): CloseData {
  const v = useContext(CloseContext)
  if (!v) throw new Error('useClose outside CloseProvider')
  return v
}

/** Wrap anything that reads closings or the cap table. */
export function CloseProvider({ children }: { children: ReactNode }) {
  return usePreviewState() ? <PreviewClose>{children}</PreviewClose> : <ConvexClose>{children}</ConvexClose>
}

function ConvexClose({ children }: { children: ReactNode }) {
  const data = useQuery(api.closings.data)
  const save = useMutation(api.closings.save)
  const tick = useMutation(api.closings.tick)
  const remove = useMutation(api.closings.remove)
  const setCapTable = useMutation(api.closings.setCapTable)
  const value = useMemo<CloseData>(
    () => ({
      loaded: !!data,
      closings: data?.closings ?? [],
      capTable: data?.capTable ?? null,
      save: (investorId, terms, sentAt) => save({ investorId: investorId as Id<'investors'>, terms, sentAt }),
      tick: (id, key, at) => tick({ id: id as Id<'closings'>, key, at }),
      remove: (id) => remove({ id: id as Id<'closings'> }),
      setCapTable: (capTable) => setCapTable({ capTable }),
    }),
    [data, save, tick, remove, setCapTable],
  )
  return <CloseContext.Provider value={value}>{children}</CloseContext.Provider>
}

/* ---------- preview: one store per page load, so ticks survive moving between views ---------- */

type Store = { closings: Closing[]; capTable: CapTable | null }
let store: Store | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const read = () => (store ??= fixtureCloseStore(todayIST(), closePreview() ?? 'empty'))
const write = (fn: (s: Store) => Store) => {
  store = fn(read())
  listeners.forEach((l) => l())
}
/** Rejects the way a Convex field-error does, so the dialogs show the messages. */
const fieldErrors = (errors: Record<string, string>) => {
  if (Object.keys(errors).length) throw { data: { message: 'Fix the highlighted fields', errors } }
}

function PreviewClose({ children }: { children: ReactNode }) {
  const d = useRaise()
  const snap = useSyncExternalStore(subscribe, read, read)
  const value = useMemo<CloseData>(() => {
    const today = todayIST()
    const investor = (id: string) => {
      const i = d.investors.find((x) => x._id === id)
      if (!i) throw { data: 'That investor was deleted' }
      return i
    }
    return {
      loaded: true,
      closings: snap.closings.filter((c) => d.investors.some((i) => i._id === c.investorId)),
      capTable: snap.capTable,
      save: async (investorId, terms, sentAt) => {
        const inv = investor(investorId)
        const body = cleanTerms(terms)
        fieldErrors(validateTerms(body))
        const prev = read().closings.find((c) => c.investorId === investorId)
        if (!prev && !COMMIT.has(inv.stage)) throw { data: `Move ${inv.name} to Verbal first. Closing records start at a verbal yes.` }
        let steps = prev?.steps ?? []
        if (sentAt) {
          const err = checkTick(steps, 'sent', sentAt, today)
          if (err) fieldErrors({ sentAt: err })
          steps = setStep(steps, 'sent', sentAt)
        }
        if (inv.committed !== body.amount) await d.save(inv._id, { ...fieldsOf(inv), committed: body.amount })
        const id = prev?._id ?? 'pc' + Date.now().toString(36)
        write((s) => ({ ...s, closings: [...s.closings.filter((c) => c._id !== id), { ...body, _id: id, investorId, steps }] }))
        return id
      },
      tick: async (id, key, at) => {
        const c = read().closings.find((x) => x._id === id)
        if (!c) throw { data: 'That closing record was removed' }
        const inv = investor(c.investorId)
        const plan = planTick(c, inv.stage, key, at, today)
        if ('error' in plan) throw { data: plan.error }
        write((s) => ({ ...s, closings: s.closings.map((x) => (x._id === id ? { ...x, steps: plan.steps } : x)) }))
        if (plan.to) await d.move(inv._id, plan.to)
        return { to: plan.to, firstMoney: plan.to === 'wired' && inv.maxStage !== 'wired' }
      },
      remove: async (id) => write((s) => ({ ...s, closings: s.closings.filter((c) => c._id !== id) })),
      setCapTable: async (capTable) => {
        const next = capTable ? cleanCapTable(capTable) : null
        if (next) fieldErrors(validateCapTable(next))
        const changed = JSON.stringify(read().capTable) !== JSON.stringify(next)
        write((s) => ({ ...s, capTable: next }))
        return changed ? 1 : 0
      },
    }
  }, [snap, d])
  return <CloseContext.Provider value={value}>{children}</CloseContext.Provider>
}
