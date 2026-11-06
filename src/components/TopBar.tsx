import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { isPaletteShortcut, openCommandPalette } from '../lib/commandPalette'
import { useSession, useSounds } from './session'
import { Avatar, Icon, IconButton, Kbd, Tabs, Toggle, type TabItem } from './ui'
import { Wordmark } from './Wordmark'

const SECTIONS: TabItem[] = [
  { to: '/', label: 'Home', exact: true },
  { to: '/raise', label: 'Raise', live: true },
  { to: '', label: 'Growth', soon: true },
  { to: '', label: 'Families', soon: true },
  { to: '', label: 'Hiring', soon: true },
  { to: '', label: 'Ops & Legal', soon: true },
]

/** 72px Paper bar: wordmark, section tabs, search (⌘K) and the avatar menu. */
export function TopBar() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return
      e.preventDefault()
      openCommandPalette()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className="topbar">
      <div className="page topbar__inner">
        <Link to="/" className="topbar__brand" aria-label="Nest home">
          <Wordmark />
        </Link>
        <div className="topbar__tabs">
          <Tabs items={SECTIONS} label="Sections" />
        </div>
        <span className="topbar__spacer" />
        <span className="topbar__search">
          <IconButton icon="search" label="Search" aria-keyshortcuts="Meta+K Control+K" onClick={() => openCommandPalette()} />
          <span className="topbar__tip" role="tooltip">
            Search <Kbd>⌘K</Kbd>
          </span>
        </span>
        <AvatarMenu />
      </div>
    </header>
  )
}

function AvatarMenu() {
  const { me, signOut } = useSession()
  const sounds = useSounds()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        root.current?.querySelector<HTMLButtonElement>('.avatar-btn')?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="avatar-menu" ref={root}>
      <button type="button" className="avatar-btn" aria-haspopup="true" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} aria-label={`Account: ${me.name || me.firstName}`}>
        <Avatar name={me.firstName} />
      </button>
      {open ? (
        <div className="avatar-menu__panel" id={id}>
          <div className="avatar-menu__who">
            <Avatar name={me.firstName} size={36} />
            <div>
              <div className="avatar-menu__name">{me.name || me.firstName}</div>
              <div className="avatar-menu__email">{me.email}</div>
            </div>
          </div>
          <nav className="avatar-menu__sections" aria-label="Sections">
            <Link to="/" activeOptions={{ exact: true }} onClick={() => setOpen(false)}>
              Home
            </Link>
            <Link to="/raise" onClick={() => setOpen(false)}>
              Raise
            </Link>
          </nav>
          <div className="avatar-menu__row">
            <Toggle label={sounds.on ? 'Sounds on' : 'Sounds off'} checked={sounds.on} onChange={(e) => sounds.set(e.target.checked)} />
          </div>
          <button type="button" className="avatar-menu__item" onClick={signOut}>
            <Icon name="sign-out" size={18} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}
