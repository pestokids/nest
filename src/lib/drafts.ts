// PST-278: Drafts. Nest writes an intro ask, follow-up, nudge, thank-you or
// data-room note for Dev, and Dev copies it, shares it on WhatsApp or sends it
// from nest@pestokids.com. Pure functions over plain data, shared by the UI and Convex.
import { domainOf, isOurs, nameFromEmail, normEmail } from './google'
import { COMMIT, type Stage } from './stages'

export const DRAFT_TYPES = ['intro', 'followup', 'nudge', 'thanks', 'dataroom'] as const
export type DraftType = (typeof DRAFT_TYPES)[number]
export const TYPE_LABEL: Record<DraftType, string> = { intro: 'Intro ask', followup: 'Follow-up', nudge: 'Nudge', thanks: 'Thank you', dataroom: 'Data room' }

/** The chips under the body: each regenerates the draft with one instruction. */
export const TWEAKS = ['shorter', 'warmer', 'direct', 'deck'] as const
export type Tweak = (typeof TWEAKS)[number]
export const TWEAK_LABEL: Record<Tweak, string> = { shorter: 'Shorter', warmer: 'Warmer', direct: 'More direct', deck: 'Add the deck link' }

export const DRAFT_STATUSES = ['draft', 'sent', 'copied'] as const
export type DraftStatus = (typeof DRAFT_STATUSES)[number]
export const STATUS_LABEL: Record<DraftStatus, string> = { draft: 'Draft', sent: 'Sent', copied: 'Copied' }

/** Where Dev hasn't given a number, the draft says this instead of making one up. */
export const BLANK = '[__]'
/** A link before the investor has a share link to it; Copy, WhatsApp and Send swap in the real one (made then, or reused). */
export const DECK_LINK = '[deck link]'
export const DATA_ROOM_LINK = '[data room link]'
export const LINK_SLOTS = [
  { slot: DECK_LINK, kind: 'deck' },
  { slot: DATA_ROOM_LINK, kind: 'data-room' },
] as const

export const MAX_SUBJECT = 200
export const MAX_BODY = 6000

/**
 * The type the drawer's Draft starts on, from the stage and history: before the
 * intro, an intro ask to the warm path; after a meeting, a follow-up (a nudge
 * when they've gone quiet); from a verbal yes on, a thank-you with the data room.
 */
export function pickType(stage: Stage, o: { quiet?: boolean } = {}): DraftType {
  if (COMMIT.has(stage) || stage === 'passed') return 'thanks'
  if (stage === 'todo' || stage === 'ask' || stage === 'intro') return 'intro'
  if (o.quiet || stage === 'parked') return 'nudge'
  return 'followup'
}

export type Recipient = { name?: string; email: string }
export type ContactPerson = { name: string; email?: string; primary: boolean }

/** Who a draft goes to: the investor's main contact (the primary person with an email), else the investor's email. */
export function mainContact(people: readonly ContactPerson[], investorEmail?: string): Recipient | null {
  const withEmail = people.filter((p) => normEmail(p.email))
  const p = withEmail.find((x) => x.primary) ?? withEmail[0]
  if (p) return { name: p.name, email: normEmail(p.email) }
  const e = normEmail(investorEmail)
  return e ? { email: e } : null
}

/** Someone Dev has met or emailed: a meeting attendee (with their calendar name) or a Gmail participant. */
export type Known = { email: string; name?: string; at: number }

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]+/g) ?? []

/** The names in a warm path: "Ria", "Mira (operator)", "Ankur / Kabir Shah" → [["ria"], ["mira"], ["ankur"], ["kabir", "shah"]]. */
export function pathNames(path: string): string[][] {
  return path
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,/&+;]|\band\b|\bor\b|\bvia\b/i)
    .map(words)
    .filter((w) => w.length > 0 && w.length <= 3)
}

/**
 * The warm-path person for an intro ask: someone the path names who is in Gmail
 * or Calendar history, with their email. A first name matches a first name; a
 * full name has to match both. The most recent contact wins; never one of our
 * own addresses or the investor's.
 */
