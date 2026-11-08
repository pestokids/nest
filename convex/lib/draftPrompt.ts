// PST-278: the prompt for Drafts. Claude writes as Dev from what Nest knows
// about the investor, and nothing else: no web tools, no made-up numbers.
import { BLANK, DATA_ROOM_LINK, DECK_LINK, MAX_BODY, MAX_SUBJECT, normBlanks, stripFiller, type AiDraftType, type Recipient, type Tweak } from '../../src/lib/drafts'
import { AIError, extractJson } from './anthropic'
import { dayMonth } from '../../src/lib/home'

export const DRAFT_SYSTEM = [
  'You write short emails and messages for Dev, a founder of Pesto, a kids and family company raising a pre-seed round. Dev sends them himself, so they must sound like him.',
  '',
  'Rules:',
  '- Sound like Dev: short, warm, direct, no fluff. Plain words, short paragraphs. Never open with "I hope this finds you well" or any other filler, and never close with "Looking forward to hearing from you" or similar.',
  '- Never invent numbers, names or commitments. Use only what the input below says. Where a number is needed and the input does not give it, write ' + BLANK + ' exactly, and never guess one. Never promise anything the notes do not show Dev promised.',
  '- One clear ask, at the end, that is easy to say yes to.',
  '- Match the tone of Dev’s earlier emails to this person when the input has them.',
  '- Links: use a link the input gives, exactly as given. Where the input says a link is not made yet, write ' + DECK_LINK + ' (the deck) or ' + DATA_ROOM_LINK + ' (the data room) where it goes; Nest fills it in. Never write any other URL.',
  '- Sign off with just "Dev". Plain text: no markdown, no bullet symbols unless a list really helps.',
  '- Under 120 words for the body unless the type below says shorter.',
  '',
  'Answer with only a JSON object: {"subject": "...", "body": "..."}. The body uses \\n for line breaks.',
].join('\n')

const WHAT: Record<AiDraftType, (c: DraftContext) => string> = {
  intro: (c) =>
    c.warm
      ? 'An intro ask to ' + c.warm.name + ' (' + c.warm.email + '), who knows ' + c.investor.name + '. Ask them to introduce Dev. Say who ' + c.investor.name + ' is in a few words and why it’s a fit in two lines, from the facts below, so they can forward it as it is.'
      : 'A forwardable intro blurb: nobody to send it to yet, so Dev will forward it to whoever can make the intro. Address nobody by name ("Hi," is fine). Who ' + c.investor.name + ' is in a few words, and why it’s a fit in exactly two lines, from the facts below.',
  followup: (c) =>
    'A follow-up after the last meeting with ' + c.investor.name + '. Thank them briefly, send what Dev promised in the notes, answer what they asked using Dev’s saved answers below, and end with one next step.',
  nudge: (c) => 'A nudge: ' + c.investor.name + ' has gone quiet. Two or three sentences at most. A light, specific reason to reply (something new, or the open next step), no guilt.',
  thanks: (c) =>
    'A thank-you to ' + c.investor.name + ' for their yes. Confirm the next step towards signing, and share the data room' + (c.dataRoom ? '' : ' if the input has one; if it has none, leave the data room out') + '.',
  dataroom: (c) => 'Sharing the data room with ' + c.investor.name + ': one line on what is in it, the link, and one ask.' + (c.dataRoom ? '' : ' There is no data room in Materials, so say it’s coming and ask what they’d like to see first.'),
  // PST-293
  decision: (c) =>
    'Ask ' + c.investor.name + ' for a decision, yes or no, by ' + dayMonth(c.askBy) + '. Short and polite: three sentences at most. Thank them for their time, say a no is completely fine and helps Dev plan the round, and ask for their answer by that date. No pressure, no guilt, no new pitch.',
}

const TWEAK_TEXT: Record<Tweak, string> = {
  shorter: 'Make it shorter: cut every sentence that doesn’t carry the ask.',
  warmer: 'Make it warmer, still short and never gushing.',
  direct: 'Make it more direct: lead with the ask.',
  deck: 'Add the deck link where it fits naturally, with a few words on what changed if the input says.',
}

export type LinkedMaterial = { title: string; version: number; note: string; url?: string }

