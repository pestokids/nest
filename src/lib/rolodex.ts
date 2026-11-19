// Rolodex: people from the fundraising research and the investors who backed the
// companies our founders started. Filters, counts, sorts and labels for both views,
// shared by the app, the preview fixture and convex/rolodex.ts (`listRow`,
// `investorListRow`). Pure functions; see rolodex.test.ts.

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
  /** Investors in the companies they founded (the Investor filter). */
  investorKeys?: string[]
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
  companyKeys?: string[]
  companyRoles?: CompanyRole[]
}

/** A company someone founded or ran, and what they did there. */
export type CompanyRole = {
  key: string
  name: string
  status: string
  jobs: { role: 'founder' | 'exec'; title: string; from?: string; to?: string }[]
}

/** "2017–19", "2025–now", "2008" from "YYYY-MM" dates. */
export function yearsText(from?: string, to?: string) {
  const a = from?.slice(0, 4)
  const b = to === 'now' ? 'now' : to?.slice(0, 4)
  if (!a) return b && b !== 'now' ? `until ${b}` : ''
  if (!b) return a
  if (b === 'now') return `${a}–now`
  return a === b ? a : `${a}–${b.slice(2)}`
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

export type RolodexMeta = { people: number; shortlist: number; firms: number; investors?: number; companies?: number; importedAt: number; source: string }

/* ---------- Investors (who backed the companies our founders started) ---------- */

export type InvestorKind = 'vc' | 'micro_vc' | 'angel_network' | 'angel' | 'accelerator' | 'corporate' | 'pe_growth' | 'family_office' | 'government' | 'debt' | 'other' | 'unknown'
/** web: checked on the web; crustdata: only on Crustdata's list. */
export type BackingSource = 'web' | 'crustdata'
/** When the investor came in, against our founder's years there. */
export type BackingTiming = 'during' | 'after' | 'before' | 'unknown'

export type InvestorCompany = {
  key: string
  name: string
  status: string
  rounds?: string[]
  firstYear?: number
  lead?: boolean
  source: BackingSource
  founders: { personId: number; name: string; timing: BackingTiming }[]
}

/** An investor as stored (the panel). */
export type RolodexInvestorFull = {
  key: string
  name: string
  kind: InvestorKind
  aliases?: string[]
  tier?: string
  tierConfidence?: string
  firmType?: string
  geo?: string
  hqCountryCode?: string
  indiaPresence?: 'yes' | 'no'
  website?: string
  companyCount: number
  founderCount: number
  webCount: number
  companies: InvestorCompany[]
}

/** An investor as the list and its filters need them (convex/rolodex.ts `investors`). */
export type RolodexInvestor = Omit<RolodexInvestorFull, 'companies' | 'aliases' | 'website'> & {
  _id: string
  /** Every company they backed, for search ("who backed Zoplar?"). */
  companyNames: string[]
}

export function investorListRow(r: RolodexInvestorFull & { _id: unknown }): RolodexInvestor {
  return {
    _id: String(r._id), key: r.key, name: r.name, kind: r.kind, tier: r.tier, tierConfidence: r.tierConfidence, firmType: r.firmType, geo: r.geo,
    hqCountryCode: r.hqCountryCode, indiaPresence: r.indiaPresence,
    companyCount: r.companyCount, founderCount: r.founderCount, webCount: r.webCount, companyNames: r.companies.map((c) => c.name),
  }
}

/** One company a founder from the list started, and who invested in it (a person's panel). */
export type RolodexCompany = {
  key: string
  name: string
  status: string
  website?: string
  linkedinUrl?: string
  research: 'web' | 'crustdata' | 'none'
  funded?: string
  totalRaised?: string
  confidence?: string
  notes?: string
  sources?: string[]
  founders: { personId: number; name: string; title?: string; from?: string; to?: string }[]
  investors: { key: string; name: string; kind: InvestorKind; rounds?: string[]; firstYear?: number; lead?: boolean; source: BackingSource }[]
}

export const INVESTOR_KIND_LABEL: Record<InvestorKind, string> = {
  vc: 'VC fund', micro_vc: 'Micro VC', angel_network: 'Angel network', angel: 'Angel', accelerator: 'Accelerator', corporate: 'Corporate',
  pe_growth: 'PE / growth', family_office: 'Family office', government: 'Government / grant', debt: 'Venture debt', other: 'Other', unknown: 'Not sure',
}

/** The chips on Investors: groups of kinds. */
export const INVESTOR_GROUPS = ['all', 'funds', 'angels', 'networks', 'accelerators', 'corporates', 'other'] as const
export type InvestorGroup = (typeof INVESTOR_GROUPS)[number]
export const INVESTOR_GROUP_LABEL: Record<InvestorGroup, string> = {
  all: 'All', funds: 'Funds', angels: 'Angels', networks: 'Angel networks', accelerators: 'Accelerators', corporates: 'Corporates & family offices', other: 'Other',
}
const GROUP_KINDS: Record<Exclude<InvestorGroup, 'all'>, readonly InvestorKind[]> = {
  funds: ['vc', 'micro_vc', 'pe_growth'],
  angels: ['angel'],
  networks: ['angel_network'],
  accelerators: ['accelerator'],
  corporates: ['corporate', 'family_office'],
  other: ['government', 'debt', 'other', 'unknown'],
}
export const inGroup = (r: Pick<RolodexInvestor, 'kind'>, g: InvestorGroup = 'all') => g === 'all' || GROUP_KINDS[g].includes(r.kind)

/** Where an investor is: India; US; a US firm with an India office; another firm with one; elsewhere; not known. */
export const LOCATIONS = ['india', 'us', 'us-india', 'other-india', 'elsewhere', 'unknown'] as const
export type Loc = (typeof LOCATIONS)[number]
export const LOCATION_LABEL: Record<Loc, string> = {
  india: 'India', us: 'US', 'us-india': 'US, India office', 'other-india': 'Elsewhere, India office', elsewhere: 'Elsewhere', unknown: 'Not known',
}
export function locOf(r: Pick<RolodexInvestor, 'hqCountryCode' | 'indiaPresence'>): Loc {
  if (!r.hqCountryCode) return 'unknown'
  if (r.hqCountryCode === 'IN') return 'india'
  if (r.hqCountryCode === 'US') return r.indiaPresence === 'yes' ? 'us-india' : 'us'
  return r.indiaPresence === 'yes' ? 'other-india' : 'elsewhere'
}

const SHORT_COUNTRY: Record<string, string> = { 'United States': 'US', 'United Kingdom': 'UK', 'United Arab Emirates': 'UAE', 'Saudi Arabia': 'Saudi', 'Hong Kong': 'HK' }
/** The country for a list row ("US", "UK", "Singapore"), and whether to add an India-office marker. */
export function shortGeo(r: Pick<RolodexInvestor, 'geo' | 'hqCountryCode' | 'indiaPresence'>): { place: string; indiaOffice: boolean } {
  const place = (r.geo ?? '').replace(/ firm, India office$/, '')
  return { place: SHORT_COUNTRY[place] ?? place, indiaOffice: r.indiaPresence === 'yes' && !!r.hqCountryCode && r.hqCountryCode !== 'IN' }
}

export const INVESTOR_SORTS = ['founders', 'companies', 'name', 'tier'] as const
export type InvestorSort = (typeof INVESTOR_SORTS)[number]
export const INVESTOR_SORT_LABEL: Record<InvestorSort, string> = { founders: 'Most founders', companies: 'Most companies', name: 'Name', tier: 'Tier' }

export type InvestorFilters = {
  /** Text: the investor's name or a company they backed. */
  q?: string
  group?: InvestorGroup
  /** Picked investors (their keys): only these. */
  pick?: string[]
  /** Only links checked on the web. */
  web?: boolean
  tier?: (typeof TIERS)[number]
  loc?: Loc
}

export function matchesInvestor(r: RolodexInvestor, f: InvestorFilters, skip?: keyof InvestorFilters) {
  const q = (f.q ?? '').trim().toLowerCase()
  return (
    (skip === 'group' || inGroup(r, f.group)) &&
    (skip === 'pick' || !f.pick?.length || f.pick.includes(r.key)) &&
    (skip === 'web' || !f.web || r.webCount > 0) &&
    (skip === 'tier' || !f.tier || r.tier === f.tier) &&
    (skip === 'loc' || !f.loc || locOf(r) === f.loc) &&
    (skip === 'q' || !q || [r.name, ...r.companyNames].join(' ').toLowerCase().includes(q))
  )
}

export function sortInvestors(rows: RolodexInvestor[], sort: InvestorSort = 'founders') {
  const byName = (a: RolodexInvestor, b: RolodexInvestor) => a.name.localeCompare(b.name)
  const cmp: Record<InvestorSort, (a: RolodexInvestor, b: RolodexInvestor) => number> = {
    founders: (a, b) => b.founderCount - a.founderCount || b.companyCount - a.companyCount || byName(a, b),
    companies: (a, b) => b.companyCount - a.companyCount || b.founderCount - a.founderCount || byName(a, b),
    name: byName,
    tier: (a, b) => (TIER_RANK[a.tier ?? ''] ?? 9) - (TIER_RANK[b.tier ?? ''] ?? 9) || b.founderCount - a.founderCount || byName(a, b),
  }
  return [...rows].sort(cmp[sort])
}

/** How many investors each option of Tier or Location would show, with the other filters kept. */
export function investorOptionCounts<K extends 'tier' | 'loc'>(rows: RolodexInvestor[], f: InvestorFilters, key: K, options: readonly NonNullable<InvestorFilters[K]>[]) {
  const out = new Map<string, number>(options.map((o) => [String(o), 0]))
  for (const r of rows) {
    if (!matchesInvestor(r, f, key)) continue
    const v = key === 'tier' ? r.tier : locOf(r)
    if (v && out.has(v)) out.set(v, (out.get(v) ?? 0) + 1)
  }
  return out
}

export function groupCounts(rows: RolodexInvestor[], f: InvestorFilters): Record<InvestorGroup, number> {
  const out = Object.fromEntries(INVESTOR_GROUPS.map((g) => [g, 0])) as Record<InvestorGroup, number>
  for (const r of rows) {
    if (!matchesInvestor(r, f, 'group')) continue
    for (const g of INVESTOR_GROUPS) if (inGroup(r, g)) out[g]++
  }
  return out
}

export const investorsFiltered = (f: InvestorFilters) => !!(f.q || f.pick?.length || f.web || f.tier || f.loc)

/** Options for the investor picker: matching names first (prefix before substring), then most founders. */
export function investorOptions(rows: RolodexInvestor[], q: string, limit = 60): RolodexInvestor[] {
  const t = q.trim().toLowerCase()
  if (!t) return sortInvestors(rows, 'founders').slice(0, limit)
  const scored: [number, RolodexInvestor][] = []
  for (const r of rows) {
    const n = r.name.toLowerCase()
    const i = n.indexOf(t)
    if (i === 0) scored.push([0, r])
    else if (i > 0 && /\W/.test(n[i - 1])) scored.push([1, r])
    else if (i > 0) scored.push([2, r])
  }
  return scored.sort(([a, x], [b, y]) => a - b || y.founderCount - x.founderCount || x.name.localeCompare(y.name)).slice(0, limit).map(([, r]) => r)
}

/** When an investor came in (their first round's year) against a founder's years there ("2019-03", "now"). */
export function backingTiming(firstYear: number | undefined, from?: string, to?: string): BackingTiming {
  if (!firstYear) return 'unknown'
  const start = from ? Number(from.slice(0, 4)) : NaN
  const end = to && to !== 'now' ? Number(to.slice(0, 4)) : NaN
  if (!Number.isNaN(end) && firstYear > end) return 'after'
  if (!Number.isNaN(start) && firstYear < start) return 'before'
  return Number.isNaN(start) && Number.isNaN(end) ? 'unknown' : 'during'
}

export const TIMING_TEXT: Record<BackingTiming, string> = { during: '', after: 'after they left', before: 'before they joined', unknown: '' }
export const SOURCE_TEXT: Record<BackingSource, string> = { web: 'Checked on the web', crustdata: 'Crustdata, not web-checked' }

export const INVESTOR_CSV_HEADERS = ['investor', 'kind', 'tier', 'location', 'india presence', 'founders', 'companies', 'web-checked companies', 'companies backed'] as const
export function investorCsvRows(rows: RolodexInvestor[]): string[][] {
  return rows.map((r) => [
    r.name, INVESTOR_KIND_LABEL[r.kind], r.tier ?? '', r.geo ?? '', r.indiaPresence ?? '', String(r.founderCount), String(r.companyCount), String(r.webCount), r.companyNames.join('; '),
  ])
}

/** The list projection of a stored person (keeps the page small). */
export function listRow(p: RolodexPersonFull & { _id: unknown }): RolodexPerson {
  return {
    _id: String(p._id), crustdataId: p.crustdataId, name: p.name, headline: p.headline, role: p.role, roleStatus: p.roleStatus, currentRole: p.currentRole,
    vc: p.vc, angel: p.angel, founder: p.founder, exec: p.exec, countryCode: p.countryCode, country: p.country, city: p.city, gradYear: p.gradYear,
    campus: p.campus, currentTitle: p.currentTitle, currentCompany: p.currentCompany, shortlist: p.shortlist, fundingCheck: p.fundingCheck,
    fundedCompanies: p.fundedCompanies, firmKeys: p.firmKeys, bestFirmTier: p.bestFirmTier, linkedinUrl: p.linkedinUrl, investorKeys: p.investorKeys,
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

/** The Rolodex holds only the shortlist (decided 2026-11-17), so 'shortlist' is everyone in it. */
export const WHO = ['shortlist', 'investors', 'founders', 'execs'] as const
export type Who = (typeof WHO)[number]
export const WHO_LABEL: Record<Who, string> = { shortlist: 'All', investors: 'Investors', founders: 'Founders', execs: 'Execs' }
export const WHEN = ['now', 'before'] as const
export type When = (typeof WHEN)[number]
export const TIERS = ['Tier 1', 'Tier 2', 'Tier 3'] as const
export const CAMPUSES = ['Pilani', 'Goa', 'Hyderabad', 'Dubai'] as const
export const BATCHES = ['2020s', '2010s', '2000s', '1990s', 'earlier'] as const
export type Batch = (typeof BATCHES)[number]
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
  /** Investors' keys: founders who raised from any of them. */
  inv?: string[]
}

const isInvestor = (p: RolodexPerson) => !!(p.vc || p.angel)

/** Is this person in the chip's group? */
export function inWho(p: RolodexPerson, who: Who = 'shortlist') {
  switch (who) {
    case 'shortlist': return p.shortlist
    case 'investors': return isInvestor(p)
    case 'founders': return p.shortlist && !!p.founder
    case 'execs': return p.shortlist && !!p.exec
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
    (skip === 'inv' || !f.inv?.length || f.inv.some((k) => p.investorKeys?.includes(k))) &&
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
export function optionCounts<K extends 'tier' | 'campus' | 'batch' | 'when'>(rows: RolodexPerson[], f: PeopleFilters, key: K, options: readonly NonNullable<PeopleFilters[K]>[]) {
  const out = new Map<string, number>()
  for (const o of options) out.set(String(o), 0)
  for (const p of rows) {
    if (!matchesPeople(p, f, key)) continue
    for (const o of options) if (matchesPeople(p, { ...f, [key]: o }, undefined)) out.set(String(o), (out.get(String(o)) ?? 0) + 1)
  }
  return out
}

export const peopleFiltered = (f: PeopleFilters) => !!(f.q || f.when || f.country || f.tier || f.campus || f.batch || f.inv?.length)

/** How many people (in the current view) raised from each investor: the People picker's counts. */
export function investorPeopleCounts(rows: RolodexPerson[], f: PeopleFilters) {
  const out = new Map<string, number>()
  for (const p of rows) {
    if (!p.investorKeys?.length || !matchesPeople(p, f, 'inv')) continue
    for (const k of p.investorKeys) out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}

/* ---------- CSV ---------- */

export const PEOPLE_CSV_HEADERS = ['name', 'linkedin', 'role', 'when', 'doing now', 'title', 'company', 'firm tier', 'funded companies', 'country', 'city', 'campus', 'graduated', 'why'] as const
export function peopleCsvRows(rows: RolodexPerson[]): string[][] {
  return rows.map((p) => [
    p.name, p.linkedinUrl ?? '', p.role === 'none' ? '' : ROLE_LABEL[p.role], p.roleStatus ? TIMING_LABEL[p.roleStatus] : '', CURRENT_LABEL[p.currentRole],
    p.currentTitle ?? '', p.currentCompany ?? '', p.bestFirmTier ?? '', companyList(p.fundedCompanies).map((c) => c.name).join('; '),
    p.country ?? '', p.city ?? '', p.campus ?? '', p.gradYear ? String(p.gradYear) : '', FUNDING_LABEL[p.fundingCheck],
  ])
}
/* ---------- the URL ---------- */

/** Both views' filters, the sort and the open person or investor live in the URL, so a filtered view is a link. Investors' keys are prefixed so each view keeps its own. */
export type RolodexSearch = PeopleFilters & {
  view?: 'investors'
  sort?: PeopleSort
  /** The person whose panel is open (rolodexPeople id). */
  person?: string
  iq?: string
  group?: InvestorGroup
  pick?: string[]
  web?: boolean
  itier?: (typeof TIERS)[number]
  iloc?: Loc
  isort?: InvestorSort
  /** The investor whose panel is open (their key). */
  open?: string
}

const oneOf = <T extends string>(xs: readonly T[], v: unknown): T | undefined => ((xs as readonly unknown[]).includes(v) ? (v as T) : undefined)
const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
/** A list of keys from the URL: an array, or one key. Empty means no filter. */
const keys = (v: unknown): string[] | undefined => {
  const xs = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).filter((x): x is string => typeof x === 'string' && !!x).slice(0, 50)
  return xs.length ? [...new Set(xs)] : undefined
}
const yes = (v: unknown) => (v === true || v === 'true' || v === '1' ? true : undefined)

export function validateRolodexSearch(s: Record<string, unknown>): RolodexSearch {
  return {
    // Old links to the Firms view open Investors.
    view: s.view === 'investors' || s.view === 'firms' ? 'investors' : undefined,
    q: str(s.q),
    who: oneOf(WHO, s.who),
    when: oneOf(WHEN, s.when),
    country: typeof s.country === 'string' && /^[A-Z]{2}$/.test(s.country) ? s.country : undefined,
    tier: oneOf(TIERS, s.tier),
    campus: oneOf(CAMPUSES, s.campus),
    batch: oneOf(BATCHES, s.batch),
    inv: keys(s.inv),
    sort: oneOf(PEOPLE_SORTS, s.sort),
    person: str(s.person),
    iq: str(s.iq),
    group: oneOf(INVESTOR_GROUPS, s.group),
    pick: keys(s.pick),
    web: yes(s.web),
    itier: oneOf(TIERS, s.itier),
    iloc: oneOf(LOCATIONS, s.iloc),
    isort: oneOf(INVESTOR_SORTS, s.isort),
    open: str(s.open),
  }
}
