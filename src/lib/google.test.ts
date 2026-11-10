import { describe, expect, it } from 'vitest'
import {
  cleanDomains, cleanEmails, contactSignals, followUps, makeMatcher, nameFromEmail, normDomain, normEmail, parseAddresses, scanProgress,
  isWaiting, syncStageMove, waitingOnYou, whoIsThis, withContact, WAITING_MS, type SyncedMeeting, type SyncedThread,
} from './google'
import { lastContact, quietFor, quietList, type Investor } from './pipeline'
import { quietDaysOf } from './board'
import { isQuiet } from './investorView'
import { PIPELINE_KEYS, type Stage } from './stages'

const H = 36e5
const D = 24 * H
const NOW = Date.parse('2026-11-07T06:30:00Z') // 12:00 IST

describe('addresses', () => {
  it('normalises emails and header lists', () => {
    expect(normEmail('Priya Raman <Priya@Northstar.example.com>')).toBe('priya@northstar.example.com')
    expect(normEmail('mailto:A@B.example.com')).toBe('a@b.example.com')
    expect(normEmail('not an email')).toBe('')
    expect(parseAddresses('"Raman, Priya" <priya@northstar.example.com>, sam@kite.example.com; Dev <founder@pestokids.com>')).toEqual([
      'priya@northstar.example.com', 'sam@kite.example.com', 'founder@pestokids.com',
    ])
  })
  it('cleans domains and drops personal and our own', () => {
    expect(normDomain('https://www.Northstar.example.com/team')).toBe('northstar.example.com')
    expect(normDomain('@kite.example.com')).toBe('kite.example.com')
    expect(cleanDomains(['gmail.com', 'kite.example.com', 'pestokids.com', 'Kite.example.com', 'nope'])).toEqual(['kite.example.com'])
    expect(cleanEmails(['A@kite.example.com', 'a@kite.example.com', 'main@kite.example.com', 'x'], 'main@kite.example.com')).toEqual(['a@kite.example.com'])
  })
  it('names people from their address', () => {
    expect(nameFromEmail('priya.raman@northstar.example.com')).toBe('Priya Raman')
    expect(nameFromEmail('sam+raise@kite.example.com')).toBe('Sam')
  })
})

describe('matching', () => {
  const investors = [
    { _id: 'kite', email: 'sam@kite.example.com', domains: ['kite.example.com'] },
    { _id: 'kite2', emails: ['ana@kite.example.com'] },
    { _id: 'orchard', emails: ['lee@gmail.com'], domains: ['orchard.example.com', 'gmail.com'] },
    { _id: 'us', email: 'founder@pestokids.com', domains: ['pestokids.com'] },
  ]
  const m = makeMatcher(investors)

  it('matches an exact email first (email and emails)', () => {
    expect(m.one('Sam@Kite.example.com')).toEqual([{ id: 'kite', by: 'email', on: 'sam@kite.example.com' }])
    // ana@ is on kite2's emails: the exact match wins over kite's domain.
    expect(m.one('ana@kite.example.com')).toEqual([{ id: 'kite2', by: 'email', on: 'ana@kite.example.com' }])
    expect(m.one('lee@gmail.com')).toEqual([{ id: 'orchard', by: 'email', on: 'lee@gmail.com' }])
  })
  it('then the firm domain', () => {
    expect(m.one('partner@kite.example.com')).toEqual([{ id: 'kite', by: 'domain', on: 'kite.example.com' }])
    expect(m.one('someone@orchard.example.com').map((x) => x.id)).toEqual(['orchard'])
  })
  it('ignores generic mail domains and our own addresses', () => {
    expect(m.one('stranger@gmail.com')).toEqual([])
    expect(m.one('someone@outlook.com')).toEqual([])
    expect(m.one('founder@pestokids.com')).toEqual([])
    expect(m.one('teammate@pestokids.com')).toEqual([])
    expect(m.one('me@company.example.com', 'me@company.example.com')).toEqual([])
  })
  it('matches a set of people and lists the outsiders nobody matched', () => {
    const r = m.people(['founder@pestokids.com', 'partner@kite.example.com', 'sam@kite.example.com', 'new@fieldnote.example.com', 'x@gmail.com'])
    expect(r.ids).toEqual(['kite'])
    expect(r.how.kite).toEqual({ id: 'kite', by: 'email', on: 'sam@kite.example.com' })
    expect(r.unmatched).toEqual(['new@fieldnote.example.com', 'x@gmail.com'])
  })
})