/** Everything the prompt gets: the investor record and what Nest has kept about them. */
export type DraftContext = {
  me: string
  investor: { name: string; firm: string; type: string; stage: string; path: string; warmth: string; nextStep: string; nextDate?: string; notes: string; lastTouch?: string; expected?: number; committed?: number }
  contact: Recipient | null
  warm: Recipient | null
  /** Kept enrichment facts, "Thesis: Consumer and kids at pre-seed". */
  facts: string[]
  /** The last meeting notes: Nest's summary of them (PST-277) when it has read them, and the notes themselves. */
  lastNote: { date: string; title?: string; summary: string[]; text: string } | null
  /** Q&A bank answers to the questions they asked. */
  answers: { q: string; a: string }[]
  deck: LinkedMaterial | null
  dataRoom: LinkedMaterial | null
  /** Dev's last emails to them, newest first: the subject and, when Nest sent it, the first line. */
  sent: { date: string; subject: string; firstLine?: string }[]
  /** PST-293: the day "Ask for a yes or no" asks them to decide by. */
  askBy: string
}

const block = (title: string, lines: string[]) => (lines.length ? '## ' + title + '\n' + lines.join('\n') + '\n' : '## ' + title + '\nNothing.\n')
const material = (what: string, m: LinkedMaterial | null, slot: string) =>
  m ? [what + ': ' + m.title + ' v' + m.version + (m.note ? ' (' + m.note + ')' : ''), m.url ? 'Their link: ' + m.url : 'They have no link yet: write ' + slot + ' where it goes.'] : []

/** The user turn: what to write, then the input. */
export function draftPrompt(c: DraftContext, type: AiDraftType, o: { tweak?: Tweak; current?: { subject: string; body: string } } = {}): string {
  const i = c.investor
  const who = [
    'Name: ' + i.name + (i.firm && i.firm !== i.name ? ' (' + i.firm + ')' : ''),
    'Type: ' + i.type,
    'Stage with Dev: ' + i.stage,
    i.path ? 'Warm path: ' + i.path : '',
    i.nextStep ? 'Open next step: ' + i.nextStep + (i.nextDate ? ' (due ' + i.nextDate + ')' : '') : '',
    i.lastTouch ? 'Last touch: ' + i.lastTouch : '',
    i.expected ? 'Amount Dev expects from them: $' + i.expected.toLocaleString('en-US') : '',
    i.committed ? 'Amount they committed: $' + i.committed.toLocaleString('en-US') : '',
    c.contact ? 'Main contact: ' + (c.contact.name ?? c.contact.email) : '',
    i.notes ? 'Dev’s notes: ' + i.notes : '',
  ].filter(Boolean)
  return [
    '# Write: ' + WHAT[type](c),
    o.tweak ? '# Change: ' + TWEAK_TEXT[o.tweak] : '',
    o.current?.body.trim() ? '# The current draft (Dev may have edited it: keep his edits and every fact in it)\nSubject: ' + o.current.subject + '\n' + o.current.body.trim() + '\n' : '',
    '# Input',
    block('The investor', who),
    block('Facts Dev kept about them', c.facts),
    block('The last meeting notes', c.lastNote ? [(c.lastNote.title ? c.lastNote.title + ', ' : '') + c.lastNote.date + ':', ...c.lastNote.summary.map((s) => '- ' + s), c.lastNote.summary.length ? 'The notes:' : '', c.lastNote.text].filter(Boolean) : []),
    block('Questions they asked, with Dev’s saved answers', c.answers.map((x) => 'Q: ' + x.q + '\nA: ' + x.a)),
    block('Materials', [...material('Deck', c.deck, DECK_LINK), ...material('Data room', c.dataRoom, DATA_ROOM_LINK)]),
    block('Dev’s last emails to them (newest first)', c.sent.map((s) => s.date + ' · ' + s.subject + (s.firstLine ? ' · "' + s.firstLine + '"' : ''))),
    'Sign as ' + c.me + '.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** Claude's answer as a subject and body: blanks kept as [__], filler openers dropped. */
export function parseDraft(text: string): { subject: string; body: string } {
  const j = extractJson(text) as { subject?: unknown; body?: unknown }
  if (typeof j?.subject !== 'string' || typeof j?.body !== 'string' || !j.body.trim()) throw new AIError(200, 'answered without a draft', 'no_draft')
  return {
    subject: normBlanks(j.subject).trim().replace(/\s+/g, ' ').slice(0, MAX_SUBJECT),
    body: stripFiller(normBlanks(j.body.replace(/\r\n/g, '\n'))).replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_BODY),
  }
}
