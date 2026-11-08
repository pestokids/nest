// PST-274: what Claude is asked when it looks someone up, the shape its answer has
// to have (one Convex validator, used for both the prompt's JSON Schema and the
// check), and how that answer becomes facts. Only names, firms, addresses, our
// notes and next step, and email subjects go in: never email bodies.
import { v, type Infer } from 'convex/values'
import { GENERIC_DOMAINS, domainOf } from '../../src/lib/google'
import { asRank, asType, RANKS } from '../../src/lib/enrich'
import { TYPES } from '../../src/lib/stages'
import { toJsonSchema } from './jsonSchema'
import type { vNewFact } from '../enrichSchema'
import { vCanLead } from '../raceSchema'

const vText = v.union(v.string(), v.null())
const vF = v.union(v.object({ value: v.string(), source: v.string(), confidence: v.number() }), v.null())
const vMoneyF = v.union(v.object({ value: v.string(), source: v.string(), confidence: v.number(), amount: v.union(v.number(), v.null()) }), v.null())

/** Claude's answer. Every key is always present; null means "not found". */
export const vResearch = v.object({
  verdict: v.union(v.literal('investor'), v.literal('not_investor'), v.literal('unknown')),
  summary: v.string(),
  person: v.object({ name: vF, title: vF, rank: vF, covers: vF, location: vF, email: vF, linkedin: vF, x: vF }),
  fund: v.object({
    name: vF, website: vF, domain: vF, type: vF, size: vMoneyF, vintage: vF, stage: vF, check: vMoneyF, leads: vF, geography: vF, thesis: vF, recentDeals: vF,
  }),
  partners: v.array(v.object({ name: v.string(), title: vText, rank: vText, covers: vText, linkedin: vText, source: v.string(), confidence: v.number() })),
  // PST-295: can this fund lead the round? Optional, so an answer without it still counts.
  canLead: v.optional(vCanLead),
})
export type Research = Infer<typeof vResearch>
export type NewFact = Infer<typeof vNewFact>

export const INVESTOR_STEPS = ['Who they are and their rank', 'What the fund is and its size', 'Checking recent deals', 'Typical check size, and whether they lead', 'Other partners and what they cover']
export const SENDER_STEPS = ['Who they are', 'Their firm, if they have one', 'Whether they invest, and in what']

export const SYSTEM = [
  'You research venture investors for Pesto, a kids and family company raising a pre-seed round. Look the person and their fund up on the web, read the pages that matter (the fund’s own site and team page, LinkedIn, Crunchbase, news), and report only what a page you read says.',
  '',
  'Rules:',
  '- Every fact needs source: the full URL (https://…) of the page it came from. No page, no fact: use null.',
  '- Never guess or fill in from memory. If you aren’t sure, use null: a missing field is fine, a wrong one is not. Prefer the fund’s own site, then LinkedIn, then news and databases.',
  '- Many people share a name. Use a page only when it ties this person to their firm or to their email’s domain (the firm’s own site, a profile that names the firm). If you can’t tell which person with that name it is, leave the person’s fields null and say so in summary.',
  '- A personal email address (gmail.com and the like) says nothing about a firm; match on the name and the firm, or the meeting title, instead.',
  '- Keep values short and plain, the way a founder jots them down: "Partner, leads consumer deals", "$25K–$50K, about $35K".',
  '- confidence is 0 to 1: how sure you are that this is the same person and that the page is current.',
  '- person.rank is one of: ' + RANKS.join(', ') + '.',
  '- fund.type is one of: ' + TYPES.join(', ') + '.',
  '- amount is US dollars as a plain number (the fund size for size, the average check for check), or null.',
  '- fund.check covers both the typical range and the average, like "$25K–$50K, about $35K".',
  '- fund.recentDeals: up to four recent investments with the month, kids, consumer and edtech first, like "Tinkerly (Aug), Little Lit (Jun)".',
  '- partners: the other partners at the fund and what they cover (never the person themselves), at most five.',
  '- verdict: investor if they invest (at a fund, as an angel or a scout), not_investor if they clearly don’t, unknown if you couldn’t tell.',
  '- summary: one plain sentence on who they are, like "Principal at XYZ Ventures, a $40M pre-seed fund." or "Couldn’t find them."',
  '- canLead: could they lead a pre-seed round (set the terms and write the biggest check)? value is yes, no or unknown; reason is under 80 characters, like "Leads pre-seed rounds of $500K–$1M" or "Only follows a lead". Say unknown unless a page you read shows it.',
  '',
  'Progress: each time you finish one of the numbered steps, write one line on its own, exactly',
  'STEP <number> | <what you found, under 60 characters> | <domain of the main source>',
  'and carry on. If a step finds nothing, write STEP <number> | Nothing found | -',
  '',
  'At the end, write the answer as one fenced json block matching this JSON Schema, and nothing after it. Valid JSON only: every key present (null when not found), double quotes, no comments, no trailing commas. The schema:',
  JSON.stringify(toJsonSchema(vResearch)),
].join('\n')

