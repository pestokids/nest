// Rolodex under ?preview: made-up people, firms, companies and investors (every name,
// firm, company and link here is invented). Covers each filter: investors at each tier
// and location, founders and execs of funded companies, every campus and batch, and
// investors of every kind, web-checked and Crustdata-only, during and after a founder's
// time. `&rolodex=investors|investor|picked|person|filtered|empty|loading` picks a state.
import {
  backingTiming, type InvestorKind, type RolodexCompany, type RolodexFirm, type RolodexInvestorFull, type RolodexMeta, type RolodexPerson,
  type RolodexPersonFull, type Timing,
} from '../lib/rolodex'

export const PREVIEW_ROLODEX = ['investors', 'investor', 'picked', 'person', 'filtered', 'empty', 'loading'] as const

type F = Omit<RolodexFirm, '_id' | 'personIds' | 'people' | 'vcPeople' | 'angelPeople' | 'peopleThereNow'>
const FIRMS: F[] = [
  { key: 'id:9001', name: 'Orchard Capital', type: 'VC fund', tier: 'Tier 1', confidence: 'high', geo: 'US firm, India office', hq: 'Palo Alto, California, United States', hqCountryCode: 'US', officeCountries: ['GB', 'IN'], indiaPresence: 'yes', geoSource: 'crustdata', headcount: 140, website: 'https://orchard.example.com' },
  { key: 'id:9002', name: 'Lantern Ventures', type: 'VC fund', tier: 'Tier 1', confidence: 'high', note: 'top India seed', geo: 'India', hq: 'Mumbai, Maharashtra, India', hqCountryCode: 'IN', indiaPresence: 'yes', geoSource: 'crustdata', headcount: 90, website: 'https://lantern.example.com' },
  { key: 'id:9003', name: 'Juniper Seed', type: 'Micro VC', tier: 'Tier 2', confidence: 'high', note: 'pre-seed', geo: 'India', hq: 'Bengaluru, Karnataka, India', hqCountryCode: 'IN', indiaPresence: 'yes', geoSource: 'crustdata', headcount: 12 },
  { key: 'id:9004', name: 'Northwind Accelerator', type: 'Accelerator / incubator', tier: 'Tier 2', confidence: 'high', geo: 'Singapore firm, India office', hq: 'Singapore', hqCountryCode: 'SG', officeCountries: ['IN', 'GB', 'US'], indiaPresence: 'yes', geoSource: 'crustdata', headcount: 600 },
  { key: 'id:9005', name: 'Kite Angels', type: 'Angel network', tier: 'Tier 2', confidence: 'high', geo: 'India', hq: 'New Delhi, India', hqCountryCode: 'IN', indiaPresence: 'yes', geoSource: 'crustdata', headcount: 180 },
  { key: 'id:9006', name: 'Bluebird Partners', type: 'VC fund', tier: 'Tier 2', confidence: 'med', geo: 'US', hq: 'San Francisco, California, United States', hqCountryCode: 'US', indiaPresence: 'no', geoSource: 'crustdata', headcount: 45 },
  { key: 'id:9007', name: 'Saltmarsh Fund', type: 'Micro VC', tier: 'Tier 3', confidence: 'med', geo: 'US', hq: 'Austin, Texas, United States', hqCountryCode: 'US', indiaPresence: 'no', geoSource: 'job_record', headcount: 6 },
  { key: 'id:9008', name: 'Ferncrest Growth', type: 'PE / growth', tier: 'Tier 1', confidence: 'high', geo: 'India', hq: 'Bengaluru, Karnataka, India', hqCountryCode: 'IN', indiaPresence: 'yes', geoSource: 'knowledge', headcount: 120 },
  { key: 'id:9009', name: 'Tidewater Ventures', type: 'Corporate VC', tier: 'Tier 2', confidence: 'high', geo: 'Germany firm, India office', hq: 'Munich, Bavaria, Germany', hqCountryCode: 'DE', officeCountries: ['IN', 'US'], indiaPresence: 'yes', geoSource: 'crustdata', headcount: 110 },
  { key: 'id:9010', name: 'Quarry Labs', type: 'Unknown', geo: 'US', hqCountryCode: 'US', indiaPresence: 'no', geoSource: 'job_record', headcount: 3 },
  { key: 'id:9012', name: 'Harbour Dubai Holdings', type: 'Family office / holding', geo: 'United Arab Emirates', hq: 'Dubai, United Arab Emirates', hqCountryCode: 'AE', indiaPresence: 'no', geoSource: 'crustdata', headcount: 300 },
]

