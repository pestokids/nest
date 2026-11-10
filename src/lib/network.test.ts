// PST-305: Network's pure rules: relations, the view's filters and rows, the
// Add person labels, the CSV import of people, a founder's lookup results, new
// investors from the Network, Wants to invest, and the intro ask. Every name,
// company, address and link is made up.
import { describe, expect, it } from 'vitest'
import { allPeople, committedPeople, relationFromHint, relationOf, rolesOf, type Intro, type Introducer } from './introducers'
import {
  alsoLine, angelFields, askable, askBlanks, askPicks, cleanDomain, composeAsk, filterCounts, inFilter, lookupResults, markInNest, matchInvestor, networkRows, parseRelation,
  personFieldCopy, personPatch, previewPeople, roleChips, sameInvestor, targetFields, WHY_SLOT, type LookupRaw,
} from './network'
import type { Investor } from './pipeline'

const inv = (id: string, name: string, o: Partial<Investor> = {}): Investor =>
  ({ _id: id, name, firm: name, type: 'Seed fund', geo: 'India', warmth: 'intro', path: '', tier: 'B', wave: 1, stage: 'todo', maxStage: 'todo', lead: false, nextStep: '', notes: '', source: '', ...o }) as Investor

describe('relations', () => {
  it('reads an old portfolio founder as a founder', () => {
    expect(relationOf('portfolio')).toBe('founder')
    expect(relationOf('advisor')).toBe('advisor')
    expect(relationFromHint('portfolio founder')).toBe('founder')
    expect(relationFromHint('my mentor')).toBe('advisor')
  })
  it('parses a CSV relation, never as Committed', () => {
    expect(['Founder', 'founders', 'Portfolio founder', 'Advisor', 'mentor', 'Angel', 'college friend', 'Committed', ''].map(parseRelation)).toEqual(['founder', 'founder', 'founder', 'advisor', 'advisor', 'angel', 'friend', 'other', 'other'])
  })
  it('shows the roles that matter on a row', () => {
    expect(roleChips({ canIntro: true, wantsToInvest: true, givesAdvice: true })).toEqual(['Can intro', 'Wants to invest', 'Gives advice'])
    expect(roleChips({ canIntro: false, wantsToInvest: false, givesAdvice: false })).toEqual([])
  })
  it('defaults the roles: everyone can intro, advisors give advice', () => {
    expect(rolesOf({ relation: 'advisor' })).toEqual({ canIntro: true, wantsToInvest: false, givesAdvice: true })
    expect(rolesOf({ relation: 'friend', roles: { canIntro: false } })).toEqual({ canIntro: false, wantsToInvest: false, givesAdvice: false })
  })
})

describe('the Network view', () => {
  const people: Introducer[] = [
    { _id: 'p1', name: 'Ankur Mehta', relation: 'founder', notes: '', company: 'Tinkerly' },
    { _id: 'p2', name: 'Ria Kapoor', relation: 'friend', notes: 'Ex-colleague' },
    { _id: 'p3', name: 'Neha Rao', relation: 'advisor', notes: '', investorId: 'n', roles: { wantsToInvest: true } },
  ]
  const investors = [inv('l', 'Lantern Ventures'), inv('k', 'Kite Angels', { stage: 'm1', maxStage: 'm1' }), inv('n', 'Neha Rao', { type: 'Angel', stage: 'signed', maxStage: 'signed', committed: 10_000 }), inv('s', 'Sable Fund', { stage: 'signed', maxStage: 'signed', committed: 25_000 })]
  const intros: Intro[] = [
    { _id: 'a', investorId: 'l', introducerId: 'p1', steps: {} },
    { _id: 'b', investorId: 'k', introducerId: 'p1', steps: { asked: '2026-11-01', yes: '2026-11-02', sent: '2026-11-02', made: '2026-11-03' } },
  ]
  const rows = networkRows({ introducers: people, intros, investors }, '2026-11-08')

  it('counts a person who also invests once, and still lists other committed investors', () => {
    expect(rows.map((r) => r.name).sort()).toEqual(['Ankur Mehta', 'Neha Rao', 'Ria Kapoor', 'Sable Fund'])
    expect(committedPeople(investors, new Set(['n'])).map((p) => p.name)).toEqual(['Sable Fund'])
    expect(allPeople(people, investors).filter((p) => p.investorId === 'n')).toHaveLength(1)
  })
  it('has each row’s roles, how many they can intro, how many are to ask, and their stage when they invest', () => {
    const ankur = rows.find((r) => r.name === 'Ankur Mehta')!
    expect(ankur).toMatchObject({ canIntroTo: 2, toAsk: 1, roles: { canIntro: true } })
    expect(ankur.stats.made).toBe(1)
    expect(rows.find((r) => r.name === 'Neha Rao')).toMatchObject({ stage: 'signed', roles: { wantsToInvest: true, givesAdvice: true } })
    expect(rows[0].name).toBe('Ankur Mehta')
  })
  it('filters: founders, friends, advisors, angels, and investors who intro', () => {
    expect(filterCounts(rows)).toEqual({ all: 4, founder: 1, friend: 1, advisor: 1, angel: 0, investors: 2 })
    expect(rows.filter((r) => inFilter(r, 'investors')).map((r) => r.name).sort()).toEqual(['Neha Rao', 'Sable Fund'])
  })
  it('says who they are on the investor’s drawer', () => {
    expect(alsoLine(people[2])).toBe('Also your advisor · Neha Rao')
    expect(alsoLine({ name: 'Mira Shah', relation: 'angel' })).toBe('Also in your network · Mira Shah')
  })
})

