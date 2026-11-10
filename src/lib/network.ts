// PST-305: Network. Founders, friends, advisors and angels as sources of warm
// intros, on top of PST-294's introducers and intro steps (src/lib/introducers.ts).
// The view's filters and rows, the Add person form's labels by relation, the CSV
// import of people, a founder's investors from a lookup, the intro ask (one email
// naming 2–3 investors, plus a note to forward), and an advisor who wants to
// invest. Pure functions over plain data, shared by the UI and Convex.
import { parseCsv } from './csv'
import { BLANK, blankUnknownNumbers, isEmail, MAX_BODY, MAX_SUBJECT, normBlanks, stripFiller } from './drafts'
import { firmDomain } from './enrich'
import { addressesOf, GENERIC_DOMAINS, normDomain, normEmail } from './google'
import {
  firstName, isToAsk, normName, personRows, PICK_RELATIONS, RELATION_LABEL, relationFromHint, relationOf, rolesOf,
  type Intro, type IntroSources, type Person, type PersonRow, type Relation, type Roles, type StoredRelation,
} from './introducers'
import { costOfRow, type Model } from './models'
import { NEW_INVESTOR, type Investor, type InvestorFields } from './pipeline'
import { COMMIT, type Stage } from './stages'
import { normFirm } from './suggestions'

/* ---------- the view ---------- */

export const NETWORK_FILTERS = ['all', 'founder', 'friend', 'advisor', 'angel', 'investors'] as const
export type NetworkFilter = (typeof NETWORK_FILTERS)[number]
export const FILTER_LABEL: Record<NetworkFilter, string> = { all: 'All', founder: 'Founders', friend: 'Friends', advisor: 'Advisors', angel: 'Angels', investors: 'Investors who intro' }

/** A committed investor (derived), or a person who is also an investor, who can intro. */
export const isInvestorWhoIntros = (p: Pick<Person, 'relation' | 'investorId' | 'roles'>) => (p.relation === 'committed' || !!p.investorId) && rolesOf(p).canIntro

export const inFilter = (p: Pick<Person, 'relation' | 'investorId' | 'roles'>, f: NetworkFilter) => (f === 'all' ? true : f === 'investors' ? isInvestorWhoIntros(p) : p.relation === f)

export const ROLES = ['canIntro', 'wantsToInvest', 'givesAdvice'] as const satisfies readonly (keyof Roles)[]
export const ROLE_LABEL: Record<keyof Roles, string> = { canIntro: 'Can intro', wantsToInvest: 'Wants to invest', givesAdvice: 'Gives advice' }
/** The role chips a row shows: the ones that are on. */
export const roleChips = (r: Roles) => ROLES.filter((k) => r[k]).map((k) => ROLE_LABEL[k])

export type NetworkRow = PersonRow & {
  roles: Roles
  /** How many investors they could introduce Dev to (every intro, to ask or further on). */
  canIntroTo: number
  /** Intros picked and not asked yet. */
  toAsk: number
  /** Their own stage, when they're also an investor (an advisor who invests). */
  stage?: Stage
}

/** Every person with their intros, numbers and roles: something to do first, then by intros made (PST-294's order). */
export function networkRows(src: IntroSources, today: string): NetworkRow[] {
  const byId = new Map(src.investors.map((i) => [i._id, i]))
  return personRows(src, today).map((r) => ({
    ...r,
    roles: rolesOf(r),
    canIntroTo: r.intros.length,
    toAsk: r.intros.filter(isToAsk).length,
    ...(r.investorId && r.relation !== 'committed' && byId.get(r.investorId) ? { stage: byId.get(r.investorId)!.stage } : {}),
  }))
}

/** How many people each filter chip has. */
export function filterCounts(rows: readonly Pick<Person, 'relation' | 'investorId' | 'roles'>[]): Record<NetworkFilter, number> {
  return Object.fromEntries(NETWORK_FILTERS.map((f) => [f, rows.filter((r) => inFilter(r, f)).length])) as Record<NetworkFilter, number>
}

/** "Also your advisor · Asha Linden": the investor drawer's line for someone who is in the Network too. */
export function alsoLine(p: Pick<Person, 'name' | 'relation'>): string {
  const rel = p.relation === 'founder' || p.relation === 'friend' || p.relation === 'advisor' ? 'Also your ' + RELATION_LABEL[p.relation].toLowerCase() : 'Also in your network'
  return rel + ' · ' + p.name
}

