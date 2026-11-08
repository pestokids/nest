import { describe, expect, it } from 'vitest'
import { inboxPreview, type InboxSources } from './inbox'
import type { SyncedThread } from './google'
import { NEW_INVESTOR, type Investor } from './pipeline'

// Made-up investors only.
let n = 0
const inv = (o: Partial<Investor>): Investor => ({ ...NEW_INVESTOR, _id: `i${n++}`, maxStage: 'todo', ...o }) as Investor
const TODAY = '2030-01-10'
const NOW = Date.parse('2030-01-10T12:00:00+05:30')
const H = 36e5

const thread = (o: Partial<SyncedThread>): SyncedThread => ({
  _id: 't' + n++, threadId: 'x', subject: 'Re: deck', lastAt: NOW - 50 * H, lastFrom: 'them', lastFromEmail: 'a@fund.example.com',
  participants: [], investorIds: [], link: 'https://mail.example.com', count: 2, by: 'Dev', mine: true, ...o,
})

const src = (o: Partial<InboxSources>): InboxSources => ({ investors: [], threads: [], suggestions: [], quietDays: 7, today: TODAY, now: NOW, ...o })

describe('Home inbox preview (PST-289)', () => {
  const late = inv({ name: 'Fernhill Fund', stage: 'm1', nextStep: 'Send the model', nextDate: '2030-01-09', lastTouch: '2030-01-08' })
  const due = inv({ name: 'Juniper Seed', stage: 'booked', nextStep: 'Send the deck by 18:00', nextDate: TODAY, lastTouch: '2030-01-09' })
  const quiet = inv({ name: 'Harbor Light', stage: 'm2', lastTouch: '2030-01-01' })
  const never = inv({ name: 'Kite Angels', stage: 'intro' })
  const wrote = inv({ name: 'Saltmarsh Angels', stage: 'm1', lastTouch: '2030-01-09' })
  const parked = inv({ name: 'Lantern', stage: 'parked', parkedUntil: TODAY })
  const quietAndDue = inv({ name: 'Orchard', stage: 'm1', nextStep: 'Call', nextDate: TODAY, lastTouch: '2029-12-20' })

  it('takes Today’s lists in order: replies, due, quiet, then suggestions', () => {
    const r = inboxPreview(
      src({
        investors: [late, due, quiet, never, wrote, parked],
        threads: [thread({ investorIds: [wrote._id] })],
        suggestions: [{ _id: 's1', investorId: due._id, title: 'Juniper Seed and Juniper look like the same firm' }],
      }),
      10,
    )
    expect(r.rows.map((x) => [x.kind, x.name, x.detail])).toEqual([
      ['reply', 'Saltmarsh Angels', 'wrote 2d ago'],
      ['due', 'Fernhill Fund', '1 day over'],
      ['due', 'Juniper Seed', 'Send the deck by 18:00'],
      ['due', 'Lantern', 'back from parked'],
      ['quiet', 'Kite Angels', 'never touched'],
      ['quiet', 'Harbor Light', '9 days quiet'],
      ['review', 'Juniper Seed', 'Juniper Seed and Juniper look like the same firm'],
    ])
    expect(r.total).toBe(7)
  })

  it('shows the first 4 and counts them all', () => {
    const r = inboxPreview(src({ investors: [late, due, quiet, never, parked] }))
    expect(r.rows).toHaveLength(4)
    expect(r.total).toBe(5)
  })

  it('lists an investor once, on their first row', () => {
    const r = inboxPreview(src({ investors: [quietAndDue], threads: [thread({ investorIds: [quietAndDue._id] })] }))
    expect(r.rows.map((x) => x.kind)).toEqual(['reply'])
  })

  it('leaves out replies that aren’t owed yet or match nobody', () => {
    const r = inboxPreview(src({ investors: [wrote], threads: [thread({ investorIds: [wrote._id], lastAt: NOW - 10 * H }), thread({ investorIds: ['gone'] }), thread({ investorIds: [wrote._id], lastFrom: 'us' })] }))
    expect(r.rows).toEqual([])
  })

  it('names a suggestion with no investor as a suggested fix', () => {
    const r = inboxPreview(src({ suggestions: [{ _id: 's2', title: 'Two cards share a domain' }] }))
    expect(r.rows[0]).toMatchObject({ kind: 'review', name: 'Suggested fix', investorId: undefined })
  })

  it('is empty when nothing is waiting', () => expect(inboxPreview(src({}))).toEqual({ total: 0, rows: [] }))
})