type P = Partial<RolodexPersonFull> & { name: string; role: RolodexPerson['role'] }
const now: Timing = 'current'
const before: Timing = 'past'
const SEED: P[] = [
  { name: 'Ananya Rao', role: 'vc', roleStatus: now, vc: now, currentRole: 'vc', currentTitle: 'Partner', currentCompany: 'Orchard Capital', countryCode: 'IN', country: 'India', city: 'Bengaluru', campus: 'Pilani', gradYear: 2009, firmKeys: ['id:9001'], bestFirmTier: 'Tier 1', headline: 'Partner at Orchard Capital · consumer and kids' },
  { name: 'Rohan Mehta', role: 'vc', roleStatus: now, vc: now, founder: before, currentRole: 'vc', currentTitle: 'Principal', currentCompany: 'Lantern Ventures', countryCode: 'IN', country: 'India', city: 'Mumbai', campus: 'Goa', gradYear: 2014, firmKeys: ['id:9002'], bestFirmTier: 'Tier 1', fundedCompanies: 'Pebblebox (acquired)' },
  { name: 'Ishita Kulkarni', role: 'vc', roleStatus: now, vc: now, currentRole: 'vc', currentTitle: 'Founding Partner', currentCompany: 'Juniper Seed', countryCode: 'IN', country: 'India', city: 'Bengaluru', campus: 'Pilani', gradYear: 2006, firmKeys: ['id:9003'], bestFirmTier: 'Tier 2' },
  { name: 'Karan Bhatt', role: 'vc', roleStatus: before, vc: before, founder: now, currentRole: 'founder', currentTitle: 'Co-founder & CEO', currentCompany: 'Lumen Tutors', countryCode: 'US', country: 'United States', city: 'San Francisco', campus: 'Pilani', gradYear: 2012, firmKeys: ['id:9006'], bestFirmTier: 'Tier 2', fundedCompanies: 'Lumen Tutors (funded)' },
  { name: 'Meera Pillai', role: 'angel', roleStatus: now, angel: now, exec: now, currentRole: 'angel', currentTitle: 'Angel Investor', currentCompany: 'Kite Angels', countryCode: 'IN', country: 'India', city: 'New Delhi', campus: 'Hyderabad', gradYear: 2003, firmKeys: ['id:9005'], bestFirmTier: 'Tier 2' },
  { name: 'Vikram Sethi', role: 'vc', roleStatus: now, vc: now, currentRole: 'vc', currentTitle: 'Director', currentCompany: 'Ferncrest Growth', countryCode: 'IN', country: 'India', city: 'Bengaluru', campus: 'Pilani', gradYear: 1998, firmKeys: ['id:9008'], bestFirmTier: 'Tier 1' },
  { name: 'Leah Fernandes', role: 'vc', roleStatus: now, vc: now, currentRole: 'vc', currentTitle: 'Investment Manager', currentCompany: 'Tidewater Ventures', countryCode: 'DE', country: 'Germany', city: 'Munich', campus: 'Dubai', gradYear: 2017, firmKeys: ['id:9009'], bestFirmTier: 'Tier 2' },
  { name: 'Arjun Nair', role: 'vc', roleStatus: before, vc: before, exec: now, currentRole: 'exec', currentTitle: 'CTO', currentCompany: 'Copperleaf Health', countryCode: 'US', country: 'United States', city: 'Seattle', campus: 'Pilani', gradYear: 2010, firmKeys: ['id:9004'], bestFirmTier: 'Tier 2', fundedCompanies: 'Copperleaf Health (funded)' },
  { name: 'Sana Qureshi', role: 'vc', roleStatus: now, vc: now, currentRole: 'vc', currentTitle: 'Venture Partner', currentCompany: 'Saltmarsh Fund', countryCode: 'US', country: 'United States', city: 'Austin', campus: 'Goa', gradYear: 2015, firmKeys: ['id:9007'], bestFirmTier: 'Tier 3' },
  { name: 'Devika Menon', role: 'angel', roleStatus: now, angel: now, founder: before, currentRole: 'angel', currentTitle: 'Angel Investor', currentCompany: 'Self', countryCode: 'AE', country: 'United Arab Emirates', city: 'Dubai', campus: 'Dubai', gradYear: 2008, fundedCompanies: 'Saffron Rails (acquired)' },
  { name: 'Tarun Gill', role: 'vc', roleStatus: before, vc: before, currentRole: 'employee', currentTitle: 'Product Lead', currentCompany: 'Mapleworks', countryCode: 'GB', country: 'United Kingdom', city: 'London', campus: 'Pilani', gradYear: 2016, firmKeys: ['id:9010'] },
  { name: 'Nikhil Arora', role: 'founder', roleStatus: now, founder: now, exec: now, currentRole: 'founder', currentTitle: 'Founder & CEO', currentCompany: 'Storyloom', countryCode: 'IN', country: 'India', city: 'Bengaluru', campus: 'Pilani', gradYear: 2013, fundedCompanies: 'Storyloom (funded)', headline: 'Building Storyloom, picture books that talk back' },
  { name: 'Priya Venkat', role: 'founder', roleStatus: now, founder: now, currentRole: 'founder', currentTitle: 'Co-founder', currentCompany: 'Kitepath Learning', countryCode: 'IN', country: 'India', city: 'Hyderabad', campus: 'Hyderabad', gradYear: 2016, fundedCompanies: 'Kitepath Learning (funded)' },
  { name: 'Aditya Saxena', role: 'founder', roleStatus: now, founder: now, currentRole: 'founder', currentTitle: 'Founder', currentCompany: 'Gridnest', countryCode: 'US', country: 'United States', city: 'New York', campus: 'Pilani', gradYear: 2007, fundedCompanies: 'Gridnest (funded); Tallow Systems (public)' },
  { name: 'Shreya Iyer', role: 'founder', roleStatus: before, founder: before, currentRole: 'employee', currentTitle: 'Director of Product', currentCompany: 'Bramble Pay', countryCode: 'SG', country: 'Singapore', city: 'Singapore', campus: 'Goa', gradYear: 2011, fundedCompanies: 'Quillnote (acquired)' },
  { name: 'Manish Kapoor', role: 'founder', roleStatus: now, founder: now, exec: before, currentRole: 'founder', currentTitle: 'CEO', currentCompany: 'Ferrytale Games', countryCode: 'IN', country: 'India', city: 'Pune', campus: 'Pilani', gradYear: 2004, fundedCompanies: 'Ferrytale Games (funded)', headline: 'Games for kids 4–8' },
  { name: 'Ritu Bansal', role: 'founder', roleStatus: before, founder: before, currentRole: 'employee', currentTitle: 'Engineering Manager', currentCompany: 'Copperleaf Health', countryCode: 'CA', country: 'Canada', city: 'Toronto', campus: 'Pilani', gradYear: 2018, fundedCompanies: 'Pinwheel Labs (funded)' },
  { name: 'Omar Sheikh', role: 'founder', roleStatus: now, founder: now, currentRole: 'founder', currentTitle: 'Co-founder', currentCompany: 'Dunebook', countryCode: 'AE', country: 'United Arab Emirates', city: 'Dubai', campus: 'Dubai', gradYear: 2019, fundedCompanies: 'Dunebook (funded)' },
  { name: 'Kavya Reddy', role: 'founder', roleStatus: now, founder: now, currentRole: 'founder', currentTitle: 'Founder', currentCompany: 'Moss & Pebble', countryCode: 'IN', country: 'India', city: 'Chennai', campus: 'Pilani', gradYear: 2021, fundedCompanies: 'Moss & Pebble (funded)' },
  { name: 'Harsh Vardhan', role: 'founder', roleStatus: before, founder: before, exec: now, currentRole: 'exec', currentTitle: 'COO', currentCompany: 'Pinecone Freight', countryCode: 'IN', country: 'India', city: 'Gurugram', campus: 'Pilani', gradYear: 1995, fundedCompanies: 'Pinecone Freight (public)' },
  { name: 'Neha Joshi', role: 'exec', roleStatus: now, exec: now, currentRole: 'exec', currentTitle: 'Chief Product Officer', currentCompany: 'Lumen Tutors', countryCode: 'US', country: 'United States', city: 'San Francisco', campus: 'Goa', gradYear: 2012, fundedCompanies: 'Lumen Tutors (funded)' },
  { name: 'Siddharth Rao', role: 'exec', roleStatus: now, exec: now, currentRole: 'exec', currentTitle: 'CFO', currentCompany: 'Tallow Systems', countryCode: 'IN', country: 'India', city: 'Mumbai', campus: 'Pilani', gradYear: 1992, fundedCompanies: 'Tallow Systems (public)' },
  { name: 'Ayesha Khan', role: 'exec', roleStatus: before, exec: before, currentRole: 'employee', currentTitle: 'Head of Growth', currentCompany: 'Bramble Pay', countryCode: 'GB', country: 'United Kingdom', city: 'London', campus: 'Hyderabad', gradYear: 2015, fundedCompanies: 'Saffron Rails (acquired)' },
  { name: 'Gaurav Malhotra', role: 'exec', roleStatus: now, exec: now, currentRole: 'exec', currentTitle: 'CTO', currentCompany: 'Ferrytale Games', countryCode: 'IN', country: 'India', city: 'Pune', campus: 'Pilani', gradYear: 2005, fundedCompanies: 'Ferrytale Games (funded)' },
  { name: 'Lakshmi Narayan', role: 'exec', roleStatus: now, exec: now, currentRole: 'exec', currentTitle: 'Chief Operating Officer', currentCompany: 'Copperleaf Health', countryCode: 'US', country: 'United States', city: 'Seattle', campus: 'Pilani', gradYear: 1988, fundedCompanies: 'Copperleaf Health (funded)' },
]

