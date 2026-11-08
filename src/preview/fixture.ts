// DEV ONLY: a small made-up round for ?preview and screenshots. No real
// investors, amounts or dates: names are invented and dates follow today.
import { dayDiff } from '../lib/dates'
import type { Activity, Investor } from '../lib/pipeline'
import { DEFAULT_ODDS, type Round } from '../lib/round'
import { STAGES } from '../lib/stages'
import { FIXTURE_ADDRESSES } from './googleFixture'

const add = (iso: string, days: number) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10)

export function fixtureRound(today: string): Round {
  const d = (n: number) => add(today, n)
  return {
    target: 1200000,
    stretch: 1500000,
    deadline: d(28),
    kickoff: d(-3),
    instrument: 'post-money SAFE',
    phases: [
      {
        k: 'prep', name: 'Prep', from: d(-3), to: d(4),
        targets: [{ l: 'Names on the list', m: 'count', t: 150 }, { l: 'With a warm path', m: 'pathed', t: 100 }],
        todo: ['Pitch deck ready', 'Data room set up', 'Company documents in order', 'Terms agreed with the team', 'A short intro blurb for connectors'],
      },
      { k: 'w1', name: 'Wave 1', from: d(5), to: d(9), targets: [{ l: 'Intro asks sent', m: 'stage:ask', t: 20 }], todo: ['Send the first asks'] },
      { k: 'kick', name: 'Kickoff', from: d(10), to: d(16), targets: [{ l: '1st meetings', m: 'stage:m1', t: 12 }], todo: ['Start first meetings'] },
      { k: 'push', name: 'Push', from: d(17), to: d(24), targets: [{ l: 'Committed', m: 'committed', t: 0.6 }], todo: ['Follow up with every open conversation'] },
      { k: 'close', name: 'Close', from: d(25), to: d(28), targets: [{ l: 'SAFEs signed', m: 'signed', t: 1 }], todo: ['Collect signatures'] },
    ],
    odds: DEFAULT_ODDS,
    quietDays: 4,
    waves: ['Wave 1', 'Wave 2', 'Wave 3'],
  }
}

type Row = Partial<Investor> & Pick<Investor, 'name' | 'stage'>