describe('sync stage rule', () => {
  it('only moves forward', () => {
    expect(syncStageMove('todo', 'booked')).toBe('booked')
    expect(syncStageMove('ask', 'booked')).toBe('booked')
    expect(syncStageMove('intro', 'booked')).toBe('booked')
    expect(syncStageMove('booked', 'booked')).toBeNull()
    expect(syncStageMove('m1', 'booked')).toBeNull()
    expect(syncStageMove('m2', 'booked')).toBeNull()
  })
  it('never out of Passed or Parked', () => {
    expect(syncStageMove('passed', 'booked')).toBeNull()
    expect(syncStageMove('parked', 'booked')).toBeNull()
  })
  it('never past Diligence: not into Verbal, Signed or Money in', () => {
    expect(syncStageMove('m2', 'dd')).toBe('dd')
    for (const to of ['verbal', 'signed', 'wired'] as const) for (const from of PIPELINE_KEYS) expect(syncStageMove(from, to)).toBeNull()
  })
})

const inv = (o: Partial<Investor> & { _id: string; stage: Stage }): Investor => ({
  name: o._id, firm: '', type: 'Angel', geo: 'India', warmth: 'intro', path: '', tier: 'B', wave: 1, lead: false, nextStep: '', notes: '', source: '',
  maxStage: 'todo', ...o,
})

describe('gone quiet', () => {
  const today = '2026-11-07'
  it('uses the latest of Last touch, the latest email and the latest past meeting', () => {
    expect(lastContact({ lastTouch: '2026-11-01' })).toBe('2026-11-01')
    expect(lastContact({ lastTouch: '2026-11-01', contact: { email: '2026-11-05' } })).toBe('2026-11-05')
    expect(lastContact({ lastTouch: '2026-11-01', contact: { email: '2026-11-03', meeting: '2026-11-06' } })).toBe('2026-11-06')
    expect(lastContact({ contact: { meeting: '2026-11-02' } })).toBe('2026-11-02')
  })
  it('is one rule for Today, Pipeline, Investors', () => {
    const quietByTouch = inv({ _id: 'a', stage: 'ask', lastTouch: '2026-11-01' })
    const warmByEmail = { ...quietByTouch, _id: 'b', contact: { email: '2026-11-06' } }
    const warmByMeeting = { ...quietByTouch, _id: 'c', contact: { meeting: '2026-11-05' } }
    expect(quietFor(quietByTouch, today, 4)).toBe(6)
    expect(quietFor(warmByEmail, today, 4)).toBeNull()
    expect(quietFor(warmByMeeting, today, 4)).toBeNull()
    expect(quietList([quietByTouch, warmByEmail, warmByMeeting], today, 4).map((i) => i._id)).toEqual(['a'])
    for (const i of [quietByTouch, warmByEmail, warmByMeeting]) {
      expect(isQuiet(i, today, 4)).toBe(quietFor(i, today, 4) !== null)
      expect(quietDaysOf(i, today, 4)).toBe(quietFor(i, today, 4))
    }
  })
  it('only counts live, uncommitted conversations', () => {
    expect(quietFor(inv({ _id: 'x', stage: 'todo' }), today, 4)).toBeNull()
    expect(quietFor(inv({ _id: 'x', stage: 'verbal', lastTouch: '2026-10-01' }), today, 4)).toBeNull()
    expect(quietFor(inv({ _id: 'x', stage: 'intro' }), today, 4)).toBe(Infinity)
  })
  it('takes email and past meetings from synced data, not future meetings', () => {
    const meetings = [
      meeting({ eventId: 'past', start: NOW - 2 * D, investorIds: ['a'] }),
      meeting({ eventId: 'future', start: NOW + D, investorIds: ['a', 'b'] }),
    ]
    const threads = [thread({ threadId: 't', lastAt: NOW - 3 * D, investorIds: ['b'] })]
    const s = contactSignals({ meetings, threads }, NOW)
    expect(s.get('a')).toEqual({ meeting: '2026-11-05' })
    expect(s.get('b')).toEqual({ email: '2026-11-04' })
    const [a, b, c] = withContact([inv({ _id: 'a', stage: 'ask' }), inv({ _id: 'b', stage: 'ask' }), inv({ _id: 'c', stage: 'ask' })], { meetings, threads }, NOW)
    expect(a.contact).toEqual({ meeting: '2026-11-05' })
    expect(b.contact).toEqual({ email: '2026-11-04' })
    expect(c.contact).toBeUndefined()
  })
})

function meeting(o: Partial<SyncedMeeting> & { eventId: string; start: number }): SyncedMeeting {
  return { _id: o.eventId, title: 'Call', end: o.start + H, people: [], investorIds: [], by: 'Dev', mine: true, ...o }
}
function thread(o: Partial<SyncedThread> & { threadId: string; lastAt: number }): SyncedThread {
  return { _id: o.threadId, subject: 'Re: Hello', lastFrom: 'them', lastFromEmail: 'sam@kite.example.com', participants: [], investorIds: ['kite'], link: '', count: 2, by: 'Dev', mine: true, ...o }
}

