import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOTION, scrollBehavior } from './motion'

// PST-298: motion is 150–200 ms ease-out, and under prefers-reduced-motion it becomes a fade.
const DIR = new URL('../styles/', import.meta.url)
const SHEETS = readdirSync(DIR)
  .filter((f) => f.endsWith('.css'))
  .map((f) => ({ f, css: readFileSync(new URL(f, DIR), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }))

/** The block that starts at the `{` at `open`, without its braces, and the index after it. */
function block(css: string, open: number): [string, number] {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return [css.slice(open + 1, i), i + 1]
  }
  return [css.slice(open + 1), css.length]
}

/** A sheet's rules split into what always applies and what only applies under reduced motion. */
function split(css: string) {
  const reduced: string[] = []
  let normal = ''
  let at = 0
  for (const m of css.matchAll(/@media[^{]*prefers-reduced-motion:\s*reduce[^{]*\{/g)) {
    const [inner, end] = block(css, m.index + m[0].length - 1)
    normal += css.slice(at, m.index)
    reduced.push(inner)
    at = end
  }
  return { normal: normal + css.slice(at), reduced: reduced.join('\n') }
}

function keyframes(css: string) {
  const out = new Map<string, string>()
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) out.set(m[1], block(css, m.index + m[0].length - 1)[0])
  return out
}

const MOVES = /(^|[\s;{])(transform|translate|scale|rotate|left|top|right|bottom|width|height|min-height|background-position|letter-spacing)\s*:/
/** Gestures and loops keep their own timing (interactions.png); reduced motion stops them. */
const GESTURES = new Set(['m-wobble', 'm-shake', 'm-shake-x', 'm-shine', 'm-pulse', 'm-bob', 'sk-sweep', 'sk-shimmer', 'draft-shimmer', 'gwho-shimmer', 'signin-steam', 'signin-type', 'signin-glint', 'signin-card-shake', 'sys-drift', 'sys-sway', 'imp-breathe', 'btn-spin', 'enrich-spin', 'enrich-flash'])

describe('reduced motion makes movement a fade', () => {
  it.each(SHEETS)('$f: every keyframe that moves has an opacity-only version under reduced motion', ({ css }) => {
    const { normal, reduced } = split(css)
    const quiet = keyframes(reduced)
    for (const [name, body] of keyframes(normal)) {
      if (!MOVES.test(body)) continue
      expect(quiet.has(name), name).toBe(true)
      expect(MOVES.test(quiet.get(name) ?? ''), name).toBe(false)
    }
  })

  it('keeps only opacity and colour in transitions', () => {
    const { reduced } = split(SHEETS.find((s) => s.f === 'motion.css')!.css)
    const props = reduced.match(/transition-property:([^;!]+)/)?.[1].split(',').map((p) => p.trim())
    expect(props).toEqual(['opacity', 'color', 'background-color', 'border-color', 'box-shadow'])
    expect(reduced).toMatch(/transition-duration:\s*150ms/)
  })

  it('scrolls smoothly, or jumps under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }))
    expect(scrollBehavior()).toBe('auto')
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(scrollBehavior()).toBe('smooth')
  })
  afterEach(() => vi.unstubAllGlobals())
})

describe('UI motion is 150–200 ms ease-out', () => {
  it.each(SHEETS)('$f', ({ css }) => {
    const bad: string[] = []
    for (const m of split(css).normal.matchAll(/(?:^|[\s;{])(transition|animation):([^;}]+)/g)) {
      for (const part of m[2].split(/,(?![^(]*\))/)) {
        const words = part.trim().split(/\s+/)
        if (m[1] === 'animation' && (words.some((w) => GESTURES.has(w)) || words.includes('infinite'))) continue
        const ms = part.match(/(\d+(?:\.\d+)?)(ms|s)\b/)
        if (!ms) continue
        const n = ms[2] === 's' ? Number(ms[1]) * 1000 : Number(ms[1])
        if (n < 150 || n > 200 || /ease-in|--ease-out-back|--ease-spring|--ease-out-quart|\blinear\b|\bease\b(?!-)/.test(part)) bad.push(part.trim())
      }
    }
    expect(bad).toEqual([])
  })

  it('keeps the JS timings in step', () => {
    for (const k of ['rise', 'pop', 'toast'] as const) expect(MOTION[k].ms).toBeGreaterThanOrEqual(150)
    for (const k of ['rise', 'pop', 'toast'] as const) expect(MOTION[k].ms).toBeLessThanOrEqual(200)
  })
})
