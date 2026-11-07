// DEV ONLY: a made-up month of history for Plan › Insights (PST-284),
// ?preview&insights=default|behind. Invented investors and amounts; dates follow
// today. default is on track, behind is the same round with one verbal still in
// diligence. &insights=empty is the plain fixture (too little history).
import type { Activity, Investor } from '../lib/pipeline'
import type { Round } from '../lib/round'
import { IDX, type PipelineStage, type Stage } from '../lib/stages'
import { addDays } from '../lib/today'
import { fixtureRound } from './fixture'

export const PREVIEW_INSIGHTS = ['default', 'behind', 'empty'] as const
export type PreviewInsights = (typeof PREVIEW_INSIGHTS)[number]

type Spec = [name: string, type: Investor['type'], warmth: Investor['warmth'], path: string, expected: number, history: string]

/** History as "ask 30 intro 27 m1 20": each stage and how many days ago it moved there. */
const SPECS: Spec[] = [
  ['Juniper Seed', 'Seed fund', 'intro', 'Mira', 200000, 'ask 34 intro 31 booked 28 m1 25 m2 21 dd 19 verbal 16'],
  ['Bluebird Seed', 'Pre-seed fund', 'intro', 'Ankur', 150000, 'ask 33 intro 30 booked 27 m1 24 m2 20 dd 17 verbal 13 signed 9'],
  ['Tidewater Angels', 'Angel', 'warm', 'Direct', 50000, 'ask 30 intro 29 booked 26 m1 22 m2 17 dd 14 verbal 11'],
  ['Cedar Collective', 'Large angel', 'intro', 'Mira', 100000, 'ask 29 intro 26 booked 23 m1 20 m2 15 dd 12 verbal 9'],
  ['Willow Street', 'Angel', 'intro', 'Ria', 50000, 'ask 27 intro 25 booked 22 m1 19 m2 13 dd 11 verbal 8'],
  ['Morrow Ventures', 'Seed fund', 'intro', 'Ria', 100000, 'ask 28 intro 25 booked 21 m1 17 m2 11 dd 7 verbal 3'],
  ['Saltmarsh Angels', 'Angel', 'intro', 'Ria', 50000, 'ask 26 intro 23 booked 20 m1 16 m2 10 dd 6 verbal 2'],
  ['Kite Angels', 'Angel', 'warm', 'Ankur (ex-colleague)', 25000, 'ask 20 intro 18 booked 15 m1 11 m2 4'],
  ['Fernhill Fund', 'Seed fund', 'intro', 'Mira', 150000, 'ask 24 intro 21 booked 18 m1 14 m2 9 dd 5'],
  ['Orchard Capital', 'Pre-seed fund', 'warm', 'Ria', 100000, 'ask 27 intro 24 booked 21 m1 18'],
  ['Lantern Ventures', 'Micro-VC', 'intro', 'Ankur', 75000, 'ask 30 intro 27 booked 24 m1 20 passed 8'],
  ['Northwind Accelerator', 'Accelerator', 'cold', 'Applied', 125000, 'ask 29 intro 22 booked 17 m1 12'],
  ['Quill Capital', 'Multi-stage VC', 'cold', 'cold', 250000, 'ask 31 intro 26 booked 22 m1 19 passed 10'],
  ['Pebble Partners', 'Micro-VC', 'cold', 'cold', 50000, 'ask 31 passed 20'],
  ['Harbor Light', 'Accelerator', 'intro', '', 125000, ''],
  ['Copperleaf', 'Seed fund', 'intro', 'Ria', 150000, 'ask 22 intro 19 booked 14 m1 9'],
  ['Rowan Operator', 'Angel', 'warm', 'Ria', 25000, 'ask 19 intro 16 booked 10 m1 6'],
  ['Saffron Seed', 'Pre-seed fund', 'warm', 'Mira', 250000, 'ask 14 intro 9 booked 3'],
  ['Ember Ventures', 'Micro-VC', 'intro', 'Ria', 75000, 'ask 12 intro 5'],
  ['Granite Hill', 'Multi-stage VC', 'cold', 'Applied', 250000, 'ask 10'],
  ['Linden Seed', 'Pre-seed fund', 'intro', 'Mira', 80000, 'ask 4'],
  ['Kestrel Partners', 'Micro-VC', 'intro', 'Ria', 60000, 'ask 2'],
  ['Amber Lane Angels', 'Angel', 'warm', 'Ria', 25000, 'ask 6 intro 3'],
  ['Indigo Angels', 'Large angel', 'cold', 'Applied', 50000, 'ask 18 passed 9'],
  ['Opal Fund', 'Seed fund', 'cold', 'cold', 100000, 'ask 21 parked 12'],
  ['Driftwood Angels', 'Angel', 'intro', 'Mira', 20000, ''],
  ['Thistle Capital', 'Seed fund', 'cold', '', 150000, ''],
  ['Birchwood Capital', 'Seed fund', 'intro', 'Ankur', 150000, 'ask 17 intro 13 booked 8 m1 3'],
]

