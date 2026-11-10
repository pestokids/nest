// DEV ONLY: ?preview&today=inbox|phone|clear (PST-297). Made-up sources laid over
// the preview's own so Today's Inbox has a row of every type: a meeting that just
// ended (follow up), an email with an ask (reply), an intro to thank and one to
// report back on, a decide-by date that passed, a verbal yes to confirm, a close
// step due, notes to review and an opened deck, beside the fixture's own next
// steps due, quiet conversations, suggested fixes and next moves. `clear` starts
// with every row done. Invented names and example.com addresses only.
// PST-306: `replies` adds Reply rows waiting and over their due date, beside
// threads that make none: a calendar update, an automated confirmation, and an
// email Jev is sure asks for nothing.
import type { Closing } from '../lib/close'
import type { SyncedMeeting, SyncedThread } from '../lib/google'
import type { InboxSources } from '../lib/inbox'
import type { Investor } from '../lib/pipeline'
import type { Suggestion } from '../lib/suggestions'
import { addDays } from '../lib/today'

export const PREVIEW_INBOX = ['inbox', 'phone', 'clear', /* PST-306 */ 'replies'] as const
export const isInboxPreview = (s: string | null | undefined) => (PREVIEW_INBOX as readonly string[]).includes(s ?? '')

const H = 36e5
const D = 24 * H

export function previewInboxSources(state: string | null | undefined, src: InboxSources): InboxSources {
  if (!isInboxPreview(state)) return src
  const { now, today } = src
  const d = (n: number) => addDays(today, n)
  const id = (name: string) => src.investors.find((i) => i.name === name)?._id ?? ''
  const juniper = id('Juniper Seed')
  const saltmarsh = id('Saltmarsh Angels')
  const fernhill = id('Fernhill Fund')
  const lantern = id('Lantern Ventures')
  const orchard = id('Orchard Capital')
  const tidewater = id('Tidewater Angels')
  const cedar = id('Cedar Collective')

  // Orchard said yes on today's call; Tidewater accepted an hour ago (the SAFE goes out today).
  const committed: Record<string, Partial<Investor>> = { [orchard]: { stage: 'verbal', expected: 100000 }, [tidewater]: { stage: 'verbal', expected: 20000 } }
  const investors = src.investors.map((i) => (committed[i._id] ? { ...i, ...committed[i._id] } : i))
  const verbal = (investorId: string, date: string, k: number) => ({ _id: 'fx-inbox-act' + k, investorId, kind: 'stage' as const, stage: 'verbal' as const, date, _creationTime: now - 3 * H })

  const meeting: SyncedMeeting = {
    _id: 'fx-inbox-m1', eventId: 'fx-inbox-m1', title: 'Juniper partner chat', start: now - 3 * H, end: now - 2 * H, link: 'https://calendar.google.com/',
    people: [{ email: 'ana@juniper.example.com', name: 'Ana Ruiz' }], investorIds: [juniper], by: 'Dev', mine: true,
  }
  const thread: SyncedThread = {
    _id: 'fx-inbox-t1', threadId: 'fx-inbox-t1', subject: 'Re: Pesto intro', lastAt: now - 5 * H, lastFrom: 'them', lastFromEmail: 'jo@saltmarsh.example.com',
    participants: ['dev@example.com', 'jo@saltmarsh.example.com'], investorIds: [saltmarsh], link: 'https://mail.google.com/', count: 3, by: 'Dev', mine: true,
  }
  const note = (k: number, title: string, fix: string): Suggestion => ({
    _id: 'fx-inbox-s' + k, key: 'fx-inbox-s' + k, kind: 'next_step', investorId: cedar, title, fix, patch: { op: 'review' }, source: 'notes', safe: false, status: 'open', createdAt: now - H,
  })

  // PST-306: what the sync stores for each (`owed`), and Jev's read of one email.
  const replyThread = (k: number, investorId: string, subject: string, from: string, at: number, owed: SyncedThread['owed']): SyncedThread => ({
    _id: 'fx-reply-t' + k, threadId: 'fx-reply-t' + k, subject, lastAt: at, lastFrom: 'them', lastFromEmail: from, participants: ['dev@example.com', from], investorIds: [investorId],
    link: 'https://mail.google.com/', count: 2, by: 'Dev', mine: true, owed,
  })
  const replies = state === 'replies'
  const replyThreads = replies
    ? [
        replyThread(1, id('Harbor Light'), 'Re: Questions after the call', 'pat@harborlight.example.com', now - D - 2 * H, { at: now - D - 2 * H, messageId: 'fx-reply-m1' }),
        replyThread(2, lantern, 'Re: Retention by cohort', 'lee@lantern.example.com', now - 9 * D, { at: now - 9 * D, messageId: 'fx-reply-m2' }),
        replyThread(3, juniper, 'Updated invitation: Juniper <> Pesto @ Thu', 'ana@juniper.example.com', now - 6 * D, null),
        replyThread(4, cedar, 'Your application was received', 'applications@cedar.example.com', now - 8 * D, null),
        replyThread(5, fernhill, 'Re: Thanks for the call', 'mo@fernhill.example.com', now - 4 * D, { at: now - 4 * D, messageId: 'fx-reply-m5' }),
      ]
    : []
  const nothingAsked = replies ? [{ _id: 'fx-reply-sig5', investorId: fernhill, source: 'email' as const, day: d(-4), at: now - 4 * D, outcome: 'none' as const, p: 0.92, messageId: 'fx-reply-m5', nothing: 0.92 }] : []

  return {
    ...src,
    investors,
    acts: [...src.acts, verbal(orchard, today, 1), verbal(tidewater, d(-1), 2)],
    meetings: [...src.meetings, meeting],
    threads: [...src.threads, thread, ...replyThreads],
    signals: [...src.signals, { _id: 'fx-inbox-sig1', investorId: saltmarsh, source: 'email', day: today, at: now - 5 * H, outcome: 'none', p: 0.9, asked: 'deck' }, ...nothingAsked],
    decisions: [...src.decisions.filter((x) => x.investorId !== fernhill), { investorId: fernhill, status: 'maybe', maybeSince: now - 12 * D, decideBy: d(-1), calls: 3, firstMeeting: d(-8) }],
    introInvestors: src.introInvestors.map((i) => (committed[i._id] ? { ...i, ...committed[i._id] } : i)),
    closings: [...src.closings, { _id: 'fx-inbox-c1', investorId: tidewater, steps: [], acceptedAt: now - H } as unknown as Closing],
    opens: [...src.opens, { linkId: 'fx-inbox-l1', investorId: lantern, at: now - 2 * H, text: 'Read Pitch deck v4 for 4m 10s, longest on p6' }],
    suggestions: [
      ...src.suggestions,
      note(1, 'Notes from the 1st meeting: they want a partner call next week', 'Next step: book the partner call'),
      note(2, 'Notes from the 1st meeting: they asked about week-4 retention', 'Q&A: add the question'),
      note(3, 'Notes from the 1st meeting: they mentioned a $50K check', 'Expected: $50K'),
    ],
  }
}
