import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import tokens from '../styles/tokens.css?url'
import base from '../styles/base.css?url'
import motion from '../styles/motion.css?url'
import ui from '../styles/ui.css?url'
import shell from '../styles/shell.css?url'
import signin from '../styles/signin.css?url'
import home from '../styles/home.css?url'
import raise from '../styles/raise.css?url'
import pipeline from '../styles/pipeline.css?url'
import today from '../styles/today.css?url'
import drawer from '../styles/drawer.css?url'
import system from '../styles/system.css?url'
import investors from '../styles/investors.css?url'
import plan from '../styles/plan.css?url'
import settings from '../styles/settings.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'robots', content: 'noindex' },
      { name: 'theme-color', content: '#FBFAF4' },
      { title: 'Nest · Pesto' },
    ],
    links: [
      { rel: 'icon', href: '/mascot/logo-tile.webp', type: 'image/webp' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap',
      },
      ...[tokens, base, motion, ui, shell, signin, home, raise, pipeline, today, drawer, system, investors, plan, settings].map((href) => ({ rel: 'stylesheet', href })),
    ],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
