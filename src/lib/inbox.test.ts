// PST-297: the Today Inbox: grouping and ranking, one row per investor per type,
// done and snooze (and a row coming back when its source changes), the
// once-a-day clear confetti and the keys. Made-up investors and addresses only.
import { describe, expect, it } from 'vitest'
import {
  buildInbox, firstClearToday, followUpBy, groupInbox, inboxChips, inboxKey, isMarked, replyDue, snoozeUntil, visibleInbox,
  type InboxMark, type InboxRow, type InboxSources,
} from './inbox'
import type { SyncedMeeting, SyncedThread } from './google'
import { NEW_INVESTOR, type Investor } from './pipeline'
import { DEFAULT_ROUND } from './round'
import { SHORTCUTS, KEYS } from './shortcuts'
import { todayIST } from './dates'
import type { SignalView } from './signals'
import type { Suggestion } from './suggestions'

let n = 0
const inv = (o: Partial<Investor>): Investor => ({ ...NEW_INVESTOR, _id: 'i' + n++, maxStage: 'todo', ...o }) as Investor
const TODAY = '2030-01-10'
const NOW = Date.parse('2030-01-10T12:00:00+05:30')
const H = 36e5

const meeting = (o: Partial<SyncedMeeting>): SyncedMeeting => ({
  _id: 'm' + n++, eventId: 'e' + n++, title: 'Call', start: NOW - 3 * H, end: NOW - 2 * H, people: [], investorIds: [], by: 'Dev', mine: true, ...o,
})
const thread = (o: Partial<SyncedThread>): SyncedThread => ({
  _id: 't' + n++, threadId: 'x', subject: 'Re: deck', lastAt: NOW - 5 * H, lastFrom: 'them', lastFromEmail: 'a@fund.example.com',
  participants: [], investorIds: [], link: 'https://mail.example.com/x', count: 2, by: 'Dev', mine: true, ...o,
})
const ask = (investorId: string, o: Partial<SignalView> = {}): SignalView => ({ _id: 's' + n++, investorId, source: 'email', day: TODAY, at: NOW - 5 * H, outcome: 'none', p: 0.9, asked: 'deck', ...o })
const suggestion = (o: Partial<Suggestion>): Suggestion => ({
  _id: 'sg' + n++, key: 'k' + n++, kind: 'stage', title: 'Looks further along', fix: 'Stage: 1st meeting', patch: { op: 'review' }, source: 'rule', safe: false, status: 'open', createdAt: 0, ...o,
})

/** No phases: the next moves are only the fill-ins, so the tests see their own rows. */
const ROUND = { ...DEFAULT_ROUND, phases: [], quietDays: 7 }
const src = (o: Partial<InboxSources>): InboxSources => ({
  now: NOW, today: TODAY, investors: [], acts: [], round: ROUND, meetings: [], threads: [], decisions: [], signals: [], introducers: [], intros: [],
  introInvestors: o.investors ?? [], closings: [], opens: [], suggestions: [], priority: () => 0, ...o,
})
const only = (rows: InboxRow[]) => rows.filter((r) => r.type !== 'move')

