// PST-307: the Advisor's ⌘J panel (round6/advisor-panel-cmdj.png): it opens from
// any screen over what you're looking at, and passes that screen (the route, the
// Pipeline view, the open investor) with a new chat. "Open full chat" moves the
// chat to Raise › Advisor. Full screen on a phone.
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { lookingAt, type ScreenContext } from '../../lib/advisor'
import { KEYS, matches } from '../../lib/shortcuts'
import { play } from '../../lib/sound'
import { PREVIEW_ADVISOR_CHAT, PREVIEW_ADVISOR_PANELS, type PreviewAdvisor } from '../../preview/advisorFixture'
import { usePreviewState } from '../preview-state'
import { Icon, IconButton } from '../ui'
import { useAdvisor } from './data'
import { onOpenAdvisorPanel, screenInvestor } from './open'
import { Thread } from './Thread'

export function AdvisorPanel() {
  const preview = usePreviewState()
  const navigate = useNavigate()
  const location = useRouterState({ select: (s) => s.location })
  const previewPanel = PREVIEW_ADVISOR_PANELS.includes(preview?.advisor ?? '') ? (preview?.advisor as PreviewAdvisor) : null
  const [open, setOpen] = useState(!!previewPanel)
  const [chatId, setChatId] = useState<string | null>(previewPanel ? (PREVIEW_ADVISOR_CHAT[previewPanel] ?? null) : null)
  const [screen, setScreen] = useState<ScreenContext | null>(null)
  const before = useRef<HTMLElement | null>(null)
  const panel = useRef<HTMLElement>(null)

  const here = (): ScreenContext => {
    const view = (location.search as { view?: unknown }).view
    const i = screenInvestor()
    return { path: location.pathname, ...(typeof view === 'string' ? { view } : {}), ...(i ? { investorId: i.id, investorName: i.name } : {}) }
  }
  const show = () => {
    if (location.pathname === '/raise/advisor') {
      document.querySelector<HTMLTextAreaElement>('[data-advisor-input]')?.focus()
      return
    }
    before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setScreen(here())
    setOpen(true)
    play('drawer-open')
  }
  const close = () => {
    setOpen(false)
    play('drawer-close')
    const el = before.current
    before.current = null
    if (el?.isConnected) requestAnimationFrame(() => el.focus({ preventScroll: true }))
  }
  const latest = useRef({ show, close, open })
  useEffect(() => {
    latest.current = { show, close, open }
  })

  useEffect(() => onOpenAdvisorPanel(() => latest.current.show()), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matches(e, KEYS.advisor)) {
        e.preventDefault()
        if (latest.current.open) latest.current.close()
        else latest.current.show()
      } else if (e.key === 'Escape' && latest.current.open && !document.querySelector('[aria-modal="true"]') && panel.current?.contains(document.activeElement)) {
        latest.current.close()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLTextAreaElement>('[data-advisor-input]')?.focus({ preventScroll: true })
  }, [open])

  if (!open) return null
  // Opened by the preview (&advisor=panel), the screen is the one it loaded on.
  const shown = screen ?? here()
  return createPortal(
    <>
      <div className="adv-panel-scrim" aria-hidden="true" onClick={close} />
      <aside ref={panel} className="adv-panel" role="dialog" aria-label="Advisor">
        <header className="adv-panel__head">
          <span className="adv-eyebrow">Advisor · ⌘J</span>
          <span className="adv-panel__tools">
            {chatId ? (
              <button
                type="button"
                className="adv-link"
                onClick={() => {
                  setOpen(false)
                  void navigate({ to: '/raise/advisor', search: { chat: chatId } })
                }}
              >
                Open full chat <Icon name="arrow-right" size={14} className="adv-panel__out" />
              </button>
            ) : null}
            {chatId ? (
              <button type="button" className="adv-link" onClick={() => setChatId(null)}>
                New
              </button>
            ) : null}
            <IconButton icon="close" label="Close the Advisor" size="sm" onClick={close} />
          </span>
        </header>
        <PanelLooking screen={shown} chatId={chatId} />
        <Thread
          chatId={chatId}
          onChat={setChatId}
          compact
          panel
          screen={shown}
          placeholder="Ask about this screen…"
          onLeave={() => setOpen(false)}
          empty={() => <p className="adv-panel__hint">Ask about what’s on screen: who to chase, what to say, what this view means for the round. Nest adds your data automatically.</p>}
        />
      </aside>
    </>,
    document.body,
  )
}

/** "Looking at: Pipeline › Race": the screen a chat started on (an open chat keeps its own). */
function PanelLooking({ screen, chatId }: { screen: ScreenContext; chatId: string | null }) {
  const a = useAdvisor()
  const kept = a.useChat(chatId)?.chat.screen
  return <span className="adv-panel__looking">Looking at: {lookingAt(kept ?? screen)}</span>
}
