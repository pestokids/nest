// PST-295: kickoff week, who's ahead and the slow-down rule, can lead and its
// override, the lead steps, and who to update. Every firm and address is made up.
import { describe, expect, it } from 'vitest'
import type { Activity, Investor } from './pipeline'
import {
  askNext, canLeadOf, emailList, kickoff, kickoffHeadline, laneCaption, lastUpdateLine, leadCandidates, leadLine, leadSteps, meetingsPerDay, mergeCanLead,
  nextLeadStep, raceLanes, raceWindow, slowDown, updateGroups, windowEyebrow, type CanLeadValue, type RaceInput,
} from './race'
import type { Phase } from './round'
import type { SyncedMeeting } from './google'
import { STAGES, type Stage } from './stages'

const KICKOFF: Phase = { k: 'kick', name: 'Kickoff', from: '2026-11-18', to: '2026-11-24', targets: [], todo: [] }
const round = { phases: [{ ...KICKOFF, k: 'w1', name: 'Wave 1', from: '2026-11-04', to: '2026-11-17' }, KICKOFF] }

let n = 0
function inv(name: string, stage: Stage, extra: Partial<Investor> = {}): Investor {
  const top = stage === 'passed' || stage === 'parked' ? 'ask' : stage
  return {
    _id: 'i' + n++, name, firm: name, type: 'Seed fund', geo: 'India', warmth: 'intro', path: '', tier: 'A', wave: 1, stage, lead: false,
    nextStep: '', notes: '', source: 'test', maxStage: top as Investor['maxStage'], ...extra,
  }
}
/** Stage moves for one investor: { m1: '2026-11-18', … }. */
const moves = (i: Investor, days: Partial<Record<Stage, string>>): Activity[] =>
  Object.entries(days).map(([stage, date], k) => ({ _id: i._id + 'a' + k, investorId: i._id, kind: 'stage', stage: stage as Stage, date: date! }))
const meeting = (id: string, ids: string[], iso: string): SyncedMeeting =>
  ({ _id: id, eventId: id, title: 'Meeting', start: Date.parse(iso), end: Date.parse(iso) + 36e5, people: [], investorIds: ids }) as unknown as SyncedMeeting

describe('the window: Kickoff phase, else this week', () => {
  it('uses the Kickoff phase’s dates, with its working days and four more bars', () => {
    const w = raceWindow(round, '2026-11-20')
    expect(w).toMatchObject({ kind: 'kickoff', from: '2026-11-18', to: '2026-11-24', day: 3 })
    expect(w.days).toEqual(['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-23', '2026-11-24'])
    expect(w.bars.slice(5)).toEqual(['2026-11-25', '2026-11-26', '2026-11-27'])
    expect(windowEyebrow(w)).toBe('Kickoff week · Wed 18 – Tue 24 Nov · Day 3 of 5')
  })
  it('outside it, the same numbers for the current week, labelled This week', () => {
    const w = raceWindow(round, '2026-11-11')
    expect(w).toMatchObject({ kind: 'week', from: '2026-11-09', to: '2026-11-15', day: 3 })
    expect(windowEyebrow(w)).toBe('This week · Mon 9 – Fri 13 Nov · Day 3 of 5')
    expect(raceWindow({ phases: [] }, '2026-11-30')).toMatchObject({ kind: 'week', from: '2026-11-30' })
  })
})

