// The ⌘K command palette. The search button and the shortcut call
// openCommandPalette(); the palette mounted in the app shell listens.
type Listener = (query?: string) => void
const listeners = new Set<Listener>()

/** Opens the palette (optionally with a query). Does nothing until the palette is mounted. */
export function openCommandPalette(query?: string): void {
  listeners.forEach((l) => l(query))
}

/** The palette subscribes here; returns the unsubscribe. */
export function onOpenCommandPalette(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** True for ⌘K on Mac and Ctrl+K elsewhere. */
export const isPaletteShortcut = (e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>) =>
  e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey

const RECENT_KEY = 'nest_palette_recent'
/** Investors last opened from the palette, newest first (ids only, this device). */
export function recentInvestors(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
export function rememberInvestor(id: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentInvestors().filter((x) => x !== id)].slice(0, 5)))
  } catch {
    /* private mode */
  }
}
