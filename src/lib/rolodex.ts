// Rolodex: people and investor firms from the fundraising research. Filters,
// counts, sorts and labels for both views, shared by the app, the preview fixture
// and convex/rolodex.ts (`listRow`). Pure functions; see rolodex.test.ts.

export type Timing = 'current' | 'past'
export type RoleKey = 'vc' | 'angel' | 'founder' | 'exec'
export type FundingCheck = 'investor' | 'funded_company' | 'unfunded' | 'unverifiable' | 'not_qualified'

/** A person as the list and its filters need them (convex/rolodex.ts `people`). */
export type RolodexPerson = {
  _id: string
  crustdataId: number
  name: string
  headline?: string
  role: RoleKey | 'none'
  roleStatus?: Timing
  currentRole: RoleKey | 'employee' | 'none'
  vc?: Timing
  angel?: Timing
  founder?: Timing
  exec?: Timing
  countryCode?: string
  country?: string
  city?: string
  gradYear?: number
  campus?: string
  currentTitle?: string
  currentCompany?: string
  shortlist: boolean
  fundingCheck: FundingCheck
  fundedCompanies?: string
  firmKeys?: string[]
  bestFirmTier?: string
  linkedinUrl?: string
}

/** Everything kept about one person (the side panel). */
export type RolodexPersonFull = RolodexPerson & {
  linkedinUrl?: string
  university: string
  continent?: string
  location?: string
  degree?: string
  currentIndustries?: string
  currentRoles?: string
  founderCompanies?: string
  unfundedCompanies?: string
  unverifiableCompanies?: string
  investorFirms?: string
  whyIncluded?: string
  otherSchools?: string
  hasBusinessEmail?: boolean
  twitter?: string
  githubUrl?: string
}

export type RolodexFirm = {
  _id: string
  key: string
  crustdataId?: number
  name: string
  type: string
  tier?: string
  confidence?: string
  note?: string
  geo: string
  hq?: string
  hqCountryCode?: string
  officeCountries?: string[]
  indiaPresence: 'yes' | 'no' | 'unknown'
  geoSource?: string
  people: number
  vcPeople: number
  angelPeople: number
  peopleThereNow: number
  headcount?: number
  linkedinUrl?: string
  website?: string
  personIds: number[]
}

export type RolodexMeta = { people: number; shortlist: number; firms: number; importedAt: number; source: string }

/** The list projection of a stored person (keeps the page small). */
export function listRow(p: RolodexPersonFull & { _id: unknown }): RolodexPerson {
  return {
    _id: String(p._id), crustdataId: p.crustdataId, name: p.name, headline: p.headline, role: p.role, roleStatus: p.roleStatus, currentRole: p.currentRole,
    vc: p.vc, angel: p.angel, founder: p.founder, exec: p.exec, countryCode: p.countryCode, country: p.country, city: p.city, gradYear: p.gradYear,
    campus: p.campus, currentTitle: p.currentTitle, currentCompany: p.currentCompany, shortlist: p.shortlist, fundingCheck: p.fundingCheck,
    fundedCompanies: p.fundedCompanies, firmKeys: p.firmKeys, bestFirmTier: p.bestFirmTier, linkedinUrl: p.linkedinUrl,
  }
}

/* ---------- labels ---------- */

