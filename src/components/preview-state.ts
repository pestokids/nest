import { createContext, useContext } from 'react'

// DEV/preview only: which state `?preview` should show (Today, the drawer, and the
// Investors / Plan / Settings / system states). Null outside preview.
export const PREVIEW_TODAY = ['default', 'nothingdue', 'win'] as const
export const PREVIEW_DRAWER = ['view', 'edit', 'new', 'advance', 'touch', 'history', 'emails', 'delete'] as const
export type PreviewToday = (typeof PREVIEW_TODAY)[number]
export type PreviewDrawer = (typeof PREVIEW_DRAWER)[number]
export type PreviewState = {
  today: PreviewToday
  drawer?: PreviewDrawer
  sheet: boolean
  /** `&investors=filtered|empty|bulk|exported|import1|import2|import3` */
  investors?: string | null
  /** `&plan=mid` */
  plan?: string | null
  /** `&settings=errors` */
  settings?: string | null
  /** `&system=cmdk|cmdk-empty|cmdk-none|offline|savefailed|loading` */
  system?: string | null
  /** PST-275 `&suggestions=all|tidy|none|agent` */
  suggestions?: string | null
}

export const PreviewStateContext = createContext<PreviewState | null>(null)
export const usePreviewState = () => useContext(PreviewStateContext)
