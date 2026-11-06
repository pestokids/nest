import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { nitro } from 'nitro/vite'
import viteReact from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'

// Hosting: Vercel, via Nitro (TanStack Start hosting guide). Nitro picks the
// `vercel` preset automatically when it builds on Vercel; we pin it so a local
// `pnpm build` produces the same output (.vercel/output).
export default defineConfig({
  server: { port: 3000 },
  plugins: [
    tsconfigPaths(),
    tanstackStart(),
    nitro({ preset: process.env.NITRO_PRESET ?? 'vercel' }),
    viteReact(),
  ],
})