/* ---------- Add person: the form's labels by relation (like PST-303) ---------- */

export type PickRelation = Exclude<Relation, 'committed'>
type Copy = { label: string; help?: string; placeholder?: string }
/** The fields a relation's form shows (Name and Email always), with their labels. Notes is where "How you know them" and "What they advise on" are kept. */
export type PersonFieldCopy = { name: Copy; email: Copy; company?: Copy; website?: Copy; notes?: Copy }

const NAME: Copy = { label: 'Name', placeholder: 'e.g. Asha Linden' }
const EMAIL: Copy = { label: 'Email', help: 'Optional. The ask goes here when you send it from Nest.', placeholder: 'e.g. asha@linden.example' }
const NOTES: Copy = { label: 'Notes', help: 'Optional.' }

const PERSON_COPY: Record<PickRelation, PersonFieldCopy> = {
  founder: {
    name: NAME, email: EMAIL,
    company: { label: 'Company', placeholder: 'e.g. Tinkerly' },
    website: { label: 'Company website', help: 'Nest finds who backed it from here.', placeholder: 'e.g. tinkerly.example' },
    notes: NOTES,
  },
  friend: { name: NAME, email: EMAIL, notes: { label: 'How you know them', placeholder: 'e.g. College friend, ex-colleague' } },
  advisor: { name: NAME, email: EMAIL, notes: { label: 'What they advise on', placeholder: 'e.g. Go-to-market and hiring' } },
  angel: { name: NAME, email: EMAIL, company: { label: 'Title or company', placeholder: 'e.g. ex-founder, angel' }, notes: NOTES },
  other: { name: NAME, email: EMAIL, notes: NOTES },
}

export const personFieldCopy = (r: PickRelation): PersonFieldCopy => PERSON_COPY[r]

export type PersonForm = { name: string; email: string; relation: PickRelation; notes: string; company: string; companyDomain: string }
export type PersonPatch = Partial<PersonForm>

/** A company website as Nest keeps it: the bare domain, never personal mail. */
export function cleanDomain(s: string | undefined): string {
  const d = normDomain(s ?? '')
  return d && d.includes('.') && !GENERIC_DOMAINS.has(d) ? d : ''
}

/** Only the fields Dev touched (PST-303's save rule), tidied. Company and website only for the relations whose form shows them. */
export function personPatch(form: PersonForm, touched: Iterable<string>): PersonPatch {
  const keys = new Set(touched)
  const out: PersonPatch = {}
  const copy = personFieldCopy(form.relation)
  if (keys.has('name')) out.name = form.name.trim().replace(/\s+/g, ' ')
  if (keys.has('email')) out.email = normEmail(form.email)
  if (keys.has('relation')) out.relation = form.relation
  if (keys.has('notes')) out.notes = form.notes.trim()
  if (keys.has('company') && copy.company) out.company = form.company.trim()
  if (keys.has('companyDomain') && copy.website) out.companyDomain = cleanDomain(form.companyDomain)
  return out
}

/* ---------- CSV import of people ---------- */

export const PEOPLE_HEADERS = ['name', 'email', 'relation', 'company', 'notes'] as const
export type PeopleField = (typeof PEOPLE_HEADERS)[number]
const HEADER_ALIASES: Record<string, PeopleField> = {
  name: 'name', fullname: 'name', person: 'name', who: 'name',
  email: 'email', emailaddress: 'email', mail: 'email',
  relation: 'relation', relationship: 'relation', type: 'relation', role: 'relation', kind: 'relation',
  company: 'company', firm: 'company', startup: 'company', organisation: 'company', organization: 'company', title: 'company',
  notes: 'notes', note: 'notes', comments: 'notes', howyouknowthem: 'notes',
}

export type PersonImport = { name: string; email?: string; relation: PickRelation; company?: string; notes: string }
export type PeopleRow = { line: number; fields: PersonImport }
export type PeopleSkip = { line: number; name: string; reason: string }
export type PeoplePreview = { add: PeopleRow[]; skipped: PeopleSkip[]; unknownHeaders: string[]; error?: string }

