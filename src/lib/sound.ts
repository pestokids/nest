// One small Web Audio player for the UI sounds in public/sounds/.
// Rules (interactions.png, Sounds card): only after a user action, never on
// hover or page load; 40% master volume; ±4% random pitch; silent while the
// tab is hidden; off when the user turns Sounds off.

export const SOUNDS = [
  'ask-logged', 'card-drop', 'card-pickup', 'confetti', 'drawer', 'egg-crack', 'export', 'import-done',
  'nope', 'not-on-list', 'nudge', 'park', 'pesto-chirp', 'pesto-hop', 'prep-done', 'rule-check',
  'save-failed', 'signed-in', 'signed-out', 'signed', 'spill', 'stage-up', 'target-hit', 'undo',
] as const
export type SoundName = (typeof SOUNDS)[number]
export type PlayOptions = { volume?: number; delay?: number; rate?: number }

export const MASTER_VOLUME = 0.4
export const PITCH_JITTER = 0.04

type Env = {
  createContext: () => AudioContext | null
  load: (name: SoundName) => Promise<ArrayBuffer>
  isHidden: () => boolean
  random: () => number
}

const browserEnv = (): Env => ({
  createContext: () => {
    const Ctx = typeof window !== 'undefined' ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined
    return Ctx ? new Ctx() : null
  },
  load: (name) => fetch(`/sounds/${name}.mp3`).then((r) => r.arrayBuffer()),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  random: Math.random,
})

export class SoundPlayer {
  private env: Env
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private buffers = new Map<SoundName, Promise<AudioBuffer | null>>()
  /** True once a user gesture has happened (the only time audio may start). */
  unlocked = false
  enabled = true

  constructor(env: Partial<Env> = {}) {
    this.env = { ...browserEnv(), ...env }
  }

  setEnabled(on: boolean) {
    this.enabled = on
  }

  /** Call from a user gesture (pointerdown / keydown). Creates the context and starts decoding. */
  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    try {
      this.ctx = this.env.createContext()
    } catch {
      this.ctx = null
    }
    if (!this.ctx) return
    this.master = this.ctx.createGain()
    this.master.gain.value = MASTER_VOLUME
    this.master.connect(this.ctx.destination)
    for (const n of SOUNDS) void this.buffer(n)
  }

  private buffer(name: SoundName): Promise<AudioBuffer | null> {
    let b = this.buffers.get(name)
    if (!b) {
      const ctx = this.ctx
      b = ctx
        ? this.env
            .load(name)
            .then((data) => ctx.decodeAudioData(data))
            .catch(() => null)
        : Promise.resolve(null)
      this.buffers.set(name, b)
    }
    return b
  }

  /** Whether a sound would play right now. */
  canPlay(): boolean {
    return this.enabled && this.unlocked && !!this.ctx && !this.env.isHidden()
  }

  /** Plays `name`; returns false when the gate is closed (no gesture yet, hidden, or Sounds off). */
  play(name: SoundName, { volume = 1, delay = 0, rate = 1 }: PlayOptions = {}): boolean {
    if (!this.canPlay()) return false
    const ctx = this.ctx!
    const startAt = ctx.currentTime + delay
    if (ctx.state === 'suspended') void ctx.resume()
    void this.buffer(name).then((buf) => {
      if (!buf || !this.canPlay()) return
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = rate * (1 + (this.env.random() - 0.5) * 2 * PITCH_JITTER)
      const g = ctx.createGain()
      g.gain.value = volume
      src.connect(g)
      g.connect(this.master!)
      src.start(Math.max(ctx.currentTime, startAt))
    })
    return true
  }

  /** Suspend while hidden so nothing queued plays in the background. */
  onVisibility() {
    if (!this.ctx) return
    if (this.env.isHidden()) void this.ctx.suspend()
    else void this.ctx.resume()
  }
}

/** The app's player. Wired to gestures and visibility by installSound(). */
export const sound = new SoundPlayer()
export const play = (name: SoundName, opts?: PlayOptions) => sound.play(name, opts)

let installed = false
/** Unlock on the first gesture; follow tab visibility. Safe to call more than once. */
export function installSound() {
  if (installed || typeof document === 'undefined') return
  installed = true
  const unlock = () => sound.unlock()
  document.addEventListener('pointerdown', unlock, { once: true, capture: true })
  document.addEventListener('keydown', unlock, { once: true, capture: true })
  document.addEventListener('visibilitychange', () => sound.onVisibility())
}

const PREF_KEY = 'nest_sounds'
/** Last known Sounds preference on this device; used until the Convex row loads. */
export function localSoundsPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off'
  } catch {
    return true
  }
}
export function saveLocalSoundsPref(on: boolean) {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off')
  } catch {
    /* private mode */
  }
}
