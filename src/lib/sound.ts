// One small Web Audio player for Nest's UI sounds: the SND01 "sine" kit by
// Yasuhiro Tsuchiya (snd.dev, via the snd-lib package). Its one sprite is copied
// into public/sounds/snd01/ at build time (vite.config.ts) and never committed.
// Rules: only after a user action, never on hover or page load; 30% master
// volume; ±4% random pitch; never two sounds within 120 ms; silent while the
// tab is hidden; off when the user turns Sounds off.

export const KIT = { name: 'SND01 “sine”', designer: 'Yasuhiro Tsuchiya', url: 'https://snd.dev/' } as const
export const SPRITE_URL = '/sounds/snd01/audioSprite.m4a'

export const KINDS = ['tap', 'select', 'button', 'toggle_on', 'toggle_off', 'transition_up', 'transition_down', 'swipe', 'notification', 'caution', 'celebration'] as const
export type Kind = (typeof KINDS)[number]

/** Where each kind sits in the sprite, in seconds, and its gain so the kit plays at an even loudness. Tap and swipe have five takes; one is picked at random. */
export const KIT_SOUNDS: Record<Kind, { at: readonly (readonly [number, number])[]; gain: number }> = {
  tap: { at: [[30, 30.01], [32, 32.01], [34, 34.01], [36, 36.01], [38, 38.01]], gain: 0.8 },
  select: { at: [[16, 16.1]], gain: 1.3 },
  button: { at: [[0, 0.1]], gain: 1 },
  toggle_on: { at: [[42, 42.1]], gain: 1.3 },
  toggle_off: { at: [[40, 40.1]], gain: 1.3 },
  transition_up: { at: [[46, 46.101]], gain: 0.5 },
  transition_down: { at: [[44, 44.1]], gain: 0.45 },
  swipe: { at: [[20, 20.15], [22, 22.15], [24, 24.15], [26, 26.15], [28, 28.15]], gain: 1.3 },
  notification: { at: [[8, 8.3]], gain: 0.7 },
  caution: { at: [[2, 2.161]], gain: 0.45 },
  celebration: { at: [[4, 5]], gain: 0.8 },
}

/** Every Nest action that makes a sound, and the kit sound made for it. */
export const ACTIONS = {
  pick: 'tap',
  select: 'select',
  save: 'button',
  log: 'button',
  ask: 'button',
  'toggle-on': 'toggle_on',
  'toggle-off': 'toggle_off',
  'stage-up': 'transition_up',
  'drawer-open': 'transition_up',
  'stage-down': 'transition_down',
  park: 'transition_down',
  remove: 'transition_down',
  undo: 'transition_down',
  'drawer-close': 'transition_down',
  swipe: 'swipe',
  snooze: 'swipe',
  'import-done': 'notification',
  'feedback-sent': 'notification',
  'prep-done': 'notification',
  export: 'notification',
  nope: 'caution',
  'save-failed': 'caution',
  failed: 'caution',
  'not-on-list': 'caution',
  signed: 'celebration',
  'money-in': 'celebration',
  'target-hit': 'celebration',
  'inbox-cleared': 'celebration',
  confetti: 'celebration',
} as const satisfies Record<string, Kind>
export type Action = keyof typeof ACTIONS

/** Settings › Sounds: one Preview button per kind. */
export const PREVIEW: readonly { label: string; kind: Kind }[] = [
  { label: 'Tap', kind: 'tap' },
  { label: 'Save', kind: 'button' },
  { label: 'Toggle', kind: 'toggle_on' },
  { label: 'Up', kind: 'transition_up' },
  { label: 'Down', kind: 'transition_down' },
  { label: 'Swipe', kind: 'swipe' },
  { label: 'Notify', kind: 'notification' },
  { label: 'Caution', kind: 'caution' },
  { label: 'Celebrate', kind: 'celebration' },
]

export const MASTER_VOLUME = 0.3
export const PITCH_JITTER = 0.04
export const DEBOUNCE_MS = 120

type Env = {
  createContext: () => AudioContext | null
  load: () => Promise<ArrayBuffer>
  isHidden: () => boolean
  random: () => number
  now: () => number
}

const browserEnv = (): Env => ({
  createContext: () => {
    const Ctx = typeof window !== 'undefined' ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext : undefined
    return Ctx ? new Ctx() : null
  },
  load: () => fetch(SPRITE_URL).then((r) => r.arrayBuffer()),
  isHidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
  random: Math.random,
  now: () => performance.now(),
})

export class SoundPlayer {
  private env: Env
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sprite: Promise<AudioBuffer | null> = Promise.resolve(null)
  private last = -Infinity
  /** True once a user gesture has happened (the only time audio may start). */
  unlocked = false
  enabled = true

  constructor(env: Partial<Env> = {}) {
    this.env = { ...browserEnv(), ...env }
  }

  setEnabled(on: boolean) {
    this.enabled = on
  }

  /** Call from a user gesture (pointerdown / keydown). Creates the context and starts decoding the sprite. */
  unlock() {
    if (this.unlocked) return
    this.unlocked = true
    try {
      this.ctx = this.env.createContext()
    } catch {
      this.ctx = null
    }
    const ctx = this.ctx
    if (!ctx) return
    this.master = ctx.createGain()
    this.master.gain.value = MASTER_VOLUME
    this.master.connect(ctx.destination)
    this.sprite = this.env
      .load()
      .then((data) => ctx.decodeAudioData(data))
      .catch(() => null)
  }

  /** Whether a sound would play right now. */
  canPlay(): boolean {
    return this.enabled && this.unlocked && !!this.ctx && !this.env.isHidden()
  }

  /** Plays the kit sound mapped to `action`; false when the gate is closed or another sound started under 120 ms ago. */
  play(action: Action): boolean {
    return this.playKind(ACTIONS[action])
  }

  /** Plays one kit sound directly (Settings › Sounds › Preview). Same gate and debounce as play(). */
  playKind(kind: Kind): boolean {
    if (!this.canPlay()) return false
    const t = this.env.now()
    if (t - this.last < DEBOUNCE_MS) return false
    this.last = t
    const ctx = this.ctx!
    if (ctx.state === 'suspended') void ctx.resume()
    const { at, gain } = KIT_SOUNDS[kind]
    const [from, to] = at[Math.min(at.length - 1, Math.floor(this.env.random() * at.length))]
    const rate = 1 + (this.env.random() - 0.5) * 2 * PITCH_JITTER
    void this.sprite.then((buf) => {
      if (!buf || !this.canPlay()) return
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = rate
      const g = ctx.createGain()
      g.gain.value = gain
      src.connect(g)
      g.connect(this.master!)
      src.start(ctx.currentTime, from, to - from)
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
export const play = (action: Action) => sound.play(action)
export const preview = (kind: Kind) => sound.playKind(kind)

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
