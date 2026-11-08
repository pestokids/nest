import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { scrollBehavior } from '../../lib/motion'

/**
 * The board's sideways scroll: edge fades on whichever side has more, and a
 * thin always-visible scrollbar (drag the thumb or click the track). Trackpad
 * and shift + wheel scroll the board natively.
 */
export function Scrollbar({ scroller, children }: { scroller: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const [m, setM] = useState({ left: 0, width: 1, fadeL: false, fadeR: false })
  const track = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const sc = scroller.current
    if (!sc) return
    const upd = () => {
      const max = sc.scrollWidth - sc.clientWidth
      const width = sc.scrollWidth ? sc.clientWidth / sc.scrollWidth : 1
      const left = max > 0 ? (sc.scrollLeft / max) * (1 - width) : 0
      setM({ left, width, fadeL: sc.scrollLeft > 4, fadeR: sc.scrollLeft < max - 4 })
    }
    upd()
    sc.addEventListener('scroll', upd, { passive: true })
    const ro = new ResizeObserver(upd)
    ro.observe(sc)
    const mo = new MutationObserver(upd)
    mo.observe(sc, { childList: true })
    return () => {
      sc.removeEventListener('scroll', upd)
      ro.disconnect()
      mo.disconnect()
    }
  }, [scroller])

  const toRatio = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return (clientX - r.left) / r.width
  }
  const onTrack = (e: React.PointerEvent<HTMLDivElement>) => {
    const sc = scroller.current
    if (!sc || e.button !== 0) return
    const onThumb = (e.target as HTMLElement).classList.contains('pb-scroll__thumb')
    const start = toRatio(e.clientX)
    const startLeft = sc.scrollLeft
    if (!onThumb) sc.scrollTo({ left: (start - m.width / 2) * sc.scrollWidth, behavior: scrollBehavior() })
    if (!onThumb) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      sc.scrollLeft = startLeft + (toRatio(ev.clientX) - start) * sc.scrollWidth
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="pb-scrollwrap">
      <div className={['pb-fade pb-fade--l', m.fadeL && 'pb-fade--on'].filter(Boolean).join(' ')} aria-hidden="true" />
      {children}
      <div className={['pb-fade pb-fade--r', m.fadeR && 'pb-fade--on'].filter(Boolean).join(' ')} aria-hidden="true" />
      <div className="pb-scroll" ref={track} onPointerDown={onTrack} aria-hidden="true" hidden={m.width >= 1}>
        <div className="pb-scroll__thumb" style={{ left: `${m.left * 100}%`, width: `${m.width * 100}%` }} />
      </div>
    </div>
  )
}