describe('kickoff-week numbers', () => {
  const ahead = inv('Alder Fund', 'm2')
  const b = inv('Birch Capital', 'm1')
  const c = inv('Cobalt Seed', 'booked', { nextDate: '2026-11-23' })
  const late = inv('Dune Angels', 'booked', { nextDate: '2026-11-27' })
  const offer = inv('Elm Partners', 'verbal')
  const intro = inv('Fig Ventures', 'intro')
  const asked = inv('Gale Capital', 'ask')
  const gone = inv('Heron Fund', 'passed', { maxStage: 'm1' })
  const quiet = inv('Iris Seed', 'todo')
  const investors = [ahead, b, c, late, offer, intro, asked, gone, quiet]
  const acts = [
    ...moves(ahead, { ask: '2026-11-01', intro: '2026-11-16', m1: '2026-11-18', m2: '2026-11-19' }),
    ...moves(b, { intro: '2026-11-16', m1: '2026-11-19' }),
    ...moves(offer, { m1: '2026-11-18', m2: '2026-11-19', dd: '2026-11-19', verbal: '2026-11-20' }),
    ...moves(gone, { m1: '2026-11-10', passed: '2026-11-12' }),
  ]
  const input: RaceInput = { investors, acts, meetings: [meeting('mb', [b._id], '2026-11-19T05:00:00Z'), meeting('mx', ['someone-else'], '2026-11-19T07:00:00Z')], round, today: '2026-11-20', decision: () => undefined }

  it('counts intros, 1st meetings in the window, the race, partner meetings and offers', () => {
    const k = kickoff(input)
    // Intros: made for everyone past Intro, of everyone asked (the passed one included).
    expect(k.intros).toEqual({ out: 7, of: 8 })
    // Alder, Birch and Elm met in the window and Cobalt is booked in it; Dune is booked after it and Heron met before it.
    expect(k.firstMeetings).toBe(4)
    expect(k.inRace).toBe(5)
    expect(k.partnerMeetings).toBe(2)
    expect(k.offers).toBe(1)
    expect(k.headline).toBe('7 of 8 intros are out. Chase the rest today.')
  })

  it('meetings per day: the calendar first, then the stage log and booked meetings it doesn’t have', () => {
    const bars = meetingsPerDay(input, raceWindow(round, '2026-11-20').bars)
    const on = Object.fromEntries(bars.map((x) => [x.day, x.n]))
    // 18: Alder and Elm (1st meetings). 19: Birch on the calendar (its stage move isn't counted again), Alder and Elm (partner). 23: Cobalt booked. 27: Dune booked.
    expect(on).toMatchObject({ '2026-11-18': 2, '2026-11-19': 3, '2026-11-20': 0, '2026-11-23': 1, '2026-11-27': 1 })
    expect(bars.find((x) => x.today)?.day).toBe('2026-11-20')
    expect(bars.filter((x) => x.past).map((x) => x.day)).toEqual(['2026-11-18', '2026-11-19'])
  })

  it('the headline: two offers, intros still out, all out, none yet', () => {
    expect(kickoffHeadline({ intros: { out: 14, of: 14 }, offers: 2 })).toBe('Two offers in the same week. Now pick the lead.')
    expect(kickoffHeadline({ intros: { out: 14, of: 14 }, offers: 0 })).toBe('All 14 intros are out. Keep the meetings packed.')
    expect(kickoffHeadline({ intros: { out: 0, of: 0 }, offers: 0 })).toBe('No intros out yet. Send the asks first.')
  })
})

