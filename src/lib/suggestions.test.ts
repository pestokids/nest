import { describe, expect, it } from 'vitest'
import {
  acceptsTogether, actionOf, filterChips, firstTidyToday, normFirm, proposedDate, reconcile, ruleSuggestions, safeLine, sortSuggestions, thingsToFix, type Suggestion,
} from './suggestions'

const row = (o: Partial<Suggestion> & Pick<Suggestion, 'kind'>): Suggestion => ({
  _id: o.kind, title: 't', fix: 'f', patch: { op: 'review' }, source: 'rule', safe: false, key: 'k-' + o.kind, status: 'open', createdAt: 0, ...o,
})

describe('suggestions (PST-275)', () => {
  it('normalises firm names: case, punctuation and the usual firm words', () => {
    expect(normFirm('Better Capital')).toBe('better')
    expect(normFirm('Better Cap.')).toBe('better')
    expect(normFirm('  Northwind Ventures, LLC ')).toBe('northwind')
    expect(normFirm('Kite VC Partners Fund LLP')).toBe('kite')
    expect(normFirm('Café Angels')).toBe('cafe angels')
    // A name made only of firm words keeps them, rather than matching every other such name.
    expect(normFirm('Capital Partners')).toBe('capital partners')
  })

  it('counts filter chips by kind, with agents on their own', () => {
    const list = [row({ kind: 'stage' }), row({ kind: 'stage', _id: 's2' }), row({ kind: 'duplicate' }), row({ kind: 'touch', source: 'agent', agentName: 'Grok Bot' })]
    expect(filterChips(list)).toEqual([
      { k: 'all', label: 'All', n: 4 },
      { k: 'stage', label: 'Stage', n: 2 },
      { k: 'duplicate', label: 'Duplicates', n: 1 },
      { k: 'agents', label: 'From agents', n: 1 },
    ])
  })

  it('only plain safe accepts go in "Accept N safe ones"', () => {
    expect(acceptsTogether(row({ kind: 'stage', safe: true, patch: { op: 'stage', from: 'booked', to: 'm1' } }))).toBe(true)
    expect(acceptsTogether(row({ kind: 'duplicate', safe: true, patch: { op: 'merge' } }))).toBe(false)
    expect(acceptsTogether(row({ kind: 'expected', safe: true, patch: { op: 'review' } }))).toBe(false)
    expect(acceptsTogether(row({ kind: 'enrichment', safe: true, patch: { op: 'expected', amount: 1 } }))).toBe(false)
    expect(acceptsTogether(row({ kind: 'touch', safe: true, source: 'agent', patch: { op: 'touch', touch: 'call', note: 'x' } }))).toBe(false)
    expect(actionOf(row({ kind: 'duplicate', patch: { op: 'merge' } }))).toBe('merge')
  })

  it('sorts by kind as in the design, then oldest first', () => {
    const list = [row({ kind: 'touch', _id: 'a' }), row({ kind: 'stage', _id: 'b', createdAt: 2 }), row({ kind: 'stage', _id: 'c', createdAt: 1 }), row({ kind: 'expected', _id: 'd' })]
    expect(sortSuggestions(list).map((s) => s._id)).toEqual(['c', 'b', 'd', 'a'])
  })

  it('writes the card copy', () => {
    expect(thingsToFix(1)).toBe('1 thing to fix')
    expect(thingsToFix(7)).toBe('7 things to fix')
    expect(safeLine(0)).toBe('Nothing changes until you accept.')
    expect(safeLine(4)).toBe('Nothing changes until you accept. 4 are safe to accept together.')
  })

  it('proposes a next-step date five days out, never on a weekend', () => {
    expect(proposedDate('2026-11-07')).toBe('2026-11-12') // Sat → Thu
    expect(proposedDate('2026-11-09')).toBe('2026-11-16') // Mon → Sat → Mon
    expect(proposedDate('2026-11-10')).toBe('2026-11-16') // Tue → Sun → Mon
  })

  it('reconciles a run: adds new keys only, refreshes open wording, withdraws open check rows that stopped firing', () => {
    const drafts = ruleSuggestions({
      investors: [{ _id: 'i1', name: 'Lark', firm: 'Lark', stage: 'intro', maxStage: 'intro', nextStep: '', email: 'a@lark.example.com' }],
      acts: [], meetings: [], threads: [], today: '2026-11-07', now: Date.parse('2026-11-07T10:00:00Z'),
    })
    expect(drafts.map((d) => d.key)).toEqual(['check:next_step:i1:intro'])
    const stored = (o: Partial<Suggestion>) => ({ ...drafts[0], _id: 'x', status: 'open' as const, createdAt: 0, ...o })
    expect(reconcile([], drafts)).toEqual({ add: drafts, update: [], withdraw: [] })
    expect(reconcile([stored({ status: 'dismissed' })], drafts)).toEqual({ add: [], update: [], withdraw: [] })
    expect(reconcile([stored({ title: 'old words' })], drafts).update).toEqual([{ id: 'x', draft: drafts[0] }])
    expect(reconcile([stored({ key: 'check:gone' }), stored({ _id: 'agent', key: 'agent:1' })], drafts)).toEqual({ add: drafts, update: [], withdraw: ['x'] })
  })

  it('confetti for a tidy list at most once a day', () => {
    const m = new Map<string, string>()
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    expect(firstTidyToday('2026-11-07', store)).toBe(true)
    expect(firstTidyToday('2026-11-07', store)).toBe(false)
    expect(firstTidyToday('2026-11-08', store)).toBe(true)
    expect(firstTidyToday('2026-11-08', null)).toBe(false)
  })
})
