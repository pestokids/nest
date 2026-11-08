// PST-296: Find more's pure parts: dedupe against investors already in Nest, the
// 30 cap and the 12-month rule, the cost shown before a run, the reason chips, the
// fallback score without Jev, and warm paths from Gmail and Calendar. Every
// investor, company and address here is made up.
import { describe, expect, it } from 'vitest'
import { candidateFacts, cleanCompanies, dedupe, fallbackScore, findChips, findEstimate, findKey, isActive, MAX_CANDIDATES, MAX_SEARCHES, pickCandidates, warmPathFrom, warmPathOf, type Found } from './findMore'
import { fit } from './enrich'
import { HAIKU, PRICES, SONNET } from './models'
import { priority } from './priority'

const TODAY = '2026-11-08'
const found = (name: string, o: Partial<Found> = {}): Found => ({ name, firm: name, backed: [{ company: 'Puddlejump', round: 'Pre-seed', date: '2026-06' }], sources: [{ url: 'https://deals.example.com/' + name.length }], ...o })

describe('dedupe', () => {
  const existing = [
    { name: 'Orchard Capital', firm: 'Orchard Capital', domains: ['orchard.example.com'] },
    { name: 'Sam Okoye', firm: 'Kite Angels', email: 'sam@kite.example.com' },
    { name: 'Tidewater Angels', firm: '', email: 'tide@gmail.com' },
  ]

  it('skips anyone whose firm domain is already in Nest, from domains or an email', () => {
    const r = dedupe([found('Orchard Partners', { domain: 'www.Orchard.example.com' }), found('Kite Syndicate', { domain: 'kite.example.com' }), found('Fresh Fund', { domain: 'fresh.example.com' })], existing)
    expect(r.kept.map((c) => c.name)).toEqual(['Fresh Fund'])
    expect(r.skipped).toBe(2)
  })

  it('skips the same firm or name once normalised (Capital, Ventures, punctuation, case)', () => {
    const r = dedupe([found('Orchard Ventures'), found('kite angels'), found('Sam Okoye', { firm: '' }), found('Orchid Capital')], existing)
    expect(r.kept.map((c) => c.name)).toEqual(['Orchid Capital'])
  })

  it('never matches on personal mail, and drops repeats within the run and anyone already suggested', () => {
    const r = dedupe([found('Gmail Angels', { domain: 'gmail.com' }), found('Twice Fund', { domain: 'twice.example.com' }), found('Twice Fund Again', { domain: 'twice.example.com' }), found('Taken Seed')], existing, [findKey(found('Taken Seed'))])
    expect(r.kept.map((c) => c.name)).toEqual(['Gmail Angels', 'Twice Fund'])
  })

  it('keys a suggestion by the firm’s domain, else its normalised name', () => {
    expect(findKey(found('Brightpath Ventures', { domain: 'https://brightpath.example.com/'.replace('https://', '').replace(/\/$/, '') }))).toBe('find:brightpath.example.com')
    expect(findKey(found('Brightpath Ventures'))).toBe('find:brightpath')
  })
})

describe('the 12-month rule and the cap', () => {
  it('keeps only investors with a deal in the last 12 months (by the newest date it knows)', () => {
    expect(isActive(found('A', { backed: [{ company: 'X', date: '2025-11' }] }), TODAY)).toBe(true)
    expect(isActive(found('B', { backed: [{ company: 'X', date: '2025-10' }] }), TODAY)).toBe(false)
    expect(isActive(found('C', { backed: [{ company: 'X', date: '2024-01' }], lastDeal: '2026-09' }), TODAY)).toBe(true)
    expect(isActive(found('D', { backed: [{ company: 'X' }] }), TODAY)).toBe(false)
    expect(isActive(found('E', { lastDeal: '2027-02' }), TODAY)).toBe(false)
  })

  it('keeps at most 30 a run, most recent deal first, after dropping inactive and existing ones', () => {
    const many = Array.from({ length: 45 }, (_, k) => found('Fund ' + k, { domain: 'f' + k + '.example.com', lastDeal: '2026-' + String((k % 10) + 1).padStart(2, '0') }))
    const stale = found('Stale Fund', { backed: [{ company: 'X', date: '2024-02' }] })
    const r = pickCandidates([...many, stale], [{ name: 'Fund 0', firm: 'Fund 0' }], [], TODAY)
    expect(MAX_CANDIDATES).toBe(30)
    expect(r.candidates).toHaveLength(30)
    expect(r.inactive).toBe(1)
    expect(r.already).toBe(1)
    expect(r.candidates[0].lastDeal).toBe('2026-10')
    expect(r.candidates.some((c) => c.name === 'Fund 0' || c.name === 'Stale Fund')).toBe(false)
  })
})

