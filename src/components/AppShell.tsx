import { Outlet } from '@tanstack/react-router'
import { TopBar } from './TopBar'
import { ToastProvider } from './ui'

/** Top bar over the active section. Toasts are app-wide. */
export function AppShell() {
  return (
    <ToastProvider>
      <TopBar />
      <div className="app-main">
        <Outlet />
      </div>
    </ToastProvider>
  )
}
