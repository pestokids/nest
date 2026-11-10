// PST-306: mail that never waits on Dev. Calendar mail (invites, updates and the
// replies to them) and automated mail (no-reply senders, mailing lists,
// auto-replies) don't make a thread wait on Dev, so they make no Reply row and
// no "Waiting on you", and PST-293's signals spend no Jev call on them. Pure,
// from headers and an attachment's type; shared by Convex and the UI. Imports
// nothing from Nest, so google.ts can use it.

const NO_REPLY = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|notify|applications?|apply|support)([+._-][^@]*)?@/i
const AUTO_SUBJECT = /^(auto(matic)?[ -]?reply|out of (the )?office|autoreply|auto:|away from)/i

/** Skip it: an auto-reply (Auto-Submitted, X-Autoreply, bulk Precedence, an out-of-office subject), a mailing list (List-Unsubscribe) or a no-reply sender. */
export function isAutomated(from: string, subject: string, header: (name: string) => string): boolean {
  if (NO_REPLY.test(from)) return true
  const auto = header('Auto-Submitted').trim().toLowerCase()
  if (auto && auto !== 'no') return true
  if (header('X-Autoreply') || header('X-Autorespond') || header('List-Unsubscribe')) return true
  if (/^(auto_reply|bulk|junk|list)$/i.test(header('Precedence').trim())) return true
  return AUTO_SUBJECT.test(subject.trim())
}

const CALENDAR_SUBJECT = /^(re:\s*)*(invitation:|updated invitation( with note)?:|accepted:|declined:|tentative:|tentatively accepted:|invitation from google calendar|canceled event)/i
const CALENDAR_SENDER = /^calendar-notification@|[@.]calendar\.google\.com$/i
const CALENDAR_TYPE = /^(text\/calendar|application\/ics)\b/i
const address = (s: string) => (/[^\s<>"]+@[^\s<>"]+/.exec(s)?.[0] ?? '').toLowerCase()

/** What the checks read: the sender, the subject and any other header (none for a row synced before PST-306). */
export type MailFacts = { from: string; subject: string; header?: (name: string) => string }
const NO_HEADERS = () => ''

/** An invite, an update or a reply to one: the subject Calendar gives it, Calendar as the sender, or a calendar as the whole message. */
export function isCalendarMail(m: MailFacts): boolean {
  const h = m.header ?? NO_HEADERS
  if (CALENDAR_SUBJECT.test(m.subject.trim())) return true
  if ([address(m.from), address(h('Sender'))].some((a) => a && CALENDAR_SENDER.test(a))) return true
  return CALENDAR_TYPE.test(h('Content-Type').trim())
}

/** Calendar or automated: never waits on Dev. */
export const skipsReply = (m: MailFacts) => isCalendarMail(m) || isAutomated(m.from, m.subject, m.header ?? NO_HEADERS)

/** A message's MIME parts, as far as their types and file names go (never their text). */
export type MimePart = { mimeType?: string; filename?: string; parts?: MimePart[] }

/** Its only attachment is an invite: it has one or more, and each is an .ics file or a calendar part. */
export function calendarOnly(p: MimePart | undefined): boolean {
  const attached: MimePart[] = []
  const walk = (x: MimePart) => {
    if (x.filename || CALENDAR_TYPE.test(x.mimeType ?? '')) attached.push(x)
    for (const c of x.parts ?? []) walk(c)
  }
  if (p) walk(p)
  return attached.length > 0 && attached.every((x) => /\.ics$/i.test(x.filename ?? '') || CALENDAR_TYPE.test(x.mimeType ?? ''))
}

/** The investor message Dev owes a reply to: when it came and its Gmail id. */
export type Owed = { at: number; messageId?: string }

/**
 * What a synced thread owes: the sync's answer, or for a row synced before
 * PST-306 (no `owed` yet), its last message unless it's ours or its stored
 * sender and subject say calendar or automated.
 */
export function owedReply(t: { owed?: { at: number; messageId: string } | null; lastFrom: 'us' | 'them'; lastAt: number; lastFromEmail: string; subject: string }): Owed | null {
  if (t.owed !== undefined) return t.owed
  return t.lastFrom === 'them' && !skipsReply({ from: t.lastFromEmail, subject: t.subject }) ? { at: t.lastAt } : null
}
