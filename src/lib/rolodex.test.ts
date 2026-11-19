import { describe, expect, it } from 'vitest'
import {
  backingTiming, batchOf, batchText, companyList, countryOptions, flag, groupCounts, investorCsvRows, investorListRow, investorOptionCounts, investorOptions,
  investorPeopleCounts, locOf, matchesInvestor, shortGeo, matchesPeople, optionCounts, peopleCsvRows, roleText, sortInvestors, sortPeople, validateRolodexSearch, whoCounts, whyText,
  type RolodexInvestor, type RolodexPerson,
} from './rolodex'

// Every name, firm and company here is made up.
const person = (o: Partial<RolodexPerson> & { name: string }): RolodexPerson => ({ _id: o.name, crustdataId: 1, role: 'founder', currentRole: 'employee', shortlist: true, fundingCheck: 'funded_company', ...o })
const P = [
  person({ name: 'Asha', role: 'vc', roleStatus: 'current', vc: 'current', fundingCheck: 'investor', countryCode: 'IN', country: 'India', bestFirmTier: 'Tier 1', gradYear: 2012, campus: 'Pilani', firmKeys: ['id:1'] }),
  person({ name: 'Bo', role: 'vc', roleStatus: 'past', vc: 'past', founder: 'current', fundingCheck: 'investor', countryCode: 'US', country: 'United States', bestFirmTier: 'Tier 2', gradYear: 2004, campus: 'Goa', investorKeys: ['arbor', 'kai'] }),
  person({ name: 'Cyra', roleStatus: 'current', founder: 'current', countryCode: 'IN', country: 'India', gradYear: 2019, campus: 'Hyderabad', fundedCompanies: 'Inkwell (funded); Fold (acquired)', investorKeys: ['arbor'] }),
  person({ name: 'Dev', role: 'exec', roleStatus: 'past', exec: 'past', countryCode: 'GB', country: 'United Kingdom', gradYear: 1987 }),
]

describe('people filters', () => {
  it('the who chips count each group, and All is the default', () => {
    expect(whoCounts(P, {})).toEqual({ shortlist: 4, investors: 2, founders: 2, execs: 1 })
    expect(P.filter((p) => matchesPeople(p, {})).map((p) => p.name)).toEqual(['Asha', 'Bo', 'Cyra', 'Dev'])
  })
  it('Now and Before follow the chip: Investors now are investing today, Founders before founded in the past', () => {
    expect(P.filter((p) => matchesPeople(p, { who: 'investors', when: 'now' })).map((p) => p.name)).toEqual(['Asha'])
    expect(P.filter((p) => matchesPeople(p, { who: 'investors', when: 'before' })).map((p) => p.name)).toEqual(['Bo'])
    expect(P.filter((p) => matchesPeople(p, { when: 'before' })).map((p) => p.name)).toEqual(['Bo', 'Dev'])
  })
  it('country, tier, campus, batch, investors and search combine', () => {
    expect(P.filter((p) => matchesPeople(p, { country: 'IN' })).map((p) => p.name)).toEqual(['Asha', 'Cyra'])
    expect(P.filter((p) => matchesPeople(p, { tier: 'Tier 1' })).map((p) => p.name)).toEqual(['Asha'])
    expect(P.filter((p) => matchesPeople(p, { campus: 'Goa' })).map((p) => p.name)).toEqual(['Bo'])
    expect(P.filter((p) => matchesPeople(p, { batch: 'earlier' })).map((p) => p.name)).toEqual(['Dev'])
    expect(P.filter((p) => matchesPeople(p, { inv: ['arbor'] })).map((p) => p.name)).toEqual(['Bo', 'Cyra'])
    expect(P.filter((p) => matchesPeople(p, { inv: ['kai', 'nobody'] })).map((p) => p.name)).toEqual(['Bo'])
    expect(P.filter((p) => matchesPeople(p, { inv: ['arbor'], country: 'IN' })).map((p) => p.name)).toEqual(['Cyra'])
    expect(P.filter((p) => matchesPeople(p, { q: 'inkwell' })).map((p) => p.name)).toEqual(['Cyra'])
  })
  it('each select counts what its options would show with the other filters kept', () => {
    expect(countryOptions(P, {})).toEqual([
      { code: 'IN', name: 'India', n: 2 },
      { code: 'GB', name: 'United Kingdom', n: 1 },
      { code: 'US', name: 'United States', n: 1 },
    ])
    const tiers = optionCounts(P, { country: 'IN' }, 'tier', ['Tier 1', 'Tier 2', 'Tier 3'] as const)
    expect([...tiers]).toEqual([['Tier 1', 1], ['Tier 2', 0], ['Tier 3', 0]])
  })
  it('sorts by firm tier (then role), newest batch, or name', () => {
    expect(sortPeople(P.slice(0, 4), 'tier').map((p) => p.name)).toEqual(['Asha', 'Bo', 'Cyra', 'Dev'])
    expect(sortPeople(P.slice(0, 4), 'batch').map((p) => p.name)).toEqual(['Cyra', 'Asha', 'Bo', 'Dev'])
  })
})

