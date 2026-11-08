// Motion vocabulary from interactions.png. CSS lives in src/styles/motion.css;
// this file triggers the one-shot animations and draws confetti.
import { useEffect, useRef, useState, type CSSProperties } from 'react'

export const MOTION = {
  rise: { ms: 200, staggerMs: 60 },
  pop: { ms: 200 },
  wobble: { ms: 600 },
  shake: { ms: 400 },
  pulse: { ms: 2000 },
  shine: { ms: 900 },
  bob: { ms: 3000 },
  confetti: { ms: 1200 },
  toast: { ms: 200, holdMs: 4000 },
} as const

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** How to scroll something into view: smooth, or a jump under reduced motion. */
export const scrollBehavior = (): ScrollBehavior => (prefersReducedMotion() ? 'auto' : 'smooth')

/** Style for the nth element in a rising group (60ms stagger). */
export const rise = (i: number): CSSProperties => ({ ['--rise-i' as string]: i })

/** Restart a one-shot CSS animation class on an element. */
export function replay(el: Element | null | undefined, className: string) {
  if (!el) return
  el.classList.remove(className)
  void (el as HTMLElement).offsetWidth
  el.classList.add(className)
  el.addEventListener('animationend', () => el.classList.remove(className), { once: true })
}

export const pop = (el: Element | null | undefined) => replay(el, 'm-pop')
export const shake = (el: Element | null | undefined) => replay(el, 'm-shake')
export const wobble = (el: Element | null | undefined) => replay(el, 'm-wobble')
export const shine = (el: Element | null | undefined) => replay(el, 'm-shine')

// ---------- PST-298 interactions ----------
/** Motion for one interaction (interactions-batch-1.png): 150–200ms, ease-out. */
export const MOMENT_MS = 200
/** var(--ease-out), for animations started from script. */
export const momentEase = () => (typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue('--ease-out').trim()) || 'ease-out'

/**
 * A row leaving its list (interactions-batch-1.png): it folds up, sliding `slide`
 * px sideways and greying out first when asked. A fade under reduced motion.
 * Cancel the animation to bring the row back (a failed save).
 */
export function foldAway(el: HTMLElement | null | undefined, { slide = 0, grey = false }: { slide?: number; grey?: boolean } = {}): Animation | null {
  if (!el || typeof el.animate !== 'function') return null
  const h = el.offsetHeight + 'px'
  const filter = grey ? 'grayscale(1)' : 'none'
  const frames: Keyframe[] = prefersReducedMotion()
    ? [{ opacity: 1 }, { opacity: 0 }]
    : [
        { height: h, opacity: 1, transform: 'none', filter: 'none', overflow: 'hidden' },
        ...(grey ? [{ height: h, opacity: 0.55, transform: 'none', filter, overflow: 'hidden', offset: 0.35 }] : []),
        { height: '0px', opacity: 0, transform: `translateX(${slide}px)`, filter, overflow: 'hidden' },
      ]
  return el.animate(frames, { duration: MOMENT_MS, easing: momentEase(), fill: 'forwards' })
}
// ---------- end PST-298 interactions ----------

/** Pops the element whenever `value` changes after the first render. */
export function usePop<T extends HTMLElement>(value: unknown) {
  const ref = useRef<T>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    pop(ref.current)
  }, [value])
  return ref
}

const CONFETTI_COLORS = ['#A9EC19', '#FF6420', '#003F2E', '#10884C', '#FF9437']

/**
 * Confetti bursting from an element, 1.2s, once. Under reduced motion it is a
 * still burst that fades out.
 */
export function confetti(from: Element | null | undefined, { count = 46 }: { count?: number } = {}) {
  if (typeof document === 'undefined' || !from) return
  const r = from.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  const layer = document.createElement('div')
  layer.className = 'm-confetti'
  layer.setAttribute('aria-hidden', 'true')
  document.body.appendChild(layer)
  const still = prefersReducedMotion()
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i')
    if (i % 3 === 0) p.className = 'round'
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
    p.style.left = `${cx}px`
    p.style.top = `${cy}px`
    layer.appendChild(p)
    const a = Math.random() * Math.PI * 2
    const v = 90 + Math.random() * 160
    const tx = Math.cos(a) * v
    const ty = Math.sin(a) * v * 0.7 - 60
    if (still || typeof p.animate !== 'function') {
      p.style.transform = `translate(${tx}px, ${ty}px) rotate(${Math.random() * 360}deg)`
      continue
    }
    p.animate(
      [
        { transform: 'translate(0, 0) rotate(0)', opacity: 1 },
        { transform: `translate(${tx}px, ${ty}px) rotate(${Math.random() * 540}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${tx * 1.15}px, ${ty + 120}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
      ],
      { duration: MOTION.confetti.ms, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
    )
  }
  if (still && typeof layer.animate === 'function')
    layer.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: MOTION.confetti.ms, fill: 'forwards' })
  setTimeout(() => layer.remove(), MOTION.confetti.ms + 100)
}

/** Counts from `from` up to `to` (ease-out, 600ms by default); jumps straight there under reduced motion. */
export function useCountUp(to: number, { from = 0, ms = 600, delay = 0 }: { from?: number; ms?: number; delay?: number } = {}) {
  const [n, setN] = useState(from)
  useEffect(() => {
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
      setN(to)
      return
    }
    let raf = 0
    let start = 0
    const tick = (t: number) => {
      if (!start) start = t
      const k = Math.min(1, Math.max(0, (t - start - delay) / ms))
      setN(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, from, ms, delay])
  return n
}

/** True once the element has scrolled into view (stays true). For bars that fill when seen. */
export function useInView<T extends Element>() {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    if (typeof IntersectionObserver !== 'function') return setSeen(true)
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setSeen(true)
        io.disconnect()
      }
    }, { threshold: 0.2 })
    io.observe(el)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen] as const
}
