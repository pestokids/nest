// PST-274: investor enrichment. Shared by the UI and Convex: what Nest looks up,
// how a kept fact lands on the investor (and when it would clash with something
// Dev typed), the light Fit score, and the small labels the drawer, Investors,
// Who's this? and Settings show. Pure functions.
import { formatDay } from './dates'
import { exactMoney, money } from './money'
import { NEW_INVESTOR, type InvestorFields } from './pipeline'
import { domainOf, GENERIC_DOMAINS, normDomain, normEmail } from './google'
import type { Round } from './round'
import { TYPES, type Geo, type InvestorType } from './stages'
import { DEFAULT_CHOICE, FEATURES, MODELS, type Feature, type Model, type ModelChoice, type RealUsage } from './models'
import { JEV_OFF, type JevStatus } from './jev'

export const RANKS = ['managing partner', 'partner', 'principal', 'associate', 'scout', 'angel'] as const
export type Rank = (typeof RANKS)[number]
export const RANK_LABEL: Record<Rank, string> = {
  'managing partner': 'Managing partner', partner: 'Partner', principal: 'Principal', associate: 'Associate', scout: 'Scout', angel: 'Angel',
}
export const asRank = (s: string | undefined): Rank | undefined => {
  const r = s?.trim().toLowerCase() ?? ''
  return (RANKS as readonly string[]).includes(r) ? (r as Rank) : undefined
}

export type FactGroup = 'person' | 'fund'
export const PERSON_FIELDS = ['name', 'title', 'rank', 'covers', 'location', 'email', 'linkedin', 'x'] as const
export const FUND_FIELDS = ['name', 'website', 'domain', 'type', 'size', 'vintage', 'stage', 'check', 'leads', 'geography', 'thesis', 'recentDeals', 'partner'] as const

const LABELS: Record<string, string> = {
  'person.name': 'Name', 'person.title': 'Title', 'person.rank': 'Rank', 'person.covers': 'Covers', 'person.location': 'Location',
  'person.email': 'Email', 'person.linkedin': 'LinkedIn', 'person.x': 'X',
  'fund.name': 'Fund', 'fund.website': 'Website', 'fund.domain': 'Domain', 'fund.type': 'Type', 'fund.size': 'Fund size', 'fund.vintage': 'Vintage',
  'fund.stage': 'Stage', 'fund.check': 'Average check', 'fund.leads': 'Leads', 'fund.geography': 'Geography', 'fund.thesis': 'Thesis',
  'fund.recentDeals': 'Recent deals', 'fund.partner': 'Partner',
}
export const fieldLabel = (group: FactGroup, field: string) => LABELS[group + '.' + field] ?? field

/** Review order: the person top to bottom, then the fund. */
export const factOrder = (f: Pick<Fact, 'group' | 'field'>) =>
  f.group === 'person' ? (PERSON_FIELDS as readonly string[]).indexOf(f.field) : 100 + (FUND_FIELDS as readonly string[]).indexOf(f.field)

export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped'
export type StepState = 'waiting' | 'running' | 'done'
export type Step = { label: string; state: StepState; source?: string }
export type Verdict = 'investor' | 'not_investor' | 'unknown'
export type FactStatus = 'pending' | 'kept' | 'dismissed'
export type FactPerson = { name: string; title?: string; rank?: Rank; covers?: string; location?: string; linkedin?: string; x?: string }

export type Fact = {
  _id: string
  runId: string
  investorId?: string
  email?: string
  group: FactGroup
  field: string
  value: string
  /** The page it came from (a URL). */
  source: string
  confidence: number
  status: FactStatus
  /** Set when keeping it would not change a value Dev typed. */
  clash?: string
  /** Dollars, for size and check facts. */
  amount?: number
  /** For a partner: who they are. */
  person?: FactPerson
  keptAt?: number
  _creationTime?: number
}

export type Run = {
  _id: string
  investorId?: string
  email?: string
  status: RunStatus
  steps: Step[]
  costUsd: number
  startedAt: number
  finishedAt?: number
  error?: string
  factCount?: number
  verdict?: Verdict
  summary?: string
  auto: boolean
  cached?: boolean
  /** PST-273: the model it ran on. */
  model?: Model
}

export type Person = {
  _id: string
  investorId: string
  name: string
  title?: string
  rank?: Rank
  covers?: string
  location?: string
  email?: string
  linkedin?: string
  x?: string
  primary: boolean
}

/** The error a run records (and the code a refused write carries) when ANTHROPIC_API_KEY isn't set. */
export const NO_AI_KEY = 'NoAIKey'

/* ---------- where a kept fact goes ---------- */

const KEEP = 'Keeping this won’t change it.'

