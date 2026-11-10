// PST-281: the Q&A side panels (Answer a question, Same as another, the prep brief).
// Anything can open one (the Q&A tab, the drawer's Notes tab, Today, ⌘K); the
// QandaHost in the Raise layout shows them, stacked over the drawer.
import { useSyncExternalStore } from 'react'
import { play } from '../../lib/sound'

export type PanelRequest =
  | { kind: 'answer'; id: string }
  | { kind: 'new' }
  | { kind: 'same'; id: string }
  | { kind: 'prep'; meetingId: string }

const EMPTY: PanelRequest[] = []
let stack: PanelRequest[] = EMPTY
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const sameAs = (a: PanelRequest, b: PanelRequest) => JSON.stringify(a) === JSON.stringify(b)

/** Open a panel on top (one already open with the same request moves to the top). */
export function openPanel(p: PanelRequest) {
  stack = [...stack.filter((x) => !sameAs(x, p)), p]
  emit()
}

/** Close one panel (after its leaving animation). */
export function closePanel(p: PanelRequest) {
  stack = stack.filter((x) => x !== p)
  emit()
}

export function closeAllPanels() {
  if (!stack.length) return
  stack = EMPTY
  emit()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export const usePanels = () => useSyncExternalStore(subscribe, () => stack, () => EMPTY)

const PREP_KEY = 'nest_prep_played'
/** Opening a prep brief plays prep-done the first time for that meeting (this tab), then the quiet drawer sound. */
export function playPrepOpen(meetingId: string) {
  let seen: string[] = []
  try {
    seen = JSON.parse(sessionStorage.getItem(PREP_KEY) ?? '[]')
  } catch {
    /* private mode */
  }
  if (seen.includes(meetingId)) return
  play('prep-done')
  try {
    sessionStorage.setItem(PREP_KEY, JSON.stringify([...seen, meetingId].slice(-50)))
  } catch {
    /* private mode */
  }
}