describe('the Inbox: groups and ranking', () => {
  const juniper = inv({ name: 'Juniper Seed', stage: 'm1', lastTouch: '2030-01-09' })
  const saltmarsh = inv({ name: 'Saltmarsh Angels', stage: 'intro', lastTouch: '2030-01-09' })
  const fernhill = inv({ name: 'Fernhill Fund', stage: 'm2', lastTouch: '2030-01-08' })
  const kite = inv({ name: 'Kite Angels', stage: 'booked', nextStep: 'Send the clip', nextDate: TODAY, lastTouch: '2030-01-09' })
  const north = inv({ name: 'Northwind', stage: 'intro', lastTouch: '2029-12-30' })
  const rows = buildInbox(
    src({
      investors: [juniper, saltmarsh, fernhill, kite, north],
      meetings: [meeting({ investorIds: [juniper._id] })],
      threads: [thread({ investorIds: [saltmarsh._id], subject: 'Re: Pesto intro' })],
      signals: [ask(saltmarsh._id)],
      decisions: [{ investorId: fernhill._id, status: 'maybe', decideBy: '2030-01-09', calls: 1 }],
      suggestions: [suggestion({ investorId: kite._id, safe: true, patch: { op: 'stage', from: 'booked', to: 'm1' } })],
    }),
  )

  it('puts promised-today rows first, then today, then when you can', () => {
    expect(groupInbox(only(rows)).map((g) => [g.group, g.rows.map((r) => r.type + ':' + r.name)])).toEqual([
      ['now', ['decide:Fernhill Fund', 'followup:Juniper Seed', 'reply:Saltmarsh Angels']],
      ['today', ['due:Kite Angels']],
      ['later', ['fix:1 safe fix', 'quiet:Northwind']],
    ])
  })

  it('shows each deadline, late ones as days over', () => {
    const by = (t: string) => rows.find((r) => r.type === t)!
    expect(by('followup')).toMatchObject({ when: 'Send by 18:00', late: false, label: 'Draft follow-up', action: { kind: 'draft', type: 'followup' } })
    expect(by('reply')).toMatchObject({ when: 'Waiting since 07:00', detail: 'Re: Pesto intro · they wrote 5h ago · asked for the deck', label: 'Open in Gmail' })
    expect(by('decide')).toMatchObject({ when: '1 day over', late: true, label: 'Ask for a yes or no' })
    expect(by('due')).toMatchObject({ when: 'Today', detail: 'Send the clip', label: 'Mark done' })
  })

  it('ranks by deadline, then Priority', () => {
    const a = inv({ name: 'Alder', stage: 'm1', nextStep: 'Call', nextDate: TODAY, lastTouch: '2030-01-09' })
    const b = inv({ name: 'Birch', stage: 'm1', nextStep: 'Call', nextDate: TODAY, lastTouch: '2030-01-09' })
    const c = inv({ name: 'Cedar', stage: 'm1', nextStep: 'Call', nextDate: '2030-01-08', lastTouch: '2030-01-09' })
    const p: Record<string, number> = { [a._id]: 40, [b._id]: 90, [c._id]: 10 }
    const r = only(buildInbox(src({ investors: [a, b, c], priority: (id) => p[id] ?? 0 })))
    expect(r.map((x) => x.name)).toEqual(['Cedar', 'Birch', 'Alder'])
  })

  it('counts the chips by kind', () => {
    expect(inboxChips(only(rows))).toEqual([
      { label: 'Follow up', n: 1 }, { label: 'Reply', n: 1 }, { label: 'Decide', n: 1 }, { label: 'Next steps', n: 1 }, { label: 'Fixes', n: 1 }, { label: 'Quiet', n: 1 },
    ])
  })

  it('works out the end of the day', () => {
    expect(followUpBy(Date.parse('2030-01-10T10:00:00+05:30'))).toBe(Date.parse('2030-01-10T18:00:00+05:30'))
    expect(followUpBy(Date.parse('2030-01-10T17:30:00+05:30'))).toBe(Date.parse('2030-01-10T23:59:00+05:30'))
    expect(replyDue(Date.parse('2030-01-08T09:00:00+05:30'))).toBe(Date.parse('2030-01-10T23:59:00+05:30'))
  })
})

