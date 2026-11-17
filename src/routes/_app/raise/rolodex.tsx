import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { FirmsView } from '../../../components/rolodex/FirmsView'
import { PeopleView } from '../../../components/rolodex/PeopleView'
import { RolodexProvider, useRolodex } from '../../../components/rolodex/data'
import { usePreviewState } from '../../../components/preview-state'
import { Card } from '../../../components/ui'
import { matchesFirm, validateRolodexSearch, type RolodexSearch } from '../../../lib/rolodex'

// Rolodex: everyone from the fundraising research, and the investor firms they work at.
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
  const investing = useMemo(() => x.firms.filter((r) => matchesFirm(r, { kind: 'investors' })).length, [x.firms])

  if (!x.loaded)
    return (
      <section className="inv rdx">
        <Card className="intro-list rdx-loading" aria-busy="true">
          <p className="intro-list__lede">Opening the Rolodex…</p>
        </Card>
      </section>
    )
  return s.view === 'firms' ? <FirmsView s={s} set={set} peopleCount={x.meta?.people ?? x.people.length} /> : <PeopleView s={s} set={set} firmCount={investing} />
}

/** ?preview&rolodex=firms|person|firm|filtered|leftout: open that state once the fixture is in. */
function usePreviewStates(set: (patch: Partial<RolodexSearch>) => void) {
  const flag = usePreviewState()?.rolodex
  const x = useRolodex()
  const done = useRef(false)
  useEffect(() => {
    if (!flag || done.current || !x.people.length) return
    done.current = true
    if (flag === 'firms') set({ view: 'firms' })
    else if (flag === 'firm') set({ view: 'firms', open: x.firms.find((f) => f.name === 'Orchard Capital')?.key })
    else if (flag === 'person') set({ person: x.people.find((p) => p.name === 'Nikhil Arora')?._id })
    else if (flag === 'filtered') set({ who: 'investors', country: 'IN', when: 'now' })
    else if (flag === 'leftout') set({ who: 'leftout' })
  }, [flag, x.people, x.firms, set])
}
