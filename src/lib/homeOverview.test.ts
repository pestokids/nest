import { describe, expect, it } from 'vitest'
import { raiseStats, thisWeek, weekDay, workingDays } from './home'
import type { SyncedMeeting } from './google'
import { NEW_INVESTOR, type Investor } from './pipeline'
import type { Phase } from './round'

// Made-up investors only. 2030-01-02 is a Wednesday; IST is UTC+5:30.
let n = 0
const inv = (o: Partial<Investor>): Investor => ({ ...NEW_INVESTOR, _id: `i${n++}`, maxStage: 'todo', ...o }) as Investor
const meeting = (o: Partial<SyncedMeeting>): SyncedMeeting => ({ _id: 'm' + n++, eventId: 'e' + n, title: 'Pesto x Fund', start: 0, end: 0, people: [], investorIds: [], by: 'Dev', mine: true, ...o })
const at = (iso: string) => Date.parse(iso + '+05:30')

describe('Raise card counts (PST-289)', () => {
  it('counts who you’re talking to and intros out separately', () => {
    const s = raiseStats([{ stage: 'ask' }, { stage: 'ask' }, { stage: 'intro' }, { stage: 'm1' }, { stage: 'verbal' }, { stage: 'todo' }, { stage: 'passed' }, { stage: 'wired' }])
    expect(s).toEqual({ inConversation: 3, introsOut: 2 })
  })
})

describe('this week (PST-289)', () => {
  it('takes the next five working days, skipping weekends', () => {
    expect(workingDays('2030-01-02')).toEqual(['2030-01-02', '2030-01-03', '2030-01-04', '2030-01-07', '2030-01-08'])
    expect(workingDays('2030-01-05')).toEqual(['2030-01-07', '2030-01-08', '2030-01-09', '2030-01-10', '2030-01-11'])
    expect(weekDay('2030-01-02')).toBe('Wed 2')
  })

  const juniper = inv({ name: 'Juniper Seed', stage: 'booked', nextStep: '1st meeting', nextDate: '2030-01-02' })
  const lantern = inv({ name: 'Lantern', stage: 'm1', nextStep: 'Partner meeting', nextDate: '2030-01-03' })
  const harbor = inv({ name: 'Harbor Light', stage: 'intro', nextStep: '', nextDate: '2030-01-07' })
  const passed = inv({ name: 'Fernhill Fund', stage: 'passed', nextStep: 'Nothing', nextDate: '2030-01-03' })
  const phases: Phase[] = [{ k: 'kick', name: 'Kickoff week', from: '2029-12-30', to: '2030-01-04', targets: [], todo: [] }, { k: 'w1', name: 'Wave 1', from: '2030-01-07', to: '2030-01-20', targets: [], todo: [] }]

  it('puts meetings, dated next steps and phase dates on their days', () => {
    const week = thisWeek({
      investors: [juniper, lantern, harbor, passed],
      meetings: [
        meeting({ start: at('2030-01-02T15:30:00'), investorIds: [juniper._id] }),
        meeting({ start: at('2030-01-02T10:00:00'), investorIds: [] }),
        meeting({ start: at('2030-01-08T11:00:00'), investorIds: [harbor._id] }),
      ],
      phases,
      today: '2030-01-02',
    })
    expect(week.map((d) => [d.day, d.today, d.items.map((x) => x.text)])).toEqual([
      ['2030-01-02', true, ['Juniper Seed · 15:30']],
      ['2030-01-03', false, ['Lantern · Partner meeting']],
      ['2030-01-04', false, ['Kickoff week ends']],
      ['2030-01-07', false, ['Harbor Light · next step', 'Wave 1 starts']],
      ['2030-01-08', false, ['Harbor Light · 11:00']],
    ])
  })

  it('shows the same meeting once when two calendars have it', () => {
    const m = { eventId: 'same', start: at('2030-01-03T09:00:00'), investorIds: [lantern._id] }
    const week = thisWeek({ investors: [lantern], meetings: [meeting({ ...m }), meeting({ ...m, mine: false })], phases: [], today: '2030-01-02' })
    expect(week[1].items.map((x) => x.text)).toEqual(['Lantern · 09:00'])
  })

  it('is five empty days with nothing dated', () => {
    const week = thisWeek({ investors: [], meetings: [], phases: [], today: '2030-01-02' })
    expect(week).toHaveLength(5)
    expect(week.every((d) => d.items.length === 0)).toBe(true)
  })
})