let idn = 0
const PEOPLE: RolodexPersonFull[] = SEED.map((p) => {
  const id = 50_000 + idn++
  const investor = !!(p.vc || p.angel)
  return {
    _id: 'rp' + id,
    crustdataId: id,
    university: 'BITS',
    currentRole: 'none',
    shortlist: p.shortlist ?? true,
    fundingCheck: p.fundingCheck ?? (investor ? 'investor' : 'funded_company'),
    linkedinUrl: 'https://www.linkedin.com/in/example-' + id,
    location: [p.city, p.country].filter(Boolean).join(', '),
    degree: 'B.E.',
    whyIncluded: [p.vc && 'vc_firm_' + p.vc, p.angel && 'investor_title_' + p.angel, p.founder && 'founder_' + p.founder, p.exec && 'csuite_' + p.exec].filter(Boolean).join('; '),
    currentRoles: p.currentTitle && p.currentCompany ? `${p.currentTitle} @ ${p.currentCompany}` : undefined,
    ...p,
  } as RolodexPersonFull
})

const FIRM_ROWS: RolodexFirm[] = FIRMS.map((f) => {
  const there = PEOPLE.filter((p) => p.firmKeys?.includes(f.key))
  return {
    ...f,
    _id: 'rf' + f.key,
    personIds: there.map((p) => p.crustdataId),
    people: there.length,
    vcPeople: there.filter((p) => p.vc).length,
    angelPeople: there.filter((p) => p.angel).length,
    peopleThereNow: there.filter((p) => p.vc === 'current' || p.angel === 'current').length,
  }
})

