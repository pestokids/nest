// CSV import (preview first) and export. Import headers:
// name, firm, type, geo, warmth, path, tier, wave, expected, nextStep, nextDate, notes, source
// Only `name` is required; everything else defaults as in the new-investor form.
import Papa from 'papaparse'
import { isISODate } from './dates'
import { NEW_INVESTOR, type Investor, type InvestorFields } from './pipeline'
import { GEOS, TIERS, TYPES, WARM, WARMTHS, WAVES, type Geo, type InvestorType, type Tier, type Warmth, type Wave } from './stages'

export const IMPORT_HEADERS = ['name', 'firm', 'email', 'type', 'geo', 'warmth', 'path', 'tier', 'wave', 'expected', 'nextStep', 'nextDate', 'notes', 'source'] as const

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
  const parsed = parseCsv(text)
  if (!parsed.headers.length) return { add: [], skipped: [], unknownHeaders: [], error: 'Paste a CSV with a header row first.' }
  const header = parsed.headers.map((h) => HEADER_MAP[norm(h)] ?? null)
  const unknownHeaders = parsed.headers.filter((_, i) => !header[i]).map((h) => h.trim()).filter(Boolean)
  if (!header.includes('name')) return { add: [], skipped: [], unknownHeaders, error: 'The header row needs a "name" column.' }
  return { ...previewMapped(parsed, header, existing), unknownHeaders }
}

/* ---------- Upload → match columns → import (the three-step import) ---------- */

export type ImportField = (typeof IMPORT_HEADERS)[number]
/** What a CSV column feeds: one investor field, or nothing. */
export type ColumnMap = (ImportField | null)[]
export type ParsedCsv = { headers: string[]; rows: string[][] }

/** Labels for the "Match your columns" selects, in the order they're offered. */
export const FIELD_LABEL: Record<ImportField, string> = {
  name: 'Investor name', firm: 'Firm', email: 'Email', type: 'Type', geo: 'Geography', warmth: 'Relationship', path: 'Warm path', tier: 'Tier',
  wave: 'Wave', expected: 'Expected amount', nextStep: 'Next step', nextDate: 'Next date', notes: 'Notes', source: 'Source',
}

/** Header spellings each field answers to, compared with letters and digits only. */
const SYNONYMS: Record<ImportField, string[]> = {
  name: ['name', 'investor', 'investorname', 'fullname', 'person', 'contact', 'contactname', 'angel'],
  firm: ['firm', 'fund', 'company', 'fundcompany', 'organisation', 'organization', 'org', 'fundname', 'firmname'],
  email: ['email', 'emailaddress', 'mail', 'contactemail', 'workemail'],
  type: ['type', 'kind', 'investortype', 'category'],
  geo: ['geo', 'geography', 'country', 'region', 'location'],
  warmth: ['warmth', 'relationship', 'warm'],
  path: ['path', 'warmpath', 'introvia', 'via', 'introducer', 'connector', 'introby', 'intro', 'referrer'],
  tier: ['tier', 'priority'],
  wave: ['wave'],
  expected: ['expected', 'expectedamount', 'checksize', 'check', 'ticket', 'ticketsize', 'amount', 'cheque', 'chequesize'],
  nextStep: ['nextstep', 'next', 'todo', 'action'],
  nextDate: ['nextdate', 'due', 'duedate', 'followup', 'followupdate'],
  notes: ['notes', 'note', 'comments', 'comment'],
  source: ['source', 'list', 'from'],
}

const key = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, '')

/** Header row and data rows, blank lines dropped. */
export function parseCsv(text: string): ParsedCsv {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, '').trim(), { skipEmptyLines: 'greedy' })
  const [headers = [], ...rows] = parsed.data
  return { headers: headers.map((h) => String(h ?? '').trim()), rows: rows.map((r) => r.map((c) => String(c ?? ''))) }
}

/**
 * Guess which field each column feeds. Exact header matches win, then synonyms;
 * each field is used once (the first column that claims it), so a second notes
 * column is skipped until someone picks it.
 */
export function autoMatch(headers: string[]): ColumnMap {
  const out: ColumnMap = headers.map(() => null)
  const taken = new Set<ImportField>()
  const claim = (test: (k: string, f: ImportField) => boolean) =>
    headers.forEach((h, i) => {
      if (out[i]) return
      const k = key(h)
      if (!k) return
      const f = IMPORT_HEADERS.find((x) => !taken.has(x) && test(k, x))
      if (f) {
        out[i] = f
        taken.add(f)
      }
    })
  claim((k, f) => k === key(f))
  claim((k, f) => SYNONYMS[f].includes(k))
  return out
}

