import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MOTION } from '../../lib/motion'
import { EggHatching } from '../illustrations'
import { Icon, type IconName } from './Icon'

export type ToastTone = 'success' | 'win' | 'error' | 'info' | 'hatch'
export type ToastInput = {
  tone?: ToastTone; message: ReactNode; action?: { label: string; onClick: () => void }; icon?: IconName; durationMs?: number
  /** PST-302: a second action before the main one (a backward move's "Mark as a correction" beside Undo). */
  secondary?: { label: string; onClick: () => void }
}
type Shown = ToastInput & { id: number; leaving?: boolean }

const ToastCtx = createContext<((t: ToastInput | string) => void) | null>(null)

/** `toast('Saved.')` or `toast({ tone: 'win', message, action })`. One toast at a time, 4s. */
export function useToast() {
  const v = useContext(ToastCtx)
  if (!v) throw new Error('useToast outside ToastProvider')
  return v
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Shown | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const clear = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  const dismiss = useCallback(() => {
    clear()
    setT((x) => (x ? { ...x, leaving: true } : x))
    timers.current.push(setTimeout(() => setT(null), 200))
  }, [])
  const show = useCallback(
    (input: ToastInput | string) => {
      const next = typeof input === 'string' ? { message: input } : input
      clear()
      setT({ tone: 'success', ...next, id: Date.now() })
      timers.current.push(setTimeout(dismiss, next.durationMs ?? MOTION.toast.holdMs))
    },
    [dismiss],
  )
  useEffect(() => clear, [])
  // While a toast shows, publish how much room it takes (--toast-lift), so things pinned to the
  // bottom of the screen, like the phones' add button, can move up above it instead of under it.
  const region = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const root = document.documentElement
    const el = region.current?.firstElementChild as HTMLElement | null | undefined
    if (!t || t.leaving || !el) {
      root.style.removeProperty('--toast-lift')
      return
    }
    const set = () => root.style.setProperty('--toast-lift', `${Math.ceil(el.getBoundingClientRect().height) + 12}px`)
    set()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [t])
  useEffect(
    () => () => {
      document.documentElement.style.removeProperty('--toast-lift')
    },
    [],
  )
  const value = useMemo(() => show, [show])
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toast-region" role="status" aria-live="polite" ref={region}>
        {t ? <Toast key={t.id} {...t} onAction={() => { t.action?.onClick(); dismiss() }} onSecondary={() => { t.secondary?.onClick(); dismiss() }} /> : null}
      </div>
    </ToastCtx.Provider>
  )
}

/** One toast. Exported for previews; use useToast() in the app. */
export function Toast({ tone = 'success', message, action, secondary, icon, leaving, onAction, onSecondary }: ToastInput & { leaving?: boolean; onAction?: () => void; onSecondary?: () => void }) {
  const lead =
    tone === 'win' ? (
      <img className="toast__cheer" src="/mascot/cheer.webp" alt="" width={56} height={51} />
    ) : tone === 'hatch' ? (
      <EggHatching size={40} className="toast__illo" />
    ) : (
      <span className="toast__icon">
        <Icon name={icon ?? (tone === 'error' ? 'alert' : tone === 'info' ? 'note' : 'check')} size={tone === 'success' ? 20 : 18} strokeWidth={tone === 'success' ? 2.4 : 1.75} />
      </span>
    )
  return (
    <div className={['toast', `toast--${tone}`, leaving && 'toast--leaving'].filter(Boolean).join(' ')}>
      {lead}
      <span className="toast__msg">{message}</span>
      {secondary ? (
        <button type="button" className="toast__action toast__action--secondary" onClick={onSecondary}>
          {secondary.label}
        </button>
      ) : null}
      {action ? (
        <button type="button" className="toast__action" onClick={onAction}>
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