const line = (label: string, value: string | undefined | null) => (value?.trim() ? '- ' + label + ': ' + value.trim().slice(0, 600) + '\n' : '')
const steps = (xs: string[]) => xs.map((s, i) => i + 1 + '. ' + s).join('\n')

export type InvestorInput = { name: string; firm: string; type: string; email?: string; emails?: string[]; domains?: string[]; notes: string; nextStep: string; subjects: string[] }
export type SenderInput = { email: string; name?: string; seenIn: string[] }

export function investorPrompt(i: InvestorInput): string {
  return (
    'Look up this investor and their fund.\n' +
    line('Investor', i.name) +
    line('Firm', i.firm !== i.name ? i.firm : '') +
    line('Type in our tracker', i.type) +
    line('Their email (the person to look up)', i.email) +
    line('Other addresses', i.emails?.join(', ')) +
    line('Firm domains', i.domains?.join(', ')) +
    line('Our notes', i.notes) +
    line('Our next step', i.nextStep) +
    line('Recent email subjects', i.subjects.map((s) => '"' + s + '"').join(', ')) +
    '\nSteps:\n' +
    steps(INVESTOR_STEPS)
  )
}

export function senderPrompt(s: SenderInput): string {
  const personal = GENERIC_DOMAINS.has(domainOf(s.email))
  return (
    'Someone outside the company met or wrote to the founders, and nobody knows yet who they are. Find out whether they are an investor.\n' +
    line('Email', s.email + (personal ? ' (a personal address, so the domain says nothing about a firm)' : '')) +
    line('Name on the invite', s.name) +
    line('Seen in', s.seenIn.map((x) => '"' + x + '"').join(', ')) +
    '\nSteps:\n' +
    steps(SENDER_STEPS)
  )
}

/** "STEP 2 | Angel syndicate, about $12M deployed | kite.example.com" → its parts; null for any other line. */
export function parseStep(text: string): { n: number; found: string; source?: string } | null {
  const m = /^\s*STEP\s+(\d+)\s*\|\s*(.+?)\s*(?:\|\s*(\S*)\s*)?$/i.exec(text)
  if (!m) return null
  const source = m[3] && m[3] !== '-' ? m[3].replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : undefined
  return { n: Number(m[1]), found: m[2].slice(0, 90), ...(source ? { source } : {}) }
}

const isUrl = (s: string) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s.trim())
const clamp = (n: number) => Math.min(1, Math.max(0, n))
/** Below this, a fact isn't worth Dev's time. */
const MIN_CONFIDENCE = 0.3

/**
 * Claude's answer as facts to review: only ones with a real source URL and some
 * confidence, values trimmed, ranks and types from Nest's own lists.
 */
export function factsFrom(r: Research): NewFact[] {
  const out: NewFact[] = []
  const add = (group: 'person' | 'fund', field: string, f: { value: string; source: string; confidence: number; amount?: number | null } | null, value: string | undefined) => {
    if (!f || !value?.trim() || !isUrl(f.source) || f.confidence < MIN_CONFIDENCE) return
    out.push({ group, field, value: value.trim().slice(0, 300), source: f.source.trim(), confidence: clamp(f.confidence), ...(f.amount && f.amount > 0 ? { amount: f.amount } : {}) })
  }
  for (const [k, f] of Object.entries(r.person)) add('person', k, f, k === 'rank' ? asRank(f?.value) : f?.value)
  for (const [k, f] of Object.entries(r.fund)) add('fund', k, f, k === 'type' ? asType(f?.value ?? '') : f?.value)
  const self = r.person.name?.value.trim().toLowerCase()
  for (const p of r.partners.slice(0, 5)) {
    if (!p.name.trim() || p.name.trim().toLowerCase() === self || !isUrl(p.source) || p.confidence < MIN_CONFIDENCE) continue
    const rank = asRank(p.rank ?? undefined)
    const value = [p.name.trim(), p.title?.trim() || (rank ? rank.charAt(0).toUpperCase() + rank.slice(1) : ''), p.covers?.trim()].filter(Boolean).join(' · ')
    out.push({
      group: 'fund', field: 'partner', value: value.slice(0, 300), source: p.source.trim(), confidence: clamp(p.confidence),
      person: { name: p.name.trim().slice(0, 120), ...(p.title?.trim() ? { title: p.title.trim().slice(0, 120) } : {}), ...(rank ? { rank } : {}), ...(p.covers?.trim() ? { covers: p.covers.trim().slice(0, 200) } : {}), ...(p.linkedin && isUrl(p.linkedin) ? { linkedin: p.linkedin.trim() } : {}) },
    })
  }
  return out
}