/* ---------- companies our founders started, and who invested ---------- */

type Inv = { name: string; kind: InvestorKind; tier?: string; geo?: string }
const INV: Record<string, Inv> = {
  lantern: { name: 'Lantern Ventures', kind: 'vc', tier: 'Tier 1', geo: 'India' },
  orchard: { name: 'Orchard Capital', kind: 'vc', tier: 'Tier 1', geo: 'US firm, India office' },
  juniper: { name: 'Juniper Seed', kind: 'micro_vc', tier: 'Tier 2', geo: 'India' },
  'kite angels': { name: 'Kite Angels', kind: 'angel_network', tier: 'Tier 2', geo: 'India' },
  'northwind accelerator': { name: 'Northwind Accelerator', kind: 'accelerator', tier: 'Tier 2' },
  'meera pillai': { name: 'Meera Pillai', kind: 'angel' },
  'rahul desai': { name: 'Rahul Desai', kind: 'angel' },
  'tidewater': { name: 'Tidewater Ventures', kind: 'corporate', tier: 'Tier 2' },
  'copperline': { name: 'Copperline Credit', kind: 'debt' },
  'saltmarsh': { name: 'Saltmarsh Fund', kind: 'micro_vc', tier: 'Tier 3', geo: 'US' },
  'harbour': { name: 'Harbour Dubai Holdings', kind: 'family_office' },
}
type Back = [key: string, rounds: string[], year: number, lead?: boolean, crustdataOnly?: boolean]
type Co = { name: string; status: string; founders: [name: string, from: string, to: string][]; raised?: string; backs: Back[] }
const COS: Co[] = [
  { name: 'Storyloom', status: 'funded', raised: '$6.5M', founders: [['Nikhil Arora', '2019-04', 'now']], backs: [['lantern', ['Seed 2020 (lead)', 'Series A 2022'], 2020, true], ['meera pillai', ['Pre-seed 2019'], 2019], ['rahul desai', ['Pre-seed 2019'], 2019], ['northwind accelerator', ['Batch W19'], 2019], ['copperline', ['Venture debt 2023'], 2023]] },
  { name: 'Kitepath Learning', status: 'funded', raised: '₹12 Cr', founders: [['Priya Venkat', '2020-01', 'now']], backs: [['juniper', ['Pre-seed 2020 (lead)'], 2020, true], ['lantern', ['Seed 2021'], 2021], ['kite angels', ['Pre-seed 2020'], 2020]] },
  { name: 'Ferrytale Games', status: 'funded', founders: [['Manish Kapoor', '2017-06', 'now']], backs: [['lantern', ['Series A 2021 (lead)'], 2021, true], ['orchard', ['Series B 2024 (lead)'], 2024, true], ['meera pillai', ['Angel 2018'], 2018]] },
  { name: 'Gridnest', status: 'funded', founders: [['Aditya Saxena', '2016-02', 'now']], backs: [['orchard', ['Seed 2016', 'Series A 2018 (lead)'], 2016, true], ['saltmarsh', ['Seed 2016'], 2016]] },
  { name: 'Tallow Systems', status: 'public', founders: [['Aditya Saxena', '2004-01', '2012-06']], backs: [['orchard', ['Series B 2008'], 2008], ['tidewater', ['Series C 2014'], 2014]] },
  { name: 'Pinwheel Labs', status: 'funded', founders: [['Ritu Bansal', '2018-09', '2021-03']], backs: [['juniper', ['Seed 2019'], 2019], ['rahul desai', ['Seed 2022'], 2022]] },
  { name: 'Dunebook', status: 'funded', founders: [['Omar Sheikh', '2021-05', 'now']], backs: [['harbour', ['Seed 2022 (lead)'], 2022, true], ['northwind accelerator', [], 0, false, true]] },
  { name: 'Moss & Pebble', status: 'funded', founders: [['Kavya Reddy', '2022-01', 'now']], backs: [['kite angels', ['Angel 2023'], 2023], ['meera pillai', ['Angel 2023'], 2023]] },
  { name: 'Quillnote', status: 'acquired', founders: [['Shreya Iyer', '2013-03', '2017-11']], backs: [['saltmarsh', [], 0, false, true]] },
  { name: 'Lumen Tutors', status: 'funded', founders: [['Karan Bhatt', '2019-08', 'now']], backs: [['orchard', ['Seed 2020'], 2020], ['lantern', ['Series A 2023 (lead)'], 2023, true]] },
]

