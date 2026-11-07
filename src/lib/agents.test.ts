// PST-276: the pure parts of the Nest MCP server: argument checks, amounts, which tools a key gets, keys, and how a key reads in Settings.
import { describe, expect, it } from 'vitest'
import { AGENT_TOOLS, agentInitials, callLabel, checkArgs, isToolCall, keyMeta, lastUsedLine, nestSkill, parseAmount, PROD_MCP_URL, toolNamed, toolsFor } from './agents'
import { bearerKey, newKey, sha256Hex } from '../../convex/lib/agentKey'
import { dayOf } from './google'

const tool = (name: string) => toolNamed(name)!

describe('toolsFor', () => {
  it('read keys get the four read tools; suggest keys get all of them', () => {
    expect(toolsFor('read').map((t) => t.name)).toEqual(['search_investors', 'get_investor', 'todays_moves', 'list_questions'])
    expect(toolsFor('suggest')).toEqual(AGENT_TOOLS)
    expect(AGENT_TOOLS.filter((t) => t.scope === 'suggest').map((t) => t.name)).toEqual(['log_touch', 'add_investor', 'suggest_change', 'enrich', 'add_meeting_notes'])
  })
})

describe('checkArgs', () => {
  it('trims strings and drops empty optional arguments', () => {
    expect(checkArgs(tool('search_investors'), { query: '  kite ', stage: null, wave: undefined })).toEqual({ ok: true, value: { query: 'kite' } })
    expect(checkArgs(tool('todays_moves'), undefined)).toEqual({ ok: true, value: {} })
    expect(checkArgs(tool('add_investor'), { name: 'Orchard', firm: '' })).toEqual({ ok: true, value: { name: 'Orchard', firm: '' } })
  })

  it('names the first argument that is wrong', () => {
    const touch = tool('log_touch')
    const good = { investorId: 'abc', kind: 'call', date: '2026-11-01', note: 'Called.' }
    expect(checkArgs(touch, good).ok).toBe(true)
    expect(checkArgs(touch, [])).toEqual({ ok: false, error: 'arguments must be an object' })
    expect(checkArgs(touch, { ...good, extra: 1 })).toEqual({ ok: false, error: 'there’s no argument called “extra”' })
    expect(checkArgs(touch, { ...good, note: undefined })).toEqual({ ok: false, error: 'note is required' })
    expect(checkArgs(touch, { ...good, note: '   ' })).toEqual({ ok: false, error: 'note can’t be empty' })
    expect(checkArgs(touch, { ...good, note: 'x'.repeat(501) })).toEqual({ ok: false, error: 'note is longer than 500 characters' })
    expect(checkArgs(touch, { ...good, date: '1 Nov' })).toEqual({ ok: false, error: 'date must be a date like 2026-11-07' })
    expect(checkArgs(touch, { ...good, date: '2026-02-30' }).ok).toBe(false)
    expect(checkArgs(touch, { ...good, kind: 'fax' })).toEqual({ ok: false, error: 'kind must be one of: call, email, meeting, note' })
    expect(checkArgs(touch, { ...good, investorId: 7 })).toEqual({ ok: false, error: 'investorId must be a string' })
    expect(checkArgs(tool('search_investors'), { wave: 1.5 })).toEqual({ ok: false, error: 'wave must be a whole number' })
    expect(checkArgs(tool('search_investors'), { wave: 4 }).ok).toBe(false)
    expect(checkArgs(tool('add_investor'), { name: 'A', firm: '', email: 'not-an-email' })).toEqual({ ok: false, error: 'email must be an email address' })
    expect(checkArgs(tool('suggest_change'), { investorId: 'a', kind: 'expected', value: 50000, why: 'Said so.' }).ok).toBe(true)
    expect(checkArgs(tool('suggest_change'), { investorId: 'a', kind: 'expected', value: true, why: 'Said so.' })).toEqual({ ok: false, error: 'value must be string or number' })
  })
})

describe('parseAmount', () => {
  it('reads the ways people write an amount', () => {
    expect(parseAmount(50000)).toBe(50000)
    expect(parseAmount('50000')).toBe(50000)
    expect(parseAmount('$50,000')).toBe(50000)
    expect(parseAmount('50K')).toBe(50000)
    expect(parseAmount('1.2M')).toBe(1200000)
  })
  it('refuses anything else', () => {
    for (const x of [0, -5, NaN, 'lots', '50 lakh', '', '$', '1e20']) expect(parseAmount(x)).toBeNull()
  })
})

describe('keys', () => {
  it('nest_ak_ and 43 base64url characters; the prefix is the next 8', () => {
    const a = newKey()
    const b = newKey()
    expect(a.key).toMatch(/^nest_ak_[A-Za-z0-9_-]{43}$/)
    expect(a.prefix).toBe(a.key.slice(8, 16))
    expect(a.key).not.toBe(b.key)
  })
  it('hashes with SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('only takes a Bearer nest_ak_ key', () => {
    expect(bearerKey('Bearer nest_ak_abc')).toBe('nest_ak_abc')
    expect(bearerKey('bearer   nest_ak_abc ')).toBe('nest_ak_abc')
    expect(bearerKey(null)).toBeNull()
    expect(bearerKey('nest_ak_abc')).toBeNull()
    expect(bearerKey('Bearer sk-abc')).toBeNull()
    expect(bearerKey('Basic nest_ak_abc')).toBeNull()
    expect(bearerKey('Bearer nest_ak_' + 'x'.repeat(100))).toBeNull()
  })
})

describe('how a key reads in Settings', () => {
  const now = Date.parse('2026-11-07T12:00:00+05:30')
  it('last used', () => {
    expect(lastUsedLine(undefined, now, dayOf)).toBe('Never used')
    expect(lastUsedLine(now - 20_000, now, dayOf)).toBe('Used just now')
    expect(lastUsedLine(now - 12 * 6e4, now, dayOf)).toBe('Used 12 min ago')
    expect(lastUsedLine(now - 3 * 36e5, now, dayOf)).toBe('Used 3h ago')
    expect(lastUsedLine(now - 20 * 36e5, now, dayOf)).toBe('Used yesterday')
    expect(lastUsedLine(Date.parse('2026-11-02T10:00:00+05:30'), now, dayOf)).toBe('Used Nov 2')
  })
  it('with the calls this week', () => {
    expect(keyMeta({ lastUsedAt: now - 12 * 6e4, calls7d: 41 }, now, dayOf)).toBe('Used 12 min ago · 41 calls this week')
    expect(keyMeta({ lastUsedAt: now - 12 * 6e4, calls7d: 1 }, now, dayOf)).toBe('Used 12 min ago · 1 call this week')
    expect(keyMeta({ calls7d: 0 }, now, dayOf)).toBe('Never used')
  })
  it('initials', () => {
    expect(['Grok Bot', 'Claude', 'Capy', 'ai', '  '].map(agentInitials)).toEqual(['GB', 'CL', 'CP', 'AI', '?'])
  })
  it('Activity labels; only tool calls count', () => {
    expect(callLabel('log_touch')).toBe('Suggested a touch')
    expect(callLabel('unknown')).toBe('Sent something Nest didn’t understand')
    expect(callLabel('')).toBe('Didn’t finish')
    expect(isToolCall('search_investors')).toBe(true)
    expect(isToolCall('tools/list')).toBe(false)
  })
  it('the skill names the server and every tool', () => {
    const md = nestSkill()
    expect(md).toContain(PROD_MCP_URL)
    for (const t of AGENT_TOOLS) expect(md).toContain(t.name)
  })
})
