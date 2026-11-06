// CSV import (preview first) and export. Import headers:
// name, firm, type, geo, warmth, path, tier, wave, expected, nextStep, nextDate, notes, source
// Only `name` is required; everything else defaults as in the new-investor form.
import Papa from 'papaparse'
import { isISODate } from './dates'
import { NEW_INVESTOR, type Investor, type InvestorFields } from './pipeline'
import { GEOS, TIERS, TYPES, WARM, WARMTHS, WAVES, type Geo, type InvestorType, type Tier, type Warmth, type Wave } from './stages'

export const IMPORT_HEADERS = ['name', 'firm', 'type', 'geo', 'warmth', 'path', 'tier', 'wave', 'expected', 'nextStep', 'nextDate', 'notes', 'source'] as const

export type ImportRow = { line: number; fields: InvestorFields }
export type SkippedRow = { line: number; name: string; reason: string }
export type ImportPreview = { add: ImportRow[]; skipped: SkippedRow[]; unknownHeaders: string[]; error?: string }

export const dupKey = (name: string, firm: string) => `${name.trim().toLowerCase()}\u0000${firm.trim().toLowerCase()}`

const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, '')
const HEADER_MAP: Record<string, (typeof IMPORT_HEADERS)[number]> = Object.fromEntries(IMPORT_HEADERS.map((h) => [norm(h), h]))

function pick<T extends string>(raw: string, options: readonly T[], labels?: Record<string, string>): T | undefined {
  const v = raw.trim().toLowerCase()
  if (!v) return undefined
  const hit = options.find((o) => o.toLowerCase() === v) ?? (labels ? options.find((o) => labels[o]?.toLowerCase() === v) : undefined)
  return hit
}

/** Parse pasted or uploaded CSV text against the investors already tracked. */
export function previewImport(text: string, existing: Pick<Investor, 'name' | 'firm'>[]): ImportPreview {
  const parsed = Papa.parse<string[]>(text.trim(), { skipEmptyLines: 'greedy' })
  const rows = parsed.data
  if (!rows.length) return { add: [], skipped: [], unknownHeaders: [], error: 'Paste a CSV with a header row first.' }
  const header = rows[0].map((h) => HEADER_MAP[norm(h)])
  const unknownHeaders = rows[0].filter((_, i) => !header[i]).map((h) => h.trim()).filter(Boolean)
  if (!header.includes('name')) return { add: [], skipped: [], unknownHeaders, error: 'The header row needs a "name" column.' }

  const seen = new Set(existing.map((i) => dupKey(i.name, i.firm)))
  const add: ImportRow[] = []
  const skipped: SkippedRow[] = []
  rows.slice(1).forEach((cells, r) => {
    const line = r + 2
    const get = (k: (typeof IMPORT_HEADERS)[number]) => {
      const ix = header.indexOf(k)
      return ix === -1 ? '' : String(cells[ix] ?? '').trim()
    }
    const name = get('name')
    if (!name) return skipped.push({ line, name: '(blank)', reason: 'No name' })
    const problems: string[] = []
    const enumField = <T extends string>(k: (typeof IMPORT_HEADERS)[number], opts: readonly T[], fallback: T, labels?: Record<string, string>): T => {
      const raw = get(k)
      if (!raw) return fallback
      const v = pick(raw, opts, labels)
      if (!v) problems.push(`${k} "${raw}" isn't one of ${opts.join(', ')}`)
      return v ?? fallback
    }
    const type = enumField<InvestorType>('type', TYPES, NEW_INVESTOR.type)
    const geo = enumField<Geo>('geo', GEOS, NEW_INVESTOR.geo)
    const warmth = enumField<Warmth>('warmth', WARMTHS, NEW_INVESTOR.warmth, WARM)
    const tier = enumField<Tier>('tier', TIERS, NEW_INVESTOR.tier)
    const waveRaw = get('wave')
    let wave: Wave = NEW_INVESTOR.wave
    if (waveRaw) {
      const w = Number(waveRaw)
      if ((WAVES as readonly number[]).includes(w)) wave = w as Wave
      else problems.push(`wave "${waveRaw}" isn't 1, 2 or 3`)
    }
    const expRaw = get('expected').replace(/[$,\s]/g, '')
    let expected: number | undefined
    if (expRaw) {
      const n = parseMoney(expRaw)
      if (n === null) problems.push(`expected "${get('expected')}" isn't a number`)
      else expected = n
    }
    const dateRaw = get('nextDate')
    if (dateRaw && !isISODate(dateRaw)) problems.push(`nextDate "${dateRaw}" isn't YYYY-MM-DD`)
    if (problems.length) return skipped.push({ line, name, reason: problems.join('; ') })

    const firm = get('firm')
    const key = dupKey(name, firm)
    if (seen.has(key)) return skipped.push({ line, name, reason: firm ? `Already tracked (${name} · ${firm})` : 'Already tracked' })
    seen.add(key)
    add.push({
      line,
      fields: {
        ...NEW_INVESTOR, name, firm, type, geo, warmth, tier, wave, path: get('path'), expected,
        nextStep: get('nextStep'), nextDate: dateRaw || undefined, notes: get('notes'), source: get('source'),
      },
    })
  })
  return { add, skipped, unknownHeaders }
}

/** "250000", "250k", "1.5m" → dollars; null when unreadable. */
export function parseMoney(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(s.trim())
  if (!m) return null
  const mult = { '': 1, k: 1e3, m: 1e6 }[m[2].toLowerCase() as '' | 'k' | 'm']
  return Math.round(Number(m[1]) * mult)
}

export const EXPORT_HEADERS = [
  'name', 'firm', 'type', 'geo', 'warmth', 'path', 'tier', 'wave', 'stage', 'maxStage', 'lead', 'expected', 'committed',
  'nextStep', 'nextDate', 'lastTouch', 'notes', 'source', 'slug',
] as const

/** All investors as CSV (a backup; the import headers are a subset). */
export function exportCsv(inv: Investor[]): string {
  const rows = [...inv]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => EXPORT_HEADERS.map((h) => {
      const v = (i as Record<string, unknown>)[h]
      return v === undefined || v === null ? '' : String(v)
    }))
  return Papa.unparse({ fields: [...EXPORT_HEADERS], data: rows })
}