export function warmPathContact(
  path: string,
  known: readonly Known[],
  o: { exclude?: readonly (string | undefined)[]; excludeDomains?: readonly string[]; self?: string } = {},
): Recipient | null {
  const names = pathNames(path)
  if (!names.length) return null
  const skip = new Set((o.exclude ?? []).map(normEmail).filter(Boolean))
  const theirs = new Set(o.excludeDomains ?? [])
  const best = new Map<string, Known>()
  for (const k of known) {
    const email = normEmail(k.email)
    if (!email || skip.has(email) || theirs.has(domainOf(email)) || isOurs(email, o.self)) continue
    const have = words(k.name || nameFromEmail(email))
    if (!have.length) continue
    const hit = names.some((n) => n[0] === have[0] && (n.length === 1 || n[n.length - 1] === have[have.length - 1]))
    if (!hit) continue
    const prev = best.get(email)
    best.set(email, { email, at: Math.max(k.at, prev?.at ?? 0), name: k.name || prev?.name })
  }
  const top = [...best.values()].sort((a, b) => b.at - a.at)[0]
  return top ? { name: top.name || nameFromEmail(top.email), email: top.email } : null
}

/** Who the dialog fills in as To: the warm-path person for an intro ask (else nobody: the body is a forwardable blurb), the main contact otherwise. */
export function recipientFor(type: DraftType, contact: Recipient | null, warm: Recipient | null): Recipient | null {
  return type === 'intro' ? warm : contact
}

export const recipientLine = (r: Recipient | null) => (r ? (r.name ? r.name + ' · ' + r.email : r.email) : '')

/** The dialog title. */
export function draftTitle(type: DraftType, investor: string, warm?: Recipient | null): string {
  switch (type) {
    case 'intro': return warm?.name ? 'Ask ' + warm.name.split(/\s+/)[0] + ' for an intro to ' + investor : 'Intro blurb for ' + investor
    case 'followup': return 'Follow up with ' + investor
    case 'nudge': return 'Nudge ' + investor
    case 'thanks': return 'Thank ' + investor
    case 'dataroom': return 'Share the data room with ' + investor
  }
}

/** How many [__] are left to fill. */
export const blanks = (text: string) => text.split(BLANK).length - 1

/** Claude's blanks, written any way ("[ __ ]", "[___]"), become exactly [__]; other text is untouched. */
export const normBlanks = (text: string) => text.replace(/\[\s*_+\s*\]/g, BLANK)

/** Drop the filler openers Dev never writes, wherever Claude slips one in. */
export const stripFiller = (body: string) =>
  body.replace(/I hope (this (email |note |message )?finds you well|you(’|')re (doing )?well|all is well)[.!,]?[^\S\n]*\n?/gi, '')

/** The first line of a body that says something (the greeting skipped). */
export function firstLine(body: string): string {
  const lines = body.split(/\n+/).map((l) => l.trim()).filter(Boolean)
  const line = lines.find((l, i) => !(i === 0 && /^(hi|hey|hello|dear)\b[^.!?]{0,40}[,!]?$/i.test(l))) ?? ''
  return line.length > 140 ? line.slice(0, 139) + '…' : line
}

/** A WhatsApp share link with the text filled in. */
export const whatsappUrl = (text: string) => 'https://wa.me/?text=' + encodeURIComponent(text)

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())

/** The touch a sent draft logs: kind email, the subject as its note. */
export const touchNote = (subject: string) => subject.trim().replace(/\s+/g, ' ').slice(0, MAX_SUBJECT) || 'Email'

/* ---------- shapes the UI reads ---------- */

export type DraftVia = 'nest' | 'copy' | 'whatsapp'

export type Draft = {
  _id: string
  investorId: string
  type: DraftType
  subject: string
  body: string
  status: DraftStatus
  costUsd: number
  createdAt: number
  to?: string
  via?: DraftVia
  sentAt?: number
}

/** What the dialog and the drawer's History read for one investor. */
export type InvestorDrafts = {
  /** ANTHROPIC_API_KEY is set; otherwise "AI isn't set up here". */
  aiReady: boolean
  /** RESEND_API_KEY is set; otherwise Send is hidden. */
  emailReady: boolean
  contact: Recipient | null
  warm: Recipient | null
  /** There's a deck in Materials ("Add the deck link" needs one). */
  hasDeck: boolean
  /** Newest first. */
  drafts: Draft[]
}

/** There's a link slot left to fill ([deck link], [data room link]). */
export const hasLinkSlot = (body: string) => LINK_SLOTS.some((s) => body.includes(s.slot))

/** What a draft is when the dialog acts on it: the row (once there is one) and what's in the fields. */
export type DraftInput = { draftId?: string; investorId: string; type: DraftType; to: string; subject: string; body: string }
export type Generated = { draftId: string; subject: string; body: string; costUsd: number }
