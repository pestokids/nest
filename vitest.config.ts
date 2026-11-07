import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Convex function tests (convex/*.test.ts) run on convex-test in the edge runtime (set per file).
  test: { include: ['src/**/*.test.ts', 'convex/**/*.test.ts'], environment: 'node', server: { deps: { inline: ['convex-test'] } } },
})
