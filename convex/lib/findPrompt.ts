// PST-296: what Haiku is asked when it finds more investors (web search only, no
// page reads), the shape its answer has to have (one Convex validator, for both the
// prompt's JSON Schema and the check), and how that answer becomes candidates.
// Only company names, the top Priority investors' firm names, today's date and the
// round's check range go in.
import { v, type Infer } from 'convex/values'
import { asType } from '../../src/lib/enrich'
import { MAX_CANDIDATES, type Found } from '../../src/lib/findMore'
import { money } from '../../src/lib/money'
import type { Round } from '../../src/lib/round'
import { TYPES } from '../../src/lib/stages'
import { toJsonSchema } from './jsonSchema'

const vText = v.union(v.string(), v.null())
const vNum = v.union(v.number(), v.null())

/** Haiku's answer. Every key is always present; null means "not found". */
export const vFindAnswer = v.object({
  investors: v.array(
    v.object({
      name: v.string(),
      firm: vText,
      type: vText,
      domain: vText,
      leads: v.union(v.boolean(), v.null()),
      stage: vText,
      check: vText,
      check_usd: vNum,
      thesis: vText,
      geography: vText,
      backed: v.array(v.object({ company: v.string(), round: vText, date: vText })),
      deals_last_12_months: vNum,
      last_deal: vText,
      co_invests_with: v.array(v.string()),
      sources: v.array(v.object({ url: v.string(), title: vText })),
    }),
  ),
})
export type FindAnswer = Infer<typeof vFindAnswer>

/** Web search only: about one search a seed (findEstimate counts on this cap). */
export const findTools = (searches: number) => [{ type: 'web_search_20260318', name: 'web_search', max_uses: searches }]

export const FIND_SYSTEM = [
  'You find venture investors for Pesto, a kids and family company raising a pre-seed round. Use web search to find investors (funds, angel syndicates and angels) who invested in the companies you are given, and investors who often invest alongside the investors you are given. Report only what a page you found says.',
  '',
  'Rules:',
  '- Only investors with at least one investment in the last 12 months (on or after the month you are given). Leave out anyone whose latest deal is older, or whose latest deal you can’t date.',
  '- Only investors who invest at pre-seed or seed.',
  '- Never list the investors you are given themselves.',
  '- At most ' + MAX_CANDIDATES + ' investors, the most relevant first.',
  '- sources: the full URLs (https://…) of the pages that show each investor and their deals. No page, leave the investor out.',
  '- Never guess or fill in from memory. If a page doesn’t say, use null.',
  '- name: the fund or syndicate, or the angel’s own name. firm: the fund’s name, or null for an angel investing alone.',
  '- type is one of: ' + TYPES.join(', ') + '.',
  '- domain: the firm’s website domain, like brightpath.example.com, or null.',
  '- leads: true if they lead rounds, false if they only follow, null if you can’t tell.',
  '- check: their typical check, like "$25K–$100K". check_usd: that typical check as a plain number in US dollars, or null.',
  '- thesis: what they invest in, in a few plain words, like "Kids and consumer apps".',
  '- backed: the given companies they invested in, each with the round ("pre-seed", "seed") and the month as YYYY-MM.',
  '- last_deal: the month of their most recent investment, YYYY-MM. deals_last_12_months: how many investments in the last 12 months, or null.',
  '- co_invests_with: which of the given investors they invested alongside, by the name you were given.',
  '',
  'At the end, write the answer as one fenced json block matching this JSON Schema, and nothing after it. Valid JSON only: every key present (null when not found), double quotes, no comments, no trailing commas. The schema:',
  JSON.stringify(toJsonSchema(vFindAnswer)),
].join('\n')

/** The month 12 months before today, YYYY-MM. */
export function activeSince(today: string): string {
  const y = Number(today.slice(0, 4))
  return y - 1 + '-' + today.slice(5, 7)
}

export function findPrompt(o: { companies: string[]; investors: string[]; today: string; round: Pick<Round, 'minCheck' | 'target'> }): string {
  const list = (xs: string[]) => xs.map((x) => '- ' + x).join('\n')
  return [
    'Find more investors like these.',
    o.companies.length ? 'Companies one step ahead of Pesto:\n' + list(o.companies) : '',
    o.investors.length ? 'Investors to find co-investors of:\n' + list(o.investors) : '',
    'Today is ' + o.today + '. Only investors with a deal on or after ' + activeSince(o.today) + '.',
    'Pesto looks for checks of ' + (o.round.minCheck ? money(o.round.minCheck) + ' to ' : 'up to ') + money(o.round.target * 0.25) + '.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

const isUrl = (s: string) => /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(s.trim())
const text = (s: string | null, max = 200) => s?.trim().slice(0, max) || undefined
const month = (s: string | null) => (s && /^\d{4}-\d{2}/.test(s.trim()) ? s.trim().slice(0, 7) : undefined)

/** The answer as candidates: only those with a real source, values trimmed, types from Nest's own list. */
export function foundFrom(a: FindAnswer): Found[] {
  const out: Found[] = []
  for (const x of a.investors) {
    const sources = x.sources.filter((s) => isUrl(s.url)).slice(0, 4).map((s) => ({ url: s.url.trim(), ...(text(s.title, 120) ? { title: text(s.title, 120) } : {}) }))
    const name = x.name.trim().slice(0, 120)
    if (!name || !sources.length) continue
    const type = asType(x.type ?? '')
    out.push({
      name,
      firm: x.firm?.trim().slice(0, 120) ?? '',
      ...(type ? { type } : {}),
      ...(text(x.domain, 100) ? { domain: text(x.domain, 100)!.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] } : {}),
      ...(x.leads === null ? {} : { leads: x.leads }),
      ...(text(x.stage, 80) ? { stage: text(x.stage, 80) } : {}),
      ...(text(x.check, 80) ? { check: text(x.check, 80) } : {}),
      ...(x.check_usd && x.check_usd > 0 ? { checkUsd: Math.round(x.check_usd) } : {}),
      ...(text(x.thesis) ? { thesis: text(x.thesis) } : {}),
      ...(text(x.geography, 80) ? { geography: text(x.geography, 80) } : {}),
      backed: x.backed
        .filter((b) => b.company.trim())
        .slice(0, 4)
        .map((b) => ({ company: b.company.trim().slice(0, 80), ...(text(b.round, 40) ? { round: text(b.round, 40) } : {}), ...(month(b.date) ? { date: month(b.date) } : {}) })),
      ...(x.deals_last_12_months !== null && x.deals_last_12_months >= 0 ? { dealsLast12: Math.round(x.deals_last_12_months) } : {}),
      ...(month(x.last_deal) ? { lastDeal: month(x.last_deal) } : {}),
      ...(x.co_invests_with.length ? { coInvests: x.co_invests_with.map((s) => s.trim().slice(0, 80)).filter(Boolean).slice(0, 4) } : {}),
      sources,
    })
  }
  return out
}