describe('labels', () => {
  it('says roles, batches, companies and why plainly', () => {
    expect(roleText(P[0])).toBe('VC now')
    expect(roleText({ role: 'none' })).toBe('Not a match')
    expect(batchText({ campus: 'Pilani', gradYear: 2012 })).toBe('Pilani ’12')
    expect(batchText({ campus: 'Unspecified' })).toBe('BITS')
    expect(batchOf(1999)).toBe('1990s')
    expect(companyList('Inkwell (funded); Fold Labs (not_funded)')).toEqual([{ name: 'Inkwell', status: 'funded' }, { name: 'Fold Labs', status: 'not_funded' }])
    expect(whyText('founder_current; vc_firm_past')).toEqual(['Founder now', 'At a VC/PE firm before'])
    expect(flag('IN')).toBe('🇮🇳')
    expect(flag('')).toBe('')
  })
  it('CSV rows hold the columns in header order', () => {
    expect(peopleCsvRows([P[2]])[0]).toEqual(['Cyra', '', 'Founder', 'now', 'Employee', '', '', '', 'Inkwell; Fold', 'India', '', 'Hyderabad', '2019', 'Funded company'])
  })
})

const inv = (o: Partial<RolodexInvestor> & { name: string }): RolodexInvestor => ({ _id: o.name, key: o.name.toLowerCase(), kind: 'vc', companyCount: 1, founderCount: 1, webCount: 1, companyNames: [], ...o })
const I = [
  inv({ name: 'Arbor', tier: 'Tier 1', founderCount: 4, companyCount: 3, companyNames: ['Inkwell', 'Fold', 'Quay'], hqCountryCode: 'US', indiaPresence: 'yes', geo: 'US firm, India office' }),
  inv({ name: 'Kai Rao', kind: 'angel', founderCount: 2, companyNames: ['Inkwell'], hqCountryCode: 'IN', indiaPresence: 'yes', geo: 'India' }),
  inv({ name: 'Brook Angels', kind: 'angel_network', tier: 'Tier 3', founderCount: 2, companyCount: 2, webCount: 0, companyNames: ['Mote', 'Fold'], hqCountryCode: 'SG', indiaPresence: 'no' }),
  inv({ name: 'Cove Labs', kind: 'accelerator', tier: 'Tier 2', companyNames: ['Quay'], hqCountryCode: 'GB', indiaPresence: 'yes' }),
  inv({ name: 'Harbor Credit', kind: 'debt', webCount: 0, companyNames: ['Mote'] }),
]

