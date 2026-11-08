// PST-294: what Introducers read and write. Convex when signed in, an in-memory
// store over made-up people under ?preview (src/preview/introducersFixture.ts).
// The old free-text warm paths become people the first time the Introducers
// view or a drawer with one loads (useMigrate); committed investors are
// introducers too, derived from the list.
import { useMutation, useQuery } from 'convex/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { todayIST } from '../../lib/dates'
import { isEmail } from '../../lib/drafts'
import { normEmail } from '../../lib/google'
import {
  migrationPlan, needsMigration, normName, setStep, warmPathFor, type Intro, type IntroInvestor, type Introducer, type Person, type Relation, type Step, type WarmPath,
} from '../../lib/introducers'
import type { Investor } from '../../lib/pipeline'
import { previewIntroducers } from '../../preview/introducersFixture'
import { useDecisions } from '../decisions/data'
import { useRaise } from '../data'
import { usePreviewState } from '../preview-state'
import { showIntroducer, showIntroducerEdit, showLink, showNudged } from '../optimistic-interactions' // PST-298

export type IntroducerFields = { name: string; email?: string; relation: Exclude<Relation, 'committed'>; notes: string }

export type IntroducersValue = {
  loaded: boolean
  introducers: Introducer[]
  intros: Intro[]
  /** Turn every warm path not linked yet into people and intros (idempotent). */
  migrate: () => Promise<unknown>
  add: (f: IntroducerFields) => Promise<{ id: string; existed: boolean }>
  update: (id: string, f: IntroducerFields) => Promise<unknown>
  /** The intro from this person to an investor: the one there is, else a new one. Resolves with its id. */
  link: (investorId: string, person: Pick<Person, 'introducerId' | 'investorId'>) => Promise<string>
  /** Tick a step on a day, or untick it (null). Shows at once. */
  setStep: (introId: string, step: Step, day: string | null) => Promise<unknown>
  nudged: (introId: string) => Promise<unknown>
}

const IntroducersContext = createContext<IntroducersValue | null>(null)
export function useIntroducers(): IntroducersValue {
  const v = useContext(IntroducersContext)
  if (!v) throw new Error('useIntroducers outside IntroducersProvider')
  return v
}

/** PST-296 and the rest: the best warm path to an investor (in the list or a Find more result), or null. */
export function useWarmPathFor(): (investor: { _id?: string; name: string; firm?: string; domains?: readonly string[] }) => WarmPath | null {
  const { introducers, intros } = useIntroducers()
  const { investors } = useRaise()
  return useCallback((investor) => warmPathFor(investor, { introducers, intros, investors }), [introducers, intros, investors])
}

/** The list with each investor's PST-293 decision, so a Yes or No there counts as deciding (report back). Inside DecisionsProvider. */
export function useIntroInvestors(): IntroInvestor[] {
  const { investors } = useRaise()
  const { decisionOf } = useDecisions()
  return useMemo(() => investors.map((i) => ({ ...i, decision: decisionOf(i._id).status })), [investors, decisionOf])
}

/** Warm paths already tried this page load, so a failing migration isn't retried in a loop. */
const tried = new Set<string>()

/** Run the migration once the data is in and some investor (or this one) has a warm path not linked yet. */
export function useMigrate(only?: Investor) {
  const x = useIntroducers()
  const { investors, loaded } = useRaise()
  const pending = useMemo(() => (x.loaded && loaded ? (only ? [only] : investors).filter((i) => needsMigration(i, x.intros)) : []), [x.loaded, x.intros, loaded, investors, only])
  const sig = pending.map((i) => i._id + ':' + i.path).join('|')
  const migrate = useRef(x.migrate)
  useEffect(() => {
    migrate.current = x.migrate
  })
  useEffect(() => {
    if (!sig || tried.has(sig)) return
    tried.add(sig)
    migrate.current().catch(() => {})
  }, [sig])
}

export function IntroducersProvider({ children }: { children: ReactNode }) {
  return usePreviewState() ? <PreviewIntroducers>{children}</PreviewIntroducers> : <ConvexIntroducers>{children}</ConvexIntroducers>
}

const NONE = { introducers: [] as Introducer[], intros: [] as Intro[] }