export const ROLE_LABEL: Record<RoleKey, string> = { vc: 'VC', angel: 'Angel', founder: 'Founder', exec: 'Exec' }
export const CURRENT_LABEL: Record<RolodexPerson['currentRole'], string> = { vc: 'VC', angel: 'Angel', founder: 'Founder', exec: 'Exec', employee: 'Employee', none: 'No current job' }
export const TIMING_LABEL: Record<Timing, string> = { current: 'now', past: 'before' }
export const FUNDING_LABEL: Record<FundingCheck, string> = {
  investor: 'Investor',
  funded_company: 'Funded company',
  unfunded: 'No funding found',
  unverifiable: 'Couldn’t check',
  not_qualified: 'Not a match',
}
/** Why a person is left out of the shortlist, said plainly (the panel). */
export const LEFT_OUT_WHY: Partial<Record<FundingCheck, string>> = {
  unfunded: 'Every company they founded or ran was checked, and none has funding on record.',
  unverifiable: 'None of their companies could be checked: no Crustdata record, in stealth, or self-employed.',
  not_qualified: 'Matched the search, but their title only names someone else’s role (e.g. Advisor to CEO).',
}
const WHY_LABEL: Record<string, string> = {
  founder: 'Founder', csuite: 'C-suite', investor_title: 'Investor title', vc_firm: 'At a VC/PE firm', investment_mgmt: 'Investment role',
}
/** "founder_current; vc_firm_past" → ["Founder now", "At a VC/PE firm before"]. */
export const whyText = (why?: string) =>
  (why ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.*)_(current|past)$/.exec(s)
      return m ? `${WHY_LABEL[m[1]] ?? m[1]} ${m[2] === 'current' ? 'now' : 'before'}` : s
    })

/** "Name (funded); Other (not_funded)" → [{ name, status }]. */
export function companyList(s?: string): { name: string; status: string }[] {
  return (s ?? '')
    .split('; ')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const m = /^(.*) \(([a-z_]+)\)$/.exec(x)
      return m ? { name: m[1], status: m[2] } : { name: x, status: '' }
    })
}
export const COMPANY_STATUS_LABEL: Record<string, string> = { funded: 'Funded', acquired: 'Acquired', public: 'Public', not_funded: 'No funding found', unknown: 'Couldn’t check', not_checked: 'Not checked' }

/** 'IN' → 🇮🇳 */
export const flag = (cc?: string) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '')

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

/** "Founder now" for the primary role; "In the list" otherwise. */
export function roleText(p: Pick<RolodexPerson, 'role' | 'roleStatus'>) {
  return p.role === 'none' ? 'Not a match' : `${ROLE_LABEL[p.role]}${p.roleStatus ? ' ' + TIMING_LABEL[p.roleStatus] : ''}`
}

/** "Partner at Accel" style line under the name. */
export function personSub(p: Pick<RolodexPerson, 'currentTitle' | 'currentCompany' | 'headline'>) {
  if (p.currentTitle && p.currentCompany) return `${p.currentTitle} · ${p.currentCompany}`
  return p.currentTitle || p.currentCompany || p.headline || ''
}

/** "Pilani ’14" */
export function batchText(p: Pick<RolodexPerson, 'campus' | 'gradYear'>) {
  const campus = p.campus && p.campus !== 'Unspecified' ? p.campus.split(';')[0].trim() : 'BITS'
  return p.gradYear ? `${campus} ’${String(p.gradYear).slice(-2)}` : campus
}

/* ---------- People: filters ---------- */

export const WHO = ['shortlist', 'investors', 'founders', 'execs', 'leftout', 'everyone'] as const
export type Who = (typeof WHO)[number]
export const WHO_LABEL: Record<Who, string> = { shortlist: 'Shortlist', investors: 'Investors', founders: 'Founders', execs: 'Execs', leftout: 'Left out', everyone: 'Everyone' }
export const WHEN = ['now', 'before'] as const
export type When = (typeof WHEN)[number]
export const TIERS = ['Tier 1', 'Tier 2', 'Tier 3'] as const
export const CAMPUSES = ['Pilani', 'Goa', 'Hyderabad', 'Dubai'] as const
export const BATCHES = ['2020s', '2010s', '2000s', '1990s', 'earlier'] as const
export type Batch = (typeof BATCHES)[number]
export const FUNDING = ['funded', 'unfunded', 'unverifiable'] as const
export type FundingFilter = (typeof FUNDING)[number]
export const FUNDING_FILTER_LABEL: Record<FundingFilter, string> = { funded: 'Funded company', unfunded: 'No funding found', unverifiable: 'Couldn’t check' }
export const PEOPLE_SORTS = ['name', 'tier', 'batch', 'country'] as const
export type PeopleSort = (typeof PEOPLE_SORTS)[number]
export const PEOPLE_SORT_LABEL: Record<PeopleSort, string> = { name: 'Name', tier: 'Firm tier', batch: 'Newest batch', country: 'Country' }

