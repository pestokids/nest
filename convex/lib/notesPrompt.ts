// PST-277: what Claude is asked when it reads meeting notes, and the shape its
// answer has to have (one Convex validator: the prompt's JSON Schema and the
// check). src/lib/meetingNotes.ts then drops anything the note doesn't back up.
import { v } from 'convex/values'
import { toJsonSchema } from './jsonSchema'
import { money } from '../../src/lib/money'
import { nextStage } from '../../src/lib/meetingNotes'
import { STAGE_RULE, STAGE_TILE, type Stage } from '../../src/lib/stages'

const vText = v.union(v.string(), v.null())
export const vNoteAnswer = v.object({
  summary: v.array(v.string()),
  nextStep: v.union(v.object({ step: v.string(), date: vText, quote: v.string() }), v.null()),
  stage: v.union(v.object({ to: v.string(), quote: v.string() }), v.null()),
  expected: v.union(v.object({ amount: v.number(), quote: v.string() }), v.null()),
  questions: v.array(v.object({ text: v.string(), questionId: vText, answer: vText, answerQuote: vText, quote: v.string() })),
  warmPaths: v.array(v.object({ text: v.string(), quote: v.string() })),
})

export const SYSTEM = [
  'You read a founder’s notes from a meeting with an investor, for Pesto, a kids and family company raising a pre-seed round. The founder is Dev. You turn the notes into updates for the investor tracker.',
  '',
  'Rules:',
  '- Use only what the notes say. Never invent, guess or fill in from memory. If the notes don’t say it, use null or an empty list.',
  '- Every item needs "quote": a short exact quote copied from the notes (a few words, as written) that it comes from. Items without a real quote are thrown away.',
  '- summary: exactly 3 short lines in plain words: how it went, what they want, where it stands.',
  '- nextStep: the one next thing Dev should do, as a short action ("Send week-8 retention"). date is YYYY-MM-DD only if the notes say or clearly imply when ("in two weeks", "by Friday"), counted from the meeting date; otherwise null.',
  '- stage: only if the notes show the rule for the next stage is now true (given below). Never skip a stage and never move backwards. Otherwise null.',
  '- expected: only if the investor said an amount they might put in. amount is US dollars as a plain number ("around fifty" from an angel means 50000). The quote must contain the amount as said. Otherwise null.',
  '- questions: the questions the investor asked, in their words as one clean question each. If one is the same question as one in the bank (given below with ids), set questionId to that id, else null. If Dev answered it in the meeting, answer is his answer in a sentence or two and answerQuote quotes it; otherwise both null.',
  '- warmPaths: intros or warm paths the investor offered ("Sam offered an intro to Orchard Capital").',
  '',
  'Write the answer as one fenced json block matching this JSON Schema, and nothing after it. Valid JSON only: every key present (null or [] when there’s nothing), double quotes, no comments, no trailing commas. The schema:',
  JSON.stringify(toJsonSchema(vNoteAnswer)),
].join('\n')

const line = (label: string, value: string | undefined | null) => (value?.trim() ? '- ' + label + ': ' + value.trim().slice(0, 800) + '\n' : '')

/** "Draft from past answers" (the Answer panel), on the cheap model. */
export const DRAFT_SYSTEM = [
  'You draft the best answer to an investor’s question for Dev, the founder of Pesto, a kids and family company raising a pre-seed round.',
  'Use only the past answers and meeting notes you are given: reuse their facts and numbers, never add new ones. If they don’t answer the question, say only what they do support.',
  'Write what Dev would say in the room: two or three plain sentences, first person plural ("we"), no preamble, no quotes, no lists. Reply with the answer text only.',
].join('\n')

export function draftPrompt(d: { question: string; past: { question: string; answer: string }[]; notes: { date: string; text: string }[] }): string {
  return (
    'The question: ' + d.question + '\n\n' +
    (d.past.length ? 'Past answers:\n' + d.past.map((p) => '- Q: ' + p.question + '\n  A: ' + p.answer).join('\n') + '\n\n' : '') +
    (d.notes.length ? 'Meeting notes where it came up:\n' + d.notes.map((n) => '(' + n.date + ')\n"""\n' + n.text + '\n"""').join('\n') : '')
  )
}

export type NotePromptInput = {
  today: string
  note: { date: string; title?: string; text: string }
  investor: { name: string; firm: string; type: string; stage: Stage; expected?: number; nextStep: string; nextDate?: string; path: string; notes: string }
  bank: { _id: string; text: string }[]
}

export function notePrompt(i: NotePromptInput): string {
  const to = nextStage(i.investor.stage)
  const rule = to ? STAGE_RULE[to] : undefined
  return (
    'The investor:\n' +
    line('Name', i.investor.name) +
    line('Firm', i.investor.firm !== i.investor.name ? i.investor.firm : '') +
    line('Type', i.investor.type) +
    line('Stage now', STAGE_TILE[i.investor.stage]) +
    (to && rule ? line('The only stage it can move to', STAGE_TILE[to] + ' (key "' + to + '"). Its rule: ' + rule) : '- It can’t move stage from notes.\n') +
    line('Expected', i.investor.expected ? money(i.investor.expected) : 'not set') +
    line('Current next step', i.investor.nextStep ? i.investor.nextStep + (i.investor.nextDate ? ' (by ' + i.investor.nextDate + ')' : '') : 'none') +
    line('Warm path', i.investor.path) +
    line('Our notes on them', i.investor.notes) +
    '\nThe Q&A bank (id: question):\n' +
    (i.bank.length ? i.bank.map((q) => '- ' + q._id + ': ' + q.text).join('\n') : '- (empty)') +
    '\n\nToday is ' + i.today + '. The meeting' + (i.note.title ? ' (' + i.note.title + ')' : '') + ' was on ' + i.note.date + '. The notes:\n"""\n' + i.note.text + '\n"""'
  )
}
