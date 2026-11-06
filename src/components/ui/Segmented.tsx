import { useRef, type KeyboardEvent, type ReactNode } from 'react'

/** A row of mutually exclusive options (radio group), e.g. Call · Email · Meeting · Note. Arrow keys move the choice. */
export function Segmented<T extends string>({ options, value, onChange, label, className }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + step + options.length) % options.length]
    onChange(next.value)
    ref.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus()
  }
  return (
    <div ref={ref} className={['segmented', className].filter(Boolean).join(' ')} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          data-value={o.value}
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className="segmented__opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
