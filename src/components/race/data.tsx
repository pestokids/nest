// PST-295: what Race and the lead read and write: the round's lead, "can lead"
// and "asked to lead" on an investor, and the updates Dev marks sent. Convex when
// signed in (with optimistic updates, so a switch answers at once), an in-memory
// store under ?preview (src/preview/raceFixture.ts).
import type { OptimisticLocalStore } from 'convex/browser'
import { useMutation, useQuery } from 'convex/react'
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Doc, Id } from '../../../convex/_generated/dataModel'
import { todayIST } from '../../lib/dates'
import type { Investor } from '../../lib/pipeline'
import type { LeadFields } from '../../lib/race'
import { previewRaceStart, type PreviewRace } from '../../preview/raceFixture'
import { useRaise } from '../data'
import { showUpdateSent, showUpdateUndone } from '../optimistic-interactions' // PST-298
import { usePreviewState } from '../preview-state'

export type LastUpdate = { id: string; sentOn: string; count: number; by?: string }

export type RaceValue = {
  loaded: boolean
  leadId: string | null
  lastUpdate: LastUpdate | null
  /** The investors with their lead fields as they stand (the preview's in-memory changes laid over). */
  investors: Investor[]
  /** One investor as it stands (the drawer's). */
  withLead: (i: Investor) => Investor
  /** Resolves with the lead it replaced, for Undo. */
  setLead: (investorId: string | null) => Promise<{ before: string | null }>
  setCanLead: (investorId: string, on: boolean) => Promise<unknown>
  setLeadAsked: (investorId: string, on: boolean) => Promise<unknown>
  /** Resolves with the row, for Undo. */
  markUpdateSent: (count: number) => Promise<string>
  undoUpdateSent: (id: string) => Promise<unknown>
}

const RaceContext = createContext<RaceValue | null>(null)
export function useRace(): RaceValue {
  const v = useContext(RaceContext)
  if (!v) throw new Error('useRace outside RaceProvider')
  return v
}

/** Inside the Raise data (ConvexData, or PreviewData under ?preview). */
export function RaceProvider({ children }: { children: ReactNode }) {
  const preview = usePreviewState()
  return preview ? <PreviewRaceProvider state={preview.race ?? null}>{children}</PreviewRaceProvider> : <ConvexRace>{children}</ConvexRace>
}

const same = (i: Investor) => i

function ConvexRace({ children }: { children: ReactNode }) {
  const d = useRaise()
  const q = useQuery(api.race.data)
  const setLead = useMutation(api.race.setLead).withOptimisticUpdate((store, { investorId }) => {
    const cur = store.getQuery(api.race.data, {})
    if (cur) store.setQuery(api.race.data, {}, { ...cur, leadId: investorId })
  })
  const patchInvestor = (store: OptimisticLocalStore, id: string, p: Partial<Doc<'investors'>>) => {
    const list = store.getQuery(api.investors.list, {})
    if (list) store.setQuery(api.investors.list, {}, list.map((i) => (i._id === id ? { ...i, ...p } : i)))
  }
  const setCanLead = useMutation(api.race.setCanLead).withOptimisticUpdate((store, a) => patchInvestor(store, a.investorId, { leadOverride: a.on, lead: a.on }))
  const setLeadAsked = useMutation(api.race.setLeadAsked).withOptimisticUpdate((store, a) => patchInvestor(store, a.investorId, { leadAskedOn: a.on ? todayIST() : undefined }))
  // PST-298: Mark sent and its Undo show at once; Undo puts back the update before it.
  const prevUpdate = useRef<NonNullable<typeof q>['lastUpdate']>(null)
  const markSent = useMutation(api.race.markUpdateSent).withOptimisticUpdate((store, a) => showUpdateSent(store, a, todayIST()))
  const undoSent = useMutation(api.race.undoUpdateSent).withOptimisticUpdate((store, a) => showUpdateUndone(store, a, prevUpdate.current))
  const value = useMemo<RaceValue>(
    () => ({
      loaded: !!q,
      leadId: q?.leadId ?? null,
      lastUpdate: q?.lastUpdate ? { id: q.lastUpdate._id, sentOn: q.lastUpdate.sentOn, count: q.lastUpdate.count, by: q.lastUpdate.by } : null,
      investors: d.investors,
      withLead: same,
      setLead: (id) => setLead({ investorId: id as Id<'investors'> | null }),
      setCanLead: (id, on) => setCanLead({ investorId: id as Id<'investors'>, on }),
      setLeadAsked: (id, on) => setLeadAsked({ investorId: id as Id<'investors'>, on }),
      markUpdateSent: (count) => {
        prevUpdate.current = q?.lastUpdate ?? null
        return markSent({ count })
      },
      undoUpdateSent: (id) => undoSent({ id: id as Id<'investorUpdates'> }),
    }),
    [q, d.investors, setLead, setCanLead, setLeadAsked, markSent, undoSent],
  )
  return <RaceContext.Provider value={value}>{children}</RaceContext.Provider>
}

/* ---------- preview: one store per page load ---------- */

type Store = { leadId: string | null; updates: LastUpdate[]; patches: Record<string, Partial<LeadFields & { lead: boolean }>> }
let store: Store | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const EMPTY: Store = { leadId: null, updates: [], patches: {} }
const read = () => store ?? EMPTY
const write = (fn: (s: Store) => Store) => {
  store = fn(read())
  listeners.forEach((l) => l())
}

function PreviewRaceProvider({ state, children }: { state: PreviewRace | null; children: ReactNode }) {
  const d = useRaise()
  useEffect(() => {
    if (!store && d.loaded) write(() => previewRaceStart(state, d.investors, todayIST()))
  }, [state, d.loaded, d.investors])
  const s = useSyncExternalStore(subscribe, read, read)
  const value = useMemo<RaceValue>(() => {
    const withLead = (i: Investor) => (s.patches[i._id] ? { ...i, ...s.patches[i._id] } : i)
    const patch = (id: string, p: Partial<LeadFields & { lead: boolean }>) => write((x) => ({ ...x, patches: { ...x.patches, [id]: { ...x.patches[id], ...p } } }))
    return {
      loaded: d.loaded,
      leadId: s.leadId,
      lastUpdate: s.updates[0] ?? null,
      investors: d.investors.map(withLead),
      withLead,
      setLead: async (id) => {
        const before = read().leadId
        write((x) => ({ ...x, leadId: id }))
        return { before }
      },
      setCanLead: async (id, on) => patch(id, { leadOverride: on, lead: on }),
      setLeadAsked: async (id, on) => patch(id, { leadAskedOn: on ? todayIST() : undefined }),
      markUpdateSent: async (count) => {
        const id = `pu${Date.now()}`
        write((x) => ({ ...x, updates: [{ id, sentOn: todayIST(), count, by: 'Dev' }, ...x.updates] }))
        return id
      },
      undoUpdateSent: async (id) => write((x) => ({ ...x, updates: x.updates.filter((u) => u.id !== id) })),
    }
  }, [s, d.loaded, d.investors])
  return <RaceContext.Provider value={value}>{children}</RaceContext.Provider>
}
