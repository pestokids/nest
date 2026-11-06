// DEV ONLY: a small made-up round for ?preview and screenshots. No real
// investors, amounts or dates: names are invented and dates follow today.
import { dayDiff } from '../lib/dates'
import type { Investor } from '../lib/pipeline'
import { DEFAULT_ODDS, type Round } from '../lib/round'

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
    { name: 'Fernhill Fund', firm: 'Fernhill', type: 'Seed fund', warmth: 'intro', path: 'Mira', stage: 'ask', expected: 150000, nextStep: 'Partner call', nextDate: d(19), lastTouch: d(-6), wave: 1 },
    { name: 'Kite Angels', firm: 'Kite Angels', type: 'Angel', warmth: 'warm', path: 'Direct', stage: 'booked', expected: 25000, nextStep: 'Send the deck', nextDate: d(0), lastTouch: d(-3), wave: 1 },
    { name: 'Pebble Partners', firm: 'Pebble', type: 'Micro-VC', warmth: 'cold', path: 'cold', stage: 'passed', expected: 50000, nextStep: '', lastTouch: d(-8), wave: 2 },
    { name: 'Morrow Ventures', firm: 'Morrow', type: 'Seed fund', warmth: 'intro', path: 'Ria', stage: 'todo', expected: 200000, nextStep: '', wave: 1 },
    { name: 'Bluebird Seed', firm: 'Bluebird', type: 'Pre-seed fund', warmth: 'intro', path: 'Ankur', stage: 'todo', expected: 100000, nextStep: '', wave: 1 },
    { name: 'Quill Capital', firm: 'Quill', type: 'Multi-stage VC', warmth: 'cold', path: '', stage: 'todo', expected: 250000, nextStep: '', wave: 2 },
    { name: 'Tidewater Angels', firm: 'Tidewater', type: 'Angel', warmth: 'warm', path: 'Direct', stage: 'todo', expected: 20000, nextStep: '', wave: 1 },
    { name: 'Cedar Collective', firm: 'Cedar', type: 'Large angel', warmth: 'intro', path: 'Mira', stage: 'todo', expected: 50000, nextStep: '', wave: 2 },
    { name: 'Harbor Light', firm: 'Harbor Light', type: 'Accelerator', warmth: 'intro', path: '', stage: 'todo', expected: 125000, nextStep: '', wave: 3 },
    { name: 'Willow Street', firm: 'Willow Street', type: 'Angel', warmth: 'intro', path: 'Ria', stage: 'todo', expected: 25000, nextStep: '', wave: 1 },
  ]
  return rows.map((r, i) => ({
    _id: `fx${i}`,
    firm: '', type: 'Angel', geo: 'India', warmth: 'intro', path: '', tier: 'B', wave: 2, lead: false, notes: '', source: 'Preview fixture',
    maxStage: r.stage === 'passed' || r.stage === 'parked' ? 'ask' : (r.stage as Investor['maxStage']),
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
    { name: 'Northstar Labs', firm: 'Northstar Labs', type: 'Accelerator', warmth: 'intro', path: '', stage: 'ask', expected: 120000, nextStep: 'Follow up', nextDate: d(2), lastTouch: d(-1), wave: 1 },
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

/** How far into the round the fixture is (for sanity checks). */
export const fixtureDaysLeft = (today: string) => dayDiff(fixtureRound(today).deadline, today)
