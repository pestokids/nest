import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import { AuthGate } from '../components/AuthGate'
import { ConvexData } from '../components/ConvexData'
import { Shell } from '../components/Shell'

// DEV ONLY: `/raise/today?preview` renders from internal/seed.json without signing in.
const PreviewData = import.meta.env.DEV ? lazy(() => import('../components/PreviewData').then((m) => ({ default: m.PreviewData }))) : null

function isPreview() {
  if (!PreviewData) return false
  if (new URLSearchParams(location.search).has('preview')) sessionStorage.setItem('nest_preview', '1')
  return sessionStorage.getItem('nest_preview') === '1'
}

/** The pre-seed tracker. Client-rendered only: nothing private is rendered on the server. */
export const Route = createFileRoute('/raise')({
  ssr: false,
  component: RaiseLayout,
})

function RaiseLayout() {
  if (PreviewData && isPreview())
    return (
      <Suspense fallback={null}>
        <PreviewData>
          <Shell />
        </PreviewData>
      </Suspense>
    )
  return (
    <AuthGate>
      {(me) => (
        <ConvexData me={me}>
          <Shell />
        </ConvexData>
      )}
    </AuthGate>
  )
}
