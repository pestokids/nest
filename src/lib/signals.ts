// PST-293: signals from emails and notes (Jev). What Jev reads, the questions,
// and what Nest does with the answers: a sure answer changes the decision by
// itself (with Undo), an unsure one becomes a Decide row for the Inbox, and a
// sure ask from an email becomes an Inbox row too. Pure, shared by Convex
// (convex/signals.ts, convex/lib/signalHooks.ts) and the UI.
import { DECISION_LABEL, WANTS_LEAD, type DecisionStatus } from './decisions'
import { choice, JEV_STATE_CHARS, noul, score, THRESHOLDS, topPick, type Answers } from './jev'

/* ---------- the questions ---------- */

export const ASKS = ['deck', 'data', 'numbers', 'meeting', 'intro', 'nothing'] as const
export type AskKind = (typeof ASKS)[number]
export type Ask = Exclude<AskKind, 'nothing'>
export const ASK_LABEL: Record<Ask, string> = { deck: 'the deck', data: 'data', numbers: 'numbers', meeting: 'a meeting', intro: 'an intro' }

/** One call per new email from an investor: the subject and the body as they wrote it (quoted replies and signature cut). */
export type EmailState = { subject: string; email: string }
export const emailQuestions = () => ({
  ask: choice('What are they asking for?', {
    deck: 'The pitch deck',
    data: 'Data: metrics, a data room or documents',
    numbers: 'Numbers: revenue, burn, the round size or terms',
    meeting: 'A meeting or a call',
    intro: 'An introduction to someone',
    nothing: 'Nothing',
  }),
  pass: noul('This email is a pass.'),
  real: noul('This email shows real interest in investing.'),
})

/** One call per new meeting note tied to an investor (Wispr Flow or pasted). */
export type NoteSignalState = { meeting: string; date: string; note: string }
export const noteSignalQuestions = () => ({
  status: choice('What is the investor’s status after this meeting?', { interested: 'Interested', maybe: 'Maybe', yes: 'Yes', no: 'No' }),
  lead: noul('They offered to lead.'),
  comeback: noul('They said to come back when there’s a lead.'),
  score: score('How interested are they in investing, from 1 to 5?', ['1: not interested', '2: a little interested', '3: somewhat interested', '4: interested', '5: very interested']),
})

export type EmailAnswers = Answers<ReturnType<typeof emailQuestions>>
export type NoteAnswers = Answers<ReturnType<typeof noteSignalQuestions>>

/** A Score's answer is the expected index of its criteria (0 to 4 here): the interest from 1 to 5, to one decimal. */
export const interestOf = (s: number) => Math.round(Math.min(5, Math.max(1, s + 1)) * 10) / 10

/* ---------- what Jev reads from an email ---------- */

/** The body without quoted replies, forwarded history or the signature. */
export function stripEmail(body: string): string {
  let t = body.replace(/\r\n?/g, '\n')
  const cuts = [
    /\n[^\n]*\bOn [^\n]{0,300}(\n[^\n]{0,300})?\bwrote:[ \t]*\n/,
    /\n-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i,
    /\n_{8,}\s*\n/,
    /\nFrom: [^\n]+\n(Sent|Date): /,
    /\n-- ?\n/,
    /\n(Sent from my |Get Outlook for )/,
  ]
  t = '\n' + t
  for (const re of cuts) {
    const m = re.exec(t)
    if (m) t = t.slice(0, m.index)
  }
  return t
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('>'))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" }

/** Plain text from an HTML-only email: quoted blocks, styles and tags out, line breaks kept. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, '')
    .replace(/<div[^>]*class="[^"]*gmail_quote[\s\S]*$/i, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#39|[a-z]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m)
}

/** What Jev reads: the subject and the stripped body, together at most JEV_STATE_CHARS. */
export function emailState(subject: string, body: string): EmailState {
  const s = subject.replace(/\s+/g, ' ').trim().slice(0, 300)
  return { subject: s, email: stripEmail(body).slice(0, Math.max(0, JEV_STATE_CHARS - s.length)) }
}

/** A Gmail message payload (format=full), as far as the text goes. */
export type GPart = { mimeType?: string; body?: { data?: string }; parts?: GPart[] }

const decode64url = (s: string) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** The message text: its text/plain part, else its HTML as text. Empty when it has neither. */
export function bodyText(p: GPart | undefined): string {
  const find = (x: GPart | undefined, type: string): string | null => {
    if (!x) return null
    if (x.mimeType === type && x.body?.data) return decode64url(x.body.data)
    for (const c of x.parts ?? []) {
      const hit = find(c, type)
      if (hit !== null) return hit
    }
    return null
  }
  try {
    const plain = find(p, 'text/plain')
    if (plain !== null) return plain
    const html = find(p, 'text/html')
    return html === null ? '' : htmlToText(html)
  } catch {
    return ''
  }
}

/** PST-306: the automated-mail check moved to mail.ts, beside the calendar one. */
export { isAutomated } from './mail'

/* ---------- acting on the answers ---------- */

export type SignalChange = { to: DecisionStatus; reason?: string }
/** auto: change the status now (Undo). decide: an Inbox Decide row proposing it. none: just keep the signal. */
export type SignalOutcome = { kind: 'auto' | 'decide' | 'none'; change?: SignalChange; p: number }

const sureYes = (p: number) => p >= THRESHOLDS.signalYes
const sureNo = (p: number) => p <= THRESHOLDS.signalNo
const NONE: SignalOutcome = { kind: 'none', p: 0 }

