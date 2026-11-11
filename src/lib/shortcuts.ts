// PST-290: every keyboard shortcut, in one list. The ? sheet reads it, ⌘K shows
// an action's key from it, and the handlers match keys through it, so the three
// can't drift apart. Pure, so it's unit-tested.

/** A key as the handlers match it: `mod+k` (⌘ on Mac, Ctrl elsewhere), `shift+d`, `?`, `j`, `ArrowLeft`, `Enter`. */
export type Combo = string

export const KEYS = {
  palette: 'mod+k',
  /** PST-289 builds its handler. */
  feedback: 'mod+.',
  sheet: '?',
  /** G, then a section's letter (GO_TO). */
  goTo: 'g',
  addInvestor: 'n',
  importCsv: 'i',

  down: 'j',
  up: 'k',
  open: 'Enter',
  /** The Today Inbox builds E and S. */
  done: 'e',
  snooze: 's',
  draft: 'd',
  select: 'x',
  selectRange: 'shift+x',

  nextStage: 'm',
  logTouch: 'l',
  askNumber: 'a',
  yes: 'y',
  no: 'n',
  prevInvestor: 'ArrowLeft',
  nextInvestor: 'ArrowRight',
  close: 'Escape',

  /** PST-295 builds the views. */
  views: 'v',
  cardOn: ']',
  cardBack: '[',
  density: 'shift+d',
  /** PST-307: the Advisor's panel, on any screen. */
  advisor: 'mod+j',
} as const satisfies Record<string, Combo>
export type KeyName = keyof typeof KEYS

/** G then a letter: where it goes. */
export const GO_TO: Record<string, string> = {
  t: '/raise/today',
  p: '/raise/pipeline',
  i: '/raise/investors',
  q: '/raise/qanda',
  l: '/raise/plan',
  s: '/raise/settings',
  h: '/',
}

export type ShortcutRow = { keys: Combo[]; label: string }
export type ShortcutGroup = { id: 'anywhere' | 'lists' | 'drawer' | 'pipeline'; title: string; rows: ShortcutRow[] }

/** The ? sheet, group by group (system-shortcuts.png). */
export const SHORTCUTS: ShortcutGroup[] = [
  {
    id: 'anywhere',
    title: 'Anywhere',
    rows: [
      { keys: [KEYS.palette], label: 'Search and run any action' },
      { keys: [KEYS.feedback], label: 'Send feedback' },
      { keys: [KEYS.advisor], label: 'Ask the Advisor about this screen' }, // PST-307
      { keys: [KEYS.sheet], label: 'This sheet' },
      { keys: [KEYS.goTo, 't'], label: 'Today (' + Object.keys(GO_TO).filter((k) => k !== 't').map((k) => k.toUpperCase()).join(', ') + ')' },
      { keys: [KEYS.addInvestor], label: 'Add an investor' },
      { keys: [KEYS.importCsv], label: 'Import a CSV' },
    ],
  },
  {
    id: 'lists',
    title: 'Lists and Inbox',
    rows: [
      { keys: [KEYS.down, KEYS.up], label: 'Move down, up' },
      { keys: [KEYS.open], label: 'Open' },
      { keys: [KEYS.done], label: 'Done' },
      { keys: [KEYS.snooze], label: 'Snooze' },
      { keys: [KEYS.draft], label: 'Draft' },
      { keys: [KEYS.select], label: 'Select' },
      { keys: [KEYS.selectRange], label: 'Select a range' },
    ],
  },
  {
    id: 'drawer',
    title: 'Investor drawer',
    rows: [
      { keys: [KEYS.nextStage], label: 'Move to the next stage' },
      { keys: [KEYS.logTouch], label: 'Log a touch' },
      { keys: [KEYS.askNumber], label: 'Ask for a number' },
      { keys: [KEYS.yes, KEYS.no], label: 'Mark yes, or no' },
      { keys: [KEYS.prevInvestor, KEYS.nextInvestor], label: 'Previous, next investor' },
      { keys: [KEYS.close], label: 'Close' },
    ],
  },
  {
    id: 'pipeline',
    title: 'Pipeline',
    rows: [
      { keys: [KEYS.views], label: 'Board, Race, Maybes' },
      { keys: [KEYS.cardOn, KEYS.cardBack], label: 'Move a card on, back' },
      { keys: [KEYS.density], label: 'Compact or comfortable' },
    ],
  },
]

const NAMED: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Enter: '↵', Escape: 'Esc' }

/** How a key is shown on a chip: `mod+k` → ⌘K, `shift+d` → ⇧D, `ArrowLeft` → ←. (On Windows ⌘ is Ctrl; the sheet says so.) */
export function keyLabel(combo: Combo): string {
  const parts = combo.split('+')
  const key = parts.pop() || '+'
  const mods = (parts.includes('mod') ? '⌘' : '') + (parts.includes('shift') ? '⇧' : '')
  return mods + (NAMED[key] ?? key.toUpperCase())
}

export type KeyEventLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/**
 * Whether a key event is this combo. `mod` is ⌘ or Ctrl. Letters and named keys
 * check Shift exactly (X and ⇧X differ); punctuation doesn't, since Shift is how
 * you type ? on most layouts.
 */
export function matches(e: KeyEventLike, combo: Combo): boolean {
  const parts = combo.split('+')
  const key = parts.pop() || '+'
  if (e.altKey) return false
  if (parts.includes('mod') !== (e.metaKey || e.ctrlKey)) return false
  const shift = parts.includes('shift')
  if (key.length === 1 && /[a-z]/.test(key)) return e.key.toLowerCase() === key && e.shiftKey === shift
  if (key.length === 1) return e.key === key
  return e.key === key && e.shiftKey === shift
}

/** Inputs you don't type into: a single key on a focused checkbox is still a shortcut. */
const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** True while the focus is somewhere you type: a text field, a text area, a select or editable text. */
export function isTyping(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as { tagName?: string; isContentEditable?: boolean; type?: string }
  if (el.isContentEditable) return true
  const tag = el.tagName?.toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  return tag === 'INPUT' && !NOT_TEXT.has((el.type || 'text').toLowerCase())
}

export type GuardEvent = KeyEventLike & Pick<KeyboardEvent, 'target' | 'isComposing' | 'defaultPrevented'>

/** A single-key shortcut (no ⌘, Ctrl or Alt) may run: not while typing, composing text, or after something else handled the key. */
export function singleKeyOk(e: GuardEvent): boolean {
  return !e.defaultPrevented && !e.isComposing && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target)
}
