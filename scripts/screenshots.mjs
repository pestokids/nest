// Screenshots of every screen in the dev-only ?preview mode (fake fixture data).
// Usage: pnpm dev:web, then  node scripts/screenshots.mjs [baseUrl] [outDir] [filter]
// Defaults: http://localhost:3000 and .context/screens (gitignored).
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:3000'
const out = process.argv[3] ?? '.context/screens'
const only = process.argv[4]
mkdirSync(out, { recursive: true })

const SIZES = [
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'iphone-17-pro-max', width: 440, height: 956, mobile: true },
  { name: 'galaxy-s25-ultra', width: 412, height: 915, mobile: true },
]
const SCREENS = [
  ['home-default', '/?preview'],
  ['home-first-run', '/?preview&home=firstrun'],
  ['home-prep-done', '/?preview&home=prepdone'],
  ...['default', 'hover', 'checking', 'noaccess', 'error', 'signedout'].map((s) => [`sign-in-${s}`, `/?preview&signin=${s}`]),
  ['raise-today', '/raise/today?preview'],
  ['raise-today-nothing-due', '/raise/today?preview&today=nothingdue'],
  ['raise-today-win', '/raise/today?preview&today=win'],
  ...['view', 'edit', 'new', 'advance', 'touch', 'history', 'delete'].map((s) => [`drawer-${s}`, `/raise/investors?preview&drawer=${s}`]),
  ['raise-pipeline', '/raise/pipeline?preview'],
  ['raise-investors', '/raise/investors?preview'],
  ['raise-plan', '/raise/plan?preview'],
  ['raise-settings', '/raise/settings?preview'],
]

const browser = await chromium.launch()
for (const size of SIZES) {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  for (const [name, path] of SCREENS) {
    if (only && !name.includes(only)) continue
    await page.goto(base + path, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    // The win plays 700ms after load; catch it mid-confetti with the toast up.
    await page.waitForTimeout(name.endsWith('-win') ? 1000 : 900)
    // Full-page capture resizes the viewport, which re-snaps the phone moves carousel: keep the win at viewport size there.
    const full = !name.startsWith('sign-in') && !name.startsWith('drawer-') && !(size.mobile && name.endsWith('-win'))
    await page.screenshot({ path: `${out}/${name}--${size.name}.png`, fullPage: full })
    process.stdout.write('.')
  }
  await ctx.close()
}
await browser.close()
console.log(`\nSaved to ${out}`)
