// PST-296: Find more like these (screens/round5/investors-find-more.png). Haiku
// with web search finds investors who backed the companies one step ahead of Pesto
// (or invest alongside the top Priority investors); Nest keeps those active in the
// last 12 months, drops anyone already in Nest, keeps at most 30, scores each with
// Jev (src/lib/fitScore.ts) and shows them with their reasons, warm path and
// sources. Nothing reaches the list until Dev adds them, and then only as a
// suggestion. Pure; shared by Convex (convex/findMore.ts) and the app.
import { FIT_FOCUS, firmDomain, fit, type Fact } from './enrich'
import type { InvestorFacts } from './fitScore'
import { GENERIC_DOMAINS, normDomain } from './google'
import { warmPathFor, type IntroSources } from './introducers'
import { jevCost } from './jev'
import { costOfRow, type Model } from './models'
import { money } from './money'
import { priority, type Priority } from './priority'
import type { Round } from './round'
import { DONE, type Stage } from './stages'
import { normFirm } from './suggestions'
import { todayIST } from './dates'

/** At most this many candidates a run (and so at most this many Jev calls). */
export const MAX_CANDIDATES = 30
/** Only investors with a deal in this many months. */
export const ACTIVE_MONTHS = 12
/** The top Priority investors that seed a run beside the companies. */
export const TOP_PRIORITY_SEEDS = 3
export const MAX_COMPANIES = 8
/** A run searches about once per seed, never more than this (the web search tool's max_uses). */
export const MAX_SEARCHES = 10

export type Backed = { company: string; round?: string; date?: string }
export type FindSource = { url: string; title?: string }
/** An investor the search found, as Nest keeps it. Dates are YYYY-MM. */
export type Found = {
  name: string
  firm: string
  type?: string
  domain?: string
  leads?: boolean
  stage?: string
  check?: string
  checkUsd?: number
  thesis?: string
  geography?: string
  backed: Backed[]
  dealsLast12?: number
  lastDeal?: string
  /** Seed investors they invested alongside (shown in the footnote; never sent to Jev). */
  coInvests?: string[]
  sources: FindSource[]
}

/* ---------- seeds ---------- */

/** The companies chips as saved: trimmed, no repeats (any case), at most MAX_COMPANIES. */
export function cleanCompanies(xs: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of xs) {
    const s = x.trim().replace(/\s+/g, ' ').slice(0, 60)
    if (!s || seen.has(s.toLowerCase())) continue
    seen.add(s.toLowerCase())
    out.push(s)
  }
  return out.slice(0, MAX_COMPANIES)
}

/** The top Priority investors still in play (not passed, parked or wired), best first. */
export function topPriority<T extends { _id: string; name: string; stage: Stage }>(inv: readonly T[], prio: ReadonlyMap<string, Priority>, n = TOP_PRIORITY_SEEDS): T[] {
  return inv
    .filter((i) => !DONE.has(i.stage) && prio.has(i._id))
    .sort((a, b) => prio.get(b._id)!.score - prio.get(a._id)!.score || a.name.localeCompare(b.name))
    .slice(0, n)
}

/** The panel's right-hand chips: who Nest looks for, from the round settings. */
export function roundChips(r: Pick<Round, 'minCheck' | 'target'>): string[] {
  const max = r.target * 0.25
  return ['Pre-seed and seed', (r.minCheck ? money(r.minCheck) + '–' : 'Up to ') + money(max) + ' checks', 'Leads or follows']
}

/* ---------- the cost, before it runs ---------- */

export const searchesFor = (seeds: number) => Math.min(MAX_SEARCHES, Math.max(2, seeds))
/** Instructions and schema; each search's results (read again on every later step); the answer, with thinking. */
const BASE_TOKENS = 3_000
const SEARCH_TOKENS = 4_000
const ANSWER_TOKENS = 6_000
/** One candidate's Jev call: the round's facts and theirs, and four questions. */
export const JEV_TOKENS = 700

/**
 * What a run should cost: Haiku's tokens (every step reads the instructions and
 * every search before it), web searches at $10 per 1,000, and a Jev call per
 * candidate at the most candidates a run keeps.
 */
export function findEstimate(seeds: number, model: Model): { usd: number; searches: number; input: number; output: number; jevUsd: number } {
  const searches = searchesFor(seeds)
  const input = (searches + 1) * BASE_TOKENS + (SEARCH_TOKENS * searches * (searches + 1)) / 2
  const jevUsd = jevCost(JEV_TOKENS * MAX_CANDIDATES)
  const usd = costOfRow({ input, output: ANSWER_TOKENS, cacheRead: 0, cacheWrite: 0, webSearches: searches }, model) + jevUsd
  return { usd, searches, input, output: ANSWER_TOKENS, jevUsd }
}

/* ---------- which candidates stay ---------- */

/** Whole months from a YYYY-MM (or a full date) to today; null when it isn't a date. */
export function monthsAgo(ym: string, today: string): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(ym)
  if (!m) return null
  return (Number(today.slice(0, 4)) - Number(m[1])) * 12 + (Number(today.slice(5, 7)) - Number(m[2]))
}

