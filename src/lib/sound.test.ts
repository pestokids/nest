import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ACTIONS, DEBOUNCE_MS, KINDS, KIT_SOUNDS, MASTER_VOLUME, PREVIEW, SoundPlayer, type Action } from './sound'

/** A fake AudioContext that records what was started. */
function fakeAudio() {
  const started: { rate: number; volume: number; at: number; offset: number; duration: number }[] = []
  const gains: { gain: { value: number }; connect: () => void }[] = []
  const ctx = {
    state: 'running',
    currentTime: 10,
    destination: {},
    createGain() {
      const g = { gain: { value: 1 }, connect: vi.fn() }
      gains.push(g)
      return g
    },
    createBufferSource() {
      const src = {
        buffer: null,
        playbackRate: { value: 1 },
        connect: (g: { gain: { value: number } }) => (src._gain = g),
        _gain: null as null | { gain: { value: number } },
        start: (at: number, offset: number, duration: number) => started.push({ rate: src.playbackRate.value, volume: src._gain?.gain.value ?? 1, at, offset, duration }),
      }
      return src
    },
    decodeAudioData: vi.fn(async () => ({ duration: 58 })),
    resume: vi.fn(async () => {}),
    suspend: vi.fn(async () => {}),
  }
  return { ctx: ctx as unknown as AudioContext, started, gains }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(opts: { hidden?: boolean; random?: number } = {}) {
  const audio = fakeAudio()
  let hidden = opts.hidden ?? false
  let now = 1000
  const load = vi.fn(async () => new ArrayBuffer(8))
  const player = new SoundPlayer({ createContext: () => audio.ctx, load, isHidden: () => hidden, random: () => opts.random ?? 0.5, now: () => now })
  return { player, audio, load, setHidden: (h: boolean) => (hidden = h), wait: (ms: number) => (now += ms) }
}

describe('sound gate', () => {
  it('plays nothing before a user gesture, and creates no audio context', () => {
    const createContext = vi.fn()
    const p = new SoundPlayer({ createContext, load: vi.fn(), isHidden: () => false })
    expect(p.play('save')).toBe(false)
    expect(createContext).not.toHaveBeenCalled()
  })

  it('loads the one sprite on the first gesture and plays at 30% master volume', async () => {
    const { player, audio, load } = setup()
    player.unlock()
    expect(audio.gains[0].gain.value).toBe(MASTER_VOLUME)
    expect(MASTER_VOLUME).toBe(0.3)
    expect(load).toHaveBeenCalledTimes(1)
    expect(player.play('save')).toBe(true)
    await flush()
    expect(audio.started).toHaveLength(1)
    expect(audio.started[0]).toMatchObject({ volume: KIT_SOUNDS.button.gain, offset: 0, at: 10 })
    expect(audio.started[0].duration).toBeCloseTo(0.1, 5)
  })

  it('stays silent while the tab is hidden', async () => {
    const { player, audio, setHidden } = setup({ hidden: true })
    player.unlock()
    expect(player.play('pick')).toBe(false)
    setHidden(false)
    expect(player.play('pick')).toBe(true)
    await flush()
    expect(audio.started).toHaveLength(1)
  })

  it('drops a queued sound if the tab hides before it starts', async () => {
    const { player, audio, setHidden } = setup()
    player.unlock()
    player.play('pick')
    setHidden(true)
    await flush()
    expect(audio.started).toHaveLength(0)
  })

  it('is off when the user turns Sounds off, Preview included', async () => {
    const { player, audio, wait } = setup()
    player.unlock()
    player.setEnabled(false)
    expect(player.play('prep-done')).toBe(false)
    expect(player.playKind('notification')).toBe(false)
    await flush()
    expect(audio.started).toHaveLength(0)
    player.setEnabled(true)
    wait(DEBOUNCE_MS)
    expect(player.play('prep-done')).toBe(true)
  })

  it('varies pitch by at most ±4%', async () => {
    for (const [random, expected] of [[0, 0.96], [0.999999, 1.04], [0.5, 1]] as const) {
      const { player, audio } = setup({ random })
      player.unlock()
      player.play('log')
      await flush()
      expect(audio.started[0].rate).toBeCloseTo(expected, 4)
    }
  })

  it('picks one of the five takes for tap and swipe', async () => {
    const offsets = new Set<number>()
    for (const random of [0, 0.2, 0.4, 0.6, 0.999999]) {
      const { player, audio } = setup({ random })
      player.unlock()
      player.play('swipe')
      await flush()
      offsets.add(audio.started[0].offset)
    }
    expect([...offsets].sort((a, b) => a - b)).toEqual(KIT_SOUNDS.swipe.at.map(([from]) => from))
  })
})

describe('debounce', () => {
  it('never starts two sounds within 120 ms', async () => {
    const { player, audio, wait } = setup()
    player.unlock()
    expect(player.play('save')).toBe(true)
    wait(DEBOUNCE_MS - 1)
    expect(player.play('undo')).toBe(false)
    expect(player.playKind('caution')).toBe(false)
    wait(1)
    expect(player.play('undo')).toBe(true)
    await flush()
    expect(audio.started.map((s) => s.offset)).toEqual([KIT_SOUNDS.button.at[0][0], KIT_SOUNDS.transition_down.at[0][0]])
    expect(DEBOUNCE_MS).toBe(120)
  })

  it('a refused play (gate closed) does not start the window', () => {
    const { player, setHidden } = setup({ hidden: true })
    player.unlock()
    expect(player.play('save')).toBe(false)
    setHidden(false)
    expect(player.play('save')).toBe(true)
  })
})

describe('the kit table', () => {
  it('maps every action to a sound in the kit', () => {
    for (const [action, kind] of Object.entries(ACTIONS)) expect(KINDS, action).toContain(kind)
    expect(Object.keys(KIT_SOUNDS).sort()).toEqual([...KINDS].sort())
  })

  it('maps each kind of action the way PST-304 asks', () => {
    const kindOf = (a: Action) => ACTIONS[a]
    expect(kindOf('pick')).toBe('tap')
    expect(kindOf('select')).toBe('select')
    expect(['save', 'log', 'ask'].map((a) => kindOf(a as Action))).toEqual(['button', 'button', 'button'])
    expect([kindOf('toggle-on'), kindOf('toggle-off')]).toEqual(['toggle_on', 'toggle_off'])
    expect([kindOf('stage-up'), kindOf('drawer-open')]).toEqual(['transition_up', 'transition_up'])
    expect([kindOf('park'), kindOf('undo'), kindOf('drawer-close')]).toEqual(['transition_down', 'transition_down', 'transition_down'])
    expect([kindOf('swipe'), kindOf('snooze')]).toEqual(['swipe', 'swipe'])
    expect([kindOf('import-done'), kindOf('feedback-sent'), kindOf('prep-done'), kindOf('export')]).toEqual(Array(4).fill('notification'))
    expect([kindOf('nope'), kindOf('save-failed'), kindOf('not-on-list')]).toEqual(Array(3).fill('caution'))
    expect([kindOf('signed'), kindOf('money-in'), kindOf('target-hit'), kindOf('inbox-cleared'), kindOf('confetti')]).toEqual(Array(5).fill('celebration'))
  })

  it('points at the right places in snd-lib’s SND01 sprite', () => {
    const json = join(dirname(createRequire(import.meta.url).resolve('snd-lib/package.json')), 'assets/sounds/sprite/01/audioSprite.json')
    const map: Record<string, { start: number; end: number }> = JSON.parse(readFileSync(json, 'utf8')).spritemap
    const takes = (k: string) => (map[`${k}_01`] ? [1, 2, 3, 4, 5].map((n) => map[`${k}_0${n}`]) : [map[k]])
    for (const kind of KINDS) {
      const want = takes(kind)
      expect(KIT_SOUNDS[kind].at, kind).toHaveLength(want.length)
      KIT_SOUNDS[kind].at.forEach(([from, to], i) => {
        expect(from, kind).toBeCloseTo(want[i].start, 3)
        expect(to, kind).toBeCloseTo(want[i].end, 2)
      })
    }
  })

  it('evens the levels out, with celebrate a little lower because it is longer', () => {
    for (const kind of KINDS) expect(KIT_SOUNDS[kind].gain, kind).toBeGreaterThan(0)
    for (const kind of KINDS) expect(KIT_SOUNDS[kind].gain, kind).toBeLessThanOrEqual(1.5)
    expect(KIT_SOUNDS.celebration.gain).toBeLessThan(KIT_SOUNDS.button.gain)
    expect(KIT_SOUNDS.transition_down.gain).toBeLessThan(KIT_SOUNDS.toggle_off.gain)
  })

  it('has one Preview button per kind of sound', () => {
    expect(PREVIEW.map((p) => p.label)).toEqual(['Tap', 'Save', 'Toggle', 'Up', 'Down', 'Swipe', 'Notify', 'Caution', 'Celebrate'])
    for (const p of PREVIEW) expect(KINDS).toContain(p.kind)
  })
})
