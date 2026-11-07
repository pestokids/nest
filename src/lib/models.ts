// PST-273: the Claude models Nest can run on, what they cost, and what a run of
// each AI feature should cost on each. Shared by Convex (pricing every run) and
// Settings › AI (the model picker and its estimates). Pure (unit-tested).

export const HAIKU = 'claude-haiku-5-5'
export const SONNET = 'claude-sonnet-5-5'
export const OPUS = 'claude-opus-5-5'
export const MODELS = [HAIKU, SONNET, OPUS] as const
export type Model = (typeof MODELS)[number]
/** The model when Settings › AI hasn't picked one. Sonnet cost 10–15x what Settings promised; switching back is this one line. */
export const AI_MODEL: Model = HAIKU

export const MODEL_INFO: Record<Model, { name: string; goodFor: string }> = {
  [HAIKU]: { name: 'Haiku', goodFor: 'Everyday lookups, notes, drafts and questions' },
  [SONNET]: { name: 'Sonnet', goodFor: 'People with common names, thin or messy pages' },
  [OPUS]: { name: 'Opus', goodFor: 'The hardest lookups, when the others come back empty' },
}
export const isModel = (m: unknown): m is Model => typeof m === 'string' && (MODELS as readonly string[]).includes(m)
export const modelName = (m: string | undefined) => (isModel(m) ? MODEL_INFO[m].name : 'Claude')

type Rates = { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number }
/** Prompts longer than this (input, cache reads and cache writes together) are billed at a model's long-prompt rates, when it has them. */
export const LONG_PROMPT = 100_000

/**
 * Dollars per million tokens, and per web search. From
 * https://platform.claude.com/docs/en/about-claude/pricing ($10 per 1,000 web
 * searches; web fetch costs nothing beyond its tokens). Checked 7 Nov 2026.
 */
export const PRICES: Record<Model, Rates & { long?: Rates }> & { webSearch: number } = {
  [HAIKU]: { input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, long: { input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05 } },
  [SONNET]: { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1 },
  [OPUS]: { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 },
  webSearch: 0.01,
}

/** One API response's usage, as the Messages API reports it. */
export type Usage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  server_tool_use?: { web_search_requests?: number; web_fetch_requests?: number }
}

/**
 * What one request cost, in dollars: tokens at the model's prices plus web
 * searches. A prompt past LONG_PROMPT is billed at the model's long-prompt
 * prices; `long` overrides that for a request whose usage adds up several
 * steps that were each shorter (research with server tools).
 */
export function costOf(u: Usage, model: Model, long = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) > LONG_PROMPT): number {
  const base = PRICES[model]
  const p = long && base.long ? base.long : base
  const w1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const w5m = u.cache_creation?.ephemeral_5m_input_tokens ?? Math.max(0, (u.cache_creation_input_tokens ?? 0) - w1h)
  const tokens =
    (u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output + w5m * p.cacheWrite5m + w1h * p.cacheWrite1h + (u.cache_read_input_tokens ?? 0) * p.cacheRead
  return tokens / 1e6 + (u.server_tool_use?.web_search_requests ?? 0) * PRICES.webSearch
}

/** A run's usage as its row stores it (enrichRuns, noteReads, drafts, askRuns, briefs), so real costs can be checked later. */
export type RunUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches: number }

export const usageRow = (u: Usage): RunUsage => ({
  input: u.input_tokens ?? 0,
  output: u.output_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
  webSearches: u.server_tool_use?.web_search_requests ?? 0,
})

/** Two runs' usage added up (a draft rewritten). */
export const addRunUsage = (a: RunUsage, b: RunUsage): RunUsage => ({
  input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, webSearches: a.webSearches + b.webSearches,
})

/* ---------- features, and which model each runs on ---------- */