/** "Portfolio founder", "founder", "Mentor", "angel investor", "college friend" → the relation; anything else is Other. Never Committed (that comes from the list). */
export function parseRelation(s: string): PickRelation {
  const v = s.trim().toLowerCase()
  if (!v) return 'other'
  const exact = PICK_RELATIONS.find((r) => r === v || RELATION_LABEL[r].toLowerCase() === v || RELATION_LABEL[r].toLowerCase() + 's' === v)
  if (exact) return exact
  const guess = relationFromHint(v)
  return guess === 'committed' ? 'other' : guess
}

/**
 * The people a CSV holds (name, email, relation, company, notes), against the
 * people already in the Network: anyone with the same email, or the same name,
 * is skipped, and so is a second row for the same person. Only name is required.
 */
export function previewPeople(text: string, existing: readonly { name: string; email?: string }[]): PeoplePreview {
  const parsed = parseCsv(text)
  if (!parsed.headers.length) return { add: [], skipped: [], unknownHeaders: [], error: 'Pick a CSV with a header row first.' }
  const header = parsed.headers.map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[^a-z]/g, '')] ?? null)
  const unknownHeaders = parsed.headers.filter((_, i) => !header[i]).map((h) => h.trim()).filter(Boolean)
  if (!header.includes('name')) return { add: [], skipped: [], unknownHeaders, error: 'The header row needs a "name" column.' }
  const emails = new Set(existing.map((p) => normEmail(p.email)).filter(Boolean))
  const names = new Set(existing.map((p) => normName(p.name)).filter(Boolean))
  const seenEmails = new Set<string>()
  const seenNames = new Set<string>()
  const add: PeopleRow[] = []
  const skipped: PeopleSkip[] = []
  parsed.rows.forEach((cells, k) => {
    const line = k + 2
    const get = (f: PeopleField) => {
      const at = header.indexOf(f)
      return at < 0 ? '' : (cells[at] ?? '').trim()
    }
    if (!cells.some((c) => c.trim())) return
    const name = get('name').replace(/\s+/g, ' ').slice(0, 120)
    if (!normName(name)) return void skipped.push({ line, name: get('email') || '(no name)', reason: 'No name' })
    const raw = get('email')
    const email = normEmail(raw)
    if (raw && !isEmail(email)) return void skipped.push({ line, name, reason: 'That email doesn’t look right' })
    const n = normName(name)
    if ((email && emails.has(email)) || names.has(n)) return void skipped.push({ line, name, reason: 'Already in your Network' })
    if ((email && seenEmails.has(email)) || seenNames.has(n)) return void skipped.push({ line, name, reason: 'Twice in this file' })
    if (email) seenEmails.add(email)
    seenNames.add(n)
    const company = get('company').slice(0, 120)
    add.push({ line, fields: { name, ...(email ? { email } : {}), relation: parseRelation(get('relation')), ...(company ? { company } : {}), notes: get('notes').slice(0, 500) } })
  })
  return { add, skipped, unknownHeaders }
}

export const PEOPLE_TEMPLATE_CSV = 'name,email,relation,company,notes\nAsha Linden,asha@tinkerly.example,Founder,Tinkerly,Backed by Orchard\nRavi Moss,,Friend,,College friend\n'

/* ---------- a founder's investors (Find their investors) ---------- */

export const LOOKUP_MAX = 15
/** One founder's company: about three searches. */
export const LOOKUP_SEARCHES = 3

/** One investor who backed the company, as the lookup keeps it. investorId: already in Nest. */
export type LookupResult = { firm: string; partner?: string; round?: string; year?: number; url: string; domain?: string; investorId?: string; added?: boolean }

/** What a lookup should cost: Haiku reading the instructions and each search on every step, and the web searches at $10 per 1,000. */
export function lookupEstimate(model: Model): number {
  const s = LOOKUP_SEARCHES
  const input = (s + 1) * 2_500 + (4_000 * s * (s + 1)) / 2
  return costOfRow({ input, output: 3_000, cacheRead: 0, cacheWrite: 0, webSearches: s }, model)
}

export type LookupRaw = { firm: string; partner: string | null; round: string | null; year: number | string | null; domain: string | null; url: string | null }

const isUrl = (s: string) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s.trim())
const firmKey = (firm: string) => normFirm(firm) || firm.trim().toLowerCase()

/**
 * The model's answer as results: a firm and a source link each (else left out),
 * the partner, round and year when a page said, repeats dropped, 15 at most.
 */
