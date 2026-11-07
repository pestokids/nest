import { createContext, useContext } from 'react'

// DEV/preview only: which state `?preview` should show (Today, the drawer, and the
// Investors / Plan / Settings / system states). Null outside preview.
export const PREVIEW_TODAY = ['default', 'nothingdue', 'win'] as const
export const PREVIEW_DRAWER = ['view', 'edit', 'new', 'advance', 'touch', 'history', 'emails', 'materials', 'notes', 'delete'] as const
export type PreviewToday = (typeof PREVIEW_TODAY)[number]
export type PreviewDrawer = (typeof PREVIEW_DRAWER)[number]
export type PreviewState = {
  today: PreviewToday
  drawer?: PreviewDrawer
  sheet: boolean
  /** `&investors=filtered|empty|bulk|enrich|exported|import1|import2|import3` */
  investors?: string | null
  /** `&plan=mid` */
  plan?: string | null
  /** `&settings=errors` */
  settings?: string | null
  /** `&system=cmdk|cmdk-empty|cmdk-none|offline|savefailed|loading` */
  system?: string | null
  /** PST-275 `&suggestions=all|tidy|none|agent` */
  suggestions?: string | null
  /** PST-281 `&qanda=empty|answer|edit|new|same|prep` */
  qanda?: string | null
  /** PST-282 `&materials=empty|versions|views|share|sent|upload|noemail|opened` */
  materials?: string | null
  /** PST-276 `&agents=empty|create|created|activity|revoke` */
  agents?: string | null
}

export const PreviewStateContext = createContext<PreviewState | null>(null)
export const usePreviewState = () => useContext(PreviewStateContext)
