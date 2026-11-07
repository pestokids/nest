// DEV ONLY: a made-up Q&A bank for ?preview (PST-281). Invented investors from
// the preview fixture, invented questions, answers and meeting notes; nothing real.
import type { Investor } from '../lib/pipeline'
import { NEXT_DECK, type AnswerVersion, type AskSource, type Note, type Question } from '../lib/qanda'
import { addDays } from '../lib/today'

export const PREVIEW_QANDA = ['default', 'empty', 'answer', 'edit', 'new', 'same', 'prep'] as const

export type QRow = Omit<Question, 'asks' | 'askedCount'> & {
  removed?: boolean
  mergedInto?: string
  merge?: { askIds: string[]; keepBefore: Pick<Question, 'bestAnswer' | 'answerVersions' | 'slideRef' | 'onDeck'> }
}
export type AskRow = { _id: string; questionId: string; investorId: string; date: string; source: AskSource; noteId?: string; noteLine?: number }
export type NoteRow = Note & { removed?: boolean }
export type QandaStore = { questions: QRow[]; asks: AskRow[]; notes: NoteRow[] }

export const EMPTY_QANDA: QandaStore = { questions: [], asks: [], notes: [] }

type Spec = {
  text: string
  theme: string
  answer?: string
  slide?: string
  gap?: boolean
  earlier?: { text: string; daysAgo: number; by: string }[]
  /** [investor name, days ago, note key and line] */
  asks: [string, number, [string, number]?][]
}

const NOTES: Record<string, { who: string; title: string; daysAgo: number; lines: string[] }> = {
  kite1: {
    who: 'Kite Angels', title: '1st meeting', daysAgo: 1,
    lines: [
      'Loved the founding-families story and the week-1 paid conversion.',
      'Wants to see week-8 retention before committing.',
      'Would write $25K, maybe $50K if a lead is in.',
      'What does retention look like after week 4?',
      'How do you keep the stories safe for a 4-year-old?',
      'Who else is in the round?',
      'Worried the free tier eats the paid plan.',
      'Next: send week-8 retention in two weeks.',
    ],
  },
  kite0: { who: 'Kite Angels', title: 'Intro call', daysAgo: 5, lines: ['Asked about the team and the market size.', 'Why is this team the one to build it?', 'Booked the 1st meeting.'] },
  orchard2: { who: 'Orchard Capital', title: '2nd meeting', daysAgo: 1, lines: ['Went through the unit economics again.', 'What happens to margins when you add voice?', 'Wants the cohort sheet before the partner meeting.'] },
  northwind: { who: 'Northwind Accelerator', title: 'Intro call', daysAgo: 3, lines: ['Program is 12 weeks, demo day in March.', 'Would you take a lead with a board seat?'] },
  lantern1: { who: 'Lantern Ventures', title: '1st meeting', daysAgo: 8, lines: ['How do you reach the first 10,000 families?', 'Liked the school pilots.'] },
}