describe('Add person', () => {
  it('labels the fields by relation', () => {
    expect(personFieldCopy('founder')).toMatchObject({ name: { label: 'Name' }, company: { label: 'Company' }, website: { label: 'Company website' } })
    expect(personFieldCopy('friend').notes?.label).toBe('How you know them')
    expect(personFieldCopy('advisor').notes?.label).toBe('What they advise on')
    expect(personFieldCopy('angel').company?.label).toBe('Title or company')
    expect(personFieldCopy('friend').company).toBeUndefined()
  })
  it('saves only the touched fields, tidied', () => {
    const form = { name: ' Ankur  Mehta ', email: 'ANKUR@Tinkerly.example', relation: 'founder' as const, notes: 'x', company: ' Tinkerly ', companyDomain: 'https://www.Tinkerly.example/about' }
    expect(personPatch(form, ['name', 'companyDomain'])).toEqual({ name: 'Ankur Mehta', companyDomain: 'tinkerly.example' })
    expect(personPatch({ ...form, relation: 'friend' }, ['company'])).toEqual({})
    expect(cleanDomain('gmail.com')).toBe('')
  })
})

describe('the CSV import of people', () => {
  const existing = [{ name: 'Ankur Mehta', email: 'ankur@tinkerly.example' }]
  it('previews who’s added and why others are skipped', () => {
    const p = previewPeople(
      ['Full name,Email,Relationship,Company,Notes,Twitter', 'Asha Linden,asha@brightloop.example,Founder,Brightloop,Backed by Orchard,@x', 'A. Mehta,ANKUR@tinkerly.example,Founder,,', 'ankur mehta,,friend,,', 'Asha Linden,,Friend,,', 'Jo Bell,jo-at-bell,Angel,,', ',,,,', 'Ravi Moss,,,,College friend'].join('\n'),
      existing,
    )
    expect(p.add.map((a) => a.fields)).toEqual([
      { name: 'Asha Linden', email: 'asha@brightloop.example', relation: 'founder', company: 'Brightloop', notes: 'Backed by Orchard' },
      { name: 'Ravi Moss', relation: 'other', notes: 'College friend' },
    ])
    expect(p.skipped.map((s) => [s.line, s.reason])).toEqual([[3, 'Already in your Network'], [4, 'Already in your Network'], [5, 'Twice in this file'], [6, 'That email doesn’t look right']])
    expect(p.unknownHeaders).toEqual(['Twitter'])
  })
  it('needs a name column', () => {
    expect(previewPeople('email\nx@y.example', existing).error).toMatch(/name/)
  })
})