export type PeopleFilters = {
  q?: string
  who?: Who
  when?: When
  country?: string
  tier?: (typeof TIERS)[number]
  campus?: (typeof CAMPUSES)[number]
  batch?: Batch
  funding?: FundingFilter
  /** A firm's key: its people (from a firm's panel). */
  firm?: string
}

const isInvestor = (p: RolodexPerson) => !!(p.vc || p.angel)

/** Is this person in the chip's group? */
export function inWho(p: RolodexPerson, who: Who = 'shortlist') {
  switch (who) {
    case 'shortlist': return p.shortlist
    case 'investors': return isInvestor(p)
    case 'founders': return p.shortlist && !!p.founder
    case 'execs': return p.shortlist && !!p.exec
    case 'leftout': return !p.shortlist
    case 'everyone': return true
  }
}

/** The role the chip is about (Investors: vc or angel), now or before. */
function whenMatches(p: RolodexPerson, who: Who, when: When) {
  const want: Timing = when === 'now' ? 'current' : 'past'
  if (who === 'investors') return when === 'now' ? p.vc === 'current' || p.angel === 'current' : !!(p.vc || p.angel) && p.vc !== 'current' && p.angel !== 'current'
  if (who === 'founders') return p.founder === want
  if (who === 'execs') return p.exec === want
  return p.roleStatus === want
}

export function batchOf(year?: number): Batch | undefined {
  if (!year) return undefined
  if (year >= 2020) return '2020s'
  if (year >= 2010) return '2010s'
  if (year >= 2000) return '2000s'
  if (year >= 1990) return '1990s'
  return 'earlier'
}

const fundingOf = (p: RolodexPerson): FundingFilter | undefined =>
  p.fundingCheck === 'funded_company' ? 'funded' : p.fundingCheck === 'unfunded' ? 'unfunded' : p.fundingCheck === 'unverifiable' ? 'unverifiable' : undefined

/** Text search over the name, title, company, headline and funded companies. */
export function matchesQuery(p: RolodexPerson, q: string) {
  if (!q) return true
  return [p.name, p.currentTitle, p.currentCompany, p.headline, p.fundedCompanies, p.city, p.country].join(' ').toLowerCase().includes(q)
}

/** Every filter but `skip` (so each select can count what picking an option would show). */
export function matchesPeople(p: RolodexPerson, f: PeopleFilters, skip?: keyof PeopleFilters) {
  const who = f.who ?? 'shortlist'
  const q = (f.q ?? '').trim().toLowerCase()
  return (
    (skip === 'who' || inWho(p, who)) &&
    (skip === 'when' || !f.when || whenMatches(p, who, f.when)) &&
    (skip === 'country' || !f.country || p.countryCode === f.country) &&
    (skip === 'tier' || !f.tier || p.bestFirmTier === f.tier) &&
    (skip === 'campus' || !f.campus || (p.campus ?? '').includes(f.campus)) &&
    (skip === 'batch' || !f.batch || batchOf(p.gradYear) === f.batch) &&
    (skip === 'funding' || !f.funding || fundingOf(p) === f.funding) &&
    (skip === 'firm' || !f.firm || (p.firmKeys ?? []).includes(f.firm)) &&
    (skip === 'q' || matchesQuery(p, q))
  )
}

const TIER_RANK: Record<string, number> = { 'Tier 1': 1, 'Tier 2': 2, 'Tier 3': 3 }
const ROLE_RANK: Record<string, number> = { vc: 0, angel: 1, founder: 2, exec: 3, none: 4 }

