// PST-305: what Haiku is asked for the Network. "Find their investors" (web search
// only): who backed one founder's company, with each round and year and a source
// link. Only the company's name and website go out, never the founder's. And the
// intro ask: one email to a person naming the 2–3 investors Dev picked, why each
// fits (from Nest's facts only), and a short note about Pesto they can forward.
import { v, type Infer } from 'convex/values'
import { BLANK } from '../../src/lib/drafts'
import { LOOKUP_MAX } from '../../src/lib/network'
import { toJsonSchema } from './jsonSchema'

const vText = v.union(v.string(), v.null())

/** The lookup's answer. Every key is always present; null means "not found". */
export const vLookupAnswer = v.object({
  investors: v.array(v.object({ firm: v.string(), partner: vText, round: vText, year: v.union(v.number(), v.string(), v.null()), domain: vText, url: vText })),
})
export type LookupAnswer = Infer<typeof vLookupAnswer>

/** Web search only, a few searches (lookupEstimate counts on this cap). */
export const lookupTools = (searches: number) => [{ type: 'web_search_20260318', name: 'web_search', max_uses: searches }]

export const LOOKUP_SYSTEM = [
  'You find who invested in one startup. Use web search to find the investors (funds, angel syndicates and angels) who backed the company you are given, in any round. Report only what a page you found says.',
  '',
  'Rules:',
  '- At most ' + LOOKUP_MAX + ' investors, the earliest rounds first.',
  '- firm: the fund or syndicate, or the angel’s own name.',
  '- partner: the partner who led the deal or joined the board, only if a page names them; else null.',
  '- round: the round they invested in, like "pre-seed", "seed" or "Series A"; null if no page says.',
  '- year: the year of that round as a number, like 2025; null if no page says.',
  '- domain: the firm’s website domain, like brightpath.example.com, or null.',
  '- url: the full URL (https://…) of the page that shows they invested. No page, leave the investor out.',
  '- Never guess or fill in from memory. If a page doesn’t say, use null.',
  '',
  'At the end, write the answer as one fenced json block matching this JSON Schema, and nothing after it. Valid JSON only: every key present (null when not found), double quotes, no comments, no trailing commas. The schema:',
  JSON.stringify(toJsonSchema(vLookupAnswer)),
].join('\n')

export function lookupPrompt(o: { company: string; domain?: string }): string {
  return ['Who invested in this company?', 'Company: ' + o.company, o.domain ? 'Website: ' + o.domain : '', 'List every investor you can find, with the round and year of each.'].filter(Boolean).join('\n')
}

/* ---------- the intro ask ---------- */

export type AskContext = {
  me: string
  person: { name: string; relation: string; company?: string; notes: string }
  /** The investors Dev picked, by their name in Nest, with what Nest keeps about each. */
  investors: { name: string; firm: string; type: string; facts: string[] }[]
  /** Dev's best saved answers about Pesto (the Q&A bank). */
  bank: { q: string; a: string }[]
}

export const ASK_SYSTEM = [
  'You write short emails for Dev, a founder of Pesto, a kids and family company raising a pre-seed round. Dev sends them himself, so they must sound like him: short, warm, direct, plain words, no fluff, no filler openers or closers.',
  '',
  'Rules:',
  '- Never invent facts, numbers, names or commitments. Use only what the input says.',
  '- Where a number is needed and the input does not give it, write ' + BLANK + ' exactly. Never guess one.',
  '- Name only the investors the input lists, each exactly as written there.',
  '- Plain text, no markdown, no links.',
  '',
  'Answer with only a JSON object: {"subject": "...", "opening": "...", "fits": [{"name": "...", "why": "..."}], "note": "..."}. Strings use \\n for line breaks.',
].join('\n')

const block = (title: string, lines: string[]) => '## ' + title + '\n' + (lines.length ? lines.join('\n') : 'Nothing.') + '\n'

/** The user turn: what to write, then the input. Everything Claude may use is in here (the parse blanks any number it doesn't hold). */
export function askPrompt(c: AskContext): string {
  const first = c.person.name.trim().split(/\s+/)[0] || c.person.name
  return [
    '# Write: one email to ' + first + ' asking whether they would introduce Dev to the investors below. Both of them know these investors are on ' + first + '’s side of the table, so keep it light and easy to say yes to.',
    '- subject: short, like "A few intros?".',
    '- opening: "Hi ' + first + '," then one or two sentences: why Dev is writing, and the ask.',
    '- fits: one entry per investor below, "name" exactly as written there, and "why": one short line on why they fit Pesto, built only from the facts listed for them. If an investor has no facts, write an empty why ("") and never make one up.',
    '- note: a short note about Pesto that ' + first + ' can forward as it is (under 90 words, written to be read by an investor): who is building Pesto, what Pesto does (from Dev’s saved answers when there are any), what just happened with ' + BLANK + ' wherever a number goes, and one ask (a 30-minute call). No links.',
    '- Never write a greeting to the investors, a sign-off or Dev’s name: Nest adds those.',
    '# Input',
    block('Who Dev is writing to', [c.person.name + ' (' + c.person.relation + (c.person.company ? ', ' + c.person.company : '') + ')' + (c.person.notes ? ': ' + c.person.notes : '')]),
    block(
      'The investors Dev picked',
      c.investors.map((i) => '- ' + i.name + (i.firm && i.firm !== i.name ? ' (' + i.firm + ')' : '') + ' · ' + i.type + (i.facts.length ? '\n  Facts: ' + i.facts.join('; ') : '\n  Facts: none')),
    ),
    block('Dev’s best saved answers about Pesto', c.bank.map((x) => 'Q: ' + x.q + '\nA: ' + x.a)),
    'Dev signs as ' + c.me + '.',
  ].join('\n')
}
