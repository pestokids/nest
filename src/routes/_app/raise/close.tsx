import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { Allocation } from '../../../components/close/Allocation'
import { CapTableView } from '../../../components/close/CapTableView'
import { CloseProvider, useClose } from '../../../components/close/CloseData'
import { Modeller } from '../../../components/close/Modeller'
import { Overview } from '../../../components/close/Overview'
import { ViewSkeleton } from '../../../components/system/Skeleton'
import { closePreview } from '../../../preview/closeFixture'

/** PST-283 Close: the overview, the round modeller (`?view=modeller`) and the cap table (`?view=captable`). PST-291: Allocation (`?view=allocation`). */
const VIEWS = ['allocation', 'modeller', 'captable'] as const
export type CloseView = (typeof VIEWS)[number]
export type CloseSearch = { view?: CloseView }

const CHIPS: { view?: CloseView; label: string }[] = [
  { label: 'Overview' },
  { view: 'allocation', label: 'Allocation' },
  { view: 'modeller', label: 'Round modeller' },
  { view: 'captable', label: 'Cap table' },
]

export const Route = createFileRoute('/_app/raise/close')({
  validateSearch: (s: Record<string, unknown>): CloseSearch => ({ view: (VIEWS as readonly unknown[]).includes(s.view) ? (s.view as CloseView) : undefined }),
  component: () => (
    <CloseProvider>
      <Close />
    </CloseProvider>
  ),
})

/** ?preview&close=modeller|captable|nocaptable|closed|allocation|tranche2 opens that view, once per page load. */
let previewViewShown = false

function Close() {
  const { view } = Route.useSearch()
  const navigate = useNavigate()
  const c = useClose()
  useEffect(() => {
    if (previewViewShown) return
    previewViewShown = true
    const p = closePreview()
    const v = p === 'modeller' ? 'modeller' : p === 'captable' || p === 'nocaptable' || p === 'closed' ? 'captable' : p === 'allocation' || p === 'tranche2' ? 'allocation' : undefined
    if (v && !view) void navigate({ to: '/raise/close', search: { view: v }, replace: true })
  }, [view, navigate])
  if (!c.loaded) return <ViewSkeleton />
  return (
    <section className="close">
      <nav className="close-chips close-views" aria-label="Close views">
        {CHIPS.map((x) => (
          <Link key={x.label} to="/raise/close" search={x.view ? { view: x.view } : {}} className={`close-chip${view === x.view ? ' is-on' : ''}`} aria-current={view === x.view ? 'page' : undefined}>
            {x.label}
          </Link>
        ))}
      </nav>
      {view === 'allocation' ? <Allocation /> : view === 'modeller' ? <Modeller /> : view === 'captable' ? <CapTableView /> : <Overview />}
    </section>
  )
}