describe('the cost estimate', () => {
  it('counts Haiku’s tokens, a search per seed at $10 per 1,000, and a Jev call per candidate', () => {
    const e = findEstimate(6, HAIKU)
    expect(e.searches).toBe(6)
    // 7 steps, each reading 3K of instructions and every search before it (4K each).
    expect(e.input).toBe(7 * 3_000 + 4_000 * 21)
    expect(PRICES.webSearch).toBe(0.01)
    expect(e.usd).toBeCloseTo((105_000 * 0.1 + 6_000 * 0.5) / 1e6 + 6 * 0.01 + e.jevUsd, 12)
    expect(e.jevUsd).toBeCloseTo((700 * 30 * 0.042) / 1e6, 12)
    expect(e.usd).toBeLessThan(0.1)
  })

  it('searches at least twice and never past the cap, and costs more on a bigger model', () => {
    expect(findEstimate(0, HAIKU).searches).toBe(2)
    expect(findEstimate(40, HAIKU).searches).toBe(MAX_SEARCHES)
    expect(findEstimate(6, SONNET).usd).toBeGreaterThan(findEstimate(6, HAIKU).usd)
  })
})

describe('how a result reads', () => {
  it('shows what they backed, their thesis in Nest’s words, then how active they are or their checks', () => {
    const c = found('Brightpath Ventures', { thesis: 'Kids and consumer apps', dealsLast12: 6, backed: [{ company: 'Puddlejump', round: 'Pre-seed', date: '2026-03' }] })
    expect(findChips(c)).toEqual([
      { label: 'Backed Puddlejump · pre-seed, Mar 2026', tone: 'backed' },
      { label: 'Kids + consumer', tone: 'why' },
      { label: '6 deals in 12 months', tone: 'why' },
    ])
    const two = found('Cedar Angels', { checkUsd: 100_000, backed: [{ company: 'Puddlejump' }, { company: 'Storyloft' }] })
    expect(findChips(two).map((x) => x.label)).toEqual(['Backed Puddlejump and Storyloft', '$100K checks'])
  })

  it('tidies the companies chips: trimmed, no repeats, at most eight', () => {
    expect(cleanCompanies(['  Puddlejump ', 'puddlejump', '', 'Storyloft'])).toEqual(['Puddlejump', 'Storyloft'])
    expect(cleanCompanies(Array.from({ length: 12 }, (_, k) => 'Co ' + k))).toHaveLength(8)
  })
})

describe('without Jev', () => {
  it('scores a candidate the way Priority always has, as a new Not contacted investor', () => {
    const round = { minCheck: 25_000, target: 1_000_000 }
    const c = found('Brightpath Ventures', { stage: 'Pre-seed and seed', checkUsd: 100_000, check: '$100K', thesis: 'Kids and consumer', geography: 'India' })
    const expected = priority({ stage: 'todo', warmth: 'intro', path: '', expected: 100_000 }, fit(candidateFacts(c), round), null, TODAY).score
    expect(fallbackScore(c, round, TODAY)).toBe(expected)
    expect(fallbackScore({ ...c, warmPath: 'Ria met them in Oct' }, round, TODAY)).toBeGreaterThan(expected)
  })
})

describe('warm paths from Gmail and Calendar', () => {
  const at = (iso: string) => Date.parse(iso + 'T10:00:00+05:30')
  const h = {
    meetings: [{ userId: 'u1', start: at('2026-10-14'), people: [{ email: 'tara@brightpath.example.com', name: 'Tara Quill' }] }],
    threads: [
      { userId: 'u2', lastAt: at('2026-09-02'), participants: ['ops@brightpath.example.com'] },
      { userId: 'u2', lastAt: at('2026-09-20'), participants: ['someone@gmail.com'] },
    ],
    names: { u1: 'Ria', u2: 'Mira' },
  }

  it('names the most recent teammate who met or emailed someone at their domain', () => {
    expect(warmPathFrom('brightpath.example.com', h)).toBe('Ria met Tara in Oct')
    expect(warmPathFrom('brightpath.example.com', { ...h, meetings: [] })).toBe('Mira emailed them in Sept')
  })

  it('says nothing for a domain nobody knows, or for personal mail', () => {
    expect(warmPathFrom('elsewhere.example.com', h)).toBeNull()
    expect(warmPathFrom('gmail.com', h)).toBeNull()
    expect(warmPathFrom(undefined, h)).toBeNull()
  })

  describe('Introducers first', () => {
    const c = { name: 'Brightpath Ventures', firm: 'Brightpath Ventures', domain: 'https://www.brightpath.example.com/team' }
    const person = (name: string, extra: { email?: string; notes?: string }) => ({ _id: name, name, relation: 'friend' as const, notes: '', ...extra })
    const people = (...introducers: ReturnType<typeof person>[]) => ({ introducers, intros: [], investors: [] })

    it('names an introducer whose notes name the firm, or who works at their domain, before Gmail and Calendar', () => {
      expect(warmPathOf(c, people(person('Ankur Vale', { notes: 'Ex-partner at Brightpath Ventures' })), h)).toBe('Ankur knows them')
      expect(warmPathOf(c, people(person('Nina Ross', { email: 'nina@brightpath.example.com' })), h)).toBe('Nina works there')
    })

    it('falls back to Gmail and Calendar when no introducer knows them', () => {
      expect(warmPathOf(c, people(person('Ankur Vale', { notes: 'Knows Pinecone Capital' })), h)).toBe('Ria met Tara in Oct')
      expect(warmPathOf({ ...c, domain: 'elsewhere.example.com' }, people(), h)).toBeNull()
    })
  })
})