describe('who’s ahead and the slow-down rule', () => {
  const lanesOf = (investors: Investor[], acts: Activity[] = [], own: Record<string, string> = {}) =>
    raceLanes({ investors, acts, meetings: [], round, today: '2026-11-20', decision: (id) => (own[id] ? { decideBy: own[id], decideByManual: true } : undefined) })

  it('one lane per firm in the race, furthest first, then the soonest decide-by', () => {
    const a = inv('Alder Fund', 'm1')
    const b = inv('Birch Capital', 'm1')
    const c = inv('Cobalt Seed', 'm2')
    const lanes = lanesOf([a, b, c, inv('Done Angels', 'signed'), inv('No Thanks', 'passed')], [...moves(a, { m1: '2026-11-19' }), ...moves(b, { m1: '2026-11-18' })])
    expect(lanes.map((l) => l.investor.name)).toEqual(['Cobalt Seed', 'Birch Capital', 'Alder Fund'])
    expect(lanes.map((l) => l.decideBy)).toEqual([undefined, '2026-11-25', '2026-11-26'])
    expect(lanes.map((l) => l.pos)).toEqual([1.5, 0.5, 0.5])
  })

  it('Dev’s own decide-by date (PST-293) beats 7 days after the 1st meeting', () => {
    const a = inv('Alder Fund', 'm1')
    const lanes = lanesOf([a], moves(a, { m1: '2026-11-18' }), { [a._id]: '2026-12-01' })
    expect(lanes[0].decideBy).toBe('2026-12-01')
  })

  it('a firm a stage ahead of every other, from the partner meeting on, gets the note', () => {
    const lanes = lanesOf([inv('Orchard Capital', 'm2'), inv('Lantern Ventures', 'm1'), inv('Kite Angels', 'm1'), inv('Juniper Seed', 'booked')])
    const s = slowDown(lanes, '2026-11-20')!
    expect(s.leader.investor.name).toBe('Orchard Capital')
    expect(s.behind.map((l) => l.investor.name)).toEqual(['Kite Angels', 'Lantern Ventures'])
    // Three working days after Friday the 20th is Wednesday the 25th.
    expect(s.text).toBe('Orchard is a stage ahead of the rest. Offer diligence on Wednesday, so Kite and Lantern can catch up.')
  })

  it('no note for a tie at the front, a lone 1st meeting, or a race of one', () => {
    expect(slowDown(lanesOf([inv('A', 'm2'), inv('B', 'm2'), inv('C', 'm1')]), '2026-11-20')).toBeNull()
    expect(slowDown(lanesOf([inv('A', 'm1'), inv('B', 'booked')]), '2026-11-20')).toBeNull()
    expect(slowDown(lanesOf([inv('A', 'dd')]), '2026-11-20')).toBeNull()
    expect(slowDown(lanesOf([inv('A', 'verbal'), inv('B', 'm2')]), '2026-11-20')?.text).toBe('A is a stage ahead of the rest. Ask for until Wednesday to confirm it in writing, so B can catch up.')
  })

  it('without a signal, the lane says when it’s booked or what’s next', () => {
    const [l] = lanesOf([inv('A', 'booked', { nextDate: '2026-11-20' })])
    expect(laneCaption(l, '2026-11-20')).toBe('1st meeting today')
    const [m] = lanesOf([inv('B', 'booked', { nextDate: '2026-11-24' })])
    expect(laneCaption(m, '2026-11-20')).toBe('Booked · Tue')
    const [o] = lanesOf([inv('C', 'm1', { nextStep: 'Partner meeting', nextDate: '2026-11-21' })])
    expect(laneCaption(o, '2026-11-20')).toBe('Partner meeting · tomorrow')
  })
})

describe('can lead: enrichment, and Dev’s override always wins', () => {
  type Verdict = { value: CanLeadValue; reason: string }
  const yes: Verdict = { value: 'yes', reason: 'Leads pre-seed rounds' }
  const no: Verdict = { value: 'no', reason: 'Follows a lead' }
  it('Dev’s switch beats everything, then “Can lead or anchor”, then enrichment', () => {
    expect(canLeadOf({ lead: false })).toEqual({ on: false, value: 'unknown', reason: '', from: 'none' })
    expect(canLeadOf({ lead: false, canLead: yes })).toMatchObject({ on: true, from: 'enrichment', reason: 'Leads pre-seed rounds' })
    expect(canLeadOf({ lead: true, canLead: no })).toMatchObject({ on: true, from: 'list' })
    expect(canLeadOf({ lead: false, canLead: yes, leadOverride: false })).toMatchObject({ on: false, value: 'no', from: 'you' })
    expect(canLeadOf({ lead: false, canLead: no, leadOverride: true })).toMatchObject({ on: true, value: 'yes', from: 'you' })
  })
  it('a refresh that couldn’t tell keeps the earlier yes or no', () => {
    const unknown: Verdict = { value: 'unknown', reason: 'Not on their site' }
    expect(mergeCanLead(yes, unknown)).toBe(yes)
    expect(mergeCanLead(yes, no)).toBe(no)
    expect(mergeCanLead(undefined, unknown)).toBe(unknown)
  })
})

