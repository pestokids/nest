import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// ---------- PST-304: the UI sound kit ----------
// SND01 "sine" (Yasuhiro Tsuchiya, snd.dev) ships inside snd-lib's npm package. Copy its sprite into
// public/sounds/snd01/ so it's served from our own origin, never a CDN. SND's terms forbid redistributing
// the raw files on their own, so the copy is gitignored rather than committed to this public repo.
function sndKit(): Plugin {
  return {
    name: 'nest-snd-kit',
    config() {
      const from = join(dirname(createRequire(import.meta.url).resolve('snd-lib/package.json')), 'assets/sounds/sprite/01/audioSprite.m4a')
      const to = join(process.cwd(), 'public/sounds/snd01/audioSprite.m4a')
      if (existsSync(to) && statSync(to).size === statSync(from).size) return
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to)
    },
  }
}
// ---------- end PST-304 ----------

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
      sndKit(), // PST-304
      tsconfigPaths(),
      tanstackStart(),
      nitro({ preset: process.env.NITRO_PRESET ?? 'vercel' }),
      viteReact(),
    ],
  }
})