describe('investors', () => {
  it('groups: funds, angels, networks, accelerators, other; All is everyone', () => {
    expect(groupCounts(I, {})).toMatchObject({ all: 5, funds: 1, angels: 1, networks: 1, accelerators: 1, corporates: 0, other: 1 })
  })
  it('search finds an investor by name or by a company they backed; picks narrow to those picked', () => {
    expect(I.filter((r) => matchesInvestor(r, { q: 'fold' })).map((r) => r.name)).toEqual(['Arbor', 'Brook Angels'])
    expect(I.filter((r) => matchesInvestor(r, { pick: ['kai rao', 'cove labs'] })).map((r) => r.name)).toEqual(['Kai Rao', 'Cove Labs'])
    expect(I.filter((r) => matchesInvestor(r, { web: true, group: 'other' })).map((r) => r.name)).toEqual([])
  })
  it('sorts by founders (then companies), companies, name, or tier', () => {
    expect(sortInvestors(I).map((r) => r.name)).toEqual(['Arbor', 'Brook Angels', 'Kai Rao', 'Cove Labs', 'Harbor Credit'])
    expect(sortInvestors(I, 'name').map((r) => r.name)[0]).toBe('Arbor')
    expect(sortInvestors(I, 'tier').map((r) => r.name)).toEqual(['Arbor', 'Cove Labs', 'Brook Angels', 'Kai Rao', 'Harbor Credit'])
  })
  it('location: India, US, US with an India office, others with one, elsewhere, not known; Tier and Location count their options', () => {
    expect(I.map(locOf)).toEqual(['us-india', 'india', 'elsewhere', 'other-india', 'unknown'])
    expect(I.filter((r) => matchesInvestor(r, { loc: 'india' })).map((r) => r.name)).toEqual(['Kai Rao'])
    expect(shortGeo(I[0])).toEqual({ place: 'US', indiaOffice: true })
    expect(shortGeo({ geo: 'United Arab Emirates', hqCountryCode: 'AE', indiaPresence: 'no' })).toEqual({ place: 'UAE', indiaOffice: false })
    expect([...investorOptionCounts(I, {}, 'tier', ['Tier 1', 'Tier 2', 'Tier 3'] as const)]).toEqual([['Tier 1', 1], ['Tier 2', 1], ['Tier 3', 1]])
    expect(investorOptionCounts(I, { group: 'funds' }, 'loc', ['us-india', 'india'] as const).get('us-india')).toBe(1)
  })
  it('the picker puts names that start with the text first, then word starts, then the rest', () => {
    expect(investorOptions(I, 'ra').map((r) => r.name)).toEqual(['Kai Rao'])
    expect(investorOptions(I, 'c').map((r) => r.name)).toEqual(['Cove Labs', 'Harbor Credit'])
    expect(investorOptions(I, '').length).toBe(5)
  })
  it('People counts how many in view raised from each investor', () => {
    expect([...investorPeopleCounts(P, {})]).toEqual([['arbor', 2], ['kai', 1]])
    expect([...investorPeopleCounts(P, { country: 'IN' })]).toEqual([['arbor', 1]])
  })
  it('timing: after they left, before they joined, during, or unknown', () => {
    expect(backingTiming(2022, '2018-09', '2021-03')).toBe('after')
    expect(backingTiming(2015, '2018-09', 'now')).toBe('before')
    expect(backingTiming(2019, '2018-09', 'now')).toBe('during')
    expect(backingTiming(undefined, '2018-09', 'now')).toBe('unknown')
  })
  it('the list row keeps company names; CSV rows hold the columns in header order', () => {
    const row = investorListRow({ _id: 'x', key: 'arbor', name: 'Arbor', kind: 'vc', companyCount: 1, founderCount: 1, webCount: 1, companies: [{ key: 'id:1', name: 'Inkwell', status: 'funded', source: 'web', founders: [] }] })
    expect(row.companyNames).toEqual(['Inkwell'])
    expect(investorCsvRows([I[0]])[0]).toEqual(['Arbor', 'VC fund', 'Tier 1', 'US firm, India office', 'yes', '4', '3', '1', 'Inkwell; Fold; Quay'])
  })
})

describe('the URL', () => {
  it('keeps known values and drops the rest', () => {
    expect(validateRolodexSearch({ view: 'investors', who: 'investors', country: 'IN', tier: 'Tier 1', group: 'angels', web: 'true', sort: 'nope', country2: 'x' })).toMatchObject({
      view: 'investors', who: 'investors', country: 'IN', tier: 'Tier 1', group: 'angels', web: true, sort: undefined,
    })
    expect(validateRolodexSearch({ inv: 'accel' }).inv).toEqual(['accel'])
    expect(validateRolodexSearch({ iloc: 'us-india', isort: 'tier' })).toMatchObject({ iloc: 'us-india', isort: 'tier' })
    expect(validateRolodexSearch({ pick: ['accel', 'accel', 3, ''] }).pick).toEqual(['accel'])
    expect(validateRolodexSearch({ pick: [] }).pick).toBeUndefined()
    expect(validateRolodexSearch({ country: 'india', who: 'all' })).toMatchObject({ country: undefined, who: undefined })
    // Old links to the Firms view land on Investors.
    expect(validateRolodexSearch({ view: 'firms' }).view).toBe('investors')
  })
})
