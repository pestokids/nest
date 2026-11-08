import { describe, expect, it, vi } from 'vitest'
import { autoMatch, exportCsv, importSummary, parseCsv, previewImport, previewMapped, TEMPLATE_CSV } from './csv'
import { matchScore, rankInvestors, searchNotes, searchSections } from './palette'
import { hitKeys, newlyHit, phaseStatuses, progressLine } from './plan'
import { DEFAULT_ROUND, type Round } from './round'
import { runSave, type FailToast } from './saveAction'
import { closeHint, parseAmount, validateRoundForm } from './settingsForm'
import { groupLog } from './changeLog'
import type { Investor } from './pipeline'

const inv = (o: Partial<Investor> & { name: string }): Investor => ({
  _id: o.name, firm: '', type: 'Angel', geo: 'India', warmth: 'intro', path: '', tier: 'B', wave: 1, stage: 'todo', maxStage: 'todo',
  lead: false, nextStep: '', notes: '', source: '', ...o,
})

describe('CSV column auto-match', () => {
  it('matches exact headers and the usual synonyms, each field once', () => {
    expect(autoMatch(['Name', 'Fund / Company', 'Email', 'Kind', 'Intro via', 'Check size', 'Notes 2'])).toEqual(['name', 'firm', 'email', 'type', 'path', 'expected', null])
    expect(autoMatch(['Investor Name', 'Ticket', 'Warm path', 'nextDate'])).toEqual(['name', 'expected', 'path', 'nextDate'])
  })
  it('prefers an exact header over a synonym, and uses each field once', () => {
    expect(autoMatch(['Comments', 'Notes', 'E-mail'])).toEqual([null, 'notes', 'email'])
  })
  it('imports emails into the email field and checks them', () => {
    const parsed = parseCsv('Name,Email\nAsha,asha@example.com\nBo,mailto:bo@example.org\nCy,not an email\n')
    const p = previewMapped(parsed, autoMatch(parsed.headers), [])
    expect(p.add.map((r) => r.fields.email)).toEqual(['asha@example.com', 'bo@example.org'])
    expect(p.skipped[0].reason).toMatch(/doesn’t look like an email|doesn't look like an email/)
  })
  it('exports the email column', () => {
    const csv = exportCsv([{ ...inv({ name: 'A' }), email: 'a@example.com' }])
    expect(csv.split(/\r?\n/)[0].split(',').at(-1)).toBe('email')
    expect(csv).toContain('a@example.com')
  })
  it('skips columns it can’t place', () => expect(autoMatch(['', 'Favourite colour'])).toEqual([null, null]))
  it('previews with a mapping: duplicates counted, rows without a name skipped, several notes columns joined', () => {
    const parsed = parseCsv('Who,Firm,Comment,Other\nAsha,Alpha,hi,there\nOld,Existing Co,,\n,Nameless,,\n')
    const p = previewMapped(parsed, ['name', 'firm', 'notes', 'notes'], [{ name: 'old', firm: 'existing co' }])
    expect(p.add.map((r) => r.fields.name)).toEqual(['Asha'])
    expect(p.add[0].fields.notes).toBe('Comment: hi\nOther: there')
    expect(p.updates).toBe(1)
    expect(importSummary(p)).toBe('1 new · 1 already in the nest, left as they are · 1 row skipped (no name)')
  })
  it('offers a template that auto-matches completely', () => {
    expect(autoMatch(parseCsv(TEMPLATE_CSV).headers)).not.toContain(null)
  })
  it('keeps the old one-step preview working', () => {
    const p = previewImport('name,firm\nA,B', [])
    expect(p.add).toHaveLength(1)
    expect(p.unknownHeaders).toEqual([])
  })
})

describe('palette search ranking', () => {
  const people = [inv({ name: 'Asha Rao', firm: 'Alpha Fund' }), inv({ name: 'Rao Capital', firm: '' }), inv({ name: 'Brian Ash', firm: 'Orchard' }), inv({ name: 'Ashok', firm: 'Kite' })]
  it('scores exact > prefix > word prefix > substring', () => {
    expect(matchScore('Asha', 'asha')).toBeGreaterThan(matchScore('Asha Rao', 'asha'))
    expect(matchScore('Asha Rao', 'asha')).toBeGreaterThan(matchScore('Brian Ash', 'ash'))
    expect(matchScore('Brian Ash', 'ash')).toBeGreaterThan(matchScore('Kashmir', 'ash'))
    expect(matchScore('Kashmir', 'ash')).toBeGreaterThan(0)
    expect(matchScore('Kite', 'zz')).toBe(0)
  })
  it('ranks names above firms and breaks ties by name', () => {
    expect(rankInvestors(people, 'ash').map((i) => i.name)).toEqual(['Asha Rao', 'Ashok', 'Brian Ash'])
    expect(rankInvestors(people, 'rao').map((i) => i.name)).toEqual(['Rao Capital', 'Asha Rao'])
    expect(rankInvestors(people, 'orch').map((i) => i.name)).toEqual(['Brian Ash'])
    expect(rankInvestors(people, '  ')).toEqual([])
  })
  it('matches every word in any order', () => expect(rankInvestors(people, 'rao as')[0].name).toBe('Asha Rao'))
  it('finds notes and sections', () => {
    const n = searchNotes([inv({ name: 'X', notes: 'Met at the Bangalore meetup last spring' })], 'bangalore', new Set())
    expect(n[0].quote).toContain('Bangalore meetup')
    expect(searchSections('pipe')[0].to).toBe('/raise/pipeline')
  })
})

describe('settings validation rules', () => {
  const today = '2026-11-07'
  const ok: Round = { ...DEFAULT_ROUND, kickoff: '2026-11-01', deadline: '2026-12-04', phases: [{ k: 'a', name: 'Prep', from: '2026-11-01', to: '2026-11-10', targets: [], todo: [] }] }
  it('passes a sound round', () => expect(validateRoundForm(ok, today, ok)).toEqual({}))
  it('room-to can’t be below the target, in the design’s words', () =>
    expect(validateRoundForm({ ...ok, target: 1e6, stretch: 7.5e5 }, today, ok).stretch).toBe('Can’t be below the target of $1M.'))
  it('a new close date must be after today; an unchanged past one is left alone', () => {
    expect(validateRoundForm({ ...ok, deadline: '2026-11-02', kickoff: '2026-10-01' }, today, ok).deadline).toBe('Pick a date after today.')
    expect(validateRoundForm({ ...ok, deadline: today }, today, ok).deadline).toBe('Pick a date after today.')
    const past = { ...ok, deadline: '2026-11-02', kickoff: '2026-10-01', phases: [] }
    expect(validateRoundForm(past, today, past).deadline).toBeUndefined()
  })
  it('keeps the shared rules (phases, target)', () => {
    const e = validateRoundForm({ ...ok, target: NaN, phases: [] }, today, ok)
    expect(e.target).toBe('Enter what you need to close.')
    expect(e.phases).toBeTruthy()
  })
  it('reads amounts the way people type them', () => {
    expect(parseAmount('$1,000,000')).toBe(1e6)
    expect(parseAmount('$10M post')).toBe(10e6)
    expect(parseAmount('250k')).toBe(250000)
    expect(parseAmount('')).toBeUndefined()
    expect(parseAmount('lots')).toBeNaN()
    expect(closeHint('2026-12-05', today)).toBe('28 days from today.')
  })
})

describe('targets hit and missed', () => {
  const today = '2026-11-24'
  const round: Round = {
    ...DEFAULT_ROUND, target: 1e6, stretch: 1.5e6,
    phases: [
      { k: 'prep', name: 'Prep', from: '2026-11-06', to: '2026-11-10', targets: [{ l: 'Names', m: 'count', t: 3 }], todo: [] },
      { k: 'kick', name: 'Kickoff', from: '2026-11-16', to: '2026-11-22', targets: [{ l: 'Asks', m: 'stage:ask', t: 4 }], todo: [] },
      { k: 'push', name: 'Push', from: '2026-11-23', to: '2026-11-29', targets: [{ l: 'Committed', m: 'committed', t: 0.5 }], todo: [] },
      { k: 'close', name: 'Close', from: '2026-11-30', to: '2026-12-04', targets: [{ l: 'Signed', m: 'signed', t: 1 }], todo: [] },
      { k: 'after', name: 'After', from: '2026-12-05', to: '2026-12-09', targets: [], todo: [] },
    ],
  }
  const people = [inv({ name: 'A', stage: 'verbal', expected: 300000 }), inv({ name: 'B', stage: 'ask' }), inv({ name: 'C' })]
  const acts = [1, 2, 3].map((i) => ({ kind: 'stage' as const, stage: 'ask' as const, date: `2026-11-1${i + 5}` }))
  const v = phaseStatuses(round, people, acts, today)
  it('past phases are hit or missed by their first target; now, next and later follow the dates', () => {
    expect(v.map((x) => x.state)).toEqual(['hit', 'missed', 'now', 'next', 'later'])
    expect(progressLine(v[0])).toBe('3 / 3 names · hit')
    expect(progressLine(v[1])).toBe('3 / 4 asks · short by 1')
    expect(progressLine(v[2])).toBe('$300K / $500K · 5 days left')
  })
  it('celebrates a goal only when it flips to hit after the first look, once', () => {
    const before = hitKeys(v)
    expect(newlyHit(null, before, new Set())).toEqual([]) // page load: never
    const after = hitKeys(phaseStatuses(round, [...people, inv({ name: 'D', stage: 'verbal', expected: 300000 })], acts, today))
    expect(newlyHit(before, after, new Set())).toEqual(['push'])
    expect(newlyHit(before, after, new Set(['push']))).toEqual([]) // already celebrated
  })
})

describe('save-failed retry', () => {
  it('plays save-failed and shows an error toast with Retry that runs the same write again', async () => {
    const toasts: FailToast[] = []
    const played: string[] = []
    const deps = { toast: (t: FailToast) => toasts.push(t), play: (n: string) => played.push(n), describe: () => 'Offline.' }
    const fn = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(7)
    const onDone = vi.fn()
    expect(await runSave(fn, { failMessage: 'Couldn’t save.', onDone }, deps)).toBeUndefined()
    expect(played).toEqual(['save-failed'])
    expect(toasts[0]).toMatchObject({ tone: 'error', message: 'Couldn’t save. Offline.', action: { label: 'Retry' } })
    toasts[0].action.onClick()
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith(7))
    expect(fn).toHaveBeenCalledTimes(2)
    expect(toasts).toHaveLength(1)
  })
  it('lets the caller handle field errors without a toast', async () => {
    const toast = vi.fn()
    const play = vi.fn()
    await runSave(() => Promise.reject({ data: { errors: { target: 'x' } } }), { onError: () => true }, { toast, play, describe: () => '' })
    expect(toast).not.toHaveBeenCalled()
    expect(play).not.toHaveBeenCalled()
  })
})

describe('change log', () => {
  it('groups one save into one event and words it', () => {
    const rows = [
      { _id: '1', at: 10, by: 'Dev', field: 'deadline', from: '2030-01-29', to: '2030-02-01' },
      { _id: '2', at: 10, by: 'Dev', field: 'stretch', from: '1250000', to: '1500000' },
      { _id: '3', at: 5, by: 'Sam', field: 'import', from: '', to: '12 investors from a.csv' },
    ]
    const e = groupLog(rows)
    expect(e).toHaveLength(2)
    expect(e[0].lines).toEqual(['Close date moved from Tue 29 Jan to Fri 1 Feb', 'Room to raised from $1.3M to $1.5M'])
    expect(e[1].lines).toEqual(['Imported 12 investors from a.csv'])
  })
})
