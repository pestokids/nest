import { useEffect, useRef } from 'react'
import { todayIST } from '../../lib/dates'
import { shine } from '../../lib/motion'
import { hitKeys, newlyHit, phaseStatuses } from '../../lib/plan'
import { play } from '../../lib/sound'
import { useRaise } from '../data'
import { useSession } from '../session'

/*
 * "Target hit": the target-hit sound and a shine on the phase card, the first
 * time a phase's goal is reached, once per phase per user (remembered on this
 * device), never on page load. Only after something you did: a hit that lands
 * while you've been idle (a teammate's change syncing in) stays quiet.
 */
const GESTURE_WINDOW_MS = 15000
const SHINE_WINDOW_MS = 60000

let lastGesture = 0
let installed = false
function installGestures() {
  if (installed || typeof document === 'undefined') return
  installed = true
  const mark = () => (lastGesture = Date.now())
  document.addEventListener('pointerdown', mark, { capture: true, passive: true })
  document.addEventListener('keydown', mark, { capture: true })
}

const storeKey = (who: string) => `nest_target_hits:${who.toLowerCase()}`
function celebrated(who: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(who)) ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
function remember(who: string, keys: Set<string>) {
  try {
    localStorage.setItem(storeKey(who), JSON.stringify([...keys]))
  } catch {
    /* private mode */
  }
}

const pendingShine = new Map<string, number>()
const shineListeners = new Set<() => void>()

/** Mounted once in the Raise layout: watches every phase's goal while you work. */
export function TargetHitWatcher() {
  const d = useRaise()
  const { me } = useSession()
  const who = me.email || me.firstName
  const now = hitKeys(phaseStatuses(d.round, d.investors, d.acts, todayIST()))
  const nowKey = [...now].sort().join('|')
  const before = useRef<Set<string> | null>(null)

  useEffect(installGestures, [])
  useEffect(() => {
    const done = celebrated(who)
    const fresh = newlyHit(before.current, now, done)
    before.current = now
    if (!fresh.length || Date.now() - lastGesture > GESTURE_WINDOW_MS) return
    fresh.forEach((k) => {
      done.add(k)
      pendingShine.set(k, Date.now())
    })
    remember(who, done)
    play('target-hit')
    shineListeners.forEach((l) => l())
  }, [nowKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

/** Ref for a Plan phase card: shines once when its goal was just hit. */
export function useHitShine<T extends HTMLElement>(phaseKey: string) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const take = () => {
      const at = pendingShine.get(phaseKey)
      if (at === undefined) return
      pendingShine.delete(phaseKey)
      if (Date.now() - at < SHINE_WINDOW_MS) shine(ref.current)
    }
    take()
    shineListeners.add(take)
    return () => {
      shineListeners.delete(take)
    }
  }, [phaseKey])
  return ref
}
