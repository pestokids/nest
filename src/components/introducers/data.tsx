// PST-294: what Introducers read and write. Convex when signed in, an in-memory
// store over made-up people under ?preview (src/preview/introducersFixture.ts).
// The old free-text warm paths become people the first time the Introducers
// view or a drawer with one loads (useMigrate); committed investors are
// introducers too, derived from the list.
// PST-305: Network. 'portfolio' rows become founders on first load (the list says
// when some are left); touched fields, roles, investors a person can introduce,
// Wants to invest, the CSV import and a founder's lookup (src/preview/networkFixture.ts).
import { useMutation, useQuery } from 'convex/react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { todayIST } from '../../lib/dates'
import { isEmail } from '../../lib/drafts'
import { normEmail } from '../../lib/google'
import {
  migrationPlan, needsMigration, normName, setStep, warmPathFor, type Intro, type IntroInvestor, type Introducer, type Person, type Step, type WarmPath,
} from '../../lib/introducers'
import { fieldsOf, type Investor } from '../../lib/pipeline'
import { previewIntroducers } from '../../preview/introducersFixture'
// PST-305
import type { Model } from '../../lib/models'
import { angelFields, cleanDomain, markInNest, matchInvestor, sameInvestor, targetFields, type LookupResult, type NewTarget, type PersonImport, type PersonPatch, type PickRelation } from '../../lib/network'
import { PREVIEW_LOOKUP_DELAY, previewLookupResults, previewNetwork } from '../../preview/networkFixture'
import { useDecisions } from '../decisions/data'
import { useRaise } from '../data'
import { usePreviewState } from '../preview-state'
import { showIntroducer, showIntroducerEdit, showLink, showNudged } from '../optimistic-interactions' // PST-298

export type IntroducerFields = { name: string; email?: string; relation: PickRelation; notes: string; /** PST-305 */ company?: string; companyDomain?: string }

/* ---------- PST-305 ---------- */
/** Investors from the list, and new firms, a person can introduce Dev to. */
export type Targets = { investorIds: string[]; fresh: NewTarget[] }
export type LookupRun = { _id: string; status: 'running' | 'done' | 'failed'; company: string; startedAt: number; costUsd: number; error?: string; results: LookupResult[] }
export type LookupState = { connected: boolean; model: Model; estimateUsd: number; run: LookupRun | null }
/** Wants to invest: the investor made or linked; or one already in Nest to offer (nothing changed yet). */
export type WantsResult = { investorId?: string; created?: boolean; offer?: string }
/* ---------- end PST-305 ---------- */

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
  /* ---------- PST-305 ---------- */
  /** Only the fields Dev touched. */
  updatePerson: (id: string, patch: PersonPatch) => Promise<unknown>
  setRoles: (id: string, roles: { canIntro?: boolean; givesAdvice?: boolean }) => Promise<unknown>
  /** Each investor gets an intro "to ask" from this person; new firms are added as Not contacted, source Network, "via <name>". */
  addTargets: (who: Pick<Person, 'introducerId' | 'investorId'>, t: Targets) => Promise<{ linked: number; created: number; introIds: string[] }>
  setWantsToInvest: (id: string, on: boolean, o?: { linkTo?: string; create?: boolean }) => Promise<WantsResult>
  importPeople: (rows: PersonImport[]) => Promise<{ added: number; skipped: number; ids: string[] }>
  /** A founder's latest lookup and the estimate. A hook; undefined while loading. */
  useLookup: (introducerId: string | null) => LookupState | undefined
  startLookup: (introducerId: string) => Promise<string>
  /** Only the results Dev ticked (by index). */
  addFromLookup: (lookupId: string, picks: number[]) => Promise<{ linked: number; created: number; added: number }>
  /* ---------- end PST-305 ---------- */
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