describe('waiting on you', () => {
  it('lists threads the investor wrote last 48 hours or more ago', () => {
    const ts = [
      thread({ threadId: 'just-under', lastAt: NOW - WAITING_MS + 6e4 }),
      thread({ threadId: 'exactly', lastAt: NOW - WAITING_MS }),
      thread({ threadId: 'older', lastAt: NOW - 5 * D }),
      thread({ threadId: 'we-replied', lastAt: NOW - 5 * D, lastFrom: 'us' }),
      thread({ threadId: 'no-investor', lastAt: NOW - 5 * D, investorIds: [] }),
    ]
    expect(waitingOnYou(ts, NOW).map((t) => t.threadId)).toEqual(['exactly', 'older'])
  })
  it('shows a thread in both founders’ inboxes once', () => {
    const a = thread({ threadId: 'a', lastAt: NOW - 3 * D, mine: true })
    const b = thread({ threadId: 'b', lastAt: NOW - 3 * D, mine: false, subject: 'Hello' })
    expect(waitingOnYou([b, a], NOW).map((t) => t.threadId)).toEqual(['a'])
  })
  // PST-306
  it('counts from the message Dev owes, and skips calendar and automated mail', () => {
    const ts = [
      thread({ threadId: 'invite-after-question', lastAt: NOW - H, owed: { at: NOW - 3 * D, messageId: 'q' } }),
      thread({ threadId: 'calendar-only', lastAt: NOW - 3 * D, owed: null }),
      thread({ threadId: 'old-row-invite', lastAt: NOW - 3 * D, subject: 'Invitation: Kite x Pesto @ Thu' }),
      thread({ threadId: 'old-row-noreply', lastAt: NOW - 3 * D, lastFromEmail: 'noreply@kite.example.com' }),
      thread({ threadId: 'old-row-question', lastAt: NOW - 4 * D }),
    ]
    expect(waitingOnYou(ts, NOW).map((t) => t.threadId)).toEqual(['invite-after-question', 'old-row-question'])
    expect(isWaiting(ts[1], NOW)).toBe(false)
  })
})

describe('Today', () => {
  const investors = [inv({ _id: 'kite', stage: 'booked', email: 'sam@kite.example.com' }), inv({ _id: 'orchard', stage: 'm2' })]
  it('asks how it went the morning after, for stages up to 1st meeting, once', () => {
    const yesterday = NOW - D - 2 * H
    const ms = [
      meeting({ eventId: 'y', start: yesterday, investorIds: ['kite'] }),
      meeting({ eventId: 'y', start: yesterday, investorIds: ['kite'], mine: false, by: 'Teammate' }),
      meeting({ eventId: 'o', start: yesterday, investorIds: ['orchard'] }),
      meeting({ eventId: 'answered', start: yesterday, investorIds: ['kite'], answer: 'm1' }),
      meeting({ eventId: 'today', start: NOW - 3 * H, investorIds: ['kite'] }),
    ]
    const f = followUps(ms, investors, '2026-11-07', NOW)
    expect(f.map((x) => [x.meeting.eventId, x.investor._id, x.options])).toEqual([['y', 'kite', ['m1', 'm2', 'passed']]])
  })
  it("Who's this?: outside people from recent meetings with no investor", () => {
    const ms = [
      meeting({ eventId: '1', start: NOW - 2 * D, people: [{ email: 'priya@northstar.example.com', name: 'Priya Raman' }] }),
      meeting({ eventId: '2', start: NOW - 3 * D, people: [{ email: 'mina@fieldnote.example.com' }], dismissed: [] }),
      meeting({ eventId: '3', start: NOW - 3 * D, people: [{ email: 'gone@away.example.com' }], dismissed: ['gone@away.example.com'] }),
      meeting({ eventId: '4', start: NOW - 30 * D, people: [{ email: 'old@past.example.com' }] }),
      meeting({ eventId: '5', start: NOW - D, people: [{ email: 'sam@kite.example.com' }] }),
      meeting({ eventId: '6', start: NOW - D, people: [{ email: 'friend@example.com' }], investorIds: ['kite'] }),
    ]
    expect(whoIsThis(ms, investors, NOW).map((p) => [p.email, p.name])).toEqual([
      ['priya@northstar.example.com', 'Priya Raman'],
      ['mina@fieldnote.example.com', 'Mina'],
    ])
  })
  it('estimates the first read from how far back it has got', () => {
    const p = scanProgress({ done: 200, oldest: NOW - 10 * D, startedAt: NOW - 60e3 }, NOW)
    expect(p.total).toBe(600)
    expect(p.left).toBe('about 2 minutes left')
    expect(scanProgress({ done: 600, oldest: NOW - 30 * D, startedAt: NOW - 60e3 }, NOW).pct).toBe(1)
  })
})
