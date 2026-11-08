// PST-296: what Find more reads and writes, and the Jev fit scores Investors ›
// Sort: Priority uses. Convex when signed in; under ?preview an in-memory store over
// made-up investors (src/preview/findMoreFixture.ts) that plays a pretend run.
import { useMutation, useQuery } from 'convex/react'
import { useMemo, useSyncExternalStore } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { findEstimate, roundChips, topPriority, type Found } from '../../lib/findMore'
import { HAIKU, type Model } from '../../lib/models'
import { priorities } from '../../lib/priority'
import { todayIST } from '../../lib/dates'
import type { Wave } from '../../lib/stages'
import { FIXTURE_CANDIDATES, FIXTURE_COMPANIES, PREVIEW_FIND, type PreviewFind } from '../../preview/findMoreFixture'
import { useRaise } from '../data'
import { usePreviewState } from '../preview-state'

export type FindCandidate = Found & { _id: string; score: number; scoredBy: 'jev' | 'nest'; warmPath?: string; status: 'new' | 'suggested' }
export type FindRun = { _id: string; status: 'running' | 'done' | 'failed'; startedAt: number; costUsd: number; error?: string; inactive: number; already: number; found: number; added: number }
export type FindState = {
  /** ANTHROPIC_API_KEY is set on this deployment. */
  connected: boolean
  /** Jev is switched on (else candidates get Nest's own Priority score). */
  jev: boolean
  companies: string[]
  /** The top Priority investors' firms. */
  investors: string[]
  model: Model
  estimateUsd: number
  chips: string[]
  waveLabel: string
  run: FindRun | null
  /** The latest run's candidates still to add, best first. */
  candidates: FindCandidate[]
}
export type FindMore = {
  /** Undefined while loading. */
  state: FindState | undefined
  setCompanies: (companies: string[]) => Promise<unknown>
  start: () => Promise<unknown>
  add: (ids: string[], wave?: Wave) => Promise<{ added: number }>
}

export function useFindMore(): FindMore {
  const preview = usePreviewState()
  const live = useQuery(api.findMore.state, preview ? 'skip' : {})
  const setCompanies = useMutation(api.findMore.setCompanies)
  const start = useMutation(api.findMore.start)
  const add = useMutation(api.findMore.add)
  const fake = usePreviewFind(!!preview)
  return useMemo<FindMore>(
    () =>
      fake ?? {
        state: live,
        setCompanies: (companies) => setCompanies({ companies }),
        start: () => start({}),
        add: (ids, wave) => add({ ids: ids as Id<'findCandidates'>[], ...(wave ? { wave } : {}) }),
      },
    [fake, live, setCompanies, start, add],
  )
}

const NO_SCORES: Record<string, number> = {}
/** Investor id → Jev fit score (Sort: Priority). None under ?preview, so the preview shows the light Fit as before. */
export function usePriorityScores(): Record<string, number> {
  const preview = usePreviewState()
  return useQuery(api.findMore.priorityScores, preview ? 'skip' : {}) ?? NO_SCORES
}

/* ---------- preview: one store per page load ---------- */

type Store = { companies: string[]; run: FindRun | null; candidates: FindCandidate[] }
let store: Store | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const write = (fn: (s: Store) => Store) => {
  store = fn(read())
  listeners.forEach((l) => l())
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** ?preview&find=running|results|empty, read once per page load. */
export function previewFind(): PreviewFind | null {
  const f = new URLSearchParams(location.search).get('find')
  return (PREVIEW_FIND as readonly string[]).includes(f ?? '') ? (f as PreviewFind) : null
}

const run = (status: FindRun['status'], found: number, extra: Partial<FindRun> = {}): FindRun => ({ _id: 'run-' + status, status, startedAt: Date.now() - 40_000, costUsd: status === 'running' ? 0 : 0.071, inactive: 0, already: 0, found, added: 0, ...extra })
const candidates = (): FindCandidate[] => FIXTURE_CANDIDATES.map((c, k) => ({ ...c, _id: 'cand-' + k, scoredBy: 'jev', status: 'new' }))

function read(): Store {
  if (store) return store
  const f = previewFind()
  store = {
    companies: FIXTURE_COMPANIES,
    run: f === 'running' ? run('running', 0) : f === 'results' ? run('done', 8, { inactive: 5, already: 4 }) : f === 'empty' ? run('done', 0, { inactive: 4, already: 6 }) : null,
    candidates: f === 'results' ? candidates() : [],
  }
  return store
}

function usePreviewFind(on: boolean): FindMore | null {
  const d = useRaise()
  const fits = d.useFits()
  const s = useSyncExternalStore(subscribe, read, read)
  return useMemo(() => {
    if (!on) return null
    const prio = priorities(d.investors, fits, todayIST())
    const investors = topPriority(d.investors, prio).map((i) => i.firm.trim() || i.name)
    const state: FindState = {
      connected: true,
      jev: true,
      companies: s.companies,
      investors,
      model: HAIKU,
      estimateUsd: findEstimate(s.companies.length + investors.length, HAIKU).usd,
      chips: roundChips(d.round),
      waveLabel: d.round.waves[1] ?? 'Wave 2',
      run: s.run,
      candidates: s.candidates.filter((c) => c.status === 'new'),
    }
    return {
      state,
      setCompanies: async (companies) => write((x) => ({ ...x, companies })),
      start: async () => {
        write((x) => ({ ...x, run: run('running', 0), candidates: [] }))
        await wait(2400)
        write((x) => ({ ...x, run: run('done', 8, { inactive: 5, already: 4 }), candidates: candidates() }))
      },
      add: async (ids) => {
        await wait(250)
        write((x) => ({ ...x, run: x.run && { ...x.run, added: x.run.added + ids.length }, candidates: x.candidates.map((c) => (ids.includes(c._id) ? { ...c, status: 'suggested' as const } : c)) }))
        return { added: ids.length }
      },
    }
  }, [on, d.investors, d.round, fits, s])
}
