// PST-307: Raise › Advisor (round6/advisor-chat.png, advisor-new-chat.png,
// advisor-storyteller.png; iphone-advisor.png on a phone): the chat list (Pinned,
// This week, Earlier, search, rename, pin, delete with Undo, this month's spend),
// and the open chat, or the six starters for a new one. ?chat=<id> is the open chat.
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { chatHeadMeta, chatListMeta, groupChats, monthLine, STARTERS, TITLE_MAX, type AdvisorMode } from '../../../lib/advisor'
import { play } from '../../../lib/sound'
import { PREVIEW_ADVISOR_CHAT, type PreviewAdvisor } from '../../../preview/advisorFixture'
import { useAdvisor, type AdvisorChat } from '../../../components/advisor/data'
import { Thread } from '../../../components/advisor/Thread'
import { errorMessage } from '../../../components/data'
import { usePreviewState } from '../../../components/preview-state'
import { Menu, useIsPhone } from '../../../components/system/Menu'
import { Modal, useTitleId } from '../../../components/system/Modal'
import { Button, Icon, IconButton, useToast } from '../../../components/ui'

export const Route = createFileRoute('/_app/raise/advisor')({
  validateSearch: (s: Record<string, unknown>): { chat?: string } => ({ chat: typeof s.chat === 'string' && s.chat ? s.chat.slice(0, 64) : undefined }),
  component: Advisor,
})

/** How long Undo is offered after deleting a chat. */
const UNDO_MS = 6000

function Advisor() {
  const a = useAdvisor()
  const { chat: chatId } = Route.useSearch()
  const navigate = useNavigate()
  const preview = usePreviewState()
  const phone = useIsPhone()
  const [sheet, setSheet] = useState(false)
  const view = a.useChat(chatId ?? null)
  const open = (id: string | null) => {
    setSheet(false)
    void navigate({ to: '/raise/advisor', search: id ? { chat: id } : {} })
  }

  // ?preview&advisor=…: open the state's chat once.
  const opened = useRef(false)
  useEffect(() => {
    const id = preview?.advisor ? PREVIEW_ADVISOR_CHAT[preview.advisor as PreviewAdvisor] : undefined
    if (opened.current || !id || chatId || !a.chats || preview?.advisor === 'panel') return
    opened.current = true
    void navigate({ to: '/raise/advisor', search: { chat: id }, replace: true })
  }, [preview?.advisor, chatId, a.chats, navigate])

  // A chat that's gone (deleted elsewhere, or a stale link): back to a new chat.
  useEffect(() => {
    if (chatId && view === null) void navigate({ to: '/raise/advisor', search: {}, replace: true })
  }, [chatId, view, navigate])

  const list = <ChatList current={chatId ?? null} onOpen={open} />
  return (
    <div className="adv">
      {phone ? null : <aside className="adv-side">{list}</aside>}
      <section className="adv-main" aria-label="Advisor chat">
        {view?.chat ? (
          <ChatHead chat={view.chat} onChats={phone ? () => setSheet(true) : undefined} onGone={() => open(null)} />
        ) : phone ? (
          <header className="adv-head">
            <h2 className="adv-head__title">New chat</h2>
            <button type="button" className="adv-head__chats" onClick={() => setSheet(true)}>
              Chats <Icon name="chevron-down" size={14} />
            </button>
          </header>
        ) : null}
        <Thread
          chatId={chatId ?? null}
          onChat={(id) => open(id)}
          compact={phone}
          placeholder={phone ? 'Ask the advisor…' : chatId ? 'Ask about your raise, your story, or what to do next…' : 'Ask anything about the raise. Nest adds your data automatically.'}
          empty={(start) => <Starters onStart={start} />}
        />
      </section>
      {sheet ? <ChatsSheet onClose={() => setSheet(false)}>{list}</ChatsSheet> : null}
    </div>
  )
}

function ChatsSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const titleId = useTitleId()
  return (
    <Modal onClose={onClose} labelledBy={titleId} variant="menu" className="adv-sheet">
      <h2 className="sys-sheet__title" id={titleId}>
        Chats
      </h2>
      {children}
    </Modal>
  )
}

