// DEV ONLY: the Advisor's preview (PST-307), for ?preview&advisor=empty|chat|story|blocks|streaming|cap|panel|order|order-streaming|order-panel.
// Every chat, answer, fact and link is invented; investors are the preview fixture's
// made-up firms, found by name. Answers sent in the preview stream a canned reply
// (previewReply): Claude is never called.
//   empty      Raise › Advisor with no chat open: the six starters
//   chat       a Coach chat: a plan, a draft, a suggestion, From: chips
//   streaming  the same chat with its second answer still writing (Stop)
//   story      a Storyteller chat on Opus: the story arc and Save to Q&A
//   blocks     one answer with every interactive block
//   cap        this month at the cap: the notice and Send turned off
//   panel      the ⌘J panel open (best on /raise/pipeline?view=race)
//   PST-308: an answer's words and blocks in the order written
//   order            "What should I do first today?": a lead-in, the plan, words after it, options with
//                    their lead-in; the earlier answer was saved before parts, so it shows text, then its block
//   order-streaming  the same answer still writing, its words after the plan arriving below it
//   order-panel      the ordered answer in the ⌘J panel
import type { AdvisorChat, PreviewStore } from '../components/advisor/data'
import { ADVISOR_DEFAULTS, type AdvisorMessage, type AdvisorMode, type AnswerPart, type Source } from '../lib/advisor'
import { storyText, type Beat, type Block } from '../lib/advisorBlocks'
import { todayIST, weekdayOf } from '../lib/dates'
import { OPUS, SONNET } from '../lib/models'
import type { Investor } from '../lib/pipeline'

export const PREVIEW_ADVISOR = ['empty', 'chat', 'story', 'blocks', 'streaming', 'cap', 'panel', /* PST-308 */ 'order', 'order-streaming', 'order-panel'] as const
export type PreviewAdvisor = (typeof PREVIEW_ADVISOR)[number]
/** The chat each state opens on (none: the new-chat screen). */
export const PREVIEW_ADVISOR_CHAT: Partial<Record<PreviewAdvisor, string>> = {
  chat: 'pc-week', streaming: 'pc-week', story: 'pc-story', blocks: 'pc-blocks', cap: 'pc-week', panel: 'pc-panel',
  /* PST-308 */ order: 'pc-order', 'order-streaming': 'pc-order', 'order-panel': 'pc-order',
}
/** The states that open the ⌘J panel instead of the tab. */
export const PREVIEW_ADVISOR_PANELS: readonly string[] = ['panel', 'order-panel']

const H = 36e5
const add = (iso: string, n: number) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10)
/** The next Friday on or after today (the decide-by the suggestion proposes). */
const friday = (today: string) => add(today, (5 - new Date(today + 'T00:00:00Z').getUTCDay() + 7) % 7 || 7)

const STORY: Beat[] = [
  { label: 'HOOK', text: '“Every night, [__] kids ask us for the same story again.”' },
  { label: 'PROBLEM', text: 'Screens win bedtime because nothing else is made for a 4-year-old’s attention.' },
  { label: 'INSIGHT', text: 'Kids don’t want more stories. They want the same one, a little different each night.' },
  { label: 'PROOF', text: 'Week-8 retention of [__]%, and parents start [__] in 5 sessions.' },
  { label: 'WHY NOW', text: 'Voice models made a personal story cheap enough to give away.' },
  { label: 'ASK', text: 'We’re raising [__] to reach [__] families by next autumn; we’d love Lantern to lead.' },
]