const NEXT: Partial<Record<Stage, string>> = {
  ask: 'Nudge for the intro', intro: 'Book the first call', booked: 'Send the deck before the call', m1: 'Send the follow-up', m2: 'Open the data room',
  dd: 'Ask for a number', verbal: 'Send the SAFE', signed: 'Chase the wire',
}

export function fixtureInsights(today: string, state: 'default' | 'behind'): { round: Round; investors: Investor[]; acts: Activity[] } {
  const d = (n: number) => addDays(today, n)
  const base = fixtureRound(today)
  const round: Round = {
    ...base,
    kickoff: d(-35),
    deadline: d(28),
    phases: [
      { ...base.phases[0], from: d(-35), to: d(-29) },
      { ...base.phases[1], from: d(-28), to: d(-15) },
      { ...base.phases[2], from: d(-14), to: d(0) },
      { ...base.phases[3], from: d(1), to: d(21) },
      { ...base.phases[4], from: d(22), to: d(28) },
    ],
  }
  const investors: Investor[] = []
  const acts: Activity[] = []
  SPECS.forEach(([name, type, warmth, path, expected, history], k) => {
    const _id = 'fi' + k
    let moves = history ? history.split(' ').reduce<[Stage, number][]>((xs, w, j, all) => (j % 2 ? xs : [...xs, [w as Stage, Number(all[j + 1])]]), []) : []
    // behind: Saltmarsh Angels' verbal hasn't come yet.
    if (state === 'behind' && name === 'Saltmarsh Angels') moves = moves.filter(([s]) => s !== 'verbal')
    const stage: Stage = moves.length ? moves[moves.length - 1][0] : 'todo'
    const reached = moves.map(([s]) => s).filter((s): s is PipelineStage => IDX[s] !== undefined)
    const last = moves.length ? d(-moves[moves.length - 1][1]) : undefined
    moves.forEach(([s, ago], j) => acts.push({ _id: `${_id}a${j}`, investorId: _id, kind: 'stage', stage: s, date: d(-ago), by: 'Dev', _creationTime: Date.parse(d(-ago) + 'T06:00:00Z') + j }))
    investors.push({
      _id, name, firm: name, type, geo: 'India', warmth, path, tier: 'B', wave: k < 10 ? 1 : k < 20 ? 2 : 3, lead: false, notes: '', source: 'Preview fixture',
      stage, maxStage: reached[reached.length - 1] ?? 'todo', expected, lastTouch: last,
      nextStep: NEXT[stage] ?? '', nextDate: NEXT[stage] ? d(2 + (k % 5)) : undefined,
      _creationTime: Date.parse(d(-36) + 'T06:00:00Z'),
    })
  })
  return { round, investors, acts: acts.sort((a, b) => b.date.localeCompare(a.date)) }
}
