import { describe, expect, it } from 'vitest'
import {
  batchOf, batchText, companyList, countryOptions, firmOptionCounts, flag, inKind, kindCounts, locOf, matchesFirm, matchesPeople, optionCounts, peopleCsvRows, roleText,
  sortFirms, sortPeople, validateRolodexSearch, whoCounts, whyText, type RolodexFirm, type RolodexPerson,
} from './rolodex'

// Every name, firm and company here is made up.
const person = (o: Partial<RolodexPerson> & { name: string }): RolodexPerson => ({ _id: o.name, crustdataId: 1, role: 'founder', currentRole: 'employee', shortlist: true, fundingCheck: 'funded_company', ...o })
const P = [
  person({ name: 'Asha', role: 'vc', roleStatus: 'current', vc: 'current', fundingCheck: 'investor', countryCode: 'IN', country: 'India', bestFirmTier: 'Tier 1', gradYear: 2012, campus: 'Pilani', firmKeys: ['id:1'] }),
  person({ name: 'Bo', role: 'vc', roleStatus: 'past', vc: 'past', founder: 'current', fundingCheck: 'investor', countryCode: 'US', country: 'United States', bestFirmTier: 'Tier 2', gradYear: 2004, campus: 'Goa' }),
  person({ name: 'Cyra', roleStatus: 'current', founder: 'current', countryCode: 'IN', country: 'India', gradYear: 2019, campus: 'Hyderabad', fundedCompanies: 'Inkwell (funded); Fold (acquired)' }),
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
  it('country, tier, campus, batch, firm and search combine', () => {
    expect(P.filter((p) => matchesPeople(p, { country: 'IN' })).map((p) => p.name)).toEqual(['Asha', 'Cyra'])
    expect(P.filter((p) => matchesPeople(p, { tier: 'Tier 1' })).map((p) => p.name)).toEqual(['Asha'])
    expect(P.filter((p) => matchesPeople(p, { campus: 'Goa' })).map((p) => p.name)).toEqual(['Bo'])
    expect(P.filter((p) => matchesPeople(p, { batch: 'earlier' })).map((p) => p.name)).toEqual(['Dev'])
    expect(P.filter((p) => matchesPeople(p, { firm: 'id:1' })).map((p) => p.name)).toEqual(['Asha'])
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

const firm = (o: Partial<RolodexFirm> & { name: string }): RolodexFirm => ({ _id: o.name, key: o.name, type: 'VC fund', geo: 'India', hqCountryCode: 'IN', indiaPresence: 'yes', people: 1, vcPeople: 1, angelPeople: 0, peopleThereNow: 0, personIds: [], ...o })
const F = [
  firm({ name: 'Arbor', tier: 'Tier 1', geo: 'US firm, India office', hqCountryCode: 'US', people: 5, peopleThereNow: 2 }),
  firm({ name: 'Brook', type: 'Micro VC', tier: 'Tier 3', people: 2 }),
  firm({ name: 'Cove', type: 'Accelerator / incubator', tier: 'Tier 2', geo: 'Singapore firm, India office', hqCountryCode: 'SG', people: 9 }),
  firm({ name: 'Dell Bank', type: 'Asset manager / bank', geo: 'US', hqCountryCode: 'US', indiaPresence: 'no' }),
  firm({ name: 'Elm', type: 'Unknown', geo: 'Unknown', hqCountryCode: undefined, indiaPresence: 'unknown' }),
  firm({ name: 'Fir', type: 'Angel network', geo: 'United Kingdom', hqCountryCode: 'GB', indiaPresence: 'no' }),
]

describe('firms', () => {
  it('kinds: investors by default; unknown apart; Everything is both', () => {
    expect(kindCounts(F, {})).toMatchObject({ investors: 4, vc: 1, micro: 1, acc: 1, angels: 1, unknown: 1, all: 6 })
    expect(inKind(F[3], 'investors')).toBe(false)
  })
  it('location: India, US, US with an India office, others with one, elsewhere, unknown', () => {
    expect(F.map(locOf)).toEqual(['us-india', 'india', 'other-india', 'us', 'unknown', 'elsewhere'])
    expect(F.filter((f) => matchesFirm(f, { india: true })).map((f) => f.name)).toEqual(['Arbor', 'Brook', 'Cove'])
    expect([...firmOptionCounts(F, {}, 'tier', ['Tier 1', 'Tier 2', 'Tier 3'] as const)]).toEqual([['Tier 1', 1], ['Tier 2', 1], ['Tier 3', 1]])
  })
  it('sorts by our people (default), people there now, tier', () => {
    expect(sortFirms(F.slice(0, 3)).map((f) => f.name)).toEqual(['Cove', 'Arbor', 'Brook'])
    expect(sortFirms(F.slice(0, 3), 'now').map((f) => f.name)).toEqual(['Arbor', 'Cove', 'Brook'])
    expect(sortFirms(F.slice(0, 3), 'tier').map((f) => f.name)).toEqual(['Arbor', 'Cove', 'Brook'])
  })
})

describe('the URL', () => {
  it('keeps known values and drops the rest', () => {
    expect(validateRolodexSearch({ view: 'firms', who: 'investors', country: 'IN', tier: 'Tier 1', loc: 'us-india', india: 'true', sort: 'nope', country2: 'x' })).toMatchObject({
      view: 'firms', who: 'investors', country: 'IN', tier: 'Tier 1', loc: 'us-india', india: true, sort: undefined,
    })
    expect(validateRolodexSearch({ country: 'india', who: 'all' })).toMatchObject({ country: undefined, who: undefined })
  })
})
