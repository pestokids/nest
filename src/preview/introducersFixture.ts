// DEV ONLY: made-up introducers and intros for ?preview (PST-294). Every name,
// address and firm is invented.
//   &investors=introducers   Investors › Introducers (the old warm paths are migrated on load)
//   &introducer=panel        the panel for one introducer (Ankur), on phones too
//   &introducer=add          Add introducer;  &introducer=ask  Ankur's Ask for another intro
//   &draft=forwardable       the forwardable intro draft: the ask to Ankur and the note he forwards
//   &drawer=warm-path        the drawer's warm path: Kite Angels through Ankur, five steps done
import { DECK_LINK } from '../lib/drafts'
import { firstName, type Intro, type Introducer, type Steps } from '../lib/introducers'
import type { Investor } from '../lib/pipeline'
import { addDays } from '../lib/today'

const PEOPLE: Introducer[] = [
  { _id: 'pi-ankur', name: 'Ankur Mehta', email: 'ankur@tinkerly.example', relation: 'portfolio', notes: 'Founder of Tinkerly' },
  { _id: 'pi-mira', name: 'Mira Shah', email: 'mira@shah.example', relation: 'angel', notes: 'Invested in 2 kids startups' },
  { _id: 'pi-ria', name: 'Ria Kapoor', relation: 'friend', notes: 'Ex-colleague' },
  { _id: 'pi-dana', name: 'Dana Lee', email: 'dana@lee.example', relation: 'friend', notes: 'Founder friend' },
]

/** Steps done, each a number of days before today. */
const STEP_DAYS: [string, string, number[]][] = [
  ['pi-ankur', 'Kite Angels', [-7, -6, -6, -4, -4]],
  ['pi-ankur', 'Lantern Ventures', [-6, -5, -5, 0]],
  ['pi-ankur', 'Quill Capital', [-4, -3, -3]],
  ['pi-ankur', 'Bluebird Seed', [-2, -1]],
  ['pi-mira', 'Pebble Partners', [-14, -13, -13, -11, -11]],
  ['pi-mira', 'Fernhill Fund', [-5]],
  ['pi-ria', 'Saltmarsh Angels', [-1]],
  ['pi-dana', 'Harbor Light', [-3]],
]
const KEYS = ['asked', 'yes', 'sent', 'made', 'thanked', 'reported'] as const

export function previewIntroducers(investors: readonly Investor[], today: string): { introducers: Introducer[]; intros: Intro[] } {
  const intros: Intro[] = []
  STEP_DAYS.forEach(([introducerId, name, days], k) => {
    const inv = investors.find((i) => i.name === name)
    if (!inv) return
    const steps: Steps = {}
    days.forEach((n, i) => (steps[KEYS[i]] = addDays(today, n)))
    intros.push({ _id: 'pn' + k, investorId: inv._id, introducerId, steps, createdAt: Date.parse(addDays(today, days[0] - 1) + 'T06:00:00Z') })
  })
  return { introducers: PEOPLE.map((p) => ({ ...p, createdAt: Date.parse(addDays(today, -20) + 'T06:00:00Z') })), intros }
}

/** &draft=forwardable: Ankur, for an intro to Tidewater Angels (no intro yet: opening the draft makes one). */
export const PREVIEW_FORWARDABLE = { introducerId: 'pi-ankur', investor: 'Tidewater Angels' }

/** The preview's "Claude" for a forwardable intro: blanks where the numbers go, the deck link or its slot. */
export function previewForwardable(o: { investor: Investor; introducer: string; deck?: string }) {
  const who = firstName(o.introducer)
  const inv = o.investor.name
  return {
    subject: 'Intro to ' + inv + '?',
    body: ['Hi ' + who + ',', 'Would you be up for introducing me to ' + inv + '? They back consumer and kids companies early, and Pesto is raising its pre-seed now.', 'If yes, I’ll send a short note you can forward as it is.', 'Thanks,\nDev'].join('\n\n'),
    forward: {
      subject: 'Intro request: Pesto → ' + inv,
      body: [
        'Hi ' + who + ',',
        'As promised, here’s a note you can forward to ' + inv + '.',
        'We’re building Pesto, a kids and family app [one-line credibility, e.g. what we’ve shipped before].',
        'What just happened: [__] families joined the beta in [__] weeks, and [__]% still play weekly at week 4.',
        'What Pesto does, in two sentences: [from your Q&A bank’s best answer].',
        'Deck: ' + (o.deck ?? DECK_LINK),
        'Would ' + inv + ' be up for a 30-minute call next week?',
        'Dev',
      ].join('\n\n'),
    },
  }
}
