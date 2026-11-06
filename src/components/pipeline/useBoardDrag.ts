// Drag and drop for the board, ported from reference/nest-motion.html (no library):
// a mouse or pen lifts a card after 5px; a finger after a 220ms hold (so a
// swipe still scrolls). The lifted copy follows the pointer, the board
// auto-scrolls near its edges (up to 10px a frame) and Esc cancels.
import { useEffect, useRef, useState, type RefObject } from 'react'

const MOUSE_SLOP = 5
const TOUCH_SLOP = 8
const TOUCH_HOLD_MS = 220
const EDGE = 70
const MAX_STEP = 10

export type DragHandlers = {
  /** The card left the board: render its faded copy and start showing drop slots. */
  onLift: (id: string, height: number) => void
  /** The drop target under the pointer changed (a `data-drop` stage, or null). */
  onOver: (stage: string | null) => void
  onDrop: (id: string, stage: string | null) => void
  /** Esc (`byUser`) or the browser took the pointer away. */
  onCancel: (byUser: boolean) => void
}

type Drag = {
  id: string
  card: HTMLElement
  type: string
  sx: number
  sy: number
  x: number
  y: number
  dx: number
  dy: number
  live: boolean
  over: string | null
  list: HTMLElement | null
  ghost: HTMLElement | null
  raf: number
  timer: ReturnType<typeof setTimeout> | undefined
}

export function useBoardDrag(scroller: RefObject<HTMLElement | null>, handlers: DragHandlers) {
  const cb = useRef(handlers)
  useEffect(() => {
    cb.current = handlers
  })
  // One set of listeners for the board's lifetime, so add and remove always match.
  const [api] = useState(() => makeDrag(scroller, cb))
  useEffect(() => () => api.stop(), [api])
  return api
}

function makeDrag(scroller: RefObject<HTMLElement | null>, cb: { readonly current: DragHandlers }) {
  let st: Drag | null = null
  let swallow = false
  const place = (d: Drag) => {
    if (d.ghost) d.ghost.style.translate = `${d.x - d.dx}px ${d.y - d.dy}px`
  }

  const hitTest = (d: Drag) => {
    const el = document.elementFromPoint(d.x, d.y)
    const target = el?.closest<HTMLElement>('[data-drop]') ?? null
    d.list = target?.querySelector<HTMLElement>('[data-drop-list]') ?? null
    const stage = target?.dataset.drop ?? null
    if (stage !== d.over) {
      d.over = stage
      cb.current.onOver(stage)
    }
  }

  const tick = () => {
    const d = st
    if (!d || !d.live) return
    let moved = false
    const sc = scroller.current
    if (sc) {
      const r = sc.getBoundingClientRect()
      if (d.y > r.top && d.y < r.bottom) {
        const before = sc.scrollLeft
        if (d.x > r.right - EDGE) sc.scrollLeft += Math.min(MAX_STEP, (d.x - (r.right - EDGE)) / 6)
        else if (d.x < r.left + EDGE) sc.scrollLeft -= Math.min(MAX_STEP, (r.left + EDGE - d.x) / 6)
        moved ||= sc.scrollLeft !== before
      }
    }
    const l = d.list
    if (l) {
      const r = l.getBoundingClientRect()
      const before = l.scrollTop
      if (d.x > r.left && d.x < r.right) {
        if (d.y > r.bottom - EDGE * 0.7) l.scrollTop += Math.min(MAX_STEP, (d.y - (r.bottom - EDGE * 0.7)) / 4)
        else if (d.y < r.top + EDGE * 0.7) l.scrollTop -= Math.min(MAX_STEP, (r.top + EDGE * 0.7 - d.y) / 4)
      }
      moved ||= l.scrollTop !== before
    }
    if (moved) hitTest(d)
    d.raf = requestAnimationFrame(tick)
  }

  const lift = (d: Drag) => {
    d.live = true
    const r = d.card.getBoundingClientRect()
    const g = d.card.cloneNode(true) as HTMLElement
    g.classList.remove('pb-card--ghost', 'pb-card--settle')
    g.classList.add('pb-card--lifted')
    g.removeAttribute('tabindex')
    g.removeAttribute('data-card')
    g.setAttribute('aria-hidden', 'true')
    g.style.width = `${r.width}px`
    d.ghost = g
    place(d)
    document.body.appendChild(g)
    document.documentElement.classList.add('pb-dragging')
    if (d.type === 'touch') navigator.vibrate?.(8)
    cb.current.onLift(d.id, r.height)
    hitTest(d)
    d.raf = requestAnimationFrame(tick)
  }

  const onMove = (e: PointerEvent) => {
    const d = st
    if (!d) return
    d.x = e.clientX
    d.y = e.clientY
    if (!d.live) {
      const dist = Math.hypot(d.x - d.sx, d.y - d.sy)
      if (d.type === 'touch') {
        if (dist > TOUCH_SLOP) stop() // a scroll, not a hold
      } else if (dist >= MOUSE_SLOP) lift(d)
      return
    }
    place(d)
    hitTest(d)
  }

  const onUp = () => {
    const d = st
    if (!d) return
    const { live, id, over } = d
    stop()
    if (!live) return
    swallow = true
    setTimeout(() => {
      swallow = false
    }, 0)
    cb.current.onDrop(id, over)
  }

  const onCancelPointer = () => {
    const d = st
    if (!d) return
    const live = d.live
    stop()
    if (live) cb.current.onCancel(false)
  }

  const onKey = (e: KeyboardEvent) => {
    const d = st
    if (!d?.live || e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    stop()
    cb.current.onCancel(true)
  }

  // While a finger drags, the page must not scroll.
  const onTouchMove = (e: TouchEvent) => {
    if (st?.live) e.preventDefault()
  }
  const onContextMenu = (e: Event) => {
    if (st) e.preventDefault()
  }

  const stop = () => {
    const d = st
    st = null
    if (!d) return
    clearTimeout(d.timer)
    cancelAnimationFrame(d.raf)
    d.ghost?.remove()
    document.documentElement.classList.remove('pb-dragging')
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancelPointer)
    window.removeEventListener('keydown', onKey, true)
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('contextmenu', onContextMenu)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || st) return
    if ((e.target as Element).closest('button, a, input, select, textarea')) return
    const card = e.currentTarget
    const r = card.getBoundingClientRect()
    const d: Drag = {
      id, card, type: e.pointerType, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      dx: e.clientX - r.left, dy: e.clientY - r.top, live: false, over: null, list: null, ghost: null, raf: 0, timer: undefined,
    }
    st = d
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancelPointer)
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('contextmenu', onContextMenu)
    if (e.pointerType !== 'mouse' && e.pointerType !== 'pen')
      d.timer = setTimeout(() => {
        if (st === d && !d.live) lift(d)
      }, TOUCH_HOLD_MS)
  }

  /** True once right after a drop, so the drop's click doesn't open the card. */
  const consumeClick = () => {
    if (!swallow) return false
    swallow = false
    return true
  }

  return { onPointerDown, consumeClick, stop }
}
