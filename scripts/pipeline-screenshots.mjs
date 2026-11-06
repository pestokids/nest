// Screenshots of the Pipeline board in every designed state, from the fake
// ?preview fixture (never real data), at 1440 × 900, 440 × 956 and 412 × 915,
// including mid-drag (desktop) and mid-swipe (phones).
// Usage: pnpm dev:web, then  node scripts/pipeline-screenshots.mjs [baseUrl] [outDir]
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:3000'
const out = process.argv[3] ?? '.context/screens/pipeline'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
const settle = async (page, ms = 700) => {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(ms)
}
const center = async (loc) => {
  const b = await loc.boundingBox()
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

// Desktop
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  for (const state of ['hidden', 'shown', 'end']) {
    await page.goto(`${base}/raise/pipeline?preview&pipeline=${state}`, { waitUntil: 'networkidle' })
    await settle(page)
    await page.screenshot({ path: `${out}/${state === 'hidden' ? 'default' : state === 'shown' ? 'passed-and-parked-shown' : 'scrolled-to-the-end'}--desktop.png` })
  }
  // Mid-drag: pick up the Booked card and hold it over 1st meeting.
  await page.goto(`${base}/raise/pipeline?preview&pipeline=hidden`, { waitUntil: 'networkidle' })
  await settle(page)
  const card = page.locator('[data-drop="booked"] .pb-card').first()
  const from = await center(card)
  const to = await center(page.locator('[data-drop="m1"] .pb-col__list'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x + 20 - from.x) * i) / 12, from.y + ((to.y - 40 - from.y) * i) / 12)
  await settle(page, 400)
  await page.screenshot({ path: `${out}/dragging--desktop.png` })
  await page.mouse.up()
  await settle(page, 300)
  await page.screenshot({ path: `${out}/dropped-with-undo--desktop.png` })
  // Keyboard: focus a card and press ] (moves it on), then show the board.
  await page.goto(`${base}/raise/pipeline?preview&pipeline=hidden`, { waitUntil: 'networkidle' })
  await settle(page)
  await page.locator('[data-drop="intro"] .pb-card').first().focus()
  await page.keyboard.press(']')
  await settle(page, 500)
  await page.screenshot({ path: `${out}/keyboard-move--desktop.png` })
  await ctx.close()
}

// Phones
for (const size of [
  { name: 'iphone-17-pro-max', width: 440, height: 956 },
  { name: 'galaxy-s25-ultra', width: 412, height: 915 },
]) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })
  const page = await ctx.newPage()
  await page.goto(`${base}/raise/pipeline?preview&pipeline=hidden&stage=intro`, { waitUntil: 'networkidle' })
  await settle(page)
  await page.screenshot({ path: `${out}/pipeline--${size.name}.png` })
  // Mid-swipe: a finger drags the first card right, held.
  const cdp = await ctx.newCDPSession(page)
  const c = await center(page.locator('.pb-card--phone').first())
  const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: c.y }] })
  await touch('touchStart', c.x - 120)
  for (let i = 1; i <= 10; i++) await touch('touchMove', c.x - 120 + i * 11)
  await settle(page, 200)
  await page.screenshot({ path: `${out}/swiping--${size.name}.png` })
  for (let i = 11; i <= 20; i++) await touch('touchMove', c.x - 120 + i * 11)
  await touch('touchEnd', c.x + 100)
  await settle(page, 600)
  await page.screenshot({ path: `${out}/swiped-with-undo--${size.name}.png` })
  await ctx.close()
}
await browser.close()
console.log(`Saved to ${out}`)