const useConvexLookup = (introducerId: string | null) => useQuery(api.network.lookupState, introducerId ? { introducerId: introducerId as Id<'introducers'> } : 'skip') as LookupState | undefined
const whoArgs = (p: Pick<Person, 'introducerId' | 'investorId'>) => (p.introducerId ? { introducerId: p.introducerId as Id<'introducers'> } : { viaInvestorId: p.investorId as Id<'investors'> })

function ConvexIntroducers({ children }: { children: ReactNode }) {
  const data = useQuery(api.introducers.list)
  const migrate = useMutation(api.introducers.migrate)
  // PST-305
  const migrateRelations = useMutation(api.network.migrateRelations)
  const updatePerson = useMutation(api.network.updatePerson)
  const setRoles = useMutation(api.network.setRoles)
  const addTargets = useMutation(api.network.addTargets)
  const setWants = useMutation(api.network.setWantsToInvest)
  const importPeople = useMutation(api.network.importPeople)
  const startLookup = useMutation(api.network.startLookup)
  const addFromLookup = useMutation(api.network.addFromLookup)
  const legacy = !!data?.legacy
  const migratedRelations = useRef(false)
  useEffect(() => {
    if (!legacy || migratedRelations.current) return
    migratedRelations.current = true
    migrateRelations({}).catch(() => {})
  }, [legacy, migrateRelations])
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
      // PST-305
      updatePerson: (id, patch) => updatePerson({ id: id as Id<'introducers'>, patch }),
      setRoles: (id, roles) => setRoles({ id: id as Id<'introducers'>, roles }),
      addTargets: (who, t) => addTargets({ ...whoArgs(who), investorIds: t.investorIds as Id<'investors'>[], fresh: t.fresh }),
      setWantsToInvest: (id, on, o) => setWants({ id: id as Id<'introducers'>, on, ...(o?.linkTo ? { linkTo: o.linkTo as Id<'investors'> } : {}), ...(o?.create ? { create: true } : {}) }),
      importPeople: (rows) => importPeople({ rows }),
      useLookup: useConvexLookup,
      startLookup: (introducerId) => startLookup({ introducerId: introducerId as Id<'introducers'> }),
      addFromLookup: (lookupId, picks) => addFromLookup({ lookupId: lookupId as Id<'founderLookups'>, picks }),
    }),
    [data, migrate, add, update, link, setStepDay, nudged, updatePerson, setRoles, addTargets, setWants, importPeople, startLookup, addFromLookup],
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

/* ---------- PST-305: preview lookups, one per founder ---------- */

let lookups: Record<string, LookupRun> = {}
const lookupListeners = new Set<() => void>()
const subscribeLookups = (l: () => void) => {
  lookupListeners.add(l)
  return () => {
    lookupListeners.delete(l)
  }
}
const readLookups = () => lookups
const writeLookups = (fn: (s: Record<string, LookupRun>) => Record<string, LookupRun>) => {
  lookups = fn(lookups)
  lookupListeners.forEach((l) => l())
}
const PREVIEW_ESTIMATE = 0.031
function usePreviewLookup(introducerId: string | null): LookupState | undefined {
  const all = useSyncExternalStore(subscribeLookups, readLookups, readLookups)
  const connected = useRaise().ai.connected
  if (!introducerId) return undefined
  return { connected, model: 'claude-haiku-5-5', estimateUsd: PREVIEW_ESTIMATE, run: all[introducerId] ?? null }
}
/* ---------- end PST-305 ---------- */

