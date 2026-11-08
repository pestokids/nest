import { describe, expect, it } from 'vitest'
import { averageUsage, costOf, estimate, HAIKU, MIN_REAL_RUNS, modelFor, monthPace, OPUS, SONNET, TYPICAL, usageRow, type RunUsage } from './models'

const M = 1_000_000

describe('costOf', () => {
  it('prices each model per million tokens, plus $10 per 1,000 web searches', () => {
    const u = { input_tokens: 50_000, output_tokens: 10_000 }
    expect(costOf(u, HAIKU)).toBeCloseTo((50_000 * 0.1 + 10_000 * 0.5) / M, 12)
    expect(costOf(u, SONNET)).toBeCloseTo((50_000 * 2 + 10_000 * 10) / M, 12)
    expect(costOf(u, OPUS)).toBeCloseTo((50_000 * 4 + 10_000 * 20) / M, 12)
    expect(costOf({ cache_creation_input_tokens: 50_000 }, OPUS)).toBeCloseTo(0.05 * 5, 10)
    expect(costOf({ cache_creation: { ephemeral_1h_input_tokens: 50_000 }, cache_creation_input_tokens: 50_000 }, OPUS)).toBeCloseTo(0.05 * 8, 10)
    expect(costOf({ cache_read_input_tokens: 50_000 }, SONNET)).toBeCloseTo(0.05 * 0.1, 10)
    expect(costOf({ server_tool_use: { web_search_requests: 3, web_fetch_requests: 5 } }, HAIKU)).toBeCloseTo(0.03, 10)
  })

  it('bills a Haiku prompt over 100K tokens (input, cache reads and writes) at its long-prompt prices', () => {
    expect(costOf({ input_tokens: 100_000, output_tokens: 1_000 }, HAIKU)).toBeCloseTo((100_000 * 0.1 + 1_000 * 0.5) / M, 12)
    expect(costOf({ input_tokens: 100_001, output_tokens: 1_000 }, HAIKU)).toBeCloseTo((100_001 * 0.5 + 1_000 * 2.5) / M, 12)
    expect(costOf({ input_tokens: 60_000, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 20_000 }, HAIKU)).toBeCloseTo((60_000 * 0.5 + 30_000 * 0.05 + 20_000 * 0.625) / M, 12)
    expect(costOf({ input_tokens: 90_000, cache_creation: { ephemeral_1h_input_tokens: 20_000 }, cache_creation_input_tokens: 20_000 }, HAIKU)).toBeCloseTo((90_000 * 0.5 + 20_000 * 1) / M, 12)
    // Searches cost the same either way; Sonnet and Opus have one price at any length.
    expect(costOf({ input_tokens: 200_000, server_tool_use: { web_search_requests: 2 } }, HAIKU)).toBeCloseTo((200_000 * 0.5) / M + 0.02, 12)
    expect(costOf({ input_tokens: 200_000 }, SONNET)).toBeCloseTo(0.4, 12)
    expect(costOf({ input_tokens: 200_000 }, OPUS)).toBeCloseTo(0.8, 12)
    // A research request whose short steps add up past 100K says so.
    expect(costOf({ input_tokens: 160_000 }, HAIKU, false)).toBeCloseTo(0.016, 12)
  })
})

describe('estimates', () => {
  const run = (input: number, output: number, webSearches = 0): RunUsage => ({ input, output, cacheRead: 0, cacheWrite: 0, webSearches })

  it('uses typical token counts until a feature has five runs with usage, then their average', () => {
    expect(MIN_REAL_RUNS).toBe(5)
    const four = averageUsage([run(40_000, 2_000, 2), run(40_000, 2_000, 2), run(40_000, 2_000, 2), run(40_000, 2_000, 2)])
    expect(estimate('enrich', HAIKU, four)).toEqual({ usd: estimate('enrich', HAIKU).usd, real: false })
    expect(estimate('enrich', HAIKU).usd).toBeCloseTo((TYPICAL.enrich.input * 0.1 + TYPICAL.enrich.output * 0.5) / M + 0.03, 12)
    const five = averageUsage([run(30_000, 1_000, 1), run(40_000, 2_000, 2), run(50_000, 3_000, 3), run(40_000, 2_000, 2), run(40_000, 2_000, 2)])
    expect(five).toEqual({ runs: 5, avg: run(40_000, 2_000, 2) })
    expect(estimate('enrich', HAIKU, five)).toEqual({ usd: (40_000 * 0.1 + 2_000 * 0.5) / M + 0.02, real: true })
    expect(estimate('enrich', OPUS, five).usd).toBeCloseTo((40_000 * 4 + 2_000 * 20) / M + 0.02, 12)
    expect(averageUsage([])).toBeNull()
  })

  it('works out the typical run on each model', () => {
    expect(estimate('enrich', HAIKU).usd).toBeCloseTo(0.0405, 10)
    expect(estimate('enrich', SONNET).usd).toBeCloseTo(0.24, 10)
    expect(estimate('notes', HAIKU).usd).toBeCloseTo(0.0011, 10)
    expect(estimate('ask', HAIKU).usd).toBeCloseTo(0.00285, 10)
    expect(estimate('ask', OPUS).usd).toBeCloseTo(0.114, 10)
  })

  it('a month at this pace, and each feature on its own model or the default', () => {
    expect(monthPace(10, 10, 30)).toBe(30)
    expect(monthPace(3, 1, 31)).toBe(93)
    expect(monthPace(0, 15, 30)).toBe(0)
    const c = { default: HAIKU, features: { ask: OPUS } } as const
    expect(modelFor(c, 'ask')).toBe(OPUS)
    expect(modelFor(c, 'enrich')).toBe(HAIKU)
  })

  it('stores usage the way the API reports it', () => {
    expect(usageRow({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, server_tool_use: { web_search_requests: 1 } })).toEqual({
      input: 10, output: 2, thinking: 0, cacheRead: 3, cacheWrite: 4, webSearches: 1,
    })
    expect(usageRow({ input_tokens: 10, output_tokens: 391, output_tokens_details: { thinking_tokens: 311 } })).toMatchObject({ output: 391, thinking: 311 })
    expect(usageRow({})).toEqual({ ...run(0, 0), thinking: 0 })
  })
})