function Starters({ onStart }: { onStart: (text: string, mode: AdvisorMode) => void }) {
  return (
    <div className="adv-empty">
      <Icon name="spark" size={72} className="adv-empty__spark" />
      <h2 className="adv-empty__title">Your fundraising advisor</h2>
      <p className="adv-empty__lede">An expert who has run hundreds of raises, and knows yours: every investor, note, email and number in Nest. Coach for what to do next; Storyteller for how to say it.</p>
      <ul className="adv-starters">
        {STARTERS.map((s) => (
          <li key={s.title}>
            <button type="button" className="adv-starter" onClick={() => onStart(s.prompt, s.mode)}>
              <span className="adv-starter__title">{s.title}</span>
              <span className="adv-starter__sub">{s.sub}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Delete with Undo, Rename and Pin: the same in the list and the chat's head. */
function useChatActions(onGone?: () => void) {
  const a = useAdvisor()
  const toast = useToast()
  const fail = (e: unknown) => {
    play('save-failed')
    toast({ tone: 'error', message: errorMessage(e) })
  }
  return {
    pin: (c: AdvisorChat) => {
      play(c.pinned ? 'toggle-off' : 'toggle-on')
      void a.setPinned(c._id, !c.pinned).catch(fail)
    },
    rename: (c: AdvisorChat, title: string) => {
      const t = title.replace(/\s+/g, ' ').trim()
      if (t && t !== c.title) void a.rename(c._id, t).catch(fail)
    },
    remove: (c: AdvisorChat) => {
      play('remove')
      onGone?.()
      void a.remove(c._id).catch(fail)
      toast({
        tone: 'info',
        icon: 'trash',
        message: 'Deleted “' + c.title + '”.',
        durationMs: UNDO_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            play('undo')
            void a.restore(c._id).catch(fail)
          },
        },
      })
    },
  }
}

function Rename({ chat, onDone, className }: { chat: AdvisorChat; onDone: (title: string | null) => void; className: string }) {
  const [t, setT] = useState(chat.title)
  return (
    <input
      className={className}
      value={t}
      maxLength={TITLE_MAX}
      aria-label="Chat name"
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => onDone(t)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(t)
        if (e.key === 'Escape') {
                  e.stopPropagation()
                  onDone(null)
                }
      }}
    />
  )
}

function ChatHead({ chat, onChats, onGone }: { chat: AdvisorChat; onChats?: () => void; onGone: () => void }) {
  const act = useChatActions(onGone)
  const [renaming, setRenaming] = useState(false)
  const [menu, setMenu] = useState(false)
  const more = useRef<HTMLButtonElement>(null)
  return (
    <header className="adv-head">
      <div className="adv-head__text">
        {renaming ? (
          <Rename
            chat={chat}
            className="adv-head__rename"
            onDone={(t) => {
              setRenaming(false)
              if (t !== null) act.rename(chat, t)
            }}
          />
        ) : (
          <h2 className="adv-head__title">{chat.title}</h2>
        )}
        {onChats ? null : <p className="adv-head__meta">{chatHeadMeta(chat, Date.now())}</p>}
      </div>
      {onChats ? (
        <button type="button" className="adv-head__chats" onClick={onChats}>
          Chats <Icon name="chevron-down" size={14} />
        </button>
      ) : (
        <div className="adv-head__actions">
          <Button size="sm" aria-pressed={chat.pinned} onClick={() => act.pin(chat)}>
            {chat.pinned ? 'Pinned' : 'Pin'}
          </Button>
          <IconButton ref={more} icon="more" label="More for this chat" size="sm" onClick={() => setMenu(true)} />
        </div>
      )}
      {menu ? (
        <Menu
          anchor={more.current}
          title={chat.title}
          onClose={() => setMenu(false)}
          items={[
            { label: 'Rename', icon: 'edit', onSelect: () => setRenaming(true) },
            { label: 'Delete', icon: 'trash', danger: true, onSelect: () => act.remove(chat) },
          ]}
        />
      ) : null}
    </header>
  )
}

function ChatList({ current, onOpen }: { current: string | null; onOpen: (id: string | null) => void }) {
  const a = useAdvisor()
  const [q, setQ] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ chat: AdvisorChat; anchor: HTMLElement } | null>(null)
  const act = useChatActions()
  const groups = a.chats ? groupChats(a.chats, Date.now(), q) : null
  const o = a.overview
  const month = o ? monthLine(o.monthUsd, o.settings.capUsd) : null
  return (
    <div className="adv-list">
      <Button variant="primary" icon="plus" className="adv-list__new" onClick={() => onOpen(null)}>
        New chat
      </Button>
      <label className="adv-list__search">
        <Icon name="search" size={16} />
        <input type="search" placeholder="Search chats" aria-label="Search chats" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <nav className="adv-list__groups" aria-label="Chats">
        {!groups ? (
          <span className="sk" style={{ display: 'block', height: 160, borderRadius: 14 }} />
        ) : groups.length ? (
          groups.map((g) => (
            <section key={g.key} className="adv-group" aria-label={g.label}>
              <h3 className="adv-group__title">{g.label}</h3>
              <ul>
                {g.chats.map((c) => (
                  <li key={c._id} className={'adv-row' + (c._id === current ? ' is-current' : '')}>
                    {renaming === c._id ? (
                      <Rename
                        chat={c}
                        className="adv-row__rename"
                        onDone={(t) => {
                          setRenaming(null)
                          if (t !== null) act.rename(c, t)
                        }}
                      />
                    ) : (
                      <button type="button" className="adv-row__open" aria-current={c._id === current ? 'page' : undefined} onClick={() => onOpen(c._id)}>
                        <span className="adv-row__title">{c.title}</span>
                        <span className="adv-row__meta">{chatListMeta(c)}</span>
                      </button>
                    )}
                    <button type="button" className="adv-row__more" aria-label={'More for ' + c.title} onClick={(e) => setMenu({ chat: c, anchor: e.currentTarget })}>
                      <Icon name="more" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="adv-list__none">{q ? 'No chat has those words.' : 'No chats yet. Ask anything to start one.'}</p>
        )}
      </nav>
      {month ? (
        <Link to="/raise/settings" className="adv-month" aria-label={'This month: ' + month.text + '. Settings › AI › Advisor'}>
          <span className="adv-month__k">This month</span>
          <span className="adv-month__v num">{month.text}</span>
          <span className="adv-month__bar" aria-hidden="true">
            <span style={{ width: Math.max(month.pct, o && o.monthUsd > 0 ? 2 : 0) + '%' }} className={month.pct >= 90 ? 'is-full' : undefined} />
          </span>
        </Link>
      ) : null}
      {menu ? (
        <Menu
          anchor={menu.anchor}
          title={menu.chat.title}
          onClose={() => setMenu(null)}
          items={[
            { label: menu.chat.pinned ? 'Unpin' : 'Pin', icon: 'drag', onSelect: () => act.pin(menu.chat) },
            { label: 'Rename', icon: 'edit', onSelect: () => setRenaming(menu.chat._id) },
            {
              label: 'Delete',
              icon: 'trash',
              danger: true,
              onSelect: () => {
                if (menu.chat._id === current) onOpen(null)
                act.remove(menu.chat)
              },
            },
          ]}
        />
      ) : null}
    </div>
  )
}