/**
 * A change Jev proposes, against the status now. Nothing when it's already that.
 * Nest only changes an open status (none, Interested or Maybe) by itself: a Yes
 * or a No is Dev's, so a sure answer against one asks with a Decide row instead.
 */
function propose(change: SignalChange, p: number, sure: boolean, current: DecisionStatus | undefined): SignalOutcome {
  if (current === change.to) return NONE
  if (!sure) return { kind: 'decide', change, p }
  return { kind: current === 'yes' || current === 'no' ? 'decide' : 'auto', change, p }
}

/** The ask an email makes, when Jev is sure of it. */
export function askOf(a: Pick<EmailAnswers, 'ask'>): Ask | undefined {
  const top = topPick(a.ask)
  return top && top.key !== 'nothing' && top.p >= THRESHOLDS.signalChoice ? (top.key as Ask) : undefined
}

/**
 * An email: a sure pass sets No; sure real interest sets Interested (never over
 * a Yes, and only when it's surely not a pass). Anything unsure is a Decide row.
 * A sure no on both is nothing to decide.
 */
export function emailOutcome(a: EmailAnswers, current?: DecisionStatus): SignalOutcome {
  const pass = a.pass.noul
  const real = a.real.noul
  const interest = current !== 'yes'
  if (sureYes(pass)) return propose({ to: 'no' }, pass, true, current)
  if (sureYes(real)) return interest ? propose({ to: 'interested' }, real, sureNo(pass), current) : NONE
  if (!sureNo(pass)) return propose({ to: 'no' }, pass, false, current)
  if (!sureNo(real) && interest) return propose({ to: 'interested' }, real, false, current)
  return NONE
}

/**
 * A meeting note: "come back when there's a lead" sets Maybe with the reason
 * "wants a lead"; otherwise the status Jev picks. Unsure answers are Decide rows.
 */
export function noteOutcome(a: NoteAnswers, current?: DecisionStatus): SignalOutcome {
  const comeback = a.comeback.noul
  const lead = { to: 'maybe' as const, reason: WANTS_LEAD }
  if (sureYes(comeback)) return propose(lead, comeback, true, current)
  const top = topPick(a.status)
  if (top && top.p >= THRESHOLDS.signalChoice) return propose({ to: top.key as DecisionStatus }, top.p, true, current)
  if (!sureNo(comeback)) return propose(lead, comeback, false, current)
  return top ? propose({ to: top.key as DecisionStatus }, top.p, false, current) : NONE
}

/* ---------- what the app reads ---------- */

/** One signal as the app has it (never the email or note text: those stay on their own rows). */
export type SignalView = {
  _id: string
  investorId: string
  source: 'email' | 'note'
  /** The day of the email or the note. */
  day: string
  at: number
  outcome: SignalOutcome['kind']
  change?: SignalChange & { from?: DecisionStatus }
  /** The probability the outcome rests on. */
  p: number
  /** A sure ask from an email. */
  asked?: Ask
  /** Nouls (0–1). */
  pass?: number
  real?: number
  lead?: number
  comeback?: number
  /** Interest from 1 to 5, and Jev's pick of their status (notes). */
  score?: number
  status?: DecisionStatus
  /** A Decide row was answered (either way). */
  doneAt?: number
  /** An ask's Inbox row was done. */
  askDoneAt?: number
  /** Dev undid the change it made. */
  undoneAt?: number
  /** PST-306: an email's Gmail message id, and how sure Jev is that it asks for nothing (a Reply row's off when sure). */
  messageId?: string
  nothing?: number
}

/** The newest signal about an investor (PST-295's race lanes read it through useDecisions().latestSignal). */
export function latestSignal(signals: readonly SignalView[], investorId: string): SignalView | null {
  let best: SignalView | null = null
  for (const s of signals) if (s.investorId === investorId && (!best || s.at > best.at)) best = s
  return best
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const NOTE_STATUS: Record<DecisionStatus, string> = { interested: 'real interest', maybe: 'on the fence', yes: 'a yes', no: 'a no' }

/** What it says, in a few words: "Real interest", "Asked for the deck", "Offered to lead · interest 4 of 5". */
export function signalLine(s: SignalView): string {
  const parts: string[] = []
  if (s.source === 'email') {
    if ((s.pass ?? 0) >= THRESHOLDS.signalYes) parts.push('a pass')
    else if ((s.real ?? 0) >= THRESHOLDS.signalYes) parts.push('real interest')
    if (s.asked) parts.push('asked for ' + ASK_LABEL[s.asked])
  } else {
    if ((s.comeback ?? 0) >= THRESHOLDS.signalYes) parts.push('come back when there’s a lead · a polite no')
    else if ((s.lead ?? 0) >= THRESHOLDS.signalYes) parts.push('offered to lead')
    else if (s.status) parts.push(NOTE_STATUS[s.status])
    if (s.score !== undefined) {
      const n = Math.round(s.score) + ' of 5'
      if (parts[0]?.includes('interest')) parts[0] += ' (' + n + ')'
      else parts.push('interest ' + n)
    }
  }
  if (!parts.length && s.change) parts.push((s.outcome === 'decide' ? 'maybe ' : '') + DECISION_LABEL[s.change.to].toLowerCase())
  return parts.length ? cap(parts.join(' · ')) : 'Nothing to act on'
}

/** The Decide row's question: "Mark as no?", "Mark as maybe (wants a lead)?". */
export function decideQuestion(c: SignalChange): string {
  return 'Mark as ' + DECISION_LABEL[c.to].toLowerCase() + (c.reason ? ' (' + c.reason + ')' : '') + '?'
}