export const FEATURES = ['enrich', 'notes', 'drafts', 'ask', 'brief'] as const
export type Feature = (typeof FEATURES)[number]
export const FEATURE_LABEL: Record<Feature, string> = {
  enrich: 'Enrichment & Who’s this? lookups',
  notes: 'Meeting notes',
  drafts: 'Drafts',
  ask: 'Ask Nest',
  brief: 'Morning brief',
}
/** The model a run used before runs recorded it (PST-273): Sonnet, except the brief, which was always Haiku. */
export const LEGACY_MODEL: Record<Feature, Model> = { enrich: SONNET, notes: SONNET, drafts: SONNET, ask: SONNET, brief: HAIKU }

/** Settings › AI: the default model, and the features that have their own. */
export type ModelChoice = { default: Model; features: Partial<Record<Feature, Model>> }
export const DEFAULT_CHOICE: ModelChoice = { default: AI_MODEL, features: {} }
export const modelFor = (c: ModelChoice, f: Feature): Model => c.features[f] ?? c.default

/* ---------- what a run should cost ---------- */

/**
 * Typical tokens for one run of each feature, from the prompts' sizes and the
 * research limits (convex/lib/anthropic.ts TOOLS).
 *   enrich: one request in which Claude takes a step per search or page, and
 *     every step reads all that came before: about 3K tokens of instructions,
 *     about 4K per search's results, up to 8K per page. A typical enrichment
 *     (search, search, page, search, page) reads 3+7+11+18+22+29 = 90K and
 *     writes 3K. The same sums for the old limits on Sonnet give about 60¢,
 *     which is what those runs really cost.
 *   notes: 1K of instructions, about 3K of Q&A bank, 2K of notes; about 1K out.
 *   drafts: 3K of what Nest knows about the investor; a 400-token email.
 *   ask: 2K of instructions and tools, then three lookups of about 3K, each
 *     turn reading the ones before (2+5+8+11 = 26K); a 500-token answer.
 *   brief: three moves' facts, 1.5K; three one-line reasons.
 */
export const TYPICAL: Record<Feature, RunUsage> = {
  enrich: { input: 90_000, output: 3_000, cacheRead: 0, cacheWrite: 0, webSearches: 3 },
  notes: { input: 6_000, output: 1_000, cacheRead: 0, cacheWrite: 0, webSearches: 0 },
  drafts: { input: 3_000, output: 400, cacheRead: 0, cacheWrite: 0, webSearches: 0 },
  ask: { input: 26_000, output: 500, cacheRead: 0, cacheWrite: 0, webSearches: 0 },
  brief: { input: 1_500, output: 150, cacheRead: 0, cacheWrite: 0, webSearches: 0 },
}
/** Runs with stored usage a feature needs before its estimate uses them instead of TYPICAL. */
export const MIN_REAL_RUNS = 5

/** A feature's real usage: how many runs had it stored, and their average. */
export type RealUsage = { runs: number; avg: RunUsage }

/** A run at a model's standard prices: its usage adds up several requests (turns, research steps), each well under LONG_PROMPT. */
export const costOfRow = (u: RunUsage, model: Model) =>
  costOf({ input_tokens: u.input, output_tokens: u.output, cache_read_input_tokens: u.cacheRead, cache_creation_input_tokens: u.cacheWrite, server_tool_use: { web_search_requests: u.webSearches } }, model, false)

/** What one run of a feature should cost on a model: from its real average once it has MIN_REAL_RUNS runs, else from TYPICAL. */
export function estimate(f: Feature, model: Model, real?: RealUsage | null): { usd: number; real: boolean } {
  const useReal = !!real && real.runs >= MIN_REAL_RUNS
  return { usd: costOfRow(useReal ? real.avg : TYPICAL[f], model), real: useReal }
}

/** The average of some runs' usage (null for none). */
export function averageUsage(xs: readonly RunUsage[]): RealUsage | null {
  if (!xs.length) return null
  const sum = xs.reduce(addRunUsage)
  const n = xs.length
  return { runs: n, avg: { input: sum.input / n, output: sum.output / n, cacheRead: sum.cacheRead / n, cacheWrite: sum.cacheWrite / n, webSearches: sum.webSearches / n } }
}

/** This month's runs as a whole month at the same pace: `day` is today's date (1–31) in a month of `days` days. */
export const monthPace = (runs: number, day: number, days: number) => (runs / Math.max(1, day)) * days
