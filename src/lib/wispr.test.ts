// PST-285: the pure parts of the Wispr Flow fetch: arguments from input schemas, reading results, matching.
import { describe, expect, it } from 'vitest'
import { calendarArgs, cleanUrl, fetchedLine, matchMeeting, meetingArgs, readMeeting, readMeetings, resultData, searchArgs, wisprConnectMessage } from './wispr'

const T = Date.parse('2026-11-05T10:00:00Z')
const M = 6e4

describe('arguments from input schemas', () => {
  it('finds the calendar id argument by name, else the only required string', () => {
    expect(calendarArgs({ properties: { calendar_id: { type: 'string' }, view_content: { type: 'object' } }, required: ['calendar_id'] }, 'ev')).toEqual({ calendar_id: 'ev' })
    expect(calendarArgs({ properties: { calendarEventId: { type: 'string' } } }, 'ev')).toEqual({ calendarEventId: 'ev' })
    expect(calendarArgs({ properties: { ref: { type: 'string' } }, required: ['ref'] }, 'ev')).toEqual({ ref: 'ev' })
    expect(calendarArgs({ properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] }, 'ev')).toBeNull()
    expect(calendarArgs(undefined, 'ev')).toBeNull()
    expect(meetingArgs({ properties: { meeting_id: { type: 'string' }, view_transcript: { type: 'object' } }, required: ['meeting_id'] }, 'w1')).toEqual({ meeting_id: 'w1' })
  })

  it('puts the time window wherever the schema says, in its format', () => {
    const w = { from: T, to: T + 90 * M, title: 'Pesto x Kite' }
    expect(searchArgs({ properties: { query: { type: 'string' }, since: { type: 'string', format: 'date-time' }, until: { type: 'string' }, limit: { type: 'integer', maximum: 10 } } }, w)).toEqual({
      since: '2026-11-05T10:00:00Z', until: '2026-11-05T11:30:00Z', limit: 10,
    })
    expect(searchArgs({ properties: { start_after: { type: 'integer' }, start_before: { type: 'integer' } } }, w)).toEqual({ start_after: T / 1000, start_before: T / 1000 + 5400 })
    expect(searchArgs({ properties: { from: { type: 'number', description: 'Epoch milliseconds' }, to: { type: 'number' } } }, w)).toEqual({ from: T, to: (T + 90 * M) / 1000 })
    expect(searchArgs({ properties: { start_date: { type: 'string', format: 'date' }, end_date: { type: 'string', format: 'date' } } }, w)).toEqual({ start_date: '2026-11-05', end_date: '2026-11-06' })
    expect(searchArgs({ properties: { q: { type: 'string' }, after: { type: 'string' } }, required: ['q'] }, w)).toEqual({ q: 'Pesto x Kite', after: '2026-11-05T10:00:00Z' })
    expect(searchArgs({ properties: { query: { type: 'string' } }, required: ['query'] }, w)).toBeNull()
    expect(searchArgs({ properties: { since: { type: 'string' }, workspace: { type: 'string' } }, required: ['workspace'] }, w)).toBeNull()
  })
})

describe('reading results', () => {
  it('reads structured content, JSON text, or plain text, and nothing from an error', () => {
    expect(resultData({ isError: true, content: [{ type: 'text', text: 'No recording' }] })).toBeNull()
    expect(resultData({ structuredContent: { a: 1 }, content: [] })).toEqual({ a: 1 })
    expect(resultData({ content: [{ type: 'text', text: '{"a":1}' }] })).toEqual({ a: 1 })
    expect(resultData({ content: [{ type: 'text', text: '# Notes' }] })).toEqual({ text: '# Notes' })
  })

  it('reads a meeting: id, title, times, summary and notes', () => {
    expect(readMeeting({ meeting: { meeting_id: 'w1', title: 'Call', start_time: '2026-11-05T10:00:00Z', end_time: '2026-11-05T11:00:00Z', summary: { markdown: 'S' }, content: 'N' } })).toEqual({
      id: 'w1', title: 'Call', start: T, end: T + 60 * M, notes: 'Summary\nS\n\nNotes\nN',
    })
    expect(readMeeting({ id: 7, startTime: T / 1000, notes: 'N' })).toEqual({ id: '7', start: T, notes: 'N' })
    expect(readMeeting({ text: '# Plain notes' })).toEqual({ notes: '# Plain notes' })
    expect(readMeetings({ has_more: false, meetings: [{ meeting_id: 'a' }, { meeting_id: 'b' }] }).map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('matching a search result to the calendar meeting', () => {
  const m = { start: T, title: 'Pesto x Kite Angels' }
  it('needs the start within ±15 min and the title to agree', () => {
    expect(matchMeeting([{ id: 'a', title: 'Kite Angels <> Pesto', start: T + 14 * M, notes: '' }], m)?.id).toBe('a')
    expect(matchMeeting([{ id: 'a', title: 'Pesto x Kite Angels', start: T + 16 * M, notes: '' }], m)).toBeNull()
    expect(matchMeeting([{ id: 'a', title: 'Weekly standup', start: T, notes: '' }], m)).toBeNull()
    expect(matchMeeting([{ id: 'a', title: 'Kite Angels', start: T + 10 * M, notes: '' }, { id: 'b', title: 'Kite Angels call', start: T + 2 * M, notes: '' }], m)?.id).toBe('b')
    expect(matchMeeting([{ id: 'a', start: T, notes: '' }], m)?.id).toBe('a')
  })
})

describe('Settings wording', () => {
  it('cleans the pasted URL', () => {
    expect(cleanUrl(' https://mcp.example.com/connect/mcp/ ')).toBe('https://mcp.example.com/connect/mcp')
    expect(cleanUrl('http://mcp.example.com/mcp')).toBeNull()
    expect(cleanUrl('not a url')).toBeNull()
  })
  it('says when it last fetched', () => {
    const now = T
    expect(fetchedLine({ lastFetch: { at: now - 2 * 60 * M, count: 3 } }, now)).toBe('Last fetched 2 h ago · 3 notes')
    expect(fetchedLine({ lastFetch: { at: now - 5 * M, count: 1 } }, now)).toBe('Last fetched 5 min ago · 1 note')
    expect(fetchedLine({ lastCheckAt: now - 4 * M }, now)).toBe('No notes yet · last checked 4 min ago')
    expect(fetchedLine({}, now)).toBe('No notes yet')
  })
  it('turns the callback result into a toast', () => {
    expect(wisprConnectMessage('ok')).toMatchObject({ tone: 'info' })
    expect(wisprConnectMessage('denied')).toMatchObject({ tone: 'error' })
    expect(wisprConnectMessage(null)).toBeNull()
  })
})