/** Their latest known deal: the one stated, or the newest company they backed. */
export function lastDealOf(c: Pick<Found, 'lastDeal' | 'backed'>): string | undefined {
  return [c.lastDeal, ...c.backed.map((b) => b.date)]
    .filter((x): x is string => !!x && /^\d{4}-\d{2}/.test(x))
    .map((x) => x.slice(0, 7))
    .sort()
    .pop()
}

/** A deal in the last ACTIVE_MONTHS months (a date in the future isn't trusted). */
export function isActive(c: Pick<Found, 'lastDeal' | 'backed'>, today: string): boolean {
  const d = lastDealOf(c)
  const n = d ? monthsAgo(d, today) : null
  return n !== null && n >= 0 && n <= ACTIVE_MONTHS
}

type Existing = { name: string; firm: string; email?: string; domains?: string[] }

const domainKey = (d: string | undefined) => {
  const x = d ? normDomain(d) : ''
  return x && !GENERIC_DOMAINS.has(x) ? x : ''
}
const nameKey = (c: Pick<Found, 'name' | 'firm'>) => normFirm(c.firm.trim() || c.name.trim())

/** The suggestion key a candidate is added under: its domain, else its firm's name. */
export const findKey = (c: Pick<Found, 'name' | 'firm' | 'domain'>) => 'find:' + (domainKey(c.domain) || nameKey(c))

/**
 * Drop anyone already in Nest (the same firm domain, or the same firm or name once
 * normalised: "Better Cap." is Better Capital), anyone already suggested (by key),
 * and repeats within the run.
 */
export function dedupe<T extends Pick<Found, 'name' | 'firm' | 'domain'>>(found: readonly T[], existing: readonly Existing[], taken: readonly string[] = []): { kept: T[]; skipped: number } {
  const domains = new Set(existing.flatMap((i) => [...(i.domains ?? []).map(domainKey), domainKey(firmDomain(i))]).filter(Boolean))
  const names = new Set(existing.flatMap((i) => [normFirm(i.firm.trim() || i.name.trim()), normFirm(i.name)]).filter(Boolean))
  const keys = new Set(taken)
  const kept: T[] = []
  for (const c of found) {
    const d = domainKey(c.domain)
    const ns = [nameKey(c), normFirm(c.name)].filter(Boolean)
    if (!ns.length || (d && domains.has(d)) || ns.some((n) => names.has(n)) || keys.has(findKey(c))) continue
    kept.push(c)
    if (d) domains.add(d)
    for (const n of ns) names.add(n)
    keys.add(findKey(c))
  }
  return { kept, skipped: found.length - kept.length }
}

/** Active ones only, new to Nest, most recent deal first, at most MAX_CANDIDATES. */
export function pickCandidates<T extends Found>(found: readonly T[], existing: readonly Existing[], taken: readonly string[], today: string): { candidates: T[]; inactive: number; already: number } {
  const active = found.filter((c) => isActive(c, today))
  const { kept, skipped } = dedupe(active, existing, taken)
  const sorted = [...kept].sort((a, b) => (lastDealOf(b) ?? '').localeCompare(lastDealOf(a) ?? '') || (b.dealsLast12 ?? 0) - (a.dealsLast12 ?? 0))
  return { candidates: sorted.slice(0, MAX_CANDIDATES), inactive: found.length - active.length, already: skipped }
}

/* ---------- scoring ---------- */

const backedLine = (b: Backed) => [b.company, [b.round, b.date].filter(Boolean).join(', ')].filter(Boolean).join(' (') + (b.round || b.date ? ')' : '')

/** What Jev reads about a candidate: their own facts from the search. Never the seed investors they invest alongside. */
export function foundFacts(c: Found): InvestorFacts {
  const last = lastDealOf(c)
  return {
    name: c.firm.trim() || c.name.trim(),
    ...(c.type ? { type: c.type } : {}),
    ...(c.stage ? { stage: c.stage } : {}),
    ...(c.check ? { check: c.check } : {}),
    ...(c.checkUsd ? { check_usd: c.checkUsd } : {}),
    ...(c.leads === undefined ? {} : { leads: c.leads ? 'Leads rounds' : 'Follows other leads' }),
    ...(c.geography ? { geography: c.geography } : {}),
    ...(c.thesis ? { thesis: c.thesis } : {}),
    ...(c.backed.length ? { recent_deals: c.backed.map(backedLine).join(', ') } : {}),
    ...(c.dealsLast12 !== undefined ? { deals_last_12_months: c.dealsLast12 } : {}),
    ...(last ? { last_deal: last } : {}),
  }
}

/** A candidate's facts in the shape enrichment keeps them, for the light Fit. */
export function candidateFacts(c: Found): Fact[] {
  const f = (field: string, value: string | undefined, amount?: number): Fact[] =>
    value ? [{ _id: field, runId: '', group: 'fund', field, value, source: c.sources[0]?.url ?? '', confidence: 1, status: 'kept', ...(amount ? { amount } : {}) }] : []
  return [
    ...f('stage', c.stage),
    ...f('check', c.check ?? (c.checkUsd ? money(c.checkUsd) : undefined), c.checkUsd),
    ...f('geography', c.geography),
    ...f('thesis', c.thesis),
    ...f('recentDeals', c.backed.map(backedLine).join(', ') || undefined),
  ]
}