export function sortPeople(rows: RolodexPerson[], sort: PeopleSort = 'name') {
  const byName = (a: RolodexPerson, b: RolodexPerson) => a.name.localeCompare(b.name)
  const cmp: Record<PeopleSort, (a: RolodexPerson, b: RolodexPerson) => number> = {
    name: byName,
    tier: (a, b) => (TIER_RANK[a.bestFirmTier ?? ''] ?? 9) - (TIER_RANK[b.bestFirmTier ?? ''] ?? 9) || ROLE_RANK[a.role] - ROLE_RANK[b.role] || byName(a, b),
    batch: (a, b) => (b.gradYear ?? 0) - (a.gradYear ?? 0) || byName(a, b),
    country: (a, b) => (a.country ?? '~').localeCompare(b.country ?? '~') || byName(a, b),
  }
  return [...rows].sort(cmp[sort])
}

export function whoCounts(rows: RolodexPerson[], f: PeopleFilters): Record<Who, number> {
  const out = Object.fromEntries(WHO.map((w) => [w, 0])) as Record<Who, number>
  for (const p of rows) {
    if (!matchesPeople(p, f, 'who')) continue
    for (const w of WHO) if (inWho(p, w) && (!f.when || whenMatches(p, w, f.when))) out[w]++
  }
  return out
}

/** Countries in the current view, most people first: [code, name, count]. */
export function countryOptions(rows: RolodexPerson[], f: PeopleFilters): { code: string; name: string; n: number }[] {
  const m = new Map<string, { code: string; name: string; n: number }>()
  for (const p of rows) {
    if (!p.countryCode || !matchesPeople(p, f, 'country')) continue
    const e = m.get(p.countryCode) ?? { code: p.countryCode, name: p.country ?? p.countryCode, n: 0 }
    e.n++
    m.set(p.countryCode, e)
  }
  if (f.country && !m.has(f.country)) m.set(f.country, { code: f.country, name: f.country, n: 0 })
  return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
}

/** How many people each option of a select would show, with the other filters as they are. */
export function optionCounts<K extends 'tier' | 'campus' | 'batch' | 'funding' | 'when'>(rows: RolodexPerson[], f: PeopleFilters, key: K, options: readonly NonNullable<PeopleFilters[K]>[]) {
  const out = new Map<string, number>()
  for (const o of options) out.set(String(o), 0)
  for (const p of rows) {
    if (!matchesPeople(p, f, key)) continue
    for (const o of options) if (matchesPeople(p, { ...f, [key]: o }, undefined)) out.set(String(o), (out.get(String(o)) ?? 0) + 1)
  }
  return out
}

export const peopleFiltered = (f: PeopleFilters) => !!(f.q || f.when || f.country || f.tier || f.campus || f.batch || f.funding || f.firm)

/* ---------- Firms ---------- */

/** Types that invest (the default view). */
export const INVESTING_TYPES = ['VC fund', 'Micro VC', 'Accelerator / incubator', 'Angel network', 'Individual angel', 'Corporate VC', 'PE / growth', 'Family office / holding', 'Govt / DFI'] as const
export const KINDS = ['investors', 'vc', 'micro', 'acc', 'angels', 'other', 'unknown', 'not', 'all'] as const
export type Kind = (typeof KINDS)[number]
export const KIND_LABEL: Record<Kind, string> = {
  investors: 'All investors', vc: 'VC funds', micro: 'Micro VCs', acc: 'Accelerators', angels: 'Angels', other: 'CVC, PE & others', unknown: 'Unknown', not: 'Not investors', all: 'Everything',
}
const KIND_TYPES: Partial<Record<Kind, readonly string[]>> = {
  investors: INVESTING_TYPES,
  vc: ['VC fund'],
  micro: ['Micro VC'],
  acc: ['Accelerator / incubator'],
  angels: ['Angel network', 'Individual angel'],
  other: ['Corporate VC', 'PE / growth', 'Family office / holding', 'Govt / DFI'],
  unknown: ['Unknown'],
}
export const isInvestingType = (t: string) => (INVESTING_TYPES as readonly string[]).includes(t)
export function inKind(f: Pick<RolodexFirm, 'type'>, kind: Kind = 'investors') {
  if (kind === 'all') return true
  if (kind === 'not') return !isInvestingType(f.type) && f.type !== 'Unknown'
  return (KIND_TYPES[kind] ?? []).includes(f.type)
}

