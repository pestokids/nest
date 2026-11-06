// The original Pesto logo, alive (reference/nest-motion.html, "Logo tile").
// Built from pesto-animatable-v2.svg, whose parts carry the classes we animate:
// lid-top, lid-bot (blink), cheek (happy squint), jaw (chirp), gaze (pupils),
// brow and head.
import { useEffect, useRef, useState } from 'react'
import logoSvg from '../assets/pesto-animatable-v2.svg?raw'
import { prefersReducedMotion } from '../lib/motion'
import { play } from '../lib/sound'

const markup = { __html: logoSvg }

export function LogoTile({ hello }: { hello: string }) {
  const tile = useRef<HTMLButtonElement>(null)
  const [note, setNote] = useState(false)

  // Blink every 4–7s, sometimes twice.
  useEffect(() => {
    if (prefersReducedMotion()) return
    const timers: ReturnType<typeof setTimeout>[] = []
    const blink = (ms: number) => {
      const el = tile.current
      if (!el) return
      el.classList.add('blink')
      timers.push(setTimeout(() => el.classList.remove('blink'), ms))
    }
    const loop = () => {
      timers.push(
        setTimeout(() => {
          blink(130)
          if (Math.random() < 0.25) timers.push(setTimeout(() => blink(120), 260))
          loop()
        }, 4000 + Math.random() * 3000),
      )
    }
    loop()
    return () => timers.forEach(clearTimeout)
  }, [])

  // Pupils follow the cursor (220ms ease-out, in CSS).
  useEffect(() => {
    const el = tile.current
    if (!el) return
    const gazes = el.querySelectorAll<SVGGElement>('.gaze')
    let raf = 0
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 500))
        const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 500))
        gazes.forEach((g, i) => (g.style.transform = `translate(${dx * (i ? 26 : 14)}px, ${dy * (i ? 22 : 13)}px)`))
      })
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [])

  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => {
      setNote(false)
      tile.current?.classList.remove('happy')
    }, 1600)
    return () => clearTimeout(t)
  }, [note])

  return (
    <div className="logo-tile-wrap">
      <button
        ref={tile}
        type="button"
        className="logo-tile"
        aria-label="Pesto. Say hi"
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch') return
          const el = e.currentTarget
          el.classList.remove('chirp')
          void el.offsetWidth
          el.classList.add('chirp')
        }}
        onPointerLeave={(e) => e.currentTarget.classList.remove('chirp')}
        onClick={(e) => {
          const el = e.currentTarget
          el.classList.remove('hop')
          void el.offsetWidth
          el.classList.add('hop', 'happy')
          setNote(true)
          play('pesto-chirp')
          play('pesto-hop', { delay: 0.05, volume: 0.6 })
        }}
        onAnimationEnd={(e) => {
          if (e.animationName === 'logo-hop') e.currentTarget.classList.remove('hop')
        }}
      >
        <span className="logo-tile__art" dangerouslySetInnerHTML={markup} />
      </button>
      <span className={`logo-tile__note ${note ? 'is-on' : ''}`} aria-live="polite">
        {note ? hello : ''}
      </span>
    </div>
  )
}
