import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { CapTableView } from '../../../components/close/CapTableView'
import { CloseProvider, useClose } from '../../../components/close/CloseData'
import { Modeller } from '../../../components/close/Modeller'
import { Overview } from '../../../components/close/Overview'
import { ViewSkeleton } from '../../../components/system/Skeleton'
import { Icon } from '../../../components/ui'
import { closePreview } from '../../../preview/closeFixture'

/** PST-283 Close: the overview, the round modeller (`?view=modeller`) and the cap table (`?view=captable`). */
export type CloseSearch = { view?: 'modeller' | 'captable' }

export const Route = createFileRoute('/_app/raise/close')({
  validateSearch: (s: Record<string, unknown>): CloseSearch => ({ view: s.view === 'modeller' || s.view === 'captable' ? s.view : undefined }),
  component: () => (
    <CloseProvider>
      <Close />
    </CloseProvider>
  ),
})

/** ?preview&close=modeller|captable|nocaptable|closed opens that view, once per page load. */
let previewViewShown = false

function Close() {
  const { view } = Route.useSearch()
  const navigate = useNavigate()
  const c = useClose()
  useEffect(() => {
    if (previewViewShown) return
    previewViewShown = true
    const p = closePreview()
    const v = p === 'modeller' ? 'modeller' : p === 'captable' || p === 'nocaptable' || p === 'closed' ? 'captable' : undefined
    if (v && !view) void navigate({ to: '/raise/close', search: { view: v }, replace: true })
  }, [view, navigate])
  if (!c.loaded) return <ViewSkeleton />
  return (
    <section className="close">
      {view ? (
        <Link to="/raise/close" className="close-back">
          <Icon name="arrow-left" size={16} /> Close overview
        </Link>
      ) : null}
      {view === 'modeller' ? <Modeller /> : view === 'captable' ? <CapTableView /> : <Overview />}
    </section>
  )
}
