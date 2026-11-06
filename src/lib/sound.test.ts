import { describe, expect, it, vi } from 'vitest'
import { MASTER_VOLUME, SOUNDS, SoundPlayer } from './sound'

/** A fake AudioContext that records what was started. */
function fakeAudio() {
  const started: { rate: number; volume: number; at: number }[] = []
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
        start: (at: number) => started.push({ rate: src.playbackRate.value, volume: src._gain?.gain.value ?? 1, at }),
      }
      return src
    },
    decodeAudioData: vi.fn(async () => ({ duration: 0.3 })),
    resume: vi.fn(async () => {}),
    suspend: vi.fn(async () => {}),
  }
  return { ctx: ctx as unknown as AudioContext, started, gains }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function setup(opts: { hidden?: boolean; random?: number } = {}) {
  const audio = fakeAudio()
  let hidden = opts.hidden ?? false
  const load = vi.fn(async () => new ArrayBuffer(8))
  const player = new SoundPlayer({ createContext: () => audio.ctx, load, isHidden: () => hidden, random: () => opts.random ?? 0.5 })
  return { player, audio, load, setHidden: (h: boolean) => (hidden = h) }
}

describe('sound gate', () => {
  it('plays nothing before a user gesture, and creates no audio context', () => {
    const createContext = vi.fn()
    const p = new SoundPlayer({ createContext, load: vi.fn(), isHidden: () => false })
    expect(p.play('pesto-chirp')).toBe(false)
    expect(createContext).not.toHaveBeenCalled()
  })

  it('plays after the first gesture at 40% master volume', async () => {
    const { player, audio, load } = setup()
    player.unlock()
    expect(audio.gains[0].gain.value).toBe(MASTER_VOLUME)
    expect(load).toHaveBeenCalledTimes(SOUNDS.length)
    expect(player.play('pesto-chirp', { volume: 0.6 })).toBe(true)
    await flush()
    expect(audio.started).toHaveLength(1)
    expect(audio.started[0].volume).toBe(0.6)
  })

  it('stays silent while the tab is hidden', async () => {
    const { player, audio, setHidden } = setup({ hidden: true })
    player.unlock()
    expect(player.play('card-pickup')).toBe(false)
    setHidden(false)
    expect(player.play('card-pickup')).toBe(true)
    await flush()
    expect(audio.started).toHaveLength(1)
  })

  it('drops a queued sound if the tab hides before it starts', async () => {
    const { player, audio, setHidden } = setup()
    player.unlock()
    player.play('card-pickup')
    setHidden(true)
    await flush()
    expect(audio.started).toHaveLength(0)
  })

  it('is off when the user turns Sounds off', async () => {
    const { player, audio } = setup()
    player.unlock()
    player.setEnabled(false)
    expect(player.play('prep-done')).toBe(false)
    await flush()
    expect(audio.started).toHaveLength(0)
    player.setEnabled(true)
    expect(player.play('prep-done')).toBe(true)
  })

  it('varies pitch by at most ±4% around the requested rate', async () => {
    for (const [random, expected] of [[0, 0.96], [1, 1.04], [0.5, 1]] as const) {
      const { player, audio } = setup({ random })
      player.unlock()
      player.play('nudge')
      await flush()
      expect(audio.started[0].rate).toBeCloseTo(expected, 5)
    }
    const { player, audio } = setup({ random: 1 })
    player.unlock()
    player.play('card-pickup', { rate: 1.2 })
    await flush()
    expect(audio.started[0].rate).toBeCloseTo(1.248, 5)
  })

  it('schedules delayed sounds from the context clock', async () => {
    const { player, audio } = setup()
    player.unlock()
    player.play('confetti', { delay: 0.15 })
    await flush()
    expect(audio.started[0].at).toBeCloseTo(10.15, 5)
  })

  it('has a file name for every sound', () => {
    expect(new Set(SOUNDS).size).toBe(24)
  })
})