describe('the Inbox: one row per investor per type', () => {
  const orchard = inv({ name: 'Orchard Capital', stage: 'm2', lastTouch: '2030-01-09' })

  it('merges two meetings, and two emails, into one row each', () => {
    const rows = buildInbox(
      src({
        investors: [orchard],
        meetings: [meeting({ investorIds: [orchard._id], end: NOW - 5 * H }), meeting({ investorIds: [orchard._id], end: NOW - H })],
        threads: [thread({ investorIds: [orchard._id], subject: 'Old', lastAt: NOW - 30 * H }), thread({ investorIds: [orchard._id], subject: 'New', lastAt: NOW - H })],
      }),
    )
    expect(only(rows).map((r) => r.key)).toEqual(['followup:' + orchard._id, 'reply:' + orchard._id])
    const reply = rows.find((r) => r.type === 'reply')!
    expect(reply.detail).toMatch(/^New · they wrote 1h ago/)
    // Due 2 working days after the older email (Wed → Fri), so not late yet.
    expect(reply).toMatchObject({ late: false, when: 'Waiting 1 day' })
  })

  it('makes one Decide row from a passed decide-by, the 3rd call and a Decide signal', () => {
    const rows = buildInbox(
      src({
        investors: [orchard],
        decisions: [{ investorId: orchard._id, status: 'maybe', decideBy: '2030-01-08', calls: 3 }],
        signals: [{ _id: 'sx', investorId: orchard._id, source: 'note', day: TODAY, at: NOW - H, outcome: 'decide', change: { to: 'no' }, p: 0.6 }],
      }),
    )
    const decide = only(rows).filter((r) => r.type === 'decide')
    expect(decide).toHaveLength(1)
    expect(decide[0]).toMatchObject({ group: 'now', label: 'Mark as no', action: { kind: 'resolve', signalId: 'sx' }, when: '2 days over' })
  })

  it('thanks an introducer once for two intros made today', () => {
    const lantern = inv({ name: 'Lantern Ventures', stage: 'intro' })
    const tide = inv({ name: 'Tidewater Angels', stage: 'intro' })
    const rows = buildInbox(
      src({
        investors: [lantern, tide],
        introducers: [{ _id: 'p1', name: 'Asha Rao', relation: 'friend', notes: '' }],
        intros: [
          { _id: 'x1', investorId: lantern._id, introducerId: 'p1', steps: { made: TODAY } },
          { _id: 'x2', investorId: tide._id, introducerId: 'p1', steps: { made: TODAY } },
        ],
      }),
    )
    expect(only(rows).filter((r) => r.type === 'thank')).toEqual([
      expect.objectContaining({ key: 'thank:p1', name: 'Asha Rao', detail: 'Introduced you to Lantern Ventures and Tidewater Angels', action: { kind: 'step', step: 'thanked', introIds: ['x1', 'x2'] } }),
    ])
  })

  it('sends notes’ proposals to Review and gathers the safe fixes in one row', () => {
    const rows = buildInbox(
      src({
        investors: [orchard],
        suggestions: [
          suggestion({ investorId: orchard._id, source: 'notes' }), suggestion({ investorId: orchard._id, source: 'notes' }),
          suggestion({ investorId: orchard._id, safe: true, kind: 'expected', patch: { op: 'expected', amount: 1 } }),
          suggestion({ safe: true, kind: 'missing_info', patch: { op: 'domain', domain: 'fund.example.com' } }),
        ],
      }),
    )
    expect(only(rows).map((r) => [r.key, r.label])).toEqual([['review:' + orchard._id, 'Review 2'], ['fix:safe', 'Accept 2']])
  })
})

describe('the Inbox: done and snooze', () => {
  const kite = inv({ name: 'Kite Angels', stage: 'm1', lastTouch: '2030-01-09' })
  const at = (lastAt: number) => only(buildInbox(src({ investors: [kite], threads: [thread({ _id: 'tk', investorIds: [kite._id], lastAt })] })))
  const [row] = at(NOW - 5 * H)
  const mark = (o: Partial<InboxMark>): Map<string, InboxMark> => new Map([[row.key, { key: row.key, kind: 'done', version: row.version, ...o }]])

  it('hides a done row while its source is the same', () => {
    expect(visibleInbox(at(NOW - 5 * H), mark({}), NOW)).toEqual([])
  })

  it('brings a done row back when its source changes (a new email)', () => {
    const fresh = at(NOW - H)
    expect(fresh[0].version).not.toBe(row.version)
    expect(visibleInbox(fresh, mark({}), NOW)).toHaveLength(1)
  })

  it('snoozes until tomorrow at 09:00 IST', () => {
    const until = snoozeUntil(NOW)
    expect(until).toBe(Date.parse('2030-01-11T09:00:00+05:30'))
    expect(isMarked(row, { key: row.key, kind: 'snooze', version: row.version, until }, until - 1)).toBe(true)
    expect(isMarked(row, { key: row.key, kind: 'snooze', version: row.version, until }, until)).toBe(false)
  })

  it('brings a snoozed row back early when its source changes', () => {
    expect(visibleInbox(at(NOW - H), mark({ kind: 'snooze', until: snoozeUntil(NOW) }), NOW)).toHaveLength(1)
  })
})

describe('the clear-inbox confetti', () => {
  it('plays at most once a day', () => {
    expect(firstClearToday(null, TODAY)).toBe(true)
    expect(firstClearToday(TODAY, TODAY)).toBe(false)
    expect(firstClearToday('2030-01-09', TODAY)).toBe(true)
  })
})

