import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/*
 * One overlay for dialogs, sheets and the palette: a centred card on desktop,
 * a bottom sheet on phones (a full-height sheet for `variant="palette"`).
 *
 * Not a native <dialog>: showModal() puts it in the top layer and makes the
 * rest of the page inert, and app toasts (the save-failed toast with Retry)
 * must stay above it and clickable. So it does by hand what <dialog> would:
 * aria-modal, the page behind made inert (but not the toast region), focus
 * moved in and returned, Tab kept inside, Esc closes. Scroll stays put with
 * overscroll-behavior on the overlay rather than overflow:hidden on <body>.
 */
let openCount = 0
const INERT = '.topbar, .app-main'
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type ModalVariant = 'dialog' | 'palette' | 'menu'

export function Modal({
  onClose, labelledBy, label, variant = 'dialog', className, children, initialFocus,
}: {
  onClose: () => void
  /** id of the visible title; or `label` when there isn't one. */
  labelledBy?: string
  label?: string
  variant?: ModalVariant
  className?: string
  children: ReactNode
  /** Selector inside the panel to focus first, or 'panel' for the dialog itself (defaults to [autofocus], then the first control). */
  initialFocus?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    openCount++
    if (openCount === 1) document.querySelectorAll(INERT).forEach((el) => el.setAttribute('inert', ''))
    const p = panel.current
    const first = (initialFocus === 'panel' && p) || (initialFocus && p?.querySelector<HTMLElement>(initialFocus)) || p?.querySelector<HTMLElement>('[autofocus], [data-autofocus]') || p?.querySelector<HTMLElement>(FOCUSABLE) || p
    first?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
      } else if (e.key === 'Tab' && p) {
        const els = [...p.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (!els.length) return
        const a = els[0]
        const z = els[els.length - 1]
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault()
          z.focus()
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault()
          a.focus()
        }
      }
    }
    p?.addEventListener('keydown', onKey)
    return () => {
      p?.removeEventListener('keydown', onKey)
      openCount--
      if (openCount === 0) document.querySelectorAll(INERT).forEach((el) => el.removeAttribute('inert'))
      before?.focus?.({ preventScroll: true })
    }
  }, [initialFocus])

  return createPortal(
    <div className={`sys-modal sys-modal--${variant}`}>
      <div className="sys-modal__scrim" onClick={() => close.current()} aria-hidden="true" />
      <div
        ref={panel}
        className={['sys-modal__panel', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        tabIndex={-1}
      >
        {variant !== 'palette' ? <span className="sys-modal__grip" aria-hidden="true" /> : null}
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** A stable id for a modal title. */
export const useTitleId = () => 'm' + useId().replace(/:/g, '')
