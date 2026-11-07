// PST-279: the morning brief from fixture rows. Every name is made up.
import { describe, expect, it } from 'vitest'
import { briefLine, briefStats, moveReason, sinceYesterday, type SinceInput } from './brief'

const NOW = Date.parse('2026-11-08T08:00:00+05:30')
const H = 36e5

function fixture(): SinceInput {
  return {
    now: NOW,
    investors: [
      { _id: 'kite', name: 'Kite Angels' },
      { _id: 'antler', name: 'Antler India' },
      { _id: 'orchard', name: 'Orchard Capital' },
      { _id: 'lantern', name: 'Lantern Ventures' },
    ],
    threads: [
      { investorIds: ['kite'], lastAt: NOW - 3 * H, lastFrom: 'them' },
      { investorIds: ['kite'], lastAt: NOW - 5 * H, lastFrom: 'them' },
      { investorIds: ['antler'], lastAt: NOW - 20 * H, lastFrom: 'them' },
      // Dev wrote last: not waiting on him.
      { investorIds: ['lantern'], lastAt: NOW - 2 * H, lastFrom: 'us' },
      // Before yesterday.
      { investorIds: ['orchard'], lastAt: NOW - 30 * H, lastFrom: 'them' },
      // Nobody on the list.
      { investorIds: [], lastAt: NOW - H, lastFrom: 'them' },
    ],
    materials: [{ _id: 'deck', kind: 'deck', title: 'Pitch deck', currentVersionId: 'v4' }],
    versions: [{ _id: 'v4', n: 4 }],
    links: [
      { _id: 'l-orchard', investorId: 'orchard', materialId: 'deck' },
      { _id: 'l-lantern', investorId: 'lantern', materialId: 'deck' },
    ],
    views: [
      { linkId: 'l-orchard', versionId: 'v4', startedAt: NOW - 2 * H, pages: [{ page: 1, ms: 30e3 }, { page: 6, ms: 150e3 }] },
      { linkId: 'l-orchard', versionId: 'v4', startedAt: NOW - H, pages: [{ page: 6, ms: 60e3 }] },
      { linkId: 'l-lantern', versionId: 'v4', startedAt: NOW - 40 * H, pages: [{ page: 1, ms: 9e3 }] },
    ],
    meetings: [
      { _id: 'm1', eventId: 'e1', title: 'Pesto × Kite Angels', start: NOW - 22 * H, end: NOW - 21 * H, investorIds: ['kite'] },
      // The same event on a teammate's calendar.
      { _id: 'm1b', eventId: 'e1', title: 'Pesto × Kite Angels', start: NOW - 22 * H, end: NOW - 21 * H, investorIds: ['kite'] },
      // Later today: not done yet.
      { _id: 'm2', eventId: 'e2', title: 'Lantern first call', start: NOW + 2 * H, end: NOW + 3 * H, investorIds: ['lantern'] },
      { _id: 'm3', eventId: 'e3', title: 'Coffee', start: NOW - 5 * H, end: NOW - 4 * H, investorIds: [] },
    ],
    notes: [{ investorId: 'kite', meetingId: 'm1', date: '2026-11-07', read: true }],
    suggestions: [...Array(4)].map(() => ({ safe: true })).concat([...Array(3)].map(() => ({ safe: false }))),
  }
}

describe('sinceYesterday', () => {
  it('counts replies waiting on Dev, opens, meetings done and open suggestions, with names', () => {
    const s = sinceYesterday(fixture())
    expect(s.replies.map((r) => r.name)).toEqual(['Kite Angels', 'Antler India'])
    expect(s.opens).toEqual([{ investorId: 'orchard', name: 'Orchard Capital', material: 'Pitch deck v4', kind: 'deck', ms: 240e3, page: 6 }])
    expect(s.meetings).toEqual([{ investorId: 'kite', name: 'Kite Angels', title: 'Pesto × Kite Angels', notes: 'read' }])
    expect(s.suggestions).toEqual({ open: 7, safe: 4 })
  })

  it('reads as the design does', () => {
    const s = sinceYesterday(fixture())
    expect(briefStats(s).map((x) => [x.n, x.label, x.sub])).toEqual([
      [2, 'replies', 'Kite Angels, Antler India'],
      [1, 'deck opened', 'Orchard Capital · 4 min · p6'],
      [1, 'meeting done', 'Kite Angels · notes read'],
      [7, 'suggestions', '4 safe to accept'],
    ])
    expect(briefLine(s)).toBe('2 replies · 1 deck opened · 1 meeting done · 7 suggestions')
  })

  it('reads a quiet night too', () => {
    const quiet = sinceYesterday({ ...fixture(), threads: [], views: [], meetings: [], suggestions: [] })
    expect(briefStats(quiet).map((x) => x.sub)).toEqual(['Nobody’s waiting on you', 'Nothing opened', 'No meetings', 'All tidy'])
    expect(briefLine(quiet)).toBe('0 replies · 0 decks opened · 0 meetings done · 0 suggestions')
  })

  it('says when notes from a meeting are saved but not read yet, or missing', () => {
    const x = fixture()
    expect(sinceYesterday({ ...x, notes: [{ investorId: 'kite', date: '2026-11-07', read: false }] }).meetings[0].notes).toBe('unread')
    expect(sinceYesterday({ ...x, notes: [] }).meetings[0].notes).toBe('none')
  })

  it('a move keeps Today’s why when Claude gave no reason', () => {
    expect(moveReason({ key: 'a', title: 'Send Orchard the data room', why: 'Opened the deck.' })).toBe('Opened the deck.')
    expect(moveReason({ key: 'a', title: 'Send Orchard the data room', why: 'Opened the deck.', reason: 'They read Traction twice.' })).toBe('They read Traction twice.')
  })
})
