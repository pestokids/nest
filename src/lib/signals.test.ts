// PST-293: signals from emails and notes, pure parts: the thresholds, what Jev
// reads from an email, auto-replies, and what a sure or unsure answer does.
// Every sender, firm and line of text below is made up.
import { describe, expect, it } from 'vitest'
import { JEV_FEATURES, THRESHOLDS } from './jev'
import {
  askOf, bodyText, emailOutcome, emailState, isAutomated, latestSignal, noteOutcome, signalLine, stripEmail, type EmailAnswers, type NoteAnswers, type SignalView,
} from './signals'
import { JEV_STATE_CHARS } from './jev'

const noul = (p: number) => ({ type: 'noul' as const, noul: p })
const choice = (probabilities: Record<string, number>) => {
  const top = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0]
  return { type: 'choice' as const, choice: top, probabilities, confidence: 0.5 }
}
const email = (o: { ask?: Record<string, number>; pass?: number; real?: number }): EmailAnswers => ({
  ask: choice(o.ask ?? { nothing: 0.9, deck: 0.1 }), pass: noul(o.pass ?? 0.05), real: noul(o.real ?? 0.05),
})
const note = (o: { status?: Record<string, number>; lead?: number; comeback?: number }): NoteAnswers => ({
  status: choice(o.status ?? { interested: 0.4, maybe: 0.3, yes: 0.2, no: 0.1 }), lead: noul(o.lead ?? 0.05), comeback: noul(o.comeback ?? 0.05),
  score: { type: 'score', score: 2.5, legend: {}, probabilities: { 0: 0.1, 1: 0.1, 2: 0.2, 3: 0.4, 4: 0.2 }, confidence: 0.4 },
})

describe('thresholds', () => {
  it('are in THRESHOLDS, and the features in JEV_FEATURES', () => {
    expect(THRESHOLDS).toMatchObject({ signalChoice: 0.85, signalYes: 0.85, signalNo: 0.15 })
    expect(JEV_FEATURES).toEqual(expect.arrayContaining(['email_signals', 'note_signals']))
  })
  it('a Noul exactly at 0.85 or 0.15 is sure; just inside is not', () => {
    expect(emailOutcome(email({ pass: 0.85 }))).toMatchObject({ kind: 'auto', change: { to: 'no' } })
    expect(emailOutcome(email({ pass: 0.84 }))).toMatchObject({ kind: 'decide', change: { to: 'no' } })
    expect(emailOutcome(email({ pass: 0.15, real: 0.15 }))).toMatchObject({ kind: 'none' })
    expect(emailOutcome(email({ pass: 0.16, real: 0.1 }))).toMatchObject({ kind: 'decide' })
  })
  it('a Choice at 0.85 is sure', () => {
    expect(askOf(email({ ask: { deck: 0.85, nothing: 0.15 } }))).toBe('deck')
    expect(askOf(email({ ask: { deck: 0.84, nothing: 0.16 } }))).toBeUndefined()
    expect(askOf(email({ ask: { nothing: 0.95, deck: 0.05 } }))).toBeUndefined()
    expect(noteOutcome(note({ status: { yes: 0.85, interested: 0.15 } }))).toMatchObject({ kind: 'auto', change: { to: 'yes' } })
    expect(noteOutcome(note({ status: { yes: 0.84, interested: 0.16 } }))).toMatchObject({ kind: 'decide', change: { to: 'yes' } })
  })
})

describe('acting on an email', () => {
  it('a sure pass sets No by itself', () => {
    expect(emailOutcome(email({ pass: 0.93 }), 'maybe')).toEqual({ kind: 'auto', change: { to: 'no' }, p: 0.93 })
  })
  it('sure real interest sets Interested, but never over a Yes', () => {
    expect(emailOutcome(email({ real: 0.9 }), 'maybe')).toEqual({ kind: 'auto', change: { to: 'interested' }, p: 0.9 })
    expect(emailOutcome(email({ real: 0.9 }), 'yes')).toMatchObject({ kind: 'none' })
  })
  it('nothing when it already is that', () => {
    expect(emailOutcome(email({ pass: 0.93 }), 'no')).toMatchObject({ kind: 'none' })
  })
  it('a Yes Dev holds is only changed through a Decide row', () => {
    expect(emailOutcome(email({ pass: 0.95 }), 'yes')).toEqual({ kind: 'decide', change: { to: 'no' }, p: 0.95 })
  })
  it('real interest with an unsure pass asks', () => {
    expect(emailOutcome(email({ real: 0.9, pass: 0.4 }))).toMatchObject({ kind: 'decide', change: { to: 'interested' } })
  })
})