/** "Pre-seed fund" from "pre-seed fund"; only the investor types Nest has. */
export const asType = (s: string): InvestorType | undefined => TYPES.find((t) => t.toLowerCase() === s.trim().toLowerCase())

/** One of Nest's geographies from "India and the US", "Bengaluru", "MENA"… (several regions make it Global). */
export function mapGeo(text: string): Geo | undefined {
  const t = ' ' + text.toLowerCase() + ' '
  const hits = new Set<Geo>()
  if (/india|bengaluru|bangalore|mumbai|delhi|gurgaon|gurugram|pune|hyderabad|chennai/.test(t)) hits.add('India')
  if (/\bus\b|\bu\.s\.|\busa\b|united states|america|silicon valley|new york|san francisco|bay area/.test(t)) hits.add('US')
  if (/mena|middle east|\buae\b|dubai|abu dhabi|saudi|riyadh|qatar|egypt|\bgcc\b/.test(t)) hits.add('MENA')
  if (/global|worldwide|europe|\buk\b|asia|latam|africa/.test(t) || hits.size > 1) return 'Global'
  return [...hits][0]
}

/**
 * What keeping a fact writes on the investor, or why it won't. Only type, geo,
 * email, domains and Expected are written, and only when empty (for type and
 * geo, the new-investor default counts as empty). A different value Dev typed is
 * never overwritten: that's a clash note instead. Everything else (and every
 * person fact) lives in the fund card and People.
 */
export function investorWrite(inv: InvestorFields, f: Pick<Fact, 'group' | 'field' | 'value' | 'amount'>): { patch?: Partial<InvestorFields>; clash?: string } {
  switch (f.group + '.' + f.field) {
    case 'fund.type': {
      const t = asType(f.value)
      if (!t || t === inv.type) return {}
      return inv.type === NEW_INVESTOR.type ? { patch: { type: t } } : { clash: 'You set Type to ' + inv.type + '. ' + KEEP }
    }
    case 'fund.geography': {
      const g = mapGeo(f.value)
      if (!g || g === inv.geo) return {}
      return inv.geo === NEW_INVESTOR.geo ? { patch: { geo: g } } : { clash: 'You set Geography to ' + inv.geo + '. ' + KEEP }
    }
    case 'person.email': {
      const e = normEmail(f.value)
      if (!e) return {}
      if (!inv.email?.trim()) return { patch: { email: e } }
      return normEmail(inv.email) === e ? {} : { clash: 'You wrote ' + inv.email + ' as Email. ' + KEEP }
    }
    case 'fund.domain': {
      const d = normDomain(f.value)
      if (!d || GENERIC_DOMAINS.has(d)) return {}
      const cur = inv.domains ?? []
      if (!cur.length) return { patch: { domains: [d] } }
      return cur.includes(d) ? {} : { clash: 'You wrote ' + cur.join(', ') + ' as the firm’s domain. ' + KEEP }
    }
    case 'fund.check': {
      const n = f.amount && f.amount > 0 ? Math.round(f.amount) : 0
      if (!n) return {}
      if (!inv.expected) return { patch: { expected: n } }
      return inv.expected === n ? {} : { clash: 'You wrote ' + money(inv.expected) + ' as Expected. ' + KEEP }
    }
    default:
      return {}
  }
}

/** The firm domain an investor is looked up (and cached) by: its first domain, else its email's, unless that's personal mail. */
export function firmDomain(i: { email?: string; domains?: string[] }): string | undefined {
  const d = (i.domains ?? []).map(normDomain).find(Boolean)
  if (d) return d
  const e = normEmail(i.email)
  return e && !GENERIC_DOMAINS.has(domainOf(e)) ? domainOf(e) : undefined
}

/* ---------- the light Fit card ---------- */

/** What this round looks for beyond the round settings: Pesto is a kids, family and learning company raising pre-seed. */
export const FIT_FOCUS = {
  thesis: [
    { label: 'Kids', re: /\bkids?\b|children|\bchild\b|toddler/ },
    { label: 'Consumer', re: /consumer|\bd2c\b|\bb2c\b/ },
    { label: 'Edtech', re: /edtech|education|learning/ },
    { label: 'Parents', re: /parent|famil/ },
  ],
  geos: ['India', 'US', 'Global'] as Geo[],
}

export type Fit = { score: number; headline: string; reasons: string[] }

/** PST-296 exports it for the fit score (src/lib/fitScore.ts). */
export const latestKept = (facts: readonly Fact[], field: string) =>
  facts.filter((f) => f.group === 'fund' && f.field === field && f.status === 'kept').sort((a, b) => (b.keptAt ?? 0) - (a.keptAt ?? 0))[0]

