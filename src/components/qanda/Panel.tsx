// PST-281: the side panel the Q&A uses (Answer a question, the prep brief): the
// investor drawer's look (screens/raise-qanda/answer-a-question.png), a bottom
// sheet on phones. It can sit on top of the drawer: its own scrim, Esc and Tab
// stay inside it, focus goes back where it was.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const LEAVE_MS = 200

function usePhone() {
  const q = '(max-width: 720px)'
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useEffect(() => {
    const m = matchMedia(q)
    const fn = () => setOn(m.matches)
    m.addEventListener('change', fn)
    return () => m.removeEventListener('change', fn)
  }, [])
  return on
}

export type PanelControls = { close: () => void }

export function Panel({
  eyebrow, title, sub, level = 0, onClose, footer, children, className, tone,
}: {
  eyebrow: ReactNode
  title: ReactNode
  sub?: ReactNode
  /** Its place in the stack, so a later panel sits above an earlier one. */
  level?: number
  onClose: () => void
  /** Rendered with the panel's `close` (which plays the leaving animation first). */
  footer?: (c: PanelControls) => ReactNode
  children: (c: PanelControls) => ReactNode
  className?: string
  /** "new" colours the eyebrow orange (a question that needs an answer, a brief). */
  tone?: 'new'
}) {
  const sheet = usePhone()
  const [leaving, setLeaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const uid = useId()
  const done = useRef(onClose)
  useEffect(() => {
    done.current = onClose
  })
  const close = () => {
    if (leaving) return
    setLeaving(true)
    setTimeout(() => done.current(), LEAVE_MS)
  }
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const p = box.current
    ;(p?.querySelector<HTMLElement>('[data-autofocus]') ?? p)?.focus({ preventScroll: true })
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab' && p) {
        e.stopPropagation()
        const els = [...p.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (!els.length) return
        const first = els[0]
        const last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    p?.addEventListener('keydown', onKey)
    return () => {
      p?.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      if (before?.isConnected) requestAnimationFrame(() => before.focus({ preventScroll: true }))
    }
  }, [])

  const z = 62 + level * 2
  const c = { close }
  return createPortal(
    <>
      <div className={`scrim qa-scrim${leaving ? ' scrim--leaving' : ''}`} style={{ zIndex: z }} onClick={close} aria-hidden="true" />
      <div
        ref={box}
        className={['drawer', sheet ? 'drawer--sheet' : 'drawer--side', 'qa-panel', leaving && 'drawer--leaving', className].filter(Boolean).join(' ')}
        style={{ zIndex: z + 1 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        tabIndex={-1}
      >
        <div className="drawer__top">
          {sheet ? <div className="drawer__handle" aria-hidden="true" /> : null}
          <header className="drawer__head qa-panel__head">
            <div className={`drawer__eyebrow eyebrow-mono${tone === 'new' ? ' qa-eyebrow--new' : ''}`}>{eyebrow}</div>
            <div className="drawer__tools">
              <button type="button" className="drawer__icon" aria-label="Close" onClick={close}>
                <Icon name="close" size={22} />
              </button>
            </div>
            <h2 id={`${uid}-title`} className="drawer__title qa-panel__title">
              {title}
            </h2>
            {sub ? <p className="drawer__sub">{sub}</p> : null}
          </header>
        </div>
        <div className="drawer__body qa-panel__body">{children(c)}</div>
        {footer ? <footer className="drawer__foot drawer__foot--form qa-panel__foot">{footer(c)}</footer> : null}
      </div>
    </>,
    document.body,
  )
}