/** The rows a mapping would add and skip. Several columns may feed notes; they're joined. */
export function previewMapped(parsed: ParsedCsv, map: ColumnMap, existing: Pick<Investor, 'name' | 'firm'>[]): Omit<ImportPreview, 'unknownHeaders'> & { updates: number } {
  const seen = new Set(existing.map((i) => dupKey(i.name, i.firm)))
  const add: ImportRow[] = []
  const skipped: SkippedRow[] = []
  let updates = 0
  const notesCols = map.flatMap((f, i) => (f === 'notes' ? [i] : []))
  parsed.rows.forEach((cells, r) => {
    const line = r + 2
    const get = (k: ImportField) => {
      const ix = map.indexOf(k)
      return ix === -1 ? '' : String(cells[ix] ?? '').trim()
    }
    const name = get('name')
    if (!name) return skipped.push({ line, name: '(blank)', reason: 'No name' })
    const problems: string[] = []
    const enumField = <T extends string>(k: ImportField, opts: readonly T[], fallback: T, labels?: Record<string, string>): T => {
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
    const waveRaw = get('wave').replace(/^w(ave)?\s*/i, '')
    let wave: Wave = NEW_INVESTOR.wave
    if (waveRaw) {
      const w = Number(waveRaw)
      if ((WAVES as readonly number[]).includes(w)) wave = w as Wave
      else problems.push(`wave "${get('wave')}" isn't 1, 2 or 3`)
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
    const email = get('email').replace(/^mailto:/i, '')
    if (email && !isEmail(email)) problems.push(`email "${email}" doesn't look like an email`)
    if (problems.length) return skipped.push({ line, name, reason: problems.join('; ') })

    const firm = get('firm')
    const k = dupKey(name, firm)
    if (seen.has(k)) {
      updates++
      return skipped.push({ line, name, reason: firm ? `Already tracked (${name} · ${firm})` : 'Already tracked' })
    }
    seen.add(k)
    const notes =
      notesCols.length > 1
        ? notesCols
            .map((ix) => [parsed.headers[ix], String(cells[ix] ?? '').trim()] as const)
            .filter(([, v]) => v)
            .map(([h, v]) => `${h}: ${v}`)
            .join('\n')
        : get('notes')
    add.push({
      line,
      fields: {
        ...NEW_INVESTOR, name, firm, type, geo, warmth, tier, wave, path: get('path'), expected,
        nextStep: get('nextStep'), nextDate: dateRaw || undefined, notes, source: get('source'),
        ...(email ? { email } : {}),
      },
    })
  })
  return { add, skipped, updates }
}

/** One line for step 2: "38 new · 2 already in the nest · 1 row skipped (no name)". */
export function importSummary(p: { add: unknown[]; skipped: SkippedRow[]; updates: number }): string {
  const parts = [`${p.add.length} new`]
  if (p.updates) parts.push(`${p.updates} already in the nest, left as they are`)
  const bad = p.skipped.filter((s) => !s.reason.startsWith('Already tracked'))
  if (bad.length) {
    const noName = bad.filter((s) => s.reason === 'No name').length
    const why = noName === bad.length ? 'no name' : noName ? `${noName} with no name, ${bad.length - noName} with values we can't read` : "values we can't read"
    parts.push(`${bad.length} row${bad.length === 1 ? '' : 's'} skipped (${why})`)
  }
  return parts.join(' · ')
}

/** The template offered on step 1. */
export const TEMPLATE_CSV = 'name,firm,email,type,warm path,expected,wave,notes\nAsha Rao,Alpha Fund,asha@example.com,Seed fund,Ria,250000,1,Met at a demo day\n'

/** Loose check: something@something.tld, no spaces. */
export const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)

/** "250000", "250k", "1.5m", "$25,000" → dollars; null when unreadable. */

export function parseMoney(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([km]?)$/i.exec(s.trim().replace(/^\$\s*/, '').replace(/,(?=\d{3}\b)/g, ''))
  if (!m) return null
  const mult = { '': 1, k: 1e3, m: 1e6 }[m[2].toLowerCase() as '' | 'k' | 'm']
  return Math.round(Number(m[1]) * mult)
}

export const EXPORT_HEADERS = [
  'name', 'firm', 'type', 'geo', 'warmth', 'path', 'tier', 'wave', 'stage', 'maxStage', 'lead', 'expected', 'committed',
  'nextStep', 'nextDate', 'lastTouch', 'notes', 'source', 'slug', 'email',
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