/** Without Jev: the Priority score Nest has always worked out (src/lib/priority.ts), as for a new Not contacted investor. */
export function fallbackScore(c: Found & { warmPath?: string }, round: Pick<Round, 'minCheck' | 'target'>, today: string): number {
  const inv = { stage: 'todo' as const, warmth: c.warmPath ? ('warm' as const) : ('intro' as const), path: c.warmPath ?? '', expected: c.checkUsd }
  return priority(inv, fit(candidateFacts(c), round), null, today).score
}

/* ---------- how a result reads ---------- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec']
/** "Mar 2026" from "2026-03". */
export const monthLabel = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4)

export type FindChip = { label: string; tone: 'backed' | 'why' }

/** "Backed Puddlejump · pre-seed, Mar 2026", or "Backed Puddlejump and Storyloft" when they backed two seeds. */
export function backedChip(c: Pick<Found, 'backed'>): string | null {
  const companies = [...new Set(c.backed.map((b) => b.company.trim()).filter(Boolean))]
  if (!companies.length) return null
  if (companies.length > 1) return 'Backed ' + companies.slice(0, 2).join(' and ')
  const b = c.backed.find((x) => x.company.trim() === companies[0])!
  const when = [b.round?.trim().toLowerCase(), b.date && /^\d{4}-\d{2}/.test(b.date) ? monthLabel(b.date) : ''].filter(Boolean).join(', ')
  return 'Backed ' + companies[0] + (when ? ' · ' + when : '')
}

/** Up to three reason chips: what they backed, their thesis in Nest's words, then how active they are (or their checks, or where they invest). */
export function findChips(c: Found): FindChip[] {
  const out: FindChip[] = []
  const backed = backedChip(c)
  if (backed) out.push({ label: backed, tone: 'backed' })
  const themes = FIT_FOCUS.thesis.filter((x) => x.re.test((c.thesis ?? '').toLowerCase())).map((x) => x.label)
  if (themes.length) out.push({ label: themes.slice(0, 2).map((t, i) => (i ? t.toLowerCase() : t)).join(' + '), tone: 'why' })
  if ((c.dealsLast12 ?? 0) >= 3) out.push({ label: c.dealsLast12 + ' deals in 12 months', tone: 'why' })
  else if (c.checkUsd) out.push({ label: money(c.checkUsd) + ' checks', tone: 'why' })
  else if (c.geography) out.push({ label: c.geography, tone: 'why' })
  return out.slice(0, 3)
}

/** "Seed fund · leads". */
export function kindLine(c: Pick<Found, 'type' | 'leads'>): string {
  return [c.type, c.leads === undefined ? '' : c.leads ? 'leads' : 'follows'].filter(Boolean).join(' · ')
}

/* ---------- warm paths: Introducers, then Gmail and Calendar ---------- */

/**
 * A Find more result's warm path: Introducers first (PST-294's warmPathFor,
 * "Ankur knows them", "Ankur works there"), else Gmail and Calendar ("Ria met
 * Tara in Oct"). Null when Nest knows nobody.
 */
export function warmPathOf(c: Pick<Found, 'name' | 'firm' | 'domain'>, people: IntroSources, h: WarmHistory): string | null {
  const d = domainKey(c.domain)
  return warmPathFor({ name: c.name, firm: c.firm, domains: d ? [d] : [] }, people)?.line ?? warmPathFrom(c.domain, h)
}

export type WarmHistory = {
  meetings: readonly { userId: string; start: number; people: readonly { email: string; name?: string }[] }[]
  threads: readonly { userId: string; lastAt: number; participants: readonly string[] }[]
  /** Teammates' first names by user id. */
  names: Readonly<Record<string, string>>
}

/**
 * Someone on the team met or emailed a person at the candidate's domain: "Mira
 * met Sam in Oct", "Mira emailed them in Sept". The most recent wins; null when
 * nobody has (or the domain is personal mail). The fallback when no introducer
 * knows them (warmPathOf).
 */
export function warmPathFrom(domain: string | undefined, h: WarmHistory): string | null {
  const d = domainKey(domain)
  if (!d) return null
  const at = (email: string) => normDomain(email.slice(email.lastIndexOf('@') + 1)) === d
  const who = (userId: string) => h.names[userId] || 'You'
  const month = (ms: number) => MONTHS[Number(todayIST(ms).slice(5, 7)) - 1]
  let best: { at: number; text: string } | null = null
  for (const m of h.meetings) {
    const p = m.people.find((x) => at(x.email))
    if (p && (!best || m.start > best.at)) best = { at: m.start, text: who(m.userId) + ' met ' + (p.name?.trim().split(/\s+/)[0] || 'them') + ' in ' + month(m.start) }
  }
  for (const t of h.threads)
    if (t.participants.some(at) && (!best || t.lastAt > best.at)) best = { at: t.lastAt, text: who(t.userId) + ' emailed them in ' + month(t.lastAt) }
  return best?.text ?? null
}