/**
 * A simple score out of 100 from the kept fund facts against this round: stage
 * (30), check size against the minimum check and a quarter of the target (25),
 * thesis (30) and geography (15). Null until at least two of the four are known.
 */
export function fit(facts: readonly Fact[], round: Pick<Round, 'minCheck' | 'target'>): Fit | null {
  const stage = latestKept(facts, 'stage')
  const check = latestKept(facts, 'check')
  const geo = latestKept(facts, 'geography')
  const thesis = ['thesis', 'recentDeals'].map((k) => latestKept(facts, k)?.value ?? '').join(' ').toLowerCase()
  if ([stage, check?.amount, geo, thesis.trim()].filter(Boolean).length < 2) return null
  const reasons: { label: string; w: number }[] = []
  let score = 0
  if (stage) {
    const w = /pre-?seed/i.test(stage.value) ? 30 : /\bseed\b|angel/i.test(stage.value) ? 15 : 0
    score += w
    if (w) reasons.push({ label: w === 30 ? 'Pre-seed' : 'Seed', w })
  }
  if (check?.amount) {
    const fits = check.amount >= (round.minCheck ?? 0) && check.amount <= round.target * 0.25
    score += fits ? 25 : 10
    const range = /\$\s?[\d.]+\s?[KkMm]?\s*[–-]\s*\$?\s?[\d.]+\s?[KkMm]/.exec(check.value)?.[0].replace(/\s+/g, '')
    if (fits) reasons.push({ label: 'Checks ' + (range ?? money(check.amount)), w: 25 })
  }
  const themes = FIT_FOCUS.thesis.filter((x) => x.re.test(thesis))
  if (themes.length) {
    const w = themes.length >= 3 ? 30 : themes.length === 2 ? 26 : 16
    score += w
    const [a, b] = themes.map((x) => x.label)
    reasons.push({ label: b ? a + ' + ' + b.toLowerCase() : a, w })
  }
  const g = geo ? mapGeo(geo.value) : undefined
  if (g && FIT_FOCUS.geos.includes(g)) {
    score += 15
    reasons.push({ label: g === 'Global' ? 'Invests globally' : 'Invests in ' + g, w: 15 })
  }
  score = Math.min(100, score)
  return {
    score,
    headline: score >= 80 ? 'Strong fit for this round' : score >= 55 ? 'Good fit for this round' : 'A weak fit for this round',
    reasons: reasons.sort((x, y) => y.w - x.w).slice(0, 3).map((r) => r.label),
  }
}

/* ---------- labels ---------- */

/** "4¢", "$1.84", and under a cent (PST-273: most Haiku runs) "0.4¢" or "<0.1¢". */
export function cents(usd: number): string {
  if (usd >= 1) return exactMoney(usd, true)
  const c = usd * 100
  if (c <= 0) return '0¢'
  if (c < 0.05) return '<0.1¢'
  return (c < 0.95 ? c.toFixed(1) : String(Math.round(c))) + '¢'
}

/** "linkedin.com" from a URL; the input when it isn't one. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** "kite.example.com/team": the host and the first path segment, for a source link. */
export function sourceShort(url: string): string {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean)[0]
    return u.hostname.replace(/^www\./, '') + (seg ? '/' + seg : '')
  } catch {
    return url
  }
}

/** The Investors table's Enriched cell. */
export function enrichedCell(run: Pick<Run, 'status' | 'finishedAt'> | undefined): { text: string; tone: 'done' | 'running' | 'queued' | 'none' } {
  if (run?.status === 'running') return { text: 'Running…', tone: 'running' }
  if (run?.status === 'queued') return { text: 'Queued', tone: 'queued' }
  if (run?.status === 'done' && run.finishedAt) return { text: '✓ ' + formatDay(run.finishedAt), tone: 'done' }
  return { text: '—', tone: 'none' }
}

/** "About 30 seconds left", from how long the finished steps took. */
export function timeLeft(run: Pick<Run, 'steps' | 'startedAt' | 'status'>, now: number): string {
  if (run.status === 'queued') return 'Waiting for a free slot'
  const done = run.steps.filter((s) => s.state === 'done').length
  const left = run.steps.length - done
  if (!left) return 'Almost done'
  const ms = (done ? Math.max(4e3, (now - run.startedAt) / done) : 12e3) * left
  return ms < 15e3 ? 'A few seconds left' : ms < 75e3 ? 'About ' + Math.round(ms / 10e3) * 10 + ' seconds left' : 'About ' + Math.round(ms / 6e4) + ' minutes left'
}