export function advisorStart(state: PreviewAdvisor | null, investors: readonly Investor[], now: number): PreviewStore {
  const today = todayIST(now)
  const byName = (name: string, k: number) => investors.find((i) => i.name === name) ?? investors[k % Math.max(1, investors.length)]
  const L = byName('Lantern Ventures', 0)
  const J = byName('Juniper Seed', 1)
  const HL = byName('Harbor Light', 2)
  const K = byName('Kite Angels', 3)
  const who = (i: Investor | undefined) => (i ? '[[investor:' + i._id + '|' + i.name + ']]' : 'them')
  const first = (i: Investor | undefined) => i?.name.split(' ')[0] ?? 'them'

  const chat = (id: string, title: string, o: Partial<AdvisorChat> & { ago: number }): AdvisorChat => ({
    _id: id, title, pinned: false, model: SONNET, mode: 'coach', createdAt: now - o.ago - 2 * H, updatedAt: now - o.ago, totalCostUsd: 0.04, messageCount: 4, pinnedContext: [], ...o,
  })
  const chats: AdvisorChat[] = [
    chat('pc-lead', 'Lead strategy for kickoff week', { ago: 30 * H, pinned: true, model: OPUS, messageCount: 6, totalCostUsd: 0.22 }),
    chat('pc-week', 'Plan my kickoff week', { ago: 0.2 * H, messageCount: 14, totalCostUsd: 0.09 }),
    chat('pc-blocks', 'Kickoff week: what can I act on?', { ago: 0.5 * H, messageCount: 2, totalCostUsd: 0.04 }),
    chat('pc-order', 'What should I do first today?', { ago: 0.1 * H, messageCount: 4, totalCostUsd: 0.08 }), // PST-308
    chat('pc-panel', 'Juniper is ahead. Should I slow them down?', { ago: 1 * H, messageCount: 2, totalCostUsd: 0.02, screen: { path: '/raise/pipeline', view: 'race' } }),
    chat('pc-story', 'Tighten the story for Lantern', { ago: 3 * H, model: OPUS, mode: 'storyteller', messageCount: 9, totalCostUsd: 0.31, pinnedContext: L ? [{ kind: 'investor', id: L._id, label: L.name }] : [] }),
    chat('pc-prep', 'Prep: Juniper partner meeting', { ago: 20 * H, messageCount: 7 }),
    chat('pc-safe', 'Should I take the angel’s SAFE terms?', { ago: 28 * H, messageCount: 4 }),
    chat('pc-2week', 'How to run a 2-week raise', { ago: 12 * 24 * H, messageCount: 22, totalCostUsd: 0.14 }),
    chat('pc-whynow', 'Pitch: why now for kids audio', { ago: 15 * 24 * H, model: OPUS, mode: 'storyteller', messageCount: 11, totalCostUsd: 0.38 }),
    chat('pc-no', 'What to say to a polite no', { ago: 19 * 24 * H, messageCount: 5 }),
  ]

  let seq = 0
  const msg = (chatId: string, role: 'user' | 'assistant', text: string, o: Partial<AdvisorMessage> = {}): AdvisorMessage => ({
    _id: chatId + '-m' + seq++, chatId, role, text, blocks: [], sources: [], costUsd: 0, status: 'done', createdAt: now - 3 * H + seq * 6e4, ...(role === 'assistant' ? { model: SONNET, mode: 'coach' as const, costUsd: 0.02 } : {}), ...o,
  })
  const web: Source[] = [
    { kind: 'web', label: 'Lantern Ventures · portfolio', url: 'https://lantern.example.com/portfolio' },
    { kind: 'web', label: 'Pre-seed lead checks in 2026', url: 'https://news.example.com/pre-seed-leads' },
  ]
  const followUps: Block = { kind: 'follow_ups', questions: ['Draft the Juniper note', 'What if Lantern says no?', 'Who else could lead?', 'Make it a 30-second version'] }
  const suggestion: Block | null = J ? { kind: 'suggestion', investorId: J._id, change: 'decide_by', date: friday(today), why: 'Juniper is a stage ahead; a date keeps the week honest without rushing them.', state: 'proposed' } : null
  const introDraft: Block = {
    kind: 'draft', draftKind: 'email', draftType: 'intro', investorId: HL?._id, title: 'Email to Sam asking for 2 intros', subject: 'Two intros this week?',
    body: 'Hi Sam, could you introduce me to the partners at Harbor Light and Kite Angels? A two-line note they can forward is below, so it takes you a minute.\n\nThanks!\nDev',
  }

  const week = [
    msg('pc-week', 'user', 'Kickoff week starts Wednesday. Who should I put first, and what should I ask each of them?'),
    msg(
      'pc-week',
      'assistant',
      [
        'Lead with the firms most likely to lead, so their partner meetings land before Friday. Then fill the rest of the week with angels who already said yes to a call.',
        '',
        '1. **Wed: ' + (L?.name ?? 'Lantern') + ', 1st meeting**',
        '   They’ve led two pre-seed rounds this year and can lead. Ask: “What would you need to see to lead this round?”',
        '2. **Wed: ' + (J?.name ?? 'Juniper') + ', partner meeting**',
        '   You’re a stage ahead with them. Slow down by one day so Lantern can catch up; offer Friday for the partner slot.',
        '3. **Thu: Sam’s intros (' + (HL?.name ?? 'Harbor Light') + ', ' + (K?.name ?? 'Kite') + ')**',
        '   Founder intros convert best. Send the forwardable note today so both are booked by Thursday.',
      ].join('\n'),
      {
        costUsd: 0.031,
        blocks: [introDraft, ...(suggestion ? [suggestion] : [])],
        sources: [
          { kind: 'investor', label: first(L) + ' · enrichment', investorId: L?._id },
          { kind: 'notes', label: first(J) + ' · notes ' + weekdayOf(add(today, -1)), investorId: J?._id },
          { kind: 'race', label: 'Race · kickoff week' },
          ...web,
        ],
      },
    ),
    msg('pc-week', 'user', 'Good. And how do I open the ' + first(L) + ' meeting?'),
    state === 'streaming'
      ? msg('pc-week', 'assistant', 'Open with the moment a parent hears their kid ask for the same story the fifth night in a row, then', { status: 'streaming', costUsd: 0.004 })
      : msg('pc-week', 'assistant', 'Open with the moment a parent hears their kid ask for the same story the fifth night in a row, then say why that habit is the business. Keep the first minute about them, not the product: ' + who(L) + ' backs habits, so lead with the habit.', {
          blocks: [{ kind: 'follow_ups', questions: ['Make it a 30-second version', 'What will they push back on?', 'Draft the follow-up email'] }],
          sources: [{ kind: 'investor', label: first(L) + ' · enrichment', investorId: L?._id }, { kind: 'materials', label: 'Materials · Deck v7' }],
        }),
  ]

  const story = [
    msg('pc-story', 'user', first(L) + ' cares about retention. Rewrite my 60-second open around that.', { mode: 'storyteller' }),
    msg('pc-story', 'assistant', 'Here’s an arc built for a partner who thinks in cohorts. Every number comes from your Plan and Materials; blanks are numbers Nest doesn’t have.', {
      model: OPUS, mode: 'storyteller', costUsd: 0.06,
      blocks: [
        { kind: 'story', title: 'Lantern open', investorId: L?._id, beats: STORY },
        { kind: 'draft', draftKind: 'story', title: 'Lantern open', investorId: L?._id, body: storyText(STORY) },
      ],
      sources: [{ kind: 'plan', label: 'Plan · metrics' }, { kind: 'materials', label: 'Materials · Deck v7' }, { kind: 'investor', label: first(L) + ' · enrichment', investorId: L?._id }],
    }),
  ]

  const blocks = [
    msg('pc-blocks', 'user', 'Kickoff week: show me everything I can act on.'),
    msg('pc-blocks', 'assistant', 'Here’s the week as live pieces of Nest. Tick, pick or send; nothing changes without you.', {
      costUsd: 0.04,
      blocks: [
        ...(L ? [{ kind: 'investor_card', investorId: L._id, note: 'Seed fund · can lead · 1st meeting Wed' } as Block] : []),
        {
          kind: 'plan', title: 'Kickoff week',
          items: [
            { text: 'Send Sam the intro ask', date: today, ...(HL ? { investorId: HL._id } : {}) },
            { text: 'Move ' + first(J) + '’s partner meeting to Fri', date: add(today, 1), ...(J ? { investorId: J._id } : {}) },
            { text: 'Book ' + first(L) + '’s partner slot', date: add(today, 2), ...(L ? { investorId: L._id } : {}) },
          ],
          ticked: [0],
        },
        {
          kind: 'options', question: 'Slow ' + first(J) + ' down, or take the offer?',
          options: [
            { label: 'Slow ' + first(J) + ' down', upside: 'Keeps two offers possible in one week.', risk: first(J) + ' cools off.' },
            { label: 'Take ' + first(J) + '’s offer', upside: 'Money now, a lead in hand.', risk: 'No leverage on terms.' },
          ],
        },
        { kind: 'race', investorIds: [J, L, HL].flatMap((i) => (i ? [i._id] : [])), note: first(J) + ' is a stage ahead' },
        { kind: 'story', title: 'Lantern open', investorId: L?._id, beats: [STORY[0], STORY[3], STORY[5]] },
        { kind: 'blank', label: 'Week-8 retention', unit: '%', why: 'Partners who think in cohorts ask for it first.', investorId: L?._id },
        { ...introDraft, title: 'To Sam · Intros to ' + (HL?.name ?? 'Harbor Light') + ' and ' + (K?.name ?? 'Kite') },
        ...(suggestion ? [suggestion] : []),
        { kind: 'memory', fact: 'Dev prefers a call before sending the deck.', state: 'asked' },
        followUps,
      ],
      sources: [{ kind: 'race', label: 'Race · kickoff week' }, { kind: 'plan', label: 'Plan · kickoff' }, { kind: 'investor', label: first(L) + ' · enrichment', investorId: L?._id }],
    }),
  ]

  /* ---------- PST-308: words and blocks in the order written ---------- */
  const todayPlan: Block = {
    kind: 'plan', title: 'Today',
    items: [
      { text: 'Ask ' + first(L) + ' what they’d need to see to lead', date: today, ...(L ? { investorId: L._id } : {}) },
      { text: 'Offer ' + first(J) + ' Friday for the partner meeting', date: today, ...(J ? { investorId: J._id } : {}) },
      { text: 'Send Sam the intro ask for ' + first(HL) + ' and ' + first(K), date: add(today, 1), ...(HL ? { investorId: HL._id } : {}) },
    ],
    ticked: [],
  }
  const leadOptions: Block = {
    kind: 'options', question: 'If ' + first(J) + ' offers first?',
    options: [
      { label: 'Ask for a week', upside: first(L) + ' gets time to catch up.', risk: first(J) + ' may cool off.' },
      { label: 'Take it and set the terms', upside: 'A lead in hand by Friday.', risk: 'Less room on the cap.' },
    ],
  }
  const orderParts: AnswerPart[] = [
    { text: 'Start with the two firms that can lead, before lunch, so both partner meetings land this week. In the plan, tick what you’ll do today; each tick becomes that investor’s next step.' },
    { block: 0 },
    { text: 'Do ' + who(L) + ' first: they’re a stage behind, and a clear ask today is how they catch up.\n\nOne call to make before Friday. The options set out what to do if ' + first(J) + ' offers first.' },
    { block: 1 },
    { block: 2 },
  ]
  const orderText = (ps: readonly AnswerPart[]) => ps.flatMap((p) => ('text' in p ? [p.text] : [])).join('\n\n')
  const orderStreaming = state === 'order-streaming'
  const streamingParts: AnswerPart[] = [orderParts[0], orderParts[1], { text: 'Do ' + who(L) + ' first: they’re a stage behind, and a clear ask' }]
  const order = [
    msg('pc-order', 'user', 'Who’s closest to a decision?'),
    // Saved before parts: its words, then its block.
    msg('pc-order', 'assistant', who(J) + ' is closest: their partner meeting is booked and they asked for the cohort chart.', {
      blocks: J ? [{ kind: 'investor_card', investorId: J._id, note: 'Partner meeting · asked for the cohort chart' }] : [],
      sources: [{ kind: 'race', label: 'Race · kickoff week' }, { kind: 'investor', label: first(J) + ' · notes', investorId: J?._id }],
    }),
    msg('pc-order', 'user', 'What should I do first today?'),
    msg('pc-order', 'assistant', orderText(orderStreaming ? streamingParts : orderParts), {
      costUsd: orderStreaming ? 0.006 : 0.03,
      ...(orderStreaming ? { status: 'streaming' as const } : {}),
      blocks: [todayPlan, leadOptions, { kind: 'follow_ups', questions: ['Draft the ' + first(L) + ' ask', 'What if ' + first(J) + ' offers today?', 'Who should I drop this week?'] }],
      parts: orderStreaming ? streamingParts : orderParts,
      sources: orderStreaming ? [] : [{ kind: 'race', label: 'Race · kickoff week' }, { kind: 'investor', label: first(L) + ' · enrichment', investorId: L?._id }, { kind: 'calendar', label: 'Calendar · today' }],
    }),
  ]

  const panel = [
    msg('pc-panel', 'user', first(J) + ' is ahead. Should I slow them down?'),
    msg(
      'pc-panel',
      'assistant',
      [
        'Yes, by a day. ' + who(J) + ' is a stage ahead of ' + first(L) + ' and ' + (HL?.name ?? 'Harbor Light') + '. If they offer on Wednesday, you’ll have one offer and no leverage.',
        '',
        '1. **Move ' + first(J) + '’s partner meeting to Friday**',
        '   Say you’re finishing first meetings this week.',
        '2. **Book ' + first(L) + '’s partner slot for Thursday**',
        '   Sam can nudge them today.',
      ].join('\n'),
      {
        blocks: J ? [{ kind: 'draft', draftKind: 'email', draftType: 'followup', investorId: J._id, title: 'Reschedule note to ' + first(J), subject: 'Friday instead?', body: 'Hi, could we move the partner meeting to Friday? We’re finishing first meetings this week and I’d like to give you our full attention.\n\nDev' }] : [],
        sources: [{ kind: 'race', label: 'Race · kickoff week' }, { kind: 'investor', label: first(J) + ' · notes', investorId: J?._id }],
      },
    ),
  ]

  const short = (id: string) => {
    const c = chats.find((x) => x._id === id)!
    return [msg(id, 'user', c.title, { mode: c.mode }), msg(id, 'assistant', 'This is an older chat in the preview. Open “Plan my kickoff week” or the Storyteller chat to see a full answer.', { model: c.model, mode: c.mode })]
  }

  const memory = [
    'Dev prefers a call before sending the deck.',
    'The data room opens only after a second meeting.',
    'For a lead, Dev wants a fund that has led a pre-seed round before.',
    'Dev keeps investor emails to five lines or fewer.',
    'Investor updates go out on Fridays.',
  ].map((fact, k) => ({ _id: 'pmem' + k, fact, createdAt: now - (k + 1) * 30 * H, ...(k === 1 ? { chat: 'How to run a 2-week raise' } : {}) }))

  return {
    overview: {
      connected: true, settings: { ...ADVISOR_DEFAULTS }, monthUsd: state === 'cap' ? 19.99 : 3.12, monthAnswers: 41, memoryCount: memory.length, real: { sonnet: null, opus: null },
    },
    chats,
    messages: Object.fromEntries([
      ['pc-week', week], ['pc-story', story], ['pc-blocks', blocks], ['pc-panel', panel], /* PST-308 */ ['pc-order', order],
      ...['pc-lead', 'pc-prep', 'pc-safe', 'pc-2week', 'pc-whynow', 'pc-no'].map((id) => [id, short(id)]),
    ]),
    memory,
    removed: {},
  }
}