describe('acting on a note', () => {
  it('"come back when there’s a lead" sets Maybe with the reason', () => {
    expect(noteOutcome(note({ comeback: 0.9, status: { no: 0.9, maybe: 0.1 } }), 'interested')).toEqual({ kind: 'auto', change: { to: 'maybe', reason: 'wants a lead' }, p: 0.9 })
  })
  it('an unsure "come back" is a Decide row for Maybe', () => {
    expect(noteOutcome(note({ comeback: 0.5 }))).toMatchObject({ kind: 'decide', change: { to: 'maybe', reason: 'wants a lead' }, p: 0.5 })
  })
  it('an unsure status is a Decide row; the same status as now is nothing', () => {
    expect(noteOutcome(note({}), undefined)).toMatchObject({ kind: 'decide', change: { to: 'interested' } })
    expect(noteOutcome(note({}), 'interested')).toMatchObject({ kind: 'none' })
  })
})

describe('what Jev reads from an email', () => {
  const body = [
    'Hi Dev,',
    '',
    'Thanks for the call. Could you send the deck and your retention numbers?',
    '',
    '-- ',
    'Sam Example | Kite Angels',
    '',
    'On Mon, 2 Nov 2026 at 10:00, Dev <dev@example.com> wrote:',
    '> Lovely to meet you.',
    '> Dev',
  ].join('\r\n')
  it('cuts quoted replies and the signature', () => {
    expect(stripEmail(body)).toBe('Hi Dev,\n\nThanks for the call. Could you send the deck and your retention numbers?')
  })
  it('cuts a reply header that wraps onto two lines, and "Sent from my phone"', () => {
    expect(stripEmail('Sounds good.\n\nOn Mon, 2 Nov 2026 at 10:00, Dev Example <dev@example.com>\nwrote:\n> hi')).toBe('Sounds good.')
    expect(stripEmail('Yes, Tuesday works.\nSent from my phone')).toBe('Yes, Tuesday works.')
  })
  it('keeps subject and body together under JEV_STATE_CHARS', () => {
    const s = emailState('  Re:   Pesto  ', 'x'.repeat(JEV_STATE_CHARS * 2))
    expect(s.subject).toBe('Re: Pesto')
    expect(s.subject.length + s.email.length).toBe(JEV_STATE_CHARS)
  })
  it('reads the text part, else the HTML as text without its quoted block', () => {
    const b64 = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_')
    expect(bodyText({ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<p>html</p>') } }, { mimeType: 'text/plain', body: { data: b64('plain one') } }] })).toBe('plain one')
    expect(bodyText({ mimeType: 'text/html', body: { data: b64('<div>We&#39;re in.<br>Send the SAFE</div><blockquote>old</blockquote>') } }).trim()).toBe('We\'re in.\nSend the SAFE')
    expect(bodyText(undefined)).toBe('')
  })
  it('spots auto-replies and no-reply senders', () => {
    const none = () => ''
    expect(isAutomated('no-reply@fund.example.com', 'Your update', none)).toBe(true)
    expect(isAutomated('noreply+digest@fund.example.com', 'Weekly', none)).toBe(true)
    expect(isAutomated('sam@kite.example.com', 'Out of office: back Monday', none)).toBe(true)
    expect(isAutomated('sam@kite.example.com', 'Re: Pesto', (h) => (h === 'Auto-Submitted' ? 'auto-replied' : ''))).toBe(true)
    expect(isAutomated('sam@kite.example.com', 'Re: Pesto', (h) => (h === 'Precedence' ? 'bulk' : ''))).toBe(true)
    expect(isAutomated('sam@kite.example.com', 'Re: Pesto', (h) => (h === 'Auto-Submitted' ? 'no' : ''))).toBe(false)
    expect(isAutomated('sam@kite.example.com', 'Re: Pesto', none)).toBe(false)
  })
})

describe('reading signals back', () => {
  const s = (o: Partial<SignalView>): SignalView => ({ _id: 'x', investorId: 'kite', source: 'note', day: '2026-11-07', at: 1, outcome: 'none', p: 0, ...o })
  it('latestSignal is the newest one for that investor', () => {
    const list = [s({ _id: 'a', at: 1 }), s({ _id: 'b', at: 3 }), s({ _id: 'c', at: 5, investorId: 'fern' })]
    expect(latestSignal(list, 'kite')?._id).toBe('b')
    expect(latestSignal(list, 'nobody')).toBeNull()
  })
  it('says what it read in a few words', () => {
    expect(signalLine(s({ source: 'email', pass: 0.9 }))).toBe('A pass')
    expect(signalLine(s({ source: 'email', real: 0.9, asked: 'deck' }))).toBe('Real interest · asked for the deck')
    expect(signalLine(s({ comeback: 0.9, score: 2.2 }))).toBe('Come back when there’s a lead · a polite no · interest 2 of 5')
    expect(signalLine(s({ status: 'interested', score: 4.2 }))).toBe('Real interest (4 of 5)')
    expect(signalLine(s({ lead: 0.9 }))).toBe('Offered to lead')
  })
})