/** What the drawer's AI card shows. */
export type CardState = 'nokey' | 'idle' | 'running' | 'review' | 'done' | 'failed'
export function cardState(o: { connected: boolean; run?: Pick<Run, 'status' | 'error'> | null; pending: number; kept: number }): CardState {
  const { run } = o
  if (run && (run.status === 'queued' || run.status === 'running')) return 'running'
  if (o.pending) return 'review'
  if (o.kept) return 'done'
  if (!o.connected || run?.error === NO_AI_KEY) return 'nokey'
  if (run?.status === 'failed') return 'failed'
  return 'idle'
}

/** Who's this?: "Principal at XYZ Ventures · $40M pre-seed fund · covers consumer and kids". */
export function whoLine(facts: readonly Pick<Fact, 'group' | 'field' | 'value' | 'status'>[]): string {
  const get = (g: FactGroup, k: string) => facts.find((f) => f.group === g && f.field === k && f.status !== 'dismissed')?.value.trim()
  const title = get('person', 'title')
  const fund = get('fund', 'name')
  const size = get('fund', 'size')?.replace(/\s*\(.*\)$/, '').split(/ across | in /)[0]
  const stage = get('fund', 'stage')?.toLowerCase().split(/[,;]| and /)[0].trim()
  const covers = get('person', 'covers')
  const head = title && fund ? title + ' at ' + fund : title || fund
  const sized = size ? size + (stage && !/fund/i.test(size) ? ' ' + stage + ' fund' : '') : ''
  return [head, sized, covers ? 'covers ' + covers.charAt(0).toLowerCase() + covers.slice(1) : ''].filter(Boolean).join(' · ')
}

/** Initials for an avatar: "Sam Okoye" → "SO", "m.tan@x.com" → "MT". */
export function initials(name: string): string {
  const words = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase()
}

/* ---------- what the app gets ---------- */

/** PST-279: morningBrief is the 08:00 brief on Today. */
export type AISettings = { lookups: boolean; enrichNew: boolean; meetingNotes: boolean; morningBrief: boolean }
export type InvestorRun = Run & { pending: number }
export type Sender = { email: string; run: Run; facts: Fact[] }
export type RecentRun = {
  _id: string
  at: number
  investor?: string
  email?: string
  wasInvestor: boolean
  facts: number
  costUsd: number
  status: RunStatus
  cached: boolean
  /** PST-279: an Ask Nest question (its words only for whoever asked it, and how many lookups it took) or a morning brief (its moves). Absent: a lookup. */
  kind?: 'ask' | 'brief'
  question?: string
  tools?: number
  moves?: number
  /** PST-273: the model it ran on (none for a run copied from a recent lookup). */
  model?: Model
}
export type AIData = {
  loaded: boolean
  /** ANTHROPIC_API_KEY is set on this deployment. */
  connected: boolean
  settings: AISettings
  /** PST-277: `noteReads` counts meeting notes Nest read; PST-279: `asks` counts Ask Nest questions (their costs, and the briefs', are in `usd`). */
  month: { usd: number; lookups: number; enrichments: number; noteReads?: number; asks?: number }
  /** Automatic lookups left today. */
  capLeft: number
  /** Each investor's latest run, with how many of its facts wait for review. */
  runs: InvestorRun[]
  /** Looked-up senders (Who's this?) with what was found. */
  senders: Sender[]
  recent: RecentRun[]
  /** PST-273: Settings › AI's models. */
  models: ModelChoice
  /** Each feature's runs this month, and the average usage of its latest runs that stored it (null: none yet). */
  features: Record<Feature, { month: number; real: RealUsage | null }>
  /** This month's spend by model and by feature (runs from before PST-273 count as the model they used). */
  spend: { byModel: Record<Model, number>; byFeature: Record<Feature, number> }
  /** PST-292: Jev (TYPESAFE_API_KEY): on or off, the monthly cap and this month's spend (also in month.usd). */
  jev: JevStatus
  /** PST-292: Who's this? people Jev's pre-check said probably aren't investors (not looked up), with the probability it gave. */
  prechecked: { email: string; likely: number }[]
}
export type InvestorAI = { run: Run | null; facts: Fact[]; people: Person[] }
const perFeature = <T>(x: () => T) => Object.fromEntries(FEATURES.map((k) => [k, x()])) as Record<Feature, T>
export const NO_AI: AIData = {
  loaded: false, connected: false, settings: { lookups: true, enrichNew: true, meetingNotes: true, morningBrief: true }, month: { usd: 0, lookups: 0, enrichments: 0 }, capLeft: 30, runs: [], senders: [], recent: [],
  models: DEFAULT_CHOICE,
  features: perFeature(() => ({ month: 0, real: null })),
  spend: { byModel: Object.fromEntries(MODELS.map((m) => [m, 0])) as Record<Model, number>, byFeature: perFeature(() => 0) },
  jev: JEV_OFF,
  prechecked: [],
}
