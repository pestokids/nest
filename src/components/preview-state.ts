import { createContext, useContext } from 'react'

// DEV/preview only: which Today and drawer state `?preview` should show. Null outside preview.
export const PREVIEW_TODAY = ['default', 'nothingdue', 'win'] as const
export const PREVIEW_DRAWER = ['view', 'edit', 'new', 'advance', 'touch', 'history', 'delete'] as const
export type PreviewToday = (typeof PREVIEW_TODAY)[number]
export type PreviewDrawer = (typeof PREVIEW_DRAWER)[number]
export type PreviewState = { today: PreviewToday; drawer?: PreviewDrawer; sheet: boolean }

export const PreviewStateContext = createContext<PreviewState | null>(null)
export const usePreviewState = () => useContext(PreviewStateContext)
