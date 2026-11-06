import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from '../ui'
import { Modal, useTitleId } from './Modal'

const PHONE = '(max-width: 720px)'
/** True on phone widths (menus become bottom sheets). */
export function useIsPhone() {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(PHONE)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => matchMedia(PHONE).matches,
    () => false,
  )
}

export type MenuItem = { label: ReactNode; icon?: IconName; onSelect: () => void; danger?: boolean; checked?: boolean; disabled?: boolean }

/**
 * A short list of actions: a popover under its button on desktop, a bottom
 * sheet on phones. Arrow keys move, Esc closes and returns focus.
 */
export function Menu({ anchor, title, items, onClose, align = 'end', placement = 'below' }: {
  anchor: HTMLElement | null
  title: string
  items: MenuItem[]
  onClose: () => void
  align?: 'start' | 'end'
  placement?: 'below' | 'above'
}) {
  const phone = useIsPhone()
  const titleId = useTitleId()
  const list = (
    <div className="sys-menu__list" role="menu" aria-label={title}>
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
          aria-checked={it.checked}
          disabled={it.disabled}
          className={`sys-menu__item${it.danger ? ' is-danger' : ''}`}
          onClick={() => {
            onClose()
            it.onSelect()
          }}
        >
          {it.icon ? <Icon name={it.icon} size={18} /> : null}
          <span>{it.label}</span>
          {it.checked ? <Icon name="check" size={18} className="sys-menu__check" /> : null}
        </button>
      ))}
    </div>
  )
  if (phone)
    return (
      <Modal onClose={onClose} labelledBy={titleId} variant="menu">
        <h2 className="sys-sheet__title" id={titleId}>
          {title}
        </h2>
        {list}
      </Modal>
    )
  return <Popover anchor={anchor} onClose={onClose} align={align} placement={placement}>{list}</Popover>
}

function Popover({ anchor, onClose, align, placement, children }: { anchor: HTMLElement | null; onClose: () => void; align: 'start' | 'end'; placement: 'below' | 'above'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!anchor || !el) return
    const r = anchor.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = align === 'end' ? r.right - w : r.left
    left = Math.max(8, Math.min(left, innerWidth - w - 8))
    let top = placement === 'above' ? r.top - h - 8 : r.bottom + 6
    if (placement === 'below' && top + h > innerHeight - 8) top = r.top - h - 6
    setPos({ top: Math.max(8, top), left })
  }, [anchor, align, placement])
  useEffect(() => {
    const el = ref.current
    el?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus({ preventScroll: true })
    const onDown = (e: PointerEvent) => {
      if (!el?.contains(e.target as Node) && !anchor?.contains(e.target as Node)) close.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
        anchor?.focus()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const items = [...(el?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])]
        const i = items.indexOf(document.activeElement as HTMLElement)
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
      } else if (e.key === 'Tab') close.current()
    }
    const onScroll = () => close.current()
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll)
    }
  }, [anchor])
  return createPortal(
    <div ref={ref} className="sys-menu" style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}>
      {children}
    </div>,
    document.body,
  )
}
