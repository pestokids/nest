import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense, useEffect } from 'react'
import { AppShell } from '../components/AppShell'
import { AuthGate } from '../components/AuthGate'
import { ConvexData } from '../components/ConvexData'
import { ConvexMaterials } from '../components/materials/data'
import { DraftsProvider } from '../components/drafts/data'
import { OpenToasts } from '../components/materials/Opens'
import { ConvexSounds } from '../components/session'
import { installSound } from '../lib/sound'

// `?preview` renders without signing in (see src/preview/Preview.tsx), with the fake fixture only.
// On in local dev, and on Vercel preview builds where VITE_PREVIEW_MODE=1. Never in production.
const PREVIEW_ON = import.meta.env.DEV || import.meta.env.VITE_PREVIEW_MODE === '1'
const Preview = PREVIEW_ON ? lazy(() => import('../preview/Preview').then((m) => ({ default: m.Preview }))) : null

function isPreview() {
  if (!Preview) return false
  if (new URLSearchParams(location.search).has('preview')) sessionStorage.setItem('nest_preview', '1')
  return sessionStorage.getItem('nest_preview') === '1'
}

/** Everything behind sign-in. Client-rendered only: nothing private is rendered on the server. */
export const Route = createFileRoute('/_app')({
  ssr: false,
  component: AppLayout,
})

function AppLayout() {
  useEffect(() => installSound(), [])
  if (Preview && isPreview())
    return (
      <Suspense fallback={null}>
        <Preview />
      </Suspense>
    )
  return (
    <AuthGate>
      <ConvexSounds>
        <ConvexData>
          <ConvexMaterials>
            <DraftsProvider>
              <AppShell>
                <OpenToasts />
              </AppShell>
            </DraftsProvider>
          </ConvexMaterials>
        </ConvexData>
      </ConvexSounds>
    </AuthGate>
  )
}