export function fixtureInvestors(today: string): Investor[] {
  const d = (n: number) => add(today, n)
  const rows: Row[] = [
    { name: 'Orchard Capital', firm: 'Orchard Capital', type: 'Pre-seed fund', warmth: 'warm', path: 'Ria', stage: 'm1', expected: 100000, nextStep: 'Share the data room', nextDate: d(5), lastTouch: d(-2), wave: 1 },
    { name: 'Lantern Ventures', firm: 'Lantern Ventures', type: 'Micro-VC', warmth: 'intro', path: 'Ankur', stage: 'intro', expected: 75000, nextStep: 'Book a first call', nextDate: d(12), lastTouch: d(-1), wave: 1 },
    { name: 'Fernhill Fund', firm: 'Fernhill', type: 'Seed fund', warmth: 'intro', path: 'Mira', stage: 'ask', expected: 150000, nextStep: 'Awaiting a partner intro', lastTouch: d(-6), wave: 1 },
    {
      name: 'Kite Angels', firm: 'Kite Angels', type: 'Angel', warmth: 'warm', path: 'Ankur (ex-colleague)', stage: 'booked', expected: 25000,
      nextStep: 'Send the deck and the 60-second clip', nextDate: d(0), lastTouch: d(-2), wave: 1,
      notes: 'Likes consumer and kids. Asked about week-4 retention and whether parents pay. Send the beta numbers with the deck.',
    },
    { name: 'Juniper Seed', firm: 'Juniper', type: 'Seed fund', warmth: 'intro', path: 'Mira', stage: 'ask', expected: 50000, nextStep: 'Intro to a partner at Juniper', nextDate: d(0), lastTouch: d(-1), wave: 1 },
    { name: 'Saltmarsh Angels', firm: 'Saltmarsh', type: 'Angel', warmth: 'intro', path: 'Ria', stage: 'ask', expected: 30000, nextStep: 'Awaiting decision', lastTouch: d(-5), wave: 1 },
    // PST-302: an application awaiting a decision (the warm path still says "Applied", as older records do).
    { name: 'Northwind Accelerator', firm: 'Northwind', type: 'Accelerator', warmth: 'cold', path: 'Applied', stage: 'ask', expected: 125000, nextStep: '', lastTouch: d(-7), wave: 1, application: { status: 'submitted', program: 'C12', submittedOn: d(-7), decisionBy: d(19) } },
    { name: 'Pebble Partners', firm: 'Pebble', type: 'Micro-VC', warmth: 'cold', path: 'cold', stage: 'passed', expected: 50000, nextStep: '', lastTouch: d(-8), wave: 2 },
    { name: 'Morrow Ventures', firm: 'Morrow', type: 'Seed fund', warmth: 'intro', path: 'Ria', stage: 'todo', expected: 200000, nextStep: '', wave: 1 },
    { name: 'Bluebird Seed', firm: 'Bluebird', type: 'Pre-seed fund', warmth: 'intro', path: 'Ankur', stage: 'todo', expected: 100000, nextStep: '', wave: 1 },
    { name: 'Quill Capital', firm: 'Quill', type: 'Multi-stage VC', warmth: 'cold', path: '', stage: 'todo', expected: 250000, nextStep: '', wave: 2 },
    { name: 'Tidewater Angels', firm: 'Tidewater', type: 'Angel', warmth: 'warm', path: 'Direct', stage: 'todo', expected: 20000, nextStep: '', wave: 1 },
    { name: 'Cedar Collective', firm: 'Cedar', type: 'Large angel', warmth: 'intro', path: 'Mira', stage: 'todo', expected: 50000, nextStep: '', wave: 2 },
    // PST-302: its decision date has passed, and Dev's own next step is a separate row with its own date.
    { name: 'Harbor Light', firm: 'Harbor Light', type: 'Accelerator', warmth: 'intro', path: '', stage: 'todo', expected: 125000, nextStep: 'Email the partners a progress update', nextDate: d(0), wave: 3, application: { status: 'submitted', program: 'Autumn', submittedOn: d(-20), decisionBy: d(-2) } },
    { name: 'Willow Street', firm: 'Willow Street', type: 'Angel', warmth: 'intro', path: 'Ria', stage: 'todo', expected: 25000, nextStep: '', wave: 1 },
  ]
  return rows.map((r, i) => ({
    _id: `fx${i}`,
    firm: '', type: 'Angel', geo: 'India', warmth: 'intro', path: '', tier: 'B', wave: 2, lead: false, notes: '', source: 'Preview fixture',
    maxStage: r.stage === 'passed' || r.stage === 'parked' ? 'ask' : (r.stage as Investor['maxStage']),
    _creationTime: Date.parse(d(-9) + 'T06:00:00Z'),
    ...FIXTURE_ADDRESSES[r.name],
    ...r,
  })) as Investor[]
}

/**
 * Extra made-up cards for the Pipeline board states (`?preview&pipeline=…`),
 * so its columns look like the design: a full Asked column with two quiet
 * cards, two intros. Added on top of fixtureInvestors(); the other screens
 * never see them.
 */
export function fixtureBoardExtras(today: string): Investor[] {
  const d = (n: number) => add(today, n)
  const rows: Row[] = [
    { name: 'Saffron Seed', firm: 'Saffron', type: 'Pre-seed fund', warmth: 'warm', path: 'Mira', stage: 'ask', expected: 250000, nextStep: 'Nudge for the intro', nextDate: d(1), lastTouch: d(-6), wave: 1 },
    { name: 'Northstar Labs', firm: 'Northstar Labs', type: 'Accelerator', warmth: 'intro', path: '', stage: 'ask', expected: 120000, nextStep: 'Follow up', nextDate: d(2), lastTouch: d(-1), wave: 1, application: { status: 'interview_invited', program: 'B4' } }, // PST-302
    { name: 'Juniper Angel', firm: 'Juniper', type: 'Angel', warmth: 'warm', path: 'Ankur', stage: 'ask', expected: 25000, nextStep: 'Follow up', nextDate: d(2), lastTouch: d(-1), wave: 2 },
    { name: 'Copperleaf', firm: 'Copperleaf', type: 'Seed fund', warmth: 'intro', path: 'Ria', stage: 'ask', expected: 150000, nextStep: 'Follow up', nextDate: d(3), lastTouch: d(-2), wave: 2 },
    { name: 'Rowan Operator', firm: 'Rowan', type: 'Angel', warmth: 'warm', path: 'Ria', stage: 'intro', expected: 25000, nextStep: 'Send the deck', nextDate: d(5), lastTouch: d(-1), wave: 1 },
  ]
  return rows.map((r, i) => ({
    _id: `fxb${i}`,
    firm: '', type: 'Angel', geo: 'India', warmth: 'intro', path: '', tier: 'B', wave: 2, lead: false, notes: '', source: 'Preview fixture',
    maxStage: r.stage as Investor['maxStage'],
    ...r,
  })) as Investor[]
}

