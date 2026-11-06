import type { HTMLAttributes, ReactNode } from 'react'

export type ChipTone = 'neutral' | 'live' | 'waiting' | 'success' | 'error' | 'outline' | 'selected' | 'muted'

type ChipProps = HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone; /** Leading dot; on by default for live, waiting and success. */ dot?: boolean; children: ReactNode }

/** Pills for stages, warmth and status. `live` pulses its dot. */
export function Chip({ tone = 'neutral', dot, className, children, ...rest }: ChipProps) {
  const showDot = dot ?? (tone === 'live' || tone === 'waiting' || tone === 'success')
  return (
    <span className={['chip', `chip--${tone}`, className].filter(Boolean).join(' ')} {...rest}>
      {showDot ? <span className={tone === 'live' ? 'm-live-dot chip__dot' : 'chip__dot'} aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

/** Small orange count, e.g. next to "Due today". */
export function Badge({ children, className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={['badge', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </span>
  )
}

/** Keyboard key, e.g. ⌘K. */
export function Kbd({ children, className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd className={['kbd', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </kbd>
  )
}
