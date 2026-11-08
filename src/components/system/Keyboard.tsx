// PST-290: the app-wide keys that aren't ⌘K's: ? opens the shortcut sheet
// (system-shortcuts.png) and ⇧D switches list density. Mounted in the app shell.
import { useEffect, useState } from 'react'
import { otherDensity } from '../../lib/density'
import { KEYS, keyLabel, matches, SHORTCUTS, singleKeyOk } from '../../lib/shortcuts'
import { usePreviewState } from '../preview-state'
import { useDensity } from '../session'
import { Icon, Kbd, useToast } from '../ui'
import { Modal, useTitleId } from './Modal'

export function Keyboard() {
  const flags = usePreviewState()
  const [open, setOpen] = useState(false)
  const { density, set } = useDensity()
  const toast = useToast()

  // ?preview&system=shortcuts
  useEffect(() => {
    if (flags?.system === 'shortcuts') setOpen(true)
  }, [flags?.system])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!singleKeyOk(e) || document.querySelector('.sys-modal')) return
      if (matches(e, KEYS.sheet)) {
        e.preventDefault()
        setOpen(true)
      } else if (matches(e, KEYS.density) && !document.querySelector('[aria-modal="true"]')) {
        e.preventDefault()
        const next = otherDensity(density)
        set(next)
        toast({ tone: 'info', icon: 'check', message: `${next === 'compact' ? 'Compact' : 'Comfortable'} rows. ${keyLabel(KEYS.density)} to switch back.` })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [density, set, toast])

  return open ? <ShortcutSheet onClose={() => setOpen(false)} /> : null
}

/** Every shortcut, from the registry (src/lib/shortcuts.ts), in its four groups. */
function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const id = useTitleId()
  return (
    <Modal onClose={onClose} labelledBy={id} className="keys-sheet" initialFocus="panel">
      <header className="keys-sheet__head">
        <p className="eyebrow-mono keys-sheet__eyebrow">Keyboard · Press ? anywhere</p>
        <h2 id={id} className="keys-sheet__title">
          Every action has a key
        </h2>
        <button type="button" className="keys-sheet__close" onClick={onClose} aria-label="Close shortcuts">
          <Icon name="close" size={22} />
        </button>
      </header>
      <div className="keys-sheet__groups">
        {SHORTCUTS.map((g) => (
          <section key={g.id} className="keys-sheet__group" aria-labelledby={`${id}-${g.id}`}>
            <h3 id={`${id}-${g.id}`} className="keys-sheet__label">
              {g.title}
            </h3>
            <dl className="keys-sheet__rows">
              {g.rows.map((r) => (
                <div key={r.label} className="keys-sheet__row">
                  <dt className="keys-sheet__keys">
                    {r.keys.map((k) => (
                      <Kbd key={k}>{keyLabel(k)}</Kbd>
                    ))}
                  </dt>
                  <dd>{r.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="keys-sheet__foot">Single keys never fire while you’re typing. On Windows, ⌘ is Ctrl.</p>
    </Modal>
  )
}
