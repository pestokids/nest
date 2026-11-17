// Rolodex: what its two views read. Convex when signed in (people stream in a page at
// a time, shortlist first, until everyone's loaded), the made-up fixture under
// ?preview (src/preview/rolodexFixture.ts). Read-only: the import is the only writer.
import { usePaginatedQuery, useQuery } from 'convex/react'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { listRow, type RolodexFirm, type RolodexMeta, type RolodexPerson, type RolodexPersonFull } from '../../lib/rolodex'
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
  firms: RolodexFirm[]
  /** One person, everything kept (the panel). A hook; undefined while loading, null if gone. */
  usePerson: (id: string | null) => RolodexPersonFull | null | undefined
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
const useConvexPerson = (id: string | null) => useQuery(api.rolodex.person, id ? { id: id as Id<'rolodexPeople'> } : 'skip') as RolodexPersonFull | null | undefined

function ConvexRolodex({ children }: { children: ReactNode }) {
  const meta = useQuery(api.rolodex.meta)
  const firms = useQuery(api.rolodex.firms)
  const pages = usePaginatedQuery(api.rolodex.people, {}, { initialNumItems: FIRST_PAGE })
  // Keep loading until everyone's in: filters and counts work on the whole list.
  const { status, loadMore } = pages
  useEffect(() => {
    if (status === 'CanLoadMore') loadMore(NEXT_PAGE)
  }, [status, loadMore])
  const value = useMemo<RolodexValue>(
    () => ({
      loaded: status !== 'LoadingFirstPage' && firms !== undefined && meta !== undefined,
      meta,
      people: pages.results as RolodexPerson[],
      peopleDone: status === 'Exhausted',
      firms: (firms ?? []) as RolodexFirm[],
      usePerson: useConvexPerson,
    }),
    [status, firms, meta, pages.results],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function PreviewRolodex({ children }: { children: ReactNode }) {
  const state = usePreviewState()?.rolodex
  const value = useMemo<RolodexValue>(() => {
    const d = previewRolodex(state)
    const byId = new Map(d.people.map((p) => [p._id, p]))
    return {
      loaded: state !== 'loading',
      meta: d.meta,
      people: d.people.map((p) => listRow(p)),
      peopleDone: true,
      firms: d.firms,
      usePerson: (id) => (id ? byId.get(id) ?? null : undefined),
    }
  }, [state])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
