// DEV ONLY: made-up Calendar and Gmail data for `?preview&google=connected|syncing|reconnect`
// (and `&drawer=emails`). Invented people at example.com addresses; nothing real.
import { todayIST } from '../lib/dates'
import { NO_GOOGLE, type ConnectionStatus, type GoogleData, type SyncedMeeting, type SyncedThread } from '../lib/google'
import type { Investor } from '../lib/pipeline'

// PST-293: 'metadata' is connected on an old gmail.metadata grant ("Reconnect Google to read email bodies").
export const PREVIEW_GOOGLE = ['none', 'connected', 'syncing', 'reconnect', 'metadata'] as const
export type PreviewGoogle = (typeof PREVIEW_GOOGLE)[number]

const H = 36e5
const D = 24 * H

/** The fixture investors' made-up addresses (so matching, "Matched by" and the Gmail links read right). */
export const FIXTURE_ADDRESSES: Record<string, { email?: string; emails?: string[]; domains?: string[] }> = {
  'Orchard Capital': { email: 'maya@orchard.example.com', domains: ['orchard.example.com'] },
  'Lantern Ventures': { email: 'lee@lantern.example.com' },
  'Kite Angels': { email: 'sam@kite.example.com', emails: ['sam.okoye@example.com'] },
  'Juniper Seed': { domains: ['juniper.example.com'] },
  'Saltmarsh Angels': { email: 'jo@saltmarsh.example.com' },
}

export function fixtureGoogle(state: PreviewGoogle, investors: Investor[], now: number): GoogleData {
  if (state === 'none') return NO_GOOGLE
  const today = todayIST(now)
  const id = (name: string) => investors.find((i) => i.name === name)?._id
  const ids = (name: string) => [id(name)].filter((x): x is string => !!x)
  /** A time of day (IST) `n` days from today. */
  const at = (n: number, hhmm: string) => Date.parse(`${today}T${hhmm}:00+05:30`) + n * D
  const m = (o: Partial<SyncedMeeting> & Pick<SyncedMeeting, 'eventId' | 'title' | 'start' | 'people'>): SyncedMeeting => ({
    _id: o.eventId, end: o.start + 45 * 6e4, link: 'https://calendar.google.com/', investorIds: [], by: 'Dev', mine: true, ...o,
  })
  const meetings: SyncedMeeting[] = [
    m({ eventId: 'fx-kite', title: 'Pesto × Kite Angels', start: at(0, '11:00'), people: [{ email: 'sam@kite.example.com', name: 'Sam Okoye' }], investorIds: ids('Kite Angels') }),
    m({ eventId: 'fx-larkspur', title: 'Intro call', start: at(0, '16:30'), people: [{ email: 'rowan@larkspur.example.com', name: 'Rowan Hale' }] }),
    m({ eventId: 'fx-lantern', title: 'Lantern Ventures first call', start: at(1, '10:00'), people: [{ email: 'lee@lantern.example.com', name: 'Lee Park' }], investorIds: ids('Lantern Ventures'), by: 'Sam', mine: false }),
    m({ eventId: 'fx-juniper', title: 'Juniper partner chat', start: at(-1, '15:00'), people: [{ email: 'ana@juniper.example.com', name: 'Ana Ruiz' }], investorIds: ids('Juniper Seed') }),
    m({ eventId: 'fx-fieldnote', title: 'Coffee', start: at(-3, '09:30'), people: [{ email: 'mina@fieldnote.example.com', name: 'Mina Okafor' }] }),
    m({ eventId: 'fx-harbor', title: 'Pesto × Harbor Light', start: at(-2, '12:00'), people: [{ email: 'dara@harborlight.example.com', name: 'Dara Cole' }] }),
    m({ eventId: 'fx-northbridge', title: 'Quick question', start: at(-1, '18:00'), people: [{ email: 'm.tan@northbridge.example.com' }] }),
  ]
  const t = (o: Partial<SyncedThread> & Pick<SyncedThread, 'threadId' | 'subject' | 'lastAt' | 'lastFrom' | 'lastFromEmail' | 'investorIds'>): SyncedThread => ({
    _id: o.threadId, participants: ['dev@example.com', o.lastFromEmail], link: 'https://mail.google.com/', count: 3, by: 'Dev', mine: true, ...o,
  })
  const threads: SyncedThread[] = [
    t({ threadId: 'fx-t1', subject: 'Re: Deck and the 60-second clip', lastAt: now - 52 * H, lastFrom: 'them', lastFromEmail: 'sam@kite.example.com', investorIds: ids('Kite Angels'), count: 4 }),
    t({ threadId: 'fx-t2', subject: 'Re: Quick call?', lastAt: now - 4 * D, lastFrom: 'us', lastFromEmail: 'dev@example.com', investorIds: ids('Kite Angels'), count: 3 }),
    t({ threadId: 'fx-t3', subject: 'Intro: Dev ↔ Kite Angels', lastAt: now - 5 * D, lastFrom: 'us', lastFromEmail: 'dev@example.com', investorIds: ids('Kite Angels'), count: 2 }),
    t({ threadId: 'fx-t4', subject: 'Re: Data room access', lastAt: now - 3 * D - 5 * H, lastFrom: 'them', lastFromEmail: 'maya@orchard.example.com', investorIds: ids('Orchard Capital') }),
    t({ threadId: 'fx-t5', subject: 'Re: Pesto intro', lastAt: now - 50 * H, lastFrom: 'them', lastFromEmail: 'jo@saltmarsh.example.com', investorIds: ids('Saltmarsh Angels'), by: 'Sam', mine: false }),
    t({ threadId: 'fx-t6', subject: 'Re: First call', lastAt: now - D, lastFrom: 'us', lastFromEmail: 'dev@example.com', investorIds: ids('Lantern Ventures') }),
  ]
  const status: ConnectionStatus = state === 'metadata' ? 'connected' : state
  const me =
    state === 'syncing'
      ? { status, email: 'dev@example.com', running: true, scan: { done: 214, oldest: now - 10.7 * D, startedAt: now - 35e3 } }
      : state === 'reconnect'
        ? { status, email: 'dev@example.com', running: false, lastSyncAt: now - 3 * H, lastError: 'Google stopped accepting this connection.' }
        : { status, email: 'dev@example.com', running: false, lastSyncAt: now - 2 * 6e4, emailBodies: state !== 'metadata' }
  return {
    loaded: true,
    me,
    team: [
      { name: 'Dev', status, mine: true },
      { name: 'Sam', status: 'connected', mine: false },
    ],
    meetings,
    threads,
  }
}