function PreviewIntroducers({ children }: { children: ReactNode }) {
  const d = useRaise()
  const preview = usePreviewState() // PST-305
  const s = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    if (store !== null || !d.loaded) return
    const base = previewIntroducers(d.investors, todayIST())
    const net = previewNetwork(d.investors, base.introducers, Date.now()) // PST-305
    write(() => ({ introducers: net.introducers, intros: [...base.intros, ...net.intros] }))
  }, [d.loaded]) // eslint-disable-line react-hooks/exhaustive-deps


  const value = useMemo<IntroducersValue>(() => {
    const valid = (f: IntroducerFields) => {
      if (!normName(f.name)) return 'Add their name.'
      if (f.email?.trim() && !isEmail(f.email)) return 'That email doesn’t look right.'
      return ''
    }
    const tidy = (f: IntroducerFields) => ({
      name: f.name.trim().replace(/\s+/g, ' '), email: normEmail(f.email) || undefined, relation: f.relation, notes: f.notes.trim(),
      ...(f.company?.trim() ? { company: f.company.trim() } : {}), ...(cleanDomain(f.companyDomain) ? { companyDomain: cleanDomain(f.companyDomain) } : {}), // PST-305
    })
    // PST-305: as convex/network.ts addTargetsFor does it, over the preview's investors.
    const previewTargets = async (who: Pick<Person, 'introducerId' | 'investorId'>, t: Targets) => {
      const name = who.introducerId ? read().introducers.find((p) => p._id === who.introducerId)?.name : d.investors.find((i) => i._id === who.investorId)?.name
      if (!name) return reject('That person was deleted')
      const via = 'via ' + name
      const all = [...d.investors]
      const introIds: string[] = []
      let linked = 0
      let created = 0
      const link = (investorId: string, fromPath?: string) => {
        const there = read().intros.find((x) => x.investorId === investorId && (who.introducerId ? x.introducerId === who.introducerId : x.viaInvestorId === who.investorId))
        if (there) return introIds.push(there._id) && false
        const id = newId('pn')
        write((cur) => ({ ...cur, intros: [...cur.intros, { _id: id, investorId, ...(who.introducerId ? { introducerId: who.introducerId } : { viaInvestorId: who.investorId }), steps: {}, ...(fromPath ? { fromPath } : {}), createdAt: Date.now() }] }))
        introIds.push(id)
        return true
      }
      const linkExisting = async (inv: Investor) => {
        if (inv._id === who.investorId) return
        const empty = !inv.path.trim()
        if (empty) await d.save(inv._id, { ...fieldsOf(inv), path: via })
        if (link(inv._id, empty ? via.toLowerCase() : undefined)) linked++
      }
      for (const id of t.investorIds) {
        const inv = all.find((i) => i._id === id)
        if (inv) await linkExisting(inv)
      }
      for (const f of t.fresh) {
        if (!f.firm.trim()) continue
        const there = matchInvestor(f, all)
        if (there) {
          await linkExisting(there)
          continue
        }
        const fields = targetFields(f, name)
        const id = await d.save(null, fields)
        all.push({ ...fields, _id: id, maxStage: 'todo' })
        link(id, fields.path.toLowerCase())
        created++
      }
      return { linked, created, introIds }
    }
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
      // PST-305
      updatePerson: async (id, patch) => {
        if (patch.name !== undefined && !normName(patch.name)) return reject('Add their name.')
        if (patch.email && !isEmail(patch.email)) return reject('That email doesn’t look right.')
        if (patch.name !== undefined && read().introducers.some((p) => p._id !== id && normName(p.name) === normName(patch.name!))) return reject(patch.name.trim() + ' is already in your Network.')
        const set = { ...patch, ...(patch.email !== undefined ? { email: normEmail(patch.email) || undefined } : {}), ...(patch.company !== undefined ? { company: patch.company || undefined } : {}), ...(patch.companyDomain !== undefined ? { companyDomain: cleanDomain(patch.companyDomain) || undefined } : {}) }
        write((cur) => ({ ...cur, introducers: cur.introducers.map((p) => (p._id === id ? { ...p, ...set } : p)) }))
      },
      setRoles: async (id, roles) => write((cur) => ({ ...cur, introducers: cur.introducers.map((p) => (p._id === id ? { ...p, roles: { ...p.roles, ...roles } } : p)) })),
      addTargets: (who, t) => previewTargets(who, t),
      setWantsToInvest: async (id, on, o) => {
        const p = read().introducers.find((x) => x._id === id)
        if (!p) return reject('That person was deleted')
        const setP = (investorId: string | undefined, wants: boolean) => write((cur) => ({ ...cur, introducers: cur.introducers.map((x) => (x._id === id ? { ...x, investorId, roles: { ...x.roles, wantsToInvest: wants } } : x)) }))
        if (!on) {
          setP(undefined, false)
          return { investorId: p.investorId }
        }
        if (p.investorId && d.investors.some((i) => i._id === p.investorId) && !o?.linkTo) {
          setP(p.investorId, true)
          return { investorId: p.investorId, created: false }
        }
        if (o?.linkTo) {
          const other = read().introducers.find((x) => x._id !== id && x.investorId === o.linkTo)
          if (other) return reject('That investor is already linked to ' + other.name + '.')
          setP(o.linkTo, true)
          return { investorId: o.linkTo, created: false }
        }
        const linked = new Set(read().introducers.flatMap((x) => (x.investorId && x._id !== id ? [x.investorId] : [])))
        const same = sameInvestor(p, d.investors.filter((i) => !linked.has(i._id)))
        if (same && !o?.create) return { offer: same._id }
        const investorId = await d.save(null, angelFields(p))
        setP(investorId, true)
        return { investorId, created: true }
      },
      importPeople: async (rows) => {
        const ids: string[] = []
        for (const r of rows) {
          const cur = read().introducers
          if (!normName(r.name) || cur.some((p) => normName(p.name) === normName(r.name) || (!!r.email && normEmail(p.email) === normEmail(r.email)))) continue
          const id = newId('pi')
          write((c) => ({ ...c, introducers: [...c.introducers, { _id: id, name: r.name.trim(), ...(r.email ? { email: normEmail(r.email) } : {}), relation: r.relation, notes: r.notes.trim(), ...(r.company ? { company: r.company } : {}), createdAt: Date.now() }] }))
          ids.push(id)
        }
        return { added: ids.length, skipped: rows.length - ids.length, ids }
      },
      useLookup: usePreviewLookup,
      startLookup: async (introducerId) => {
        const p = read().introducers.find((x) => x._id === introducerId)
        if (!p?.company) return reject('Add their company first.')
        const run: LookupRun = { _id: 'pl' + introducerId, status: 'running', company: p.company, startedAt: Date.now(), costUsd: 0, results: [] }
        writeLookups((all) => ({ ...all, [introducerId]: run }))
        // &network=lookup: the results show almost at once (for the screenshot); otherwise a pretend search.
        setTimeout(() => writeLookups((all) => ({ ...all, [introducerId]: { ...run, status: 'done', costUsd: 0.027, results: markInNest(previewLookupResults(p.company!), d.investors) } })), preview?.network === 'lookup' ? 200 : PREVIEW_LOOKUP_DELAY)
        return run._id
      },
      addFromLookup: async (lookupId, picks) => {
        const [key, run] = Object.entries(readLookups()).find(([, r]) => r._id === lookupId) ?? []
        if (!key || !run || run.status !== 'done') return reject('That lookup isn’t finished.')
        const want = [...new Set(picks)].filter((k) => k >= 0 && k < run.results.length && !run.results[k].added)
        const existing = want.flatMap((k) => (run.results[k].investorId && d.investors.some((i) => i._id === run.results[k].investorId) ? [run.results[k].investorId!] : []))
        const fresh = want.filter((k) => !existing.includes(run.results[k].investorId ?? '')).map((k) => run.results[k])
        const out = await previewTargets({ introducerId: key }, { investorIds: existing, fresh })
        writeLookups((all) => ({ ...all, [key]: { ...run, results: run.results.map((r, k) => (want.includes(k) ? { ...r, added: true } : r)) } }))
        return { linked: out.linked, created: out.created, added: want.length }
      },
    }
  }, [s, d, preview?.network])
  return <IntroducersContext.Provider value={value}>{children}</IntroducersContext.Provider>
}