export function lookupResults(raw: readonly LookupRaw[]): LookupResult[] {
  const out: LookupResult[] = []
  const seen = new Set<string>()
  for (const x of raw) {
    const firm = (x.firm ?? '').trim().replace(/\s+/g, ' ').slice(0, 120)
    const url = (x.url ?? '').trim()
    if (!firm || !isUrl(url)) continue
    const domain = cleanDomain(x.domain ?? '')
    if ((domain && seen.has(domain)) || seen.has(firmKey(firm))) continue
    if (domain) seen.add(domain)
    seen.add(firmKey(firm))
    const year = typeof x.year === 'number' ? x.year : parseInt(String(x.year ?? ''), 10)
    const partner = x.partner?.trim().replace(/\s+/g, ' ').slice(0, 80)
    const round = x.round?.trim().slice(0, 40)
    out.push({ firm, url, ...(partner ? { partner } : {}), ...(round ? { round } : {}), ...(Number.isInteger(year) && year >= 1990 && year <= 2100 ? { year } : {}), ...(domain ? { domain } : {}) })
    if (out.length >= LOOKUP_MAX) break
  }
  return out
}

/** The investor in Nest a found firm is: by domain, else by firm or name. */
export function matchInvestor<T extends Pick<Investor, '_id' | 'name' | 'firm' | 'email' | 'domains'>>(r: { firm: string; domain?: string }, investors: readonly T[]): T | undefined {
  const d = cleanDomain(r.domain)
  if (d) {
    const byDomain = investors.find((i) => [...(i.domains ?? []).map(normDomain), firmDomain(i) ?? ''].includes(d))
    if (byDomain) return byDomain
  }
  const k = firmKey(r.firm)
  return investors.find((i) => firmKey(i.firm.trim() || i.name) === k || firmKey(i.name) === k)
}

/** Mark the results already in Nest: the same firm domain, or the same firm or name once normalised ("Orchard Cap." is Orchard Capital). */
export function markInNest(results: readonly LookupResult[], investors: readonly Pick<Investor, '_id' | 'name' | 'firm' | 'email' | 'domains'>[]): LookupResult[] {
  return results.map((r) => {
    const { investorId: _, ...rest } = r
    const hit = matchInvestor(r, investors)
    return hit ? { ...rest, investorId: hit._id } : rest
  })
}

/** "Seed · 2025", "Pre-seed", "2024". */
export const roundLine = (r: Pick<LookupResult, 'round' | 'year'>) => [r.round ? r.round[0].toUpperCase() + r.round.slice(1) : '', r.year ? String(r.year) : ''].filter(Boolean).join(' · ')

/* ---------- new investors from the Network (a lookup, or "Who do they know") ---------- */

export type NewTarget = { firm: string; partner?: string; domain?: string; round?: string; year?: number; url?: string }

/** A firm someone in the Network can introduce: Not contacted, source "Network", warm path "via <name>". */
export function targetFields(t: NewTarget, via: string): InvestorFields {
  const firm = t.firm.trim().replace(/\s+/g, ' ')
  const partner = t.partner?.trim().replace(/\s+/g, ' ')
  const domain = cleanDomain(t.domain)
  const backed = t.round || t.year ? 'Backed ' + via.trim().split(/\s+/)[0] + '’s company' + (t.round ? ' at ' + t.round : '') + (t.year ? ' in ' + t.year : '') + '.' : ''
  return {
    ...NEW_INVESTOR,
    name: partner || firm,
    firm,
    type: 'Seed fund',
    path: 'via ' + via.trim(),
    source: 'Network',
    notes: [backed, t.url ? 'Source: ' + t.url : ''].filter(Boolean).join('\n'),
    ...(domain ? { domains: [domain] } : {}),
  }
}

/* ---------- an advisor who wants to invest ---------- */

/** An investor already in Nest who is this person: the same email, else the same name. */
export function sameInvestor<T extends Pick<Investor, '_id' | 'name' | 'email' | 'emails'>>(p: { name: string; email?: string }, investors: readonly T[]): T | undefined {
  const e = normEmail(p.email)
  if (e) {
    const byEmail = investors.find((i) => addressesOf(i).emails.includes(e))
    if (byEmail) return byEmail
  }
  const n = normName(p.name)
  return n ? investors.find((i) => normName(i.name) === n) : undefined
}