describe('the lead steps', () => {
  it('asked to lead → partner meeting → offer → leading', () => {
    const o = inv('Orchard Capital', 'm1')
    expect(leadSteps(o, null)).toEqual({ asked: false, partner: false, offer: false, leading: false })
    expect(nextLeadStep(leadSteps(o, null))).toBe('asked')
    const asked = { ...o, leadAskedOn: '2026-11-19', stage: 'm2' as const, maxStage: 'm2' as const }
    expect(leadSteps(asked, null)).toEqual({ asked: true, partner: true, offer: false, leading: false })
    expect(nextLeadStep(leadSteps(asked, null))).toBe('offer')
    expect(leadLine(asked, null)).toBe('Partner meeting done')
    // Passed after an offer: the steps it reached stay done.
    expect(leadSteps({ ...o, stage: 'passed', maxStage: 'verbal' }, null)).toMatchObject({ partner: true, offer: true })
    expect(leadSteps(o, o._id)).toMatchObject({ asked: true, leading: true })
    expect(leadLine(o, o._id)).toBe('Leading the round')
  })

  it('candidates are firms that can lead, in the race or committed; ask the furthest along first', () => {
    const a = inv('Alder Fund', 'm2', { lead: true, leadAskedOn: '2026-11-19' })
    const b = inv('Birch Capital', 'm2', { canLead: { value: 'yes', reason: '' } })
    const c = inv('Cobalt Seed', 'booked', { leadOverride: true })
    const follows = inv('Dune Angels', 'm2', { canLead: { value: 'no', reason: '' } })
    const notYet = inv('Elm Partners', 'intro', { lead: true })
    const list = leadCandidates([c, follows, notYet, b, a], null)
    expect(list.map((i) => i.name)).toEqual(['Alder Fund', 'Birch Capital', 'Cobalt Seed'])
    expect(askNext(list, null)?.name).toBe('Birch Capital')
    // Once there's a lead, it comes first, and nobody else is asked.
    expect(leadCandidates([a, b, c], c._id)[0].name).toBe('Cobalt Seed')
    expect(askNext(leadCandidates([a, b, c], c._id), c._id)).toBeUndefined()
  })
})

describe('who to update', () => {
  it('four groups, each investor in one, with their emails', () => {
    const racing = inv('Alder Fund', 'm1', { email: 'Ana@Alder.example.com' })
    const booked = inv('Birch Capital', 'booked', { emails: ['team@birch.example.com'] })
    const noEmail = inv('Cobalt Seed', 'dd')
    const offer = inv('Dune Partners', 'verbal', { email: 'kim@dune.example.com' })
    const signed = inv('Elm Angels', 'signed', { email: 'eli@elm.example.com' })
    const maybe = inv('Fig Ventures', 'm2', { email: 'fay@fig.example.com' })
    const metThenPassed = inv('Gale Capital', 'passed', { maxStage: 'm1', email: 'gus@gale.example.com' })
    const warmPass = inv('Heron Fund', 'passed', { warmth: 'warm', email: 'hal@heron.example.com' })
    const coldPass = inv('Iris Seed', 'passed', { warmth: 'cold' })
    const quiet = inv('Juno Angels', 'todo', { email: 'jo@juno.example.com' })
    const all = [racing, booked, noEmail, offer, signed, maybe, metThenPassed, warmPass, coldPass, quiet]

    const groups = updateGroups(all, (i) => i === maybe)
    expect(groups.map((g) => [g.label, g.investors.map((i) => i.name)])).toEqual([
      ['In the race', ['Alder Fund', 'Birch Capital', 'Cobalt Seed']],
      ['Maybes', ['Fig Ventures']],
      ['Committed', ['Dune Partners', 'Elm Angels']],
      ['Passed, but warm', ['Gale Capital', 'Heron Fund']],
    ])
    expect(groups[0].emails).toEqual(['ana@alder.example.com', 'team@birch.example.com'])
    expect(emailList(groups[2].emails)).toBe('kim@dune.example.com, eli@elm.example.com')
  })

  it('says when the last update went out', () => {
    expect(lastUpdateLine('2026-11-04', '2026-11-08')).toBe('Last update: Wed 4 Nov, 4 days ago')
    expect(lastUpdateLine('2026-11-07', '2026-11-08')).toBe('Last update: Sat 7 Nov, yesterday')
    expect(lastUpdateLine('2026-11-08', '2026-11-08')).toBe('Last update: Sun 8 Nov, today')
    expect(lastUpdateLine(null, '2026-11-08')).toBe('No update sent yet')
  })
})

it('every race stage is a pipeline stage', () => {
  expect(STAGES.map((s) => s.k)).toEqual(expect.arrayContaining(['booked', 'm1', 'm2', 'dd', 'verbal']))
})