describe('a founder’s lookup', () => {
  const raw: LookupRaw[] = [
    { firm: ' Brightpath  Ventures ', partner: 'Tara Quinn', round: 'pre-seed', year: '2024', domain: 'https://www.brightpath.example.com/', url: 'https://brightpath.example.com/p' },
    { firm: 'Brightpath Ventures', partner: null, round: null, year: null, domain: null, url: 'https://deals.example.com/bp' },
    { firm: 'No Source', partner: null, round: null, year: 2025, domain: null, url: null },
    { firm: 'Bad Year', partner: null, round: null, year: 1801, domain: null, url: 'https://x.example.com' },
  ]
  it('keeps a firm and a source link each, repeats dropped, numbers checked', () => {
    expect(lookupResults(raw)).toEqual([
      { firm: 'Brightpath Ventures', partner: 'Tara Quinn', round: 'pre-seed', year: 2024, domain: 'brightpath.example.com', url: 'https://brightpath.example.com/p' },
      { firm: 'Bad Year', url: 'https://x.example.com' },
    ])
  })
  it('marks the ones already in Nest, by domain or by name', () => {
    const list = [inv('o', 'Orchard Capital', { domains: ['orchard.example.com'] }), inv('k', 'Kite Angels')]
    const marked = markInNest([{ firm: 'Orchard Partners', url: 'https://a.example', domain: 'orchard.example.com' }, { firm: 'kite angels', url: 'https://b.example' }, { firm: 'New Fund', url: 'https://c.example', investorId: 'stale' }], list)
    expect(marked.map((r) => r.investorId ?? null)).toEqual(['o', 'k', null])
    expect(matchInvestor({ firm: 'Orchard Capital' }, list)?._id).toBe('o')
  })
  it('adds a new firm as Not contacted, source Network, via the person', () => {
    expect(targetFields({ firm: 'Brightpath Ventures', partner: 'Tara Quinn', domain: 'brightpath.example.com', round: 'seed', year: 2025, url: 'https://brightpath.example.com/p' }, 'Ankur Mehta')).toMatchObject({
      name: 'Tara Quinn', firm: 'Brightpath Ventures', stage: 'todo', source: 'Network', path: 'via Ankur Mehta', domains: ['brightpath.example.com'],
      notes: 'Backed Ankur’s company at seed in 2025.\nSource: https://brightpath.example.com/p',
    })
  })
})

describe('Wants to invest', () => {
  it('finds them in Nest by email, then by name', () => {
    const list = [inv('a', 'Neha R.', { email: 'neha@rao.example' }), inv('b', 'Neha Rao')]
    expect(sameInvestor({ name: 'Neha Rao', email: 'NEHA@rao.example' }, list)?._id).toBe('a')
    expect(sameInvestor({ name: 'neha  rao' }, list)?._id).toBe('b')
    expect(sameInvestor({ name: 'Someone' }, list)).toBeUndefined()
  })
  it('makes an Angel at Asked, source Network', () => {
    expect(angelFields({ name: 'Neha Rao', email: 'neha@rao.example', relation: 'advisor' })).toMatchObject({ name: 'Neha Rao', type: 'Angel', stage: 'ask', source: 'Network', email: 'neha@rao.example', notes: 'Also your advisor.' })
  })
})

describe('the intro ask', () => {
  it('asks only about investors still open, the three highest by Priority first', () => {
    expect(askable({ steps: {} }, inv('x', 'X'))).toBe(true)
    expect(askable({ steps: { asked: '2026-11-01' } }, inv('x', 'X'))).toBe(false)
    expect(askable({ steps: {} }, inv('x', 'X', { stage: 'passed' }))).toBe(false)
    expect(askable({ steps: {} }, inv('x', 'X', { stage: 'signed' }))).toBe(false)
    const xs = ['a', 'b', 'c', 'd'].map((k) => ({ _id: 'i' + k, investorId: k }))
    const prio: Record<string, number> = { a: 40, b: 90, c: 60, d: 75 }
    expect(askPicks(xs, (id) => id, (id) => prio[id])).toEqual(['ib', 'id', 'ic'])
  })
  it('keeps Nest’s order and names, blanks unknown numbers, and leaves [why they fit] when there’s no reason', () => {
    const r = composeAsk(
      { subject: 'Up 40%: a few intros?', opening: 'Hi Ankur,\n\nPesto grew 40% last month.', fits: [{ name: 'kite angels', why: 'They wrote 12 kids checks.' }, { name: 'Made Up Fund', why: 'Nope.' }], note: 'Pesto has [__] families.' },
      { who: 'Ankur Mehta', me: 'Dev', picked: ['Orchard Capital', 'Kite Angels'], known: 'Orchard Capital Kite Angels' },
    )
    expect(r.subject).toBe('Up [__]%: a few intros?')
    expect(r.body).toContain('Pesto grew [__]% last month.')
    expect(r.body).toContain('- Orchard Capital: ' + WHY_SLOT + '\n- Kite Angels: They wrote [__] kids checks.')
    expect(r.body).not.toContain('Made Up Fund')
    expect(r.body).toContain('here’s a short note about Pesto you can forward as it is:\n\nPesto has [__] families.')
    expect(r.body.endsWith('Thanks,\nDev')).toBe(true)
    expect(askBlanks(r.body)).toBe(4)
  })
  it('starts one by hand when there’s no answer (AI isn’t set up)', () => {
    const r = composeAsk({}, { who: 'Ria Kapoor', me: 'Dev', picked: ['Lantern Ventures'], known: '' })
    expect(r.subject).toBe('A few intros?')
    expect(r.body).toContain('Hi Ria,')
    expect(r.body).toContain('- Lantern Ventures: ' + WHY_SLOT)
  })
})