/** The Angel card "Wants to invest" makes: at Asked, source Network. */
export function angelFields(p: { name: string; email?: string; company?: string; relation: Relation }): InvestorFields {
  return {
    ...NEW_INVESTOR,
    name: p.name.trim(),
    firm: (p.company ?? '').trim(),
    type: 'Angel',
    stage: 'ask',
    warmth: 'warm',
    source: 'Network',
    ...(normEmail(p.email) ? { email: normEmail(p.email) } : {}),
    notes: 'Also your ' + RELATION_LABEL[p.relation].toLowerCase() + '.',
  }
}

/* ---------- the intro ask: 2–3 investors, why each fits, and a note to forward ---------- */

export const ASK_MIN = 2
export const ASK_MAX = 3

/** An intro that can still be asked for: "to ask", and the investor is still open (not passed, not already committed). */
export const askable = (x: Pick<Intro, 'steps'>, inv: Pick<Investor, 'stage'> | undefined) => isToAsk(x) && !!inv && inv.stage !== 'passed' && !COMMIT.has(inv.stage)

/** The ask's preselection: the 3 highest by Priority (ties by name). */
export function askPicks<T extends { _id: string; investorId: string }>(intros: readonly T[], name: (investorId: string) => string, priority: (investorId: string) => number, n = ASK_MAX): string[] {
  return [...intros]
    .sort((a, b) => priority(b.investorId) - priority(a.investorId) || name(a.investorId).localeCompare(name(b.investorId)))
    .slice(0, n)
    .map((x) => x._id)
}

export type AskFit = { name: string; why: string }
export type AskAnswer = { subject?: unknown; opening?: unknown; fits?: unknown; note?: unknown }

/** Where Dev writes why an investor fits, when Nest has nothing to say it from. */
export const WHY_SLOT = '[why they fit]'

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const tidy = (s: string) => stripFiller(normBlanks(s.replace(/\r\n/g, '\n'))).replace(/\n{3,}/g, '\n\n').trim()

/**
 * The model's answer as one email, in Nest's own order: the opening, one line
 * per investor Dev picked (by their name in Nest; a line about anyone else is
 * dropped, and a missing one says [why they fit]), the note to forward, Dev's
 * name. Every number the input (known) didn't give becomes [__].
 */
export function composeAsk(a: AskAnswer, o: { who: string; me: string; picked: readonly string[]; known: string }): { subject: string; body: string } {
  const str = (x: unknown) => (typeof x === 'string' ? x : '')
  const fits = Array.isArray(a.fits) ? (a.fits as unknown[]).map((f) => ({ name: str((f as AskFit)?.name), why: str((f as AskFit)?.why) })) : []
  const safe = (s: string) => blankUnknownNumbers(s, o.known)
  const lines = o.picked.map((name) => {
    const f = fits.find((x) => normName(x.name) === normName(name)) ?? fits.find((x) => !!normFirm(x.name) && normFirm(x.name) === normFirm(name))
    const why = f ? safe(tidy(f.why)).replace(/\s+/g, ' ').replace(/^[-–—:\s]+/, '') : ''
    return '- ' + name + ': ' + (why ? clip(why, 240) : WHY_SLOT)
  })
  const opening = safe(tidy(str(a.opening))) || 'Hi ' + firstName(o.who) + ',\n\nWould you be up for introducing me to a few investors you know? These look like a good fit:'
  const note = safe(tidy(str(a.note)))
  const subject = safe(normBlanks(str(a.subject)).trim().replace(/\s+/g, ' ')).slice(0, MAX_SUBJECT) || 'A few intros?'
  const body = [
    opening,
    lines.join('\n'),
    note ? 'If yes, here’s a short note about Pesto you can forward as it is:\n\n' + note : '',
    'Thanks,\n' + o.me,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_BODY)
  return { subject, body }
}

/** What's left to fill: the [__] blanks and any [why they fit]. */
export const askBlanks = (text: string) => text.split(BLANK).length - 1 + (text.split(WHY_SLOT).length - 1)

/** The ask's title: "Ask Ankur for intros". */
export const askTitle = (who: string) => 'Ask ' + firstName(who) + ' for intros'

/* ---------- reading stored rows ---------- */

/** A stored person as every view reads it ('portfolio' becomes 'founder'). */
export const readPerson = <T extends { relation: StoredRelation }>(p: T): Omit<T, 'relation'> & { relation: Relation } => ({ ...p, relation: relationOf(p.relation) })
