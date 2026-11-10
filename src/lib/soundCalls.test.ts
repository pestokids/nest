// PST-304: a static check over src that every play() call names an action from the one
// kit table in src/lib/sound.ts, that no old sound file names are left, and that every
// action in the table is used somewhere.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTIONS } from './sound'

const OLD = ['ask-logged', 'card-drop', 'card-pickup', 'drawer', 'egg-crack', 'nudge', 'pesto-chirp', 'pesto-hop', 'rule-check', 'signed-in', 'signed-out', 'spill']
const ROOT = join(__dirname, '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : []
  })
}
const SOURCES = files(ROOT)
  .filter((f) => !f.endsWith(join('lib', 'sound.ts')))
  .map((f) => ({ f: relative(ROOT, f), text: readFileSync(f, 'utf8') }))
  .filter(({ text }) => /from '[./]+(lib\/)?sound'/.test(text))

/** The argument text of every play(…) call, balanced over nested parentheses. */
function playArgs(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/(?<![\w.])play\(/g)) {
    let depth = 1
    let i = m.index! + m[0].length
    const start = i
    for (; i < text.length && depth; i++) depth += text[i] === '(' ? 1 : text[i] === ')' ? -1 : 0
    out.push(text.slice(start, i - 1))
  }
  return out
}
/** Quoted names in a call's arguments, leaving out the other side of a comparison (kind === 'done'). */
const quoted = (s: string) => [...s.matchAll(/'([^']*)'/g)].filter((m) => !/[=!]==\s*$/.test(s.slice(0, m.index))).map((m) => m[1])

describe('play() calls', () => {
  const calls = SOURCES.flatMap(({ f, text }) => playArgs(text).map((args) => ({ f, args })))

  it('finds the call sites', () => expect(calls.length).toBeGreaterThan(80))

  it('name an action from the table, with no options', () => {
    for (const { f, args } of calls) {
      expect(args, f).not.toContain('{')
      for (const name of quoted(args)) expect(Object.keys(ACTIONS), `${f}: play(${args})`).toContain(name)
    }
  })

  it('never use an old sound file name', () => {
    for (const { f, args } of calls) for (const name of quoted(args)) expect(OLD, f).not.toContain(name)
    for (const name of OLD) expect(Object.keys(ACTIONS)).not.toContain(name)
    for (const { f, text } of SOURCES) expect(text, f).not.toMatch(/\.mp3\b/)
  })

  it('use every action in the table', () => {
    const used = new Set([
      ...calls.flatMap(({ args }) => quoted(args)),
      ...SOURCES.flatMap(({ text }) => [...text.matchAll(/(?:sound: |return )'([a-z-]+)'/g)].map((m) => m[1])),
      ...quoted(readFileSync(join(ROOT, 'lib', 'board.ts'), 'utf8').match(/export function moveSound[\s\S]*?\n}/)![0]),
    ])
    expect(Object.keys(ACTIONS).filter((a) => !used.has(a))).toEqual([])
  })

  it('leaves no old MP3s in public/sounds', () => {
    const dir = join(ROOT, '..', 'public', 'sounds')
    const mp3s = existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.mp3')) : []
    expect(mp3s).toEqual([])
  })
})
