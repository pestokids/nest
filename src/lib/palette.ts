// ⌘K search: rank investors by name and firm, find matches in notes, and the
// sections to jump to. Pure, so the ranking is unit-tested.

export type PaletteInvestor = { _id: string; name: string; firm: string; notes?: string }

const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const words = (s: string) => clean(s).split(/[^a-z0-9]+/).filter(Boolean)

/**
 * How well one text matches the query, 0 for no match. Higher is better:
 * exact > starts with > a word starts with > contains anywhere.
 */
export function matchScore(text: string, query: string): number {
  const t = clean(text)
  const q = clean(query)
  if (!q || !t) return 0
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  const qw = words(q)
  const tw = words(t)
  // Every query word starts some word of the text ("rao as" → "Asha Rao").
  if (qw.length && qw.every((w) => tw.some((x) => x.startsWith(w)))) return qw.length > 1 ? 65 : 60
  if (t.includes(q)) return 40
  return 0
}

/** Investors matching by name (worth more) or firm, best first; ties by name. */
export function rankInvestors<T extends PaletteInvestor>(investors: T[], query: string, limit = 6): T[] {
  if (!clean(query)) return []
  return investors
    .map((i) => {
      const byName = matchScore(i.name, query)
      const byFirm = i.firm && i.firm.trim().toLowerCase() !== i.name.trim().toLowerCase() ? matchScore(i.firm, query) : 0
      return { i, s: Math.max(byName, byFirm * 0.9) }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i.name.localeCompare(b.i.name))
    .slice(0, limit)
    .map((x) => x.i)
}

/** Investors whose notes mention the query but whose name doesn't, with a short quote around it. */
export function searchNotes<T extends PaletteInvestor>(investors: T[], query: string, exclude: Set<string>, limit = 3): { i: T; quote: string }[] {
  const q = clean(query)
  if (q.length < 2) return []
  const out: { i: T; quote: string }[] = []
  for (const i of investors) {
    if (exclude.has(i._id) || !i.notes) continue
    const n = i.notes.replace(/\s+/g, ' ')
    const at = n.toLowerCase().indexOf(q)
    if (at === -1) continue
    const from = Math.max(0, n.lastIndexOf(' ', Math.max(0, at - 24)) + 1)
    const to = Math.min(n.length, at + q.length + 32)
    out.push({ i, quote: (from > 0 ? '…' : '') + n.slice(from, to).trim() + (to < n.length ? '…' : '') })
    if (out.length >= limit) break
  }
  return out
}

export type Section = { label: string; to: string; keys?: string[] }

export const SECTIONS: Section[] = [
  { label: 'Home', to: '/', keys: ['G', 'H'] },
  { label: 'Today', to: '/raise/today', keys: ['G', 'T'] },
  { label: 'Pipeline', to: '/raise/pipeline', keys: ['G', 'P'] },
  { label: 'Investors', to: '/raise/investors', keys: ['G', 'I'] },
  { label: 'Q&A', to: '/raise/qanda', keys: ['G', 'Q'] },
  { label: 'Plan', to: '/raise/plan', keys: ['G', 'L'] },
  { label: 'Settings', to: '/raise/settings', keys: ['G', 'S'] },
]

/** Sections whose name matches, best first. */
export const searchSections = (query: string) =>
  SECTIONS.map((s) => ({ s, score: Math.max(matchScore(s.label, query), matchScore('go to ' + s.label, query)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s)

/** "nightjar capital" → "Nightjar Capital", for the "Add …" row. */
export const titleCase = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/(^|\s)(\p{Ll})/gu, (_, a: string, b: string) => a + b.toUpperCase())
