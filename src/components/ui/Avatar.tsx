import type { HTMLAttributes } from 'react'

/** Lime circle with the first initial (the design's "Me" avatar). */
export function Avatar({ name, size = 40, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { name: string; size?: number }) {
  const initial = (name.trim()[0] ?? '?').toUpperCase()
  return (
    <span className={['avatar', className].filter(Boolean).join(' ')} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true" {...rest}>
      {initial}
    </span>
  )
}
