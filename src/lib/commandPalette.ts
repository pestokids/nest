// The ⌘K command palette. Opening it is T5; until then the search button and
// the shortcut both call this one function, which does nothing yet.
export function openCommandPalette(): void {
  // Intentionally a no-op for now.
}

/** True for ⌘K on Mac and Ctrl+K elsewhere. */
export const isPaletteShortcut = (e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>) =>
  e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
