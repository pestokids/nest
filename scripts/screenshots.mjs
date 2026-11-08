// Screenshots of every screen in the dev-only ?preview mode (fake fixture data).
// Usage: pnpm dev:web, then  node scripts/screenshots.mjs [baseUrl] [outDir] [filter]
// Defaults: http://localhost:3000 and .context/screens (gitignored).
// Also checks every screen for sideways scroll and, on phones, tap targets under 44px;
// findings go to <outDir>/checks.json and a summary is printed.
import { mkdirSync, writeFileSync } from 'node:fs'
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
  // PST-268: Investors, Plan, Settings and the system states
  ['investors-default', '/raise/investors?preview'],
  ['investors-filtered', '/raise/investors?preview&investors=filtered'],
  ['investors-no-results', '/raise/investors?preview&investors=empty'],
  ['investors-bulk', '/raise/investors?preview&investors=bulk'],
  ['investors-exported', '/raise/investors?preview&investors=exported'],
  ['investors-import-1', '/raise/investors?preview&investors=import1'],
  ['investors-import-2', '/raise/investors?preview&investors=import2'],
  ['investors-import-3', '/raise/investors?preview&investors=import3'],
  ['plan-default', '/raise/plan?preview'],
  ['plan-mid', '/raise/plan?preview&plan=mid'],
  // PST-284: Plan › Insights and Investors › Sort: Priority
  ...['default', 'behind', 'empty'].map((s) => [`plan-insights-${s}`, `/raise/plan?preview&insights=${s}`]),
  ['investors-priority', '/raise/investors?preview&sort=priority'],
  ['settings-default', '/raise/settings?preview'],
  ['settings-errors', '/raise/settings?preview&settings=errors'],
  ['system-cmdk-empty', '/raise/today?preview&system=cmdk-empty'],
  ['system-cmdk-results', '/raise/today?preview&system=cmdk'],
  ['system-cmdk-none', '/raise/today?preview&system=cmdk-none'],
  ['system-offline', '/raise/today?preview&system=offline'],
  ['system-save-failed', '/raise/pipeline?preview&system=savefailed'],
  ['system-loading', '/raise/today?preview&system=loading'],
  ['system-loading-investors', '/raise/investors?preview&system=loading'],
  ['system-404', '/nowhere?preview'],
  // PST-263: Calendar and Gmail
  ['google-today', '/raise/today?preview&google=connected'],
  ['google-drawer-emails', '/raise/investors?preview&drawer=emails'],
  ['google-drawer-history', '/raise/investors?preview&drawer=history&google=connected'],
  ['google-settings-connected', '/raise/settings?preview&google=connected'],
  ['google-settings-syncing', '/raise/settings?preview&google=syncing'],
  ['google-settings-reconnect', '/raise/settings?preview&google=reconnect'],
  ['google-settings-not-connected', '/raise/settings?preview'],
  ['google-cmdk-gmail', '/raise/today?preview&system=cmdk&google=connected'],
  // PST-285: Wispr Flow
  ...['off', 'connected', 'reconnect', 'fetching'].map((s) => [`wispr-settings-${s}`, `/raise/settings?preview&wispr=${s}`]),
  // PST-289: Send feedback (⌘.), and Settings › Feedback with rows waiting
  ['feedback-open', '/raise/pipeline?preview&feedback=open'],
  ['feedback-sent', '/raise/today?preview&feedback=sent'],
  ['feedback-unsent', '/raise/settings?preview&feedback=unsent'],
  // PST-275: Suggested fixes
  ['suggestions-today', '/raise/today?preview'],
  ['suggestions-all', '/raise/today?preview&suggestions=all'],
  ['suggestions-agent', '/raise/today?preview&suggestions=agent'],
  ['suggestions-tidy', '/raise/today?preview&suggestions=tidy'],
  ['suggestions-none', '/raise/today?preview&suggestions=none'],
  // PST-282: Materials and the public viewer
  ['materials-library', '/raise/materials?preview'],
  ['materials-empty', '/raise/materials?preview&materials=empty'],
  ['materials-versions', '/raise/materials?preview&materials=versions'],
  ['materials-views', '/raise/materials?preview&materials=views'],
  ['materials-share', '/raise/materials?preview&materials=share'],
  ['materials-sent', '/raise/materials?preview&materials=sent'],
  ['materials-sent-noemail', '/raise/materials?preview&materials=noemail'],
  ['materials-upload', '/raise/materials?preview&materials=upload'],
  ['materials-drawer', '/raise/materials?preview&drawer=materials'],
  ['materials-today', '/raise/today?preview&materials=default'],
  ['viewer-open', '/d/preview?preview'],
  ['viewer-gate', '/d/preview?preview&viewer=gate'],
  ['viewer-download', '/d/preview?preview&viewer=download'],
  ['viewer-link', '/d/preview?preview&viewer=link'],
  ['viewer-expired', '/d/preview?preview&viewer=expired'],
  // PST-283: Close
  ...['default', 'record', 'status', 'remind', 'modeller', 'captable', 'nocaptable', 'closed', 'empty'].map((s) => [`close-${s}`, `/raise/close?preview&close=${s}`]),
  ['close-settings-cap-table', '/raise/settings?preview&close#cap-table'],
  // PST-278: Drafts
  ...['followup', 'intro', 'blurb', 'nudge', 'thanks', 'dataroom', 'writing', 'nokey', 'noemail', 'copied', 'failed'].map((s) => [`drafts-${s}`, `/raise/today?preview&drafts=${s}`]),
  ['drafts-history', '/raise/investors?preview&drafts=history'],
]

