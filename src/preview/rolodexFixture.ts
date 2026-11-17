// Rolodex under ?preview: made-up people and firms (every name, firm, company and
// link here is invented). Covers each filter: investors at each tier and location,
// founders of funded and unfunded companies, execs, people left out, every campus
// and batch. `&rolodex=firms|person|firm|filtered|empty|loading|leftout` picks a state.
import type { RolodexFirm, RolodexMeta, RolodexPerson, RolodexPersonFull, Timing } from '../lib/rolodex'

export const PREVIEW_ROLODEX = ['firms', 'person', 'firm', 'filtered', 'empty', 'loading', 'leftout'] as const

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
  { key: 'id:9011', name: 'Glasswing Asset Management', type: 'Asset manager / bank', geo: 'United Kingdom', hqCountryCode: 'GB', indiaPresence: 'no', geoSource: 'crustdata', headcount: 900 },
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
  // left out
  { name: 'Rahul Dutta', role: 'founder', roleStatus: now, founder: now, currentRole: 'founder', currentTitle: 'Founder', currentCompany: 'Tinroof Studio', countryCode: 'IN', country: 'India', city: 'Kolkata', campus: 'Pilani', gradYear: 2020, shortlist: false, fundingCheck: 'unfunded', unfundedCompanies: 'Tinroof Studio (not_funded)' },
  { name: 'Pooja Shetty', role: 'founder', roleStatus: now, founder: now, currentRole: 'founder', currentTitle: 'Founder', currentCompany: 'Stealth Startup', countryCode: 'US', country: 'United States', city: 'San Jose', campus: 'Goa', gradYear: 2014, shortlist: false, fundingCheck: 'unverifiable', unverifiableCompanies: 'Stealth Startup (unknown)' },
  { name: 'Varun Chopra', role: 'exec', roleStatus: before, exec: before, currentRole: 'employee', currentTitle: 'Senior Manager', currentCompany: 'Mapleworks', countryCode: 'IN', country: 'India', city: 'Noida', campus: 'Pilani', gradYear: 2002, shortlist: false, fundingCheck: 'unfunded', unfundedCompanies: 'Brightrail Infotech (not_funded)' },
  { name: 'Zoya Mirza', role: 'founder', roleStatus: before, founder: before, currentRole: 'employee', currentTitle: 'Designer', currentCompany: 'Self-employed', countryCode: 'IN', country: 'India', city: 'Hyderabad', campus: 'Hyderabad', gradYear: 2019, shortlist: false, fundingCheck: 'unverifiable', unverifiableCompanies: 'Self-employed (unknown)' },
  { name: 'Kabir Anand', role: 'none', currentRole: 'employee', currentTitle: 'Advisor to CEO', currentCompany: 'Brightrail Infotech', countryCode: 'IN', country: 'India', city: 'Mumbai', campus: 'Pilani', gradYear: 2011, shortlist: false, fundingCheck: 'not_qualified' },
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

export function previewRolodex(state?: string | null): { people: RolodexPersonFull[]; firms: RolodexFirm[]; meta: RolodexMeta | null } {
  if (state === 'empty') return { people: [], firms: [], meta: null }
  return {
    people: PEOPLE,
    firms: FIRM_ROWS,
    meta: { people: PEOPLE.length, shortlist: PEOPLE.filter((p) => p.shortlist).length, firms: FIRM_ROWS.length, importedAt: Date.UTC(2026, 10, 17, 12), source: 'Made-up preview data' },
  }
}
