import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useRef } from 'react'
import { InvestorsView } from '../../../components/rolodex/InvestorsView'
import { PeopleView } from '../../../components/rolodex/PeopleView'
import { RolodexProvider, useRolodex } from '../../../components/rolodex/data'
import { usePreviewState } from '../../../components/preview-state'
import { Card } from '../../../components/ui'
import { validateRolodexSearch, type RolodexSearch } from '../../../lib/rolodex'

// Rolodex: the shortlist from the fundraising research (People), and every investor who
// backed a company our founders started (Investors).
// Filters live in the URL (src/lib/rolodex.ts validateRolodexSearch), so a filtered view is a link.
export const Route = createFileRoute('/_app/raise/rolodex')({
  validateSearch: validateRolodexSearch,
  component: () => (
    <RolodexProvider>
      <Rolodex />
    </RolodexProvider>
  ),
})

function Rolodex() {
  const s = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const set = useCallback((patch: Partial<RolodexSearch>) => navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true }), [navigate])
  const x = useRolodex()
  usePreviewStates(set)

  if (!x.loaded)
    return (
      <section className="inv rdx">
        <Card className="intro-list rdx-loading" aria-busy="true">
          <p className="intro-list__lede">Opening the Rolodex…</p>
        </Card>
      </section>
    )
  return s.view === 'investors' ? (
    <InvestorsView s={s} set={set} peopleCount={x.meta?.people ?? x.people.length} />
  ) : (
    <PeopleView s={s} set={set} investorCount={x.meta?.investors ?? x.investors.length} />
  )
}

/** ?preview&rolodex=investors|person|investor|picked|filtered: open that state once the fixture is in. */
function usePreviewStates(set: (patch: Partial<RolodexSearch>) => void) {
  const flag = usePreviewState()?.rolodex
  const x = useRolodex()
  const done = useRef(false)
  useEffect(() => {
    if (!flag || done.current || !x.people.length) return
    done.current = true
    if (flag === 'investors') set({ view: 'investors' })
    else if (flag === 'investor') set({ view: 'investors', open: 'lantern' })
    else if (flag === 'picked') set({ view: 'investors', pick: ['lantern', 'meera pillai'], open: 'lantern' })
    else if (flag === 'person') set({ person: x.people.find((p) => p.name === 'Nikhil Arora')?._id })
    else if (flag === 'filtered') set({ who: 'founders', inv: ['lantern'] })
  }, [flag, x.people, set])
}
