// DEV ONLY: a made-up kickoff week for Pipeline › Race (PST-295), for
// ?preview&pipeline=race|race-lead|update and &home=race. Every firm, address
// and reason is invented; dates follow today, which is day 3 of the Kickoff phase.
//   race       seven firms in the race, Orchard a stage ahead ("slow down"), no lead yet
//   race-lead  Orchard and Lantern made offers the same week (the lime card) and Orchard is leading
//   update     the race, scrolled to Who to update
import type { Activity, Investor } from '../lib/pipeline'
import type { LastUpdate } from '../components/race/data'
import type { LeadFields } from '../lib/race'
import type { Round } from '../lib/round'
import { STAGES, type Stage } from '../lib/stages'
import { fixtureRound } from './fixture'

export const PREVIEW_RACE = ['race', 'race-lead', 'update', 'home'] as const
export type PreviewRace = (typeof PREVIEW_RACE)[number]

const add = (iso: string, days: number) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10)

type Row = Partial<Investor> & Pick<Investor, 'name' | 'stage'> & { moved?: Partial<Record<Stage, number>> }

export function fixtureRace(today: string, lead: boolean): { investors: Investor[]; round: Round; acts: Activity[] } {
  const d = (n: number) => add(today, n)
  const can = (value: 'yes' | 'no', reason: string): LeadFields => ({ canLead: { value, reason, at: Date.parse(d(-5) + 'T06:00:00Z') } })
  const rows: Row[] = [
    {
      name: 'Orchard Capital', type: 'Seed fund', warmth: 'warm', stage: lead ? 'verbal' : 'm2', email: 'maya@orchard.example.com', expected: 300000,
      nextStep: lead ? 'Confirm the terms in writing' : 'Share the data room', nextDate: d(1), ...can('yes', 'Leads pre-seed rounds of $500K–$1M'),
      ...(lead ? { leadAskedOn: d(-1) } : {}), moved: { m1: -2, m2: -1, ...(lead ? { dd: 0, verbal: 0 } : {}) },
    },
    {
      name: 'Lantern Ventures', type: 'Micro-VC', warmth: 'intro', stage: lead ? 'verbal' : 'm1', email: 'lee@lantern.example.com', expected: 150000,
      nextStep: lead ? 'Send the SAFE' : 'Partner meeting', nextDate: d(1), ...can('yes', 'Has led two pre-seed rounds this year'), moved: { m1: -1, ...(lead ? { m2: 0, verbal: 0 } : {}) },
    },
    { name: 'Kite Angels', type: 'Angel', warmth: 'warm', stage: 'm1', expected: 25000, nextStep: 'Send week-8 retention', nextDate: d(2), ...can('no', 'Follows a lead; checks of $25K–$50K'), moved: { m1: -1 } },
    { name: 'Tamarind Capital', type: 'Pre-seed fund', warmth: 'intro', stage: 'm1', lead: true, email: 'ana@tamarind.example.com', expected: 200000, nextStep: 'Review the note updates', nextDate: d(0), moved: { m1: 0 } },
    { name: 'Juniper Seed', type: 'Seed fund', warmth: 'intro', stage: 'booked', email: 'kai@juniper.example.com', expected: 50000, nextStep: '1st meeting', nextDate: d(0), ...can('no', 'Only follows at pre-seed'), moved: { booked: -2 } },
    { name: 'Harbor Light', type: 'Accelerator', warmth: 'intro', stage: 'booked', email: 'team@harborlight.example.com', expected: 125000, nextStep: '1st meeting', nextDate: d(1), moved: { booked: -2 } },
    { name: 'Morrow Ventures', type: 'Seed fund', warmth: 'intro', stage: 'booked', email: 'ivy@morrow.example.com', expected: 250000, nextStep: '1st meeting', nextDate: d(2), ...can('yes', 'Leads seed rounds, sometimes pre-seed'), moved: { booked: -2 } },
    { name: 'Willow Street', type: 'Angel', warmth: 'existing', stage: 'signed', email: 'rob@willow.example.com', committed: 25000, nextStep: 'Wire', nextDate: d(3) },
    { name: 'Bluebird Seed', type: 'Pre-seed fund', warmth: 'warm', stage: 'wired', email: 'deals@bluebird.example.com', committed: 100000, nextStep: '' },
    { name: 'Cedar Collective', type: 'Large angel', warmth: 'warm', stage: 'signed', email: 'nia@cedar.example.com', committed: 50000, nextStep: 'Wire', nextDate: d(4) },
    { name: 'Pebble Partners', type: 'Micro-VC', warmth: 'intro', stage: 'passed', maxStage: 'm1', email: 'hello@pebble.example.com', nextStep: '' },
    { name: 'Saltmarsh Angels', type: 'Angel', warmth: 'warm', stage: 'intro', email: 'jo@saltmarsh.example.com', nextStep: '' },
    { name: 'Northwind Accelerator', type: 'Accelerator', warmth: 'cold', stage: 'intro', email: 'apply@northwind.example.com', nextStep: '' },
    { name: 'Fernhill Fund', type: 'Seed fund', warmth: 'intro', stage: 'intro', email: 'ola@fernhill.example.com', nextStep: 'Book a first call', nextDate: d(1) },
    { name: 'Tidewater Angels', type: 'Angel', warmth: 'warm', stage: 'intro', nextStep: 'Book a first call', nextDate: d(2) },
    { name: 'Quill Capital', type: 'Multi-stage VC', warmth: 'cold', stage: 'todo', nextStep: '' },
  ]
  const investors = rows.map(({ moved: _, ...r }, k) => ({
    _id: `fxr${k}`, firm: r.name, geo: 'India', path: '', tier: 'A', wave: 1, lead: false, notes: '', source: 'Preview fixture', lastTouch: d(-1),
    maxStage: (r.stage === 'passed' || r.stage === 'parked' ? 'ask' : r.stage) as Investor['maxStage'], _creationTime: Date.parse(d(-30) + 'T06:00:00Z'),
    ...r,
  })) as Investor[]

  // Asked three weeks ago, intros on the Monday of kickoff, then each move on its day.
  const acts: Activity[] = []
  rows.forEach((r, k) => {
    const id = investors[k]._id
    const top = STAGES.findIndex((s) => s.k === investors[k].maxStage)
    for (let s = 1; s <= top; s++) {
      const stage = STAGES[s].k
      const day = r.moved?.[stage] ?? (stage === 'ask' ? -21 : stage === 'intro' ? -2 : s - top - 3)
      acts.push({ _id: `far${k}-${s}`, investorId: id, kind: 'stage', stage, date: d(day), by: 'Dev' })
    }
    if (r.stage === 'passed') acts.push({ _id: `far${k}-x`, investorId: id, kind: 'stage', stage: 'passed', date: d(-3), by: 'Dev' })
  })

  const base = fixtureRound(today)
  const round: Round = {
    ...base,
    kickoff: d(-30),
    phases: [
      { ...base.phases[0], from: d(-30), to: d(-16) },
      { ...base.phases[1], from: d(-15), to: d(-3) },
      { ...base.phases[2], from: d(-2), to: d(4) },
      { ...base.phases[3], from: d(5), to: d(20) },
      { ...base.phases[4], from: d(21), to: d(28) },
    ],
  }
  return { investors, round, acts: acts.sort((a, b) => b.date.localeCompare(a.date)) }
}

/** The preview store's start: the lead (race-lead) and the last update, four days ago. */
export function previewRaceStart(state: PreviewRace | null, investors: readonly Investor[], today: string): { leadId: string | null; updates: LastUpdate[]; patches: Record<string, never> } {
  const orchard = investors.find((i) => i.name === 'Orchard Capital')
  return {
    leadId: state === 'race-lead' && orchard ? orchard._id : null,
    updates: state ? [{ id: 'pu0', sentOn: add(today, -4), count: 14, by: 'Dev' }] : [],
    patches: {},
  }
}
