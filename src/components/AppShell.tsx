import { Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { CommandPalette } from './system/CommandPalette'
import { Keyboard } from './system/Keyboard'
import { OfflineBanner } from './system/Connection'
import { Feedback } from './system/Feedback'
import { usePreviewState } from './preview-state'
import { TopBar } from './TopBar'
import { AdvisorPanel } from './advisor/Panel' // PST-307
import { ToastProvider } from './ui'

/** Top bar over the active section. Toasts, the offline banner, ⌘K and ⌘. (feedback) are app-wide. */
export function AppShell({ children }: { children?: ReactNode }) {
  const preview = usePreviewState()
  return (
    <ToastProvider>
      <TopBar />
      <div className="app-main">
        <OfflineBanner watchConvex={!preview} force={preview?.system === 'offline'} />
        <Outlet />
      </div>
      <CommandPalette />
      {/* PST-289: Send feedback (⌘.) */}
      <Feedback />
      {/* PST-290: ? (the shortcut sheet) and ⇧D (density) */}
      <Keyboard />
      {/* /PST-290 */}
      {/* PST-307: the Advisor's ⌘J panel */}
      <AdvisorPanel />
      {children}
    </ToastProvider>
  )
}
