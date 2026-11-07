// PST-279: the morning brief on Today (screens/raise-ai/today-morning-brief.png).
// What happened since yesterday, worked out from plain rows (convex/brief.ts reads
// them at 08:00 IST; the preview builds it from its fixtures), and how each part
// reads. Pure (unit-tested).
import { dayOf } from './google'
import type { MaterialKind } from './materials'

export type BriefWho = { investorId: string; name: string }
export type BriefOpen = BriefWho & { material: string; kind: MaterialKind; ms: number; page?: number }
export const NOTE_STATES = ['read', 'unread', 'none'] as const
export type NoteState = (typeof NOTE_STATES)[number]
export type BriefMeeting = BriefWho & { title: string; notes: NoteState }
export type BriefSince = { replies: BriefWho[]; opens: BriefOpen[]; meetings: BriefMeeting[]; suggestions: { open: number; safe: number } }
export type BriefMove = { key: string; title: string; why: string; reason?: string; investorId?: string }
export type Brief = { _id: string; day: string; builtAt: number; since: BriefSince; moves: BriefMove[]; costUsd: number; dismissedAt?: number }

/** When the brief is built (crons.ts runs it at 02:30 UTC). */
export const BRIEF_TIME = '08:00'
const DAY_MS = 864e5

export type SinceInput = {
  now: number
  investors: readonly { _id: string; name: string }[]
  threads: readonly { investorIds: readonly string[]; lastAt: number; lastFrom: 'us' | 'them' }[]
  materials: readonly { _id: string; kind: MaterialKind; title: string; currentVersionId?: string }[]
  versions: readonly { _id: string; n: number }[]
  links: readonly { _id: string; investorId?: string; materialId: string }[]
  views: readonly { linkId: string; versionId: string; startedAt: number; pages: readonly { page: number; ms: number }[] }[]
  meetings: readonly { _id: string; eventId: string; title: string; start: number; end: number; investorIds: readonly string[] }[]
  /** Saved notes, and whether Nest has finished reading each. */
  notes: readonly { investorId: string; meetingId?: string; date: string; read: boolean }[]
  suggestions: readonly { safe: boolean }[]
}

/** The last 24 hours: who wrote back, what got opened, which meetings happened, and the open suggestions. */
export function sinceYesterday(x: SinceInput): BriefSince {
  const from = x.now - DAY_MS
  const inWindow = (t: number) => t >= from && t <= x.now
  const name = new Map(x.investors.map((i) => [i._id, i.name]))
  const who = (id: string): BriefWho => ({ investorId: id, name: name.get(id)! })

  const replied = new Set<string>()
  for (const t of [...x.threads].sort((a, b) => b.lastAt - a.lastAt))
    if (t.lastFrom === 'them' && inWindow(t.lastAt)) for (const id of t.investorIds) if (name.has(id)) replied.add(id)

  const opened = new Map<string, { o: BriefOpen; pages: Map<number, number> }>()
  for (const w of x.views) {
    if (!inWindow(w.startedAt)) continue
    const l = x.links.find((k) => k._id === w.linkId)
    const m = l && x.materials.find((k) => k._id === l.materialId)
    if (!l?.investorId || !m || !name.has(l.investorId)) continue
    const key = l.investorId + '|' + m._id
    let e = opened.get(key)
    if (!e) {
      const n = x.versions.find((k) => k._id === w.versionId)?.n
      e = { o: { ...who(l.investorId), material: n ? `${m.title} v${n}` : m.title, kind: m.kind, ms: 0 }, pages: new Map() }
      opened.set(key, e)
    }
    for (const p of w.pages) {
      e.o.ms += p.ms
      e.pages.set(p.page, (e.pages.get(p.page) ?? 0) + p.ms)
    }
  }
  const opens = [...opened.values()]
    .map(({ o, pages }) => {
      const top = [...pages.entries()].sort((a, b) => b[1] - a[1])[0]
      return top ? { ...o, page: top[0] } : o
    })
    .sort((a, b) => b.ms - a.ms)

  const seen = new Set<string>()
  const meetings = [...x.meetings]
    .filter((m) => inWindow(m.end) && m.investorIds.some((id) => name.has(id)) && !seen.has(m.eventId) && seen.add(m.eventId))
    .sort((a, b) => a.start - b.start)
    .map((m): BriefMeeting => {
      const id = m.investorIds.find((i) => name.has(i))!
      const ns = x.notes.filter((n) => n.investorId === id && (n.meetingId === m._id || n.date === dayOf(m.start)))
      return { ...who(id), title: m.title, notes: ns.some((n) => n.read) ? 'read' : ns.length ? 'unread' : 'none' }
    })

  return {
    replies: [...replied].map(who),
    opens,
    meetings,
    suggestions: { open: x.suggestions.length, safe: x.suggestions.filter((s) => s.safe).length },
  }
}

/* ---------- how it reads ---------- */

const s = (n: number, one: string, many = one + 's') => (n === 1 ? one : many)
/** "Kite Angels, Antler India" (three names at most, then "and 2 more"). */
export function names(xs: readonly { name: string }[]): string {
  const u = [...new Set(xs.map((x) => x.name))]
  return u.length > 3 ? u.slice(0, 3).join(', ') + ` and ${u.length - 3} more` : u.join(', ')
}
const minutes = (ms: number) => (ms < 6e4 ? 'under a minute' : `${Math.round(ms / 6e4)} min`)
const NOTES: Record<NoteState, string> = { read: 'notes read', unread: 'notes not read yet', none: 'no notes yet' }

export type BriefStat = { key: 'replies' | 'opens' | 'meetings' | 'suggestions'; n: number; label: string; sub: string }

/** The four numbers under "Since yesterday", each with its names line. */
export function briefStats(b: BriefSince): BriefStat[] {
  const decks = b.opens.every((o) => o.kind === 'deck')
  const one = b.opens.length === 1 ? b.opens[0] : null
  const met = b.meetings.length === 1 ? b.meetings[0] : null
  const sg = b.suggestions
  return [
    { key: 'replies', n: b.replies.length, label: s(b.replies.length, 'reply', 'replies'), sub: names(b.replies) || 'Nobody’s waiting on you' },
    {
      key: 'opens', n: b.opens.length, label: (decks ? s(b.opens.length, 'deck') : s(b.opens.length, 'link')) + ' opened',
      sub: one ? [one.name, minutes(one.ms), one.page ? `p${one.page}` : ''].filter(Boolean).join(' · ') : names(b.opens) || 'Nothing opened',
    },
    { key: 'meetings', n: b.meetings.length, label: s(b.meetings.length, 'meeting') + ' done', sub: met ? `${met.name} · ${NOTES[met.notes]}` : names(b.meetings) || 'No meetings' },
    { key: 'suggestions', n: sg.open, label: s(sg.open, 'suggestion'), sub: sg.open ? (sg.safe ? `${sg.safe} safe to accept` : 'None safe to accept in one go') : 'All tidy' },
  ]
}

/** The collapsed brief: "2 replies · 1 deck opened · 1 meeting done · 7 suggestions". */
export const briefLine = (b: BriefSince) =>
  briefStats(b)
    .map((x) => `${x.n} ${x.label}`)
    .join(' · ')

/** The line under a move: Claude's reason, else Today's own why. */
export const moveReason = (m: BriefMove) => m.reason || m.why