/** What a question sent in the preview gets back: a canned answer that says so. PST-308: its words and blocks in the order they stream. */
export function previewReply(mode: AdvisorMode, _question: string, _chats: readonly AdvisorChat[]): { parts: AnswerPart[]; blocks: Block[]; sources: Source[]; costUsd: number } {
  if (mode === 'storyteller')
    return {
      parts: [
        { text: 'Here’s a tighter arc. In the story, drag the beats into the order you’d tell them; blanks are numbers Nest doesn’t have.' },
        { block: 0 },
        { text: 'A preview answer: Claude isn’t called here.' },
      ],
      blocks: [
        { kind: 'story', title: 'Your open', beats: [STORY[0], STORY[2], STORY[5]] },
        { kind: 'follow_ups', questions: ['Make it a 30-second version', 'Tailor it to one investor', 'What’s the weakest line?'] },
      ],
      sources: [{ kind: 'materials', label: 'Materials · Deck v7' }, { kind: 'plan', label: 'Plan · metrics' }],
      costUsd: 0.06,
    }
  const today = todayIST(Date.now())
  return {
    parts: [
      { text: 'Start with the investors closest to a decision, and give each one a clear next step with a day. In the plan, tick the steps you’ll take; each tick becomes that investor’s next step.' },
      { block: 0 },
      { text: 'If one of them needs more time, ask for a date rather than a maybe.\n\nThis is a preview answer: Claude isn’t called here.' },
    ],
    blocks: [
      { kind: 'plan', title: 'Today', items: [{ text: 'Ask the two warmest leads what they’d need to lead', date: today }, { text: 'Nudge everyone waiting on a reply', date: add(today, 1) }], ticked: [] },
      { kind: 'follow_ups', questions: ['Who should lead?', 'Draft the nudges', 'What should I drop?'] },
    ],
    sources: [{ kind: 'race', label: 'Race · this week' }, { kind: 'plan', label: 'Plan · targets' }],
    costUsd: 0.02,
  }
}
