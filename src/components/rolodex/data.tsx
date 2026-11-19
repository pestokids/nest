// Rolodex: what its two views read. Convex when signed in (people and investors stream
// in a page at a time until everyone's loaded), the made-up fixture under ?preview
// (src/preview/rolodexFixture.ts). Read-only: the import is the only writer.
import { usePaginatedQuery, useQuery } from 'convex/react'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  investorListRow, listRow, type RolodexCompany, type RolodexFirm, type RolodexInvestor, type RolodexInvestorFull, type RolodexMeta,
  type RolodexPerson, type RolodexPersonFull,
} from '../../lib/rolodex'
import { previewRolodex } from '../../preview/rolodexFixture'
import { usePreviewState } from '../preview-state'

export type RolodexValue = {
  /** The first page of people (and the firms) are in. */
  loaded: boolean
  /** Totals from the last import; null before the first one. */
  meta: RolodexMeta | null | undefined
  people: RolodexPerson[]
  /** Every page is in. */
  peopleDone: boolean
  /** The investor firms our people work at (a person's panel). */
  firms: RolodexFirm[]
  /** Everyone who backed a company of ours, most founders first. */
  investors: RolodexInvestor[]
  investorsDone: boolean
  /** One person, everything kept (the panel). A hook; undefined while loading, null if gone. */
  usePerson: (id: string | null) => RolodexPersonFull | null | undefined
  /** One investor with the companies they backed (the panel). A hook. */
  useInvestor: (key: string | null) => RolodexInvestorFull | null | undefined
  /** Companies by key, with their investors (a person's panel). A hook; undefined while loading. */
  useCompanies: (keys: string[] | undefined) => RolodexCompany[] | undefined
}

const Ctx = createContext<RolodexValue | null>(null)
export function useRolodex(): RolodexValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useRolodex outside RolodexProvider')
  return v
}

export function RolodexProvider({ children }: { children: ReactNode }) {
  return usePreviewState() ? <PreviewRolodex>{children}</PreviewRolodex> : <ConvexRolodex>{children}</ConvexRolodex>
}

const FIRST_PAGE = 1000
const NEXT_PAGE = 1500
const INVESTOR_PAGE = 2000
const useConvexPerson = (id: string | null) => useQuery(api.rolodex.person, id ? { id: id as Id<'rolodexPeople'> } : 'skip') as RolodexPersonFull | null | undefined
const useConvexInvestor = (key: string | null) => useQuery(api.rolodex.investor, key ? { key } : 'skip') as RolodexInvestorFull | null | undefined
const useConvexCompanies = (keys: string[] | undefined) => useQuery(api.rolodex.companies, keys?.length ? { keys } : 'skip') as RolodexCompany[] | undefined

/** Load every page: filters and counts work on the whole list. */
function useAllPages<T>(pages: { status: string; loadMore: (n: number) => void; results: T[] }, next: number) {
  const { status, loadMore } = pages
  useEffect(() => {
    if (status === 'CanLoadMore') loadMore(next)
  }, [status, loadMore, next])
  return status
}

function ConvexRolodex({ children }: { children: ReactNode }) {
  const meta = useQuery(api.rolodex.meta)
  const firms = useQuery(api.rolodex.firms)
  const people = usePaginatedQuery(api.rolodex.people, {}, { initialNumItems: FIRST_PAGE })
  const investors = usePaginatedQuery(api.rolodex.investors, {}, { initialNumItems: INVESTOR_PAGE })
  const status = useAllPages(people, NEXT_PAGE)
  const istatus = useAllPages(investors, INVESTOR_PAGE)
  const value = useMemo<RolodexValue>(
    () => ({
      loaded: status !== 'LoadingFirstPage' && firms !== undefined && meta !== undefined,
      meta,
      people: people.results as RolodexPerson[],
      peopleDone: status === 'Exhausted',
      firms: (firms ?? []) as RolodexFirm[],
      investors: investors.results as RolodexInvestor[],
      investorsDone: istatus === 'Exhausted',
      usePerson: useConvexPerson,
      useInvestor: useConvexInvestor,
      useCompanies: useConvexCompanies,
    }),
    [status, istatus, firms, meta, people.results, investors.results],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function PreviewRolodex({ children }: { children: ReactNode }) {
  const state = usePreviewState()?.rolodex
  const value = useMemo<RolodexValue>(() => {
    const d = previewRolodex(state)
    const byId = new Map(d.people.map((p) => [p._id, p]))
    const invByKey = new Map(d.investors.map((r) => [r.key, r]))
    const coByKey = new Map(d.companies.map((c) => [c.key, c]))
    return {
      loaded: state !== 'loading',
      meta: d.meta,
      people: d.people.map((p) => listRow(p)),
      peopleDone: true,
      firms: d.firms,
      investors: d.investors.map((r) => investorListRow({ ...r, _id: 'ri' + r.key })),
      investorsDone: true,
      usePerson: (id) => (id ? byId.get(id) ?? null : undefined),
      useInvestor: (key) => (key ? invByKey.get(key) ?? null : undefined),
      useCompanies: (keys) => (keys?.length ? keys.map((k) => coByKey.get(k)).filter((c): c is RolodexCompany => !!c) : undefined),
    }
  }, [state])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
