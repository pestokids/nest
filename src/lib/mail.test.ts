// PST-306: which mail never waits on Dev. Made-up senders and subjects only.
import { describe, expect, it } from 'vitest'
import { calendarOnly, isAutomated, isCalendarMail, owedReply, skipsReply } from './mail'

const headers = (h: Record<string, string>) => (name: string) => h[name] ?? ''
const from = 'kai@larkspur.example.com'

describe('calendar mail', () => {
  it('skips the subjects Calendar gives invites and replies, with or without Re:', () => {
    for (const subject of [
      'Invitation: Larkspur x Pesto @ Wed 11 Nov 2026 3pm - 3:30pm (IST)',
      'Updated invitation: Pesto <> Larkspur @ Thu',
      'Updated invitation with note: Pesto <> Larkspur',
      'Accepted: Catchup with Kai @ Fri',
      'Declined: Catchup with Kai',
      'Tentative: Partner meeting',
      'Tentatively accepted: Partner meeting',
      'Invitation from Google Calendar: Partner meeting',
      'Canceled event: Partner meeting',
      'Re: Invitation: Larkspur x Pesto',
      'RE: Re: Accepted: Catchup with Kai',
    ])
      expect(isCalendarMail({ from, subject }), subject).toBe(true)
  })

  it('skips mail Calendar sends, as the sender or on someone’s behalf', () => {
    expect(isCalendarMail({ from: 'Google Calendar <calendar-notification@google.com>', subject: 'Partner meeting' })).toBe(true)
    expect(isCalendarMail({ from, subject: 'Partner meeting', header: headers({ Sender: 'Google Calendar <calendar-notification@google.com>' }) })).toBe(true)
    expect(isCalendarMail({ from: 'kai@group.calendar.google.com', subject: 'Partner meeting' })).toBe(true)
  })

  it('skips a message that is a calendar, or whose only attachment is one', () => {
    expect(isCalendarMail({ from, subject: 'Partner meeting', header: headers({ 'Content-Type': 'text/calendar; method=REQUEST' }) })).toBe(true)
    const invite = { mimeType: 'multipart/mixed', parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain' }, { mimeType: 'text/html' }, { mimeType: 'text/calendar' }] }, { mimeType: 'application/ics', filename: 'invite.ics' }] }
    expect(calendarOnly(invite)).toBe(true)
    expect(calendarOnly({ mimeType: 'multipart/mixed', parts: [{ mimeType: 'text/plain' }, { mimeType: 'application/octet-stream', filename: 'Meeting.ICS' }] })).toBe(true)
    // An invite with a deck attached, or no attachment at all, still counts.
    expect(calendarOnly({ ...invite, parts: [...invite.parts, { mimeType: 'application/pdf', filename: 'deck.pdf' }] })).toBe(false)
    expect(calendarOnly({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain' }, { mimeType: 'text/html' }] })).toBe(false)
    expect(calendarOnly(undefined)).toBe(false)
  })

  it('leaves ordinary subjects alone', () => {
    for (const subject of ['Re: Pesto deck', 'Invitation to our LP day', 'Re: Accepted the terms?', 'Quick question on retention']) expect(isCalendarMail({ from, subject }), subject).toBe(false)
  })
})

describe('automated mail', () => {
  it('skips no-reply and other robot senders', () => {
    for (const sender of ['no-reply', 'noreply', 'do-not-reply', 'notifications', 'notification', 'notify', 'mailer-daemon', 'applications', 'apply', 'support', 'noreply+digest'])
      expect(skipsReply({ from: sender + '@larkspur.example.com', subject: 'Your application was submitted' }), sender).toBe(true)
  })

  it('skips mailing lists, auto-submitted and bulk mail', () => {
    expect(isAutomated(from, 'Larkspur quarterly letter', headers({ 'List-Unsubscribe': '<mailto:unsubscribe@larkspur.example.com>' }))).toBe(true)
    expect(isAutomated(from, 'Re: Pesto', headers({ 'Auto-Submitted': 'auto-generated' }))).toBe(true)
    expect(isAutomated(from, 'Re: Pesto', headers({ Precedence: 'bulk' }))).toBe(true)
    expect(isAutomated(from, 'Re: Pesto', headers({ 'Auto-Submitted': 'no' }))).toBe(false)
  })

  it('keeps a real question from a person', () => {
    expect(skipsReply({ from, subject: 'Re: Pesto deck', header: headers({ 'Content-Type': 'multipart/alternative; boundary=x' }) })).toBe(false)
    expect(skipsReply({ from: 'kai.support@larkspur.example.com', subject: 'Can you share the cap table?' })).toBe(false)
  })
})

describe('what a synced thread owes', () => {
  const row = { lastFrom: 'them' as const, lastAt: 100, lastFromEmail: from, subject: 'Re: Pesto deck' }
  it('reads the sync’s answer when there is one', () => {
    expect(owedReply({ ...row, owed: { at: 50, messageId: 'm1' } })).toEqual({ at: 50, messageId: 'm1' })
    expect(owedReply({ ...row, owed: null })).toBeNull()
  })
  it('falls back to the last message on a row synced before', () => {
    expect(owedReply(row)).toEqual({ at: 100 })
    expect(owedReply({ ...row, lastFrom: 'us' })).toBeNull()
    expect(owedReply({ ...row, subject: 'Updated invitation: Pesto <> Larkspur' })).toBeNull()
    expect(owedReply({ ...row, lastFromEmail: 'applications@larkspur.example.com' })).toBeNull()
  })
})
