// The icon set from components/Icon/: 24px grid, 1.75 stroke, round caps, currentColor.
import type { ReactNode, SVGProps } from 'react'

const gear = (() => {
  // 8 teeth around a ring, drawn once.
  const pts: string[] = []
  for (let i = 0; i < 16; i++) {
    const a0 = (i / 16) * Math.PI * 2 - Math.PI / 16
    const a1 = a0 + Math.PI / 8
    const r = i % 2 === 0 ? 9.2 : 7.2
    pts.push(`${(12 + Math.cos(a0) * r).toFixed(2)} ${(12 + Math.sin(a0) * r).toFixed(2)}`, `${(12 + Math.cos(a1) * r).toFixed(2)} ${(12 + Math.sin(a1) * r).toFixed(2)}`)
  }
  return `M${pts.join(' L')} Z`
})()

const PATHS = {
  alert: (
    <>
      <path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </>
  ),
  'arrow-left': <path d="M19 12H5m6-6-6 6 6 6" />,
  'arrow-right': <path d="M5 12h14m-6-6 6 6-6 6" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  'chevron-right': <path d="m9 6 6 6-6 6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  download: <path d="M12 4v11m-5-5 5 5 5-5M4.5 20h15" />,
  drag: (
    <>
      <circle cx="9" cy="6" r=".9" fill="currentColor" />
      <circle cx="15" cy="6" r=".9" fill="currentColor" />
      <circle cx="9" cy="12" r=".9" fill="currentColor" />
      <circle cx="15" cy="12" r=".9" fill="currentColor" />
      <circle cx="9" cy="18" r=".9" fill="currentColor" />
      <circle cx="15" cy="18" r=".9" fill="currentColor" />
    </>
  ),
  edit: <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3ZM14 8l3 3" />,
  filter: <path d="M4 6.5h16M7 12h10M10 17.5h4" />,
  link: (
    <>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" fill="currentColor" stroke="none" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15.5" r="1.4" fill="var(--icon-hole, #fff)" stroke="none" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1" fill="currentColor" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="18" cy="12" r="1" fill="currentColor" />
    </>
  ),
  note: (
    <>
      <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8L14 3.5Z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9" />
      <path d="M19.5 4v5h-5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  settings: (
    <>
      <path d={gear} />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  sort: <path d="M8 4v16m-4-4 4 4 4-4M16 20V4m-4 4 4-4 4 4" />,
  spark: <path d="M12 2.5c.6 5 1.9 8.4 9.5 9.5-7.6 1.1-8.9 4.5-9.5 9.5-.6-5-1.9-8.4-9.5-9.5 7.6-1.1 8.9-4.5 9.5-9.5Z" fill="currentColor" stroke="none" />,
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7M10 11v6M14 11v6" />,
  upload: <path d="M12 16V5m-5 5 5-5 5 5M4.5 20h15" />,
  user: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  'sound-on': (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  'sound-off': (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="m16 9.5 5 5m0-5-5 5" />
    </>
  ),
  'sign-out': <path d="M14 4.5h3.5a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 16l4-4-4-4M14 12H4.5" />,
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof PATHS | 'google'
export const ICON_NAMES = [...Object.keys(PATHS), 'google'] as IconName[]

type IconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & { name: IconName; size?: number; label?: string }

export function Icon({ name, size = 20, label, strokeWidth = 1.75, ...rest }: IconProps) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const }
  if (name === 'google')
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" focusable="false" {...a11y} {...rest}>
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z" />
        <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
        <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
      </svg>
    )
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...a11y}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  )
}