const byName = new Map(PEOPLE.map((p) => [p.name, p]))
const COMPANIES: RolodexCompany[] = COS.map((c, i) => ({
  key: 'id:' + (8000 + i),
  name: c.name,
  status: c.status,
  research: c.backs.every((b) => b[4]) ? 'crustdata' : 'web',
  funded: 'yes',
  totalRaised: c.raised,
  confidence: 'high',
  founders: c.founders.map(([name, from, to]) => ({ personId: byName.get(name)!.crustdataId, name, title: 'Founder', from, to })),
  investors: c.backs.map(([key, rounds, year, lead, crustdataOnly]) => ({
    key, name: INV[key].name, kind: INV[key].kind, rounds: rounds.length ? rounds : undefined, firstYear: year || undefined, lead: lead || undefined,
    source: crustdataOnly ? ('crustdata' as const) : ('web' as const),
  })),
}))

const INVESTORS: RolodexInvestorFull[] = Object.entries(INV).map(([key, inv]) => {
  const cos = COMPANIES.filter((c) => c.investors.some((i) => i.key === key))
  const companies = cos.map((c) => {
    const link = c.investors.find((i) => i.key === key)!
    return {
      key: c.key, name: c.name, status: c.status, rounds: link.rounds, firstYear: link.firstYear, lead: link.lead, source: link.source,
      founders: c.founders.map((f) => ({ personId: f.personId, name: f.name, timing: backingTiming(link.firstYear, f.from, f.to) })),
    }
  })
  return {
    key, name: inv.name, kind: inv.kind, tier: inv.tier, geo: inv.geo, companies, companyCount: companies.length,
    founderCount: new Set(companies.flatMap((c) => c.founders.map((f) => f.personId))).size, webCount: companies.filter((c) => c.source === 'web').length,
  }
})

for (const p of PEOPLE) {
  const mine = COMPANIES.filter((c) => c.founders.some((f) => f.personId === p.crustdataId))
  if (!mine.length) continue
  p.companyKeys = mine.map((c) => c.key)
  p.investorKeys = [...new Set(mine.flatMap((c) => c.investors.map((i) => i.key)))]
}

export function previewRolodex(state?: string | null): {
  people: RolodexPersonFull[]
  firms: RolodexFirm[]
  investors: RolodexInvestorFull[]
  companies: RolodexCompany[]
  meta: RolodexMeta | null
} {
  if (state === 'empty') return { people: [], firms: [], investors: [], companies: [], meta: null }
  return {
    people: PEOPLE,
    firms: FIRM_ROWS,
    investors: INVESTORS,
    companies: COMPANIES,
    meta: {
      people: PEOPLE.length, shortlist: PEOPLE.filter((p) => p.shortlist).length, firms: FIRM_ROWS.length, investors: INVESTORS.length, companies: COMPANIES.length,
      importedAt: Date.UTC(2026, 10, 19, 12), source: 'Made-up preview data',
    },
  }
}
