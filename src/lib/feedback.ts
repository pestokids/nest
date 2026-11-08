// PST-289: Send feedback (⌘. on any screen, the avatar menu and ⌘K). What the
// dialog sends, how a Linear issue reads, and the shortcut. Shared by the app
// and Convex (convex/feedback.ts). Only the page path travels, never its query
// string, so search terms and ids in the URL stay out of Linear.

export const FEEDBACK_TYPES = ['bug', 'idea', 'slow', 'confusing'] as const
export type FeedbackType = (typeof FEEDBACK_TYPES)[number]
export const FEEDBACK_LABEL: Record<FeedbackType, string> = { bug: 'Bug', idea: 'Idea', slow: 'Slow', confusing: 'Confusing' }

export const FEEDBACK_TEXT_MAX = 5000
export const FEEDBACK_TITLE_MAX = 120

export type Viewport = { w: number; h: number }
export type FeedbackStatus = 'unsent' | 'sending' | 'sent'
export type LinearIssue = { identifier: string; url: string }

/** What sending gave back: the issue, or saved for later (no key, or Linear said no). */
export type FeedbackResult = ({ status: 'sent' } & LinearIssue) | { status: 'unsent'; reason: 'nokey' | 'error' }

/** A row in Settings › Feedback. */
export type FeedbackRow = { _id: string; type: FeedbackType; title: string; path: string; status: FeedbackStatus; issue?: LinearIssue; createdAt: number; by: string }
export type FeedbackList = { linear: boolean; rows: FeedbackRow[] }

/** True for ⌘. on Mac and Ctrl+. elsewhere. */
export const isFeedbackShortcut = (e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>) =>
  e.key === '.' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey

/** The issue title: the first line of the text, cut to fit. */
export function feedbackTitle(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.length > FEEDBACK_TITLE_MAX ? line.slice(0, FEEDBACK_TITLE_MAX - 1).trimEnd() + '…' : line
}

/** "/raise/pipeline?view=race#x" → "/raise/pipeline". */
export function cleanPath(path: string): string {
  const p = path.split(/[?#]/)[0].trim().slice(0, 200)
  return p.startsWith('/') ? p : '/' + p
}

const WORDS: Record<string, string> = { qanda: 'Q&A' }

/** "/raise/pipeline" → "Raise › Pipeline"; "/" → "Home". */
export function pageLabel(path: string): string {
  const parts = cleanPath(path).split('/').filter(Boolean)
  if (!parts.length) return 'Home'
  return parts.map((p) => WORDS[p] ?? p.charAt(0).toUpperCase() + p.slice(1).replace(/[-_]+/g, ' ')).join(' › ')
}

/** "desktop, 1440 wide": the widths the app's own breakpoints use (phones up to 720). */
export function viewportLabel(v: Viewport): string {
  const kind = v.w <= 720 ? 'phone' : v.w <= 960 ? 'tablet' : 'desktop'
  return `${kind}, ${v.w} wide`
}

/** The Linear issue's description: the text, then the page, the viewport and the version, then the screenshot. */
export function issueDescription(f: { type: FeedbackType; text: string; path: string; viewport: Viewport; version: string }, screenshotUrl?: string): string {
  const meta = [
    `**${FEEDBACK_LABEL[f.type]}**, sent from Nest with ⌘.`,
    `Page: \`${cleanPath(f.path)}\` (${pageLabel(f.path)})`,
    `Viewport: ${f.viewport.w} × ${f.viewport.h} (${viewportLabel(f.viewport)})`,
    `Version: ${f.version}`,
  ]
  return [f.text.trim(), '---', meta.join('  \n'), ...(screenshotUrl ? [`![Screenshot of the page](${screenshotUrl})`] : [])].join('\n\n')
}

/* ---------- opening it from anywhere ---------- */

type Listener = () => void
const listeners = new Set<Listener>()

/** Opens Send feedback. Does nothing until the dialog's host is mounted (the app shell). */
export function openFeedback(): void {
  listeners.forEach((l) => l())
}

export function onOpenFeedback(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
