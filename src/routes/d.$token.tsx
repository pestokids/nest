import { createFileRoute, useRouterState } from '@tanstack/react-router'
import { lazy, Suspense, useMemo } from 'react'
import { httpApi, Viewer } from '../components/viewer/Viewer'
import viewerCss from '../styles/viewer.css?url'

// ?preview (local dev and Vercel preview builds only): /d/preview?preview&viewer=gate|open|expired|link|download
const PREVIEW_ON = import.meta.env.DEV || import.meta.env.VITE_PREVIEW_MODE === '1'
const PreviewViewer = PREVIEW_ON ? lazy(() => import('../preview/viewerPreview').then((m) => ({ default: m.PreviewViewer }))) : null

const SHARED = 'A document shared by Pesto.'

/**
 * PST-282: the public viewer for a share link, nest.pestokids.com/d/<token>. No
 * sign-in, nothing about Nest: its own title and link-preview tags replace the
 * app's. The page shell renders on the server; everything else in the browser.
 */
export const Route = createFileRoute('/d/$token')({
  head: () => ({
    meta: [
      { title: 'Pesto' },
      { name: 'description', content: SHARED },
      { name: 'apple-mobile-web-app-title', content: 'Pesto' },
      { name: 'theme-color', content: '#F5F2E8' },
      { name: 'referrer', content: 'no-referrer' },
      { property: 'og:site_name', content: 'Pesto' },
      { property: 'og:title', content: 'Pesto' },
      { property: 'og:description', content: SHARED },
      { property: 'og:url', content: 'https://nest.pestokids.com/d' },
      { property: 'og:image', content: 'https://nest.pestokids.com/d-og.png' },
      { property: 'og:image:alt', content: 'Pesto' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: 'https://nest.pestokids.com/d-og.png' },
    ],
    links: [{ rel: 'stylesheet', href: viewerCss }],
  }),
  component: SharedDocument,
})

function SharedDocument() {
  const { token } = Route.useParams()
  const api = useMemo(() => httpApi(token), [token])
  // Read from the router, not window.location, so the server and the browser render the same thing.
  const search = useRouterState({ select: (s) => new URLSearchParams(s.location.searchStr) })
  if (PreviewViewer && token === 'preview' && search.has('preview'))
    return (
      <Suspense fallback={null}>
        <PreviewViewer state={search.get('viewer') ?? 'open'} />
      </Suspense>
    )
  return <Viewer api={api} />
}