function ConvexIntroducers({ children }: { children: ReactNode }) {
  const data = useQuery(api.introducers.list)
  const migrate = useMutation(api.introducers.migrate)
  const add = useMutation(api.introducers.add).withOptimisticUpdate((store, f) => showIntroducer(store, f))
  const update = useMutation(api.introducers.update).withOptimisticUpdate((store, a) => showIntroducerEdit(store, a))
  const link = useMutation(api.introducers.link).withOptimisticUpdate((store, a) => showLink(store, a))
  const nudged = useMutation(api.introducers.nudged).withOptimisticUpdate((store, a) => showNudged(store, a, todayIST()))
  const setStepDay = useMutation(api.introducers.setStepDay).withOptimisticUpdate((store, a) => {
    const cur = store.getQuery(api.introducers.list, {})
    if (cur) store.setQuery(api.introducers.list, {}, { ...cur, intros: cur.intros.map((x) => (x._id === a.introId ? { ...x, steps: setStep(x.steps, a.step, a.day) } : x)) })
  })
  const value = useMemo<IntroducersValue>(
    () => ({
      loaded: !!data,
      ...(data ?? NONE),
      migrate: () => migrate({}),
      add: (f) => add(f),
      update: (id, f) => update({ id: id as Id<'introducers'>, ...f }),
      link: (investorId, p) =>
        link({ investorId: investorId as Id<'investors'>, ...(p.introducerId ? { introducerId: p.introducerId as Id<'introducers'> } : { viaInvestorId: p.investorId as Id<'investors'> }) }),
      setStep: (introId, step, day) => setStepDay({ introId: introId as Id<'intros'>, step, day }),
      nudged: (introId) => nudged({ introId: introId as Id<'intros'> }),
    }),
    [data, migrate, add, update, link, setStepDay, nudged],
  )
  return <IntroducersContext.Provider value={value}>{children}</IntroducersContext.Provider>
}

/* ---------- preview: one store per page load ---------- */

let store: { introducers: Introducer[]; intros: Intro[] } | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const read = () => store ?? NONE
const write = (fn: (s: { introducers: Introducer[]; intros: Intro[] }) => { introducers: Introducer[]; intros: Intro[] }) => {
  store = fn(read())
  listeners.forEach((l) => l())
}
const reject = (message: string) => Promise.reject({ data: message })
let n = 0
const newId = (p: string) => p + Date.now().toString(36) + n++

function PreviewIntroducers({ children }: { children: ReactNode }) {
  const d = useRaise()
  const s = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    if (store === null && d.loaded) write(() => previewIntroducers(d.investors, todayIST()))
  }, [d.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<IntroducersValue>(() => {
    const valid = (f: IntroducerFields) => {
      if (!normName(f.name)) return 'Add their name.'
      if (f.email?.trim() && !isEmail(f.email)) return 'That email doesn’t look right.'
      return ''
    }
    const tidy = (f: IntroducerFields) => ({ name: f.name.trim().replace(/\s+/g, ' '), email: normEmail(f.email) || undefined, relation: f.relation, notes: f.notes.trim() })
    return {
      loaded: store !== null,
      ...s,
      migrate: async () => {
        const plan = migrationPlan(d.investors, read().introducers, read().intros)
        if (!plan.link.length) return
        const now = Date.now()
        const made = new Map(plan.create.map((c) => [c.key, newId('pi')]))
        write((cur) => ({
          introducers: [...cur.introducers, ...plan.create.map((c) => ({ _id: made.get(c.key)!, name: c.name, relation: c.relation, notes: c.notes, createdAt: now }))],
          intros: [
            ...cur.intros.map((x) => {
              const l = plan.link.find((y) => y.existing === x._id)
              return l ? { ...x, fromPath: l.fromPath } : x
            }),
            ...plan.link.filter((l) => !l.existing).map((l) => ({ _id: newId('pn'), investorId: l.investorId, introducerId: made.get(l.introducer) ?? l.introducer, steps: {}, fromPath: l.fromPath, createdAt: now })),
          ],
        }))
      },
      add: async (f) => {
        const bad = valid(f)
        if (bad) return reject(bad)
        const same = read().introducers.find((p) => normName(p.name) === normName(f.name))
        if (same) return { id: same._id, existed: true }
        const id = newId('pi')
        write((cur) => ({ ...cur, introducers: [...cur.introducers, { _id: id, ...tidy(f), createdAt: Date.now() }] }))
        return { id, existed: false }
      },
      update: async (id, f) => {
        const bad = valid(f)
        if (bad) return reject(bad)
        if (read().introducers.some((p) => p._id !== id && normName(p.name) === normName(f.name))) return reject(f.name.trim() + ' is already an introducer.')
        write((cur) => ({ ...cur, introducers: cur.introducers.map((p) => (p._id === id ? { ...p, ...tidy(f) } : p)) }))
      },
      link: async (investorId, p) => {
        const there = read().intros.find((x) => x.investorId === investorId && (p.introducerId ? x.introducerId === p.introducerId : x.viaInvestorId === p.investorId))
        if (there) return there._id
        const id = newId('pn')
        write((cur) => ({ ...cur, intros: [...cur.intros, { _id: id, investorId, ...(p.introducerId ? { introducerId: p.introducerId } : { viaInvestorId: p.investorId }), steps: {}, createdAt: Date.now() }] }))
        return id
      },
      setStep: async (introId, step, day) => write((cur) => ({ ...cur, intros: cur.intros.map((x) => (x._id === introId ? { ...x, steps: setStep(x.steps, step, day) } : x)) })),
      nudged: async (introId) => write((cur) => ({ ...cur, intros: cur.intros.map((x) => (x._id === introId ? { ...x, nudgedAt: todayIST() } : x)) })),
    }
  }, [s, d.investors])
  return <IntroducersContext.Provider value={value}>{children}</IntroducersContext.Provider>
}