describe('the Inbox keys', () => {
  const key = (k: string, o: Partial<KeyboardEvent> = {}) => inboxKey({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o })

  it('maps J, K, E, S, D and ↵', () => {
    expect(['j', 'k', 'e', 's', 'd', 'Enter'].map((k) => key(k))).toEqual(['down', 'up', 'done', 'snooze', 'draft', 'open'])
  })

  it('leaves modified keys alone', () => {
    expect(key('e', { metaKey: true })).toBeNull()
    expect(key('s', { shiftKey: true })).toBeNull()
    expect(key('x')).toBeNull()
  })

  it('lists them on the ? sheet', () => {
    const lists = SHORTCUTS.find((g) => g.id === 'lists')!.rows.flatMap((r) => r.keys)
    for (const k of [KEYS.down, KEYS.up, KEYS.done, KEYS.snooze, KEYS.draft, KEYS.open]) expect(lists).toContain(k)
  })
})

/* ---------- PST-306: Reply rows only for mail that waits on Dev ---------- */

describe('the Inbox: replies (PST-306)', () => {
  const lark = inv({ name: 'Larkspur Ventures', stage: 'm1', lastTouch: '2030-01-09' })
  const replies = (o: Partial<InboxSources>) => only(buildInbox(src({ investors: [lark], ...o }))).filter((r) => r.type === 'reply')

  it('skips a thread the sync found nothing owed on (calendar or automated mail)', () => {
    expect(replies({ threads: [thread({ investorIds: [lark._id], subject: 'Invitation: Larkspur x Pesto @ Thu', owed: null })] })).toEqual([])
  })

  it('skips calendar and automated mail on rows synced before, from their sender and subject', () => {
    for (const t of [
      { subject: 'Updated invitation: Pesto <> Larkspur', lastFromEmail: 'kai@larkspur.example.com' },
      { subject: 'Re: Accepted: Catchup with Kai', lastFromEmail: 'kai@larkspur.example.com' },
      { subject: 'Application received', lastFromEmail: 'applications@larkspur.example.com' },
      { subject: 'Weekly portfolio digest', lastFromEmail: 'no-reply@larkspur.example.com' },
    ])
      expect(replies({ threads: [thread({ investorIds: [lark._id], ...t })] })).toEqual([])
  })

  it('still shows a real question, counted from when they asked', () => {
    const t = thread({ investorIds: [lark._id], subject: 'Re: Pesto deck', lastAt: NOW - H, owed: { at: NOW - 5 * H, messageId: 'q1' } })
    expect(replies({ threads: [t] })).toEqual([expect.objectContaining({ key: 'reply:' + lark._id, detail: 'Re: Pesto deck · they wrote 5h ago', when: 'Waiting since 07:00', late: false })])
  })

  it('makes no row when Jev is sure their newest email asks for nothing', () => {
    const t = thread({ investorIds: [lark._id], owed: { at: NOW - 5 * H, messageId: 'q1' } })
    const read = (nothing: number, messageId = 'q1'): SignalView => ({ _id: 's' + n++, investorId: lark._id, source: 'email', day: TODAY, at: NOW - 4 * H, outcome: 'none', p: 0, messageId, nothing })
    expect(replies({ threads: [t], signals: [read(0.8)] })).toEqual([])
    expect(replies({ threads: [t], signals: [read(0.6)] })).toHaveLength(1)
    // Jev read an older email: the newest one still waits.
    expect(replies({ threads: [t], signals: [read(0.95, 'older')] })).toHaveLength(1)
  })

  it('is due 2 working days after they wrote, skipping the weekend, and counts days over from then', () => {
    const friday = Date.parse('2030-01-11T16:00:00+05:30')
    expect(replyDue(friday)).toBe(Date.parse('2030-01-15T23:59:00+05:30'))
    expect(replyDue(Date.parse('2030-01-12T11:00:00+05:30'))).toBe(Date.parse('2030-01-15T23:59:00+05:30'))
    const on = (now: number) => replies({ now, today: todayIST(now), threads: [thread({ investorIds: [lark._id], lastAt: friday, owed: { at: friday, messageId: 'q1' } })] })[0]
    expect(on(Date.parse('2030-01-14T10:00:00+05:30'))).toMatchObject({ when: 'Waiting 3 days', late: false, group: 'today' })
    expect(on(Date.parse('2030-01-15T22:00:00+05:30'))).toMatchObject({ when: 'Waiting 4 days', late: false })
    expect(on(Date.parse('2030-01-16T09:00:00+05:30'))).toMatchObject({ when: '1 day over', late: true, group: 'now' })
    expect(on(Date.parse('2030-01-20T09:00:00+05:30'))).toMatchObject({ when: '5 days over', late: true })
  })
})