/** Sideways scroll, and (phones) visible controls smaller than 44 × 44. */
const audit = (mobile) => {
  const out = { sideways: document.documentElement.scrollWidth > innerWidth + 1 ? document.documentElement.scrollWidth - innerWidth : 0, small: [] }
  if (!mobile) return out
  const els = document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=option], summary')
  for (const el of els) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue
    // A visually small control can still have a 44px hit area from a parent label or a ::after.
    const hit = el.closest('label') ?? el
    const hr = hit.getBoundingClientRect()
    const after = getComputedStyle(el, '::after')
    const extra = after.content !== 'none' && after.position === 'absolute' ? Math.max(0, -parseFloat(after.top) || 0, -parseFloat(after.left) || 0) * 2 : 0
    const w = Math.max(r.width, hr.width) + extra
    const h = Math.max(r.height, hr.height) + extra
    if (w < 44 || h < 44) out.small.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(w)}×${Math.round(h)}`)
  }
  return out
}
const report = {}

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
    // Overlays (sheets, toasts, the palette, the bulk bar) are fixed to the viewport: shoot the viewport.
    const full = !/^(sign-in|drawer-|google-drawer-|system-cmdk|google-cmdk|system-save|investors-(import|bulk|exported)|suggestions-(all|agent|tidy)|materials-(versions|views|share|sent|upload|drawer)|viewer-|drafts-)/.test(name) && !(size.mobile && name.endsWith('-win'))
    await page.screenshot({ path: `${out}/${name}--${size.name}.png`, fullPage: full })
    const a = await page.evaluate(audit, size.mobile)
    if (a.sideways || a.small.length) report[`${name}--${size.name}`] = a
    process.stdout.write('.')
  }
  await ctx.close()
}
await browser.close()
writeFileSync(`${out}/checks.json`, JSON.stringify(report, null, 2))
const bad = Object.entries(report)
console.log(`\nSaved to ${out}`)
console.log(bad.length ? `Checks: ${bad.length} screen(s) with findings, see ${out}/checks.json` : 'Checks: no sideways scroll, no small tap targets')
for (const [k, v] of bad) console.log(`  ${k}: ${v.sideways ? `scrolls sideways by ${v.sideways}px; ` : ''}${v.small.length ? `${v.small.length} small: ${v.small.slice(0, 4).join(', ')}` : ''}`)