/** A short made-up history: each live investor's stage moves, and a few touches. */
export function fixtureActs(inv: Investor[], today: string): Activity[] {
  const d = (n: number) => add(today, n)
  const out: Activity[] = []
  let k = 0
  const push = (a: Omit<Activity, '_id' | 'by'>) => out.push({ ...a, _id: `fa${k++}`, by: 'Dev' })
  for (const i of inv) {
    if (i.stage === 'todo') continue
    const ix = STAGES.findIndex((s) => s.k === (i.stage === 'passed' || i.stage === 'parked' ? i.maxStage : i.stage))
    // Walk up to the current stage, a day or two apart, ending at the last touch.
    const end = i.lastTouch ?? today
    for (let s = 1; s <= ix; s++) push({ investorId: i._id, kind: 'stage', stage: STAGES[s].k, date: add(end, (s - ix) * 2) })
    if (i.stage === 'passed' || i.stage === 'parked') push({ investorId: i._id, kind: 'stage', stage: i.stage, date: end })
  }
  const kite = inv.find((i) => i.name === 'Kite Angels')
  if (kite) push({ investorId: kite._id, kind: 'note', touch: 'call', note: '20 min. Liked the parent angle. Wants the beta numbers.', date: d(-2) })
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

/** How far into the round the fixture is (for sanity checks). */
export const fixtureDaysLeft = (today: string) => dayDiff(fixtureRound(today).deadline, today)

/* ---------- T5 preview states (all made up) ---------- */

/** A CSV like a real export: odd headers, an email column, a second notes column, one duplicate, one row without a name. */
export function fixtureCsv(): string {
  const rows = [
    ['Name', 'Fund / Company', 'Email', 'Kind', 'Intro via', 'Check size', 'Notes 2'],
    ['Amber Lane', 'Amber Lane Angels', 'amber@example.com', 'Angel', 'Ria', '25k', 'Operator'],
    ['Birchwood Capital', 'Birchwood', 'hello@example.com', 'Seed fund', 'Ankur', '150000', ''],
    ['Cobalt Seed', 'Cobalt', 'team@example.org', 'Pre-seed fund', 'Mira', '$100,000', ''],
    ['Driftwood Angels', '', 'drift@example.net', 'Angel', '', '20k', 'Met at a meetup'],
    ['Ember Ventures', 'Ember', 'deals@example.com', 'Micro-VC', 'Ria', '75k', ''],
    ['Fablework Fund', 'Fablework', 'fund@example.com', 'Seed fund', '', '200k', ''],
    ['Granite Hill', 'Granite Hill', 'gh@example.com', 'Multi-stage VC', 'Ankur', '250k', ''],
    ['Indigo Angels', '', 'indigo@example.com', 'Large angel', 'Mira', '50k', ''],
    ['Juniper Labs', 'Juniper', 'labs@example.com', 'Accelerator', '', '125k', ''],
    ['Kestrel Partners', 'Kestrel', 'k@example.com', 'Micro-VC', 'Ria', '60k', ''],
    ['Linden Seed', 'Linden', 'linden@example.com', 'Pre-seed fund', '', '80k', ''],
    ['Meadowlark', '', 'meadow@example.com', 'Angel', 'Direct', '15k', ''],
    ['Orchard Capital', 'Orchard Capital', 'o@example.com', 'Pre-seed fund', 'Ria', '100k', 'Already tracked'],
    ['', 'Nameless Co', 'x@example.com', 'Angel', '', '', ''],
  ]
  return rows.map((r) => r.map((c) => (/[,"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n')
}

const WORDS_A = ['Amber', 'Birch', 'Cobalt', 'Drift', 'Ember', 'Fable', 'Granite', 'Harbor', 'Indigo', 'Juniper', 'Kestrel', 'Linden', 'Meadow', 'Nimbus', 'Opal', 'Pine', 'Quarry', 'Ridge', 'Sable', 'Thistle', 'Umber', 'Vale', 'Wren', 'Yarrow']
const WORDS_B = ['Capital', 'Ventures', 'Angels', 'Partners', 'Fund', 'Collective']

/**
 * Mid-round (?preview&plan=mid): today is in Push. Prep and Wave 1 hit their
 * goals, Kickoff missed by a few asks, Close is next.
 */
export function fixtureMid(today: string): { round: Round; investors: Investor[]; acts: { _id: string; investorId: string; kind: 'stage'; stage: Investor['stage']; date: string; by: string }[] } {
  const d = (n: number) => add(today, n)
  const round: Round = {
    ...fixtureRound(today),
    kickoff: d(-18),
    deadline: d(10),
    phases: [
      { k: 'prep', name: 'Prep', from: d(-18), to: d(-14), goal: 'List of 40, warm paths for most, data room ready.', targets: [{ l: 'Names on the list', m: 'count', t: 40 }], todo: ['Pitch deck ready'] },
      { k: 'w1', name: 'Wave 1', from: d(-13), to: d(-9), goal: 'Closest names first. Get the first meetings booked.', targets: [{ l: '1st meetings', m: 'stage:m1', t: 6 }], todo: ['Send the first asks'] },
      { k: 'kick', name: 'Kickoff', from: d(-8), to: d(-2), goal: 'Release every held intro. 20 asks out.', targets: [{ l: 'Asks out', m: 'stage:ask', t: 20 }], todo: ['Start first meetings'] },
      { k: 'push', name: 'Push', from: d(-1), to: d(5), goal: 'Partner meetings and verbal yeses. $900K in.', targets: [{ l: 'Committed', m: 'committed', t: 0.75 }], todo: ['Follow up with every open conversation'] },
      { k: 'close', name: 'Close', from: d(6), to: d(10), goal: 'Signatures and wires. The whole round by Friday.', targets: [{ l: 'Signed', m: 'signed', t: 1 }], todo: ['Collect signatures'] },
    ],
  }
  const stages: Investor['stage'][] = ['verbal', 'verbal', 'signed', 'm2', 'm2', 'm1', 'm1', 'booked', 'intro', 'intro', 'ask', 'ask', 'ask', 'passed']
  const investors: Investor[] = Array.from({ length: 44 }, (_, i) => {
    const stage = stages[i] ?? (i % 5 === 0 ? 'ask' : 'todo')
    const name = `${WORDS_A[i % WORDS_A.length]} ${WORDS_B[Math.floor(i / WORDS_A.length + i) % WORDS_B.length]}`
    return {
      _id: `mid${i}`, name, firm: name, type: (['Angel', 'Seed fund', 'Pre-seed fund', 'Micro-VC', 'Accelerator'] as const)[i % 5], geo: 'India',
      warmth: i % 3 ? 'intro' : 'warm', path: i % 4 ? ['Ria', 'Ankur', 'Mira'][i % 3] : '', tier: 'B', wave: ((i % 3) + 1) as 1 | 2 | 3, lead: false,
      expected: [150000, 200000, 250000, 100000, 75000][i % 5], stage, maxStage: stage === 'passed' ? 'ask' : (stage as Investor['maxStage']),
      nextStep: stage === 'todo' ? '' : 'Follow up', nextDate: stage === 'todo' ? undefined : d(i % 4), lastTouch: stage === 'todo' ? undefined : d(-(i % 7)), notes: '', source: 'Preview fixture',
    }
  })
  const acts = [
    ...Array.from({ length: 7 }, (_, i) => ({ _id: `ma${i}`, investorId: `mid${i}`, kind: 'stage' as const, stage: 'm1' as const, date: d(-12 + (i % 4)), by: 'Dev' })),
    ...Array.from({ length: 14 }, (_, i) => ({ _id: `mb${i}`, investorId: `mid${i + 7}`, kind: 'stage' as const, stage: 'ask' as const, date: d(-7 + (i % 5)), by: 'Dev' })),
  ]
  return { round, investors, acts }
}

/** The access list in preview. */
export const fixtureMembers = [
  { email: 'dev@example.com', name: 'Dev', me: true },
  { email: 'sam@example.com', name: 'Sam', me: false },
]

/** PST-302 `&stage=correction`: Bluebird Seed was asked for an intro, then moved back to Not contacted (made up). */
export function fixtureCorrection(inv: Investor[], acts: Activity[], today: string): { investors: Investor[]; acts: Activity[] } {
  const b = inv.find((i) => i.name === 'Bluebird Seed')
  if (!b) return { investors: inv, acts }
  const moves: Activity[] = [
    { _id: 'fc1', investorId: b._id, kind: 'stage', stage: 'todo', fromStage: 'ask', date: add(today, -1), by: 'Dev' },
    { _id: 'fc0', investorId: b._id, kind: 'stage', stage: 'ask', fromStage: 'todo', date: add(today, -6), by: 'Dev' },
  ]
  return { investors: inv.map((i) => (i === b ? { ...i, maxStage: 'ask' } : i)), acts: [...acts, ...moves].sort((x, y) => y.date.localeCompare(x.date)) }
}