const SPECS: Spec[] = [
  {
    text: 'Why will parents pay when free apps exist?', theme: 'Business model', slide: 'p8 · Pricing',
    answer: 'Parents already pay for screen time they trust. 41% of beta families chose the paid plan in week one; the free tier is the funnel, not the product.',
    earlier: [{ text: 'Parents pay for what they trust, and they trust what they can hear first.', daysAgo: 14, by: 'Dev' }],
    asks: [['Kite Angels', 6], ['Orchard Capital', 9], ['Willow Street', 12], ['Saltmarsh Angels', 4], ['Tidewater Angels', 7], ['Cedar Collective', 10], ['Juniper Seed', 2], ['Pebble Partners', 15], ['Harbor Light', 11]],
  },
  {
    text: 'What does retention look like after week 4?', theme: 'Traction',
    answer: 'Week-4 retention is 62% across 140 families. Story streaks are the main driver; week-8 data lands in two weeks.',
    asks: [['Kite Angels', 1, ['kite1', 3]], ['Lantern Ventures', 8], ['Saltmarsh Angels', 4], ['Juniper Seed', 2], ['Fernhill Fund', 6], ['Bluebird Seed', 13]],
  },
  {
    text: 'How do you reach the first 10,000 families?', theme: 'Market', slide: 'p9 · Go to market',
    answer: 'Founding families refer at 1.8x; schools and paediatric clinics are the next two channels. CAC so far is $6.',
    asks: [['Orchard Capital', 9], ['Northwind Accelerator', 3], ['Lantern Ventures', 8, ['lantern1', 0]], ['Morrow Ventures', 14], ['Quill Capital', 16]],
  },
  {
    text: 'Why is this team the one to build it?', theme: 'Team', slide: 'p12 · Team',
    answer: 'Dev built and ran a kids learning app to 2M installs as CTO; the content lead wrote for two big children’s publishers.',
    asks: [['Lantern Ventures', 8], ['Kite Angels', 5, ['kite0', 1]], ['Tidewater Angels', 7]],
  },
  {
    text: 'What stops the AI saying something wrong?', theme: 'Product', slide: 'p7 · Safety',
    answer: 'Every story passes two filters before a child hears it, and a parent can see and replay anything. Flagged stories go to a person within an hour.',
    asks: [['Orchard Capital', 9], ['Juniper Seed', 2]],
  },
  { text: 'How do you keep kids safe from bad content?', theme: 'Product', answer: 'A safety model checks every story against our content rules, then a person reviews anything it flags.', asks: [['Fernhill Fund', 6]] },
  {
    text: 'How big is the market for kids’ audio?', theme: 'Market', gap: true,
    answer: 'About 30M families with kids aged 3 to 8 in our first markets; we start with the 2M who already pay for kids’ apps.',
    asks: [['Cedar Collective', 10], ['Morrow Ventures', 14]],
  },
  { text: 'What is your CAC today?', theme: 'Business model', slide: 'p10 · Unit economics', answer: '$6 across the first 140 families, nearly all from referrals and school groups.', asks: [['Orchard Capital', 9], ['Quill Capital', 16], ['Harbor Light', 11]] },
  { text: 'Who are you competing with?', theme: 'Competition', slide: 'p11 · Competition', answer: 'Story apps are built for screens. We are audio-first, made for one child at a time, and parents stay in control.', asks: [['Pebble Partners', 15]] },
  {
    text: 'How much are you raising, and on what terms?', theme: 'Round', slide: 'p14 · The round',
    answer: '$1.2M on a post-money SAFE, with room to $1.5M. It funds 18 months and gets us to 10,000 paying families.',
    asks: [['Saltmarsh Angels', 4], ['Tidewater Angels', 7], ['Willow Street', 12], ['Bluebird Seed', 13]],
  },
  {
    text: 'How do the stories get made?', theme: 'Product', slide: 'p6 · Product',
    answer: 'Our writers set the world and the rules; the model writes inside them, and every story is checked before it plays.',
    earlier: [
      { text: 'The model writes stories from prompts our team wrote.', daysAgo: 20, by: 'Dev' },
      { text: 'Writers plan each series; the model fills in the episodes.', daysAgo: 12, by: 'Sam' },
    ],
    asks: [['Juniper Seed', 2], ['Kite Angels', 6]],
  },
  { text: 'How do you keep the stories safe for a 4-year-old?', theme: 'Product', asks: [['Kite Angels', 1, ['kite1', 4]]] },
  { text: 'What happens to margins when you add voice?', theme: 'Business model', asks: [['Orchard Capital', 1, ['orchard2', 1]]] },
  { text: 'Who else is in the round?', theme: 'Round', asks: [['Kite Angels', 1, ['kite1', 5]]] },
  { text: 'Would you take a lead with a board seat?', theme: 'Round', asks: [['Northwind Accelerator', 3, ['northwind', 1]]] },
]

/** The bank, the notes and who asked what, built on the preview investors (rows for missing names are skipped). */
export function fixtureQanda(investors: readonly Investor[], today: string, now = Date.now()): QandaStore {
  const id = (name: string) => investors.find((i) => i.name === name)?._id
  const D = 864e5
  const notes: NoteRow[] = []
  const noteIds: Record<string, string> = {}
  for (const [key, n] of Object.entries(NOTES)) {
    const investorId = id(n.who)
    if (!investorId) continue
    noteIds[key] = `pn-${key}`
    notes.push({ _id: noteIds[key], investorId, date: addDays(today, -n.daysAgo), text: n.lines.join('\n'), title: n.title, by: 'Dev', _creationTime: now - n.daysAgo * D })
  }
  const questions: QRow[] = []
  const asks: AskRow[] = []
  SPECS.forEach((s, k) => {
    const qid = `pq-${k}`
    const first = Math.max(...s.asks.map((a) => a[1]), 1)
    const versions: AnswerVersion[] = [
      ...(s.earlier ?? []).map((e) => ({ text: e.text, at: now - e.daysAgo * D, by: e.by })),
      ...(s.answer ? [{ text: s.answer, at: now - Math.min(first, 3) * D + k, by: 'Dev' }] : []),
    ]
    questions.push({
      _id: qid, text: s.text, theme: s.theme, bestAnswer: s.answer ?? '', answerVersions: versions, slideRef: s.slide, onDeck: !!s.slide,
      deckGap: s.gap ? { deck: NEXT_DECK, at: now - D } : undefined, createdAt: now - first * D + k, updatedAt: now - Math.min(first, 3) * D + k,
    })
    s.asks.forEach(([who, daysAgo, from], j) => {
      const investorId = id(who)
      if (!investorId) return
      const noteId = from ? noteIds[from[0]] : undefined
      asks.push({ _id: `pa-${k}-${j}`, questionId: qid, investorId, date: addDays(today, -daysAgo), source: noteId ? 'notes' : 'meeting', noteId, noteLine: noteId ? from![1] : undefined })
    })
  })
  return { questions, asks, notes }
}
