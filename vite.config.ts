import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// Hosting: Vercel, via Nitro (TanStack Start hosting guide). Nitro picks the
// `vercel` preset automatically when it builds on Vercel; we pin it so a local
// `pnpm build` produces the same output (.vercel/output).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // PST-285: in dev, the Wispr Flow sign-in comes back to http://localhost:3000/wispr/callback; hand it to the dev deployment's HTTP routes.
  const convexSite = (env.VITE_CONVEX_SITE_URL || (env.VITE_CONVEX_URL ?? '').replace(/\.cloud\/?$/, '.site')).replace(/\/$/, '')
  return {
    // PST-289: the build on feedback issues (the commit on Vercel, "dev" locally).
    define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || 'dev') },
    server: { port: 3000, ...(convexSite ? { proxy: { '/wispr/callback': { target: convexSite, changeOrigin: true } } } : {}) },
    plugins: [
      tsconfigPaths(),
      tanstackStart(),
      nitro({ preset: process.env.NITRO_PRESET ?? 'vercel' }),
      viteReact(),
    ],
  }
})