export const LOCATIONS = ['india', 'us', 'us-india', 'other-india', 'elsewhere', 'unknown'] as const
export type Loc = (typeof LOCATIONS)[number]
export const LOCATION_LABEL: Record<Loc, string> = {
  india: 'India', us: 'US', 'us-india': 'US firm, India office', 'other-india': 'Other firm, India office', elsewhere: 'Elsewhere', unknown: 'Unknown',
}
export function locOf(f: Pick<RolodexFirm, 'geo' | 'hqCountryCode' | 'indiaPresence'>): Loc {
  if (f.geo === 'India') return 'india'
  if (f.geo === 'US') return 'us'
  if (f.geo === 'US firm, India office') return 'us-india'
  if (f.geo === 'Unknown' || !f.hqCountryCode) return 'unknown'
  return f.indiaPresence === 'yes' ? 'other-india' : 'elsewhere'
}

export const FIRM_SORTS = ['people', 'tier', 'name', 'now'] as const
export type FirmSort = (typeof FIRM_SORTS)[number]
export const FIRM_SORT_LABEL: Record<FirmSort, string> = { people: 'Most of our people', now: 'Most there now', tier: 'Tier', name: 'Name' }

export type FirmFilters = { q?: string; kind?: Kind; tier?: (typeof TIERS)[number]; loc?: Loc; india?: boolean }

export function matchesFirm(f: RolodexFirm, x: FirmFilters, skip?: keyof FirmFilters) {
  const q = (x.q ?? '').trim().toLowerCase()
  return (
    (skip === 'kind' || inKind(f, x.kind)) &&
    (skip === 'tier' || !x.tier || f.tier === x.tier) &&
    (skip === 'loc' || !x.loc || locOf(f) === x.loc) &&
    (skip === 'india' || !x.india || f.indiaPresence === 'yes') &&
    (skip === 'q' || !q || [f.name, f.type, f.geo, f.hq, f.note, f.website].join(' ').toLowerCase().includes(q))
  )
}

export function sortFirms(rows: RolodexFirm[], sort: FirmSort = 'people') {
  const byName = (a: RolodexFirm, b: RolodexFirm) => a.name.localeCompare(b.name)
  const cmp: Record<FirmSort, (a: RolodexFirm, b: RolodexFirm) => number> = {
    people: (a, b) => b.people - a.people || (TIER_RANK[a.tier ?? ''] ?? 9) - (TIER_RANK[b.tier ?? ''] ?? 9) || byName(a, b),
    now: (a, b) => b.peopleThereNow - a.peopleThereNow || b.people - a.people || byName(a, b),
    tier: (a, b) => (TIER_RANK[a.tier ?? ''] ?? 9) - (TIER_RANK[b.tier ?? ''] ?? 9) || b.people - a.people || byName(a, b),
    name: byName,
  }
  return [...rows].sort(cmp[sort])
}

export function kindCounts(rows: RolodexFirm[], x: FirmFilters): Record<Kind, number> {
  const out = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>
  for (const f of rows) {
    if (!matchesFirm(f, x, 'kind')) continue
    for (const k of KINDS) if (inKind(f, k)) out[k]++
  }
  return out
}

