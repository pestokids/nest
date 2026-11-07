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
import suggestions from '../styles/suggestions.css?url'
import enrich from '../styles/enrich.css?url'
import qanda from '../styles/qanda.css?url'
import materials from '../styles/materials.css?url'
import close from '../styles/close.css?url'
import agents from '../styles/agents.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'robots', content: 'noindex' },
      { name: 'theme-color', content: '#FBFAF4' },
      { title: 'Nest · Pesto' },
      { name: 'description', content: 'Pesto\u2019s back office. Pesto team only.' },
      { name: 'apple-mobile-web-app-title', content: 'Nest' },
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      // Link previews (WhatsApp, Slack, iMessage). Crawlers need an absolute image URL.
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Nest' },
      { property: 'og:title', content: 'Nest · Pesto' },
      { property: 'og:description', content: 'Pesto\u2019s back office. Pesto team only.' },
      { property: 'og:url', content: 'https://nest.pestokids.com' },
      { property: 'og:image', content: 'https://nest.pestokids.com/og.png' },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'nest. Pesto\u2019s back office.' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:image', content: 'https://nest.pestokids.com/og.png' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap',
      },
      ...[tokens, base, motion, ui, shell, signin, home, raise, pipeline, today, drawer, system, investors, plan, settings, suggestions, enrich, qanda, materials, close, agents].map((href) => ({ rel: 'stylesheet', href })),
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