export function firmOptionCounts<K extends 'tier' | 'loc'>(rows: RolodexFirm[], x: FirmFilters, key: K, options: readonly NonNullable<FirmFilters[K]>[]) {
  const out = new Map<string, number>()
  for (const o of options) out.set(String(o), 0)
  for (const f of rows) {
    if (!matchesFirm(f, x, key)) continue
    for (const o of options) if (matchesFirm(f, { ...x, [key]: o })) out.set(String(o), (out.get(String(o)) ?? 0) + 1)
  }
  return out
}

export const firmsFiltered = (x: FirmFilters) => !!(x.q || x.tier || x.loc || x.india)

/* ---------- CSV ---------- */

export const PEOPLE_CSV_HEADERS = ['name', 'linkedin', 'role', 'when', 'doing now', 'title', 'company', 'firm tier', 'funded companies', 'country', 'city', 'campus', 'graduated', 'shortlist', 'why'] as const
export function peopleCsvRows(rows: RolodexPerson[]): string[][] {
  return rows.map((p) => [
    p.name, p.linkedinUrl ?? '', p.role === 'none' ? '' : ROLE_LABEL[p.role], p.roleStatus ? TIMING_LABEL[p.roleStatus] : '', CURRENT_LABEL[p.currentRole],
    p.currentTitle ?? '', p.currentCompany ?? '', p.bestFirmTier ?? '', companyList(p.fundedCompanies).map((c) => c.name).join('; '),
    p.country ?? '', p.city ?? '', p.campus ?? '', p.gradYear ? String(p.gradYear) : '', p.shortlist ? 'yes' : 'no', FUNDING_LABEL[p.fundingCheck],
  ])
}
export const FIRM_CSV_HEADERS = ['name', 'type', 'tier', 'location', 'hq', 'india office', 'our people', 'there now', 'headcount', 'website', 'linkedin', 'confidence'] as const
export function firmCsvRows(rows: RolodexFirm[]): string[][] {
  return rows.map((f) => [
    f.name, f.type, f.tier ?? '', f.geo, f.hq ?? '', f.indiaPresence, String(f.people), String(f.peopleThereNow), f.headcount ? String(f.headcount) : '', f.website ?? '', f.linkedinUrl ?? '', f.confidence ?? '',
  ])
}

/* ---------- the URL ---------- */

/** Both views' filters, the sort and the open person or firm live in the URL, so a filtered view is a link. Firms' keys are prefixed so each view keeps its own. */
export type RolodexSearch = PeopleFilters & {
  view?: 'firms'
  sort?: PeopleSort
  /** The person whose panel is open (rolodexPeople id). */
  person?: string
  fq?: string
  kind?: Kind
  ftier?: (typeof TIERS)[number]
  loc?: Loc
  india?: boolean
  fsort?: FirmSort
  /** The firm whose panel is open (its key). */
  open?: string
}

const oneOf = <T extends string>(xs: readonly T[], v: unknown): T | undefined => ((xs as readonly unknown[]).includes(v) ? (v as T) : undefined)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export function validateRolodexSearch(s: Record<string, unknown>): RolodexSearch {
  return {
    view: s.view === 'firms' ? 'firms' : undefined,
    q: str(s.q),
    who: oneOf(WHO, s.who),
    when: oneOf(WHEN, s.when),
    country: typeof s.country === 'string' && /^[A-Z]{2}$/.test(s.country) ? s.country : undefined,
    tier: oneOf(TIERS, s.tier),
    campus: oneOf(CAMPUSES, s.campus),
    batch: oneOf(BATCHES, s.batch),
    funding: oneOf(FUNDING, s.funding),
    firm: str(s.firm),
    sort: oneOf(PEOPLE_SORTS, s.sort),
    person: str(s.person),
    fq: str(s.fq),
    kind: oneOf(KINDS, s.kind),
    ftier: oneOf(TIERS, s.ftier),
    loc: oneOf(LOCATIONS, s.loc),
    india: s.india === true || s.india === 'true' || s.india === '1' ? true : undefined,
    fsort: oneOf(FIRM_SORTS, s.fsort),
    open: str(s.open),
  }
}
